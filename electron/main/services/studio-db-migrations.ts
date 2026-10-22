import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { youtubeVideoIdFromUrl } from '../../../shared/post-url';

type Migration = {
  name: string;
  /** 既存行を書き換える移行。実行前にバックアップを取る。 */
  rewritesData: boolean;
  up: (database: DatabaseSync) => void;
};

const MIGRATIONS: Migration[] = [
  {
    name: '2026-10-analytics-posts-youtube',
    rewritesData: true,
    up: (database) => {
      database.exec(`
        CREATE TABLE analytics_posts_next (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          preset TEXT,
          posted_at TEXT NOT NULL,
          youtube_video_id TEXT,
          data TEXT NOT NULL
        );
        INSERT INTO analytics_posts_next (id, project_id, preset, posted_at, data)
          SELECT id, project_id, preset, posted_at, data FROM analytics_posts;
        DROP TABLE analytics_posts;
        ALTER TABLE analytics_posts_next RENAME TO analytics_posts;
        CREATE UNIQUE INDEX analytics_posts_key ON analytics_posts(project_id, preset);
        CREATE UNIQUE INDEX analytics_posts_video ON analytics_posts(youtube_video_id)
          WHERE youtube_video_id IS NOT NULL;
      `);
      const rows = database.prepare('SELECT id, data FROM analytics_posts ORDER BY posted_at').all() as Array<{
        id: string;
        data: string;
      }>;
      const claimed = new Set<string>();
      const update = database.prepare('UPDATE analytics_posts SET youtube_video_id = ?, data = ? WHERE id = ?');
      for (const row of rows) {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(row.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (data.platform !== 'youtube' || typeof data.url !== 'string') continue;
        const videoId = youtubeVideoIdFromUrl(data.url);
        if (!videoId || claimed.has(videoId)) continue;
        claimed.add(videoId);
        update.run(videoId, JSON.stringify({ ...data, youtubeVideoId: videoId, importOrigin: 'cvcs' }), row.id);
      }
    },
  },
  {
    name: '2026-10-youtube-tables',
    rewritesData: false,
    up: (database) => {
      database.exec(`
        CREATE TABLE youtube_channels (
          channel_id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
        CREATE TABLE youtube_videos (
          video_id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          published_at TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE TABLE youtube_metadata_changes (
          id TEXT PRIMARY KEY,
          video_id TEXT NOT NULL,
          at TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE INDEX youtube_metadata_changes_video ON youtube_metadata_changes(video_id, at);
        CREATE TABLE youtube_daily (
          video_id TEXT NOT NULL,
          report_date TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          data TEXT NOT NULL,
          PRIMARY KEY (video_id, report_date)
        );
        CREATE TABLE youtube_reports (
          id TEXT PRIMARY KEY,
          video_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          window_kind TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          filters TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE UNIQUE INDEX youtube_reports_key
          ON youtube_reports(video_id, kind, window_kind, period_start, period_end, filters);
        CREATE TABLE youtube_sync_state (
          key TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
        CREATE TABLE youtube_sync_runs (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          data TEXT NOT NULL
        );
      `);
    },
  },
];

const hasRows = (database: DatabaseSync): boolean => {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'",
    )
    .all() as Array<{ name: string }>;
  return tables.some((table) => {
    const row = database.prepare(`SELECT 1 AS found FROM "${table.name.replaceAll('"', '""')}" LIMIT 1`).get() as
      | { found: number }
      | undefined;
    return Boolean(row);
  });
};

const backup = (database: DatabaseSync, workspace: string, label: string, now: Date): string => {
  const directory = path.join(workspace, 'backups');
  mkdirSync(directory, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = path.join(directory, `studio-${stamp}-before-${label}.db`);
  database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  return target;
};

export type MigrationResult = { applied: string[]; backupPath?: string };

export const runStudioMigrations = (
  database: DatabaseSync,
  workspace: string,
  now: () => Date = () => new Date(),
): MigrationResult => {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    (database.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map((row) => row.name),
  );
  const pending = MIGRATIONS.filter((migration) => !done.has(migration.name));
  if (pending.length === 0) return { applied: [] };
  const backupPath =
    pending.some((migration) => migration.rewritesData) && hasRows(database)
      ? backup(database, workspace, pending[0].name, now())
      : undefined;
  const record = database.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  for (const migration of pending) {
    database.exec('BEGIN');
    try {
      migration.up(database);
      record.run(migration.name, now().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return { applied: pending.map((migration) => migration.name), backupPath };
};
