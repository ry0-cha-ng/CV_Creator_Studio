import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dialog, shell } from 'electron';
import { pendingMetricsCount, postsToCsv } from '../../../shared/post-metrics';
import { applyInheritance, completedStepCount, defaultPostDate, nextGuideAction, shiftPostDate } from '../../../shared/guide';
import { assertProjectPersisted } from '../../../shared/project-persistence';
import {
  createDefaultProject,
  parseProject,
  type Project,
} from '../../../shared/schema/project';
import type { ProjectCreateOptions, ProjectSummary } from '../../../shared/ipc';
import { DEFAULT_WORKSPACE, patchStudioSettings, readStudioSettings } from './studio-settings';

export class ProjectService {
  private workspace: string | null = null;

  async initialize(): Promise<void> {
    const settings = await readStudioSettings();
    const saved = settings.workspace?.trim();
    const candidates =
      saved && saved !== DEFAULT_WORKSPACE ? [saved, DEFAULT_WORKSPACE] : [DEFAULT_WORKSPACE];
    for (const candidate of candidates) {
      try {
        await this.ensureWorkspace(candidate);
        this.workspace = candidate;
        if (saved !== candidate) await patchStudioSettings({ workspace: candidate });
        return;
      } catch (error) {
        console.error(`保存先を開けませんでした: ${candidate}`, error);
      }
    }
  }

  getWorkspace(): string | null {
    return this.workspace;
  }

  async setWorkspace(workspace: string): Promise<void> {
    await this.ensureWorkspace(workspace);
    this.workspace = workspace;
    await patchStudioSettings({ workspace });
  }

  async createProject(options?: ProjectCreateOptions): Promise<Project> {
    const workspace = this.requireWorkspace();
    const agentId = options?.agentId?.trim() || 'Phoenix';
    let project = createDefaultProject(
      randomUUID(),
      new Date().toISOString(),
      agentId === 'Sova'
        ? { id: 'Sova', ability: 'Recon Bolt' }
        : { id: agentId, ability: agentId === 'Phoenix' ? 'Curveball' : '' },
    );
    if (options?.templateId) project.templateId = options.templateId;
    if (options?.title?.trim()) project.title = options.title.trim();
    if (options?.plannedPostDate) project.plannedPostDate = options.plannedPostDate;
    project.guide = { ...project.guide, mode: 'guide', lastStep: 1 };
    if (options?.inheritFromId) {
      const source = await this.loadProject(options.inheritFromId);
      if (options.inheritItems && options.inheritItems.length > 0) {
        project = applyInheritance(project, source, options.inheritItems);
      } else if (source.plannedPostDate) {
        project.plannedPostDate = shiftPostDate(source.plannedPostDate);
      }
    }
    if (!options?.inheritFromId) {
      const previousExperiment = await this.latestExperiment();
      if (previousExperiment) project.experiment = previousExperiment;
    }
    if (!project.plannedPostDate) {
      const previous = await this.latestPlannedPostDate();
      project.plannedPostDate = previous ? shiftPostDate(previous) : defaultPostDate();
    }
    const directory = path.join(workspace, 'projects', project.id);
    await fs.mkdir(path.join(directory, 'stills'), { recursive: true });
    await fs.mkdir(path.join(directory, 'cache', 'proxies'), { recursive: true });
    return this.saveProject(project);
  }

  async duplicateProject(id: string): Promise<Project> {
    const source = await this.loadProject(id);
    const now = new Date().toISOString();
    const copy: Project = {
      ...structuredClone(source),
      id: randomUUID(),
      title: `${source.title} のコピー`,
      createdAt: now,
      updatedAt: now,
      lineup: {
        ...structuredClone(source.lineup),
        id: `lineup-${randomUUID()}`,
      },
      status: 'editing',
      posts: [],
      guide: {
        ...structuredClone(source.guide),
        mode: 'guide',
        lastExport: undefined,
        confirmedSteps: source.guide.confirmedSteps.filter((step) => step !== 'review'),
      },
    };
    const workspace = this.requireWorkspace();
    const directory = path.join(workspace, 'projects', copy.id);
    await fs.mkdir(path.join(directory, 'stills'), { recursive: true });
    await fs.mkdir(path.join(directory, 'cache', 'proxies'), { recursive: true });
    return this.saveProject(copy);
  }

  async saveProject(input: Project): Promise<Project> {
    const workspace = this.requireWorkspace();
    const stamped = {
      ...input,
      updatedAt: new Date().toISOString(),
    };
    const project = parseProject(stamped);
    const serialized = JSON.stringify(project, null, 2);
    assertProjectPersisted(stamped, JSON.parse(serialized));
    const directory = path.join(workspace, 'projects', project.id);
    await fs.mkdir(directory, { recursive: true });
    await this.atomicWrite(path.join(directory, 'project.json'), serialized);
    return project;
  }

  async exportBackup(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'バックアップの保存先を選択',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const workspace = this.requireWorkspace();
    const destination = path.join(
      result.filePaths[0],
      `CVCreatorStudio-backup-${new Date().toISOString().slice(0, 10)}`,
    );
    await fs.cp(path.join(workspace, 'projects'), path.join(destination, 'projects'), {
      recursive: true,
    });
    await fs.cp(path.join(workspace, 'library'), path.join(destination, 'library'), {
      recursive: true,
    });
    const databasePath = path.join(workspace, 'studio.db');
    try {
      await fs.copyFile(databasePath, path.join(destination, 'studio.db'));
    } catch {
      // 音源未登録の保存先にはデータベースがない。
    }
    return destination;
  }

  async importBackup(): Promise<number | null> {
    const result = await dialog.showOpenDialog({
      title: 'バックアップフォルダを選択',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const workspace = this.requireWorkspace();
    const projectSource = path.join(source, 'projects');
    const entries = await fs.readdir(projectSource, { withFileTypes: true });
    let imported = 0;
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const destination = path.join(workspace, 'projects', entry.name);
      try {
        await fs.access(destination);
      } catch {
        await fs.cp(path.join(projectSource, entry.name), destination, { recursive: true });
        imported += 1;
      }
    }
    await this.copyMissing(path.join(source, 'library'), path.join(workspace, 'library'));
    return imported;
  }

  async exportPostsCsv(): Promise<string | null> {
    const result = await dialog.showSaveDialog({
      title: '投稿の数字を書き出す',
      defaultPath: `cv-posts-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const projectsDirectory = path.join(this.requireWorkspace(), 'projects');
    const entries = await fs.readdir(projectsDirectory, { withFileTypes: true });
    const projects: Project[] = [];
    for (const entry of entries.filter((item) => item.isDirectory())) {
      try {
        projects.push(
          parseProject(
            JSON.parse(
              await fs.readFile(path.join(projectsDirectory, entry.name, 'project.json'), 'utf8'),
            ),
          ),
        );
      } catch {
        continue;
      }
    }
    await fs.writeFile(result.filePath, postsToCsv(projects), 'utf8');
    return result.filePath;
  }

  async deleteProject(id: string): Promise<void> {
    const projectsDirectory = path.resolve(this.requireWorkspace(), 'projects');
    const directory = path.resolve(projectsDirectory, this.safeId(id));
    if (!directory.startsWith(`${projectsDirectory}${path.sep}`)) {
      throw new Error('不正なプロジェクトIDです');
    }
    try {
      await fs.rm(directory, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('プロジェクトが見つかりません');
      }
      throw error;
    }
  }

  private async latestPlannedPostDate(): Promise<string | undefined> {
    const projectsDirectory = path.join(this.requireWorkspace(), 'projects');
    let entries: { isDirectory(): boolean; name: string }[] = [];
    try {
      entries = await fs.readdir(projectsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    let latestAt = '';
    let latestDate: string | undefined;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = JSON.parse(
          await fs.readFile(path.join(projectsDirectory, entry.name, 'project.json'), 'utf8'),
        ) as { updatedAt?: unknown; plannedPostDate?: unknown };
        if (typeof raw.updatedAt !== 'string' || raw.updatedAt < latestAt) continue;
        if (typeof raw.plannedPostDate !== 'string' || !raw.plannedPostDate) continue;
        latestAt = raw.updatedAt;
        latestDate = raw.plannedPostDate;
      } catch {
        continue;
      }
    }
    return latestDate;
  }

  private async latestExperiment(): Promise<Project['experiment'] | undefined> {
    const projectsDirectory = path.join(this.requireWorkspace(), 'projects');
    let entries: { isDirectory(): boolean; name: string }[] = [];
    try {
      entries = await fs.readdir(projectsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    let latestAt = '';
    let experiment: Project['experiment'] | undefined;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const project = parseProject(
          JSON.parse(
            await fs.readFile(path.join(projectsDirectory, entry.name, 'project.json'), 'utf8'),
          ),
        );
        if (project.updatedAt < latestAt) continue;
        latestAt = project.updatedAt;
        experiment = {
          phase: project.experiment.phase,
          series: project.experiment.series,
          testVariables: [],
          utmCampaign: project.experiment.utmCampaign,
        };
      } catch {
        continue;
      }
    }
    return experiment;
  }

  async loadProject(id: string): Promise<Project> {
    const filePath = path.join(
      this.requireWorkspace(),
      'projects',
      this.safeId(id),
      'project.json',
    );
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as { schemaVersion?: number };
    const project = parseProject(raw);
    if (raw.schemaVersion !== 7) {
      project.guide.lastStep = nextGuideAction(project).step;
      await this.atomicWrite(filePath, JSON.stringify(project, null, 2));
    }
    return project;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const projectsDirectory = path.join(this.requireWorkspace(), 'projects');
    const entries = await fs.readdir(projectsDirectory, { withFileTypes: true });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry): Promise<ProjectSummary | null> => {
          try {
            const project = await this.loadProject(entry.name);
            const action = nextGuideAction(project);
            return {
              id: project.id,
              title: project.title,
              status: project.status,
              updatedAt: project.updatedAt,
              map: project.lineup.map,
              agent: project.lineup.agent,
              templateId: project.templateId,
              completedSteps: completedStepCount(project),
              nextStep: action.step,
              nextLabel: action.label,
              plannedPostDate: project.plannedPostDate,
              pendingMetrics: pendingMetricsCount(project),
            };
          } catch {
            return null;
          }
        }),
    );
    return projects
      .filter((project): project is ProjectSummary => project !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async openPath(target: string): Promise<void> {
    const workspace = path.resolve(this.requireWorkspace());
    const resolved = path.resolve(path.isAbsolute(target) ? target : path.join(workspace, target));
    if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
      throw new Error('保存先の外は開けません');
    }
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  }

  async revealPath(target: string): Promise<void> {
    const workspace = path.resolve(this.requireWorkspace());
    const resolved = path.resolve(path.isAbsolute(target) ? target : path.join(workspace, target));
    if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
      throw new Error('保存先の外は開けません');
    }
    shell.showItemInFolder(resolved);
  }

  private requireWorkspace(): string {
    if (!this.workspace) {
      throw new Error('保存先フォルダを先に選択してください');
    }
    return this.workspace;
  }

  private safeId(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('不正なプロジェクトIDです');
    }
    return id;
  }

  private async ensureWorkspace(workspace: string): Promise<void> {
    await Promise.all(
      [
        'library/footage',
        'library/fonts',
        'library/brand',
        'library/bgm',
        'library/se',
        'projects',
        'exports',
        'logs',
      ].map((directory) => fs.mkdir(path.join(workspace, directory), { recursive: true })),
    );
  }

  private async copyMissing(source: string, destination: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(source, { withFileTypes: true });
    } catch {
      return;
    }
    await fs.mkdir(destination, { recursive: true });
    for (const entry of entries) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await this.copyMissing(from, to);
      } else {
        try {
          await fs.access(to);
        } catch {
          await fs.copyFile(from, to);
        }
      }
    }
  }

  private async atomicWrite(filePath: string, contents: string): Promise<void> {
    const temporaryPath = `${filePath}.tmp`;
    await fs.writeFile(temporaryPath, contents, 'utf8');
    await fs.rename(temporaryPath, filePath);
  }
}
