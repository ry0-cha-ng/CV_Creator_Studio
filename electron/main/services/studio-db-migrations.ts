import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_FEATURE_TAGS, DEFAULT_PROFILE_OPTIONS, PROFILE_THEMES } from '../../../shared/competitor-observation';
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
  {
    name: '2026-10-youtube-publish',
    rewritesData: false,
    up: (database) => {
      database.exec(`
        CREATE TABLE youtube_publish_jobs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          workflow_task_id TEXT,
          channel_id TEXT NOT NULL,
          video_id TEXT,
          operation_state TEXT NOT NULL,
          publication_state TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE INDEX youtube_publish_jobs_project ON youtube_publish_jobs(project_id, updated_at);
        CREATE INDEX youtube_publish_jobs_task ON youtube_publish_jobs(workflow_task_id);
        CREATE INDEX youtube_publish_jobs_video ON youtube_publish_jobs(video_id);
        CREATE TABLE youtube_publish_presets (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
      `);
    },
  },
  {
    name: '2026-10-published-snapshots',
    rewritesData: false,
    up: (database) => {
      database.exec(`
        CREATE TABLE published_snapshots (
          export_id TEXT PRIMARY KEY,
          post_id TEXT,
          project_id TEXT,
          frozen_at TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE INDEX published_snapshots_post ON published_snapshots(post_id);
        CREATE INDEX published_snapshots_project ON published_snapshots(project_id);
      `);
    },
  },
  {
    name: '2026-10-competitor-observation',
    rewritesData: false,
    up: (database) => {
      database.exec(`
        CREATE TABLE competitor_channels (
          id TEXT PRIMARY KEY,
          canonical_channel_id TEXT,
          user_input TEXT NOT NULL,
          input_key TEXT NOT NULL,
          alias TEXT NOT NULL DEFAULT '',
          tier TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          learn TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          language TEXT,
          audience TEXT NOT NULL DEFAULT '',
          agents TEXT NOT NULL DEFAULT '',
          maps TEXT NOT NULL DEFAULT '',
          themes TEXT NOT NULL DEFAULT '',
          watch_state TEXT NOT NULL DEFAULT 'undecided',
          sync_enabled INTEGER NOT NULL DEFAULT 1,
          cadence TEXT NOT NULL DEFAULT 'daily',
          window_days INTEGER NOT NULL DEFAULT 180,
          max_videos INTEGER NOT NULL DEFAULT 200,
          archived_at TEXT,
          last_success_at TEXT,
          last_attempt_at TEXT,
          last_error_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX competitor_channels_canonical ON competitor_channels(canonical_channel_id)
          WHERE canonical_channel_id IS NOT NULL;
        CREATE TABLE competitor_video_refs (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          video_id TEXT NOT NULL,
          user_url TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX competitor_video_refs_video ON competitor_video_refs(video_id);
        CREATE TABLE competitor_notes (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          video_ref_id TEXT,
          channel_label TEXT NOT NULL DEFAULT '',
          video_url TEXT NOT NULL DEFAULT '',
          question TEXT NOT NULL DEFAULT '',
          observed TEXT NOT NULL DEFAULT '',
          hypothesis TEXT NOT NULL DEFAULT '',
          counter TEXT NOT NULL DEFAULT '',
          try_one TEXT NOT NULL DEFAULT '',
          confidence TEXT NOT NULL DEFAULT 'unset',
          timestamps TEXT NOT NULL DEFAULT '[]',
          client_request_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX competitor_notes_request ON competitor_notes(client_request_id);
        CREATE INDEX competitor_notes_channel ON competitor_notes(channel_id, updated_at);
        CREATE TABLE competitor_evidence (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          entity_ref TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          observed_at TEXT,
          definition TEXT NOT NULL DEFAULT '',
          expires_at TEXT,
          expired INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE competitor_classifications (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          format TEXT,
          orientation TEXT,
          language TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL,
          confirmed_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX competitor_class_manual ON competitor_classifications(entity_type, entity_id)
          WHERE source = 'manual';
        CREATE TABLE competitor_sync_runs (
          id TEXT PRIMARY KEY,
          channel_id TEXT,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          cursor TEXT,
          processed INTEGER NOT NULL DEFAULT 0,
          succeeded INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          requested_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT
        );
        CREATE TABLE competitor_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    name: '2026-10-youtube-manual-metrics',
    rewritesData: false,
    up: (database) => {
      database.exec(`
        CREATE TABLE youtube_manual_metrics (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL,
          entered_at TEXT NOT NULL,
          data TEXT NOT NULL
        );
        CREATE INDEX youtube_manual_metrics_post ON youtube_manual_metrics(post_id, entered_at);
      `);
    },
  },
  {
    name: '2026-11-competitor-renewal',
    rewritesData: true,
    up: (database) => {
      database.exec(`
        DROP TABLE competitor_evidence;
        DROP TABLE competitor_notes;
        ALTER TABLE competitor_channels DROP COLUMN learn;
        ALTER TABLE competitor_channels DROP COLUMN audience;
        ALTER TABLE competitor_channels DROP COLUMN agents;
        ALTER TABLE competitor_channels DROP COLUMN maps;
        ALTER TABLE competitor_channels DROP COLUMN themes;
        ALTER TABLE competitor_video_refs ADD COLUMN focus_at TEXT;
        ALTER TABLE competitor_video_refs ADD COLUMN focus_reason TEXT NOT NULL DEFAULT '';
        ALTER TABLE competitor_video_refs ADD COLUMN source TEXT NOT NULL DEFAULT 'user_url';
        CREATE INDEX competitor_video_refs_focus ON competitor_video_refs(focus_at) WHERE focus_at IS NOT NULL;
        CREATE TABLE competitor_jots (
          id TEXT PRIMARY KEY,
          channel_id TEXT,
          video_id TEXT,
          body TEXT NOT NULL,
          at_seconds INTEGER,
          status TEXT NOT NULL DEFAULT 'open',
          handed_off_at TEXT,
          client_request_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX competitor_jots_request ON competitor_jots(client_request_id);
        CREATE INDEX competitor_jots_status ON competitor_jots(status, updated_at);
        CREATE INDEX competitor_jots_channel ON competitor_jots(channel_id, updated_at);
        CREATE INDEX competitor_jots_video ON competitor_jots(video_id);
        CREATE TABLE competitor_profile_entries (
          subject TEXT NOT NULL,
          theme TEXT NOT NULL,
          labels TEXT NOT NULL DEFAULT '[]',
          note TEXT NOT NULL DEFAULT '',
          source_url TEXT NOT NULL DEFAULT '',
          confirmed_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (subject, theme)
        );
        CREATE TABLE competitor_profile_options (
          theme TEXT NOT NULL,
          label TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          builtin INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (theme, label)
        );
        CREATE TABLE competitor_feature_tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          group_name TEXT NOT NULL,
          criteria TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL,
          archived_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX competitor_feature_tags_name ON competitor_feature_tags(name) WHERE archived_at IS NULL;
        CREATE TABLE competitor_video_feature_tags (
          video_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          origin TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (video_id, tag_id)
        );
        CREATE INDEX competitor_video_feature_tags_tag ON competitor_video_feature_tags(tag_id);
      `);
      const option = database.prepare(
        'INSERT INTO competitor_profile_options (theme, label, sort_order, builtin) VALUES (?, ?, ?, 1)',
      );
      for (const theme of PROFILE_THEMES) {
        DEFAULT_PROFILE_OPTIONS[theme.key].forEach((label, index) => option.run(theme.key, label, index));
      }
      const tag = database.prepare(
        'INSERT INTO competitor_feature_tags (id, name, group_name, criteria, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const createdAt = new Date().toISOString();
      DEFAULT_FEATURE_TAGS.forEach((item, index) => tag.run(randomUUID(), item.name, item.group, item.criteria, index, createdAt));
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
  /** 確認スクリプト用。この名前の移行の手前で止める。 */
  stopBefore?: string,
): MigrationResult => {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    (database.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map((row) => row.name),
  );
  const stop = stopBefore ? MIGRATIONS.findIndex((migration) => migration.name === stopBefore) : -1;
  const pending = (stop >= 0 ? MIGRATIONS.slice(0, stop) : MIGRATIONS).filter((migration) => !done.has(migration.name));
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
