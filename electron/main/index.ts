import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  protocol,
  safeStorage,
  shell,
} from 'electron';
import { applySceneDurationDefaults, defaultBgmPlacement } from '../../shared/timeline';
import type { SceneKey } from '../../shared/schema/project-keys';
import { AiService } from './services/ai-service';
import { AnalyticsService, refreshAnalytics } from './services/analytics-service';
import { aiProviderChoiceSchema } from '../../shared/ai';
import { catalogRootFromApp, resolveCatalogMediaFile } from './services/catalog-path';
import { ExportService } from './services/export-service';
import { LongExportService } from './services/long-export-service';
import { LongPublishingService } from './services/long-publishing-service';
import { isLongPreset } from '../../shared/delivery-presets';
import { LongProjectService } from './services/long-project-service';
import { LibraryService } from './services/library-service';
import { MediaService } from './services/media-service';
import { ProjectService } from './services/project-service';
import { PublishingService } from './services/publishing-service';
import { DEFAULT_WORKSPACE, patchStudioSettings, readStudioSettings } from './services/studio-settings';
import { asYoutubeError } from './services/youtube-error';
import { YoutubePublishStore } from './services/youtube-publish-store';
import { YoutubePublishingService } from './services/youtube-publishing-service';
import { CompetitorObservationService } from './services/competitor-observation-service';
import { CompetitorService } from './services/competitor-service';
import { createCompetitorApi, listPublicVideos, listUploadIds, lookupPublicChannel } from './services/competitor-youtube';
import { YoutubeService } from './services/youtube-service';
import { youtubeSyncSettingsSchema } from '../../shared/schema/youtube';
import { dueAtFor7d } from '../../shared/analytics';
import { publishingSettingsSchema, type PublishingView, type StudioNextAction } from '../../shared/publishing';
import type { Project } from '../../shared/schema/project';
import { videoStructureTemplateSchema } from '../../shared/video-structure';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'studio-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const projectService = new ProjectService();

const mediaService = new MediaService(() => projectService.getWorkspace());
const libraryService = new LibraryService(() => projectService.getWorkspace());
const analyticsService = new AnalyticsService(() => projectService.getWorkspace());
const publishingService = new PublishingService(
  () => projectService.getWorkspace(),
  (id) => projectService.loadProject(id),
  () => projectService.listProjects(),
  () => analyticsService.urlRows(),
  (projectId, preset) => analyticsService.has7d(projectId, preset),
  (id) => libraryService.getAudio(id),
);
const youtubeBox = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain: string) => safeStorage.encryptString(plain),
  decrypt: (cipher: Buffer) => safeStorage.decryptString(cipher),
};
const youtubeService = new YoutubeService({
  directory: app.getPath('userData'),
  box: youtubeBox,
  openExternal: (url) => shell.openExternal(url),
  analytics: analyticsService,
  hasWorkspace: () => Boolean(projectService.getWorkspace()),
  readSettings: async () => (await readStudioSettings()).youtubeSync,
  writeSettings: async (youtubeSync) => {
    await patchStudioSettings({ youtubeSync });
  },
  onProgress: (progress) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('youtube:progress', progress);
  },
});
const youtubePublishStore = new YoutubePublishStore(() => analyticsService.db());
const youtubePublishingService = new YoutubePublishingService({
  directory: app.getPath('userData'),
  box: youtubeBox,
  analytics: analyticsService,
  publishing: publishingService,
  auth: youtubeService.auth,
  youtubeStore: youtubeService.store,
  publishStore: youtubePublishStore,
  loadProject: (id) => projectService.loadProject(id),
  saveProject: async (project) => {
    const saved = await projectService.saveProject(project);
    analyticsService.syncProject(saved);
    return saved;
  },
  workspace: () => projectService.getWorkspace(),
  openExternal: (url) => shell.openExternal(url),
  onProgress: (progress) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('youtube-publish:progress', progress);
  },
  // 横動画（YouTube 通常動画）。呼び出し時に横動画のサービスを参照する
  long: {
    isLong: async (projectId) => (await longProjectService.projectFormat(projectId)).format === 'long',
    service: {
      draftSource: (projectId, preset) => longPublishingService.draftSource(projectId, preset),
      applyYoutubePublication: (projectId, taskId, input) => longPublishingService.applyYoutubePublication(projectId, taskId, input),
    },
  },
});
let competitorService: CompetitorService;
const competitorApi = createCompetitorApi({
  token: (force) => youtubeService.auth.accessToken(force),
  charge: () => competitorService.spend(),
});
const observationService = new CompetitorObservationService({
  database: () => analyticsService.db(),
  competitors: () => competitorService,
});
competitorService = new CompetitorService({
  database: () => analyticsService.db(),
  hooks: observationService.hooks,
  onProgress: (view) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('competitors:sync-progress', view);
  },
  port: {
    connected: async () => {
      const state = await youtubeService.auth.state();
      return state.connected && state.canRead && !state.needsReauth;
    },
    ownChannelId: () => {
      try {
        return youtubeService.store.channel()?.channelId;
      } catch {
        return undefined;
      }
    },
    priorityBusy: () => {
      if (youtubeService.reading()) return true;
      try {
        return youtubePublishStore.pendingJobs().some((job) =>
          job.operationState === 'uploading' || job.operationState === 'processing' || job.operationState === 'verifying',
        );
      } catch {
        return false;
      }
    },
    lookup: (parsed, signal) => lookupPublicChannel(competitorApi, parsed, signal),
    uploadsPage: (playlistId, pageToken, signal) => listUploadIds(competitorApi, playlistId, pageToken, signal),
    videos: (ids, signal) => listPublicVideos(competitorApi, ids, signal),
    openExternal: (url) => shell.openExternal(url),
  },
});
const aiService = new AiService();
const exportService = new ExportService(
  () => projectService.getWorkspace(),
  libraryService,
  (record) => analyticsService.freezePublishedExport(record),
);

const broadcast = (channel: string, value: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value);
};
const longProjectService = new LongProjectService(
  () => projectService.getWorkspace(),
  projectService,
  (progress) => broadcast('long:media-progress', progress),
);
const longExportService = new LongExportService(
  () => projectService.getWorkspace(),
  (id) => libraryService.getAudio(id),
  (snapshot) => {
    analyticsService.freezeLongExport(snapshot);
  },
  (trackId, projectId, variantId) => {
    try {
      libraryService.recordUsage(trackId, projectId, variantId, new Date().toISOString());
    } catch {
      // 使用履歴の記録に失敗しても書き出しは成功として扱う
    }
  },
);

const longPublishingService = new LongPublishingService({
  publishing: publishingService,
  analytics: analyticsService,
  loadProject: (id) => longProjectService.load(id),
  workspace: () => projectService.getWorkspace(),
  getTrack: (id) => libraryService.getAudio(id),
});

const registerLongIpc = (): void => {
  ipcMain.handle('long:publishing-get', (_event, projectId: string) => longPublishingService.view(String(projectId)));
  ipcMain.handle('long:publishing-start', (_event, projectId: string) => longPublishingService.start(String(projectId)));
  ipcMain.handle('long:publishing-patch', (_event, projectId: string, taskId: string, body) =>
    longPublishingService.patch(String(projectId), String(taskId), body ?? {}),
  );
  ipcMain.handle('long:publishing-complete', (_event, projectId: string, taskId: string, body) =>
    longPublishingService.complete(String(projectId), String(taskId), body ?? {}),
  );
  ipcMain.handle('long:publishing-skip', (_event, projectId: string, taskId: string, reason?: string) =>
    longPublishingService.skip(String(projectId), String(taskId), typeof reason === 'string' ? reason : undefined),
  );
  ipcMain.handle('long:publishing-needs-fix', (_event, projectId: string, taskId: string) =>
    longPublishingService.needsFix(String(projectId), String(taskId)),
  );
  ipcMain.handle('long:list', () => longProjectService.list());
  ipcMain.handle('long:load', (_event, id: string) => longProjectService.load(id));
  ipcMain.handle('long:save', (_event, project) => longProjectService.save(project));
  ipcMain.handle('long:create', (_event, options) => longProjectService.create(options));
  ipcMain.handle('long:duplicate', (_event, id: string) => longProjectService.duplicate(id));
  ipcMain.handle('long:remove', (_event, id: string) => longProjectService.remove(id));
  ipcMain.handle('long:short-sources', () => longProjectService.shortSources());
  ipcMain.handle('long:import-media', (_event, projectId: string, kind, paths?: string[]) =>
    longProjectService.importMedia(projectId, kind === 'image' ? 'image' : 'video', Array.isArray(paths) ? paths : undefined),
  );
  ipcMain.handle('long:import-images', (_event, projectId: string, purpose, paths?: string[]) =>
    longProjectService.importImages(
      projectId,
      purpose === 'avatar' || purpose === 'cutin' ? purpose : 'still',
      Array.isArray(paths) ? paths : undefined,
    ),
  );
  ipcMain.handle('long:import-image-folder', (_event, projectId: string) => longProjectService.importImageFolder(projectId));
  ipcMain.handle('long:extract-audio', (_event, projectId: string, asset) => longProjectService.extractAudio(projectId, asset));
  ipcMain.handle('long:relink', (_event, projectId: string, asset) => longProjectService.relink(projectId, asset));
  ipcMain.handle('long:check-assets', (_event, project) => longProjectService.checkAssets(project));
  ipcMain.handle('long:waveform', (_event, relativePath: string, from: number, duration: number, buckets: number) =>
    longProjectService.waveform(String(relativePath), Number(from), Number(duration), Number(buckets)),
  );
  ipcMain.handle('long:export', (event, request) => longExportService.export(request, event.sender));
  ipcMain.handle('long:export-cancel', () => longExportService.cancel());
  ipcMain.handle('long:create-state-get', async () => {
    const settings = await readStudioSettings();
    return { createMode: settings.createMode ?? 'short', lastLongProjectId: settings.lastLongProjectId };
  });
  ipcMain.handle('long:create-state-set', async (_event, state: { createMode?: unknown; lastLongProjectId?: unknown }) => {
    const patch: { createMode?: 'short' | 'long'; lastLongProjectId?: string } = {};
    if (state.createMode === 'short' || state.createMode === 'long') patch.createMode = state.createMode;
    if (typeof state.lastLongProjectId === 'string') patch.lastLongProjectId = state.lastLongProjectId;
    const settings = await patchStudioSettings(patch);
    return { createMode: settings.createMode ?? 'short', lastLongProjectId: settings.lastLongProjectId };
  });
  ipcMain.handle('long:open-project-file', () => longProjectService.openProjectFile());
  ipcMain.handle('long:project-format', (_event, id: string) => longProjectService.projectFormat(id));
};

const mediaContentType = (filePath: string): string => {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.ogg':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
};

const streamBody = (
  filePath: string,
  range?: { start: number; end: number },
): BodyInit =>
  Readable.toWeb(
    createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined),
  ) as BodyInit;

const serveMedia = async (request: Request, filePath: string): Promise<Response> => {
  const file = await stat(filePath);
  const contentType = mediaContentType(filePath);
  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  };
  const rangeHeader = request.headers.get('range');

  if (!rangeHeader) {
    return new Response(request.method === 'HEAD' ? null : streamBody(filePath), {
      status: 200,
      headers: {
        ...commonHeaders,
        'Content-Length': String(file.size),
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'Content-Range': `bytes */${file.size}` },
    });
  }

  const [, startText = '', endText = ''] = match;
  const suffixLength = startText === '' ? Number(endText) : null;
  const start =
    suffixLength !== null
      ? Math.max(0, file.size - suffixLength)
      : Number(startText);
  const requestedEnd = endText === '' || suffixLength !== null ? file.size - 1 : Number(endText);
  const end = Math.min(requestedEnd, file.size - 1);

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > end ||
    start >= file.size
  ) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'Content-Range': `bytes */${file.size}` },
    });
  }

  return new Response(
    request.method === 'HEAD' ? null : streamBody(filePath, { start, end }),
    {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${file.size}`,
      },
    },
  );
};

const appIconPath = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icon.png');

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    icon: appIconPath(),
    backgroundColor: '#0b1118',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  return window;
};

const registerIpc = (): void => {
  ipcMain.handle('workspace:get', () => projectService.getWorkspace());
  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      title: 'CV Creator Studioの保存先を選択',
      defaultPath: projectService.getWorkspace() ?? DEFAULT_WORKSPACE,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    youtubeService.cancelSync();
    competitorService.cancel();
    await projectService.setWorkspace(result.filePaths[0]);
    libraryService.initialize();
    analyticsService.initialize();
    competitorService.onWorkspaceChange();
    publishingService.initialize();
    return result.filePaths[0];
  });
  ipcMain.handle('project:create', async (_event, options) => {
    const agentId = libraryService.getDefaultAgentId();
    let project = await projectService.createProject({
      ...(options ?? {}),
      agentId: options?.agentId || agentId,
    });
    if (!project.audio.bgm) {
      const trackId = libraryService.getDefaultBgmId();
      const track = trackId ? libraryService.getAudio(trackId) : null;
      if (track && track.kind === 'bgm') {
        project = {
          ...project,
          audio: { ...project.audio, bgm: defaultBgmPlacement(project, track.id) },
        };
      }
    }
    const withDefaults = applySceneDurationDefaults(
      analyticsService.applyAdoptedDefaults(project),
      libraryService.getSceneDurationDefaults(),
    );
    const saved = await projectService.saveProject(withDefaults);
    analyticsService.syncProject(saved);
    return saved;
  });
  ipcMain.handle('project:duplicate', (_event, id: string) =>
    projectService.duplicateProject(id),
  );
  ipcMain.handle('project:list', () => projectService.listProjects());
  ipcMain.handle('project:delete', (_event, id: string) => projectService.deleteProject(id));
  ipcMain.handle('project:load', (_event, id: string) => projectService.loadProject(id));
  ipcMain.handle('project:save', async (_event, project) => {
    const saved = await projectService.saveProject(project);
    analyticsService.syncProject(saved);
    return saved;
  });
  ipcMain.handle('project:open-path', (_event, target: string) => projectService.openPath(target));
  ipcMain.handle('project:reveal-path', (_event, target: string) => projectService.revealPath(target));
  ipcMain.handle('project:export-backup', () => projectService.exportBackup());
  ipcMain.handle('project:import-backup', () => projectService.importBackup());
  ipcMain.handle('media:import', (_event, projectId: string) =>
    mediaService.importVideo(projectId),
  );
  ipcMain.handle('media:inspect', (_event, inputPath: string) =>
    mediaService.inspectMedia(inputPath),
  );
  ipcMain.handle(
    'media:proxy',
    (_event, inputPath: string, projectId: string, assetId: string) =>
      mediaService.createProxy(inputPath, projectId, assetId),
  );
  ipcMain.handle(
    'media:still',
    (
      _event,
      inputPath: string,
      projectId: string,
      stillId: string,
      seconds: number,
    ) => mediaService.extractStill(inputPath, projectId, stillId, seconds),
  );
  ipcMain.handle('settings:get-default-bgm', () =>
    projectService.getWorkspace() ? libraryService.getDefaultBgmId() : null,
  );
  ipcMain.handle('settings:get-default-agent', () =>
    projectService.getWorkspace() ? libraryService.getDefaultAgentId() : 'Phoenix',
  );
  ipcMain.handle('settings:set-default-agent', (_event, agentId: unknown) => {
    if (typeof agentId !== 'string') throw new Error('不正なエージェントです');
    return libraryService.setDefaultAgentId(agentId);
  });
  ipcMain.handle('settings:get-scene-durations', () =>
    projectService.getWorkspace() ? libraryService.getSceneDurationDefaults() : {},
  );
  ipcMain.handle('settings:set-scene-duration', (_event, sceneKey: unknown, seconds: unknown) => {
    if (typeof sceneKey !== 'string' || typeof seconds !== 'number') {
      throw new Error('秒数が不正です');
    }
    return libraryService.setSceneDurationDefault(sceneKey as SceneKey, seconds);
  });
  ipcMain.handle('settings:list-video-structures', () =>
    projectService.getWorkspace() ? libraryService.listVideoStructureTemplates() : [],
  );
  ipcMain.handle('settings:save-video-structure', (_event, input: unknown) =>
    libraryService.saveVideoStructureTemplate(videoStructureTemplateSchema.parse(input)),
  );
  ipcMain.handle('settings:delete-video-structure', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('構成テンプレートIDが不正です');
    return libraryService.deleteVideoStructureTemplate(id);
  });
  ipcMain.handle('project:export-posts-csv', () => projectService.exportPostsCsv());
  ipcMain.handle('settings:set-default-bgm', (_event, trackId: unknown) => {
    if (trackId !== null && typeof trackId !== 'string') {
      throw new Error('不正なBGMです');
    }
    return libraryService.setDefaultBgmId(trackId || null);
  });
  ipcMain.handle('audio:list', () => libraryService.listAudio());
  ipcMain.handle('audio:usage', () => libraryService.listUsage());
  ipcMain.handle('audio:register', (_event, registration, sourcePath?: string) =>
    libraryService.registerAudio(registration, sourcePath),
  );
  ipcMain.handle('export:start', (event, request) =>
    exportService.export(request, event.sender),
  );
  ipcMain.handle('analytics:get', async () => {
    const summaries = await projectService.listProjects();
    const projects = [];
    for (const item of summaries) {
      try {
        projects.push(await projectService.loadProject(item.id));
      } catch {
        continue;
      }
    }
    return refreshAnalytics(analyticsService, projects, (project) => projectService.saveProject(project));
  });
  ipcMain.handle('analytics:snapshot', async (_event, input) => {
    analyticsService.saveSnapshot(input.postId, input.ageBucket, input.capturedAt, input.values);
    if (input.ageBucket === '7d') {
      const post = analyticsService.bundle().posts.find((item) => item.id === input.postId);
      if (post?.projectId && !isLongPreset(post.preset)) {
        const project = await projectService.loadProject(post.projectId);
        const log = project.posts.find((item) => item.preset === post.preset);
        if (log) {
          const values = input.values ?? {};
          log.metrics = {
            capturedAt: input.capturedAt,
            ...(typeof values.views === 'number' ? { views: values.views } : {}),
            ...(typeof values.averagePercentageViewed === 'number'
              ? { avgViewPct: values.averagePercentageViewed }
              : {}),
            ...(typeof values.likes === 'number' ? { likes: values.likes } : {}),
            ...(typeof values.shares === 'number' ? { shares: values.shares } : {}),
            ...(typeof values.subscribersGained === 'number'
              ? { subscribersGained: values.subscribersGained }
              : {}),
            ...(typeof values.lineupSaves === 'number' ? { cvSaves: values.lineupSaves } : {}),
          };
          const saved = await projectService.saveProject(project);
          analyticsService.syncProject(saved);
        }
      }
    }
    return analyticsService.bundle();
  });
  ipcMain.handle('analytics:task', (_event, task) => analyticsService.saveTask(task));
  ipcMain.handle('analytics:complete', (_event, taskId: string) => analyticsService.completeReview(taskId));
  ipcMain.handle('analytics:experiment', (_event, experiment) => analyticsService.saveExperiment(experiment));
  ipcMain.handle('analytics:conclude', (_event, experimentId: string, conclusion: string, summary: string) =>
    analyticsService.concludeExperiment(experimentId, conclusion, summary),
  );
  ipcMain.handle('analytics:archive', (_event, experimentId: string) =>
    analyticsService.archiveExperiment(experimentId),
  );
  ipcMain.handle('analytics:insight', (_event, insight) => analyticsService.saveInsight(insight));
  ipcMain.handle('analytics:insight-status', (_event, insightId: string, status: string) =>
    analyticsService.setInsightStatus(insightId, status),
  );
  ipcMain.handle('analytics:link', (_event, input) => analyticsService.linkConclusion(input.insightId, input));
  ipcMain.handle('analytics:consume', (_event, decisionId: string) => analyticsService.consumeDecision(decisionId));
  ipcMain.handle('analytics:csv', async () => {
    const result = await dialog.showSaveDialog({
      title: '分析データを書き出す',
      defaultPath: `cv-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, analyticsService.csv(), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('analytics:youtube-export', async (_event, kind: 'csv' | 'json') => {
    const result = await dialog.showSaveDialog({
      title: kind === 'json' ? 'YouTube分析をJSONで書き出す' : 'YouTube分析をCSVで書き出す',
      defaultPath: `cv-youtube-${new Date().toISOString().slice(0, 10)}.${kind === 'json' ? 'json' : 'csv'}`,
      filters: [{ name: kind === 'json' ? 'JSON' : 'CSV', extensions: [kind === 'json' ? 'json' : 'csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, analyticsService.youtubeExport(kind === 'json' ? 'json' : 'csv'), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('youtube:manual', (_event, input) => analyticsService.saveManualMetric(input));
  ipcMain.handle('analytics:link-posts', (_event, input: { experimentId: string; postIds: string[]; windowKind: 'publish-calendar-7d' | 'publish-calendar-28d' }) =>
    analyticsService.linkPostsToExperiment(input.experimentId, input.postIds ?? [], input.windowKind),
  );
  const finishPublishing = async (
    result: { project: Project; view: PublishingView },
  ): Promise<{ project: Project; view: PublishingView }> => {
    const saved = await projectService.saveProject(result.project);
    analyticsService.syncProject(saved);
    if (publishingService.getSettings().enable24hCheck) analyticsService.ensure24hTasks();
    return { project: saved, view: await publishingService.view(saved.id) };
  };
  ipcMain.handle('publishing:get', (_event, projectId: string) => publishingService.view(projectId));
  ipcMain.handle('publishing:start', (_event, projectId: string) => publishingService.start(projectId));
  ipcMain.handle('publishing:pause', (_event, projectId: string) => publishingService.pause(projectId));
  ipcMain.handle('publishing:patch', (_event, projectId: string, taskId: string, body) =>
    publishingService.patch(projectId, taskId, body ?? {}),
  );
  ipcMain.handle('publishing:complete', async (_event, projectId: string, taskId: string, body) => {
    const project = await projectService.loadProject(projectId);
    return finishPublishing(await publishingService.complete(project, taskId, body ?? {}));
  });
  ipcMain.handle('publishing:skip', async (_event, projectId: string, taskId: string, reason?: string) => {
    const project = await projectService.loadProject(projectId);
    return finishPublishing(await publishingService.skip(project, taskId, reason));
  });
  ipcMain.handle(
    'publishing:record-url',
    async (_event, projectId: string, preset: string, url: string, postedAt?: string) => {
      const project = await projectService.loadProject(projectId);
      return finishPublishing(await publishingService.recordUrl(project, preset, url, postedAt));
    },
  );
  ipcMain.handle('publishing:needs-fix', async (_event, projectId: string, publishTaskId: string) => {
    const project = await projectService.loadProject(projectId);
    return finishPublishing(await publishingService.needsFix(project, publishTaskId));
  });
  ipcMain.handle('publishing:settings-get', () => publishingService.getSettings());
  ipcMain.handle('publishing:settings-set', (_event, settings) =>
    publishingService.setSettings(publishingSettingsSchema.parse(settings)),
  );
  ipcMain.handle('studio:next', async (): Promise<StudioNextAction | null> => {
    const publish = await publishingService.nextPublishAction();
    if (publish) return publish;
    const bundle = analyticsService.bundle();
    const analysis = bundle.tasks
      .filter((task) => task.status === 'ready' && task.type !== 'weekly-review' && task.postId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (analysis?.postId) {
      const post = bundle.posts.find((item) => item.id === analysis.postId);
      return {
        kind: 'analysis',
        projectId: post?.projectId ?? '',
        title: post?.content.title || '振り返り',
        headline: analysis.type === '24h-check' ? '24時間の数字を見てください' : '7日後の振り返りです',
        detail: post ? `${post.content.map} / ${post.content.agent} / ${post.content.site}` : '',
        meta: post ? dueAtFor7d(post.postedAt).slice(0, 10) : '',
        remaining: bundle.tasks.filter((task) => task.status === 'ready' && task.id !== analysis.id).length,
        progress: '',
        analysisTaskId: analysis.id,
        thumbnailPath: post?.content.thumbnailPath,
        chip: analysis.type === '24h-check' ? '24h' : '7d',
      };
    }
    const projects = await projectService.listProjects();
    const producing = projects.find((item) => item.status === 'editing');
    if (!producing) return null;
    return {
      kind: 'produce',
      projectId: producing.id,
      title: producing.title,
      headline: producing.nextLabel,
      detail: `${producing.map} / ${producing.agent}`,
      meta: '制作の続き',
      remaining: 0,
      progress: `${producing.completedSteps} / 10`,
      step: producing.nextStep,
      chip: '制作',
    };
  });
  const youtube = async <T>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      throw new Error(asYoutubeError(error).message);
    }
  };
  ipcMain.handle('youtube:status', () => youtube(() => youtubeService.status()));
  ipcMain.handle('youtube:set-client', (_event, clientId: unknown, clientSecret: unknown) => {
    if (typeof clientId !== 'string') throw new Error('クライアントIDが不正です');
    return youtube(() =>
      youtubeService.setClient(clientId, typeof clientSecret === 'string' ? clientSecret : undefined),
    );
  });
  ipcMain.handle('youtube:connect', (_event, mode?: unknown) =>
    youtube(() => youtubeService.connect(mode === 'publish' ? 'publish' : 'read')),
  );
  ipcMain.handle('youtube:cancel-login', () => youtubeService.cancelLogin());
  ipcMain.handle('youtube:disconnect', () => youtube(() => youtubeService.disconnect()));
  ipcMain.handle('youtube:disconnect-local', () => youtube(() => youtubeService.disconnectLocal()));
  ipcMain.handle('youtube-publish:get', (_event, projectId: unknown, taskId: unknown) => {
    if (typeof projectId !== 'string' || typeof taskId !== 'string') throw new Error('ジョブの指定が不正です');
    return youtube(() => youtubePublishingService.view(projectId, taskId));
  });
  ipcMain.handle('youtube-publish:create-draft', (_event, input: unknown) =>
    youtube(() => youtubePublishingService.createDraft(input)),
  );
  ipcMain.handle('youtube-publish:update-draft', (_event, input: unknown) =>
    youtube(() => youtubePublishingService.updateDraft(input)),
  );
  ipcMain.handle('youtube-publish:start-upload', (_event, jobId: unknown, revision: unknown) => {
    if (typeof jobId !== 'string' || typeof revision !== 'number') throw new Error('ジョブの指定が不正です');
    return youtube(() => youtubePublishingService.startUpload(jobId, revision));
  });
  ipcMain.handle('youtube-publish:reupload', (_event, jobId: unknown, revision: unknown) => {
    if (typeof jobId !== 'string' || typeof revision !== 'number') throw new Error('ジョブの指定が不正です');
    return youtube(() => youtubePublishingService.reupload(jobId, revision));
  });
  ipcMain.handle('youtube-publish:pause-upload', (_event, jobId: unknown) => {
    if (typeof jobId !== 'string') throw new Error('ジョブの指定が不正です');
    return youtube(() => youtubePublishingService.pauseUpload(jobId));
  });
  ipcMain.handle('youtube-publish:resume-upload', (_event, jobId: unknown, revision: unknown) => {
    if (typeof jobId !== 'string' || typeof revision !== 'number') throw new Error('ジョブの指定が不正です');
    return youtube(() => youtubePublishingService.resumeUpload(jobId, revision));
  });
  ipcMain.handle('youtube-publish:retry-step', (_event, jobId: unknown, revision: unknown, step: unknown) => {
    if (typeof jobId !== 'string' || typeof revision !== 'number' || (step !== 'thumbnail' && step !== 'playlist')) {
      throw new Error('再実行の指定が不正です');
    }
    return youtube(() => youtubePublishingService.retryStep(jobId, revision, step));
  });
  ipcMain.handle('youtube-publish:open-studio', (_event, jobId: unknown) => {
    if (typeof jobId !== 'string') throw new Error('ジョブの指定が不正です');
    return youtube(() => youtubePublishingService.openStudio(jobId));
  });
  ipcMain.handle('youtube-publish:confirm-studio', (_event, input: unknown) =>
    youtube(() => youtubePublishingService.confirmStudioItem(input)),
  );
  ipcMain.handle('youtube-publish:refresh', (_event, jobId: unknown) => {
    if (typeof jobId !== 'string') throw new Error('ジョブの指定が不正です');
    return youtube(() => youtubePublishingService.refreshRemoteState(jobId));
  });
  ipcMain.handle('youtube-publish:preview-change', (_event, input: unknown) =>
    youtube(() => youtubePublishingService.previewPublicationChange(input)),
  );
  ipcMain.handle('youtube-publish:apply-change', (_event, input: unknown) =>
    youtube(() => youtubePublishingService.applyPublicationChange(input)),
  );
  ipcMain.handle('youtube-publish:bind-preview', (_event, jobId: unknown, videoId: unknown) => {
    if (typeof jobId !== 'string' || typeof videoId !== 'string') throw new Error('動画IDの指定が不正です');
    return youtube(() => youtubePublishingService.bindPreview(jobId, videoId));
  });
  ipcMain.handle('youtube-publish:bind', (_event, input: unknown) =>
    youtube(() => youtubePublishingService.bindManualVideo(input)),
  );
  ipcMain.handle('youtube-publish:playlists', () => youtube(() => youtubePublishingService.listPlaylists()));
  ipcMain.handle('youtube-publish:categories', () => youtube(() => youtubePublishingService.listCategories()));
  ipcMain.handle('youtube:set-settings', (_event, patch: unknown) =>
    youtube(() => youtubeService.setSettings(youtubeSyncSettingsSchema.partial().parse(patch))),
  );
  ipcMain.handle('youtube:analysis-index', () => analyticsService.analysisIndex());
  ipcMain.handle('youtube:post-view', (_event, postId: string) => analyticsService.postView(postId));
  ipcMain.handle('youtube:sync', () => youtube(() => youtubeService.startSync('manual')));
  ipcMain.handle('youtube:cancel-sync', () => youtubeService.cancelSync());
  ipcMain.handle('ai:status', () => aiService.status());
  ipcMain.handle('ai:usage', () => aiService.planUsage());
  ipcMain.handle('ai:set-provider', (_event, provider: unknown) => {
    const parsed = aiProviderChoiceSchema.safeParse(provider);
    if (!parsed.success) throw new Error('不正なAIの経路です');
    return aiService.setProvider(parsed.data);
  });
  ipcMain.handle('ai:generate', (_event, request: unknown) => aiService.generate(request));
  ipcMain.handle('ai:cancel', () => {
    aiService.cancel();
  });
  ipcMain.handle('ai:parse-handoff', (_event, request: unknown) => aiService.parseHandoff(request));
  ipcMain.handle('competitors:preview', (_event, input: unknown) => competitorService.preview(input));
  ipcMain.handle('competitors:confirm', (_event, input: unknown) => competitorService.confirm(input));
  ipcMain.handle('competitors:list', () => competitorService.list());
  ipcMain.handle('competitors:detail', (_event, id: unknown) =>
    competitorService.detail(typeof id === 'string' ? id : ''),
  );
  ipcMain.handle('competitors:update', (_event, input: unknown) => competitorService.updateSettings(input));
  ipcMain.handle('competitors:archive', (_event, id: unknown) =>
    competitorService.archive(typeof id === 'string' ? id : ''),
  );
  ipcMain.handle('competitors:remove', (_event, input: unknown) => competitorService.remove(input));
  ipcMain.handle('competitors:sync', (_event, input: unknown) => competitorService.sync(input));
  ipcMain.handle('competitors:cancel', () => competitorService.cancel());
  ipcMain.handle('competitors:status', () => competitorService.syncStatus());
  ipcMain.handle('competitors:overview', () => {
    const channels = competitorService.list();
    if (!channels.ok) return channels;
    const sync = competitorService.syncStatus();
    if (!sync.ok) return sync;
    const observation = observationService.summary();
    if (!observation.ok) return observation;
    return { ok: true, data: { channels: channels.data, sync: sync.data, observation: observation.data } };
  });
  ipcMain.handle('competitors:references', (_event, ids: unknown) => observationService.referenceState(ids));
  ipcMain.handle('competitors:classify', (_event, input: unknown) => competitorService.classify(input));
  ipcMain.handle('competitors:open', (_event, input: unknown) => competitorService.openExternal(input));
  ipcMain.handle('competitors:global', (_event, input: unknown) => competitorService.updateGlobal(input));
  ipcMain.handle('competitors:videos', (_event, query: unknown) => observationService.videos(query));
  ipcMain.handle('competitors:jots:list', (_event, query: unknown) => observationService.jots(query));
  ipcMain.handle('competitors:jots:save', (_event, input: unknown) => observationService.saveJot(input));
  ipcMain.handle('competitors:jots:remove', (_event, id: unknown) => observationService.removeJot(id));
  ipcMain.handle('competitors:jots:hand-off', (_event, input: unknown) => observationService.handOff(input));
  ipcMain.handle('competitors:profile:matrix', (_event, input: unknown) => observationService.profileMatrix(input));
  ipcMain.handle('competitors:profile:save', (_event, input: unknown) => observationService.saveProfile(input));
  ipcMain.handle('competitors:profile:options', () => observationService.profileOptions());
  ipcMain.handle('competitors:tags:list', () => observationService.tags());
  ipcMain.handle('competitors:tags:save', (_event, input: unknown) => observationService.saveTag(input));
  ipcMain.handle('competitors:tags:archive', (_event, id: unknown) => observationService.archiveTag(id));
  ipcMain.handle('competitors:tags:assign', (_event, input: unknown) => observationService.assignTag(input));
  ipcMain.handle('competitors:tags:unassign', (_event, input: unknown) => observationService.unassignTag(input));
  ipcMain.handle('competitors:focus:add-urls', (_event, input: unknown) => observationService.addFocusUrls(input));
  ipcMain.handle('competitors:focus:set', (_event, input: unknown) => observationService.setFocus(input));
  ipcMain.handle('competitors:feature-ideas', async (_event, input: unknown) => {
    const prepared = observationService.featureIdeaInput(input);
    if (!prepared.ok) return prepared;
    const ideas = await aiService.featureIdeas(prepared.data.sent);
    if (!ideas.ok) return ideas;
    return { ok: true, data: observationService.resolveIdeas(ideas.data, prepared.data) };
  });
};

app.whenReady().then(async () => {
  await projectService.initialize();
  if (projectService.getWorkspace()) {
    libraryService.initialize();
    analyticsService.initialize();
    competitorService.onWorkspaceChange();
    publishingService.initialize();
  }
  protocol.handle('studio-media', async (request) => {
    const url = new URL(request.url);
    const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const catalogFile = resolveCatalogMediaFile(
      catalogRootFromApp(app.getAppPath(), process.resourcesPath, app.isPackaged),
      relativePath,
    );
    if (catalogFile) {
      return serveMedia(request, catalogFile);
    }
    return serveMedia(request, mediaService.resolveWorkspacePath(relativePath));
  });
  registerIpc();
  registerLongIpc();
  createWindow();
  const catchUpYoutube = (): void => {
    youtubeService.syncOnStartup().catch(() => undefined);
    youtubePublishingService.reconcilePendingJobs().catch(() => undefined);
  };
  setTimeout(catchUpYoutube, 5_000);
  competitorService.arm();
  setTimeout(() => {
    void competitorService.catchUp();
  }, 20_000);
  powerMonitor.on('resume', catchUpYoutube);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
