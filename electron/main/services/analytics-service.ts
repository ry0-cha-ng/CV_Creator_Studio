import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { guessBasename } from '../../../shared/export-copy';
import { likeCtaActive, resolveLikeCtaText } from '../../../shared/s4-cta';
import {
  analyticsCsv,
  applyAdoptedInsights,
  decisionFromAction,
  dueAtFor7d,
  emptyDraft,
  promoteTaskStatus,
  secondaryChanges,
  weekKey,
} from '../../../shared/analytics';
import {
  analysisTaskSchema,
  analyticsBundleSchema,
  analyticsPostSchema,
  decisionSchema,
  experimentConclusionSchema,
  experimentSchemaV7,
  insightEventSchema,
  insightSchema,
  insightStatusSchema,
  metricSnapshotSchema,
  type AgeBucket,
  type AnalysisTask,
  type AnalyticsBundle,
  type AnalyticsExperiment,
  type AnalyticsPost,
  type Decision,
  type Insight,
  type MetricSnapshot,
} from '../../../shared/schema/analytics';
import type { Project } from '../../../shared/schema/project';
import { youtubeVideoSchema, type YoutubeVideo } from '../../../shared/schema/youtube';
import { youtubeVideoIdFromUrl } from '../../../shared/post-url';
import { activeTimeline } from '../../../shared/timeline';
import { runStudioMigrations } from './studio-db-migrations';

type Row = { id: string; data: string };

const apiFieldsOf = (video: YoutubeVideo | undefined): Partial<AnalyticsPost> =>
  video
    ? {
        channelId: video.channelId,
        apiPublishedAt: video.publishedAt,
        contentType: video.contentType,
        contentTypeSource: video.contentTypeSource,
      }
    : {};

const importedUrl = (video: YoutubeVideo): string =>
  video.contentType === 'SHORTS'
    ? `https://youtube.com/shorts/${video.videoId}`
    : `https://youtube.com/watch?v=${video.videoId}`;

const snapshotSignature = (snapshot: MetricSnapshot): string =>
  JSON.stringify({
    views: snapshot.views,
    likes: snapshot.likes,
    shares: snapshot.shares,
    saves: snapshot.saves,
    subscribersGained: snapshot.subscribersGained,
    averagePercentageViewed: snapshot.averagePercentageViewed,
    clutchVaultVisits: snapshot.clutchVaultVisits,
    lineupSaves: snapshot.lineupSaves,
    deckAdds: snapshot.deckAdds,
    signups: snapshot.signups,
    viewedVsSwipedAway: snapshot.viewedVsSwipedAway,
    completionRate: snapshot.completionRate,
    averageViewDurationSec: snapshot.averageViewDurationSec,
    comments: snapshot.comments,
    watchTimeMinutes: snapshot.watchTimeMinutes,
    followersGained: snapshot.followersGained,
  });

const fromLogMetrics = (metrics: NonNullable<Project['posts'][number]['metrics']>): Partial<MetricSnapshot> => ({
  views: metrics.views,
  likes: metrics.likes,
  shares: metrics.shares,
  saves: metrics.saves,
  subscribersGained: metrics.subscribersGained,
  averagePercentageViewed: metrics.avgViewPct,
  lineupSaves: metrics.cvSaves,
  profileViews: metrics.profileVisits,
  outboundVideoClicks: metrics.linkClicks,
});

export class AnalyticsService {
  private database: DatabaseSync | null = null;

  constructor(private readonly getWorkspace: () => string | null) {}

  initialize(): void {
    const workspace = this.getWorkspace();
    if (!workspace) return;
    this.database?.close();
    this.database = new DatabaseSync(path.join(workspace, 'studio.db'));
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS analytics_posts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        preset TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS analytics_posts_key ON analytics_posts(project_id, preset);
      CREATE TABLE IF NOT EXISTS analytics_snapshots (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        age_bucket TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analytics_experiments (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analytics_tasks (
        id TEXT PRIMARY KEY,
        post_id TEXT,
        status TEXT NOT NULL,
        due_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analytics_decisions (
        id TEXT PRIMARY KEY,
        post_id TEXT,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analytics_insights (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analytics_insight_events (
        id TEXT PRIMARY KEY,
        insight_id TEXT NOT NULL,
        at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    runStudioMigrations(this.database, workspace);
  }

  db(): DatabaseSync {
    this.ensure();
    return this.database!;
  }

  applyAdoptedDefaults(project: Project): Project {
    this.ensure();
    return applyAdoptedInsights(project, this.insights());
  }

  syncProject(project: Project): void {
    if (!this.database) return;
    const now = new Date().toISOString();
    for (const log of project.posts) {
      const existing = this.database
        .prepare('SELECT id, data FROM analytics_posts WHERE project_id = ? AND preset = ?')
        .get(project.id, log.preset) as Row | undefined;
      const previous = existing ? analyticsPostSchema.parse(JSON.parse(existing.data)) : undefined;
      const videoId = log.platform === 'youtube' ? youtubeVideoIdFromUrl(log.url) : undefined;
      const imported = videoId ? this.importedPostFor(videoId) : undefined;
      const id = previous?.id ?? imported?.id ?? randomUUID();
      const base = this.postFromProject(project, log, id, previous?.createdAt ?? imported?.createdAt ?? now, now);
      const claimedElsewhere = videoId ? this.videoClaimedBy(videoId, [id, imported?.id]) : undefined;
      const post: AnalyticsPost = analyticsPostSchema.parse({
        ...base,
        youtubeVideoId: videoId,
        ...(videoId ? apiFieldsOf(this.ledgerVideo(videoId)) : {}),
        experimentId: base.experimentId ?? imported?.experimentId,
        experimentArm: base.experimentId ? base.experimentArm : imported?.experimentArm,
      });
      if (imported) this.absorbImported(imported.id, id);
      this.database
        .prepare(
          `INSERT INTO analytics_posts (id, project_id, preset, posted_at, youtube_video_id, data)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, preset) DO UPDATE SET
             id = excluded.id,
             posted_at = excluded.posted_at,
             youtube_video_id = excluded.youtube_video_id,
             data = excluded.data`,
        )
        .run(
          post.id,
          post.projectId ?? null,
          post.preset ?? null,
          post.postedAt,
          videoId && !claimedElsewhere ? videoId : null,
          JSON.stringify(post),
        );
      if (log.url.trim() && log.postedAt) this.ensureReviewTask(post, now);
      if (log.metrics) this.mirrorMetrics(post.id, log.metrics, log.metrics.capturedAt || now);
      if (post.experimentId) this.noteSecondaryChanges(post);
    }
  }

  migrateProject(project: Project): Project | null {
    this.ensure();
    const legacy = project.experiment;
    const meaningful = Boolean(legacy.hypothesis?.trim()) || legacy.testVariables.length > 0;
    if (!meaningful || project.experimentRef) return null;
    const already = this.experiments().find((item) => item.sourceProjectId === project.id);
    if (already) {
      return {
        ...project,
        experimentRef: { experimentId: already.id, arm: 'variant' },
      };
    }
    const now = new Date().toISOString();
    const variable = legacy.testVariables[0];
    const mapped =
      variable === 'map' || variable === 'lang' || variable === 'hook' || variable === 'length' || variable === 'agent' || variable === 'postTime'
        ? variable
        : 'hook';
    const experiment: AnalyticsExperiment = experimentSchemaV7.parse({
      id: randomUUID(),
      name: legacy.hypothesis?.trim() || '移行した実験',
      phase: legacy.phase,
      series: legacy.series,
      hypothesis: legacy.hypothesis ?? '',
      primaryVariable: mapped,
      secondaryChangedVariables: legacy.testVariables.slice(1),
      controlLabel: 'これまでのやり方',
      variantLabels: ['試したやり方'],
      primaryMetric: 'averagePercentageViewed',
      status: 'archived',
      sourceProjectId: project.id,
      createdAt: now,
      updatedAt: now,
    });
    this.writeExperiment(experiment);
    return {
      ...project,
      experimentRef: { experimentId: experiment.id, arm: 'variant' },
    };
  }

  bundle(): AnalyticsBundle {
    this.ensure();
    this.promoteDueTasks();
    this.ensureWeekly();
    const bundle = {
      posts: this.posts(),
      snapshots: this.snapshots(),
      experiments: this.experiments(),
      tasks: this.tasks(),
      decisions: this.decisions(),
      insights: this.insights(),
      events: this.events(),
    };
    return analyticsBundleSchema.parse(bundle);
  }

  saveSnapshot(
    postId: string,
    ageBucket: AgeBucket,
    capturedAt: string,
    values: Partial<MetricSnapshot>,
  ): AnalyticsBundle {
    this.ensure();
    const snapshot = metricSnapshotSchema.parse({
      ...values,
      id: randomUUID(),
      postId,
      ageBucket,
      capturedAt,
      source: values.source ?? 'manual',
    });
    this.database!.prepare(
      'INSERT INTO analytics_snapshots (id, post_id, age_bucket, captured_at, data) VALUES (?, ?, ?, ?, ?)',
    ).run(snapshot.id, snapshot.postId, snapshot.ageBucket, snapshot.capturedAt, JSON.stringify(snapshot));
    return this.bundle();
  }

  saveTask(task: AnalysisTask): AnalyticsBundle {
    this.ensure();
    const next = analysisTaskSchema.parse({ ...task, updatedAt: new Date().toISOString() });
    this.writeTask(next);
    return this.bundle();
  }

  completeReview(taskId: string): AnalyticsBundle {
    this.ensure();
    const task = this.tasks().find((item) => item.id === taskId);
    if (!task) throw new Error('振り返りが見つかりません');
    const post = task.postId ? this.posts().find((item) => item.id === task.postId) : undefined;
    const experiment = post?.experimentId
      ? this.experiments().find((item) => item.id === post.experimentId)
      : undefined;
    const shaped = decisionFromAction(task.draft ?? emptyDraft(), experiment);
    const now = new Date().toISOString();
    const decision: Decision = decisionSchema.parse({
      id: randomUUID(),
      postId: post?.id,
      experimentId: experiment?.id,
      taskId: task.id,
      ...shaped,
      createdAt: now,
      updatedAt: now,
    });
    this.database!.prepare('INSERT INTO analytics_decisions (id, post_id, data) VALUES (?, ?, ?)').run(
      decision.id,
      decision.postId ?? null,
      JSON.stringify(decision),
    );
    this.writeTask({
      ...task,
      status: 'done',
      currentStep: 6,
      completedAt: now,
      updatedAt: now,
    });
    return this.bundle();
  }

  saveExperiment(input: unknown): AnalyticsBundle {
    this.ensure();
    const now = new Date().toISOString();
    const experiment = experimentSchemaV7.parse({
      ...(typeof input === 'object' && input ? input : {}),
      id: (input as { id?: string })?.id || randomUUID(),
      createdAt: (input as { createdAt?: string })?.createdAt || now,
      updatedAt: now,
    });
    this.writeExperiment(experiment);
    return this.bundle();
  }

  concludeExperiment(experimentId: string, conclusion: unknown, summary: string): AnalyticsBundle {
    this.ensure();
    const experiment = this.experiments().find((item) => item.id === experimentId);
    if (!experiment) throw new Error('実験が見つかりません');
    const now = new Date().toISOString();
    this.writeExperiment({
      ...experiment,
      conclusion: experimentConclusionSchema.parse(conclusion),
      resultSummary: summary,
      status: 'completed',
      endedAt: now,
      updatedAt: now,
    });
    return this.bundle();
  }

  archiveExperiment(experimentId: string): AnalyticsBundle {
    this.ensure();
    const experiment = this.experiments().find((item) => item.id === experimentId);
    if (!experiment) throw new Error('実験が見つかりません');
    this.writeExperiment({ ...experiment, status: 'archived', updatedAt: new Date().toISOString() });
    return this.bundle();
  }

  saveInsight(input: unknown): AnalyticsBundle {
    this.ensure();
    const now = new Date().toISOString();
    const currentId = (input as { id?: string })?.id;
    const previous = currentId ? this.insights().find((item) => item.id === currentId) : undefined;
    const insight = insightSchema.parse({
      ...(typeof input === 'object' && input ? input : {}),
      id: currentId || randomUUID(),
      createdAt: previous?.createdAt || (input as { createdAt?: string })?.createdAt || now,
      updatedAt: now,
    });
    this.writeInsight(insight);
    if (!previous) this.writeEvent(insight.id, undefined, insight.status, '作成');
    return this.bundle();
  }

  setInsightStatus(insightId: string, status: unknown): AnalyticsBundle {
    this.ensure();
    const insight = this.insights().find((item) => item.id === insightId);
    if (!insight) throw new Error('Insight が見つかりません');
    const nextStatus = insightStatusSchema.parse(status);
    if (nextStatus === insight.status) return this.bundle();
    const now = new Date().toISOString();
    const flags =
      nextStatus === 'adopted'
        ? { applyAsDefault: true, suggestNext: false, warnOnUse: false }
        : nextStatus === 'testing'
          ? { applyAsDefault: false, suggestNext: true, warnOnUse: false }
          : { applyAsDefault: false, suggestNext: false, warnOnUse: true };
    this.writeInsight({ ...insight, ...flags, status: nextStatus, updatedAt: now });
    this.writeEvent(insight.id, insight.status, nextStatus);
    return this.bundle();
  }

  linkConclusion(insightId: string, ref: { decisionId?: string; experimentId?: string }): AnalyticsBundle {
    this.ensure();
    const insight = this.insights().find((item) => item.id === insightId);
    if (!insight) throw new Error('Insight が見つかりません');
    const now = new Date().toISOString();
    this.writeInsight({
      ...insight,
      linkedDecisionIds: ref.decisionId
        ? [...new Set([...insight.linkedDecisionIds, ref.decisionId])]
        : insight.linkedDecisionIds,
      linkedExperimentIds: ref.experimentId
        ? [...new Set([...insight.linkedExperimentIds, ref.experimentId])]
        : insight.linkedExperimentIds,
      updatedAt: now,
    });
    if (ref.decisionId) {
      const decision = this.decisions().find((item) => item.id === ref.decisionId);
      if (decision) {
        const next = { ...decision, insightId, updatedAt: now };
        this.database!.prepare('UPDATE analytics_decisions SET data = ? WHERE id = ?').run(
          JSON.stringify(next),
          decision.id,
        );
      }
    }
    return this.bundle();
  }

  consumeDecision(decisionId: string): AnalyticsBundle {
    this.ensure();
    const decision = this.decisions().find((item) => item.id === decisionId);
    if (!decision) return this.bundle();
    const remaining = Math.max(0, (decision.remainingApplyCount ?? 1) - 1);
    const next: Decision = {
      ...decision,
      remainingApplyCount: remaining,
      applyToNextProjects: remaining > 0 && decision.applyToNextProjects,
      updatedAt: new Date().toISOString(),
    };
    this.database!.prepare('UPDATE analytics_decisions SET data = ? WHERE id = ?').run(
      JSON.stringify(next),
      decision.id,
    );
    return this.bundle();
  }

  csv(): string {
    return analyticsCsv(this.bundle());
  }

  private postFromProject(
    project: Project,
    log: Project['posts'][number],
    id: string,
    createdAt: string,
    updatedAt: string,
  ): AnalyticsPost {
    const duration = activeTimeline(project).durationSec;
    const stillId = project.cardStills.result ?? project.cardStills.aim ?? project.cardStills.stand;
    const thumbnail = project.stills.find((item) => item.id === stillId)?.path;
    const basename = guessBasename(project, log.preset);
    const opening = project.analytics.openingType;
    const structure = project.analytics.structureType ?? (project.scenes.some((scene) => scene.sceneKey === 'demo' && scene.clipId) ? 'lineup-demo' : 'lineup-only');
    const like =
      log.platform === 'youtube' && likeCtaActive(project, 'youtube');
    const likeText = resolveLikeCtaText(project);
    const cta = like
      ? 'like-revisit'
      : project.analytics.ctaType ?? (project.captions.some((caption) => caption.id === 'cta') ? 'clutchvault-save' : 'none');
    const ctaCopy = like
      ? `${likeText.line1[log.lang] ?? likeText.line1.en} / ${likeText.before[log.lang] ?? likeText.before.en}👍${likeText.after[log.lang] ?? likeText.after.en}`
      : undefined;
    return analyticsPostSchema.parse({
      id,
      projectId: project.id,
      preset: log.preset,
      platform: log.platform,
      lang: log.lang,
      url: log.url,
      postedAt: log.postedAt,
      basename,
      utmContent: basename,
      templateId: project.templateId,
      hookPattern: project.hookPattern,
      openingType: opening,
      structureType: structure,
      ctaType: cta,
      experimentId: project.experimentRef?.experimentId,
      experimentArm: project.experimentRef?.arm,
      durationSec: duration,
      withBgm: Boolean(project.audio.bgm),
      bgmTrackId: project.audio.bgm?.audioTrackId,
      content: {
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
        openingType: opening,
        structureType: structure,
        ctaType: cta,
        ctaCopy,
        ctaMotion: like ? likeText.motion !== false : undefined,
        durationSec: duration,
        durationLabel: project.analytics.durationLabel,
        withBgm: Boolean(project.audio.bgm),
        bgmTrackId: project.audio.bgm?.audioTrackId,
        thumbnailPath: thumbnail,
      },
      createdAt,
      updatedAt,
    });
  }

  /**
   * YouTubeの台帳をPostへ反映する。既存Postの手入力値・投稿日時・タグは書き換えず、API由来の欄だけ更新する。
   * 取り込みだけでは振り返りタスクを作らない。
   */
  upsertImportedVideos(videos: YoutubeVideo[]): { created: number; linked: number } {
    this.ensure();
    const now = new Date().toISOString();
    let created = 0;
    let linked = 0;
    const select = this.database!.prepare('SELECT id, data FROM analytics_posts WHERE youtube_video_id = ?');
    const update = this.database!.prepare(
      'UPDATE analytics_posts SET youtube_video_id = ?, posted_at = ?, data = ? WHERE id = ?',
    );
    for (const video of videos) {
      const row = select.get(video.videoId) as Row | undefined;
      const current = row
        ? analyticsPostSchema.parse(JSON.parse(row.data))
        : this.posts().find(
            (post) =>
              post.platform === 'youtube' &&
              !post.youtubeVideoId &&
              youtubeVideoIdFromUrl(post.url) === video.videoId,
          );
      if (current) {
        const isImported = current.importOrigin === 'youtube-import';
        const next = analyticsPostSchema.parse({
          ...current,
          ...apiFieldsOf(video),
          youtubeVideoId: video.videoId,
          ...(isImported
            ? {
                url: importedUrl(video),
                postedAt: video.publishedAt,
                durationSec: video.durationSec,
                content: { ...current.content, title: video.title, durationSec: video.durationSec },
              }
            : {}),
          updatedAt: now,
        });
        update.run(video.videoId, next.postedAt, JSON.stringify(next), current.id);
        if (!isImported) linked += 1;
        continue;
      }
      const post = analyticsPostSchema.parse({
        id: randomUUID(),
        platform: 'youtube',
        url: importedUrl(video),
        postedAt: video.publishedAt,
        importOrigin: 'youtube-import',
        youtubeVideoId: video.videoId,
        ...apiFieldsOf(video),
        templateId: 'unknown',
        hookPattern: 'custom',
        durationSec: video.durationSec,
        content: {
          title: video.title,
          series: '',
          templateId: 'unknown',
          hookPattern: 'custom',
          durationSec: video.durationSec,
        },
        createdAt: now,
        updatedAt: now,
      });
      this.database!.prepare(
        `INSERT INTO analytics_posts (id, project_id, preset, posted_at, youtube_video_id, data)
         VALUES (?, NULL, NULL, ?, ?, ?)`,
      ).run(post.id, post.postedAt, video.videoId, JSON.stringify(post));
      created += 1;
    }
    return { created, linked };
  }

  youtubePostCounts(): { linked: number; unlinked: number } {
    if (!this.database) return { linked: 0, unlinked: 0 };
    const row = this.database
      .prepare(
        `SELECT
           SUM(CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END) AS linked,
           SUM(CASE WHEN project_id IS NULL THEN 1 ELSE 0 END) AS unlinked
         FROM analytics_posts WHERE youtube_video_id IS NOT NULL`,
      )
      .get() as { linked: number | null; unlinked: number | null };
    return { linked: row.linked ?? 0, unlinked: row.unlinked ?? 0 };
  }

  private importedPostFor(videoId: string): AnalyticsPost | undefined {
    const row = this.database!.prepare(
      'SELECT id, data FROM analytics_posts WHERE youtube_video_id = ? AND project_id IS NULL',
    ).get(videoId) as Row | undefined;
    if (!row) return undefined;
    const post = analyticsPostSchema.parse(JSON.parse(row.data));
    return post.importOrigin === 'youtube-import' ? post : undefined;
  }

  private videoClaimedBy(videoId: string, exclude: Array<string | undefined>): string | undefined {
    const rows = this.database!.prepare('SELECT id FROM analytics_posts WHERE youtube_video_id = ?').all(
      videoId,
    ) as Array<{ id: string }>;
    return rows.find((row) => !exclude.includes(row.id))?.id;
  }

  /** 取り込み済みの未紐付けPostを、制作側のPostへまとめる。参照は付け替えてから消す。 */
  private absorbImported(fromId: string, toId: string): void {
    const database = this.database!;
    database.prepare('DELETE FROM analytics_posts WHERE id = ?').run(fromId);
    if (fromId === toId) return;
    for (const table of ['analytics_snapshots', 'analytics_tasks', 'analytics_decisions'] as const) {
      const rows = database.prepare(`SELECT id, data FROM ${table} WHERE post_id = ?`).all(fromId) as Row[];
      for (const row of rows) {
        const data = { ...(JSON.parse(row.data) as Record<string, unknown>), postId: toId };
        database.prepare(`UPDATE ${table} SET post_id = ?, data = ? WHERE id = ?`).run(toId, JSON.stringify(data), row.id);
      }
    }
    for (const experiment of this.experiments()) {
      if (!experiment.linkedPostIds.includes(fromId)) continue;
      this.writeExperiment({
        ...experiment,
        linkedPostIds: [...new Set(experiment.linkedPostIds.map((id) => (id === fromId ? toId : id)))],
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private ledgerVideo(videoId: string): YoutubeVideo | undefined {
    const row = this.database!.prepare('SELECT data FROM youtube_videos WHERE video_id = ?').get(videoId) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    const parsed = youtubeVideoSchema.safeParse(JSON.parse(row.data));
    return parsed.success ? parsed.data : undefined;
  }

  urlRows(): Array<{ url: string; projectId: string; preset: string; projectTitle: string }> {
    return this.posts().flatMap((post) =>
      post.url.trim() && post.projectId && post.preset
        ? [
            {
              url: post.url,
              projectId: post.projectId,
              preset: post.preset,
              projectTitle: post.content.title || post.projectId,
            },
          ]
        : [],
    );
  }

  has7d(projectId: string, preset: string): boolean {
    const post = this.posts().find((item) => item.projectId === projectId && item.preset === preset);
    if (!post) return false;
    return this.tasks().some((task) => task.id === `7d:${post.id}`);
  }

  ensure24hTasks(): void {
    if (!this.database) return;
    const nowIso = new Date().toISOString();
    for (const post of this.posts()) {
      if (!post.url.trim() || !post.postedAt || !post.projectId) continue;
      const id = `24h:${post.id}`;
      if (this.tasks().some((task) => task.id === id)) continue;
      const posted = new Date(post.postedAt);
      const dueAt = Number.isNaN(posted.getTime())
        ? nowIso
        : new Date(posted.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const status = new Date(dueAt).getTime() <= Date.now() ? 'ready' : 'waiting';
      this.writeTask(
        analysisTaskSchema.parse({
          id,
          postId: post.id,
          type: '24h-check',
          dueAt,
          status,
          currentStep: 1,
          draft: emptyDraft(),
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      );
    }
  }

  private ensureReviewTask(post: AnalyticsPost, nowIso: string): void {
    const id = `7d:${post.id}`;
    const existing = this.tasks().find((item) => item.id === id);
    if (existing) return;
    const dueAt = dueAtFor7d(post.postedAt);
    const status = new Date(dueAt).getTime() <= Date.now() ? 'ready' : 'waiting';
    const task: AnalysisTask = analysisTaskSchema.parse({
      id,
      postId: post.id,
      type: '7d-review',
      dueAt,
      status,
      currentStep: 1,
      draft: emptyDraft(),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    this.writeTask(task);
  }

  private mirrorMetrics(
    postId: string,
    metrics: NonNullable<Project['posts'][number]['metrics']>,
    capturedAt: string,
  ): void {
    const values = fromLogMetrics(metrics);
    const draft = metricSnapshotSchema.parse({
      id: 'draft',
      postId,
      capturedAt,
      ageBucket: '7d',
      source: 'manual',
      ...values,
    });
    const latest = this.snapshots()
      .filter((item) => item.postId === postId && item.ageBucket === '7d')
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    if (latest && snapshotSignature(latest) === snapshotSignature(draft)) return;
    const snapshot = { ...draft, id: randomUUID() };
    this.database!.prepare(
      'INSERT INTO analytics_snapshots (id, post_id, age_bucket, captured_at, data) VALUES (?, ?, ?, ?, ?)',
    ).run(snapshot.id, snapshot.postId, snapshot.ageBucket, snapshot.capturedAt, JSON.stringify(snapshot));
  }

  private noteSecondaryChanges(post: AnalyticsPost): void {
    const experiment = this.experiments().find((item) => item.id === post.experimentId);
    if (!experiment) return;
    const changes = secondaryChanges(post, experiment.fixedConditions);
    const linked = experiment.linkedPostIds.includes(post.id)
      ? experiment.linkedPostIds
      : [...experiment.linkedPostIds, post.id];
    const merged = [...new Set([...experiment.secondaryChangedVariables, ...changes])];
    if (
      merged.length === experiment.secondaryChangedVariables.length &&
      linked.length === experiment.linkedPostIds.length
    ) {
      return;
    }
    this.writeExperiment({
      ...experiment,
      linkedPostIds: linked,
      secondaryChangedVariables: merged,
      updatedAt: new Date().toISOString(),
    });
  }

  private promoteDueTasks(): void {
    for (const task of this.tasks()) {
      const next = promoteTaskStatus(task);
      if (next.status !== task.status) this.writeTask({ ...next, updatedAt: new Date().toISOString() });
    }
  }

  private ensureWeekly(): void {
    const key = weekKey();
    const id = `weekly:${key}`;
    if (this.tasks().some((item) => item.id === id)) return;
    const now = new Date().toISOString();
    this.writeTask(
      analysisTaskSchema.parse({
        id,
        type: 'weekly-review',
        dueAt: now,
        status: 'ready',
        weekKey: key,
        currentStep: 1,
        draft: { ...emptyDraft(), weeklyStep: 1 },
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  private posts(): AnalyticsPost[] {
    return this.read('analytics_posts', analyticsPostSchema);
  }

  private snapshots(): MetricSnapshot[] {
    return this.read('analytics_snapshots', metricSnapshotSchema);
  }

  private experiments(): AnalyticsExperiment[] {
    return this.read('analytics_experiments', experimentSchemaV7);
  }

  private tasks(): AnalysisTask[] {
    return this.read('analytics_tasks', analysisTaskSchema);
  }

  private decisions(): Decision[] {
    return this.read('analytics_decisions', decisionSchema);
  }

  private insights(): Insight[] {
    return this.read('analytics_insights', insightSchema);
  }

  private events() {
    return this.read('analytics_insight_events', insightEventSchema);
  }

  private read<T>(table: string, schema: { parse: (value: unknown) => T }): T[] {
    const rows = this.database!.prepare(`SELECT data FROM ${table}`).all() as Array<{ data: string }>;
    return rows.flatMap((row) => {
      try {
        return [schema.parse(JSON.parse(row.data))];
      } catch {
        return [];
      }
    });
  }

  private writeExperiment(experiment: AnalyticsExperiment): void {
    this.database!.prepare(
      `INSERT INTO analytics_experiments (id, status, data) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
    ).run(experiment.id, experiment.status, JSON.stringify(experiment));
  }

  private writeTask(task: AnalysisTask): void {
    this.database!.prepare(
      `INSERT INTO analytics_tasks (id, post_id, status, due_at, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET post_id = excluded.post_id, status = excluded.status, due_at = excluded.due_at, data = excluded.data`,
    ).run(task.id, task.postId ?? null, task.status, task.dueAt, JSON.stringify(task));
  }

  private writeInsight(insight: Insight): void {
    this.database!.prepare(
      `INSERT INTO analytics_insights (id, status, data) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
    ).run(insight.id, insight.status, JSON.stringify(insight));
  }

  private writeEvent(
    insightId: string,
    from: Insight['status'] | undefined,
    to: Insight['status'],
    note?: string,
  ): void {
    const event = insightEventSchema.parse({
      id: randomUUID(),
      insightId,
      from,
      to,
      note,
      at: new Date().toISOString(),
    });
    this.database!.prepare(
      'INSERT INTO analytics_insight_events (id, insight_id, at, data) VALUES (?, ?, ?, ?)',
    ).run(event.id, event.insightId, event.at, JSON.stringify(event));
  }

  private ensure(): void {
    if (!this.database) this.initialize();
    if (!this.database) throw new Error('保存先フォルダが選択されていません');
  }
}

export const refreshAnalytics = async (
  service: AnalyticsService,
  projects: Project[],
  save: (project: Project) => Promise<Project>,
): Promise<AnalyticsBundle> => {
  for (const project of projects) {
    const migrated = service.migrateProject(project);
    const current = migrated ? await save(migrated) : project;
    service.syncProject(current);
  }
  return service.bundle();
};
