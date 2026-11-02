import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DeliveryPresetId } from '../../../shared/delivery-presets';
import {
  latestLongExports,
  longLanguageOf,
  longPrecheckAuto,
  longPublishFiles,
  longQaReady,
  longRecordAuto,
  longYoutubeCopy,
  reconcileLongPublishing,
  type LongPostRecord,
  type LongPublishingView,
  type LongYoutubeCopy,
} from '../../../shared/long/publishing';
import type { CreditTrack } from '../../../shared/long/outputs';
import type { LongLanguage, LongProject } from '../../../shared/long/schema';
import { checkYoutubeVideoUrl } from '../../../shared/post-url';
import {
  applyChecklist,
  applyNeedsFix,
  canCompletePublish,
  completeTask,
  currentTask,
  manualPrecheckReady,
  publishingStarted,
  skipTask,
  stampBundle,
  upsertPublicationVerify,
  type PublishingBundle,
  type WorkflowTask,
} from '../../../shared/publishing';
import type { AnalyticsPost } from '../../../shared/schema/analytics';
import type { AudioTrack } from '../../../shared/schema/audio';
import type { AnalyticsService } from './analytics-service';
import type { PublishingService } from './publishing-service';

type TaskBody = {
  checklist?: Array<{ id: string; checked: boolean }>;
  url?: string;
  postedAt?: string;
  qa?: WorkflowTask['qa'];
};

/** YouTube 投稿（API）の下書きに渡す、書き出した版の情報 */
export type LongDraftSource = {
  videoPath: string;
  thumbnailPath?: string;
  basename: string;
  exportId: string;
  contentStamp?: string;
  language: LongLanguage;
  copy: LongYoutubeCopy;
  content: Partial<AnalyticsPost['content']>;
  projectTitle: string;
};

/**
 * 横動画（YouTube 通常動画）の投稿運用。
 * ワークフローは短尺と同じ表に保存し、投稿の記録は分析の Post に持つ。
 * 横動画の long-project.json はこのサービスから書き換えない（画面の自動保存と競合させない）。
 */
export class LongPublishingService {
  constructor(
    private readonly deps: {
      publishing: PublishingService;
      analytics: AnalyticsService;
      loadProject: (id: string) => Promise<LongProject>;
      workspace: () => string | null;
      getTrack: (id: string) => AudioTrack | null;
    },
  ) {}

  private resolve(relativePath: string): string | null {
    const workspace = this.deps.workspace();
    if (!workspace) return null;
    const root = path.resolve(workspace);
    const resolved = path.resolve(root, relativePath);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
  }

  private sync(project: LongProject): PublishingBundle | null {
    const next = reconcileLongPublishing(this.deps.publishing.readBundle(project.id), project, new Date().toISOString(), () => randomUUID());
    if (next) this.deps.publishing.saveBundle(next);
    return next;
  }

  private tracks(project: LongProject): AudioTrack[] {
    const ids = new Set<string>([
      ...project.bgm.map((item) => item.audioTrackId),
      ...project.se.map((item) => item.audioTrackId),
      ...project.overlays.map((item) => item.seTrackId).filter((id): id is string => Boolean(id)),
      ...project.avatarEvents.map((item) => item.seTrackId).filter((id): id is string => Boolean(id)),
    ]);
    return [...ids].map((id) => this.deps.getTrack(id)).filter((track): track is AudioTrack => track !== null);
  }

  private credits(project: LongProject): CreditTrack[] {
    return this.tracks(project).map((track) => ({ title: track.title, artist: track.artist, creditRequired: track.creditRequired, creditText: track.creditText }));
  }

  private async readText(relativePath: string | undefined): Promise<string> {
    const absolute = relativePath ? this.resolve(relativePath) : null;
    if (!absolute) return '';
    return fs.readFile(absolute, 'utf8').catch(() => '');
  }

  /** 書き出したチャプター草案（言語ごと） */
  private async chapters(project: LongProject): Promise<Partial<Record<LongLanguage, string>>> {
    const out: Partial<Record<LongLanguage, string>> = {};
    for (const file of longPublishFiles(project).filter((item) => item.kind === 'chapters')) {
      out[file.language] = await this.readText(file.relativePath);
    }
    return out;
  }

  private posts(projectId: string): LongPostRecord[] {
    return this.deps.analytics.longPosts(projectId).flatMap((post) => {
      const language = longLanguageOf(post.preset);
      return language && post.preset
        ? [
            {
              preset: post.preset,
              language,
              url: post.url,
              postedAt: post.actualPublishedAt ?? (post.publicationState === 'scheduled' || post.publicationState === 'private' || post.publicationState === 'unlisted' ? undefined : post.postedAt),
              publicationState: post.publicationState,
              exportId: post.exportRef?.exportId,
              videoId: post.youtubeVideoId,
            },
          ]
        : [];
    });
  }

  private async autoChecks(project: LongProject, present: Record<string, boolean>, chapters: Partial<Record<LongLanguage, string>>) {
    const files = longPublishFiles(project);
    const media = files.filter((file) => file.kind === 'video' || file.kind === 'thumbnail' || file.kind === 'copy');
    const found = media.filter((file) => present[file.relativePath]);
    const videos = latestLongExports(project).filter(({ language }) => files.some((file) => file.language === language && file.kind === 'video' && present[file.relativePath]));
    const tracks = this.tracks(project);
    const problems = tracks.filter((track) => track.licenseStatus !== 'confirmed' || !track.allowedPlatforms.includes('youtube'));
    return longPrecheckAuto(project, {
      filesPresent: videos.length === latestLongExports(project).length && videos.length > 0 && found.length === media.length,
      fileDetail: media.length === 0 ? '書き出しファイルがまだありません' : `${found.length} / ${media.length} ファイル（MP4・サムネイル・投稿文）`,
      licenseOk: problems.length === 0,
      licenseDetail:
        tracks.length === 0
          ? '音源を使っていません'
          : problems.length === 0
            ? `${tracks.length} 曲・効果音。YouTube で使用可能（ライセンス確認済み）`
            : `確認が必要な音源：${problems.map((track) => track.title).join('、')}（ライセンス未確認、または YouTube が許可されていません）`,
      chapters,
    });
  }

  async view(projectId: string): Promise<LongPublishingView> {
    const project = await this.deps.loadProject(projectId);
    const bundle = this.sync(project);
    return this.toView(project, bundle);
  }

  private async toView(project: LongProject, bundle: PublishingBundle | null): Promise<LongPublishingView> {
    const files = longPublishFiles(project);
    const present: Record<string, boolean> = {};
    for (const file of files) {
      const absolute = this.resolve(file.relativePath);
      present[file.relativePath] = absolute ? await fs.access(absolute).then(() => true, () => false) : false;
    }
    const chapters = await this.chapters(project);
    const credits = this.credits(project);
    const copy: LongPublishingView['copy'] = {};
    for (const { language } of latestLongExports(project)) copy[language] = longYoutubeCopy(project, language, chapters[language] ?? '', credits);
    const posts = this.posts(project.id);
    return {
      workflow: bundle?.workflow ?? null,
      tasks: bundle?.tasks ?? [],
      current: bundle ? currentTask(bundle.tasks) : null,
      autoChecks: await this.autoChecks(project, present, chapters),
      recordChecks: bundle ? longRecordAuto(bundle.tasks, posts) : [],
      files,
      present,
      posts,
      copy,
      taken: this.deps.publishing.takenAll(),
      settings: this.deps.publishing.getSettings(),
      started: bundle ? publishingStarted(bundle) : false,
      available: latestLongExports(project).length > 0,
    };
  }

  private async load(projectId: string): Promise<{ project: LongProject; bundle: PublishingBundle }> {
    const project = await this.deps.loadProject(projectId);
    const bundle = this.sync(project);
    if (!bundle) throw new Error('書き出しが終わってから投稿を始められます');
    return { project, bundle };
  }

  private async finish(project: LongProject, bundle: PublishingBundle): Promise<LongPublishingView> {
    this.deps.publishing.saveBundle(bundle);
    return this.toView(project, bundle);
  }

  async start(projectId: string): Promise<LongPublishingView> {
    const { project, bundle } = await this.load(projectId);
    const now = new Date().toISOString();
    return this.finish(project, {
      ...bundle,
      workflow: { ...bundle.workflow, status: bundle.workflow.status === 'done' ? 'done' : 'in-progress', pausedForToday: false, updatedAt: now },
    });
  }

  async patch(projectId: string, taskId: string, body: TaskBody): Promise<LongPublishingView> {
    const { project, bundle } = await this.load(projectId);
    const now = new Date().toISOString();
    const tasks = (body.checklist ? applyChecklist(bundle.tasks, taskId, body.checklist, now) : bundle.tasks).map((task) =>
      task.id === taskId
        ? {
            ...task,
            urlDraft: body.url ?? task.urlDraft,
            postedAtDraft: body.postedAt ?? task.postedAtDraft,
            qa: body.qa ?? task.qa,
            status: task.status === 'ready' ? ('in-progress' as const) : task.status,
            updatedAt: now,
          }
        : task,
    );
    return this.finish(project, { ...bundle, tasks });
  }

  /** 投稿の記録を分析の Post に書く（書き出した版と結び付ける） */
  private recordPost(
    project: LongProject,
    preset: DeliveryPresetId,
    input: Omit<Parameters<AnalyticsService['upsertLongPost']>[0], 'projectId' | 'projectTitle' | 'preset' | 'lang' | 'content' | 'exportRef'> & {
      exportRef?: Parameters<AnalyticsService['upsertLongPost']>[0]['exportRef'];
    },
  ): AnalyticsPost {
    const language = longLanguageOf(preset)!;
    const latest = latestLongExports(project).find((item) => item.language === language);
    return this.deps.analytics.upsertLongPost({
      projectId: project.id,
      projectTitle: project.title,
      preset,
      lang: language,
      exportRef: input.exportRef ?? (latest ? { exportId: latest.record.exportId, basename: latest.record.basename, frozenAt: latest.record.at } : undefined),
      content: longContent(project, latest?.record.durationTicks),
      ...input,
    });
  }

  async complete(projectId: string, taskId: string, body: TaskBody): Promise<LongPublishingView> {
    const { project, bundle } = await this.load(projectId);
    const now = new Date().toISOString();
    let tasks = body.checklist ? applyChecklist(bundle.tasks, taskId, body.checklist, now) : bundle.tasks;
    if (body.qa) tasks = tasks.map((task) => (task.id === taskId ? { ...task, qa: body.qa, updatedAt: now } : task));
    let working: PublishingBundle = { ...bundle, tasks };
    const task = working.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error('タスクが見つかりません');
    if (task.type === 'pre-publish-check') {
      const view = await this.toView(project, working);
      if (!manualPrecheckReady(task, view.autoChecks)) throw new Error('確認が終わっていません');
      working = completeTask(working, taskId, now);
    } else if (task.type === 'youtube-publish') {
      const preset = task.preset as DeliveryPresetId;
      const verdict = checkYoutubeVideoUrl(body.url ?? task.urlDraft ?? '', {
        accounts: this.deps.publishing.getSettings().accounts,
        taken: this.deps.publishing.takenAll(),
        ignore: { projectId: project.id, preset },
      });
      const blocker = canCompletePublish(task, verdict);
      if (blocker || !verdict.normalizedUrl) throw new Error(blocker ?? verdict.message ?? 'URLの形式が違います');
      const postedAt = body.postedAt || task.postedAtDraft || now;
      this.recordPost(project, preset, {
        url: verdict.normalizedUrl,
        videoId: verdict.videoId,
        postedAt,
        publicationState: 'public',
        actualPublishedAt: postedAt,
        publishedAtSource: 'manual',
      });
      working = completeTask(working, taskId, now, {
        url: verdict.normalizedUrl,
        postedAt,
        warningNote: verdict.status === 'warning' ? verdict.message : undefined,
      });
    } else if (task.type === 'post-publish-verify') {
      const presets = working.tasks.filter((item) => item.type === 'youtube-publish' && item.status !== 'skipped').map((item) => item.preset ?? '');
      if (!longQaReady(task, presets, working.workflow.skipQaPresets)) throw new Error('言語ごとの確認が終わっていません');
      working = completeTask(working, taskId, now);
    } else if (task.type === 'record-complete') {
      const checks = longRecordAuto(working.tasks, this.posts(project.id));
      if (checks.some((check) => !check.ok)) throw new Error('記録がそろっていません');
      working = completeTask(working, taskId, now);
    } else {
      working = completeTask(working, taskId, now);
    }
    return this.finish(project, working);
  }

  async skip(projectId: string, taskId: string, reason?: string): Promise<LongPublishingView> {
    const { project, bundle } = await this.load(projectId);
    return this.finish(project, skipTask(bundle, taskId, reason, new Date().toISOString()));
  }

  /** 投稿をやり直す（URL の記録は分析側に残し、もう一度完了したときに上書きする） */
  async needsFix(projectId: string, publishTaskId: string): Promise<LongPublishingView> {
    const { project, bundle } = await this.load(projectId);
    const now = new Date().toISOString();
    const tasks = applyNeedsFix(bundle.tasks, publishTaskId, now);
    return this.finish(
      project,
      stampBundle({ workflow: { ...bundle.workflow, status: 'in-progress', completedAt: undefined, updatedAt: now }, tasks }, now),
    );
  }

  // -------------------------------------------------------------------------
  // YouTube 投稿（API）から

  /** 下書きに使う、その言語の最新の書き出し */
  async draftSource(projectId: string, preset: DeliveryPresetId): Promise<LongDraftSource> {
    const project = await this.deps.loadProject(projectId);
    const language = longLanguageOf(preset);
    if (!language) throw new Error('横動画のプリセットではありません');
    const latest = latestLongExports(project).find((item) => item.language === language);
    if (!latest) throw new Error('この言語の書き出しがありません。先に書き出してください');
    const files = longPublishFiles(project).filter((file) => file.language === language);
    const video = files.find((file) => file.kind === 'video');
    const videoPath = video ? this.resolve(video.relativePath) : null;
    if (!videoPath) throw new Error('書き出したMP4が見つかりません');
    const chapters = await this.readText(files.find((file) => file.kind === 'chapters')?.relativePath);
    return {
      videoPath,
      thumbnailPath: files.find((file) => file.kind === 'thumbnail')?.relativePath,
      basename: latest.record.basename,
      exportId: latest.record.exportId,
      contentStamp: latest.record.contentStamp,
      language,
      copy: longYoutubeCopy(project, language, chapters, this.credits(project)),
      content: longContent(project, latest.record.durationTicks),
      projectTitle: project.title,
    };
  }

  /** YouTube 側の公開状態を、ワークフローと分析の Post に反映する */
  async applyYoutubePublication(
    projectId: string,
    taskId: string,
    input: {
      url: string;
      videoId: string;
      exportRef: Parameters<AnalyticsService['upsertLongPost']>[0]['exportRef'];
      publicationState: NonNullable<AnalyticsPost['publicationState']>;
      postedAt?: string;
      scheduledPublishAt?: string;
      timezone?: string;
      uploadedAt?: string;
      actualPublishedAt?: string;
      publishedAtSource?: AnalyticsPost['publishedAtSource'];
      firstObservedPublicAt?: string;
      publicationConfirmedAt?: string;
      everPublished?: boolean;
      keepWithoutPublic?: boolean;
      /** 予約・公開・非公開保管のように、ワークフローを進める変化か */
      advance: boolean;
    },
  ): Promise<AnalyticsPost> {
    const project = await this.deps.loadProject(projectId);
    const bundle = this.sync(project);
    const task = bundle?.tasks.find((item) => item.id === taskId);
    const preset = task?.preset as DeliveryPresetId | undefined;
    if (!bundle || !task || !preset) throw new Error('YouTube 投稿タスクが見つかりません');
    const post = this.recordPost(project, preset, {
      url: input.url,
      videoId: input.videoId,
      postedAt: input.postedAt,
      publicationState: input.publicationState,
      scheduledPublishAt: input.scheduledPublishAt,
      timezone: input.timezone,
      uploadedAt: input.uploadedAt,
      actualPublishedAt: input.actualPublishedAt,
      publishedAtSource: input.publishedAtSource,
      firstObservedPublicAt: input.firstObservedPublicAt,
      publicationConfirmedAt: input.publicationConfirmedAt,
      everPublished: input.everPublished,
      exportRef: input.exportRef,
    });
    if (!input.advance) return post;
    const now = new Date().toISOString();
    let working = completeTask(bundle, taskId, now, { url: input.url, postedAt: input.postedAt });
    working = upsertPublicationVerify(
      working,
      working.tasks.find((item) => item.id === taskId) ?? task,
      input.publicationState === 'scheduled' ? input.scheduledPublishAt : undefined,
      now,
      () => randomUUID(),
    );
    const skipQa = new Set(working.workflow.skipQaPresets);
    if (input.keepWithoutPublic) skipQa.add(preset);
    else skipQa.delete(preset);
    working = { ...working, workflow: { ...working.workflow, skipQaPresets: [...skipQa], updatedAt: now } };
    if (input.publicationState === 'public') {
      const verify = working.tasks.find((item) => item.type === 'youtube-publication-verify' && item.preset === preset);
      if (verify && verify.status !== 'done' && verify.status !== 'skipped') working = completeTask(working, verify.id, now);
    }
    this.deps.publishing.saveBundle(working);
    return post;
  }
}

/** 分析の Post に写す横動画の特徴（公開版の詳細は書き出し時の公開版記録にある） */
const longContent = (project: LongProject, durationTicks?: number): Partial<AnalyticsPost['content']> => ({
  title: project.title,
  map: project.lineups[0]?.map ?? '',
  site: project.lineups[0]?.site ?? '',
  agent: project.lineups[0]?.agent ?? '',
  ability: project.lineups[0]?.ability ?? '',
  templateId: 'T-LONG',
  durationSec: durationTicks ? Math.round(durationTicks / 120) / 1000 : undefined,
  withBgm: project.bgm.length > 0,
  bgmTrackId: project.bgm[0]?.audioTrackId,
});

