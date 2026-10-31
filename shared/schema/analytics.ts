import { z } from 'zod';
import { deliveryPresetIdSchema } from '../delivery-presets';
import { contentTypeSourceSchema, importOriginSchema, youtubeContentTypeSchema } from './youtube';

const analyticsLangSchema = z.enum(['ja', 'en']);
const analyticsHookSchema = z.enum([
  'result',
  'number',
  'question',
  'scarcity',
  'score',
  'versatile',
  'newmap',
  'custom',
]);

export const ageBucketSchema = z.enum(['1h', '24h', '7d', '30d', 'custom']);
export type AgeBucket = z.infer<typeof ageBucketSchema>;

export const snapshotSourceSchema = z.enum([
  'manual',
  'csv',
  'youtube-api',
  'tiktok-api',
  'clutchvault-api',
]);

export const openingTypeSchema = z.enum([
  'result-first',
  'stand-first',
  'aim-first',
  'highlight-first',
  'question-first',
  'other',
]);
export type OpeningType = z.infer<typeof openingTypeSchema>;

export const structureTypeSchema = z.enum([
  'lineup-only',
  'lineup-demo',
  'multi-lineup',
  'highlight-led',
  'other',
]);

export const ctaTypeSchema = z.enum([
  'none',
  'clutchvault-save',
  'profile-link',
  'related-video',
  'like-revisit',
  'other',
]);

export const lineupCategorySchema = z.enum([
  'post-plant',
  'retake',
  'attack',
  'defense',
  'one-way',
  'setup',
  'other',
]);

export const primaryVariableSchema = z.enum([
  'map',
  'lang',
  'hook',
  'opening',
  'length',
  'cta',
  'bgm',
  'postTime',
  'agent',
  'ability',
  'thumbnail',
]);
export type PrimaryVariable = z.infer<typeof primaryVariableSchema>;

export const primaryMetricSchema = z.enum([
  'views',
  'averagePercentageViewed',
  'completionRate',
  'appCtr',
  'lineupSaves',
]);
export type PrimaryMetric = z.infer<typeof primaryMetricSchema>;

export const experimentStatusSchema = z.enum(['planned', 'running', 'completed', 'archived']);
export const experimentConclusionSchema = z.enum(['adopt', 'hold', 'reject', 'inconclusive']);
export const experimentArmSchema = z.enum(['control', 'variant']);
export type ExperimentArm = z.infer<typeof experimentArmSchema>;

export const analysisTaskTypeSchema = z.enum([
  '24h-check',
  '7d-review',
  '30d-review',
  'weekly-review',
]);
export const analysisTaskStatusSchema = z.enum([
  'waiting',
  'ready',
  'in-progress',
  'done',
  'skipped',
]);

export const hypothesisJudgementSchema = z.enum(['support', 'undecided', 'reject']);
export const noticeSchema = z.enum([
  'hook',
  'length',
  'demand',
  'postTime',
  'cta',
  'unsure',
  'other',
]);
export type Notice = z.infer<typeof noticeSchema>;
export const nextActionSchema = z.enum(['adopt', 'continue', 'reject', 'new-variable', 'hold']);
export type NextAction = z.infer<typeof nextActionSchema>;

export const decisionConclusionSchema = z.enum([
  'adopt',
  'continue-test',
  'reject',
  'hold',
  'inconclusive',
]);

export const insightStatusSchema = z.enum(['adopted', 'testing', 'rejected']);
export type InsightStatus = z.infer<typeof insightStatusSchema>;
export const insightBasisSchema = z.enum(['experiment', 'decision', 'policy', 'external_observation']);

const optionalNumber = z.number().finite().optional();

export const postContentSchema = z.object({
  title: z.string().default(''),
  map: z.string().default(''),
  site: z.string().default(''),
  side: z.string().default(''),
  agent: z.string().default(''),
  ability: z.string().default(''),
  lineupCategory: lineupCategorySchema.optional(),
  series: z.string().default('phoenix-lineups'),
  templateId: z.string().default('t-std'),
  hookPattern: analyticsHookSchema.default('custom'),
  openingType: openingTypeSchema.optional(),
  structureType: structureTypeSchema.optional(),
  ctaType: ctaTypeSchema.optional(),
  thumbnailLayout: z.enum(['classic', 'focus']).optional(),
  ctaCopy: z.string().optional(),
  ctaMotion: z.boolean().optional(),
  durationSec: optionalNumber,
  durationLabel: z.string().optional(),
  withBgm: z.boolean().optional(),
  bgmTrackId: z.string().optional(),
  thumbnailPath: z.string().optional(),
});
export type PostContent = z.infer<typeof postContentSchema>;

export const analyticsPostSchema = z.object({
  id: z.string(),
  /** YouTubeから取り込んだCVCS外の動画では未設定。架空のProjectは作らない。 */
  projectId: z.string().optional(),
  preset: deliveryPresetIdSchema.optional(),
  platform: z.enum(['youtube', 'tiktok', 'x']),
  lang: analyticsLangSchema.optional(),
  url: z.string().default(''),
  /** 投稿記録の日時（手入力・投稿運用）。APIの公開日時は apiPublishedAt に別で持つ。 */
  postedAt: z.string(),
  importOrigin: importOriginSchema.default('cvcs'),
  youtubeVideoId: z.string().optional(),
  channelId: z.string().optional(),
  apiPublishedAt: z.string().optional(),
  publicationState: z.enum(['not_uploaded', 'private', 'unlisted', 'scheduled', 'public', 'unknown', 'unavailable']).optional(),
  scheduledPublishAt: z.string().optional(),
  timezone: z.string().optional(),
  uploadedAt: z.string().optional(),
  firstObservedPublicAt: z.string().optional(),
  actualPublishedAt: z.string().optional(),
  publishedAtSource: z.enum(['api-public', 'manual', 'first-observed']).optional(),
  publicationConfirmedAt: z.string().optional(),
  everPublished: z.boolean().optional(),
  exportRef: z
    .object({
      exportId: z.string(),
      basename: z.string().optional(),
      sha256: z.string().optional(),
      frozenAt: z.string(),
    })
    .optional(),
  contentType: youtubeContentTypeSchema.optional(),
  contentTypeSource: contentTypeSourceSchema.optional(),
  basename: z.string().optional(),
  utmContent: z.string().optional(),
  templateId: z.string(),
  hookPattern: analyticsHookSchema,
  openingType: openingTypeSchema.optional(),
  structureType: structureTypeSchema.optional(),
  ctaType: ctaTypeSchema.optional(),
  thumbnailLayout: z.enum(['classic', 'focus']).optional(),
  experimentId: z.string().optional(),
  experimentArm: experimentArmSchema.optional(),
  durationSec: optionalNumber,
  withBgm: z.boolean().optional(),
  bgmTrackId: z.string().optional(),
  content: postContentSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AnalyticsPost = z.infer<typeof analyticsPostSchema>;

export const metricSnapshotSchema = z.object({
  id: z.string(),
  postId: z.string(),
  capturedAt: z.string(),
  ageBucket: ageBucketSchema,
  source: snapshotSourceSchema,
  views: optionalNumber,
  likes: optionalNumber,
  comments: optionalNumber,
  shares: optionalNumber,
  saves: optionalNumber,
  subscribersGained: optionalNumber,
  followersGained: optionalNumber,
  profileViews: optionalNumber,
  impressions: optionalNumber,
  clickThroughRate: optionalNumber,
  viewedVsSwipedAway: optionalNumber,
  averageViewDurationSec: optionalNumber,
  averagePercentageViewed: optionalNumber,
  completionRate: optionalNumber,
  watchTimeMinutes: optionalNumber,
  clutchVaultVisits: optionalNumber,
  lineupViews: optionalNumber,
  lineupSaves: optionalNumber,
  deckAdds: optionalNumber,
  signups: optionalNumber,
  creatorFollows: optionalNumber,
  outboundVideoClicks: optionalNumber,
  returningUsers: optionalNumber,
});
export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>;

export const experimentSchemaV7 = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.enum(['p1', 'p2', 'p3']).default('p1'),
  series: z.string().default('phoenix-lineups'),
  hypothesis: z.string().default(''),
  primaryVariable: primaryVariableSchema,
  secondaryChangedVariables: z.array(z.string()).default([]),
  controlLabel: z.string().default(''),
  variantLabels: z.array(z.string()).default([]),
  primaryMetric: primaryMetricSchema,
  secondaryMetrics: z.array(primaryMetricSchema).default(['averagePercentageViewed', 'lineupSaves']),
  targetPlatform: z.string().optional(),
  plannedCountPerArm: z.union([z.literal(2), z.literal(3), z.literal(5)]).default(3),
  fixedConditions: z.record(z.string(), z.string()).default({}),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  linkedPostIds: z.array(z.string()).default([]),
  /** 比較から接続したときの集計窓。7日時点の記録とは別。 */
  comparisonWindow: z.enum(['publish-calendar-7d', 'publish-calendar-28d']).optional(),
  comparisonNote: z.string().optional(),
  confounders: z.array(z.string()).default([]),
  status: experimentStatusSchema,
  conclusion: experimentConclusionSchema.optional(),
  resultSummary: z.string().optional(),
  nextAction: z.string().optional(),
  nextActionApplyCount: z.number().int().optional(),
  sourceProjectId: z.string().optional(),
  /** 競合観察のメモID。自分の投稿IDとは別。 */
  externalObservationIds: z.array(z.string()).default([]),
  sourceNoteId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AnalyticsExperiment = z.infer<typeof experimentSchemaV7>;

export const reviewDraftSchema = z.object({
  hypothesis: hypothesisJudgementSchema.optional(),
  notices: z.array(noticeSchema).default([]),
  memo: z.string().default(''),
  action: nextActionSchema.optional(),
  continueCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  applyToNext: z.boolean().default(true),
  weeklyStep: z.number().int().min(1).max(5).optional(),
  weeklyChoice: z.string().optional(),
});
export type ReviewDraft = z.infer<typeof reviewDraftSchema>;

export const analysisTaskSchema = z.object({
  id: z.string(),
  postId: z.string().optional(),
  type: analysisTaskTypeSchema,
  dueAt: z.string(),
  status: analysisTaskStatusSchema,
  currentStep: z.number().int().min(1).max(6).default(1),
  draft: reviewDraftSchema.default({ notices: [], memo: '', continueCount: 1, applyToNext: true }),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  weekKey: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AnalysisTask = z.infer<typeof analysisTaskSchema>;

export const decisionSchema = z.object({
  id: z.string(),
  postId: z.string().optional(),
  experimentId: z.string().optional(),
  insightId: z.string().optional(),
  taskId: z.string().optional(),
  conclusion: decisionConclusionSchema,
  summary: z.string().default(''),
  nextAction: z.string().optional(),
  applyToNextProjects: z.boolean().default(false),
  remainingApplyCount: z.number().int().optional(),
  variable: primaryVariableSchema.optional(),
  value: z.string().optional(),
  arm: experimentArmSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const insightSchema = z.object({
  id: z.string(),
  title: z.string(),
  conclusion: z.string().default(''),
  status: insightStatusSchema,
  scope: z
    .object({
      platforms: z.array(z.string()).default([]),
      langs: z.array(z.string()).default([]),
    })
    .default({ platforms: [], langs: [] }),
  variable: primaryVariableSchema.optional(),
  value: z.string().optional(),
  evidenceSummary: z.string().optional(),
  basis: insightBasisSchema.default('decision'),
  linkedExperimentIds: z.array(z.string()).default([]),
  linkedDecisionIds: z.array(z.string()).default([]),
  linkedObservationIds: z.array(z.string()).default([]),
  applyAsDefault: z.boolean().default(false),
  suggestNext: z.boolean().default(false),
  warnOnUse: z.boolean().default(false),
  memo: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Insight = z.infer<typeof insightSchema>;

export const insightEventSchema = z.object({
  id: z.string(),
  insightId: z.string(),
  from: insightStatusSchema.optional(),
  to: insightStatusSchema,
  note: z.string().optional(),
  at: z.string(),
});
export type InsightEvent = z.infer<typeof insightEventSchema>;

export const analyticsBundleSchema = z.object({
  posts: z.array(analyticsPostSchema),
  snapshots: z.array(metricSnapshotSchema),
  experiments: z.array(experimentSchemaV7),
  tasks: z.array(analysisTaskSchema),
  decisions: z.array(decisionSchema),
  insights: z.array(insightSchema),
  events: z.array(insightEventSchema),
});
export type AnalyticsBundle = z.infer<typeof analyticsBundleSchema>;

export const emptyAnalyticsBundle = (): AnalyticsBundle => ({
  posts: [],
  snapshots: [],
  experiments: [],
  tasks: [],
  decisions: [],
  insights: [],
  events: [],
});
