import type {
  AiGenerateRequest,
  AiGenerateResult,
  AiHandoffParseRequest,
  AiProviderChoice,
  AiPlanUsage,
  AiStatus,
} from './ai';
import type { AnalyticsBundle, AnalysisTask, Insight, MetricSnapshot } from './schema/analytics';
import type {
  CompetitorDetail,
  CompetitorListItem,
  CompetitorPreview,
  CompetitorReference,
  CompetitorResult,
  CompetitorSyncView,
} from './schema/competitor';
import type {
  CompetitorJot,
  CompetitorOverview,
  FeatureIdeaResult,
  FeatureTag,
  JotPage,
  ProfileEntry,
  ProfileMatrix,
  ProfileOptions,
  VideoPage,
} from './schema/competitor-observation';
import type { DeliveryPresetId } from './delivery-presets';
import type { LongStudioApi } from './long/ipc';
import type { PublishingSettings, PublishingView, StudioNextAction, WorkflowTask } from './publishing';
import type { InheritItem, Project } from './schema/project';
import type { SceneKey } from './schema/project-keys';
import type { VideoStructureTemplate } from './video-structure';
import type { YoutubeAnalysisRow, YoutubeExperimentLink, YoutubePostView } from './youtube-compare';
import type { SyncRun, YoutubeStatus, YoutubeSyncProgress, YoutubeSyncSettings } from './schema/youtube';
import type {
  YoutubePublishProgress,
  YoutubePublishView,
} from './schema/youtube-publish';
import type {
  AudioRegistration,
  AudioTrack,
  Platform,
} from './schema/audio';

export type MediaInfo = {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
};

export type ImportedVideo = {
  sourceName: string;
  relativePath: string;
  meta: MediaInfo;
  loudnessEnvelope: Array<{ time: number; level: number }>;
};

export type ProjectCreateOptions = {
  templateId?: Project['templateId'];
  title?: string;
  inheritFromId?: string;
  inheritItems?: InheritItem[];
  plannedPostDate?: string;
  agentId?: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  status: Project['status'];
  updatedAt: string;
  map: string;
  agent: string;
  templateId: Project['templateId'];
  completedSteps: number;
  nextStep: number;
  nextLabel: string;
  plannedPostDate?: string;
  pendingMetrics: number;
};

export type ExportResult = {
  files: string[];
  links: Partial<Record<DeliveryPresetId, string>>;
};

export type ExportRequest = {
  project: Project;
  presets?: DeliveryPresetId[];
  exportWithoutBgm?: boolean;
};

export type AudioUsageRecord = {
  id: string;
  audioTrackId: string;
  projectId: string;
  variantId: string;
  exportedAt: string;
};

export type ExportProgress = {
  language: 'ja' | 'en' | 'x';
  phase: 'bundle' | 'card' | 'video' | 'loudness' | 'nobgm' | 'thumbnail' | 'done';
  progress: number;
  remainingSec?: number;
};

export interface StudioApi {
  /** 横動画作成モード */
  long: LongStudioApi;
  selectWorkspace(): Promise<string | null>;
  getWorkspace(): Promise<string | null>;
  createProject(options?: ProjectCreateOptions): Promise<Project>;
  openPath(target: string): Promise<void>;
  revealPath(target: string): Promise<void>;
  getPublishing(projectId: string): Promise<PublishingView>;
  startPublishing(projectId: string): Promise<PublishingView>;
  pausePublishing(projectId: string): Promise<PublishingView>;
  patchPublishing(
    projectId: string,
    taskId: string,
    body: {
      checklist?: Array<{ id: string; checked: boolean }>;
      url?: string;
      postedAt?: string;
      qa?: WorkflowTask['qa'];
    },
  ): Promise<PublishingView>;
  completePublishing(
    projectId: string,
    taskId: string,
    body: {
      checklist?: Array<{ id: string; checked: boolean }>;
      url?: string;
      postedAt?: string;
      qa?: WorkflowTask['qa'];
    },
  ): Promise<{ project: Project; view: PublishingView }>;
  skipPublishing(
    projectId: string,
    taskId: string,
    reason?: string,
  ): Promise<{ project: Project; view: PublishingView }>;
  needsFixPublishing(projectId: string, publishTaskId: string): Promise<{ project: Project; view: PublishingView }>;
  recordPublishingUrl(
    projectId: string,
    preset: string,
    url: string,
    postedAt?: string,
  ): Promise<{ project: Project; view: PublishingView }>;
  getPublishingSettings(): Promise<PublishingSettings>;
  setPublishingSettings(settings: PublishingSettings): Promise<PublishingSettings>;
  getStudioNext(): Promise<StudioNextAction | null>;
  duplicateProject(id: string): Promise<Project>;
  listProjects(): Promise<ProjectSummary[]>;
  deleteProject(id: string): Promise<void>;
  loadProject(id: string): Promise<Project>;
  saveProject(project: Project): Promise<Project>;
  importVideo(projectId: string): Promise<ImportedVideo | null>;
  inspectMedia(path: string): Promise<MediaInfo>;
  createProxy(inputPath: string, projectId: string, assetId: string): Promise<string>;
  extractStill(
    inputPath: string,
    projectId: string,
    stillId: string,
    seconds: number,
  ): Promise<string>;
  listAudio(): Promise<AudioTrack[]>;
  listAudioUsage(): Promise<AudioUsageRecord[]>;
  getDefaultBgm(): Promise<string | null>;
  setDefaultBgm(trackId: string | null): Promise<string | null>;
  getDefaultAgent(): Promise<string>;
  setDefaultAgent(agentId: string): Promise<string>;
  getSceneDurationDefaults(): Promise<Partial<Record<SceneKey, number>>>;
  setSceneDurationDefault(
    sceneKey: SceneKey,
    seconds: number,
  ): Promise<Partial<Record<SceneKey, number>>>;
  listVideoStructureTemplates(): Promise<VideoStructureTemplate[]>;
  saveVideoStructureTemplate(
    template: VideoStructureTemplate,
  ): Promise<VideoStructureTemplate[]>;
  deleteVideoStructureTemplate(id: string): Promise<VideoStructureTemplate[]>;
  exportPostsCsv(): Promise<string | null>;
  exportBackup(): Promise<string | null>;
  importBackup(): Promise<number | null>;
  getPathForFile(file: unknown): string;
  registerAudio(
    registration: AudioRegistration,
    sourcePath?: string,
  ): Promise<AudioTrack | null>;
  exportProject(request: ExportRequest): Promise<ExportResult>;
  getAnalytics(): Promise<AnalyticsBundle>;
  saveAnalyticsSnapshot(input: {
    postId: string;
    ageBucket: MetricSnapshot['ageBucket'];
    capturedAt: string;
    values: Partial<MetricSnapshot>;
  }): Promise<AnalyticsBundle>;
  saveAnalyticsTask(task: AnalysisTask): Promise<AnalyticsBundle>;
  completeAnalyticsReview(taskId: string): Promise<AnalyticsBundle>;
  saveAnalyticsExperiment(experiment: unknown): Promise<AnalyticsBundle>;
  concludeAnalyticsExperiment(
    experimentId: string,
    conclusion: string,
    summary: string,
  ): Promise<AnalyticsBundle>;
  archiveAnalyticsExperiment(experimentId: string): Promise<AnalyticsBundle>;
  saveAnalyticsInsight(insight: unknown): Promise<AnalyticsBundle>;
  setAnalyticsInsightStatus(insightId: string, status: Insight['status']): Promise<AnalyticsBundle>;
  linkAnalyticsConclusion(input: {
    insightId: string;
    decisionId?: string;
    experimentId?: string;
  }): Promise<AnalyticsBundle>;
  consumeAnalyticsDecision(decisionId: string): Promise<AnalyticsBundle>;
  exportAnalyticsCsv(): Promise<string | null>;
  exportYoutubeAnalysis(kind: 'csv' | 'json'): Promise<string | null>;
  saveYoutubeManual(input: unknown): Promise<YoutubePostView>;
  linkAnalyticsPosts(input: { experimentId: string; postIds: string[]; windowKind: YoutubeExperimentLink['windowKind'] }): Promise<AnalyticsBundle>;
  getAiStatus(): Promise<AiStatus>;
  getAiUsage(): Promise<AiPlanUsage | null>;
  setAiProvider(provider: AiProviderChoice): Promise<AiStatus>;
  generateAi(request: AiGenerateRequest): Promise<AiGenerateResult>;
  cancelAi(): Promise<void>;
  parseAiHandoff(request: AiHandoffParseRequest): Promise<AiGenerateResult>;
  onExportProgress(callback: (progress: ExportProgress) => void): () => void;
  getYoutubeStatus(): Promise<YoutubeStatus>;
  setYoutubeClient(clientId: string, clientSecret?: string): Promise<YoutubeStatus>;
  connectYoutube(mode?: 'read' | 'publish'): Promise<YoutubeStatus>;
  cancelYoutubeLogin(): Promise<void>;
  disconnectYoutube(): Promise<YoutubeStatus>;
  disconnectYoutubeLocal(): Promise<YoutubeStatus>;
  setYoutubeSettings(patch: Partial<YoutubeSyncSettings>): Promise<YoutubeStatus>;
  syncYoutube(): Promise<SyncRun>;
  getYoutubeAnalysisIndex(): Promise<YoutubeAnalysisRow[]>;
  getYoutubePostView(postId: string): Promise<YoutubePostView>;
  cancelYoutubeSync(): Promise<void>;
  onYoutubeProgress(callback: (progress: YoutubeSyncProgress) => void): () => void;
  getYoutubePublish(projectId: string, taskId: string): Promise<YoutubePublishView>;
  createYoutubePublishDraft(input: unknown): Promise<YoutubePublishView>;
  updateYoutubePublishDraft(input: unknown): Promise<YoutubePublishView>;
  startYoutubeUpload(jobId: string, revision: number): Promise<YoutubePublishView>;
  reuploadYoutube(jobId: string, revision: number): Promise<YoutubePublishView>;
  pauseYoutubeUpload(jobId: string): Promise<YoutubePublishView>;
  resumeYoutubeUpload(jobId: string, revision: number): Promise<YoutubePublishView>;
  retryYoutubePublishStep(jobId: string, revision: number, step: 'thumbnail' | 'playlist'): Promise<YoutubePublishView>;
  openYoutubeStudio(jobId: string): Promise<{ url: string }>;
  confirmYoutubeStudioItem(input: unknown): Promise<YoutubePublishView>;
  refreshYoutubePublish(jobId: string): Promise<YoutubePublishView>;
  previewYoutubePublication(input: unknown): Promise<YoutubePublishView>;
  applyYoutubePublication(input: unknown): Promise<YoutubePublishView>;
  bindYoutubeVideoPreview(jobId: string, videoId: string): Promise<YoutubePublishView>;
  bindYoutubeVideo(input: unknown): Promise<YoutubePublishView>;
  listYoutubePlaylists(): Promise<Array<{ id: string; title: string }>>;
  listYoutubeCategories(): Promise<Array<{ id: string; title: string; assignable: boolean }>>;
  onYoutubePublishProgress(callback: (progress: YoutubePublishProgress) => void): () => void;
  previewCompetitorRegistration(text: string): Promise<CompetitorResult<CompetitorPreview>>;
  confirmCompetitorRegistration(previewId: string, keys: string[]): Promise<CompetitorResult<{ channels: CompetitorListItem[] }>>;
  listCompetitors(): Promise<CompetitorResult<CompetitorListItem[]>>;
  competitorDetail(id: string): Promise<CompetitorResult<CompetitorDetail>>;
  updateCompetitor(input: unknown): Promise<CompetitorResult<CompetitorDetail>>;
  archiveCompetitor(id: string): Promise<CompetitorResult<CompetitorListItem>>;
  removeCompetitor(id: string, keepNotes: boolean): Promise<CompetitorResult<{ id: string }>>;
  syncCompetitors(input?: unknown): Promise<CompetitorResult<CompetitorSyncView>>;
  cancelCompetitorSync(): Promise<CompetitorResult<CompetitorSyncView>>;
  competitorSyncStatus(): Promise<CompetitorResult<CompetitorSyncView>>;
  onCompetitorSyncProgress(callback: (view: CompetitorSyncView) => void): () => void;
  competitorOverview(): Promise<CompetitorResult<CompetitorOverview>>;
  competitorReferenceState(ids: string[]): Promise<CompetitorResult<CompetitorReference[]>>;
  classifyCompetitor(input: unknown): Promise<CompetitorResult<{ saved: true }>>;
  openCompetitorUrl(url: string): Promise<CompetitorResult<{ opened: true }>>;
  updateCompetitorSettings(input: unknown): Promise<CompetitorResult<CompetitorSyncView>>;
  competitorVideos(query: unknown): Promise<CompetitorResult<VideoPage>>;
  competitorJots(query: unknown): Promise<CompetitorResult<JotPage>>;
  saveCompetitorJot(input: unknown): Promise<CompetitorResult<CompetitorJot>>;
  removeCompetitorJot(id: string): Promise<CompetitorResult<{ id: string }>>;
  handOffCompetitorJots(ids: string[]): Promise<CompetitorResult<{ count: number }>>;
  competitorProfileMatrix(subjects: string[]): Promise<CompetitorResult<ProfileMatrix>>;
  saveCompetitorProfile(input: unknown): Promise<CompetitorResult<ProfileEntry>>;
  competitorProfileOptions(): Promise<CompetitorResult<ProfileOptions>>;
  competitorTags(): Promise<CompetitorResult<FeatureTag[]>>;
  saveCompetitorTag(input: unknown): Promise<CompetitorResult<FeatureTag>>;
  archiveCompetitorTag(id: string): Promise<CompetitorResult<{ id: string }>>;
  assignCompetitorTag(input: unknown): Promise<CompetitorResult<{ count: number }>>;
  unassignCompetitorTag(input: unknown): Promise<CompetitorResult<{ ok: true }>>;
  addCompetitorFocusUrls(input: unknown): Promise<CompetitorResult<{ added: string[]; invalid: string[] }>>;
  setCompetitorFocus(input: unknown): Promise<CompetitorResult<{ videoId: string; focus: boolean }>>;
  competitorFeatureIdeas(input: unknown): Promise<CompetitorResult<FeatureIdeaResult>>;
}
