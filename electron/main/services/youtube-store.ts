import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  metadataChangeSchema,
  syncRunSchema,
  syncStateSchema,
  youtubeChannelSchema,
  youtubeDailyRowSchema,
  youtubeReportSchema,
  youtubeVideoSchema,
  type MetadataChange,
  type SyncRun,
  type SyncState,
  type YoutubeChannel,
  type YoutubeDailyRow,
  type YoutubeReport,
  type YoutubeVideo,
} from '../../../shared/schema/youtube';

type Parser<T> = { safeParse: (value: unknown) => { success: true; data: T } | { success: false } };

const parseRows = <T>(rows: Array<{ data: string }>, schema: Parser<T>): T[] =>
  rows.flatMap((row) => {
    try {
      const parsed = schema.safeParse(JSON.parse(row.data));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });

const TRACKED_FIELDS = ['title', 'description', 'durationSec', 'privacyStatus'] as const;

/** YouTube由来データの保存。所有チャンネルのAnalyticsと公開情報だけを扱う。 */
export class YoutubeStore {
  constructor(private readonly database: () => DatabaseSync) {}

  channel(): YoutubeChannel | undefined {
    const rows = this.database().prepare('SELECT data FROM youtube_channels').all() as Array<{ data: string }>;
    return parseRows(rows, youtubeChannelSchema).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
  }

  saveChannel(channel: YoutubeChannel): void {
    this.database()
      .prepare(
        `INSERT INTO youtube_channels (channel_id, data) VALUES (?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET data = excluded.data`,
      )
      .run(channel.channelId, JSON.stringify(youtubeChannelSchema.parse(channel)));
  }

  videos(channelId?: string): YoutubeVideo[] {
    const rows = (
      channelId
        ? this.database().prepare('SELECT data FROM youtube_videos WHERE channel_id = ? ORDER BY published_at DESC').all(channelId)
        : this.database().prepare('SELECT data FROM youtube_videos ORDER BY published_at DESC').all()
    ) as Array<{ data: string }>;
    return parseRows(rows, youtubeVideoSchema);
  }

  video(videoId: string): YoutubeVideo | undefined {
    const row = this.database().prepare('SELECT data FROM youtube_videos WHERE video_id = ?').get(videoId) as
      | { data: string }
      | undefined;
    return row ? parseRows([row], youtubeVideoSchema)[0] : undefined;
  }

  /** 値が変わった項目を変更履歴へ残す。初回は「初めて取得した値」で、公開当初の値とはみなさない。 */
  upsertVideo(incoming: YoutubeVideo, observedAt: string): MetadataChange[] {
    const previous = this.video(incoming.videoId);
    const next = youtubeVideoSchema.parse({
      ...incoming,
      contentType: incoming.contentType !== 'UNKNOWN' ? incoming.contentType : previous?.contentType ?? 'UNKNOWN',
      contentTypeSource:
        incoming.contentType !== 'UNKNOWN' ? incoming.contentTypeSource : previous?.contentTypeSource ?? 'unknown',
      firstSeenAt: previous?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
      missingSince: undefined,
    });
    const changes: MetadataChange[] = [];
    for (const field of TRACKED_FIELDS) {
      const oldValue = previous?.[field];
      const newValue = next[field];
      if (previous && String(oldValue ?? '') === String(newValue ?? '')) continue;
      if (!previous && (newValue === undefined || newValue === '')) continue;
      changes.push(
        metadataChangeSchema.parse({
          id: randomUUID(),
          videoId: next.videoId,
          field,
          oldValue: previous && oldValue !== undefined ? String(oldValue) : undefined,
          newValue: newValue !== undefined ? String(newValue) : undefined,
          kind: previous ? 'detected-on-sync' : 'first-observed',
          at: observedAt,
        }),
      );
    }
    this.database()
      .prepare(
        `INSERT INTO youtube_videos (video_id, channel_id, published_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET channel_id = excluded.channel_id, published_at = excluded.published_at, data = excluded.data`,
      )
      .run(next.videoId, next.channelId, next.publishedAt, JSON.stringify(next));
    const insert = this.database().prepare(
      'INSERT INTO youtube_metadata_changes (id, video_id, at, data) VALUES (?, ?, ?, ?)',
    );
    for (const change of changes) insert.run(change.id, change.videoId, change.at, JSON.stringify(change));
    return changes;
  }

  setContentType(videoId: string, contentType: YoutubeVideo['contentType']): void {
    const video = this.video(videoId);
    if (!video || contentType === 'UNKNOWN') return;
    const next = { ...video, contentType, contentTypeSource: 'analytics-api' as const };
    this.database().prepare('UPDATE youtube_videos SET data = ? WHERE video_id = ?').run(JSON.stringify(next), videoId);
  }

  markMissing(channelId: string, seen: Set<string>, at: string): void {
    for (const video of this.videos(channelId)) {
      if (seen.has(video.videoId) || video.missingSince) continue;
      this.database()
        .prepare('UPDATE youtube_videos SET data = ? WHERE video_id = ?')
        .run(JSON.stringify({ ...video, missingSince: at }), video.videoId);
    }
  }

  metadataChanges(videoId: string): MetadataChange[] {
    const rows = this.database()
      .prepare('SELECT data FROM youtube_metadata_changes WHERE video_id = ? ORDER BY at')
      .all(videoId) as Array<{ data: string }>;
    return parseRows(rows, metadataChangeSchema);
  }

  /** 同じ動画・同じ日の行は置き換える。再取得で加算しない。 */
  upsertDaily(rows: YoutubeDailyRow[]): void {
    const statement = this.database().prepare(
      `INSERT INTO youtube_daily (video_id, report_date, fetched_at, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(video_id, report_date) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data`,
    );
    for (const row of rows) {
      const parsed = youtubeDailyRowSchema.parse(row);
      statement.run(parsed.videoId, parsed.reportDate, parsed.fetchedAt, JSON.stringify(parsed));
    }
  }

  daily(videoId: string): YoutubeDailyRow[] {
    const rows = this.database()
      .prepare('SELECT data FROM youtube_daily WHERE video_id = ? ORDER BY report_date')
      .all(videoId) as Array<{ data: string }>;
    return parseRows(rows, youtubeDailyRowSchema);
  }

  videosWithDaily(): number {
    const row = this.database().prepare('SELECT COUNT(DISTINCT video_id) AS count FROM youtube_daily').get() as {
      count: number;
    };
    return row.count;
  }

  saveReport(report: Omit<YoutubeReport, 'id'>): YoutubeReport {
    const existing = this.database()
      .prepare(
        `SELECT id FROM youtube_reports
         WHERE video_id = ? AND kind = ? AND window_kind = ? AND period_start = ? AND period_end = ? AND filters = ?`,
      )
      .get(report.videoId, report.kind, report.windowKind, report.periodStart, report.periodEnd, report.filters) as
      | { id: string }
      | undefined;
    const next = youtubeReportSchema.parse({ ...report, id: existing?.id ?? randomUUID() });
    this.database()
      .prepare(
        `INSERT INTO youtube_reports (id, video_id, kind, window_kind, period_start, period_end, filters, fetched_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data`,
      )
      .run(
        next.id,
        next.videoId,
        next.kind,
        next.windowKind,
        next.periodStart,
        next.periodEnd,
        next.filters,
        next.fetchedAt,
        JSON.stringify(next),
      );
    return next;
  }

  reports(videoId?: string): YoutubeReport[] {
    const rows = (
      videoId
        ? this.database().prepare('SELECT data FROM youtube_reports WHERE video_id = ?').all(videoId)
        : this.database().prepare('SELECT data FROM youtube_reports').all()
    ) as Array<{ data: string }>;
    return parseRows(rows, youtubeReportSchema);
  }

  state(key: string): SyncState {
    const row = this.database().prepare('SELECT data FROM youtube_sync_state WHERE key = ?').get(key) as
      | { data: string }
      | undefined;
    return (row ? parseRows([row], syncStateSchema)[0] : undefined) ?? syncStateSchema.parse({ key });
  }

  saveState(state: SyncState): void {
    this.database()
      .prepare(
        `INSERT INTO youtube_sync_state (key, data) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET data = excluded.data`,
      )
      .run(state.key, JSON.stringify(syncStateSchema.parse(state)));
  }

  saveRun(run: SyncRun): void {
    this.database()
      .prepare(
        `INSERT INTO youtube_sync_runs (id, started_at, data) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(run.id, run.startedAt, JSON.stringify(syncRunSchema.parse(run)));
  }

  lastRun(): SyncRun | undefined {
    const rows = this.database()
      .prepare('SELECT data FROM youtube_sync_runs ORDER BY started_at DESC LIMIT 1')
      .all() as Array<{ data: string }>;
    return parseRows(rows, syncRunSchema)[0];
  }
}
