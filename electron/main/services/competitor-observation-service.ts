import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { COMPETITOR_ERROR_TEXT, parseVideoUrl, type CompetitorErrorCode } from '../../../shared/competitor';
import {
  buildFeatureIdeaInput,
  computeCommons,
  DEFAULT_PROFILE_OPTIONS,
  isProfileStale,
  PROFILE_THEME_KEYS,
  SELF_SUBJECT,
  tagCounts,
  type FeatureIdeaInput,
  type ParsedFeatureIdea,
} from '../../../shared/competitor-observation';
import type { CompetitorFailure, CompetitorReference, CompetitorResult } from '../../../shared/schema/competitor';
import {
  featureIdeaRequestSchema,
  focusAddSchema,
  focusSetSchema,
  jotIdsSchema,
  jotListSchema,
  jotSaveSchema,
  profileMatrixSchema,
  profileOptionSchema,
  profileSaveSchema,
  tagAssignSchema,
  tagSaveSchema,
  tagUnassignSchema,
  videoQuerySchema,
  type CompetitorJot,
  type FeatureIdeaResult,
  type FeatureTag,
  type JotPage,
  type ObservationSummary,
  type ObservedVideo,
  type ProfileEntry,
  type ProfileMatrix,
  type ProfileOptions,
  type ProfileSubject,
  type VideoPage,
} from '../../../shared/schema/competitor-observation';
import { CompetitorObservationStore, type JotRow, type ProfileRow, type TagRow } from './competitor-observation-store';
import { compareCount, type CompetitorService } from './competitor-service';
import { CompetitorStore, type ChannelRow } from './competitor-store';

/**
 * 自分のデータ（気づき・観察プロフィール・特徴タグ・注目動画）。
 * 利用条件や保存期限の判定とは独立している。API の値は表示用に CompetitorService から借りるだけで、ここでは保存しない。
 */
export class CompetitorObservationService {
  private readonly store: CompetitorObservationStore;
  private readonly channels: CompetitorStore;

  constructor(
    private readonly deps: {
      database: () => DatabaseSync;
      competitors: () => CompetitorService;
      now?: () => Date;
    },
  ) {
    this.store = new CompetitorObservationStore(deps.database);
    this.channels = new CompetitorStore(deps.database);
  }

  /** CompetitorService へ渡す。チャンネルの削除・統合を自分のデータにも反映する。 */
  readonly hooks = {
    channelRemoved: (channelId: string, videoIds: string[], keepJots: boolean) => this.store.channelRemoved(channelId, videoIds, keepJots),
    channelMerged: (from: string, to: string) => this.store.channelMerged(from, to),
  };

  summary(): CompetitorResult<ObservationSummary> {
    return this.guard(() => {
      const subjects = this.subjects().map((subject) => subject.id);
      const entries = this.store.profiles(subjects);
      const filled = new Set(entries.filter((entry) => entry.labels.length > 0 || entry.note).map((entry) => entry.subject));
      return {
        openJots: this.store.openJotCount(),
        profileFilled: filled.size,
        profileSubjects: subjects.length,
        commons: computeCommons(entries, subjects).slice(0, 3),
      };
    });
  }

  jots(input: unknown): CompetitorResult<JotPage> {
    return this.guard(() => {
      const query = jotListSchema.parse(input ?? {});
      const page = this.store.jots(query);
      const labels = this.labels();
      return { items: page.rows.map((row) => this.toJot(row, labels)), total: page.total };
    });
  }

  saveJot(input: unknown): CompetitorResult<CompetitorJot> {
    return this.guard(() => {
      const parsed = jotSaveSchema.parse(input);
      if (parsed.channelId && !this.channels.channel(parsed.channelId)) throw new ObservationError('unresolved');
      const now = this.iso();
      const existing = this.store.jotByRequest(parsed.clientRequestId) ?? (parsed.id ? this.store.jot(parsed.id) : undefined);
      const row: JotRow = {
        id: existing?.id ?? parsed.id ?? randomUUID(),
        channelId: existing?.channelId ?? parsed.channelId,
        videoId: existing?.videoId ?? parsed.videoId,
        body: parsed.body,
        atSeconds: parsed.atSeconds,
        status: existing?.status ?? 'open',
        handedOffAt: existing?.handedOffAt ?? null,
        clientRequestId: existing?.clientRequestId ?? parsed.clientRequestId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.store.saveJot(row);
      return this.toJot(row, this.labels());
    });
  }

  removeJot(id: unknown): CompetitorResult<{ id: string }> {
    return this.guard(() => {
      if (typeof id !== 'string' || !id) throw new ObservationError('invalid_input');
      this.store.removeJot(id);
      return { id };
    });
  }

  /** 仮説検証機能ができるまでは、渡した印を付けるだけ。 */
  handOff(input: unknown): CompetitorResult<{ count: number }> {
    return this.guard(() => {
      const parsed = jotIdsSchema.parse(input);
      return { count: this.store.handOff(parsed.ids, this.iso()) };
    });
  }

  /** 既存の Experiment / Insight が持つ外部観察 id の状態。旧観察メモは移行で削除済み。 */
  referenceState(ids: unknown): CompetitorResult<CompetitorReference[]> {
    return this.guard(() => {
      const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 50) : [];
      return list.map((id) => ({ id, state: this.store.jot(id) ? ('ok' as const) : ('deleted' as const) }));
    });
  }

  profileMatrix(input: unknown): CompetitorResult<ProfileMatrix> {
    return this.guard(() => {
      const parsed = profileMatrixSchema.parse(input ?? { subjects: [] });
      const all = this.subjects();
      const wanted = parsed.subjects.length > 0 ? all.filter((subject) => parsed.subjects.includes(subject.id)) : all;
      const ids = wanted.map((subject) => subject.id);
      const rows = this.store.profiles(ids);
      const now = this.iso();
      return {
        subjects: wanted,
        entries: rows.map((row) => this.toEntry(row, now)),
        commons: computeCommons(rows, ids),
        filled: new Set(rows.filter((row) => row.labels.length > 0 || row.note).map((row) => row.subject)).size,
      };
    });
  }

  saveProfile(input: unknown): CompetitorResult<ProfileEntry> {
    return this.guard(() => {
      const parsed = profileSaveSchema.parse(input);
      if (parsed.subject !== SELF_SUBJECT && !this.channels.channel(parsed.subject)) throw new ObservationError('unresolved');
      const now = this.iso();
      const current = this.store.profiles([parsed.subject]).find((row) => row.theme === parsed.theme);
      const labels = [...new Set(parsed.labels)];
      for (const label of labels) this.store.addProfileOption(parsed.theme, label);
      const row: ProfileRow = {
        subject: parsed.subject,
        theme: parsed.theme,
        labels,
        note: parsed.note,
        sourceUrl: parsed.sourceUrl,
        confirmedAt: parsed.confirmed ? now : (current?.confirmedAt ?? null),
        updatedAt: now,
      };
      this.store.saveProfile(row);
      return this.toEntry(row, now);
    });
  }

  profileOptions(): CompetitorResult<ProfileOptions> {
    return this.guard(() => this.options());
  }

  addProfileOption(input: unknown): CompetitorResult<ProfileOptions> {
    return this.guard(() => {
      const parsed = profileOptionSchema.parse(input);
      this.store.addProfileOption(parsed.theme, parsed.label);
      return this.options();
    });
  }

  tags(): CompetitorResult<FeatureTag[]> {
    return this.guard(() => {
      const focus = new Set(this.store.focusRows().filter((row) => row.focusAt).map((row) => row.videoId));
      const counts = tagCounts(this.store.assignments(), focus);
      return this.store.tags().map((tag) => this.toTag(tag, counts.get(tag.id)));
    });
  }

  saveTag(input: unknown): CompetitorResult<FeatureTag> {
    return this.guard(() => {
      const parsed = tagSaveSchema.parse(input);
      const sameName = this.store.tagByName(parsed.name);
      if (sameName && sameName.id !== parsed.id) {
        if (!parsed.id) return this.toTag(sameName, undefined);
        throw new ObservationError('duplicate', '同じ名前の特徴タグがあります');
      }
      const saved = this.store.saveTag({
        id: parsed.id ?? randomUUID(),
        name: parsed.name,
        group: parsed.group,
        criteria: parsed.criteria,
        archivedAt: null,
        createdAt: this.iso(),
      });
      return this.toTag(saved, undefined);
    });
  }

  archiveTag(id: unknown): CompetitorResult<{ id: string }> {
    return this.guard(() => {
      if (typeof id !== 'string' || !id) throw new ObservationError('invalid_input');
      this.store.archiveTag(id, this.iso());
      return { id };
    });
  }

  assignTag(input: unknown): CompetitorResult<{ count: number }> {
    return this.guard(() => {
      const parsed = tagAssignSchema.parse(input);
      if (!this.store.tag(parsed.tagId)) throw new ObservationError('unresolved');
      const now = this.iso();
      for (const videoId of parsed.videoIds) this.store.assign(videoId, parsed.tagId, parsed.origin, now);
      return { count: parsed.videoIds.length };
    });
  }

  unassignTag(input: unknown): CompetitorResult<{ ok: true }> {
    return this.guard(() => {
      const parsed = tagUnassignSchema.parse(input);
      this.store.unassign(parsed.videoId, parsed.tagId);
      return { ok: true as const };
    });
  }

  addFocusUrls(input: unknown): CompetitorResult<{ added: string[]; invalid: string[] }> {
    return this.guard(() => {
      const parsed = focusAddSchema.parse(input);
      if (!this.channels.channel(parsed.channelId)) throw new ObservationError('unresolved');
      const added: string[] = [];
      const invalid: string[] = [];
      const lines = parsed.urls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50);
      for (const line of lines) {
        const video = parseVideoUrl(line);
        if (!video) {
          invalid.push(line);
          continue;
        }
        this.store.setFocus({
          channelId: parsed.channelId,
          videoId: video.videoId,
          userUrl: video.url,
          focus: true,
          reason: parsed.reason || undefined,
          source: 'user_url',
          now: this.iso(),
        });
        added.push(video.videoId);
      }
      return { added, invalid };
    });
  }

  setFocus(input: unknown): CompetitorResult<{ videoId: string; focus: boolean }> {
    return this.guard(() => {
      const parsed = focusSetSchema.parse(input);
      if (!this.channels.channel(parsed.channelId)) throw new ObservationError('unresolved');
      this.store.setFocus({
        channelId: parsed.channelId,
        videoId: parsed.videoId,
        userUrl: `https://www.youtube.com/watch?v=${parsed.videoId}`,
        focus: parsed.focus,
        reason: parsed.reason,
        source: 'sync',
        now: this.iso(),
      });
      return { videoId: parsed.videoId, focus: parsed.focus };
    });
  }

  videos(input: unknown): CompetitorResult<VideoPage> {
    return this.guard(() => {
      const query = videoQuerySchema.parse(input ?? {});
      const channels = this.activeChannels().filter((channel) => !query.channelIds || query.channelIds.includes(channel.id));
      const focusRows = this.store.focusRows(channels.map((channel) => channel.id));
      const focusByVideo = new Map(focusRows.map((row) => [row.videoId, row]));
      const all: ObservedVideo[] = [];
      for (const channel of channels) {
        const competitors = this.deps.competitors();
        const label = competitors.channelLabel(channel);
        const hasVidiq = competitors.vidiqUrl(channel) !== null;
        for (const video of competitors.channelVideos(channel.id)) {
          const focus = focusByVideo.get(video.videoId);
          all.push({
            ...video,
            channelId: channel.id,
            channelLabel: label,
            focusAt: focus?.focusAt ?? null,
            focusReason: focus?.focusReason ?? '',
            tagIds: [],
            jotCount: 0,
            vidiqUrl: hasVidiq ? competitors.vidiqUrl(channel, video.videoId) : null,
          });
        }
      }
      const ids = all.map((video) => video.videoId);
      const jotCounts = this.store.jotCountsByVideo(ids);
      const tagsByVideo = new Map<string, string[]>();
      for (const item of this.store.assignments(ids)) tagsByVideo.set(item.videoId, [...(tagsByVideo.get(item.videoId) ?? []), item.tagId]);
      for (const video of all) {
        video.jotCount = jotCounts.get(video.videoId) ?? 0;
        video.tagIds = tagsByVideo.get(video.videoId) ?? [];
      }
      const filtered = all.filter((video) => {
        if (query.focusOnly && !video.focusAt) return false;
        if (query.jotsOnly && video.jotCount === 0) return false;
        if (query.untaggedOnly && video.tagIds.length > 0) return false;
        if (query.format === 'unconfirmed') return video.format === null;
        if (query.format !== 'all') return video.format === query.format;
        return true;
      });
      filtered.sort((a, b) =>
        query.sort === 'views'
          ? compareCount(b.viewCount, a.viewCount)
          : query.focusOnly
            ? (b.focusAt ?? '').localeCompare(a.focusAt ?? '')
            : (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
      );
      return {
        items: filtered.slice(query.offset, query.offset + query.limit),
        total: filtered.length,
        focusTotal: all.filter((video) => video.focusAt).length,
      };
    });
  }

  /** AI に送る内容。自分で付けた・書いたものだけを集める。videoIds[i] が sent.videos[i]（V{i+1}）にあたる。 */
  featureIdeaInput(input: unknown): CompetitorResult<{ sent: FeatureIdeaInput; videoIds: string[] }> {
    return this.guard(() => {
      const parsed = featureIdeaRequestSchema.parse(input);
      const focusIds = parsed.focusVideoIds;
      const compareIds = parsed.compareVideoIds.filter((id) => !focusIds.includes(id));
      const ids = [...focusIds, ...compareIds];
      const tags = new Map(this.store.tags().map((tag) => [tag.id, tag]));
      const tagNames = new Map<string, string[]>();
      for (const item of this.store.assignments(ids)) {
        const tag = tags.get(item.tagId);
        if (tag) tagNames.set(item.videoId, [...(tagNames.get(item.videoId) ?? []), tag.name]);
      }
      const jots = this.store.jotBodiesByVideo(ids);
      const focus = new Map(this.store.focusRows().map((row) => [row.videoId, row]));
      const sent = buildFeatureIdeaInput({
        videos: ids.map((videoId) => ({
          ref: videoId,
          focus: focusIds.includes(videoId),
          focusReason: focus.get(videoId)?.focusReason ?? '',
          format: this.channels.classification('video', videoId)?.format ?? null,
          tags: tagNames.get(videoId) ?? [],
          jots: jots.get(videoId) ?? [],
        })),
        existingTags: [...tags.values()].map((tag) => ({ name: tag.name, group: tag.group, criteria: tag.criteria })),
      });
      return { sent, videoIds: ids.slice(0, sent.videos.length) };
    });
  }

  /** AI の候補の V1 などを動画 id に戻し、注目動画と比較用の動画それぞれで当てはまった数を数える。 */
  resolveIdeas(parsed: ParsedFeatureIdea[], prepared: { sent: FeatureIdeaInput; videoIds: string[] }): FeatureIdeaResult {
    return {
      sent: prepared.sent,
      ideas: parsed.map((idea) => ({
        name: idea.name,
        group: idea.group,
        fact: idea.fact,
        hypothesis: idea.hypothesis,
        counter: idea.counter,
        videoIds: idea.refs.map((index) => prepared.videoIds[index]).filter((id): id is string => Boolean(id)),
        focusHits: idea.refs.filter((index) => prepared.sent.videos[index]?.focus).length,
        compareHits: idea.refs.filter((index) => prepared.sent.videos[index] && !prepared.sent.videos[index].focus).length,
      })),
    };
  }

  private subjects(): ProfileSubject[] {
    const competitors = this.deps.competitors();
    return [
      { id: SELF_SUBJECT, label: '自分', self: true, vidiqUrl: null },
      ...this.activeChannels().map((channel) => ({
        id: channel.id,
        label: competitors.channelLabel(channel),
        self: false,
        vidiqUrl: competitors.vidiqUrl(channel),
      })),
    ];
  }

  private activeChannels(): ChannelRow[] {
    return this.channels.channels().filter((channel) => !channel.archivedAt);
  }

  private labels(): Map<string, string> {
    return new Map(this.channels.channels().map((channel) => [channel.id, this.deps.competitors().channelLabel(channel)]));
  }

  private options(): ProfileOptions {
    const options = Object.fromEntries(PROFILE_THEME_KEYS.map((key) => [key, [] as string[]])) as ProfileOptions;
    for (const row of this.store.profileOptions()) options[row.theme]?.push(row.label);
    for (const key of PROFILE_THEME_KEYS) if (options[key].length === 0) options[key] = [...DEFAULT_PROFILE_OPTIONS[key]];
    return options;
  }

  private toJot(row: JotRow, labels: Map<string, string>): CompetitorJot {
    return {
      id: row.id,
      channelId: row.channelId,
      channelLabel: row.channelId ? (labels.get(row.channelId) ?? null) : null,
      videoId: row.videoId,
      body: row.body,
      atSeconds: row.atSeconds,
      status: row.status,
      handedOffAt: row.handedOffAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toEntry(row: ProfileRow, now: string): ProfileEntry {
    return { ...row, stale: isProfileStale(row.confirmedAt, now) };
  }

  private toTag(tag: TagRow, count: { focus: number; all: number } | undefined): FeatureTag {
    return {
      id: tag.id,
      name: tag.name,
      group: tag.group,
      criteria: tag.criteria,
      focusCount: count?.focus ?? 0,
      allCount: count?.all ?? 0,
    };
  }

  private guard<T>(work: () => T): CompetitorResult<T> {
    try {
      this.deps.database();
    } catch {
      return { ok: false, code: 'unavailable', message: '保存先フォルダを選んでから使えます' };
    }
    try {
      return { ok: true, data: work() };
    } catch (error) {
      if (error instanceof ObservationError) return error.failure();
      if (error instanceof Error && error.name === 'ZodError') return this.fail('invalid_input');
      throw error;
    }
  }

  private fail(code: CompetitorErrorCode, message?: string): CompetitorFailure {
    return { ok: false, code, message: message ?? COMPETITOR_ERROR_TEXT[code] };
  }

  private iso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
}

class ObservationError extends Error {
  constructor(
    readonly code: CompetitorErrorCode,
    readonly detail?: string,
  ) {
    super(code);
  }

  failure(): CompetitorFailure {
    return { ok: false, code: this.code, message: this.detail ?? COMPETITOR_ERROR_TEXT[this.code] };
  }
}
