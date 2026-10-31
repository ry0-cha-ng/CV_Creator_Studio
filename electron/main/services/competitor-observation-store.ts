import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { ProfileTheme } from '../../../shared/competitor-observation';

export type JotRow = {
  id: string;
  channelId: string | null;
  videoId: string | null;
  body: string;
  atSeconds: number | null;
  status: 'open' | 'handed_off' | 'archived';
  handedOffAt: string | null;
  clientRequestId: string;
  createdAt: string;
  updatedAt: string;
};

export type ProfileRow = {
  subject: string;
  theme: ProfileTheme;
  labels: string[];
  note: string;
  sourceUrl: string;
  confirmedAt: string | null;
  updatedAt: string;
};

export type TagRow = {
  id: string;
  name: string;
  group: string;
  criteria: string;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
};

export type FocusRow = {
  channelId: string;
  videoId: string;
  userUrl: string;
  focusAt: string | null;
  focusReason: string;
  createdAt: string;
};

const json = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const jotFrom = (row: Record<string, unknown>): JotRow => ({
  id: String(row.id),
  channelId: (row.channel_id as string | null) ?? null,
  videoId: (row.video_id as string | null) ?? null,
  body: String(row.body),
  atSeconds: row.at_seconds === null || row.at_seconds === undefined ? null : Number(row.at_seconds),
  status: row.status as JotRow['status'],
  handedOffAt: (row.handed_off_at as string | null) ?? null,
  clientRequestId: String(row.client_request_id),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const profileFrom = (row: Record<string, unknown>): ProfileRow => ({
  subject: String(row.subject),
  theme: row.theme as ProfileTheme,
  labels: json<string[]>(String(row.labels ?? '[]'), []),
  note: String(row.note ?? ''),
  sourceUrl: String(row.source_url ?? ''),
  confirmedAt: (row.confirmed_at as string | null) ?? null,
  updatedAt: String(row.updated_at),
});

const tagFrom = (row: Record<string, unknown>): TagRow => ({
  id: String(row.id),
  name: String(row.name),
  group: String(row.group_name),
  criteria: String(row.criteria ?? ''),
  sortOrder: Number(row.sort_order),
  archivedAt: (row.archived_at as string | null) ?? null,
  createdAt: String(row.created_at),
});

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

/** 気づき・観察プロフィール・特徴タグ・注目動画。どれも自分で書いたもので、API の値は入れない。 */
export class CompetitorObservationStore {
  constructor(private readonly database: () => DatabaseSync) {}

  jots(query: { channelId?: string; videoId?: string; status: 'open' | 'handed_off' | 'all'; offset: number; limit: number }): {
    rows: JotRow[];
    total: number;
  } {
    const where: string[] = ["status <> 'archived'"];
    const params: SQLInputValue[] = [];
    if (query.channelId) {
      where.push('channel_id = ?');
      params.push(query.channelId);
    }
    if (query.videoId) {
      where.push('video_id = ?');
      params.push(query.videoId);
    }
    if (query.status !== 'all') {
      where.push('status = ?');
      params.push(query.status);
    }
    const clause = where.join(' AND ');
    const total = this.database().prepare(`SELECT COUNT(*) AS n FROM competitor_jots WHERE ${clause}`).get(...params) as { n: number };
    const rows = this.database()
      .prepare(`SELECT * FROM competitor_jots WHERE ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, query.limit, query.offset) as Array<Record<string, unknown>>;
    return { rows: rows.map(jotFrom), total: Number(total.n) };
  }

  jot(id: string): JotRow | undefined {
    const row = this.database().prepare('SELECT * FROM competitor_jots WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? jotFrom(row) : undefined;
  }

  jotByRequest(requestId: string): JotRow | undefined {
    const row = this.database().prepare('SELECT * FROM competitor_jots WHERE client_request_id = ?').get(requestId) as
      | Record<string, unknown>
      | undefined;
    return row ? jotFrom(row) : undefined;
  }

  saveJot(row: JotRow): void {
    this.database()
      .prepare(
        `INSERT INTO competitor_jots (
          id, channel_id, video_id, body, at_seconds, status, handed_off_at, client_request_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          body = excluded.body,
          at_seconds = excluded.at_seconds,
          status = excluded.status,
          handed_off_at = excluded.handed_off_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        row.id,
        row.channelId,
        row.videoId,
        row.body,
        row.atSeconds,
        row.status,
        row.handedOffAt,
        row.clientRequestId,
        row.createdAt,
        row.updatedAt,
      );
  }

  removeJot(id: string): void {
    this.database().prepare('DELETE FROM competitor_jots WHERE id = ?').run(id);
  }

  handOff(ids: string[], now: string): number {
    const result = this.database()
      .prepare(
        `UPDATE competitor_jots SET status = 'handed_off', handed_off_at = ?, updated_at = ?
         WHERE status = 'open' AND id IN (${placeholders(ids.length)})`,
      )
      .run(now, now, ...ids);
    return Number(result.changes);
  }

  openJotCount(): number {
    const row = this.database().prepare("SELECT COUNT(*) AS n FROM competitor_jots WHERE status = 'open'").get() as { n: number };
    return Number(row.n);
  }

  jotCountsByVideo(videoIds: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    if (videoIds.length === 0) return counts;
    const rows = this.database()
      .prepare(
        `SELECT video_id AS videoId, COUNT(*) AS n FROM competitor_jots
         WHERE status <> 'archived' AND video_id IN (${placeholders(videoIds.length)}) GROUP BY video_id`,
      )
      .all(...videoIds) as Array<{ videoId: string; n: number }>;
    for (const row of rows) counts.set(row.videoId, Number(row.n));
    return counts;
  }

  jotBodiesByVideo(videoIds: string[]): Map<string, string[]> {
    const bodies = new Map<string, string[]>();
    if (videoIds.length === 0) return bodies;
    const rows = this.database()
      .prepare(
        `SELECT video_id AS videoId, body FROM competitor_jots
         WHERE status <> 'archived' AND video_id IN (${placeholders(videoIds.length)}) ORDER BY created_at`,
      )
      .all(...videoIds) as Array<{ videoId: string; body: string }>;
    for (const row of rows) bodies.set(row.videoId, [...(bodies.get(row.videoId) ?? []), row.body]);
    return bodies;
  }

  profiles(subjects?: string[]): ProfileRow[] {
    if (subjects && subjects.length === 0) return [];
    const rows = (subjects
      ? this.database()
          .prepare(`SELECT * FROM competitor_profile_entries WHERE subject IN (${placeholders(subjects.length)})`)
          .all(...subjects)
      : this.database().prepare('SELECT * FROM competitor_profile_entries').all()) as Array<Record<string, unknown>>;
    return rows.map(profileFrom);
  }

  saveProfile(row: ProfileRow): void {
    this.database()
      .prepare(
        `INSERT INTO competitor_profile_entries (subject, theme, labels, note, source_url, confirmed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(subject, theme) DO UPDATE SET
           labels = excluded.labels,
           note = excluded.note,
           source_url = excluded.source_url,
           confirmed_at = excluded.confirmed_at,
           updated_at = excluded.updated_at`,
      )
      .run(row.subject, row.theme, JSON.stringify(row.labels), row.note, row.sourceUrl, row.confirmedAt, row.updatedAt);
  }

  profileOptions(): Array<{ theme: ProfileTheme; label: string }> {
    return this.database()
      .prepare('SELECT theme, label FROM competitor_profile_options ORDER BY theme, sort_order')
      .all() as Array<{ theme: ProfileTheme; label: string }>;
  }

  addProfileOption(theme: ProfileTheme, label: string): void {
    const row = this.database()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM competitor_profile_options WHERE theme = ?')
      .get(theme) as { next: number };
    this.database()
      .prepare('INSERT OR IGNORE INTO competitor_profile_options (theme, label, sort_order, builtin) VALUES (?, ?, ?, 0)')
      .run(theme, label, Number(row.next));
  }

  tags(): TagRow[] {
    const rows = this.database()
      .prepare('SELECT * FROM competitor_feature_tags WHERE archived_at IS NULL ORDER BY sort_order, created_at')
      .all() as Array<Record<string, unknown>>;
    return rows.map(tagFrom);
  }

  tag(id: string): TagRow | undefined {
    const row = this.database().prepare('SELECT * FROM competitor_feature_tags WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? tagFrom(row) : undefined;
  }

  tagByName(name: string): TagRow | undefined {
    const row = this.database()
      .prepare('SELECT * FROM competitor_feature_tags WHERE name = ? AND archived_at IS NULL')
      .get(name) as Record<string, unknown> | undefined;
    return row ? tagFrom(row) : undefined;
  }

  saveTag(row: Omit<TagRow, 'sortOrder'> & { sortOrder?: number }): TagRow {
    const existing = this.tag(row.id);
    if (existing) {
      this.database()
        .prepare('UPDATE competitor_feature_tags SET name = ?, group_name = ?, criteria = ? WHERE id = ?')
        .run(row.name, row.group, row.criteria, row.id);
      return { ...existing, name: row.name, group: row.group, criteria: row.criteria };
    }
    const next = this.database().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM competitor_feature_tags').get() as {
      next: number;
    };
    const saved: TagRow = { ...row, sortOrder: row.sortOrder ?? Number(next.next) };
    this.database()
      .prepare(
        'INSERT INTO competitor_feature_tags (id, name, group_name, criteria, sort_order, archived_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(saved.id, saved.name, saved.group, saved.criteria, saved.sortOrder, saved.archivedAt, saved.createdAt);
    return saved;
  }

  archiveTag(id: string, now: string): void {
    this.database().prepare('UPDATE competitor_feature_tags SET archived_at = ? WHERE id = ?').run(now, id);
    this.database().prepare('DELETE FROM competitor_video_feature_tags WHERE tag_id = ?').run(id);
  }

  assignments(videoIds?: string[]): Array<{ videoId: string; tagId: string }> {
    if (videoIds && videoIds.length === 0) return [];
    return (videoIds
      ? this.database()
          .prepare(
            `SELECT video_id AS videoId, tag_id AS tagId FROM competitor_video_feature_tags
             WHERE video_id IN (${placeholders(videoIds.length)}) ORDER BY created_at`,
          )
          .all(...videoIds)
      : this.database().prepare('SELECT video_id AS videoId, tag_id AS tagId FROM competitor_video_feature_tags').all()) as Array<{
      videoId: string;
      tagId: string;
    }>;
  }

  assign(videoId: string, tagId: string, origin: 'manual' | 'ai_adopted', now: string): void {
    this.database()
      .prepare('INSERT OR IGNORE INTO competitor_video_feature_tags (video_id, tag_id, origin, created_at) VALUES (?, ?, ?, ?)')
      .run(videoId, tagId, origin, now);
  }

  unassign(videoId: string, tagId: string): void {
    this.database().prepare('DELETE FROM competitor_video_feature_tags WHERE video_id = ? AND tag_id = ?').run(videoId, tagId);
  }

  focusRows(channelIds?: string[]): FocusRow[] {
    if (channelIds && channelIds.length === 0) return [];
    const base =
      'SELECT channel_id AS channelId, video_id AS videoId, user_url AS userUrl, focus_at AS focusAt, focus_reason AS focusReason, created_at AS createdAt FROM competitor_video_refs';
    return (channelIds
      ? this.database().prepare(`${base} WHERE channel_id IN (${placeholders(channelIds.length)})`).all(...channelIds)
      : this.database().prepare(base).all()) as FocusRow[];
  }

  setFocus(input: {
    channelId: string;
    videoId: string;
    userUrl: string;
    focus: boolean;
    reason: string | undefined;
    source: 'user_url' | 'sync';
    now: string;
  }): void {
    const existing = this.database().prepare('SELECT id FROM competitor_video_refs WHERE video_id = ?').get(input.videoId) as
      | { id: string }
      | undefined;
    if (!existing) {
      if (!input.focus) return;
      this.database()
        .prepare(
          `INSERT INTO competitor_video_refs (id, channel_id, video_id, user_url, created_at, focus_at, focus_reason, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), input.channelId, input.videoId, input.userUrl, input.now, input.now, input.reason ?? '', input.source);
      return;
    }
    if (input.focus) {
      this.database()
        .prepare(
          `UPDATE competitor_video_refs
           SET focus_at = COALESCE(focus_at, ?), focus_reason = COALESCE(?, focus_reason)
           WHERE video_id = ?`,
        )
        .run(input.now, input.reason ?? null, input.videoId);
      return;
    }
    this.database().prepare('UPDATE competitor_video_refs SET focus_at = NULL WHERE video_id = ?').run(input.videoId);
  }

  /** チャンネルを削除したとき。keepJots なら気づきの本文はチャンネルなしで残す。 */
  channelRemoved(channelId: string, videoIds: string[], keepJots: boolean): void {
    if (keepJots) {
      this.database().prepare('UPDATE competitor_jots SET channel_id = NULL WHERE channel_id = ?').run(channelId);
    } else {
      this.database().prepare('DELETE FROM competitor_jots WHERE channel_id = ?').run(channelId);
    }
    this.database().prepare('DELETE FROM competitor_profile_entries WHERE subject = ?').run(channelId);
    if (videoIds.length > 0) {
      this.database()
        .prepare(`DELETE FROM competitor_video_feature_tags WHERE video_id IN (${placeholders(videoIds.length)})`)
        .run(...videoIds);
    }
  }

  /** 同じチャンネルが2行に分かれていたものを1つにまとめたとき。 */
  channelMerged(from: string, to: string): void {
    this.database().prepare('UPDATE competitor_jots SET channel_id = ? WHERE channel_id = ?').run(to, from);
    this.database()
      .prepare(
        `UPDATE OR IGNORE competitor_profile_entries SET subject = ? WHERE subject = ?`,
      )
      .run(to, from);
    this.database().prepare('DELETE FROM competitor_profile_entries WHERE subject = ?').run(from);
  }
}
