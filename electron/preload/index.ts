import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ExportProgress,
  ExportRequest,
  StudioApi,
} from '../../shared/ipc';
import type { Project } from '../../shared/schema/project';
import type { AudioRegistration } from '../../shared/schema/audio';

const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: unknown, value: T): void => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api: StudioApi = {
  long: {
    list: () => ipcRenderer.invoke('long:list'),
    load: (id) => ipcRenderer.invoke('long:load', id),
    save: (project) => ipcRenderer.invoke('long:save', project),
    create: (options) => ipcRenderer.invoke('long:create', options),
    duplicate: (id) => ipcRenderer.invoke('long:duplicate', id),
    remove: (id) => ipcRenderer.invoke('long:remove', id),
    shortSources: () => ipcRenderer.invoke('long:short-sources'),
    importMedia: (projectId, kind, paths) => ipcRenderer.invoke('long:import-media', projectId, kind, paths),
    importImages: (projectId, purpose, paths) => ipcRenderer.invoke('long:import-images', projectId, purpose, paths),
    importImageFolder: (projectId) => ipcRenderer.invoke('long:import-image-folder', projectId),
    extractAudio: (projectId, asset) => ipcRenderer.invoke('long:extract-audio', projectId, asset),
    relink: (projectId, asset) => ipcRenderer.invoke('long:relink', projectId, asset),
    checkAssets: (project) => ipcRenderer.invoke('long:check-assets', project),
    onMediaProgress: (callback) => subscribe('long:media-progress', callback),
    exportVideo: (request) => ipcRenderer.invoke('long:export', request),
    cancelExport: () => ipcRenderer.invoke('long:export-cancel'),
    onExportProgress: (callback) => subscribe('long:export-progress', callback),
    getCreateState: () => ipcRenderer.invoke('long:create-state-get'),
    setCreateState: (state) => ipcRenderer.invoke('long:create-state-set', state),
    openProjectFile: () => ipcRenderer.invoke('long:open-project-file'),
    projectFormat: (id) => ipcRenderer.invoke('long:project-format', id),
  },
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
  exportYoutubeAnalysis: (kind) => ipcRenderer.invoke('analytics:youtube-export', kind),
  saveYoutubeManual: (input) => ipcRenderer.invoke('youtube:manual', input),
  linkAnalyticsPosts: (input) => ipcRenderer.invoke('analytics:link-posts', input),
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
  connectYoutube: (mode) => ipcRenderer.invoke('youtube:connect', mode),
  cancelYoutubeLogin: () => ipcRenderer.invoke('youtube:cancel-login'),
  disconnectYoutube: () => ipcRenderer.invoke('youtube:disconnect'),
  disconnectYoutubeLocal: () => ipcRenderer.invoke('youtube:disconnect-local'),
  setYoutubeSettings: (patch) => ipcRenderer.invoke('youtube:set-settings', patch),
  syncYoutube: () => ipcRenderer.invoke('youtube:sync'),
  getYoutubeAnalysisIndex: () => ipcRenderer.invoke('youtube:analysis-index'),
  getYoutubePostView: (postId: string) => ipcRenderer.invoke('youtube:post-view', postId),
  cancelYoutubeSync: () => ipcRenderer.invoke('youtube:cancel-sync'),
  onYoutubeProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]): void =>
      callback(progress);
    ipcRenderer.on('youtube:progress', listener);
    return () => ipcRenderer.removeListener('youtube:progress', listener);
  },
  getYoutubePublish: (projectId, taskId) => ipcRenderer.invoke('youtube-publish:get', projectId, taskId),
  createYoutubePublishDraft: (input) => ipcRenderer.invoke('youtube-publish:create-draft', input),
  updateYoutubePublishDraft: (input) => ipcRenderer.invoke('youtube-publish:update-draft', input),
  startYoutubeUpload: (jobId, revision) => ipcRenderer.invoke('youtube-publish:start-upload', jobId, revision),
  reuploadYoutube: (jobId, revision) => ipcRenderer.invoke('youtube-publish:reupload', jobId, revision),
  pauseYoutubeUpload: (jobId) => ipcRenderer.invoke('youtube-publish:pause-upload', jobId),
  resumeYoutubeUpload: (jobId, revision) => ipcRenderer.invoke('youtube-publish:resume-upload', jobId, revision),
  retryYoutubePublishStep: (jobId, revision, step) =>
    ipcRenderer.invoke('youtube-publish:retry-step', jobId, revision, step),
  openYoutubeStudio: (jobId) => ipcRenderer.invoke('youtube-publish:open-studio', jobId),
  confirmYoutubeStudioItem: (input) => ipcRenderer.invoke('youtube-publish:confirm-studio', input),
  refreshYoutubePublish: (jobId) => ipcRenderer.invoke('youtube-publish:refresh', jobId),
  previewYoutubePublication: (input) => ipcRenderer.invoke('youtube-publish:preview-change', input),
  applyYoutubePublication: (input) => ipcRenderer.invoke('youtube-publish:apply-change', input),
  bindYoutubeVideoPreview: (jobId, videoId) => ipcRenderer.invoke('youtube-publish:bind-preview', jobId, videoId),
  bindYoutubeVideo: (input) => ipcRenderer.invoke('youtube-publish:bind', input),
  listYoutubePlaylists: () => ipcRenderer.invoke('youtube-publish:playlists'),
  listYoutubeCategories: () => ipcRenderer.invoke('youtube-publish:categories'),
  onYoutubePublishProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]): void =>
      callback(progress);
    ipcRenderer.on('youtube-publish:progress', listener);
    return () => ipcRenderer.removeListener('youtube-publish:progress', listener);
  },
  previewCompetitorRegistration: (text) => ipcRenderer.invoke('competitors:preview', { text }),
  confirmCompetitorRegistration: (previewId, keys) => ipcRenderer.invoke('competitors:confirm', { previewId, keys }),
  listCompetitors: () => ipcRenderer.invoke('competitors:list'),
  competitorDetail: (id) => ipcRenderer.invoke('competitors:detail', id),
  updateCompetitor: (input) => ipcRenderer.invoke('competitors:update', input),
  archiveCompetitor: (id) => ipcRenderer.invoke('competitors:archive', id),
  removeCompetitor: (id, keepNotes) => ipcRenderer.invoke('competitors:remove', { id, keepNotes }),
  syncCompetitors: (input) => ipcRenderer.invoke('competitors:sync', input),
  cancelCompetitorSync: () => ipcRenderer.invoke('competitors:cancel'),
  competitorSyncStatus: () => ipcRenderer.invoke('competitors:status'),
  onCompetitorSyncProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, view: Parameters<typeof callback>[0]): void => callback(view);
    ipcRenderer.on('competitors:sync-progress', listener);
    return () => ipcRenderer.removeListener('competitors:sync-progress', listener);
  },
  competitorOverview: () => ipcRenderer.invoke('competitors:overview'),
  competitorReferenceState: (ids) => ipcRenderer.invoke('competitors:references', ids),
  classifyCompetitor: (input) => ipcRenderer.invoke('competitors:classify', input),
  openCompetitorUrl: (url) => ipcRenderer.invoke('competitors:open', { url }),
  updateCompetitorSettings: (input) => ipcRenderer.invoke('competitors:global', input),
  competitorVideos: (query) => ipcRenderer.invoke('competitors:videos', query),
  competitorJots: (query) => ipcRenderer.invoke('competitors:jots:list', query),
  saveCompetitorJot: (input) => ipcRenderer.invoke('competitors:jots:save', input),
  removeCompetitorJot: (id) => ipcRenderer.invoke('competitors:jots:remove', id),
  handOffCompetitorJots: (ids) => ipcRenderer.invoke('competitors:jots:hand-off', { ids }),
  competitorProfileMatrix: (subjects) => ipcRenderer.invoke('competitors:profile:matrix', { subjects }),
  saveCompetitorProfile: (input) => ipcRenderer.invoke('competitors:profile:save', input),
  competitorProfileOptions: () => ipcRenderer.invoke('competitors:profile:options'),
  competitorTags: () => ipcRenderer.invoke('competitors:tags:list'),
  saveCompetitorTag: (input) => ipcRenderer.invoke('competitors:tags:save', input),
  archiveCompetitorTag: (id) => ipcRenderer.invoke('competitors:tags:archive', id),
  assignCompetitorTag: (input) => ipcRenderer.invoke('competitors:tags:assign', input),
  unassignCompetitorTag: (input) => ipcRenderer.invoke('competitors:tags:unassign', input),
  addCompetitorFocusUrls: (input) => ipcRenderer.invoke('competitors:focus:add-urls', input),
  setCompetitorFocus: (input) => ipcRenderer.invoke('competitors:focus:set', input),
  competitorFeatureIdeas: (input) => ipcRenderer.invoke('competitors:feature-ideas', input),
};

contextBridge.exposeInMainWorld('studio', api);
