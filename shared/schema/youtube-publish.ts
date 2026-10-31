import { z } from 'zod';
import { deliveryPresetIdSchema } from '../delivery-presets';
import { contentTypeSourceSchema, youtubeContentTypeSchema } from './youtube';

export const DEFAULT_PUBLISH_TIMEZONE = 'Asia/Tokyo';
export const SCHEDULE_LEAD_MS = 5 * 60 * 1000;
export const GAME_TITLE_MEMO = 'VALORANT';
export const DEFAULT_CATEGORY_ID = '20';
export const TITLE_MAX_CHARS = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
export const TAGS_MAX_CHARS = 500;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_RETRIES = 5;
export const RETRY_MAX_MS = 60_000;

export const operationStateSchema = z.enum([
  'draft',
  'uploading',
  'paused',
  'processing',
  'setting_metadata',
  'awaiting_studio',
  'ready_to_publish',
  'verifying',
  'idle',
  'action_required',
  'outcome_unknown',
]);
export type OperationState = z.infer<typeof operationStateSchema>;

export const publicationStateSchema = z.enum([
  'not_uploaded',
  'private',
  'unlisted',
  'scheduled',
  'public',
  'unknown',
  'unavailable',
]);
export type PublicationState = z.infer<typeof publicationStateSchema>;

export const publicationActionSchema = z.enum([
  'schedule',
  'reschedule',
  'cancelSchedule',
  'private',
  'unlisted',
  'public',
]);
export type PublicationAction = z.infer<typeof publicationActionSchema>;

export const studioCheckStatusSchema = z.enum(['unchecked', 'done', 'not_applicable']);
export const studioCheckMethodSchema = z.enum(['manual', 'api']);

export const relatedVideosModeSchema = z.enum(['unused', 'set']);
export const contentKindSchema = z.enum(['shorts', 'video']);

export const youtubePublishMetadataSchema = z.object({
  title: z.string().default(''),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  categoryId: z.string().default(DEFAULT_CATEGORY_ID),
  defaultLanguage: z.string().optional(),
  selfDeclaredMadeForKids: z.boolean().default(false),
  containsSyntheticMedia: z.boolean().default(false),
  hasPaidProductPlacement: z.boolean().default(false),
  playlistIds: z.array(z.string()).default([]),
  thumbnailPath: z.string().optional(),
  gameTitleMemo: z.string().default(GAME_TITLE_MEMO),
  relatedVideosMode: relatedVideosModeSchema.default('unused'),
  relatedVideoRefs: z.array(z.string()).default([]),
  translationJa: z.string().optional(),
  translationKo: z.string().optional(),
  brandPartnerNote: z.string().optional(),
  contentKind: contentKindSchema.default('shorts'),
});
export type YoutubePublishMetadata = z.infer<typeof youtubePublishMetadataSchema>;

/** 部分更新用。`.partial()` は default を埋めてしまい、送っていないタイトルや関連動画モードが空に戻る。 */
export const youtubePublishMetadataPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  defaultLanguage: z.string().optional(),
  selfDeclaredMadeForKids: z.boolean().optional(),
  containsSyntheticMedia: z.boolean().optional(),
  hasPaidProductPlacement: z.boolean().optional(),
  playlistIds: z.array(z.string()).optional(),
  thumbnailPath: z.string().optional(),
  gameTitleMemo: z.string().optional(),
  relatedVideosMode: relatedVideosModeSchema.optional(),
  relatedVideoRefs: z.array(z.string()).optional(),
  translationJa: z.string().optional(),
  translationKo: z.string().optional(),
  brandPartnerNote: z.string().optional(),
  contentKind: contentKindSchema.optional(),
});
export type YoutubePublishMetadataPatch = z.infer<typeof youtubePublishMetadataPatchSchema>;

export const youtubePublishPresetSchema = z.object({
  id: z.string(),
  deliveryPresetId: deliveryPresetIdSchema,
  channelId: z.string().optional(),
  metadata: youtubePublishMetadataSchema,
  updatedAt: z.string(),
});
export type YoutubePublishPreset = z.infer<typeof youtubePublishPresetSchema>;

export const fileFingerprintSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number(),
  sha256: z.string(),
});
export type FileFingerprint = z.infer<typeof fileFingerprintSchema>;

export const exportRefSchema = z.object({
  exportId: z.string(),
  projectId: z.string(),
  preset: deliveryPresetIdSchema,
  basename: z.string(),
  frozenAt: z.string(),
  contentStamp: z.string().optional(),
});
export type ExportRef = z.infer<typeof exportRefSchema>;

export const remoteVideoStateSchema = z.object({
  videoId: z.string(),
  channelId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  defaultLanguage: z.string().optional(),
  privacyStatus: z.string().optional(),
  publishAt: z.string().optional(),
  embeddable: z.boolean().optional(),
  license: z.string().optional(),
  publicStatsViewable: z.boolean().optional(),
  selfDeclaredMadeForKids: z.boolean().optional(),
  madeForKids: z.boolean().optional(),
  containsSyntheticMedia: z.boolean().optional(),
  uploadStatus: z.string().optional(),
  processingStatus: z.string().optional(),
  snippetPublishedAt: z.string().optional(),
  fingerprint: z.string(),
  fetchedAt: z.string(),
});
export type RemoteVideoState = z.infer<typeof remoteVideoStateSchema>;

export const studioChecklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: studioCheckStatusSchema.default('unchecked'),
  method: studioCheckMethodSchema.optional(),
  required: z.boolean().default(false),
  confirmedAt: z.string().optional(),
  targetRevision: z.number().int().optional(),
  reason: z.string().optional(),
});
export type StudioChecklistItem = z.infer<typeof studioChecklistItemSchema>;

export const publishStepResultSchema = z.object({
  step: z.enum(['insert', 'thumbnail', 'playlist', 'schedule', 'status']),
  targetId: z.string().optional(),
  status: z.enum(['pending', 'done', 'failed', 'unknown']),
  attempts: z.number().int().default(0),
  lastError: z.string().optional(),
  appliedAt: z.string().optional(),
});
export type PublishStepResult = z.infer<typeof publishStepResultSchema>;

export const publishHistoryEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  action: z.string(),
  source: z.enum(['app', 'studio', 'youtube', 'system']),
  oldValue: z.string().optional(),
  newValue: z.string().optional(),
});
export type PublishHistoryEvent = z.infer<typeof publishHistoryEventSchema>;

export const youtubePublishJobSchema = z.object({
  id: z.string(),
  revision: z.number().int().default(0),
  workflowTaskId: z.string().optional(),
  projectId: z.string(),
  exportId: z.string(),
  postId: z.string().optional(),
  channelId: z.string(),
  preset: deliveryPresetIdSchema,
  contentType: youtubeContentTypeSchema.default('SHORTS'),
  contentTypeSource: contentTypeSourceSchema.default('production'),
  file: fileFingerprintSchema,
  exportRef: exportRefSchema,
  metadata: youtubePublishMetadataSchema,
  metadataRevision: z.number().int().default(0),
  desiredPublishAt: z.string().optional(),
  timezone: z.string().default(DEFAULT_PUBLISH_TIMEZONE),
  youtubeVideoId: z.string().optional(),
  operationState: operationStateSchema.default('draft'),
  publicationState: publicationStateSchema.default('not_uploaded'),
  lastRemoteState: remoteVideoStateSchema.optional(),
  lastCheckedAt: z.string().optional(),
  everPublished: z.boolean().default(false),
  uploadedAt: z.string().optional(),
  scheduledPublishAt: z.string().optional(),
  firstObservedPublicAt: z.string().optional(),
  actualPublishedAt: z.string().optional(),
  publishedAtSource: z.enum(['api-public', 'manual', 'first-observed']).optional(),
  publicationConfirmedAt: z.string().optional(),
  studioChecks: z.array(studioChecklistItemSchema).default([]),
  steps: z.array(publishStepResultSchema).default([]),
  history: z.array(publishHistoryEventSchema).default([]),
  upload: z
    .object({
      totalBytes: z.number().int().nonnegative().default(0),
      serverReceivedBytes: z.number().int().nonnegative().default(0),
      lastCheckedAt: z.string().optional(),
      nextRetryAt: z.string().optional(),
      attempt: z.number().int().default(0),
    })
    .optional(),
  lastError: z.string().optional(),
  lastErrorKind: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type YoutubePublishJob = z.infer<typeof youtubePublishJobSchema>;

export const youtubePublishDraftInputSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  preset: deliveryPresetIdSchema,
  metadata: youtubePublishMetadataPatchSchema.optional(),
  desiredPublishAt: z.string().optional(),
  timezone: z.string().optional(),
});
export type YoutubePublishDraftInput = z.infer<typeof youtubePublishDraftInputSchema>;

export const youtubePublishUpdateInputSchema = z.object({
  jobId: z.string(),
  revision: z.number().int(),
  metadata: youtubePublishMetadataPatchSchema.optional(),
  desiredPublishAt: z.string().nullable().optional(),
  timezone: z.string().optional(),
});
export type YoutubePublishUpdateInput = z.infer<typeof youtubePublishUpdateInputSchema>;

export const publicationChangeInputSchema = z.object({
  jobId: z.string(),
  revision: z.number().int(),
  remoteFingerprint: z.string(),
  action: publicationActionSchema,
  publishAt: z.string().optional(),
  timezone: z.string().optional(),
});
export type PublicationChangeInput = z.infer<typeof publicationChangeInputSchema>;

export const studioConfirmInputSchema = z.object({
  jobId: z.string(),
  revision: z.number().int(),
  key: z.string(),
  status: studioCheckStatusSchema,
  reason: z.string().optional(),
});
export type StudioConfirmInput = z.infer<typeof studioConfirmInputSchema>;

export const bindVideoInputSchema = z.object({
  jobId: z.string(),
  revision: z.number().int(),
  videoId: z.string(),
  confirmed: z.literal(true),
});
export type BindVideoInput = z.infer<typeof bindVideoInputSchema>;

export const threeWayConflictSchema = z.object({
  code: z.literal('conflict'),
  message: z.string(),
  baseline: remoteVideoStateSchema.optional(),
  remote: remoteVideoStateSchema.optional(),
  local: z.record(z.string(), z.string().optional()),
});
export type ThreeWayConflict = z.infer<typeof threeWayConflictSchema>;

export type YoutubePublishProgress = {
  jobId: string;
  stage: 'hash' | 'session' | 'upload' | 'processing' | 'metadata' | 'done';
  sentBytes: number;
  totalBytes: number;
  message?: string;
};

export type YoutubeCategory = { id: string; title: string; assignable: boolean };
export type YoutubePlaylistOption = { id: string; title: string };

export type YoutubePublishView = {
  job: YoutubePublishJob | null;
  canPublish: boolean;
  channel?: { channelId: string; title: string; handle?: string };
  categories: YoutubeCategory[];
  playlists: YoutubePlaylistOption[];
  conflict?: ThreeWayConflict;
  bindCandidate?: { videoId: string; title: string; channelId: string; privacyStatus?: string };
};
