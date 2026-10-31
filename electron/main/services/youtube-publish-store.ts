import type { DatabaseSync } from 'node:sqlite';
import {
  youtubePublishJobSchema,
  youtubePublishPresetSchema,
  type YoutubePublishJob,
  type YoutubePublishPreset,
} from '../../../shared/schema/youtube-publish';

type Parser<T> = { safeParse: (value: unknown) => { success: true; data: T } | { success: false } };

const parseRow = <T>(data: string, schema: Parser<T>): T | undefined => {
  try {
    const parsed = schema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export class YoutubePublishStore {
  constructor(private readonly database: () => DatabaseSync) {}

  job(id: string): YoutubePublishJob | undefined {
    const row = this.database().prepare('SELECT data FROM youtube_publish_jobs WHERE id = ?').get(id) as
      | { data: string }
      | undefined;
    return row ? parseRow(row.data, youtubePublishJobSchema) : undefined;
  }

  jobForTask(taskId: string): YoutubePublishJob | undefined {
    const row = this.database()
      .prepare('SELECT data FROM youtube_publish_jobs WHERE workflow_task_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(taskId) as { data: string } | undefined;
    return row ? parseRow(row.data, youtubePublishJobSchema) : undefined;
  }

  jobsForProject(projectId: string): YoutubePublishJob[] {
    const rows = this.database()
      .prepare('SELECT data FROM youtube_publish_jobs WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Array<{ data: string }>;
    return rows.flatMap((row) => {
      const job = parseRow(row.data, youtubePublishJobSchema);
      return job ? [job] : [];
    });
  }

  pendingJobs(): YoutubePublishJob[] {
    const rows = this.database()
      .prepare(
        `SELECT data FROM youtube_publish_jobs
         WHERE publication_state IN ('private', 'scheduled', 'unknown', 'unlisted')
            OR operation_state IN ('uploading', 'paused', 'processing', 'verifying', 'outcome_unknown', 'action_required')
         ORDER BY updated_at`,
      )
      .all() as Array<{ data: string }>;
    return rows.flatMap((row) => {
      const job = parseRow(row.data, youtubePublishJobSchema);
      return job ? [job] : [];
    });
  }

  saveJob(job: YoutubePublishJob): void {
    const parsed = youtubePublishJobSchema.parse(job);
    this.database()
      .prepare(
        `INSERT INTO youtube_publish_jobs (
           id, project_id, workflow_task_id, channel_id, video_id, operation_state, publication_state, updated_at, data
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project_id = excluded.project_id,
           workflow_task_id = excluded.workflow_task_id,
           channel_id = excluded.channel_id,
           video_id = excluded.video_id,
           operation_state = excluded.operation_state,
           publication_state = excluded.publication_state,
           updated_at = excluded.updated_at,
           data = excluded.data`,
      )
      .run(
        parsed.id,
        parsed.projectId,
        parsed.workflowTaskId ?? null,
        parsed.channelId,
        parsed.youtubeVideoId ?? null,
        parsed.operationState,
        parsed.publicationState,
        parsed.updatedAt,
        JSON.stringify(parsed),
      );
  }

  preset(id: string): YoutubePublishPreset | undefined {
    const row = this.database().prepare('SELECT data FROM youtube_publish_presets WHERE id = ?').get(id) as
      | { data: string }
      | undefined;
    return row ? parseRow(row.data, youtubePublishPresetSchema) : undefined;
  }

  presetForDelivery(deliveryPresetId: string): YoutubePublishPreset | undefined {
    const rows = this.database().prepare('SELECT data FROM youtube_publish_presets').all() as Array<{ data: string }>;
    return rows
      .flatMap((row) => {
        const preset = parseRow(row.data, youtubePublishPresetSchema);
        return preset ? [preset] : [];
      })
      .find((preset) => preset.deliveryPresetId === deliveryPresetId);
  }

  savePreset(preset: YoutubePublishPreset): void {
    const parsed = youtubePublishPresetSchema.parse(preset);
    this.database()
      .prepare(
        `INSERT INTO youtube_publish_presets (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(parsed.id, JSON.stringify(parsed));
  }
}
