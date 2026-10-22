import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ExportProgress,
  ExportRequest,
  StudioApi,
} from '../../shared/ipc';
import type { Project } from '../../shared/schema/project';
import type { AudioRegistration } from '../../shared/schema/audio';

const api: StudioApi = {
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  createProject: (options) => ipcRenderer.invoke('project:create', options),
  openPath: (target: string) => ipcRenderer.invoke('project:open-path', target),
  revealPath: (target: string) => ipcRenderer.invoke('project:reveal-path', target),
  getPublishing: (projectId: string) => ipcRenderer.invoke('publishing:get', projectId),
  startPublishing: (projectId: string) => ipcRenderer.invoke('publishing:start', projectId),
  pausePublishing: (projectId: string) => ipcRenderer.invoke('publishing:pause', projectId),
  patchPublishing: (projectId, taskId, body) => ipcRenderer.invoke('publishing:patch', projectId, taskId, body),
  completePublishing: (projectId, taskId, body) =>
    ipcRenderer.invoke('publishing:complete', projectId, taskId, body),
  skipPublishing: (projectId, taskId, reason) =>
    ipcRenderer.invoke('publishing:skip', projectId, taskId, reason),
  needsFixPublishing: (projectId, publishTaskId) =>
    ipcRenderer.invoke('publishing:needs-fix', projectId, publishTaskId),
  recordPublishingUrl: (projectId, preset, url, postedAt) =>
    ipcRenderer.invoke('publishing:record-url', projectId, preset, url, postedAt),
  getPublishingSettings: () => ipcRenderer.invoke('publishing:settings-get'),
  setPublishingSettings: (settings) => ipcRenderer.invoke('publishing:settings-set', settings),
  getStudioNext: () => ipcRenderer.invoke('studio:next'),
  duplicateProject: (id: string) => ipcRenderer.invoke('project:duplicate', id),
  listProjects: () => ipcRenderer.invoke('project:list'),
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id),
  loadProject: (id: string) => ipcRenderer.invoke('project:load', id),
  saveProject: (project: Project) => ipcRenderer.invoke('project:save', project),
  exportBackup: () => ipcRenderer.invoke('project:export-backup'),
  importBackup: () => ipcRenderer.invoke('project:import-backup'),
  importVideo: (projectId: string) => ipcRenderer.invoke('media:import', projectId),
  inspectMedia: (path: string) => ipcRenderer.invoke('media:inspect', path),
  createProxy: (inputPath: string, projectId: string, assetId: string) =>
    ipcRenderer.invoke('media:proxy', inputPath, projectId, assetId),
  extractStill: (
    inputPath: string,
    projectId: string,
    stillId: string,
    seconds: number,
  ) => ipcRenderer.invoke('media:still', inputPath, projectId, stillId, seconds),
  listAudio: () => ipcRenderer.invoke('audio:list'),
  listAudioUsage: () => ipcRenderer.invoke('audio:usage'),
  getDefaultBgm: () => ipcRenderer.invoke('settings:get-default-bgm'),
  setDefaultBgm: (trackId: string | null) => ipcRenderer.invoke('settings:set-default-bgm', trackId),
  getDefaultAgent: () => ipcRenderer.invoke('settings:get-default-agent'),
  setDefaultAgent: (agentId: string) => ipcRenderer.invoke('settings:set-default-agent', agentId),
  getSceneDurationDefaults: () => ipcRenderer.invoke('settings:get-scene-durations'),
  setSceneDurationDefault: (sceneKey, seconds) =>
    ipcRenderer.invoke('settings:set-scene-duration', sceneKey, seconds),
  listVideoStructureTemplates: () => ipcRenderer.invoke('settings:list-video-structures'),
  saveVideoStructureTemplate: (template) =>
    ipcRenderer.invoke('settings:save-video-structure', template),
  deleteVideoStructureTemplate: (id) =>
    ipcRenderer.invoke('settings:delete-video-structure', id),
  exportPostsCsv: () => ipcRenderer.invoke('project:export-posts-csv'),
  getPathForFile: (file: unknown) => webUtils.getPathForFile(file as File),
  registerAudio: (registration: AudioRegistration, sourcePath?: string) =>
    ipcRenderer.invoke('audio:register', registration, sourcePath),
  exportProject: (request: ExportRequest) => ipcRenderer.invoke('export:start', request),
  getAnalytics: () => ipcRenderer.invoke('analytics:get'),
  saveAnalyticsSnapshot: (input) => ipcRenderer.invoke('analytics:snapshot', input),
  saveAnalyticsTask: (task) => ipcRenderer.invoke('analytics:task', task),
  completeAnalyticsReview: (taskId: string) => ipcRenderer.invoke('analytics:complete', taskId),
  saveAnalyticsExperiment: (experiment) => ipcRenderer.invoke('analytics:experiment', experiment),
  concludeAnalyticsExperiment: (experimentId: string, conclusion: string, summary: string) =>
    ipcRenderer.invoke('analytics:conclude', experimentId, conclusion, summary),
  archiveAnalyticsExperiment: (experimentId: string) => ipcRenderer.invoke('analytics:archive', experimentId),
  saveAnalyticsInsight: (insight) => ipcRenderer.invoke('analytics:insight', insight),
  setAnalyticsInsightStatus: (insightId: string, status) =>
    ipcRenderer.invoke('analytics:insight-status', insightId, status),
  linkAnalyticsConclusion: (input) => ipcRenderer.invoke('analytics:link', input),
  consumeAnalyticsDecision: (decisionId: string) => ipcRenderer.invoke('analytics:consume', decisionId),
  exportAnalyticsCsv: () => ipcRenderer.invoke('analytics:csv'),
  getAiStatus: () => ipcRenderer.invoke('ai:status'),
  getAiUsage: () => ipcRenderer.invoke('ai:usage'),
  setAiProvider: (provider) => ipcRenderer.invoke('ai:set-provider', provider),
  generateAi: (request) => ipcRenderer.invoke('ai:generate', request),
  cancelAi: () => ipcRenderer.invoke('ai:cancel'),
  parseAiHandoff: (request) => ipcRenderer.invoke('ai:parse-handoff', request),
  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ExportProgress): void =>
      callback(progress);
    ipcRenderer.on('export:progress', listener);
    return () => ipcRenderer.removeListener('export:progress', listener);
  },
  getYoutubeStatus: () => ipcRenderer.invoke('youtube:status'),
  setYoutubeClient: (clientId, clientSecret) => ipcRenderer.invoke('youtube:set-client', clientId, clientSecret),
  connectYoutube: () => ipcRenderer.invoke('youtube:connect'),
  cancelYoutubeLogin: () => ipcRenderer.invoke('youtube:cancel-login'),
  disconnectYoutube: () => ipcRenderer.invoke('youtube:disconnect'),
  setYoutubeSettings: (patch) => ipcRenderer.invoke('youtube:set-settings', patch),
  syncYoutube: () => ipcRenderer.invoke('youtube:sync'),
  cancelYoutubeSync: () => ipcRenderer.invoke('youtube:cancel-sync'),
  onYoutubeProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]): void =>
      callback(progress);
    ipcRenderer.on('youtube:progress', listener);
    return () => ipcRenderer.removeListener('youtube:progress', listener);
  },
};

contextBridge.exposeInMainWorld('studio', api);
