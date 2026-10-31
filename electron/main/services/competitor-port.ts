import { COMPETITOR_ERROR_TEXT, type CompetitorErrorCode, type ParsedChannelInput } from '../../../shared/competitor';

export class CompetitorPortError extends Error {
  constructor(readonly code: CompetitorErrorCode) {
    super(COMPETITOR_ERROR_TEXT[code]);
    this.name = 'CompetitorPortError';
  }
}

export type PublicChannel = {
  channelId: string;
  title: string;
  description: string;
  handle?: string;
  publishedAt?: string;
  uploadsPlaylistId?: string;
  thumbnailUrl?: string;
  subscriberCount: string | null;
  hiddenSubscriberCount: boolean;
  videoCount: string | null;
  viewCount: string | null;
  reasons: Record<string, string>;
};

export type PublicVideo = {
  videoId: string;
  channelId: string;
  title: string;
  description: string;
  publishedAt?: string;
  durationIso?: string;
  thumbnailUrl?: string;
  categoryId?: string;
  tags?: string[];
  defaultLanguage?: string;
  liveBroadcastContent?: string;
  viewCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  reasons: Record<string, string>;
};

/** 各API呼び出し（再試行を含む）の前に charge すること。 */
export type CompetitorPort = {
  connected: () => Promise<boolean>;
  ownChannelId: () => string | undefined;
  priorityBusy: () => boolean;
  lookup: (parsed: ParsedChannelInput, signal: AbortSignal) => Promise<PublicChannel | null>;
  uploadsPage: (playlistId: string, pageToken: string | undefined, signal: AbortSignal) => Promise<{ ids: string[]; nextPageToken?: string }>;
  videos: (ids: string[], signal: AbortSignal) => Promise<PublicVideo[]>;
  openExternal: (url: string) => Promise<void>;
};
