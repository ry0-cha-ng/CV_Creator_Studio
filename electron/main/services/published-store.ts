import type { DatabaseSync } from 'node:sqlite';
import { publishedSnapshotSchema, type PublishedSnapshot } from '../../../shared/schema/published';

const parse = (data: string): PublishedSnapshot | undefined => {
  try {
    const parsed = publishedSnapshotSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** 投稿版は exportId ごとに1件。同じIDの再保存では中身を変えない。 */
export class PublishedStore {
  constructor(private readonly database: () => DatabaseSync) {}

  get(exportId: string): PublishedSnapshot | undefined {
    const row = this.database().prepare('SELECT data FROM published_snapshots WHERE export_id = ?').get(exportId) as
      | { data: string }
      | undefined;
    return row ? parse(row.data) : undefined;
  }

  forPost(postId: string): PublishedSnapshot | undefined {
    const row = this.database().prepare('SELECT data FROM published_snapshots WHERE post_id = ?').get(postId) as
      | { data: string }
      | undefined;
    return row ? parse(row.data) : undefined;
  }

  unboundByProject(projectId: string): PublishedSnapshot[] {
    const rows = this.database()
      .prepare('SELECT data FROM published_snapshots WHERE project_id = ? AND post_id IS NULL')
      .all(projectId) as Array<{ data: string }>;
    return rows.flatMap((row) => {
      const snapshot = parse(row.data);
      return snapshot ? [snapshot] : [];
    });
  }

  /** 既にあれば、渡した中身は捨てて保存済みを返す。 */
  saveIfAbsent(snapshot: PublishedSnapshot): PublishedSnapshot {
    const existing = this.get(snapshot.exportId);
    if (existing) return existing;
    const next = publishedSnapshotSchema.parse(snapshot);
    this.database()
      .prepare(
        `INSERT INTO published_snapshots (export_id, post_id, project_id, frozen_at, data)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(next.exportId, next.postId ?? null, next.projectId ?? null, next.frozenAt, JSON.stringify(next));
    return next;
  }

  /** 未接続の書き出し版だけ、投稿へ付ける。付いたあとは外さない。 */
  bind(exportId: string, postId: string): PublishedSnapshot | undefined {
    const current = this.get(exportId);
    if (!current || current.postId) return current;
    const next = publishedSnapshotSchema.parse({ ...current, postId });
    this.database()
      .prepare('UPDATE published_snapshots SET post_id = ?, data = ? WHERE export_id = ? AND post_id IS NULL')
      .run(postId, JSON.stringify(next), exportId);
    return this.get(exportId);
  }
}
