import { publicCount, youtubeChannelUrl, type ParsedChannelInput } from '../../../shared/competitor';
import { CompetitorPortError } from './competitor-port';
import { YoutubeApi, type ApiVideo } from './youtube-api';
import { YoutubeError } from './youtube-error';
import type { PublicChannel, PublicVideo } from './competitor-port';

const mapError = (error: unknown): CompetitorPortError => {
  if (error instanceof CompetitorPortError) return error;
  if (error instanceof YoutubeError) {
    if (error.kind === 'auth' || error.kind === 'permission') return new CompetitorPortError('auth_required');
    if (error.kind === 'quota') return new CompetitorPortError('quota_exceeded');
    if (error.kind === 'rate-limit') return new CompetitorPortError('rate_limited');
    if (error.kind === 'cancelled') return new CompetitorPortError('cancelled');
    if (error.kind === 'network') return new CompetitorPortError('network');
    return new CompetitorPortError('unavailable');
  }
  return new CompetitorPortError('network');
};

const thumb = (thumbs?: Record<string, { url?: string }>): string | undefined =>
  thumbs?.medium?.url || thumbs?.default?.url || thumbs?.high?.url;

export const createCompetitorApi = (deps: {
  token: (force?: boolean) => Promise<string>;
  fetch?: typeof fetch;
  charge: () => void;
}): YoutubeApi =>
  new YoutubeApi({
    token: deps.token,
    fetch: deps.fetch,
    onRequest: () => deps.charge(),
    jitterRatio: 0.3,
  });

export const lookupPublicChannel = async (
  api: YoutubeApi,
  parsed: ParsedChannelInput,
  signal: AbortSignal,
): Promise<PublicChannel | null> => {
  const query =
    parsed.kind === 'id'
      ? { id: parsed.channelId }
      : parsed.kind === 'handle'
        ? { forHandle: parsed.handle }
        : parsed.kind === 'username'
          ? { forUsername: parsed.username }
          : null;
  if (!query) return null;
  try {
    const item = await api.listPublicChannel(query, signal);
    if (!item?.id) return null;
    const subscribers = publicCount(item.statistics?.subscriberCount);
    const views = publicCount(item.statistics?.viewCount);
    const videos = publicCount(item.statistics?.videoCount);
    return {
      channelId: item.id,
      title: item.snippet?.title ?? '',
      description: (item.snippet?.description ?? '').slice(0, 8000),
      handle: item.snippet?.customUrl,
      publishedAt: item.snippet?.publishedAt,
      uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
      thumbnailUrl: thumb(item.snippet?.thumbnails),
      subscriberCount: subscribers.value,
      hiddenSubscriberCount: item.statistics?.hiddenSubscriberCount === true,
      videoCount: videos.value,
      viewCount: views.value,
      reasons: {
        ...(subscribers.reason ? { subscriberCount: subscribers.reason } : {}),
        ...(views.reason ? { viewCount: views.reason } : {}),
      },
    };
  } catch (error) {
    throw mapError(error);
  }
};

const videoCounts = (video: ApiVideo): Pick<PublicVideo, 'viewCount' | 'likeCount' | 'commentCount' | 'reasons'> => {
  const view = publicCount(video.statistics?.viewCount);
  const like = publicCount(video.statistics?.likeCount);
  const comment = publicCount(video.statistics?.commentCount);
  return {
    viewCount: view.value,
    likeCount: like.value,
    commentCount: comment.value,
    reasons: {
      ...(view.reason ? { viewCount: view.reason } : {}),
      ...(like.reason ? { likeCount: like.reason } : {}),
      ...(comment.reason ? { commentCount: comment.reason } : {}),
    },
  };
};

export const listPublicVideos = async (api: YoutubeApi, ids: string[], signal: AbortSignal): Promise<PublicVideo[]> => {
  try {
    const items = await api.videos(ids, signal, 'snippet,contentDetails,statistics');
    return items.map((video) => ({
      videoId: video.id,
      channelId: video.snippet?.channelId ?? '',
      title: video.snippet?.title ?? '',
      description: (video.snippet?.description ?? '').slice(0, 4000),
      publishedAt: video.snippet?.publishedAt,
      durationIso: video.contentDetails?.duration,
      thumbnailUrl: thumb(video.snippet?.thumbnails),
      categoryId: video.snippet?.categoryId,
      tags: video.snippet?.tags,
      defaultLanguage: video.snippet?.defaultLanguage,
      liveBroadcastContent: video.snippet?.liveBroadcastContent,
      ...videoCounts(video),
    }));
  } catch (error) {
    throw mapError(error);
  }
};

export const listUploadIds = async (
  api: YoutubeApi,
  playlistId: string,
  pageToken: string | undefined,
  signal: AbortSignal,
): Promise<{ ids: string[]; nextPageToken?: string }> => {
  try {
    return await api.uploads(playlistId, pageToken, signal);
  } catch (error) {
    throw mapError(error);
  }
};

export { youtubeChannelUrl };
