import type {
  AiGenerateRequest,
  AiGenerateResult,
  AiHandoffParseRequest,
  AiProviderChoice,
  AiPlanUsage,
  AiStatus,
} from './ai';
import type { AnalyticsBundle, AnalysisTask, Insight, MetricSnapshot } from './schema/analytics';
import type { DeliveryPresetId } from './delivery-presets';
import type { PublishingSettings, PublishingView, StudioNextAction, WorkflowTask } from './publishing';
import type { InheritItem, Project } from './schema/project';
import type { SceneKey } from './schema/project-keys';
import type { VideoStructureTemplate } from './video-structure';
import type { SyncRun, YoutubeStatus, YoutubeSyncProgress, YoutubeSyncSettings } from './schema/youtube';
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
  getAiStatus(): Promise<AiStatus>;
  getAiUsage(): Promise<AiPlanUsage | null>;
  setAiProvider(provider: AiProviderChoice): Promise<AiStatus>;
  generateAi(request: AiGenerateRequest): Promise<AiGenerateResult>;
  cancelAi(): Promise<void>;
  parseAiHandoff(request: AiHandoffParseRequest): Promise<AiGenerateResult>;
  onExportProgress(callback: (progress: ExportProgress) => void): () => void;
  getYoutubeStatus(): Promise<YoutubeStatus>;
  setYoutubeClient(clientId: string, clientSecret?: string): Promise<YoutubeStatus>;
  connectYoutube(): Promise<YoutubeStatus>;
  cancelYoutubeLogin(): Promise<void>;
  disconnectYoutube(): Promise<YoutubeStatus>;
  setYoutubeSettings(patch: Partial<YoutubeSyncSettings>): Promise<YoutubeStatus>;
  syncYoutube(): Promise<SyncRun>;
  cancelYoutubeSync(): Promise<void>;
  onYoutubeProgress(callback: (progress: YoutubeSyncProgress) => void): () => void;
}
