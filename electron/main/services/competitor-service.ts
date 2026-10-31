import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  basicPolicy,
  COMPETITOR_ERROR_TEXT,
  DEFAULT_MAX_VIDEOS,
  DEFAULT_QUOTA_BUDGET,
  DEFAULT_TIMEZONE,
  DEFAULT_WINDOW_DAYS,
  localDate,
  parseChannelLine,
  parseChannelLines,
  retentionDeadline,
  VIDEO_BATCH,
  vidiqChannelUrl,
  youtubeHandle,
  type CompetitorErrorCode,
  type ParsedChannelInput,
} from '../../../shared/competitor';
import {
  competitorClassificationSchema,
  competitorConfirmSchema,
  competitorGlobalSchema,
  competitorOpenSchema,
  competitorPreviewSchema,
  competitorRemoveSchema,
  competitorSettingsSchema,
  competitorSyncSchema,
  type CompetitorCoverage,
  type CompetitorDetail,
  type CompetitorFailure,
  type CompetitorListItem,
  type CompetitorPreview,
  type CompetitorPreviewRow,
  type CompetitorResult,
  type CompetitorSyncView,
  type CompetitorVideo,
} from '../../../shared/schema/competitor';
import { parseIsoDuration } from '../../../shared/youtube-analytics';
import { CompetitorPortError, type CompetitorPort, type PublicChannel, type PublicVideo } from './competitor-port';
import { CompetitorSession, type SessionFields } from './competitor-session';
import { CompetitorStore, type ChannelRow, type RunRow } from './competitor-store';

/** 自分のデータ（気づき・プロフィール・タグ）側へ、チャンネルの削除と統合を伝える。 */
export type CompetitorChannelHooks = {
  channelRemoved: (channelId: string, videoIds: string[], keepJots: boolean) => void;
  channelMerged: (from: string, to: string) => void;
};

const EXTERNAL_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'vidiq.com', 'www.vidiq.com', 'app.vidiq.com']);

/**
 * 再利用: YouTube読み取りトークン（アップロード範囲は足さない）、studio.db。
 * 競合のAPI本文と統計は studio.db に書かない。終了中に削除できないためメモリだけ。
 * 自チャンネルの投稿・スナップショット・予約テーブルは更新しない。
 * 気づき・観察プロフィール・特徴タグは CompetitorObservationService が持つ。
 */
export class CompetitorService {
  private readonly store: CompetitorStore;
  private readonly session: CompetitorSession;
  private readonly previews = new Map<string, { at: number; rows: CompetitorPreviewRow[] }>();
  private active = false;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly deps: {
      database: () => DatabaseSync;
      port: CompetitorPort;
      now?: () => Date;
      session?: CompetitorSession;
      hooks?: CompetitorChannelHooks;
      onProgress?: (view: CompetitorSyncView) => void;
    },
  ) {
    this.store = new CompetitorStore(deps.database);
    this.session = deps.session ?? new CompetitorSession(() => this.now());
  }

  spend(units = 1): void {
    const day = localDate(this.iso(), this.timeZone());
    const raw = this.store.setting('quota_usage');
    const usage = raw ? (JSON.parse(raw) as { day: string; used: number }) : { day, used: 0 };
    const used = usage.day === day ? usage.used : 0;
    if (used + units > this.quotaBudget()) throw new CompetitorPortError('quota_exceeded');
    this.store.putSetting('quota_usage', JSON.stringify({ day, used: used + units }));
  }

  onWorkspaceChange(): void {
    this.session.clear();
    this.previews.clear();
    try {
      this.store.markInterrupted(this.iso());
    } catch {
      // 保存先が無い、または移行前。
    }
  }

  arm(everyMs = 30 * 60 * 1000): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.catchUp();
    }, everyMs);
  }

  async catchUp(): Promise<void> {
    if (this.active || this.deps.port.priorityBusy()) return;
    let due: ChannelRow[] = [];
    try {
      due = this.dueChannels();
    } catch {
      return;
    }
    if (due.length === 0) return;
    this.kick(due, 'refresh');
    await this.idle();
  }

  async preview(input: unknown): Promise<CompetitorResult<CompetitorPreview>> {
    const ready = this.ready();
    if (ready) return ready;
    const parsed = competitorPreviewSchema.safeParse(input);
    if (!parsed.success) return this.fail('invalid_input');
    const rawLines = parsed.data.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const lines = parseChannelLines(parsed.data.text);
    const connected = await this.deps.port.connected().catch(() => false);
    const own = this.deps.port.ownChannelId();
    const rows: CompetitorPreviewRow[] = [];
    let lookupCount = 0;
    const seen = new Set<string>();
    for (const line of lines) {
      if (line.kind === 'invalid') {
        rows.push(this.row(`invalid:${rows.length}`, line.raw, 'invalid', false, line.reason, null, null, null));
        continue;
      }
      if (line.kind === 'id' && line.channelId === own) {
        rows.push(this.row(line.key, line.raw, 'own_channel', false, COMPETITOR_ERROR_TEXT.own_channel, line.channelId, null, null));
        continue;
      }
      let found: PublicChannel | null = null;
      if (connected && (line.kind === 'id' || line.kind === 'handle' || line.kind === 'username')) {
        lookupCount += 1;
        try {
          found = await this.deps.port.lookup(line, new AbortController().signal);
        } catch (error) {
          const code = this.codeOf(error);
          rows.push(this.row(line.key, line.raw, 'error', false, COMPETITOR_ERROR_TEXT[code], null, null, null));
          if (code === 'quota_exceeded' || code === 'auth_required') break;
          continue;
        }
      }
      if (found && found.channelId === own) {
        rows.push(this.row(line.key, line.raw, 'own_channel', false, COMPETITOR_ERROR_TEXT.own_channel, found.channelId, found.title, null));
        continue;
      }
      const canonical = found?.channelId ?? (line.kind === 'id' ? line.channelId : null);
      if (canonical && seen.has(canonical)) {
        rows.push(this.row(line.key, line.raw, 'duplicate', false, COMPETITOR_ERROR_TEXT.duplicate, canonical, found?.title ?? null, null));
        continue;
      }
      if (canonical) seen.add(canonical);
      const existing = canonical ? this.store.findByCanonical(canonical) : this.store.findByInputKey(line.key);
      if (existing) {
        rows.push(
          this.row(
            line.key,
            line.raw,
            'duplicate',
            false,
            '登録済みのチャンネルです。表示名やハンドルが変わっていても同じです',
            canonical,
            found?.title ?? null,
            existing.id,
          ),
        );
        continue;
      }
      if (!found && line.kind !== 'id' && line.kind !== 'unresolved') {
        rows.push(this.row(line.key, line.raw, 'unresolved', true, '未接続でも、このURLとメモは登録できます', null, null, null));
        continue;
      }
      if (line.kind === 'unresolved' && !found) {
        rows.push(this.row(line.key, line.raw, 'unresolved', true, line.reason, null, null, null));
        continue;
      }
      rows.push(
        this.row(
          line.key,
          line.raw,
          'ready',
          true,
          found ? '登録できます' : 'チャンネルIDとして登録します。表示名は取得後に出ます',
          canonical,
          found?.title ?? null,
          null,
        ),
      );
    }
    const previewId = randomUUID();
    this.previews.set(previewId, { at: this.now().getTime(), rows });
    this.dropOldPreviews();
    return { ok: true, data: { previewId, rows, lookupCount, connected, truncated: rawLines.length > 50 } };
  }

  async confirm(input: unknown): Promise<CompetitorResult<{ channels: CompetitorListItem[] }>> {
    const ready = this.ready();
    if (ready) return ready;
    const parsed = competitorConfirmSchema.safeParse(input);
    if (!parsed.success) return this.fail('invalid_input');
    const preview = this.previews.get(parsed.data.previewId);
    if (!preview || this.now().getTime() - preview.at > 15 * 60 * 1000) {
      return { ok: false, code: 'invalid_input', message: '確認の期限が切れました。もう一度読み込んでください' };
    }
    const created: ChannelRow[] = [];
    const listed: CompetitorListItem[] = [];
    for (const key of parsed.data.keys) {
      const row = preview.rows.find((item) => item.key === key);
      if (!row?.canSave) continue;
      const saved = this.upsertFromPreview(row);
      listed.push(this.toListItem(saved));
      created.push(saved);
    }
    if (created.length > 0 && (await this.deps.port.connected().catch(() => false))) this.kick(created, 'refresh');
    return { ok: true, data: { channels: listed } };
  }

  list(): CompetitorResult<CompetitorListItem[]> {
    const ready = this.ready();
    if (ready) return ready;
    return { ok: true, data: this.store.channels().filter((item) => !item.archivedAt).map((item) => this.toListItem(item)) };
  }

  detail(id: string): CompetitorResult<CompetitorDetail> {
    const ready = this.ready();
    if (ready) return ready;
    const channel = this.store.channel(id);
    if (!channel) return this.fail('unresolved');
    return { ok: true, data: this.toDetail(channel) };
  }

  updateSettings(input: unknown): CompetitorResult<CompetitorDetail> {
    const ready = this.ready();
    if (ready) return ready;
    const parsed = competitorSettingsSchema.safeParse(input);
    if (!parsed.success) return this.fail('invalid_input');
    const channel = this.store.channel(parsed.data.id);
    if (!channel) return this.fail('unresolved');
    const patch = parsed.data;
    if (patch.alias !== undefined) channel.alias = patch.alias;
    if (patch.reason !== undefined) channel.reason = patch.reason;
    if (patch.tags !== undefined) channel.tags = patch.tags;
    if (patch.language !== undefined) channel.language = patch.language;
    if (patch.watchState !== undefined) channel.watchState = patch.watchState;
    if (patch.windowDays !== undefined) channel.windowDays = patch.windowDays;
    if (patch.maxVideos !== undefined) channel.maxVideos = patch.maxVideos;
    if (patch.tier !== undefined) {
      channel.tier = patch.tier;
      if (patch.cadence === undefined) channel.cadence = patch.tier === 'primary' ? 'daily' : 'weekly';
      if (patch.tier === 'hold' && patch.syncEnabled === undefined) channel.syncEnabled = false;
    }
    if (patch.cadence !== undefined) channel.cadence = patch.cadence;
    if (patch.syncEnabled !== undefined) channel.syncEnabled = patch.syncEnabled;
    channel.updatedAt = this.iso();
    this.store.updateChannel(channel);
    return { ok: true, data: this.toDetail(channel) };
  }

  archive(id: string): CompetitorResult<CompetitorListItem> {
    const ready = this.ready();
    if (ready) return ready;
    const channel = this.store.channel(id);
    if (!channel) return this.fail('unresolved');
    channel.syncEnabled = false;
    channel.updatedAt = this.iso();
    this.store.updateChannel(channel);
    return { ok: true, data: this.toListItem(channel) };
  }

  remove(input: unknown): CompetitorResult<{ id: string }> {
    const ready = this.ready();
    if (ready) return ready;
    const parsed = competitorRemoveSchema.safeParse(input);
    if (!parsed.success) return this.fail('invalid_input');
    const channel = this.store.channel(parsed.data.id);
    if (!channel) return { ok: true, data: { id: parsed.data.id } };
    const videoIds = [
      ...this.session.videosFor(channel.canonicalChannelId ?? channel.id).map((item) => item.entityId),
      ...this.store.videoRefs(channel.id).map((item) => item.videoId),
    ];
    this.session.clearChannel(channel.canonicalChannelId ?? channel.id);
    this.store.deleteClassifications([channel.id, ...(channel.canonicalChannelId ? [channel.canonicalChannelId] : []), ...videoIds]);
    this.deps.hooks?.channelRemoved(channel.id, videoIds, parsed.data.keepNotes);
    this.store.deleteVideoRefs(channel.id);
    this.store.deleteChannel(channel.id);
    return { ok: true, data: { id: channel.id } };
  }

  sync(input: unknown): CompetitorResult<CompetitorSyncView> {
    const ready = this.ready();
    if (ready) return ready;
    const parsed = competitorSyncSchema.safeParse(input ?? {});
    if (!parsed.success) return this.fail('invalid_input');
    if (this.active) return { ok: true, data: this.syncView() };
    if (this.deps.port.priorityBusy()) return this.fail('busy');
    const target = parsed.data.channelId ? this.store.channel(parsed.data.channelId) : undefined;
    if (parsed.data.channelId && !target) return this.fail('unresolved');
    if (target && (!target.syncEnabled || target.archivedAt)) {
      return { ok: false, code: 'invalid_input', message: '収集を止めているチャンネルです。再開してから取得します' };
    }
    const channels = target ? [target] : this.store.channels().filter((item) => item.syncEnabled && !item.archivedAt);
    this.kick(channels, parsed.data.mode);
    return { ok: true, data: this.syncView() };
  }

  async waitUntilIdle(): Promise<void> {
    await this.idle();
  }

  cancel(): CompetitorResult<CompetitorSyncView> {
    this.abort?.abort();
    return { ok: true, data: this.syncView() };
  }

  syncStatus(): CompetitorResult<CompetitorSyncView> {
    const ready = this.ready();
    if (ready) return ready;
    return { ok: true, data: this.syncView() };
  }

  classify(input: unknown): CompetitorResult<{ saved: true }> {
    const ready = this.ready();
    if (ready) return ready;
    const parsed = competitorClassificationSchema.safeParse(input);
    if (!parsed.success) return this.fail('invalid_input');
    const current = this.store.classification(parsed.data.entityType, parsed.data.entityId);
    this.store.saveClassification(
      {
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        format: parsed.data.format === undefined ? (current?.format ?? null) : parsed.data.format,
        orientation: parsed.data.orientation === undefined ? (current?.orientation ?? null) : parsed.data.orientation,
        language: parsed.data.language === undefined ? (current?.language ?? null) : parsed.data.language,
        tags: parsed.data.tags,
        confirmedAt: this.iso(),
      },
      this.iso(),
    );
    return { ok: true, data: { saved: true } };
  }

  async openExternal(input: unknown): Promise<CompetitorResult<{ opened: true }>> {
    const parsed = competitorOpenSchema.safeParse(input);
    if (!parsed.success) return this.fail('invalid_input');
    let url: URL;
    try {
      url = new URL(parsed.data.url);
    } catch {
      return this.fail('invalid_input');
    }
    if (url.protocol !== 'https:' || !EXTERNAL_HOSTS.has(url.hostname.toLowerCase())) {
      return this.fail('invalid_input');
    }
    await this.deps.port.openExternal(url.toString());
    return { ok: true, data: { opened: true } };
  }

  updateGlobal(input: unknown): CompetitorResult<CompetitorSyncView> {
    const ready = this.ready();
    if (ready) return ready;
    const parsed = competitorGlobalSchema.safeParse(input);
    if (!parsed.success) return this.fail('invalid_input');
    if (parsed.data.quotaBudget !== undefined) this.store.putSetting('quota_budget', String(parsed.data.quotaBudget));
    if (parsed.data.timeZone !== undefined) this.store.putSetting('timezone', parsed.data.timeZone);
    return { ok: true, data: this.syncView() };
  }

  /** チャンネルの動画（この起動で取得した分と、自分で追加・注目にした分）。表示用で、並べ替えや集計はしない。 */
  channelVideos(channelId: string): CompetitorVideo[] {
    const channel = this.store.channel(channelId);
    if (!channel) return [];
    const refs = this.store.videoRefs(channel.id);
    const ids = new Set<string>([
      ...this.session.videosFor(channel.canonicalChannelId ?? channel.id).map((item) => item.entityId),
      ...refs.map((item) => item.videoId),
    ]);
    const userAdded = new Set(refs.map((item) => item.videoId));
    return [...ids].map((videoId) => this.toVideo(videoId, userAdded.has(videoId)));
  }

  channelLabel(channel: ChannelRow): string {
    const meta = channel.canonicalChannelId ? this.session.meta('channel', channel.canonicalChannelId) : null;
    return channel.alias || (meta?.availability === 'available' ? meta.title : null) || channel.userInput;
  }

  /** vidIQ の公開統計ページ。ハンドルが分からないチャンネルは null。 */
  vidiqUrl(channel: ChannelRow, videoId?: string): string | null {
    const meta = channel.canonicalChannelId ? this.session.meta('channel', channel.canonicalChannelId) : null;
    return vidiqChannelUrl(youtubeHandle(meta?.availability === 'available' ? meta.handle : null, channel.userInput), videoId);
  }

  private kick(channels: ChannelRow[], mode: 'refresh' | 'full'): void {
    if (this.active || channels.length === 0) return;
    this.active = true;
    const controller = new AbortController();
    this.abort = controller;
    this.emit();
    void this.run(channels, mode, controller.signal).finally(() => {
      this.active = false;
      this.abort = undefined;
      this.emit();
    });
  }

  private emit(): void {
    if (!this.deps.onProgress) return;
    try {
      this.deps.onProgress(this.syncView());
    } catch {
      // 表示側の失敗で同期は止めない。
    }
  }

  private async idle(): Promise<void> {
    while (this.active) await new Promise((resolve) => setTimeout(resolve, 15));
  }

  private async run(channels: ChannelRow[], mode: 'refresh' | 'full', signal: AbortSignal): Promise<void> {
    for (const channel of channels) {
      if (signal.aborted) return;
      if (this.deps.port.priorityBusy()) return;
      await this.syncOne(channel, mode, signal);
      this.emit();
    }
  }

  private async syncOne(channel: ChannelRow, mode: 'refresh' | 'full', signal: AbortSignal): Promise<void> {
    const now = this.iso();
    const run: RunRow = {
      id: randomUUID(),
      channelId: channel.id,
      mode,
      status: 'running',
      cursor: null,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errorCode: null,
      requestedAt: now,
      startedAt: now,
      finishedAt: null,
    };
    this.store.insertRun(run);
    channel.lastAttemptAt = now;
    this.store.updateChannel(channel);
    let saved = 0;
    try {
      if (!(await this.deps.port.connected())) throw new CompetitorPortError('auth_required');
      const resolved = await this.resolve(channel, signal);
      const meta = this.session.meta('channel', resolved.canonicalChannelId ?? '');
      const playlist = meta?.uploadsPlaylistId;
      if (!resolved.canonicalChannelId || !playlist) throw new CompetitorPortError('unresolved');
      const walked = await this.walk(resolved, playlist, mode, signal, run);
      saved = walked.saved;
      run.processed = walked.listed;
      run.succeeded = walked.saved;
      run.failed = walked.missing;
      run.status = 'succeeded';
      run.finishedAt = this.iso();
      this.store.updateRun(run);
      const fresh = this.store.channel(resolved.id) ?? resolved;
      fresh.lastSuccessAt = run.finishedAt;
      fresh.lastErrorCode = null;
      fresh.updatedAt = run.finishedAt;
      this.store.updateChannel(fresh);
    } catch (error) {
      const code = this.codeOf(error);
      const kept = Math.max(saved, run.succeeded);
      run.status = code === 'cancelled' ? 'cancelled' : kept > 0 ? 'partial' : 'failed';
      run.errorCode = code;
      run.succeeded = kept;
      run.finishedAt = this.iso();
      this.store.updateRun(run);
      const fresh = this.store.channel(channel.id);
      if (fresh) {
        fresh.lastErrorCode = code;
        if (kept > 0) fresh.lastSuccessAt = run.finishedAt;
        fresh.updatedAt = run.finishedAt ?? this.iso();
        this.store.updateChannel(fresh);
      }
    }
  }

  private async resolve(channel: ChannelRow, signal: AbortSignal): Promise<ChannelRow> {
    const parsed: ParsedChannelInput = channel.canonicalChannelId
      ? { kind: 'id', channelId: channel.canonicalChannelId, raw: channel.userInput, key: `id:${channel.canonicalChannelId}` }
      : parseChannelLine(channel.userInput);
    if (parsed.kind !== 'id' && parsed.kind !== 'handle' && parsed.kind !== 'username') throw new CompetitorPortError('unresolved');
    const found = await this.deps.port.lookup(parsed, signal);
    if (!found?.uploadsPlaylistId) throw new CompetitorPortError('unresolved');
    return this.attachCanonical(channel, found);
  }

  private attachCanonical(channel: ChannelRow, found: PublicChannel): ChannelRow {
    this.rememberChannel(found);
    const other = this.store.findByCanonical(found.channelId);
    if (other && other.id !== channel.id) {
      this.deps.hooks?.channelMerged(channel.id, other.id);
      this.store.moveVideoRefs(channel.id, other.id);
      if (!other.reason) other.reason = channel.reason;
      if (!other.alias) other.alias = channel.alias;
      other.archivedAt = null;
      other.syncEnabled = true;
      other.updatedAt = this.iso();
      this.store.updateChannel(other);
      this.store.deleteChannel(channel.id);
      return other;
    }
    channel.canonicalChannelId = found.channelId;
    channel.archivedAt = null;
    channel.updatedAt = this.iso();
    this.store.updateChannel(channel);
    return channel;
  }

  private async walk(
    channel: ChannelRow,
    playlistId: string,
    mode: 'refresh' | 'full',
    signal: AbortSignal,
    run: RunRow,
  ): Promise<{ listed: number; saved: number; missing: number }> {
    const cutoff = mode === 'full' ? null : this.now().getTime() - channel.windowDays * 86_400_000;
    const seen = new Set<string>();
    let pageToken: string | undefined;
    let restarted = false;
    let listed = 0;
    let saved = 0;
    let excluded = 0;
    let missing = 0;
    let oldest: string | null = null;
    let newest: string | null = null;
    let scan: 'complete' | 'capped' | 'partial' = 'complete';
    let pages = 0;
    while (saved < channel.maxVideos) {
      if (signal.aborted) throw new CompetitorPortError('cancelled');
      if (this.deps.port.priorityBusy()) throw new CompetitorPortError('busy');
      pages += 1;
      if (pages > 100) {
        scan = 'partial';
        break;
      }
      let page: { ids: string[]; nextPageToken?: string };
      try {
        page = await this.deps.port.uploadsPage(playlistId, pageToken, signal);
      } catch (error) {
        const code = this.codeOf(error);
        if (pageToken && !restarted && code !== 'quota_exceeded' && code !== 'cancelled' && code !== 'auth_required') {
          restarted = true;
          pageToken = undefined;
          run.cursor = null;
          continue;
        }
        scan = saved > 0 ? 'partial' : scan;
        if (saved > 0) {
          this.putCoverage(channel, run, { listed, saved, excluded, missing, oldest, newest, scan });
        }
        throw error;
      }
      const fresh = page.ids.filter((id) => !seen.has(id));
      for (const id of fresh) seen.add(id);
      listed += fresh.length;
      let stopForAge = false;
      for (let index = 0; index < fresh.length && saved < channel.maxVideos; index += VIDEO_BATCH) {
        const room = channel.maxVideos - saved;
        const batch = fresh.slice(index, index + Math.min(VIDEO_BATCH, room));
        let videos: PublicVideo[];
        try {
          videos = await this.deps.port.videos(batch, signal);
        } catch (error) {
          if (saved > 0) this.putCoverage(channel, run, { listed, saved, excluded, missing, oldest, newest, scan: 'partial' });
          throw error;
        }
        const returned = new Set(videos.map((video) => video.videoId));
        for (const id of batch) {
          if (!returned.has(id)) {
            this.session.markUnavailable('video', id, channel.canonicalChannelId ?? channel.id);
            missing += 1;
          }
        }
        for (const video of videos) {
          if (cutoff !== null && video.publishedAt && Date.parse(video.publishedAt) < cutoff) {
            excluded += 1;
            stopForAge = true;
            continue;
          }
          this.rememberVideo(video, channel.canonicalChannelId ?? channel.id, run.id);
          saved += 1;
          if (video.publishedAt) {
            if (!oldest || video.publishedAt < oldest) oldest = video.publishedAt;
            if (!newest || video.publishedAt > newest) newest = video.publishedAt;
          }
        }
        run.processed = listed;
        run.succeeded = saved;
        run.failed = missing;
        run.cursor = page.nextPageToken ?? null;
        this.store.updateRun(run);
        this.emit();
      }
      if (stopForAge || !page.nextPageToken || saved >= channel.maxVideos) {
        scan = saved >= channel.maxVideos ? 'capped' : 'complete';
        break;
      }
      pageToken = page.nextPageToken;
    }
    if (saved >= channel.maxVideos) scan = 'capped';
    this.putCoverage(channel, run, { listed, saved, excluded, missing, oldest, newest, scan });
    return { listed, saved, missing };
  }

  private putCoverage(
    channel: ChannelRow,
    run: RunRow,
    item: { listed: number; saved: number; excluded: number; missing: number; oldest: string | null; newest: string | null; scan: 'complete' | 'capped' | 'partial' },
  ): void {
    this.session.putCoverage({
      channelId: channel.canonicalChannelId ?? channel.id,
      oldest: item.oldest,
      newest: item.newest,
      scan: item.scan,
      listed: item.listed,
      saved: item.saved,
      excluded: item.excluded,
      missing: item.missing,
      fetchedAt: this.iso(),
      runId: run.id,
    });
  }

  private rememberChannel(found: PublicChannel): void {
    const observedAt = this.iso();
    const fields: SessionFields = {
      entityType: 'channel',
      entityId: found.channelId,
      channelId: found.channelId,
      title: found.title,
      description: found.description,
      handle: found.handle,
      publishedAt: found.publishedAt,
      uploadsPlaylistId: found.uploadsPlaylistId,
      thumbnailUrl: found.thumbnailUrl,
      fetchedAt: observedAt,
      expiresAt: retentionDeadline(basicPolicy(), observedAt),
      runId: randomUUID(),
      availability: 'available',
    };
    this.session.putMeta(fields);
    this.session.addObservation({
      entityType: 'channel',
      entityId: found.channelId,
      channelId: found.channelId,
      observedAt,
      runId: fields.runId,
      viewCount: found.viewCount,
      likeCount: null,
      commentCount: null,
      subscriberCount: found.subscriberCount,
      videoCount: found.videoCount,
      hiddenSubscriberCount: found.hiddenSubscriberCount,
      reasons: found.reasons,
    });
  }

  private rememberVideo(video: PublicVideo, channelId: string, runId: string): void {
    const observedAt = this.iso();
    this.session.putMeta({
      entityType: 'video',
      entityId: video.videoId,
      channelId,
      title: video.title,
      description: video.description,
      publishedAt: video.publishedAt,
      thumbnailUrl: video.thumbnailUrl,
      durationIso: video.durationIso,
      categoryId: video.categoryId,
      tags: video.tags,
      defaultLanguage: video.defaultLanguage,
      liveBroadcastContent: video.liveBroadcastContent,
      fetchedAt: observedAt,
      expiresAt: retentionDeadline(basicPolicy(), observedAt),
      runId,
      availability: 'available',
    });
    this.session.addObservation({
      entityType: 'video',
      entityId: video.videoId,
      channelId,
      observedAt,
      runId,
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      commentCount: video.commentCount,
      subscriberCount: null,
      videoCount: null,
      hiddenSubscriberCount: false,
      reasons: video.reasons,
    });
  }

  private upsertFromPreview(row: CompetitorPreviewRow): ChannelRow {
    const now = this.iso();
    const existing = row.canonicalChannelId ? this.store.findByCanonical(row.canonicalChannelId) : this.store.findByInputKey(row.key);
    if (existing) {
      existing.archivedAt = null;
      existing.updatedAt = now;
      this.store.updateChannel(existing);
      return existing;
    }
    const parsed = parseChannelLine(row.raw);
    const channel: ChannelRow = {
      id: randomUUID(),
      canonicalChannelId: row.canonicalChannelId,
      userInput: row.raw,
      inputKey: parsed.kind === 'invalid' ? row.key : parsed.key,
      alias: '',
      tier: 'primary',
      reason: '',
      tags: [],
      language: null,
      watchState: 'undecided',
      syncEnabled: true,
      cadence: 'daily',
      windowDays: DEFAULT_WINDOW_DAYS,
      maxVideos: DEFAULT_MAX_VIDEOS,
      archivedAt: null,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.store.insertChannel(channel);
      return channel;
    } catch {
      const raced = row.canonicalChannelId ? this.store.findByCanonical(row.canonicalChannelId) : this.store.findByInputKey(channel.inputKey);
      if (raced) return raced;
      throw new CompetitorPortError('duplicate');
    }
  }

  private dueChannels(): ChannelRow[] {
    const now = this.now().getTime();
    return this.store.channels().filter((channel) => {
      if (channel.archivedAt || !channel.syncEnabled) return false;
      const cadence = channel.cadence === 'daily' ? 20 * 3_600_000 : 6 * 24 * 3_600_000;
      if (channel.lastSuccessAt && now - Date.parse(channel.lastSuccessAt) < cadence) return false;
      if (channel.lastErrorCode === 'quota_exceeded' && channel.lastAttemptAt && now - Date.parse(channel.lastAttemptAt) < 12 * 3_600_000) {
        return false;
      }
      return true;
    });
  }

  private toListItem(channel: ChannelRow): CompetitorListItem {
    const recentVideos = this.session
      .videosFor(channel.canonicalChannelId ?? channel.id)
      .filter((item) => item.availability === 'available')
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .slice(0, 3)
      .map((item) => this.toVideo(item.entityId, false));
    const meta = channel.canonicalChannelId ? this.session.meta('channel', channel.canonicalChannelId) : null;
    const readable = meta?.availability === 'available' ? meta : null;
    const observation = channel.canonicalChannelId ? this.session.observationsFor('channel', channel.canonicalChannelId).at(-1) : undefined;
    return {
      id: channel.id,
      input: channel.userInput,
      alias: channel.alias,
      canonicalChannelId: channel.canonicalChannelId,
      tier: channel.tier,
      reason: channel.reason,
      tags: channel.tags,
      watchState: channel.watchState,
      syncEnabled: channel.syncEnabled,
      cadence: channel.cadence,
      archivedAt: channel.archivedAt,
      lastSuccessAt: channel.lastSuccessAt,
      lastErrorCode: channel.lastErrorCode,
      lastErrorMessage: this.store.errorText(channel.lastErrorCode),
      windowDays: channel.windowDays,
      maxVideos: channel.maxVideos,
      session: readable
        ? {
            title: readable.title,
            handle: readable.handle ?? null,
            thumbnailUrl: readable.thumbnailUrl ?? null,
            description: readable.description,
            fetchedAt: readable.fetchedAt,
            expiresAt: readable.expiresAt,
            subscriberCount: observation?.subscriberCount ?? null,
            hiddenSubscriberCount: observation?.hiddenSubscriberCount ?? false,
            videoCount: observation?.videoCount ?? null,
            viewCount: observation?.viewCount ?? null,
            publishedAt: readable.publishedAt ?? null,
          }
        : null,
      recentVideos,
      vidiqUrl: this.vidiqUrl(channel),
    };
  }

  private toDetail(channel: ChannelRow): CompetitorDetail {
    const coverage = channel.canonicalChannelId ? this.session.coverageFor(channel.canonicalChannelId) : null;
    const videos = this.channelVideos(channel.id);
    const coverageView: CompetitorCoverage = coverage
      ? {
          state: 'ready',
          scan: coverage.scan,
          oldest: coverage.oldest,
          newest: coverage.newest,
          listed: coverage.listed,
          saved: coverage.saved,
          excluded: coverage.excluded,
          missing: coverage.missing,
          fetchedAt: coverage.fetchedAt,
          expiresAt: coverage.expiresAt,
          message:
            coverage.scan === 'capped'
              ? `上限 ${channel.maxVideos} 本で止めています。公開されている全期間ではありません`
              : coverage.scan === 'partial'
                ? '一部だけ取得できました。全体が取れた扱いにはしません'
                : '選択した範囲の、取得できた公開動画を走査しました',
        }
      : { state: 'not_in_session', message: 'この起動では公開情報をまだ持っていません。取得すると、アプリを閉じるまで表示します' };
    return {
      ...this.toListItem(channel),
      language: channel.language,
      coverage: coverageView,
      videoTotal: videos.length,
    };
  }

  private toVideo(videoId: string, userAdded: boolean): CompetitorVideo {
    const meta = this.session.meta('video', videoId);
    const observation = this.session.observationsFor('video', videoId).at(-1);
    const manual = this.store.classification('video', videoId);
    const ref = this.store.videoRefByVideo(videoId);
    const available = meta?.availability === 'available' ? meta : null;
    return {
      videoId,
      userAdded,
      userUrl: ref?.userUrl ?? `https://www.youtube.com/watch?v=${videoId}`,
      title: available?.title ?? null,
      publishedAt: available?.publishedAt ?? null,
      durationIso: available?.durationIso ?? null,
      durationSec: available ? (parseIsoDuration(available.durationIso) ?? null) : null,
      thumbnailUrl: available?.thumbnailUrl ?? null,
      liveBroadcastContent: available?.liveBroadcastContent ?? null,
      viewCount: available ? (observation?.viewCount ?? null) : null,
      likeCount: available ? (observation?.likeCount ?? null) : null,
      commentCount: available ? (observation?.commentCount ?? null) : null,
      missing: available
        ? {
            ...(observation?.reasons.viewCount ? { view: observation.reasons.viewCount } : {}),
            ...(observation?.reasons.likeCount ? { like: observation.reasons.likeCount } : {}),
            ...(observation?.reasons.commentCount ? { comment: observation.reasons.commentCount } : {}),
          }
        : {},
      fetchedAt: available?.fetchedAt ?? null,
      expiresAt: available?.expiresAt ?? null,
      availability: !meta ? 'not_in_session' : meta.availability === 'available' ? 'available' : 'unavailable',
      format: manual?.format ?? null,
      orientation: manual?.orientation ?? null,
      language: manual?.language ?? null,
      tags: manual?.tags ?? [],
    };
  }

  private syncView(): CompetitorSyncView {
    const policy = basicPolicy();
    const run = this.safeLatest();
    const day = localDate(this.iso(), this.timeZone());
    const raw = this.safeSetting('quota_usage');
    const usage = raw ? (JSON.parse(raw) as { day: string; used: number }) : { day, used: 0 };
    return {
      running: this.active,
      run: run
        ? {
            id: run.id,
            channelId: run.channelId,
            mode: run.mode,
            status: run.status,
            processed: run.processed,
            succeeded: run.succeeded,
            failed: run.failed,
            errorCode: run.errorCode,
            message: this.store.errorText(run.errorCode),
            requestedAt: run.requestedAt,
            finishedAt: run.finishedAt,
          }
        : null,
      policyLevel: policy.level,
      derivedMetrics: false,
      derivedReason: COMPETITOR_ERROR_TEXT.policy_restricted,
      persistentCache: false,
      persistentCacheReason: policy.persistentCacheReason,
      quota: { day, used: usage.day === day ? usage.used : 0, budget: this.quotaBudget(), timeZone: this.timeZone() },
    };
  }

  private safeLatest(): RunRow | undefined {
    try {
      return this.store.latestRun();
    } catch {
      return undefined;
    }
  }

  private safeSetting(key: string): string | undefined {
    try {
      return this.store.setting(key);
    } catch {
      return undefined;
    }
  }

  private quotaBudget(): number {
    const raw = this.safeSetting('quota_budget');
    const value = raw ? Number(raw) : DEFAULT_QUOTA_BUDGET;
    return Number.isFinite(value) ? value : DEFAULT_QUOTA_BUDGET;
  }

  private timeZone(): string {
    return this.safeSetting('timezone') || DEFAULT_TIMEZONE;
  }

  private row(
    key: string,
    raw: string,
    status: CompetitorPreviewRow['status'],
    canSave: boolean,
    message: string,
    canonicalChannelId: string | null,
    title: string | null,
    existingId: string | null,
  ): CompetitorPreviewRow {
    return { key, raw, status, canSave, message, canonicalChannelId, title, existingId };
  }

  private dropOldPreviews(): void {
    const cutoff = this.now().getTime() - 15 * 60 * 1000;
    for (const [id, preview] of this.previews) if (preview.at < cutoff) this.previews.delete(id);
  }

  private ready(): CompetitorFailure | null {
    try {
      this.deps.database();
      return null;
    } catch {
      return { ok: false, code: 'unavailable', message: '保存先フォルダを選んでから登録できます' };
    }
  }

  private fail(code: CompetitorErrorCode): CompetitorFailure {
    return { ok: false, code, message: COMPETITOR_ERROR_TEXT[code] };
  }

  private codeOf(error: unknown): CompetitorErrorCode {
    if (error instanceof CompetitorPortError) return error.code;
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    return 'network';
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private iso(): string {
    return this.now().toISOString();
  }
}

/** 公開値は桁あふれを避けるため文字列のまま。長さ→辞書順で大小を比べる。 */
export const compareCount = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.length - b.length || (a < b ? -1 : 1);
};
