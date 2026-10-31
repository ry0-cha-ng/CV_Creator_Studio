import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { guessBasename } from '../../../shared/export-copy';
import { publishFiles } from '../../../shared/publishing';
import type { DeliveryPresetId } from '../../../shared/delivery-presets';
import type { Project } from '../../../shared/schema/project';
import type { AnalyticsPost } from '../../../shared/schema/analytics';
import { thumbnailLayoutOf } from '../../../shared/thumbnail-focus';
import {
  DEFAULT_PUBLISH_TIMEZONE,
  MAX_UPLOAD_RETRIES,
  bindVideoInputSchema,
  publicationChangeInputSchema,
  studioConfirmInputSchema,
  youtubePublishDraftInputSchema,
  youtubePublishJobSchema,
  youtubePublishUpdateInputSchema,
  type PublicationChangeInput,
  type RemoteVideoState,
  type YoutubePublishJob,
  type YoutubePublishMetadata,
  type YoutubePublishProgress,
  type YoutubePublishView,
} from '../../../shared/schema/youtube-publish';
import {
  buildInsertResource,
  canApplySchedule,
  checkScheduleTime,
  defaultStudioChecks,
  derivePublicationState,
  fingerprintsMatch,
  healPublishMetadata,
  metadataFromProject,
  nextOperationAfterUpload,
  providedMetadataPatch,
  rawMetadataOf,
  processingSucceeded,
  redactSecrets,
  remoteFingerprint,
  retryDelayMs,
  snippetFromMetadata,
  stripInternalMarkup,
  studioEditUrl,
  threeWayConflict,
  writableStatusFromRemote,
  youtubePublicUrl,
} from '../../../shared/youtube-publish';
import type { AnalyticsService } from './analytics-service';
import type { PublishingService } from './publishing-service';
import { YoutubeApi, type ApiVideo } from './youtube-api';
import type { YoutubeAuth, SecretBox } from './youtube-auth';
import { YoutubeError } from './youtube-error';
import { YoutubePublishStore } from './youtube-publish-store';
import { ResumableUploadService } from './youtube-resumable-upload';
import type { YoutubeStore } from './youtube-store';

const writeAtomic = async (target: string, data: Buffer): Promise<void> => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, target);
};

const sha256File = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

const toRemote = (video: ApiVideo, fetchedAt: string): RemoteVideoState => {
  const state: RemoteVideoState = {
    videoId: video.id,
    channelId: video.snippet?.channelId,
    title: video.snippet?.title,
    description: video.snippet?.description,
    tags: video.snippet?.tags,
    categoryId: video.snippet?.categoryId,
    defaultLanguage: video.snippet?.defaultLanguage,
    privacyStatus: video.status?.privacyStatus,
    publishAt: video.status?.publishAt,
    embeddable: video.status?.embeddable,
    license: video.status?.license,
    publicStatsViewable: video.status?.publicStatsViewable,
    selfDeclaredMadeForKids: video.status?.selfDeclaredMadeForKids,
    madeForKids: video.status?.madeForKids,
    containsSyntheticMedia: video.status?.containsSyntheticMedia,
    uploadStatus: video.status?.uploadStatus,
    processingStatus: video.processingDetails?.processingStatus,
    snippetPublishedAt: video.snippet?.publishedAt,
    fingerprint: '',
    fetchedAt,
  };
  return { ...state, fingerprint: remoteFingerprint(state) };
};

const frozenContent = (project: Project): AnalyticsPost['content'] => ({
  title: project.title,
  map: project.lineup.map,
  site: project.lineup.site,
  side: project.lineup.side === 'attack' ? '攻め' : '守り',
  agent: project.lineup.agent,
  ability: project.lineup.ability,
  lineupCategory: project.analytics.lineupCategory,
  series: project.analytics.series || project.experiment.series,
  templateId: project.templateId,
  hookPattern: project.hookPattern,
  openingType: project.analytics.openingType,
  structureType: project.analytics.structureType,
  ctaType: project.analytics.ctaType,
  thumbnailLayout: thumbnailLayoutOf(project),
  durationSec: undefined,
  withBgm: Boolean(project.audio.bgm),
  bgmTrackId: project.audio.bgm?.audioTrackId,
});

export class YoutubePublishingService {
  private readonly sessionsPath: string;
  private readonly uploads = new Map<string, AbortController>();
  private uploadBusy = false;
  private playlistsCache?: { at: number; items: Array<{ id: string; title: string }> };
  private categoriesCache?: { at: number; items: Array<{ id: string; title: string; assignable: boolean }> };

  constructor(
    private readonly deps: {
      directory: string;
      box: SecretBox;
      analytics: AnalyticsService;
      publishing: PublishingService;
      auth: YoutubeAuth;
      youtubeStore: YoutubeStore;
      publishStore: YoutubePublishStore;
      loadProject: (id: string) => Promise<Project>;
      saveProject: (project: Project) => Promise<Project>;
      workspace: () => string | null;
      openExternal: (url: string) => Promise<void>;
      onProgress: (progress: YoutubePublishProgress) => void;
      fetch?: typeof fetch;
      now?: () => Date;
      random?: () => number;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    },
  ) {
    this.sessionsPath = path.join(deps.directory, 'youtube-upload-sessions.bin');
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private api(): YoutubeApi {
    return new YoutubeApi({ token: (force) => this.deps.auth.accessToken(force), fetch: this.deps.fetch, sleep: this.deps.sleep });
  }

  private async readSessions(): Promise<Record<string, string>> {
    if (!this.deps.box.available()) return {};
    try {
      return JSON.parse(this.deps.box.decrypt(await fs.readFile(this.sessionsPath))) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async writeSessions(sessions: Record<string, string>): Promise<void> {
    if (!this.deps.box.available()) {
      throw new YoutubeError('permission', 'このPCでは認証情報を暗号化して保存できないため、アップロードできません');
    }
    await writeAtomic(this.sessionsPath, this.deps.box.encrypt(JSON.stringify(sessions)));
  }

  private async setSession(jobId: string, url: string | undefined): Promise<void> {
    const sessions = await this.readSessions();
    if (url) sessions[jobId] = url;
    else delete sessions[jobId];
    await this.writeSessions(sessions);
  }

  private async readyMetadata(job: YoutubePublishJob): Promise<YoutubePublishMetadata> {
    const project = await this.deps.loadProject(job.projectId);
    const fromProject = metadataFromProject(project, job.preset);
    const thumb = publishFiles(project).find((file) => file.preset === job.preset && file.kind === 'thumbnail');
    const metadata = healPublishMetadata(job.metadata, {
      ...fromProject,
      thumbnailPath: thumb?.relativePath ?? fromProject.thumbnailPath,
    });
    if (!stripInternalMarkup(metadata.title)) {
      throw new YoutubeError('unknown', 'タイトルが空です。タイトルを入れてからYouTubeへ送ってください');
    }
    return metadata;
  }

  private async pushSnippetAndPlaylists(job: YoutubePublishJob): Promise<YoutubePublishJob> {
    const stored = this.deps.publishStore.job(job.id) ?? job;
    if (!stored.youtubeVideoId) return stored;
    const metadata = await this.readyMetadata(stored);
    const current = this.bump(stored, { metadata });
    await this.api().updateVideo(stored.youtubeVideoId, ['snippet'], { snippet: snippetFromMetadata(metadata) });
    await this.applyPlaylists(current);
    return this.deps.publishStore.job(stored.id) ?? current;
  }

  private async pushVideoDetails(job: YoutubePublishJob): Promise<YoutubePublishJob> {
    const withSnippet = await this.pushSnippetAndPlaylists(job);
    await this.applyThumbnail(withSnippet);
    return this.deps.publishStore.job(withSnippet.id) ?? withSnippet;
  }

  private detailError(job: YoutubePublishJob): string | undefined {
    const thumb = job.steps.find((step) => step.step === 'thumbnail' && step.status === 'failed');
    const playlists = job.steps.filter((step) => step.step === 'playlist' && step.status !== 'done' && step.status !== 'pending');
    const parts = [
      thumb?.lastError ? `サムネイルだけ失敗しました: ${thumb.lastError}` : '',
      playlists.length > 0 ? `再生リストを追加できませんでした: ${playlists.map((step) => step.lastError).filter(Boolean).join(' / ')}` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  private bump(job: YoutubePublishJob, patch: Partial<YoutubePublishJob>): YoutubePublishJob {
    const stored = this.deps.publishStore.job(job.id) ?? job;
    const { metadata, ...rest } = patch;
    const next = youtubePublishJobSchema.parse({
      ...stored,
      ...rest,
      ...(metadata ? { metadata } : {}),
      revision: stored.revision + 1,
      updatedAt: this.now().toISOString(),
    });
    this.deps.publishStore.saveJob(next);
    return next;
  }

  private async requireChannel(jobChannel?: string): Promise<{ channelId: string; title: string; handle?: string }> {
    const auth = await this.deps.auth.state();
    if (!auth.connected) throw new YoutubeError('auth', 'YouTubeに接続していません');
    if (!auth.canPublish) throw new YoutubeError('permission', '投稿権限がありません。設定から投稿を有効にして再認可してください');
    const channel = this.deps.youtubeStore.channel();
    if (!channel) throw new YoutubeError('not-found', '接続先チャンネルを確認できません。もう一度接続してください');
    if (jobChannel && jobChannel !== channel.channelId) {
      throw new YoutubeError('permission', '接続中のチャンネルがジョブの投稿先と違います。このジョブへは送信しません');
    }
    return channel;
  }

  private resolveVideoPath(project: Project, preset: DeliveryPresetId): string {
    const workspace = this.deps.workspace();
    if (!workspace) throw new YoutubeError('unknown', '保存先フォルダが選択されていません');
    const file = publishFiles(project).find((item) => item.preset === preset && item.kind === 'video');
    if (!file) throw new YoutubeError('not-found', '書き出したMP4が見つかりません');
    return path.resolve(workspace, file.relativePath);
  }

  async view(projectId: string, taskId: string): Promise<YoutubePublishView> {
    const auth = await this.deps.auth.state();
    const channel = this.deps.youtubeStore.channel();
    const job = this.deps.publishStore.jobForTask(taskId);
    return {
      job: job ?? null,
      canPublish: auth.canPublish,
      channel: channel ? { channelId: channel.channelId, title: channel.title, handle: channel.handle } : undefined,
      categories: this.categoriesCache?.items ?? [],
      playlists: this.playlistsCache?.items ?? [],
    };
  }

  async listPlaylists(): Promise<Array<{ id: string; title: string }>> {
    await this.requireChannel();
    if (this.playlistsCache && this.now().getTime() - this.playlistsCache.at < 10 * 60 * 1000) return this.playlistsCache.items;
    const api = this.api();
    const items: Array<{ id: string; title: string }> = [];
    let page: string | undefined;
    do {
      const pageResult = await api.playlists(page);
      items.push(...pageResult.items);
      page = pageResult.nextPageToken;
    } while (page);
    this.playlistsCache = { at: this.now().getTime(), items };
    return items;
  }

  async listCategories(): Promise<Array<{ id: string; title: string; assignable: boolean }>> {
    await this.requireChannel();
    if (this.categoriesCache && this.now().getTime() - this.categoriesCache.at < 24 * 60 * 60 * 1000) {
      return this.categoriesCache.items;
    }
    const items = (await this.api().videoCategories('JP')).filter((item) => item.assignable);
    this.categoriesCache = { at: this.now().getTime(), items };
    return items;
  }

  async createDraft(input: unknown): Promise<YoutubePublishView> {
    const body = youtubePublishDraftInputSchema.parse(input);
    const metadataPatch = providedMetadataPatch(rawMetadataOf(input), body.metadata);
    const channel = await this.requireChannel();
    const project = await this.deps.loadProject(body.projectId);
    const existing = this.deps.publishStore.jobForTask(body.taskId);
    if (existing && existing.operationState !== 'draft') {
      return this.view(body.projectId, body.taskId);
    }
    const videoPath = this.resolveVideoPath(project, body.preset);
    const stat = await fs.stat(videoPath);
    const presetMeta = this.deps.publishStore.presetForDelivery(body.preset)?.metadata;
    const metadata = {
      ...metadataFromProject(project, body.preset, presetMeta),
      ...metadataPatch,
    };
    const thumb = publishFiles(project).find((file) => file.preset === body.preset && file.kind === 'thumbnail');
    const now = this.now().toISOString();
    const basename = guessBasename(project, body.preset);
    const exportId = `${project.id}:${body.preset}:${basename}:${stat.size}:${stat.mtimeMs}`;
    const job = youtubePublishJobSchema.parse({
      id: existing?.id ?? randomUUID(),
      revision: existing ? existing.revision + 1 : 0,
      workflowTaskId: body.taskId,
      projectId: project.id,
      exportId,
      channelId: channel.channelId,
      preset: body.preset,
      contentType: 'SHORTS',
      contentTypeSource: 'production',
      file: { path: videoPath, size: stat.size, mtimeMs: stat.mtimeMs, sha256: existing?.file.sha256 ?? '' },
      exportRef: {
        exportId,
        projectId: project.id,
        preset: body.preset,
        basename,
        frozenAt: now,
        contentStamp: project.guide.lastExport?.contentStamp,
      },
      metadata: { ...metadata, thumbnailPath: thumb?.relativePath },
      desiredPublishAt: body.desiredPublishAt,
      timezone: body.timezone ?? DEFAULT_PUBLISH_TIMEZONE,
      operationState: 'draft',
      publicationState: 'not_uploaded',
      studioChecks: defaultStudioChecks(metadata),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.deps.publishStore.saveJob(job);
    return this.view(body.projectId, body.taskId);
  }

  async updateDraft(input: unknown): Promise<YoutubePublishView> {
    const body = youtubePublishUpdateInputSchema.parse(input);
    const patch = providedMetadataPatch(rawMetadataOf(input), body.metadata);
    const job = this.requireJob(body.jobId, body.revision);
    if (job.operationState !== 'draft' && job.youtubeVideoId) {
      const metadata = { ...job.metadata, ...patch };
      const saved = this.bump(job, {
        metadata,
        metadataRevision: job.metadataRevision + 1,
        desiredPublishAt: body.desiredPublishAt === null ? undefined : (body.desiredPublishAt ?? job.desiredPublishAt),
        timezone: body.timezone ?? job.timezone,
        studioChecks: defaultStudioChecks(metadata).map((item) => {
          const previous = job.studioChecks.find((check) => check.key === item.key);
          return previous && previous.status !== 'unchecked' ? { ...item, ...previous, label: item.label, required: item.required } : item;
        }),
      });
      const touchesYouTube = Boolean(
        patch &&
          (patch.title !== undefined ||
            patch.description !== undefined ||
            patch.tags !== undefined ||
            patch.categoryId !== undefined ||
            patch.defaultLanguage !== undefined ||
            patch.playlistIds !== undefined),
      );
      if (touchesYouTube) await this.pushSnippetAndPlaylists(saved);
      return this.view(saved.projectId, saved.workflowTaskId ?? '');
    }
    if (job.operationState !== 'draft') {
      throw new YoutubeError('unknown', '転送開始後は書き出しファイルとチャンネルを変更できません');
    }
    const metadata = { ...job.metadata, ...patch };
    const next = this.bump(job, {
      metadata,
      desiredPublishAt: body.desiredPublishAt === null ? undefined : (body.desiredPublishAt ?? job.desiredPublishAt),
      timezone: body.timezone ?? job.timezone,
      studioChecks: defaultStudioChecks(metadata),
    });
    return this.view(next.projectId, next.workflowTaskId ?? '');
  }

  async startUpload(jobId: string, revision: number): Promise<YoutubePublishView> {
    const job = this.requireJob(jobId, revision);
    await this.requireChannel(job.channelId);
    if (job.youtubeVideoId) throw new YoutubeError('unknown', 'このジョブは既に動画IDがあります。本体を再転送しません');
    if (this.uploadBusy || this.uploads.has(jobId)) throw new YoutubeError('unknown', '別のアップロードが進行中です');
    if (job.operationState === 'outcome_unknown') {
      throw new YoutubeError('unknown', '結果不明です。新規アップロードは自動で始めません。Studioで確認するか動画IDを紐付けてください');
    }
    const controller = new AbortController();
    this.uploads.set(jobId, controller);
    void this.runUpload(job, controller.signal);
    return this.view(job.projectId, job.workflowTaskId ?? '');
  }

  async pauseUpload(jobId: string): Promise<YoutubePublishView> {
    this.uploads.get(jobId)?.abort();
    const job = this.deps.publishStore.job(jobId);
    if (job && job.operationState === 'uploading') this.bump(job, { operationState: 'paused' });
    return job ? this.view(job.projectId, job.workflowTaskId ?? '') : { job: null, canPublish: false, categories: [], playlists: [] };
  }

  async resumeUpload(jobId: string, revision: number): Promise<YoutubePublishView> {
    const job = this.requireJob(jobId, revision);
    if (job.youtubeVideoId) throw new YoutubeError('unknown', '動画ID取得後は本体を再転送しません');
    return this.startUpload(jobId, revision);
  }

  /** 人が選んだときだけ、今の動画を残したまま新しい非公開動画として送り直す。 */
  async reupload(jobId: string, revision: number): Promise<YoutubePublishView> {
    const job = this.requireJob(jobId, revision);
    await this.requireChannel(job.channelId);
    if (this.uploads.has(jobId) || job.operationState === 'uploading') {
      throw new YoutubeError('unknown', '転送中はやり直せません。先に中断してください');
    }
    if (job.operationState === 'outcome_unknown') {
      throw new YoutubeError('unknown', '結果が不明です。Studioで動画の有無を確認し、動画IDを紐付けるまで新しい動画は作りません');
    }
    const project = await this.deps.loadProject(job.projectId);
    const videoPath = this.resolveVideoPath(project, job.preset);
    const stat = await fs.stat(videoPath);
    const thumb = publishFiles(project).find((file) => file.preset === job.preset && file.kind === 'thumbnail');
    const metadata = await this.readyMetadata({
      ...job,
      metadata: { ...job.metadata, thumbnailPath: thumb?.relativePath ?? job.metadata.thumbnailPath },
    });
    const now = this.now().toISOString();
    const basename = guessBasename(project, job.preset);
    const exportId = `${project.id}:${job.preset}:${basename}:${stat.size}:${stat.mtimeMs}`;
    await this.setSession(job.id, undefined);
    const reset = this.bump(job, {
      exportId,
      file: { path: videoPath, size: stat.size, mtimeMs: stat.mtimeMs, sha256: '' },
      exportRef: {
        ...job.exportRef,
        exportId,
        basename,
        frozenAt: now,
        contentStamp: project.guide.lastExport?.contentStamp,
      },
      metadata,
      youtubeVideoId: undefined,
      operationState: 'draft',
      publicationState: 'not_uploaded',
      lastRemoteState: undefined,
      lastCheckedAt: undefined,
      everPublished: false,
      uploadedAt: undefined,
      scheduledPublishAt: undefined,
      firstObservedPublicAt: undefined,
      actualPublishedAt: undefined,
      publishedAtSource: undefined,
      publicationConfirmedAt: undefined,
      postId: undefined,
      upload: undefined,
      steps: [],
      studioChecks: defaultStudioChecks(metadata),
      lastError: undefined,
      lastErrorKind: undefined,
      history: [
        ...job.history,
        {
          id: randomUUID(),
          at: now,
          action: 'reupload',
          source: 'app',
          oldValue: job.youtubeVideoId,
          newValue: '新しい非公開動画',
        },
      ],
    });
    return this.startUpload(reset.id, reset.revision);
  }

  async retryStep(jobId: string, revision: number, step: 'thumbnail' | 'playlist'): Promise<YoutubePublishView> {
    const job = this.requireJob(jobId, revision);
    await this.requireChannel(job.channelId);
    if (!job.youtubeVideoId) throw new YoutubeError('unknown', '動画IDがありません');
    if (step === 'thumbnail') await this.applyThumbnail(job);
    if (step === 'playlist') await this.applyPlaylists(job);
    const latest = this.deps.publishStore.job(jobId) ?? job;
    return this.view(latest.projectId, latest.workflowTaskId ?? '');
  }

  async openStudio(jobId: string): Promise<{ url: string }> {
    const job = this.deps.publishStore.job(jobId);
    if (!job?.youtubeVideoId) throw new YoutubeError('not-found', 'Studioを開く動画IDがありません');
    const url = studioEditUrl(job.youtubeVideoId);
    await this.deps.openExternal(url);
    return { url };
  }

  async confirmStudioItem(input: unknown): Promise<YoutubePublishView> {
    const body = studioConfirmInputSchema.parse(input);
    const job = this.requireJob(body.jobId, body.revision);
    const studioChecks = job.studioChecks.map((item) =>
      item.key === body.key
        ? {
            ...item,
            status: body.status,
            method: 'manual' as const,
            confirmedAt: this.now().toISOString(),
            targetRevision: job.revision,
            reason: body.reason ?? item.reason,
          }
        : item,
    );
    const next = this.bump(job, {
      studioChecks,
      operationState: nextOperationAfterUpload({ ...job, studioChecks }),
    });
    return this.view(next.projectId, next.workflowTaskId ?? '');
  }

  async refreshRemoteState(jobId: string): Promise<YoutubePublishView> {
    const job = this.deps.publishStore.job(jobId);
    if (!job) throw new YoutubeError('not-found', 'ジョブが見つかりません');
    await this.requireChannel(job.channelId);
    if (!job.youtubeVideoId) return this.view(job.projectId, job.workflowTaskId ?? '');
    const video = await this.api().video(job.youtubeVideoId);
    if (!video) {
      this.bump(job, { publicationState: 'unavailable', lastCheckedAt: this.now().toISOString(), lastError: '動画を取得できません。権限またはチャンネルを確認してください' });
      return this.view(job.projectId, job.workflowTaskId ?? '');
    }
    if (video.snippet?.channelId && video.snippet.channelId !== job.channelId) {
      throw new YoutubeError('permission', '取得した動画のチャンネルが投稿先と一致しません');
    }
    const remote = toRemote(video, this.now().toISOString());
    const publicationState = derivePublicationState(remote, this.now());
    const everPublished = job.everPublished || publicationState === 'public';
    const actualPublishedAt =
      publicationState === 'public'
        ? job.actualPublishedAt ?? (this.publicTime(remote) ?? this.now().toISOString())
        : job.actualPublishedAt;
    const next = this.bump(job, {
      lastRemoteState: remote,
      lastCheckedAt: remote.fetchedAt,
      publicationState,
      everPublished,
      scheduledPublishAt: publicationState === 'scheduled' ? remote.publishAt : publicationState === 'public' ? undefined : job.scheduledPublishAt,
      firstObservedPublicAt: publicationState === 'public' ? job.firstObservedPublicAt ?? this.now().toISOString() : job.firstObservedPublicAt,
      actualPublishedAt,
      publishedAtSource: publicationState === 'public' ? job.publishedAtSource ?? (this.publicTime(remote) ? 'api-public' : 'first-observed') : job.publishedAtSource,
      publicationConfirmedAt: publicationState === 'public' ? job.publicationConfirmedAt ?? this.now().toISOString() : job.publicationConfirmedAt,
      operationState: publicationState === 'public' ? 'idle' : job.operationState === 'verifying' && publicationState === 'scheduled' ? 'idle' : job.operationState,
    });
    await this.syncAnalyticsAndWorkflow(next);
    return this.view(next.projectId, next.workflowTaskId ?? '');
  }

  async previewPublicationChange(input: unknown): Promise<YoutubePublishView> {
    const body = publicationChangeInputSchema.parse(input);
    const job = this.requireJob(body.jobId, body.revision);
    const refreshed = await this.refreshRemoteState(job.id);
    const latest = refreshed.job;
    if (!latest) return refreshed;
    if (latest.lastRemoteState && latest.lastRemoteState.fingerprint !== body.remoteFingerprint) {
      const diffs = threeWayConflict(job.lastRemoteState, latest.lastRemoteState, {
        title: latest.metadata.title,
        description: latest.metadata.description,
        tags: latest.metadata.tags,
        desiredPublishAt: latest.desiredPublishAt,
      });
      return {
        ...refreshed,
        conflict: {
          code: 'conflict',
          message: diffs.length > 0 ? 'YouTube側の状態が確認画面の表示時から変わっています' : '最新状態を再確認してください',
          baseline: job.lastRemoteState,
          remote: latest.lastRemoteState,
          local: { title: latest.metadata.title, desiredPublishAt: latest.desiredPublishAt },
        },
      };
    }
    return refreshed;
  }

  async applyPublicationChange(input: unknown): Promise<YoutubePublishView> {
    const body = publicationChangeInputSchema.parse(input);
    const preview = await this.previewPublicationChange(body);
    if (preview.conflict) return preview;
    const job = preview.job;
    if (!job?.youtubeVideoId || !job.lastRemoteState) throw new YoutubeError('unknown', '最新状態を取得できませんでした');
    await this.requireChannel(job.channelId);
    const now = this.now();
    if (job.lastRemoteState.privacyStatus === 'public' && (body.action === 'schedule' || body.action === 'reschedule')) {
      throw new YoutubeError('unknown', 'すでに公開されています。再予約はしません');
    }
    if (body.action === 'schedule' || body.action === 'reschedule') {
      const ready = canApplySchedule({ ...job, desiredPublishAt: body.publishAt ?? job.desiredPublishAt }, now);
      if (!ready.ok) throw new YoutubeError('unknown', ready.reason);
    }
    const detailed = await this.pushVideoDetails(job);
    if (body.action === 'cancelSchedule' && job.lastRemoteState.privacyStatus === 'public') {
      const next = this.bump(job, {
        publicationState: 'public',
        everPublished: true,
        lastError: '予約は既に実行済みです。自動では非公開にしません',
        operationState: 'idle',
      });
      await this.syncAnalyticsAndWorkflow(next);
      return this.view(next.projectId, next.workflowTaskId ?? '');
    }
    const patch = this.statusPatch(detailed, body, now);
    const updated = await this.api().updateVideo(detailed.youtubeVideoId!, ['status'], { status: patch });
    const remote = toRemote(updated, now.toISOString());
    const listed = (await this.api().video(job.youtubeVideoId)) ?? updated;
    const confirmed = toRemote(listed, now.toISOString());
    const publicationState = derivePublicationState(confirmed, now);
    const expected = body.action === 'cancelSchedule' ? 'private' : body.action === 'public' ? 'public' : body.action === 'unlisted' ? 'unlisted' : 'scheduled';
    const operationState = publicationState === expected ? 'idle' : 'verifying';
    const detailError = this.detailError(detailed);
    const next = this.bump(detailed, {
      lastRemoteState: confirmed,
      lastCheckedAt: confirmed.fetchedAt,
      publicationState,
      scheduledPublishAt: publicationState === 'scheduled' ? confirmed.publishAt : undefined,
      desiredPublishAt: body.publishAt ?? job.desiredPublishAt,
      timezone: body.timezone ?? job.timezone,
      everPublished: job.everPublished || publicationState === 'public',
      actualPublishedAt: publicationState === 'public' ? job.actualPublishedAt ?? this.publicTime(confirmed) ?? now.toISOString() : job.actualPublishedAt,
      publishedAtSource: publicationState === 'public' ? 'api-public' : job.publishedAtSource,
      publicationConfirmedAt: publicationState === 'public' ? now.toISOString() : job.publicationConfirmedAt,
      firstObservedPublicAt: publicationState === 'public' ? job.firstObservedPublicAt ?? now.toISOString() : job.firstObservedPublicAt,
      operationState,
      lastError: operationState === 'verifying' ? '予約登録の結果確認中です。同じ書き込みを再送せず、先に再取得します' : detailError,
      history: [
        ...detailed.history,
        {
          id: randomUUID(),
          at: now.toISOString(),
          action: body.action,
          source: 'app' as const,
          oldValue: job.lastRemoteState.publishAt ?? job.lastRemoteState.privacyStatus,
          newValue: confirmed.publishAt ?? confirmed.privacyStatus,
        },
      ],
    });
    await this.syncAnalyticsAndWorkflow(next, body.action);
    return this.view(next.projectId, next.workflowTaskId ?? '');
  }

  async bindManualVideo(input: unknown): Promise<YoutubePublishView> {
    const body = bindVideoInputSchema.parse(input);
    const job = this.requireJob(body.jobId, body.revision);
    await this.requireChannel(job.channelId);
    const video = await this.api().video(body.videoId);
    if (!video) throw new YoutubeError('not-found', 'その動画IDは見つかりません');
    if (video.snippet?.channelId !== job.channelId) {
      throw new YoutubeError('permission', '対象チャンネルの動画ではありません');
    }
    const remote = toRemote(video, this.now().toISOString());
    const next = this.bump(job, {
      youtubeVideoId: video.id,
      lastRemoteState: remote,
      lastCheckedAt: remote.fetchedAt,
      publicationState: derivePublicationState(remote, this.now()),
      uploadedAt: job.uploadedAt ?? this.now().toISOString(),
      operationState: nextOperationAfterUpload(job),
      lastError: undefined,
    });
    await this.setSession(job.id, undefined);
    return this.view(next.projectId, next.workflowTaskId ?? '');
  }

  async bindPreview(jobId: string, videoId: string): Promise<YoutubePublishView> {
    const job = this.deps.publishStore.job(jobId);
    if (!job) throw new YoutubeError('not-found', 'ジョブが見つかりません');
    await this.requireChannel(job.channelId);
    const video = await this.api().video(videoId);
    if (!video) throw new YoutubeError('not-found', 'その動画IDは見つかりません');
    const view = await this.view(job.projectId, job.workflowTaskId ?? '');
    return {
      ...view,
      bindCandidate: {
        videoId: video.id,
        title: video.snippet?.title ?? '',
        channelId: video.snippet?.channelId ?? '',
        privacyStatus: video.status?.privacyStatus,
      },
    };
  }

  async reconcilePendingJobs(): Promise<void> {
    const auth = await this.deps.auth.state();
    if (!auth.connected || !auth.canPublish || auth.needsReauth) return;
    for (const job of this.deps.publishStore.pendingJobs()) {
      try {
        if (job.youtubeVideoId) await this.refreshRemoteState(job.id);
      } catch {
        // 起動時の追いつき。1件の失敗で止めない。
      }
    }
  }

  private requireJob(jobId: string, revision: number): YoutubePublishJob {
    const job = this.deps.publishStore.job(jobId);
    if (!job) throw new YoutubeError('not-found', 'ジョブが見つかりません');
    if (job.revision !== revision) throw new YoutubeError('unknown', '他の画面でジョブが更新されています。最新を再読み込みしてください');
    return job;
  }

  private publicTime(remote: RemoteVideoState): string | undefined {
    if (remote.privacyStatus !== 'public') return undefined;
    return remote.publishAt || undefined;
  }

  private statusPatch(job: YoutubePublishJob, body: PublicationChangeInput, now: Date): Record<string, unknown> {
    if (body.action === 'schedule' || body.action === 'reschedule') {
      const utc = body.publishAt ?? job.desiredPublishAt;
      if (!utc) throw new YoutubeError('unknown', '予約日時がありません');
      const time = checkScheduleTime(utc, now);
      if (!time.ok) throw new YoutubeError('unknown', time.reason);
      const pending = canApplySchedule({ ...job, desiredPublishAt: time.utc }, now);
      if (!pending.ok) throw new YoutubeError('unknown', pending.reason);
      return writableStatusFromRemote(job.lastRemoteState, { privacyStatus: 'private', publishAt: time.utc });
    }
    if (body.action === 'cancelSchedule' || body.action === 'private') {
      return writableStatusFromRemote(job.lastRemoteState, { privacyStatus: 'private' });
    }
    if (body.action === 'unlisted') return writableStatusFromRemote(job.lastRemoteState, { privacyStatus: 'unlisted' });
    return writableStatusFromRemote(job.lastRemoteState, { privacyStatus: 'public' });
  }

  private async runUpload(job: YoutubePublishJob, signal: AbortSignal): Promise<void> {
    this.uploadBusy = true;
    try {
      const started = this.bump(job, { operationState: 'uploading', lastError: undefined });
      const metadata = await this.readyMetadata(started);
      const latest = this.bump(started, { metadata });
      const stat = await fs.stat(latest.file.path);
      this.deps.onProgress({ jobId: latest.id, stage: 'hash', sentBytes: 0, totalBytes: stat.size });
      const sha256 = await sha256File(latest.file.path);
      const actual = { path: latest.file.path, size: stat.size, mtimeMs: stat.mtimeMs, sha256 };
      if (latest.file.sha256 && !fingerprintsMatch({ ...latest.file, sha256: latest.file.sha256 }, actual)) {
        this.bump(latest, { operationState: 'action_required', lastError: '書き出しファイルが変わっています。このジョブでは再開できません', lastErrorKind: 'file-changed' });
        return;
      }
      const hashed = this.bump(latest, { file: actual });
      const sessions = await this.readSessions();
      let sessionUrl: string | undefined = sessions[hashed.id];
      const uploader = new ResumableUploadService({
        token: (force) => this.deps.auth.accessToken(force),
        fetch: this.deps.fetch,
        onProgress: (sent, total) => this.deps.onProgress({ jobId: hashed.id, stage: 'upload', sentBytes: sent, totalBytes: total }),
      });
      let start = hashed.upload?.serverReceivedBytes ?? 0;
      if (sessionUrl) {
        try {
          const offset = await uploader.queryOffset(sessionUrl, actual.size, signal);
          if (offset === 'unknown') {
            this.bump(hashed, { operationState: 'outcome_unknown', lastError: '最終応答を確認できません。新規アップロードは自動で始めません' });
            return;
          }
          start = offset;
        } catch (error) {
          if (error instanceof YoutubeError && error.kind === 'not-found') {
            sessionUrl = undefined;
            start = 0;
          } else {
            throw error;
          }
        }
      }
      if (!sessionUrl) {
        this.deps.onProgress({ jobId: hashed.id, stage: 'session', sentBytes: 0, totalBytes: actual.size });
        sessionUrl = await this.api().startResumableSession(buildInsertResource(hashed.metadata), 'video/mp4', actual.size, signal);
        await this.setSession(hashed.id, sessionUrl);
      }
      let attempt = hashed.upload?.attempt ?? 0;
      while (attempt <= MAX_UPLOAD_RETRIES) {
        try {
          const outcome = await uploader.upload({ sessionUrl, filePath: actual.path, total: actual.size, start, signal });
          if (outcome.kind === 'paused') {
            this.bump(hashed, { operationState: 'paused', upload: { totalBytes: actual.size, serverReceivedBytes: outcome.received, lastCheckedAt: this.now().toISOString(), attempt } });
            return;
          }
          if (outcome.kind === 'unknown') {
            this.bump(hashed, { operationState: 'outcome_unknown', lastError: '最終チャンク送信後の結果が不明です。セッション照会またはStudio確認が必要です' });
            return;
          }
          if (outcome.kind === 'complete') {
            await this.setSession(hashed.id, undefined);
            const withId = this.bump(hashed, {
              youtubeVideoId: outcome.videoId,
              uploadedAt: this.now().toISOString(),
              publicationState: 'private',
              operationState: 'processing',
              upload: { totalBytes: actual.size, serverReceivedBytes: actual.size, lastCheckedAt: this.now().toISOString(), attempt },
              steps: [{ step: 'insert', status: 'done', appliedAt: this.now().toISOString(), attempts: 1 }],
            });
            await this.afterVideoId(withId);
            return;
          }
          start = outcome.received;
        } catch (error) {
          const failure = error instanceof YoutubeError ? error : new YoutubeError('unknown', redactSecrets(String(error)));
          if (!failure.retryable || attempt >= MAX_UPLOAD_RETRIES) {
            this.bump(hashed, { operationState: 'action_required', lastError: redactSecrets(failure.message), lastErrorKind: failure.kind });
            return;
          }
          attempt += 1;
          const wait = retryDelayMs(attempt, this.deps.random?.() ?? Math.random(), undefined);
          this.bump(hashed, {
            operationState: 'uploading',
            upload: { totalBytes: actual.size, serverReceivedBytes: start, lastCheckedAt: this.now().toISOString(), nextRetryAt: new Date(this.now().getTime() + wait).toISOString(), attempt },
            lastError: redactSecrets(failure.message),
            lastErrorKind: failure.kind,
          });
          await (this.deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(wait, signal);
        }
      }
    } catch (error) {
      const failure = error instanceof YoutubeError ? error : new YoutubeError('unknown', redactSecrets(String(error)));
      const current = this.deps.publishStore.job(job.id) ?? job;
      this.bump(current, { operationState: 'action_required', lastError: redactSecrets(failure.message), lastErrorKind: failure.kind });
    } finally {
      this.uploads.delete(job.id);
      this.uploadBusy = false;
    }
  }

  private async afterVideoId(job: YoutubePublishJob): Promise<void> {
    if (!job.youtubeVideoId) return;
    this.deps.onProgress({ jobId: job.id, stage: 'processing', sentBytes: job.file.size, totalBytes: job.file.size });
    let current = job;
    for (let i = 0; i < 8; i += 1) {
      const video = await this.api().video(job.youtubeVideoId);
      if (video) {
        const remote = toRemote(video, this.now().toISOString());
        current = this.bump(current, { lastRemoteState: remote, lastCheckedAt: remote.fetchedAt, publicationState: derivePublicationState(remote, this.now()) });
        if (processingSucceeded(remote) || i === 7) break;
      }
      await (this.deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(1500);
    }
    this.deps.onProgress({ jobId: job.id, stage: 'metadata', sentBytes: job.file.size, totalBytes: job.file.size });
    current = this.bump(this.deps.publishStore.job(job.id) ?? current, { operationState: 'setting_metadata' });
    current = await this.pushVideoDetails(current);
    const operationState = nextOperationAfterUpload(current);
    current = this.bump(current, { operationState, lastError: this.detailError(current) });
    this.deps.onProgress({ jobId: job.id, stage: 'done', sentBytes: job.file.size, totalBytes: job.file.size });
    await this.syncAnalyticsAndWorkflow(current);
  }

  private async applyThumbnail(job: YoutubePublishJob): Promise<void> {
    if (!job.youtubeVideoId) return;
    if (job.metadata.contentKind !== 'video') return;
    const workspace = this.deps.workspace();
    if (!workspace || !job.metadata.thumbnailPath) return;
    const file = path.resolve(workspace, job.metadata.thumbnailPath);
    try {
      const image = await fs.readFile(file);
      const ext = path.extname(file).toLowerCase();
      const type = ext === '.png' ? 'image/png' : 'image/jpeg';
      await this.api().setThumbnail(job.youtubeVideoId, image, type);
      const steps = job.steps.filter((step) => step.step !== 'thumbnail').concat([{ step: 'thumbnail', status: 'done', appliedAt: this.now().toISOString(), attempts: 1 }]);
      this.bump(job, { steps });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      const steps = job.steps.filter((step) => step.step !== 'thumbnail').concat([{ step: 'thumbnail', status: 'failed', lastError: message, attempts: 1 }]);
      this.bump(job, { steps });
    }
  }

  private async applyPlaylists(job: YoutubePublishJob): Promise<void> {
    if (!job.youtubeVideoId) return;
    const api = this.api();
    const steps = job.steps.filter((step) => step.step !== 'playlist');
    for (const playlistId of job.metadata.playlistIds) {
      try {
        const exists = await api.playlistHasVideo(playlistId, job.youtubeVideoId);
        if (!exists) await api.insertPlaylistItem(playlistId, job.youtubeVideoId);
        steps.push({ step: 'playlist', targetId: playlistId, status: 'done', appliedAt: this.now().toISOString(), attempts: 1 });
      } catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : String(error));
        try {
          if (await api.playlistHasVideo(playlistId, job.youtubeVideoId)) {
            steps.push({ step: 'playlist', targetId: playlistId, status: 'done', appliedAt: this.now().toISOString(), attempts: 1 });
            continue;
          }
        } catch {
          // 照合も失敗したら部分失敗として残す。
        }
        steps.push({ step: 'playlist', targetId: playlistId, status: 'unknown', lastError: message, attempts: 1 });
      }
    }
    this.bump(job, { steps: [...job.steps.filter((step) => step.step !== 'playlist'), ...steps.filter((step) => step.step === 'playlist')] });
  }

  private async syncAnalyticsAndWorkflow(job: YoutubePublishJob, action?: PublicationChangeInput['action']): Promise<void> {
    if (!job.youtubeVideoId || !job.workflowTaskId) return;
    const project = await this.deps.loadProject(job.projectId);
    const kind = job.metadata.contentKind === 'shorts' ? 'shorts' : job.metadata.contentKind === 'video' ? 'video' : 'unknown';
    const url = youtubePublicUrl(job.youtubeVideoId, kind);
    const post = this.deps.analytics.upsertFromPublishJob({
      project,
      preset: job.preset,
      videoId: job.youtubeVideoId,
      url,
      publicationState: job.publicationState === 'not_uploaded' ? 'private' : job.publicationState === 'unknown' ? 'private' : job.publicationState === 'unavailable' ? 'private' : job.publicationState,
      scheduledPublishAt: job.scheduledPublishAt,
      timezone: job.timezone,
      uploadedAt: job.uploadedAt,
      actualPublishedAt: job.actualPublishedAt,
      publishedAtSource: job.publishedAtSource,
      firstObservedPublicAt: job.firstObservedPublicAt,
      publicationConfirmedAt: job.publicationConfirmedAt,
      everPublished: job.everPublished,
      exportRef: { exportId: job.exportRef.exportId, basename: job.exportRef.basename, sha256: job.file.sha256, frozenAt: job.exportRef.frozenAt },
      content: frozenContent(project),
    });
    this.bump(job, { postId: post.id });
    const keep = action === 'private' || action === 'unlisted';
    const scheduled = action === 'schedule' || action === 'reschedule' || job.publicationState === 'scheduled';
    const isPublic = job.publicationState === 'public';
    if (action === 'schedule' || action === 'reschedule' || action === 'cancelSchedule' || keep || isPublic) {
      const publicationState = isPublic
        ? 'public'
        : action === 'unlisted' || job.publicationState === 'unlisted'
          ? 'unlisted'
          : scheduled && job.publicationState === 'scheduled'
            ? 'scheduled'
            : 'private';
      const result = await this.deps.publishing.applyYoutubePublication(project, job.workflowTaskId, {
        url,
        postedAt: isPublic ? job.actualPublishedAt : '',
        publicationState,
        scheduledPublishAt: job.scheduledPublishAt,
        timezone: job.timezone,
        keepWithoutPublic: keep && !isPublic,
      });
      if (isPublic) {
        const verified = await this.deps.publishing.completePublicationVerify(result.project, job.preset);
        await this.deps.saveProject(verified.project);
        return;
      }
      await this.deps.saveProject(result.project);
    }
  }
}
