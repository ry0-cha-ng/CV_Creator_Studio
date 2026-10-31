import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deliveryPresetIdSchema, platformsFor, type DeliveryPresetId } from '../../../shared/delivery-presets';
import { exportContentStamp, licenseSummary } from '../../../shared/guide';
import {
  DEFAULT_PUBLISHING_SETTINGS,
  applyChecklist,
  applyNeedsFix,
  canCompletePublish,
  completeTask,
  currentTask,
  doneCount,
  isPublishTask,
  manualPrecheckReady,
  publishingStarted,
  precheckAuto,
  projectStatusForWorkflow,
  publishFiles,
  publishingPresets,
  publishingSettingsSchema,
  publishingWorkflowSchema,
  qaReady,
  reconcilePublishing,
  recordAuto,
  remainingCount,
  skipTask,
  taskBlurb,
  taskTitle,
  upsertPublicationVerify,
  withRecordedPost,
  workflowTaskSchema,
  type PublishingBundle,
  type PublishingSettings,
  type PublishingView,
  type StudioNextAction,
  type WorkflowTask,
} from '../../../shared/publishing';
import { checkPostUrl, type TakenPostUrl } from '../../../shared/post-url';
import type { AudioTrack } from '../../../shared/schema/audio';
import type { Project } from '../../../shared/schema/project';

type TakenRow = { url: string; projectId: string; preset: string; projectTitle: string };

const asPreset = (value: string | undefined): DeliveryPresetId | undefined => {
  const parsed = deliveryPresetIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const localDay = (date = new Date()): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const sameLocalDay = (iso: string | undefined, now = new Date()): boolean => {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return localDay(date) === localDay(now);
};

export class PublishingService {
  private database: DatabaseSync | null = null;

  constructor(
    private readonly getWorkspace: () => string | null,
    private readonly loadProject: (id: string) => Promise<Project>,
    private readonly listProjects: () => Promise<Array<{ id: string; title: string; status: Project['status']; nextStep: number; nextLabel: string }>>,
    private readonly takenUrls: () => TakenRow[],
    private readonly hasReview: (projectId: string, preset: string) => boolean,
    private readonly getTrack: (id: string) => AudioTrack | null,
  ) {}

  initialize(): void {
    const workspace = this.getWorkspace();
    if (!workspace) return;
    this.database?.close();
    this.database = new DatabaseSync(path.join(workspace, 'studio.db'));
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS studio_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publishing_workflows (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publishing_tasks (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS publishing_tasks_workflow_idx
        ON publishing_tasks(workflow_id, sort_order);
    `);
  }

  getSettings(): PublishingSettings {
    if (!this.database) return DEFAULT_PUBLISHING_SETTINGS;
    const row = this.database
      .prepare('SELECT value FROM studio_settings WHERE key = ?')
      .get('publishingSettings') as { value: string } | undefined;
    if (!row) return DEFAULT_PUBLISHING_SETTINGS;
    const parsed = publishingSettingsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_PUBLISHING_SETTINGS;
  }

  setSettings(input: PublishingSettings): PublishingSettings {
    const settings = publishingSettingsSchema.parse(input);
    this.requireDatabase()
      .prepare('INSERT OR REPLACE INTO studio_settings (key, value) VALUES (?, ?)')
      .run('publishingSettings', JSON.stringify(settings));
    return settings;
  }

  async view(projectId: string): Promise<PublishingView> {
    const project = await this.loadProject(projectId);
    const bundle = this.syncBundle(project);
    return this.toView(project, bundle);
  }

  async start(projectId: string): Promise<PublishingView> {
    const project = await this.loadProject(projectId);
    const bundle = this.syncBundle(project);
    if (!bundle) {
      throw new Error(
        project.guide.lastExport
          ? '投稿先のプリセットがありません。手順9でプリセットを選んで書き出してください'
          : '書き出しが終わってから投稿運用を始められます',
      );
    }
    const now = new Date().toISOString();
    const next: PublishingBundle = {
      ...bundle,
      workflow: {
        ...bundle.workflow,
        status: bundle.workflow.status === 'done' ? 'done' : 'in-progress',
        pausedForToday: false,
        updatedAt: now,
      },
    };
    this.save(next);
    return this.toView(project, next);
  }

  async pause(projectId: string): Promise<PublishingView> {
    const project = await this.loadProject(projectId);
    const bundle = this.syncBundle(project);
    if (!bundle) throw new Error('投稿運用はまだありません');
    const now = new Date().toISOString();
    const next: PublishingBundle = {
      ...bundle,
      workflow: { ...bundle.workflow, pausedForToday: true, pausedOn: localDay(), updatedAt: now },
    };
    this.save(next);
    return this.toView(project, next);
  }

  async patch(
    projectId: string,
    taskId: string,
    body: {
      checklist?: Array<{ id: string; checked: boolean }>;
      url?: string;
      postedAt?: string;
      qa?: WorkflowTask['qa'];
    },
  ): Promise<PublishingView> {
    const project = await this.loadProject(projectId);
    const bundle = this.syncBundle(project);
    if (!bundle) throw new Error('投稿運用はまだありません');
    const now = new Date().toISOString();
    let tasks = body.checklist ? applyChecklist(bundle.tasks, taskId, body.checklist, now) : bundle.tasks;
    tasks = tasks.map((task) => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        urlDraft: body.url ?? task.urlDraft,
        postedAtDraft: body.postedAt ?? task.postedAtDraft,
        qa: body.qa ?? task.qa,
        status: task.status === 'ready' ? 'in-progress' : task.status,
        updatedAt: now,
      };
    });
    const next = { ...bundle, tasks };
    this.save(next);
    return this.toView(project, next);
  }

  async complete(
    project: Project,
    taskId: string,
    body: {
      checklist?: Array<{ id: string; checked: boolean }>;
      url?: string;
      postedAt?: string;
      qa?: WorkflowTask['qa'];
    },
  ): Promise<{ project: Project; view: PublishingView }> {
    const bundle = this.syncBundle(project);
    if (!bundle) throw new Error('投稿運用はまだありません');
    const now = new Date().toISOString();
    let tasks = body.checklist ? applyChecklist(bundle.tasks, taskId, body.checklist, now) : bundle.tasks;
    if (body.qa) {
      tasks = tasks.map((task) => (task.id === taskId ? { ...task, qa: body.qa, updatedAt: now } : task));
    }
    let working: PublishingBundle = { ...bundle, tasks };
    const task = working.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error('タスクが見つかりません');
    let nextProject = project;
    if (task.type === 'pre-publish-check') {
      const checks = await this.autoChecks(project);
      if (!manualPrecheckReady(task, checks)) throw new Error('確認が終わっていません');
      working = completeTask(working, taskId, now);
    } else if (isPublishTask(task.type)) {
      const preset = asPreset(task.preset);
      if (!task.platform || !preset) throw new Error('投稿先がわかりません');
      const verdict = checkPostUrl(task.platform, body.url ?? task.urlDraft ?? '', {
        accounts: this.getSettings().accounts,
        taken: this.taken(project),
        ignore: { projectId: project.id, preset },
      });
      const blocker = canCompletePublish(
        working.tasks.find((item) => item.id === taskId) ?? task,
        verdict,
      );
      if (blocker || !verdict.normalizedUrl) throw new Error(blocker ?? 'URLの形式が違います');
      const postedAt = body.postedAt || task.postedAtDraft || project.plannedPostDate || now;
      nextProject = withRecordedPost(nextProject, preset, verdict.normalizedUrl, postedAt, randomUUID());
      working = completeTask(working, taskId, now, {
        url: verdict.normalizedUrl,
        postedAt,
        warningNote: verdict.status === 'warning' ? verdict.message : undefined,
      });
    } else if (task.type === 'post-publish-verify') {
      const presets = working.tasks
        .filter((item) => isPublishTask(item.type) && item.status !== 'skipped')
        .map((item) => asPreset(item.preset))
        .filter((preset): preset is DeliveryPresetId => Boolean(preset));
      if (!qaReady(working.tasks.find((item) => item.id === taskId) ?? task, presets, working.workflow.skipQaPresets)) {
        throw new Error('媒体ごとの確認が終わっていません');
      }
      working = completeTask(working, taskId, now);
    } else {
      const checks = recordAuto(
        nextProject,
        working.tasks,
        (preset) => this.hasReview(project.id, preset),
        working.workflow.skipQaPresets,
      );
      if (checks.some((check) => check.key !== 'review' && !check.ok)) throw new Error('記録がそろっていません');
      working = completeTask(working, taskId, now);
    }
    if (bundle.workflow.status === 'pending') {
      working = { ...working, workflow: { ...working.workflow, status: working.workflow.status === 'done' ? 'done' : 'in-progress' } };
    }
    nextProject = {
      ...nextProject,
      status: projectStatusForWorkflow(nextProject, working, bundle.workflow.status),
    };
    this.save(working);
    return { project: nextProject, view: await this.toView(nextProject, working) };
  }

  async applyYoutubePublication(
    project: Project,
    taskId: string,
    input: {
      url: string;
      postedAt?: string;
      publicationState: NonNullable<Project['posts'][number]['publicationState']>;
      scheduledPublishAt?: string;
      timezone?: string;
      keepWithoutPublic?: boolean;
    },
  ): Promise<{ project: Project; view: PublishingView }> {
    const bundle = this.syncBundle(project);
    if (!bundle) throw new Error('投稿運用はまだありません');
    const task = bundle.tasks.find((item) => item.id === taskId);
    const preset = asPreset(task?.preset);
    if (!task || !preset) throw new Error('YouTube投稿タスクが見つかりません');
    const now = new Date().toISOString();
    let working = completeTask(bundle, taskId, now, {
      url: input.url,
      postedAt: input.postedAt,
    });
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
    working = {
      ...working,
      workflow: { ...working.workflow, skipQaPresets: [...skipQa], updatedAt: now },
    };
    const nextProject = withRecordedPost(project, preset, input.url, input.postedAt ?? '', randomUUID(), {
      publicationState: input.publicationState,
      scheduledPublishAt: input.scheduledPublishAt,
      timezone: input.timezone,
    });
    this.save(working);
    return {
      project: { ...nextProject, status: projectStatusForWorkflow(nextProject, working, bundle.workflow.status) },
      view: await this.toView(nextProject, working),
    };
  }

  async completePublicationVerify(project: Project, preset: string): Promise<{ project: Project; view: PublishingView }> {
    const bundle = this.syncBundle(project);
    if (!bundle) throw new Error('投稿運用はまだありません');
    const task = bundle.tasks.find((item) => item.type === 'youtube-publication-verify' && item.preset === preset);
    if (!task || task.status === 'done' || task.status === 'skipped') {
      return { project, view: await this.toView(project, bundle) };
    }
    const now = new Date().toISOString();
    const working = completeTask(bundle, task.id, now);
    this.save(working);
    return {
      project: { ...project, status: projectStatusForWorkflow(project, working, bundle.workflow.status) },
      view: await this.toView(project, working),
    };
  }

  async skip(project: Project, taskId: string, reason?: string): Promise<{ project: Project; view: PublishingView }> {
    const bundle = this.syncBundle(project);
    if (!bundle) throw new Error('投稿運用はまだありません');
    const now = new Date().toISOString();
    let working = skipTask(bundle, taskId, reason, now);
    if (bundle.workflow.status === 'pending') {
      working = { ...working, workflow: { ...working.workflow, status: working.workflow.status === 'done' ? 'done' : 'in-progress' } };
    }
    const nextProject = {
      ...project,
      status: projectStatusForWorkflow(project, working, bundle.workflow.status),
    };
    this.save(working);
    return { project: nextProject, view: await this.toView(nextProject, working) };
  }

  async recordUrl(
    project: Project,
    preset: string,
    url: string,
    postedAt?: string,
  ): Promise<{ project: Project; view: PublishingView }> {
    const bundle = this.syncBundle(project);
    if (!bundle) throw new Error('投稿運用はまだありません');
    const task = bundle.tasks.find((item) => item.preset === preset && isPublishTask(item.type));
    const parsed = asPreset(preset);
    if (!task?.platform || !parsed) throw new Error('投稿先がわかりません');
    const verdict = checkPostUrl(task.platform, url, {
      accounts: this.getSettings().accounts,
      taken: this.taken(project),
      ignore: { projectId: project.id, preset },
    });
    if (verdict.status === 'error' || verdict.status === 'empty' || !verdict.normalizedUrl) {
      throw new Error(verdict.message ?? 'URLの形式が違います');
    }
    const now = new Date().toISOString();
    const when = postedAt || task.postedAtDraft || project.plannedPostDate || now;
    const tasks = bundle.tasks.map((item) =>
      item.id === task.id
        ? {
            ...item,
            urlDraft: verdict.normalizedUrl,
            postedAtDraft: when,
            warningNote: verdict.status === 'warning' ? verdict.message : undefined,
            updatedAt: now,
          }
        : item,
    );
    const working = { ...bundle, tasks };
    this.save(working);
    const nextProject =
      task.status === 'done' || task.status === 'needs-fix'
        ? withRecordedPost(project, parsed, verdict.normalizedUrl, when, randomUUID())
        : project;
    return { project: nextProject, view: await this.toView(nextProject, working) };
  }

  async needsFix(project: Project, publishTaskId: string): Promise<{ project: Project; view: PublishingView }> {
    const bundle = this.syncBundle(project);
    if (!bundle) throw new Error('投稿運用はまだありません');
    const now = new Date().toISOString();
    const tasks = applyNeedsFix(bundle.tasks, publishTaskId, now);
    const working: PublishingBundle = {
      workflow: {
        ...bundle.workflow,
        status: bundle.workflow.status === 'done' ? 'in-progress' : bundle.workflow.status === 'pending' ? 'in-progress' : bundle.workflow.status,
        completedAt: undefined,
        updatedAt: now,
        currentTaskId: undefined,
      },
      tasks,
    };
    const stamped = reconcilePublishing(working, project, now, () => randomUUID()) ?? working;
    const nextProject = {
      ...project,
      status: projectStatusForWorkflow(project, stamped, bundle.workflow.status),
    };
    this.save(stamped);
    return { project: nextProject, view: await this.toView(nextProject, stamped) };
  }

  async nextPublishAction(): Promise<StudioNextAction | null> {
    const summaries = await this.listProjects();
    const ready: Array<{ at: string; action: StudioNextAction }> = [];
    const scheduled: StudioNextAction[] = [];
    for (const summary of summaries) {
      let project: Project;
      try {
        project = await this.loadProject(summary.id);
      } catch {
        continue;
      }
      const bundle = this.syncBundle(project);
      if (bundle && bundle.workflow.status !== 'done') {
        const task = currentTask(bundle.tasks);
        const started = publishingStarted(bundle);
        if (!started) {
          ready.push({
            at: bundle.workflow.createdAt,
            action: {
              kind: 'publish',
              projectId: project.id,
              title: project.title,
              headline: '投稿運用を始めてください',
              detail: `${project.lineup.map} / ${project.lineup.agent} / ${project.lineup.site}`,
              meta: '書き出しは終わっています',
              remaining: bundle.tasks.length,
              progress: `0 / ${bundle.tasks.length}`,
              step: 10,
              chip: '投稿運用',
            },
          });
        } else if (task && (task.status === 'ready' || task.status === 'needs-fix' || task.status === 'in-progress')) {
          const files = publishFiles(project);
          const thumb =
            files.find((file) => file.preset === task.preset && file.kind === 'thumbnail') ??
            files.find((file) => file.kind === 'xCard' || file.kind === 'thumbnail');
          const index = bundle.tasks.findIndex((item) => item.id === task.id);
          ready.push({
            at: task.createdAt,
            action: {
              kind: 'publish',
              projectId: project.id,
              title: project.title,
              headline: taskTitle(task),
              detail: `${project.lineup.map} / ${project.lineup.agent} / ${project.lineup.site}`,
              meta: taskBlurb(task),
              remaining: remainingCount(bundle.tasks, task.id),
              progress: `${Math.max(index, 0) + 1} / ${bundle.tasks.length}`,
              step: 10,
              thumbnailPath: thumb?.relativePath,
              chip: task.preset ? `${task.preset} · ${task.lang === 'en' ? 'English' : '日本語'}` : '投稿運用',
            },
          });
        }
      }
      if (sameLocalDay(project.plannedPostDate) && project.status !== 'posted') {
        scheduled.push({
          kind: 'scheduled',
          projectId: project.id,
          title: project.title,
          headline: '今日の投稿予定です',
          detail: `${project.lineup.map} / ${project.lineup.agent} / ${project.lineup.site}`,
          meta: summary.nextLabel,
          remaining: 0,
          progress: '',
          step: summary.nextStep,
          chip: '投稿予定',
        });
      }
    }
    ready.sort((left, right) => left.at.localeCompare(right.at));
    if (ready[0]) return ready[0].action;
    return scheduled[0] ?? null;
  }

  private syncBundle(project: Project): PublishingBundle | null {
    if (!this.database) this.initialize();
    if (!this.database) return null;
    const now = new Date().toISOString();
    const next = reconcilePublishing(this.read(project.id), project, now, () => randomUUID());
    if (!next) return null;
    this.save(next);
    return this.read(project.id) ?? next;
  }

  private read(projectId: string): PublishingBundle | null {
    const database = this.database;
    if (!database) return null;
    const row = database
      .prepare('SELECT data FROM publishing_workflows WHERE project_id = ?')
      .get(projectId) as { data: string } | undefined;
    if (!row) return null;
    const workflow = publishingWorkflowSchema.parse(JSON.parse(row.data));
    const tasks = (
      database
        .prepare('SELECT data FROM publishing_tasks WHERE workflow_id = ? ORDER BY sort_order')
        .all(workflow.id) as Array<{ data: string }>
    ).map((item) => workflowTaskSchema.parse(JSON.parse(item.data)));
    return { workflow, tasks };
  }

  private save(bundle: PublishingBundle): void {
    const database = this.requireDatabase();
    database.exec('BEGIN');
    try {
      database
        .prepare(
          `INSERT INTO publishing_workflows (id, project_id, status, data) VALUES (?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET
             id = excluded.id,
             status = excluded.status,
             data = excluded.data`,
        )
        .run(bundle.workflow.id, bundle.workflow.projectId, bundle.workflow.status, JSON.stringify(bundle.workflow));
      database.prepare('DELETE FROM publishing_tasks WHERE project_id = ?').run(bundle.workflow.projectId);
      const insert = database.prepare(
        `INSERT INTO publishing_tasks (id, workflow_id, project_id, type, status, sort_order, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const task of bundle.tasks) {
        insert.run(task.id, task.workflowId, task.projectId, task.type, task.status, task.sortOrder, JSON.stringify(task));
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  private async toView(project: Project, bundle: PublishingBundle | null): Promise<PublishingView> {
    const files = publishFiles(project);
    const present = await this.presentFiles(files);
    const media = files.filter((file) => file.kind !== 'copy');
    const found = media.filter((file) => present.get(file.relativePath));
    const license = licenseSummary(
      project.audio.bgm ? this.getTrack(project.audio.bgm.audioTrackId) : null,
      platformsFor(publishingPresets(project)),
    );
    const autoChecks = precheckAuto(project, {
      exportFresh: project.guide.lastExport?.contentStamp === exportContentStamp(project),
      filesPresent: media.length > 0 && found.length === media.length,
      fileDetail:
        media.length === 0
          ? '書き出しファイルがまだありません'
          : `${found.length} / ${media.length} ファイル`,
      licenseOk: license.ok && !license.warn,
      licenseDetail: license.message,
    });
    const recordChecks = bundle
      ? recordAuto(project, bundle.tasks, (preset) => this.hasReview(project.id, preset))
      : [];
    return {
      workflow: bundle?.workflow ?? null,
      tasks: bundle?.tasks ?? [],
      current: bundle ? currentTask(bundle.tasks) : null,
      autoChecks,
      recordChecks,
      files,
      taken: this.taken(project),
      settings: this.getSettings(),
      started: bundle ? publishingStarted(bundle) : false,
    };
  }

  private taken(project: Project): TakenPostUrl[] {
    const fromAnalytics = this.takenUrls().filter((item) => item.url.trim());
    const fromProject = project.posts
      .filter((post) => post.url.trim())
      .map((post) => ({
        url: post.url,
        projectId: project.id,
        preset: post.preset,
        projectTitle: project.title,
      }));
    const seen = new Set(fromAnalytics.map((item) => `${item.projectId}:${item.preset}`));
    return [
      ...fromAnalytics,
      ...fromProject.filter((item) => !seen.has(`${item.projectId}:${item.preset}`)),
    ];
  }

  private async autoChecks(project: Project) {
    return (await this.toView(project, this.read(project.id))).autoChecks;
  }

  private async presentFiles(files: ReturnType<typeof publishFiles>): Promise<Map<string, boolean>> {
    const workspace = this.getWorkspace();
    const result = new Map<string, boolean>();
    if (!workspace) return result;
    const root = path.resolve(workspace);
    for (const file of files) {
      const resolved = path.resolve(root, file.relativePath);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        result.set(file.relativePath, false);
        continue;
      }
      try {
        await access(resolved);
        result.set(file.relativePath, true);
      } catch {
        result.set(file.relativePath, false);
      }
    }
    return result;
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) this.initialize();
    if (!this.database) throw new Error('保存先フォルダを先に選択してください');
    return this.database;
  }
}

export const publishProgressLabel = (bundle: PublishingBundle): string =>
  `${doneCount(bundle.tasks)} / ${bundle.tasks.length}`;
