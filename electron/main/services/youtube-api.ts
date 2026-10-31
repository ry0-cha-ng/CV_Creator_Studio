import { classifyHttpError, type ResultTable } from '../../../shared/youtube-analytics';
import { asYoutubeError, YoutubeError } from './youtube-error';

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';
const MAX_RETRIES = 3;
const VIDEO_READ_PARTS = 'snippet,contentDetails,statistics,status,processingDetails';

type Params = Record<string, string | number | undefined>;

export type ApiChannel = { channelId: string; title: string; handle?: string; uploadsPlaylistId: string };

export type ApiVideo = {
  id: string;
  snippet?: {
    channelId?: string;
    title?: string;
    description?: string;
    publishedAt?: string;
    tags?: string[];
    categoryId?: string;
    defaultLanguage?: string;
    liveBroadcastContent?: string;
    thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: {
    privacyStatus?: string;
    publishAt?: string;
    embeddable?: boolean;
    license?: string;
    publicStatsViewable?: boolean;
    selfDeclaredMadeForKids?: boolean;
    madeForKids?: boolean;
    containsSyntheticMedia?: boolean;
    uploadStatus?: string;
    rejectionReason?: string;
  };
  processingDetails?: {
    processingStatus?: string;
    processingFailureReason?: string;
  };
};

export type ApiPlaylist = { id: string; title: string };
export type ApiCategory = { id: string; title: string; assignable: boolean };

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
  /** 競合同期だけ付ける。自チャンネル同期の待ち時間は変えない。 */
  jitterRatio?: number;
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

/** 安全整数を超える無引用の整数だけ文字列にする。通常の件数は数値のまま。 */
export const quoteUnsafeIntegers = (text: string): string => text.replace(/:\s*(\d{16,})(?=\s*[,}\]])/g, ':"$1"');

const delayMs = (base: number, jitterRatio: number): number => {
  if (jitterRatio <= 0) return base;
  return Math.round(base * (1 + Math.random() * jitterRatio));
};

export class YoutubeApi {
  constructor(private readonly deps: YoutubeApiDeps) {}

  private async get<T>(base: string, params: Params, signal?: AbortSignal): Promise<T> {
    const http = this.deps.fetch ?? fetch;
    const sleep = this.deps.sleep ?? defaultSleep;
    const jitter = this.deps.jitterRatio ?? 0;
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
          await sleep(delayMs(1000 * 2 ** attempt, jitter), signal);
          continue;
        }
        throw failure;
      }
      if (response.ok) return JSON.parse(quoteUnsafeIntegers(await response.text())) as T;
      const body = await response.json().catch(() => ({}));
      const classified = classifyHttpError(response.status, body);
      if (classified.kind === 'auth' && !refreshed) {
        refreshed = true;
        forceRefresh = true;
        continue;
      }
      if (classified.retryable && attempt < MAX_RETRIES) {
        await sleep(delayMs(retryAfterMs(response) ?? 1000 * 2 ** attempt, jitter), signal);
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

  /** 公開チャンネルの解決。part は表示と uploads に必要なものだけ。 */
  async listPublicChannel(
    query: { id?: string; forHandle?: string; forUsername?: string },
    signal?: AbortSignal,
  ): Promise<{
    id: string;
    snippet?: {
      title?: string;
      description?: string;
      customUrl?: string;
      publishedAt?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
    statistics?: {
      viewCount?: string | number;
      subscriberCount?: string | number;
      videoCount?: string | number;
      hiddenSubscriberCount?: boolean;
    };
  } | null> {
    const json = await this.get<{ items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        customUrl?: string;
        publishedAt?: string;
        thumbnails?: Record<string, { url?: string }>;
      };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
      statistics?: {
        viewCount?: string | number;
        subscriberCount?: string | number;
        videoCount?: string | number;
        hiddenSubscriberCount?: boolean;
      };
    }> }>(`${DATA_API}/channels`, { part: 'snippet,contentDetails,statistics', ...query }, signal);
    return json.items?.[0] ?? null;
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

  async videos(ids: string[], signal?: AbortSignal, parts = VIDEO_READ_PARTS): Promise<ApiVideo[]> {
    if (ids.length === 0) return [];
    if (ids.length > 50) throw new Error('videos.list は50件まで');
    const json = await this.get<{ items?: ApiVideo[] }>(
      `${DATA_API}/videos`,
      { part: parts, id: ids.join(','), maxResults: 50 },
      signal,
    );
    return json.items ?? [];
  }

  async video(id: string, signal?: AbortSignal): Promise<ApiVideo | undefined> {
    return (await this.videos([id], signal))[0];
  }

  async playlists(pageToken?: string, signal?: AbortSignal): Promise<{ items: ApiPlaylist[]; nextPageToken?: string }> {
    const json = await this.get<{
      items?: Array<{ id: string; snippet?: { title?: string } }>;
      nextPageToken?: string;
    }>(`${DATA_API}/playlists`, { part: 'snippet', mine: 'true', maxResults: 50, pageToken }, signal);
    return {
      items: (json.items ?? []).map((item) => ({ id: item.id, title: item.snippet?.title ?? '' })),
      nextPageToken: json.nextPageToken,
    };
  }

  async videoCategories(regionCode = 'JP', signal?: AbortSignal): Promise<ApiCategory[]> {
    const json = await this.get<{
      items?: Array<{ id: string; snippet?: { title?: string; assignable?: boolean } }>;
    }>(`${DATA_API}/videoCategories`, { part: 'snippet', regionCode }, signal);
    return (json.items ?? []).map((item) => ({
      id: item.id,
      title: item.snippet?.title ?? '',
      assignable: item.snippet?.assignable !== false,
    }));
  }

  async playlistHasVideo(playlistId: string, videoId: string, signal?: AbortSignal): Promise<boolean> {
    let pageToken: string | undefined;
    do {
      const json = await this.get<{
        items?: Array<{ snippet?: { resourceId?: { videoId?: string } } }>;
        nextPageToken?: string;
      }>(`${DATA_API}/playlistItems`, { part: 'snippet', playlistId, maxResults: 50, pageToken }, signal);
      if ((json.items ?? []).some((item) => item.snippet?.resourceId?.videoId === videoId)) return true;
      pageToken = json.nextPageToken;
    } while (pageToken);
    return false;
  }

  private async send<T>(
    method: 'POST' | 'PUT',
    url: string,
    body: unknown,
    signal?: AbortSignal,
    headers?: Record<string, string>,
  ): Promise<T> {
    const http = this.deps.fetch ?? fetch;
    const sleep = this.deps.sleep ?? defaultSleep;
    let refreshed = false;
    let forceRefresh = false;
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw new YoutubeError('cancelled', '中止しました');
      const token = await this.deps.token(forceRefresh);
      forceRefresh = false;
      this.deps.onRequest?.();
      let response: Response;
      try {
        response = await http(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json; charset=UTF-8',
            ...headers,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        const failure = asYoutubeError(error);
        if (failure.retryable && attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt, signal);
          continue;
        }
        throw failure;
      }
      if (response.ok) return (await response.json().catch(() => ({}))) as T;
      const payload = await response.json().catch(() => ({}));
      const classified = classifyHttpError(response.status, payload);
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

  async updateVideo(
    id: string,
    parts: string[],
    resource: { snippet?: Record<string, unknown>; status?: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<ApiVideo> {
    return this.send<ApiVideo>('PUT', withQuery(`${DATA_API}/videos`, { part: parts.join(',') }), { id, ...resource }, signal);
  }

  async insertPlaylistItem(playlistId: string, videoId: string, signal?: AbortSignal): Promise<{ id?: string }> {
    return this.send<{ id?: string }>(
      'POST',
      withQuery(`${DATA_API}/playlistItems`, { part: 'snippet' }),
      {
        snippet: {
          playlistId,
          resourceId: { kind: 'youtube#video', videoId },
        },
      },
      signal,
    );
  }

  async startResumableSession(
    resource: { snippet: Record<string, unknown>; status: Record<string, unknown> },
    contentType: string,
    contentLength: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const http = this.deps.fetch ?? fetch;
    const token = await this.deps.token();
    this.deps.onRequest?.();
    let response: Response;
    try {
      response = await http(withQuery(`${UPLOAD_API}/videos`, { uploadType: 'resumable', part: 'snippet,status' }), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': contentType,
          'X-Upload-Content-Length': String(contentLength),
        },
        body: JSON.stringify(resource),
        signal,
      });
    } catch (error) {
      throw asYoutubeError(error);
    }
    if (response.status === 401) {
      const retryToken = await this.deps.token(true);
      response = await http(withQuery(`${UPLOAD_API}/videos`, { uploadType: 'resumable', part: 'snippet,status' }), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${retryToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': contentType,
          'X-Upload-Content-Length': String(contentLength),
        },
        body: JSON.stringify(resource),
        signal,
      });
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const classified = classifyHttpError(response.status, payload);
      throw new YoutubeError(classified.kind, classified.message, classified.retryable, response.status);
    }
    const location = response.headers.get('location');
    if (!location) throw new YoutubeError('server', 'アップロード用のセッションURLを取得できませんでした', true);
    return location;
  }

  async setThumbnail(videoId: string, image: Buffer, contentType: string, signal?: AbortSignal): Promise<void> {
    const http = this.deps.fetch ?? fetch;
    const sleep = this.deps.sleep ?? defaultSleep;
    let refreshed = false;
    let forceRefresh = false;
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw new YoutubeError('cancelled', '中止しました');
      const token = await this.deps.token(forceRefresh);
      forceRefresh = false;
      this.deps.onRequest?.();
      let response: Response;
      try {
        response = await http(withQuery(`${UPLOAD_API}/thumbnails/set`, { uploadType: 'media', videoId }), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': contentType,
            'Content-Length': String(image.byteLength),
          },
          body: new Uint8Array(image),
          signal,
        });
      } catch (error) {
        const failure = asYoutubeError(error);
        if (failure.retryable && attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt, signal);
          continue;
        }
        throw failure;
      }
      if (response.ok) return;
      const payload = await response.json().catch(() => ({}));
      const classified = classifyHttpError(response.status, payload);
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
