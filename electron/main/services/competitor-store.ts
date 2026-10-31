import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  COMPETITOR_ERROR_TEXT,
  type CompetitorErrorCode,
  type CompetitorTier,
  type CompetitorWatch,
  type VideoFormat,
  type VideoOrientation,
} from '../../../shared/competitor';

export type ChannelRow = {
  id: string;
  canonicalChannelId: string | null;
  userInput: string;
  inputKey: string;
  alias: string;
  tier: CompetitorTier;
  reason: string;
  tags: string[];
  language: string | null;
  watchState: CompetitorWatch;
  syncEnabled: boolean;
  cadence: 'daily' | 'weekly';
  windowDays: number;
  maxVideos: number;
  archivedAt: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: CompetitorErrorCode | null;
  createdAt: string;
  updatedAt: string;
};

export type VideoRefRow = { id: string; channelId: string; videoId: string; userUrl: string; createdAt: string };

export type ClassRow = {
  entityType: 'channel' | 'video';
  entityId: string;
  format: VideoFormat | null;
  orientation: VideoOrientation | null;
  language: string | null;
  tags: string[];
  confirmedAt: string;
};

export type RunRow = {
  id: string;
  channelId: string | null;
  mode: string;
  status: 'queued' | 'running' | 'partial' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  cursor: string | null;
  processed: number;
  succeeded: number;
  failed: number;
  errorCode: CompetitorErrorCode | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

const asBool = (value: number): boolean => value === 1;
const json = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const channelFrom = (row: Record<string, unknown>): ChannelRow => ({
  id: String(row.id),
  canonicalChannelId: (row.canonical_channel_id as string | null) ?? null,
  userInput: String(row.user_input),
  inputKey: String(row.input_key),
  alias: String(row.alias ?? ''),
  tier: row.tier as CompetitorTier,
  reason: String(row.reason ?? ''),
  tags: json<string[]>(String(row.tags ?? '[]'), []),
  language: (row.language as string | null) ?? null,
  watchState: row.watch_state as CompetitorWatch,
  syncEnabled: asBool(Number(row.sync_enabled)),
  cadence: row.cadence === 'weekly' ? 'weekly' : 'daily',
  windowDays: Number(row.window_days),
  maxVideos: Number(row.max_videos),
  archivedAt: (row.archived_at as string | null) ?? null,
  lastSuccessAt: (row.last_success_at as string | null) ?? null,
  lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
  lastErrorCode: (row.last_error_code as CompetitorErrorCode | null) ?? null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

export class CompetitorStore {
  constructor(private readonly database: () => DatabaseSync) {}

  channels(): ChannelRow[] {
    const rows = this.database().prepare('SELECT * FROM competitor_channels ORDER BY created_at').all() as Array<Record<string, unknown>>;
    return rows.map(channelFrom);
  }

  channel(id: string): ChannelRow | undefined {
    const row = this.database().prepare('SELECT * FROM competitor_channels WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? channelFrom(row) : undefined;
  }

  findByCanonical(channelId: string): ChannelRow | undefined {
    const row = this.database()
      .prepare('SELECT * FROM competitor_channels WHERE canonical_channel_id = ?')
      .get(channelId) as Record<string, unknown> | undefined;
    return row ? channelFrom(row) : undefined;
  }

  findByInputKey(key: string): ChannelRow | undefined {
    const row = this.database()
      .prepare('SELECT * FROM competitor_channels WHERE input_key = ? AND canonical_channel_id IS NULL')
      .get(key) as Record<string, unknown> | undefined;
    return row ? channelFrom(row) : undefined;
  }

  insertChannel(row: ChannelRow): ChannelRow {
    this.database()
      .prepare(
        `INSERT INTO competitor_channels (
          id, canonical_channel_id, user_input, input_key, alias, tier, reason, tags, language,
          watch_state, sync_enabled, cadence, window_days, max_videos,
          archived_at, last_success_at, last_attempt_at, last_error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.canonicalChannelId,
        row.userInput,
        row.inputKey,
        row.alias,
        row.tier,
        row.reason,
        JSON.stringify(row.tags),
        row.language,
        row.watchState,
        row.syncEnabled ? 1 : 0,
        row.cadence,
        row.windowDays,
        row.maxVideos,
        row.archivedAt,
        row.lastSuccessAt,
        row.lastAttemptAt,
        row.lastErrorCode,
        row.createdAt,
        row.updatedAt,
      );
    return row;
  }

  updateChannel(row: ChannelRow): void {
    this.database()
      .prepare(
        `UPDATE competitor_channels SET
          canonical_channel_id = ?, user_input = ?, input_key = ?, alias = ?, tier = ?, reason = ?,
          tags = ?, language = ?, watch_state = ?,
          sync_enabled = ?, cadence = ?, window_days = ?, max_videos = ?, archived_at = ?,
          last_success_at = ?, last_attempt_at = ?, last_error_code = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        row.canonicalChannelId,
        row.userInput,
        row.inputKey,
        row.alias,
        row.tier,
        row.reason,
        JSON.stringify(row.tags),
        row.language,
        row.watchState,
        row.syncEnabled ? 1 : 0,
        row.cadence,
        row.windowDays,
        row.maxVideos,
        row.archivedAt,
        row.lastSuccessAt,
        row.lastAttemptAt,
        row.lastErrorCode,
        row.updatedAt,
        row.id,
      );
  }

  deleteChannel(id: string): void {
    this.database().prepare('DELETE FROM competitor_channels WHERE id = ?').run(id);
  }

  videoRefs(channelId: string): VideoRefRow[] {
    return this.database()
      .prepare(
        'SELECT id, channel_id AS channelId, video_id AS videoId, user_url AS userUrl, created_at AS createdAt FROM competitor_video_refs WHERE channel_id = ?',
      )
      .all(channelId) as VideoRefRow[];
  }

  videoRefByVideo(videoId: string): VideoRefRow | undefined {
    const row = this.database()
      .prepare('SELECT id, channel_id AS channelId, video_id AS videoId, user_url AS userUrl, created_at AS createdAt FROM competitor_video_refs WHERE video_id = ?')
      .get(videoId) as VideoRefRow | undefined;
    return row;
  }

  moveVideoRefs(fromChannel: string, toChannel: string): void {
    this.database().prepare('UPDATE competitor_video_refs SET channel_id = ? WHERE channel_id = ?').run(toChannel, fromChannel);
  }

  deleteVideoRefs(channelId: string): void {
    this.database().prepare('DELETE FROM competitor_video_refs WHERE channel_id = ?').run(channelId);
  }

  classification(entityType: string, entityId: string): ClassRow | undefined {
    const row = this.database()
      .prepare('SELECT * FROM competitor_classifications WHERE entity_type = ? AND entity_id = ? AND source = ?')
      .get(entityType, entityId, 'manual') as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      entityType: row.entity_type as 'channel' | 'video',
      entityId: String(row.entity_id),
      format: (row.format as VideoFormat | null) ?? null,
      orientation: (row.orientation as VideoOrientation | null) ?? null,
      language: (row.language as string | null) ?? null,
      tags: json<string[]>(String(row.tags ?? '[]'), []),
      confirmedAt: String(row.confirmed_at),
    };
  }

  saveClassification(row: ClassRow, now: string): void {
    const existing = this.classification(row.entityType, row.entityId);
    if (!existing) {
      this.database()
        .prepare(
          `INSERT INTO competitor_classifications (
            id, entity_type, entity_id, format, orientation, language, tags, source, confirmed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
        )
        .run(randomUUID(), row.entityType, row.entityId, row.format, row.orientation, row.language, JSON.stringify(row.tags), now);
      return;
    }
    this.database()
      .prepare(
        `UPDATE competitor_classifications
         SET format = ?, orientation = ?, language = ?, tags = ?, confirmed_at = ?
         WHERE entity_type = ? AND entity_id = ? AND source = 'manual'`,
      )
      .run(row.format, row.orientation, row.language, JSON.stringify(row.tags), now, row.entityType, row.entityId);
  }

  deleteClassifications(entityIds: string[]): void {
    const statement = this.database().prepare('DELETE FROM competitor_classifications WHERE entity_id = ?');
    for (const id of entityIds) statement.run(id);
  }

  insertRun(row: RunRow): void {
    this.database()
      .prepare(
        `INSERT INTO competitor_sync_runs (
          id, channel_id, mode, status, cursor, processed, succeeded, failed, error_code, requested_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.channelId,
        row.mode,
        row.status,
        row.cursor,
        row.processed,
        row.succeeded,
        row.failed,
        row.errorCode,
        row.requestedAt,
        row.startedAt,
        row.finishedAt,
      );
  }

  updateRun(row: RunRow): void {
    this.database()
      .prepare(
        `UPDATE competitor_sync_runs
         SET status = ?, cursor = ?, processed = ?, succeeded = ?, failed = ?, error_code = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(row.status, row.cursor, row.processed, row.succeeded, row.failed, row.errorCode, row.finishedAt, row.id);
  }

  latestRun(): RunRow | undefined {
    const row = this.database()
      .prepare('SELECT * FROM competitor_sync_runs ORDER BY requested_at DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
    return row ? runFrom(row) : undefined;
  }

  markInterrupted(now: string): void {
    this.database()
      .prepare(
        `UPDATE competitor_sync_runs
         SET status = 'interrupted', finished_at = ?, error_code = 'interrupted'
         WHERE status IN ('running', 'queued')`,
      )
      .run(now);
  }

  setting(key: string): string | undefined {
    const row = this.database().prepare('SELECT value FROM competitor_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  putSetting(key: string, value: string): void {
    this.database()
      .prepare('INSERT INTO competitor_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  errorText(code: CompetitorErrorCode | null): string | null {
    return code ? COMPETITOR_ERROR_TEXT[code] : null;
  }
}

const runFrom = (row: Record<string, unknown>): RunRow => ({
  id: String(row.id),
  channelId: (row.channel_id as string | null) ?? null,
  mode: String(row.mode),
  status: row.status as RunRow['status'],
  cursor: (row.cursor as string | null) ?? null,
  processed: Number(row.processed),
  succeeded: Number(row.succeeded),
  failed: Number(row.failed),
  errorCode: (row.error_code as CompetitorErrorCode | null) ?? null,
  requestedAt: String(row.requested_at),
  startedAt: (row.started_at as string | null) ?? null,
  finishedAt: (row.finished_at as string | null) ?? null,
});
