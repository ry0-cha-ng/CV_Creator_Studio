import { z } from 'zod';
import type { CompetitorErrorCode, CompetitorTier, CompetitorWatch, VideoFormat, VideoOrientation } from '../competitor';

export const competitorTierSchema = z.enum(['primary', 'reference', 'hold']);
export const competitorWatchSchema = z.enum(['growing', 'struggling', 'benchmark', 'undecided']);
export const videoFormatSchema = z.enum(['shorts', 'standard', 'live', 'unknown']);
export const videoOrientationSchema = z.enum(['vertical', 'horizontal', 'square', 'unknown']);

const text = (max: number) => z.string().trim().max(max);

export const competitorPreviewSchema = z.object({
  text: z.string().max(20_000),
});

export const competitorConfirmSchema = z.object({
  previewId: z.string().uuid(),
  keys: z.array(z.string().min(1).max(500)).max(50),
});

export const competitorSettingsSchema = z.object({
  id: z.string().min(1),
  alias: text(80).optional(),
  tier: competitorTierSchema.optional(),
  reason: text(2000).optional(),
  tags: z.array(text(40)).max(12).optional(),
  language: text(40).nullable().optional(),
  watchState: competitorWatchSchema.optional(),
  syncEnabled: z.boolean().optional(),
  cadence: z.enum(['daily', 'weekly']).optional(),
  windowDays: z.number().int().min(1).max(3650).optional(),
  maxVideos: z.number().int().min(1).max(5000).optional(),
});

export const competitorRemoveSchema = z.object({
  id: z.string().min(1),
  keepNotes: z.boolean(),
});

export const competitorClassificationSchema = z.object({
  entityType: z.enum(['channel', 'video']),
  entityId: z.string().min(1).max(80),
  format: videoFormatSchema.nullable().optional(),
  orientation: videoOrientationSchema.nullable().optional(),
  language: text(40).nullable().optional(),
  tags: z.array(text(40)).max(12).default([]),
});

export const competitorSyncSchema = z.object({
  channelId: z.string().min(1).optional(),
  mode: z.enum(['refresh', 'full']).default('refresh'),
});

export const competitorGlobalSchema = z.object({
  quotaBudget: z.number().int().min(50).max(10_000).optional(),
  timeZone: z.enum(['Asia/Tokyo', 'UTC', 'America/Los_Angeles']).optional(),
});

export const competitorOpenSchema = z.object({
  url: z.string().min(1).max(500),
});

export type CompetitorFailure = { ok: false; code: CompetitorErrorCode; message: string };
export type CompetitorSuccess<T> = { ok: true; data: T };
export type CompetitorResult<T> = CompetitorSuccess<T> | CompetitorFailure;

export type CompetitorPreviewRow = {
  key: string;
  raw: string;
  status: 'ready' | 'unresolved' | 'duplicate' | 'invalid' | 'own_channel' | 'error';
  canSave: boolean;
  message: string;
  canonicalChannelId: string | null;
  title: string | null;
  existingId: string | null;
};

export type CompetitorPreview = {
  previewId: string;
  rows: CompetitorPreviewRow[];
  lookupCount: number;
  connected: boolean;
  truncated: boolean;
};

export type CompetitorSessionStats = {
  title: string | null;
  handle: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  subscriberCount: string | null;
  hiddenSubscriberCount: boolean;
  videoCount: string | null;
  viewCount: string | null;
  publishedAt: string | null;
};

export type CompetitorListItem = {
  id: string;
  input: string;
  alias: string;
  canonicalChannelId: string | null;
  tier: CompetitorTier;
  reason: string;
  tags: string[];
  watchState: CompetitorWatch;
  syncEnabled: boolean;
  cadence: 'daily' | 'weekly';
  archivedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: CompetitorErrorCode | null;
  lastErrorMessage: string | null;
  windowDays: number;
  maxVideos: number;
  session: CompetitorSessionStats | null;
  /** この起動で取得した動画のうち、公開日が新しい3本。 */
  recentVideos: CompetitorVideo[];
  /** vidIQ のチャンネルページ。ハンドルが分からなければ null。 */
  vidiqUrl: string | null;
};

export type CompetitorVideo = {
  videoId: string;
  userAdded: boolean;
  userUrl: string;
  title: string | null;
  publishedAt: string | null;
  durationIso: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  liveBroadcastContent: string | null;
  viewCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  missing: { view?: string; like?: string; comment?: string };
  fetchedAt: string | null;
  expiresAt: string | null;
  availability: 'available' | 'unavailable' | 'not_in_session';
  format: VideoFormat | null;
  orientation: VideoOrientation | null;
  language: string | null;
  tags: string[];
};

export type CompetitorCoverage = {
  state: 'ready' | 'not_in_session';
  scan?: 'complete' | 'capped' | 'interrupted' | 'partial';
  oldest?: string | null;
  newest?: string | null;
  listed?: number;
  saved?: number;
  excluded?: number;
  missing?: number;
  fetchedAt?: string;
  expiresAt?: string;
  message: string;
};

export type CompetitorDetail = CompetitorListItem & {
  language: string | null;
  coverage: CompetitorCoverage;
  /** この起動で持っている動画と、自分で追加した動画の合計。一覧は videos:page で別に取る。 */
  videoTotal: number;
};

export type CompetitorSyncView = {
  running: boolean;
  run: null | {
    id: string;
    channelId: string | null;
    mode: string;
    status: 'queued' | 'running' | 'partial' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
    processed: number;
    succeeded: number;
    failed: number;
    errorCode: CompetitorErrorCode | null;
    message: string | null;
    requestedAt: string;
    finishedAt: string | null;
  };
  policyLevel: 'basic' | 'approved_extended';
  derivedMetrics: false;
  derivedReason: string;
  persistentCache: false;
  persistentCacheReason: string;
  quota: { day: string; used: number; budget: number; timeZone: string };
};

export type CompetitorReference = { id: string; state: 'ok' | 'deleted' | 'expired' };
