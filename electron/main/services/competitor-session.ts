import { randomUUID } from 'node:crypto';
import { API_RETENTION_DAYS, METRIC_DEFINITION_VERSION, BASIC_POLICY_ID, retentionDeadline, basicPolicy } from '../../../shared/competitor';

export type SessionFields = {
  entityType: 'channel' | 'video';
  entityId: string;
  channelId: string;
  title: string;
  description: string;
  handle?: string;
  publishedAt?: string;
  uploadsPlaylistId?: string;
  thumbnailUrl?: string;
  durationIso?: string;
  categoryId?: string;
  tags?: string[];
  defaultLanguage?: string;
  liveBroadcastContent?: string;
  fetchedAt: string;
  expiresAt: string;
  runId: string;
  availability: 'available' | 'unavailable';
  lastSuccessAt?: string;
};

export type SessionObservation = {
  entityType: 'channel' | 'video';
  entityId: string;
  channelId: string;
  observedAt: string;
  expiresAt: string;
  runId: string;
  definitionVersion: string;
  policyId: string;
  viewCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  subscriberCount: string | null;
  videoCount: string | null;
  hiddenSubscriberCount: boolean;
  reasons: Record<string, string>;
};

export type SessionCoverage = {
  channelId: string;
  oldest: string | null;
  newest: string | null;
  scan: 'complete' | 'capped' | 'interrupted' | 'partial';
  listed: number;
  saved: number;
  excluded: number;
  missing: number;
  fetchedAt: string;
  expiresAt: string;
  runId: string;
};

const metaKey = (type: string, id: string) => `${type}:${id}`;
const obsKey = (type: string, id: string, runId: string) => `${type}:${id}:${runId}`;

/** API由来の本文と統計。プロセスメモリだけ。ディスクへ書くメソッドは持たない。 */
export class CompetitorSession {
  private readonly metas = new Map<string, SessionFields>();
  private readonly observations = new Map<string, SessionObservation>();
  private readonly coverage = new Map<string, SessionCoverage>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  clear(): void {
    this.metas.clear();
    this.observations.clear();
    this.coverage.clear();
  }

  clearChannel(channelId: string): void {
    for (const [key, meta] of this.metas) if (meta.channelId === channelId) this.metas.delete(key);
    for (const [key, obs] of this.observations) if (obs.channelId === channelId) this.observations.delete(key);
    this.coverage.delete(channelId);
  }

  private purge(): void {
    const now = this.now().toISOString();
    for (const [key, meta] of this.metas) if (meta.expiresAt <= now) this.metas.delete(key);
    for (const [key, obs] of this.observations) if (obs.expiresAt <= now) this.observations.delete(key);
    for (const [key, item] of this.coverage) if (item.expiresAt <= now) this.coverage.delete(key);
  }

  putMeta(fields: SessionFields): void {
    this.purge();
    this.metas.set(metaKey(fields.entityType, fields.entityId), fields);
  }

  meta(type: 'channel' | 'video', id: string): SessionFields | null {
    this.purge();
    const found = this.metas.get(metaKey(type, id));
    if (!found || found.availability !== 'available') return found ?? null;
    return found;
  }

  markUnavailable(type: 'channel' | 'video', id: string, channelId: string): void {
    this.purge();
    const key = metaKey(type, id);
    const current = this.metas.get(key);
    const now = this.now().toISOString();
    this.metas.set(key, {
      entityType: type,
      entityId: id,
      channelId: current?.channelId ?? channelId,
      title: '',
      description: '',
      fetchedAt: current?.fetchedAt ?? now,
      expiresAt: current?.expiresAt ?? retentionDeadline(basicPolicy(), now),
      runId: current?.runId ?? '',
      availability: 'unavailable',
      lastSuccessAt: current?.availability === 'available' ? current.fetchedAt : current?.lastSuccessAt,
    });
  }

  addObservation(input: Omit<SessionObservation, 'definitionVersion' | 'policyId' | 'expiresAt'> & { expiresAt?: string }): SessionObservation {
    this.purge();
    const key = obsKey(input.entityType, input.entityId, input.runId);
    const existing = this.observations.get(key);
    if (existing) return existing;
    const row: SessionObservation = {
      ...input,
      definitionVersion: METRIC_DEFINITION_VERSION,
      policyId: BASIC_POLICY_ID,
      expiresAt: input.expiresAt ?? retentionDeadline(basicPolicy(), input.observedAt),
    };
    this.observations.set(key, row);
    return row;
  }

  observationsFor(type: 'channel' | 'video', id: string): SessionObservation[] {
    this.purge();
    return [...this.observations.values()].filter((item) => item.entityType === type && item.entityId === id);
  }

  videosFor(channelId: string): SessionFields[] {
    this.purge();
    return [...this.metas.values()].filter((item) => item.entityType === 'video' && item.channelId === channelId);
  }

  putCoverage(coverage: Omit<SessionCoverage, 'expiresAt'>): void {
    this.purge();
    this.coverage.set(coverage.channelId, {
      ...coverage,
      expiresAt: retentionDeadline(basicPolicy(), coverage.fetchedAt),
    });
  }

  coverageFor(channelId: string): SessionCoverage | null {
    this.purge();
    return this.coverage.get(channelId) ?? null;
  }

  /** テスト用。永続化ではない。 */
  observationCount(): number {
    this.purge();
    return this.observations.size;
  }

  hasSentinel(sentinel: string): boolean {
    const blob = JSON.stringify({
      metas: [...this.metas.values()],
      observations: [...this.observations.values()],
    });
    return blob.includes(sentinel);
  }
}

export const sessionRunId = (): string => randomUUID();

export const retentionDays = API_RETENTION_DAYS;
