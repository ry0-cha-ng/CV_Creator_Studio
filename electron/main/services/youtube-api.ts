import { classifyHttpError, type ResultTable } from '../../../shared/youtube-analytics';
import { asYoutubeError, YoutubeError } from './youtube-error';

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';
const MAX_RETRIES = 3;

type Params = Record<string, string | number | undefined>;

export type ApiChannel = { channelId: string; title: string; handle?: string; uploadsPlaylistId: string };

export type ApiVideo = {
  id: string;
  snippet?: {
    channelId?: string;
    title?: string;
    description?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: { privacyStatus?: string };
};

export type ReportQuery = {
  startDate: string;
  endDate: string;
  metrics: readonly string[];
  dimensions?: string;
  filters?: string;
  sort?: string;
  maxResults?: number;
};

export type YoutubeApiDeps = {
  token: (forceRefresh?: boolean) => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRequest?: () => void;
};

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new YoutubeError('cancelled', '中止しました'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new YoutubeError('cancelled', '中止しました'));
      },
      { once: true },
    );
  });

const withQuery = (base: string, params: Params): string => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
};

const retryAfterMs = (response: Response): number | undefined => {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.min(seconds * 1000, 60_000) : undefined;
};

export class YoutubeApi {
  constructor(private readonly deps: YoutubeApiDeps) {}

  private async get<T>(base: string, params: Params, signal?: AbortSignal): Promise<T> {
    const http = this.deps.fetch ?? fetch;
    const sleep = this.deps.sleep ?? defaultSleep;
    const url = withQuery(base, params);
    let refreshed = false;
    let forceRefresh = false;
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw new YoutubeError('cancelled', '中止しました');
      const token = await this.deps.token(forceRefresh);
      forceRefresh = false;
      this.deps.onRequest?.();
      let response: Response;
      try {
        response = await http(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
      } catch (error) {
        const failure = asYoutubeError(error);
        if (failure.retryable && attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt, signal);
          continue;
        }
        throw failure;
      }
      if (response.ok) return (await response.json()) as T;
      const body = await response.json().catch(() => ({}));
      const classified = classifyHttpError(response.status, body);
      if (classified.kind === 'auth' && !refreshed) {
        refreshed = true;
        forceRefresh = true;
        continue;
      }
      if (classified.retryable && attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(response) ?? 1000 * 2 ** attempt, signal);
        continue;
      }
      throw new YoutubeError(classified.kind, classified.message, classified.retryable, response.status);
    }
  }

  async myChannel(signal?: AbortSignal): Promise<ApiChannel> {
    const json = await this.get<{
      items?: Array<{
        id: string;
        snippet?: { title?: string; customUrl?: string };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }>;
    }>(`${DATA_API}/channels`, { part: 'snippet,contentDetails', mine: 'true' }, signal);
    const item = json.items?.[0];
    const uploads = item?.contentDetails?.relatedPlaylists?.uploads;
    if (!item || !uploads) {
      throw new YoutubeError('not-found', 'このGoogleアカウントにYouTubeチャンネルが見つかりません');
    }
    return {
      channelId: item.id,
      title: item.snippet?.title ?? '',
      handle: item.snippet?.customUrl,
      uploadsPlaylistId: uploads,
    };
  }

  async uploads(playlistId: string, pageToken: string | undefined, signal?: AbortSignal): Promise<{ ids: string[]; nextPageToken?: string }> {
    const json = await this.get<{
      items?: Array<{ contentDetails?: { videoId?: string } }>;
      nextPageToken?: string;
    }>(`${DATA_API}/playlistItems`, { part: 'contentDetails', playlistId, maxResults: 50, pageToken }, signal);
    return {
      ids: (json.items ?? []).flatMap((item) => (item.contentDetails?.videoId ? [item.contentDetails.videoId] : [])),
      nextPageToken: json.nextPageToken,
    };
  }

  async videos(ids: string[], signal?: AbortSignal): Promise<ApiVideo[]> {
    if (ids.length === 0) return [];
    if (ids.length > 50) throw new Error('videos.list は50件まで');
    const json = await this.get<{ items?: ApiVideo[] }>(
      `${DATA_API}/videos`,
      { part: 'snippet,contentDetails,statistics,status', id: ids.join(','), maxResults: 50 },
      signal,
    );
    return json.items ?? [];
  }

  report(query: ReportQuery, signal?: AbortSignal): Promise<ResultTable> {
    return this.get<ResultTable>(
      ANALYTICS_API,
      {
        ids: 'channel==MINE',
        startDate: query.startDate,
        endDate: query.endDate,
        metrics: query.metrics.join(','),
        dimensions: query.dimensions,
        filters: query.filters,
        sort: query.sort,
        maxResults: query.maxResults,
      },
      signal,
    );
  }
}
