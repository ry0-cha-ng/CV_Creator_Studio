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
import { activeTimeline } from '../../../shared/timeline';

type Row = { id: string; data: string };

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
      const post = this.postFromProject(project, log, previous?.id ?? randomUUID(), previous?.createdAt ?? now, now);
      this.database
        .prepare(
          `INSERT INTO analytics_posts (id, project_id, preset, posted_at, data)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(project_id, preset) DO UPDATE SET
             id = excluded.id,
             posted_at = excluded.posted_at,
             data = excluded.data`,
        )
        .run(post.id, post.projectId, post.preset, post.postedAt, JSON.stringify(post));
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

  urlRows(): Array<{ url: string; projectId: string; preset: string; projectTitle: string }> {
    return this.posts()
      .filter((post) => post.url.trim())
      .map((post) => ({
        url: post.url,
        projectId: post.projectId,
        preset: post.preset,
        projectTitle: post.content.title || post.projectId,
      }));
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
      if (!post.url.trim() || !post.postedAt) continue;
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
