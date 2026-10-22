import { z } from 'zod';

export const youtubeContentTypeSchema = z.enum([
  'SHORTS',
  'VIDEO_ON_DEMAND',
  'LIVE_STREAM',
  'STORY',
  'UNKNOWN',
]);
export type YoutubeContentType = z.infer<typeof youtubeContentTypeSchema>;

export const contentTypeSourceSchema = z.enum(['analytics-api', 'production', 'manual', 'unknown']);
export type ContentTypeSource = z.infer<typeof contentTypeSourceSchema>;

export const importOriginSchema = z.enum(['cvcs', 'youtube-import']);

export const syncErrorKindSchema = z.enum([
  'auth',
  'permission',
  'quota',
  'rate-limit',
  'network',
  'server',
  'unsupported-query',
  'not-found',
  'cancelled',
  'unknown',
]);
export type SyncErrorKind = z.infer<typeof syncErrorKindSchema>;

/** no-data は「APIが行を返さなかった・理由は判別できない」。0 とは別に扱う。 */
export const metricStatusSchema = z.enum([
  'value',
  'not-fetched',
  'in-progress',
  'no-data',
  'unsupported',
  'auth-required',
  'failed',
]);
export type MetricStatus = z.infer<typeof metricStatusSchema>;

const optionalNumber = z.number().finite().optional();

export const youtubeChannelSchema = z.object({
  channelId: z.string(),
  title: z.string().default(''),
  handle: z.string().optional(),
  uploadsPlaylistId: z.string(),
  connectedAt: z.string(),
  lastSeenAt: z.string(),
});
export type YoutubeChannel = z.infer<typeof youtubeChannelSchema>;

export const youtubeVideoSchema = z.object({
  videoId: z.string(),
  channelId: z.string(),
  title: z.string().default(''),
  description: z.string().default(''),
  thumbnailUrl: z.string().optional(),
  publishedAt: z.string(),
  durationSec: optionalNumber,
  privacyStatus: z.string().optional(),
  /** Data API の現在値。期間の実績ではない。 */
  publicStats: z
    .object({
      viewCount: optionalNumber,
      likeCount: optionalNumber,
      commentCount: optionalNumber,
      fetchedAt: z.string(),
    })
    .optional(),
  contentType: youtubeContentTypeSchema.default('UNKNOWN'),
  contentTypeSource: contentTypeSourceSchema.default('unknown'),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  missingSince: z.string().optional(),
});
export type YoutubeVideo = z.infer<typeof youtubeVideoSchema>;

export const metadataChangeSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  field: z.enum(['title', 'description', 'durationSec', 'privacyStatus']),
  oldValue: z.string().optional(),
  newValue: z.string().optional(),
  /** first-observed は初回取得。公開当初から同じ値だったとはみなさない。 */
  kind: z.enum(['first-observed', 'detected-on-sync', 'changed-in-cvcs']),
  at: z.string(),
});
export type MetadataChange = z.infer<typeof metadataChangeSchema>;

export const DAILY_METRICS = [
  'views',
  'engagedViews',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
  'shares',
] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];

/** 日別値を足してよい指標。平均値・比率は含めない。 */
export const ADDITIVE_METRICS: ReadonlySet<DailyMetric> = new Set([
  'views',
  'engagedViews',
  'estimatedMinutesWatched',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
  'shares',
]);

export const dailyMetricsSchema = z.object(
  Object.fromEntries(DAILY_METRICS.map((key) => [key, optionalNumber])) as Record<DailyMetric, typeof optionalNumber>,
);
export type DailyMetrics = z.infer<typeof dailyMetricsSchema>;

export const youtubeDailyRowSchema = z.object({
  videoId: z.string(),
  /** Analytics の日付（America/Los_Angeles の暦日） */
  reportDate: z.string(),
  metrics: dailyMetricsSchema,
  fetchedAt: z.string(),
});
export type YoutubeDailyRow = z.infer<typeof youtubeDailyRowSchema>;

export const reportKindSchema = z.enum(['period-basic', 'retention', 'traffic-source']);
export type ReportKind = z.infer<typeof reportKindSchema>;

export const windowKindSchema = z.enum([
  'publish-calendar-7d',
  'publish-calendar-28d',
  'calendar-range',
  'available-range',
]);
export type WindowKind = z.infer<typeof windowKindSchema>;

export const reportStatusSchema = z.enum(['ok', 'no-data', 'unsupported', 'failed']);

export const youtubeReportSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  kind: reportKindSchema,
  windowKind: windowKindSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  timezone: z.literal('America/Los_Angeles'),
  dimensions: z.string(),
  filters: z.string(),
  metrics: z.array(z.string()),
  status: reportStatusSchema,
  errorKind: syncErrorKindSchema.optional(),
  errorMessage: z.string().optional(),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).default([]),
  fetchedAt: z.string(),
});
export type YoutubeReport = z.infer<typeof youtubeReportSchema>;

export const dateRangeSchema = z.object({ start: z.string(), end: z.string() });
export type DateRange = z.infer<typeof dateRangeSchema>;

export const syncErrorSchema = z.object({
  kind: syncErrorKindSchema,
  message: z.string(),
  at: z.string(),
});
export type SyncError = z.infer<typeof syncErrorSchema>;

export const syncStateSchema = z.object({
  key: z.string(),
  /** 取得が完了し、データの確定日（horizon）以内と確認できた範囲 */
  coveredRanges: z.array(dateRangeSchema).default([]),
  /** 実際に行が返った最終日 */
  lastDataDate: z.string().optional(),
  /** 最後に指定した終了日 */
  lastRequestedEnd: z.string().optional(),
  lastSuccessAt: z.string().optional(),
  lastError: syncErrorSchema.optional(),
  complete: z.boolean().optional(),
});
export type SyncState = z.infer<typeof syncStateSchema>;

export const syncRunStatusSchema = z.enum(['running', 'done', 'partial', 'failed', 'cancelled']);

export const syncRunSchema = z.object({
  id: z.string(),
  trigger: z.enum(['manual', 'startup']),
  status: syncRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  horizon: z.string().optional(),
  progress: z.object({ done: z.number().int(), total: z.number().int() }).default({ done: 0, total: 0 }),
  counts: z
    .object({
      videos: z.number().int().default(0),
      requests: z.number().int().default(0),
      dailyRows: z.number().int().default(0),
      reports: z.number().int().default(0),
      failures: z.number().int().default(0),
    })
    .default({ videos: 0, requests: 0, dailyRows: 0, reports: 0, failures: 0 }),
  errors: z
    .array(z.object({ scope: z.string(), kind: syncErrorKindSchema, message: z.string() }))
    .default([]),
});
export type SyncRun = z.infer<typeof syncRunSchema>;

export const youtubeSyncSettingsSchema = z.object({
  initialDays: z.number().int().min(7).max(3650).default(90),
  fromPublish: z.boolean().default(false),
  refetchDays: z.number().int().min(3).max(28).default(10),
  syncOnStartup: z.boolean().default(true),
});
export type YoutubeSyncSettings = z.infer<typeof youtubeSyncSettingsSchema>;

export const DEFAULT_YOUTUBE_SYNC_SETTINGS: YoutubeSyncSettings = youtubeSyncSettingsSchema.parse({});

export type YoutubeConnectionPhase = 'unconfigured' | 'disconnected' | 'connected' | 'reauth-required';

export type YoutubeSyncProgress = {
  runId: string;
  stage: 'channel' | 'ledger' | 'horizon' | 'content-type' | 'videos' | 'done';
  done: number;
  total: number;
  message?: string;
};

export type YoutubeStatus = {
  phase: YoutubeConnectionPhase;
  clientId: string;
  hasClientSecret: boolean;
  secureStorage: boolean;
  channel?: Pick<YoutubeChannel, 'channelId' | 'title' | 'handle'>;
  settings: YoutubeSyncSettings;
  running: boolean;
  lastRun?: SyncRun;
  horizon?: string;
  counts: { videos: number; linked: number; unlinked: number; withDaily: number };
};
