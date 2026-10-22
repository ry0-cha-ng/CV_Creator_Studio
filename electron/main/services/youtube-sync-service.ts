import { randomUUID } from 'node:crypto';
import {
  DAILY_METRICS,
  syncRunSchema,
  youtubeContentTypeSchema,
  type DateRange,
  type ReportKind,
  type SyncRun,
  type WindowKind,
  type YoutubeReport,
  type YoutubeSyncProgress,
  type YoutubeSyncSettings,
  type YoutubeVideo,
} from '../../../shared/schema/youtube';
import {
  addDays,
  dailyMetricsFromRow,
  isFatalForRun,
  maxDate,
  minDate,
  normalizeRanges,
  pacificDate,
  parseIsoDuration,
  plannedDailyRanges,
  publishWindow,
  syncStartFor,
  tableRows,
  windowComplete,
  type ResultTable,
} from '../../../shared/youtube-analytics';
import type { ApiVideo, ReportQuery, YoutubeApi } from './youtube-api';
import { asYoutubeError, YoutubeError } from './youtube-error';
import type { YoutubeStore } from './youtube-store';

const HORIZON_PROBE_DAYS = 14;
const MAX_RUN_ERRORS = 50;
const WINDOWS = ['publish-calendar-7d', 'publish-calendar-28d'] as const;

type WindowReportSpec = {
  kind: ReportKind;
  query: (videoId: string, window: DateRange) => ReportQuery;
};

/** 基本指標・維持・流入元は別クエリに分け、1つが失敗しても他を止めない。 */
const WINDOW_REPORTS: WindowReportSpec[] = [
  {
    kind: 'period-basic',
    query: (videoId, window) => ({
      startDate: window.start,
      endDate: window.end,
      metrics: DAILY_METRICS,
      filters: `video==${videoId}`,
    }),
  },
  {
    kind: 'retention',
    query: (videoId, window) => ({
      startDate: window.start,
      endDate: window.end,
      metrics: ['audienceWatchRatio', 'relativeRetentionPerformance'],
      dimensions: 'elapsedVideoTimeRatio',
      filters: `video==${videoId}`,
    }),
  },
  {
    kind: 'traffic-source',
    query: (videoId, window) => ({
      startDate: window.start,
      endDate: window.end,
      metrics: ['views', 'engagedViews', 'estimatedMinutesWatched'],
      dimensions: 'insightTrafficSourceType',
      filters: `video==${videoId}`,
      sort: '-views',
    }),
  },
];

const largestThumbnail = (video: ApiVideo): string | undefined => {
  const thumbnails = Object.values(video.snippet?.thumbnails ?? {});
  return thumbnails.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
};

const numberOrUndefined = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export const videoFromApi = (item: ApiVideo, channelId: string, observedAt: string): YoutubeVideo | null => {
  const publishedAt = item.snippet?.publishedAt;
  if (!publishedAt) return null;
  return {
    videoId: item.id,
    channelId: item.snippet?.channelId ?? channelId,
    title: item.snippet?.title ?? '',
    description: item.snippet?.description ?? '',
    thumbnailUrl: largestThumbnail(item),
    publishedAt: new Date(publishedAt).toISOString(),
    durationSec: parseIsoDuration(item.contentDetails?.duration),
    privacyStatus: item.status?.privacyStatus,
    publicStats: item.statistics
      ? {
          viewCount: numberOrUndefined(item.statistics.viewCount),
          likeCount: numberOrUndefined(item.statistics.likeCount),
          commentCount: numberOrUndefined(item.statistics.commentCount),
          fetchedAt: observedAt,
        }
      : undefined,
    contentType: 'UNKNOWN',
    contentTypeSource: 'unknown',
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };
};

export type YoutubeSyncDeps = {
  store: YoutubeStore;
  api: YoutubeApi;
  importVideos: (videos: YoutubeVideo[]) => void;
  settings: () => Promise<YoutubeSyncSettings>;
  now?: () => Date;
  onProgress?: (progress: YoutubeSyncProgress) => void;
};

type RunContext = {
  run: SyncRun;
  signal: AbortSignal;
  settings: YoutubeSyncSettings;
  today: string;
  nowIso: string;
  horizon?: string;
};

export class YoutubeSyncService {
  private current?: { controller: AbortController; promise: Promise<SyncRun> };

  constructor(private readonly deps: YoutubeSyncDeps) {}

  running(): boolean {
    return Boolean(this.current);
  }

  cancel(): void {
    this.current?.controller.abort();
  }

  /** 実行中なら同じ実行を返す（二重実行しない）。 */
  start(trigger: SyncRun['trigger']): Promise<SyncRun> {
    if (this.current) return this.current.promise;
    const controller = new AbortController();
    const promise = this.execute(trigger, controller.signal).finally(() => {
      this.current = undefined;
    });
    this.current = { controller, promise };
    return promise;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private emit(context: RunContext, stage: YoutubeSyncProgress['stage'], message?: string): void {
    this.deps.onProgress?.({
      runId: context.run.id,
      stage,
      done: context.run.progress.done,
      total: context.run.progress.total,
      message,
    });
  }

  private recordError(context: RunContext, scope: string, error: YoutubeError): void {
    context.run.counts.failures += 1;
    if (context.run.errors.length < MAX_RUN_ERRORS) {
      context.run.errors.push({ scope, kind: error.kind, message: error.message });
    }
  }

  private async call<T>(context: RunContext, request: () => Promise<T>): Promise<T> {
    if (context.signal.aborted) throw new YoutubeError('cancelled', '中止しました');
    context.run.counts.requests += 1;
    return request();
  }

  private async execute(trigger: SyncRun['trigger'], signal: AbortSignal): Promise<SyncRun> {
    const started = this.now();
    const context: RunContext = {
      run: syncRunSchema.parse({
        id: randomUUID(),
        trigger,
        status: 'running',
        startedAt: started.toISOString(),
      }),
      signal,
      settings: await this.deps.settings(),
      today: pacificDate(started),
      nowIso: started.toISOString(),
      horizon: this.deps.store.state('horizon').lastDataDate,
    };
    const { store } = this.deps;
    store.saveRun(context.run);
    try {
      this.emit(context, 'channel');
      const channel = await this.syncChannel(context);
      this.emit(context, 'ledger');
      const videos = await this.syncLedger(context, channel.channelId, channel.uploadsPlaylistId);
      this.emit(context, 'horizon');
      await this.syncHorizon(context);
      this.emit(context, 'content-type');
      await this.syncContentTypes(context, videos);
      this.deps.importVideos(store.videos(channel.channelId).filter((video) => !video.missingSince));
      const targets = store.videos(channel.channelId).filter((video) => !video.missingSince);
      context.run.progress = { done: 0, total: targets.length };
      context.run.counts.videos = targets.length;
      store.saveRun(context.run);
      for (const video of targets) {
        this.emit(context, 'videos', video.title);
        await this.syncDaily(context, video);
        for (const windowKind of WINDOWS) await this.syncWindow(context, video, windowKind);
        context.run.progress.done += 1;
        store.saveRun(context.run);
      }
      context.run.status = context.run.errors.length > 0 ? 'partial' : 'done';
    } catch (error) {
      const failure = asYoutubeError(error);
      this.recordError(context, 'run', failure);
      context.run.status = failure.kind === 'cancelled' ? 'cancelled' : 'failed';
    } finally {
      context.run.finishedAt = this.now().toISOString();
      context.run.horizon = context.horizon;
      store.saveRun(context.run);
      this.emit(context, 'done');
    }
    return context.run;
  }

  private async syncChannel(context: RunContext) {
    const channel = await this.call(context, () => this.deps.api.myChannel(context.signal));
    const previous = this.deps.store.channel();
    const record = {
      ...channel,
      connectedAt: previous?.channelId === channel.channelId ? previous.connectedAt : context.nowIso,
      lastSeenAt: context.nowIso,
    };
    this.deps.store.saveChannel(record);
    return record;
  }

  /** uploads プレイリストを最後のページまで読む。途中で失敗したら台帳は「未完了」のまま残す。 */
  private async syncLedger(context: RunContext, channelId: string, playlistId: string): Promise<YoutubeVideo[]> {
    const { store, api } = this.deps;
    const state = store.state('ledger');
    store.saveState({ ...state, complete: false });
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.call(context, () => api.uploads(playlistId, pageToken, context.signal));
      ids.push(...page.ids);
      pageToken = page.nextPageToken;
    } while (pageToken);
    const unique = [...new Set(ids)];
    const videos: YoutubeVideo[] = [];
    for (let index = 0; index < unique.length; index += 50) {
      const batch = unique.slice(index, index + 50);
      const items = await this.call(context, () => api.videos(batch, context.signal));
      for (const item of items) {
        const video = videoFromApi(item, channelId, context.nowIso);
        if (!video) continue;
        store.upsertVideo(video, context.nowIso);
        videos.push(video);
      }
    }
    store.markMissing(channelId, new Set(videos.map((video) => video.videoId)), context.nowIso);
    store.saveState({
      ...state,
      complete: true,
      lastSuccessAt: context.nowIso,
      lastError: undefined,
    });
    return videos;
  }

  /** APIが行を返した最終日。日次レポートは直近の日を返さないため、ここまでを確定とみなす。 */
  private async syncHorizon(context: RunContext): Promise<void> {
    const table = await this.call(context, () =>
      this.deps.api.report(
        {
          startDate: addDays(context.today, -(HORIZON_PROBE_DAYS - 1)),
          endDate: context.today,
          metrics: ['views'],
          dimensions: 'day',
          sort: 'day',
        },
        context.signal,
      ),
    );
    const days = tableRows(table)
      .map((row) => String(row.day ?? ''))
      .filter(Boolean)
      .sort();
    const latest = days[days.length - 1];
    if (!latest) return;
    context.horizon = context.horizon ? maxDate(context.horizon, latest) : latest;
    const state = this.deps.store.state('horizon');
    this.deps.store.saveState({ ...state, lastDataDate: context.horizon, lastSuccessAt: context.nowIso });
  }

  /** creatorContentType はAPIの値だけを採用する。返らない動画は UNKNOWN のまま。 */
  private async syncContentTypes(context: RunContext, videos: YoutubeVideo[]): Promise<void> {
    if (videos.length === 0) return;
    const earliest = videos.map((video) => pacificDate(video.publishedAt)).sort()[0];
    try {
      const table = await this.call(context, () =>
        this.deps.api.report(
          {
            startDate: earliest,
            endDate: context.today,
            metrics: ['views'],
            dimensions: 'video,creatorContentType',
            sort: '-views',
            maxResults: 200,
          },
          context.signal,
        ),
      );
      for (const row of tableRows(table)) {
        const parsed = youtubeContentTypeSchema.safeParse(String(row.creatorContentType ?? '').toUpperCase());
        if (parsed.success) this.deps.store.setContentType(String(row.video), parsed.data);
      }
    } catch (error) {
      const failure = asYoutubeError(error);
      if (isFatalForRun(failure.kind)) throw failure;
      this.recordError(context, 'content-type', failure);
    }
  }

  private async syncDaily(context: RunContext, video: YoutubeVideo): Promise<void> {
    const { store, api } = this.deps;
    const key = `daily:${video.videoId}`;
    let state = store.state(key);
    const desired = { start: syncStartFor(video.publishedAt, context.today, context.settings), end: context.today };
    const chunks = plannedDailyRanges({
      desired,
      covered: state.coveredRanges,
      horizon: context.horizon,
      refetchDays: context.settings.refetchDays,
    });
    for (const chunk of chunks) {
      try {
        const table: ResultTable = await this.call(context, () =>
          api.report(
            {
              startDate: chunk.start,
              endDate: chunk.end,
              metrics: DAILY_METRICS,
              dimensions: 'day',
              filters: `video==${video.videoId}`,
              sort: 'day',
            },
            context.signal,
          ),
        );
        const fetchedAt = this.now().toISOString();
        const rows = tableRows(table).flatMap((row) => {
          const reportDate = String(row.day ?? '');
          if (!reportDate || reportDate < chunk.start || reportDate > chunk.end) return [];
          return [{ videoId: video.videoId, reportDate, metrics: dailyMetricsFromRow(row), fetchedAt }];
        });
        store.upsertDaily(rows);
        context.run.counts.dailyRows += rows.length;
        const lastData = rows.map((row) => row.reportDate).sort().pop();
        const coveredEnd = context.horizon ? minDate(chunk.end, context.horizon) : undefined;
        state = {
          ...state,
          coveredRanges:
            coveredEnd && coveredEnd >= chunk.start
              ? normalizeRanges([...state.coveredRanges, { start: chunk.start, end: coveredEnd }])
              : state.coveredRanges,
          lastDataDate: lastData && state.lastDataDate ? maxDate(lastData, state.lastDataDate) : lastData ?? state.lastDataDate,
          lastRequestedEnd: chunk.end,
          lastSuccessAt: fetchedAt,
          lastError: undefined,
        };
        store.saveState(state);
      } catch (error) {
        const failure = asYoutubeError(error);
        state = { ...state, lastError: { kind: failure.kind, message: failure.message, at: this.now().toISOString() } };
        store.saveState(state);
        if (isFatalForRun(failure.kind)) throw failure;
        this.recordError(context, key, failure);
        return;
      }
    }
  }

  private async syncWindow(context: RunContext, video: YoutubeVideo, windowKind: (typeof WINDOWS)[number]): Promise<void> {
    const window = publishWindow(video.publishedAt, windowKind);
    if (!windowComplete(window, context.horizon)) return;
    const existing = this.deps.store
      .reports(video.videoId)
      .filter((report) => report.windowKind === windowKind && report.periodStart === window.start && report.periodEnd === window.end);
    const correcting = Boolean(context.horizon) && window.end > addDays(context.horizon as string, -context.settings.refetchDays);
    for (const spec of WINDOW_REPORTS) {
      const query = spec.query(video.videoId, window);
      const previous = existing.find((report) => report.kind === spec.kind && report.filters === (query.filters ?? ''));
      if (previous?.status === 'unsupported') continue;
      if (previous && previous.status !== 'failed' && !correcting) continue;
      await this.fetchWindowReport(context, video.videoId, windowKind, window, spec.kind, query, previous);
    }
  }

  private async fetchWindowReport(
    context: RunContext,
    videoId: string,
    windowKind: WindowKind,
    window: DateRange,
    kind: ReportKind,
    query: ReportQuery,
    previous: YoutubeReport | undefined,
  ): Promise<void> {
    const base = {
      videoId,
      kind,
      windowKind,
      periodStart: window.start,
      periodEnd: window.end,
      timezone: 'America/Los_Angeles' as const,
      dimensions: query.dimensions ?? '',
      filters: query.filters ?? '',
      metrics: [...query.metrics],
    };
    try {
      const table = await this.call(context, () => this.deps.api.report(query, context.signal));
      const rows = tableRows(table);
      this.deps.store.saveReport({
        ...base,
        status: rows.length > 0 ? 'ok' : 'no-data',
        rows,
        fetchedAt: this.now().toISOString(),
      });
      context.run.counts.reports += 1;
    } catch (error) {
      const failure = asYoutubeError(error);
      if (isFatalForRun(failure.kind)) throw failure;
      this.recordError(context, `${kind}:${windowKind}:${videoId}`, failure);
      if (previous && previous.status === 'ok') return;
      this.deps.store.saveReport({
        ...base,
        status: failure.kind === 'unsupported-query' ? 'unsupported' : 'failed',
        errorKind: failure.kind,
        errorMessage: failure.message,
        rows: [],
        fetchedAt: this.now().toISOString(),
      });
    }
  }
}
