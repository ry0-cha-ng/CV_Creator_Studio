
/** 公開viewCountの定義変更（2026-08）をまたいで遡及変換しないための版。 */
export const METRIC_DEFINITION_VERSION = 'youtube-public-viewcount-2026-08';
export const BASIC_POLICY_ID = 'basic-2026-10-22';
export const API_RETENTION_DAYS = 29;
export const DEFAULT_WINDOW_DAYS = 180;
export const DEFAULT_MAX_VIDEOS = 200;
export const DEFAULT_QUOTA_BUDGET = 800;
export const DEFAULT_TIMEZONE = 'Asia/Tokyo';
export const VIDEO_BATCH = 50;

export const competitorErrorCodes = [
  'invalid_input',
  'unresolved',
  'auth_required',
  'quota_exceeded',
  'rate_limited',
  'network',
  'unavailable',
  'policy_restricted',
  'partial',
  'cancelled',
  'own_channel',
  'duplicate',
  'busy',
  'interrupted',
] as const;
export type CompetitorErrorCode = (typeof competitorErrorCodes)[number];

export const COMPETITOR_ERROR_TEXT: Record<CompetitorErrorCode, string> = {
  invalid_input: 'この行はYouTubeのチャンネルURL、ハンドル、チャンネルIDとして読めません',
  unresolved: 'チャンネルを特定できません。ハンドル（@name）かチャンネルIDを入れてください',
  auth_required: 'YouTubeの読み取り接続が必要です。アップロードの権限は追加しません',
  quota_exceeded: '競合取得用の上限に達したため、ここで止めて成功した分だけ残しました',
  rate_limited: '短時間のリクエストが多いため、少し間を置いています',
  network: '通信に失敗しました。成功した分は残しています',
  unavailable: 'いま取得できません。削除とは断定していません',
  policy_restricted: '追加の利用条件を確認していないため、この集計は使っていません',
  partial: '一部だけ取得できました。全体が取れた扱いにはしません',
  cancelled: '取得を中止しました。そこまでに保存した分は残しています',
  own_channel: 'これは自分のチャンネルです。競合には登録せず、詳細分析の Overview と Posts で見ます',
  duplicate: '同じチャンネルはすでに登録されています',
  busy: '投稿または自チャンネルの同期を優先しているため、競合の取得は始めていません',
  interrupted: '前回の取得はアプリ終了で中断されました',
};

export const COMPETITOR_TAGS = [
  'Phoenix特化',
  '他エージェント特化',
  '複数エージェント定点',
  '実戦解説',
  'ハイライト',
  '編集・フック',
] as const;

export type CompetitorTier = 'primary' | 'reference' | 'hold';
export type CompetitorWatch = 'growing' | 'struggling' | 'benchmark' | 'undecided';
export type VideoFormat = 'shorts' | 'standard' | 'live' | 'unknown';
export type VideoOrientation = 'vertical' | 'horizontal' | 'square' | 'unknown';

export const TIER_LABEL: Record<CompetitorTier, string> = {
  primary: '主観察',
  reference: '参考',
  hold: '保留',
};
export const WATCH_LABEL: Record<CompetitorWatch, string> = {
  growing: '成長に注目',
  struggling: '伸び悩みを検証',
  benchmark: '比較対象',
  undecided: '未判断',
};

export type ApiUsagePolicy = {
  id: string;
  level: 'basic' | 'approved_extended';
  confirmedAt: string | null;
  basisRef: string | null;
  allowedFamilies: string[];
  statsRetentionDays: number;
  reviewDueAt: string | null;
  /** 終了中に削除できない環境では false。起動時削除だけでは true にしない。 */
  persistentCache: boolean;
  persistentCacheReason: string;
};

export const basicPolicy = (): ApiUsagePolicy => ({
  id: BASIC_POLICY_ID,
  level: 'basic',
  confirmedAt: null,
  basisRef: null,
  allowedFamilies: ['current_public'],
  statsRetentionDays: API_RETENTION_DAYS,
  reviewDueAt: null,
  persistentCache: false,
  persistentCacheReason:
    'アプリを終了している間は期限削除を実行できません。公開APIの数値と本文は保存せず、起動中だけ表示します。',
});

export type MetricFamily = 'frequency' | 'duration' | 'format_ratio' | 'delta' | 'observed_7d' | 'highlight' | 'current_public';

/** 派生集計は、追加条件の承認と終了中も消せる保存の両方が揃ったときだけ。 */
export const canUseDerivedMetrics = (policy: ApiUsagePolicy, family: MetricFamily): boolean => {
  if (family === 'current_public') return true;
  return policy.level === 'approved_extended' && policy.persistentCache && policy.allowedFamilies.includes(family);
};

export const retentionDeadline = (policy: ApiUsagePolicy, observedAt: string): string => {
  const start = new Date(observedAt).getTime();
  const days = Math.min(policy.statsRetentionDays, API_RETENTION_DAYS);
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
};

export type EvidenceView =
  | { state: 'readable'; expiresAt: string }
  | { state: 'expired' }
  | { state: 'session_missing'; expiresAt: string }
  | { state: 'deleted' };

export const readableEvidence = (
  ref: { expiresAt: string | null; expired: boolean; present: boolean } | null,
  now: string,
  inSession: boolean,
): EvidenceView => {
  if (!ref || !ref.present) return { state: 'deleted' };
  if (ref.expired || (ref.expiresAt !== null && ref.expiresAt <= now)) return { state: 'expired' };
  if (!inSession) return { state: 'session_missing', expiresAt: ref.expiresAt ?? now };
  return { state: 'readable', expiresAt: ref.expiresAt ?? now };
};

/** APIの公開統計。欠ける値は null。巨大整数は文字列のまま。 */
export const publicCount = (value: unknown): { value: string | null; reason?: 'not_returned' | 'precision' } => {
  if (value === undefined || value === null || value === '') return { value: null, reason: 'not_returned' };
  if (typeof value === 'string' && /^\d+$/.test(value)) return { value };
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return { value: String(value) };
  return { value: null, reason: 'precision' };
};

export type ParsedChannelInput =
  | { kind: 'id'; channelId: string; raw: string; key: string }
  | { kind: 'handle'; handle: string; raw: string; key: string }
  | { kind: 'username'; username: string; raw: string; key: string }
  | { kind: 'unresolved'; raw: string; key: string; reason: string }
  | { kind: 'invalid'; raw: string; reason: string };

const CHANNEL_ID = /^UC[\w-]{22}$/;
const HANDLE = /^@[\p{L}\p{N}._-]{3,30}$/u;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

const strip = (value: string): string => value.replace(/^\uFEFF/, '').trim();

export const parseChannelLine = (input: string): ParsedChannelInput => {
  const raw = strip(input);
  if (!raw) return { kind: 'invalid', raw, reason: '空行です' };
  if (CHANNEL_ID.test(raw)) return { kind: 'id', channelId: raw, raw, key: `id:${raw}` };
  if (HANDLE.test(raw)) {
    const handle = raw.slice(1);
    return { kind: 'handle', handle, raw, key: `handle:${handle.toLowerCase()}` };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'invalid', raw, reason: COMPETITOR_ERROR_TEXT.invalid_input };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be' || !YOUTUBE_HOSTS.has(host)) {
    return { kind: 'invalid', raw, reason: COMPETITOR_ERROR_TEXT.invalid_input };
  }
  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  const head = parts[0] ?? '';
  if (head === 'watch' || head === 'shorts' || head === 'playlist' || head === 'live' || head === 'embed') {
    return { kind: 'invalid', raw, reason: '動画や再生リストのURLです。チャンネルのURLを入れてください' };
  }
  if (head === 'channel' && parts[1] && CHANNEL_ID.test(parts[1])) {
    return { kind: 'id', channelId: parts[1], raw, key: `id:${parts[1]}` };
  }
  if (head.startsWith('@') && HANDLE.test(head)) {
    const handle = head.slice(1);
    return { kind: 'handle', handle, raw, key: `handle:${handle.toLowerCase()}` };
  }
  if (head === 'user' && parts[1]) {
    return { kind: 'username', username: parts[1], raw, key: `user:${parts[1].toLowerCase()}` };
  }
  if (head === 'c' && parts[1]) {
    return {
      kind: 'unresolved',
      raw,
      key: `raw:${raw.toLowerCase()}`,
      reason: 'カスタムURLはハンドルかチャンネルIDがないと特定できません',
    };
  }
  if (parts.length === 1 && head) {
    return {
      kind: 'unresolved',
      raw,
      key: `raw:${raw.toLowerCase()}`,
      reason: 'チャンネル名だけでは候補を決めません。ハンドルかチャンネルIDを足してください',
    };
  }
  return { kind: 'invalid', raw, reason: COMPETITOR_ERROR_TEXT.invalid_input };
};

export const parseChannelLines = (text: string): ParsedChannelInput[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 50)
    .map(parseChannelLine);

const VIDEO_ID = /^[\w-]{11}$/;

export const parseVideoUrl = (input: string): { videoId: string; url: string } | null => {
  const raw = strip(input);
  if (VIDEO_ID.test(raw)) return { videoId: raw, url: `https://www.youtube.com/watch?v=${raw}` };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID.test(id) ? { videoId: id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? '';
    return VIDEO_ID.test(id) ? { videoId: id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if ((parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed') && parts[1] && VIDEO_ID.test(parts[1])) {
    return { videoId: parts[1], url: `https://www.youtube.com/watch?v=${parts[1]}` };
  }
  return null;
};

export const youtubeChannelUrl = (channelId: string, handle?: string | null): string => {
  if (handle) {
    const name = handle.startsWith('@') ? handle : `@${handle}`;
    return `https://www.youtube.com/${name}`;
  }
  return `https://www.youtube.com/channel/${channelId}`;
};

/** 取得済みのハンドルを優先し、無ければ登録時の入力（@name や /@name の URL）から読む。 */
export const youtubeHandle = (sessionHandle: string | null | undefined, userInput: string): string | null => {
  const fromSession = sessionHandle?.trim().replace(/^@/, '');
  if (fromSession) return fromSession;
  const parsed = parseChannelLine(userInput);
  return parsed.kind === 'handle' ? parsed.handle : null;
};

export const VIDIQ_HOME = 'https://app.vidiq.com/';

/**
 * vidIQ の公開統計ページ。2026-10 時点の形式は
 * チャンネル https://vidiq.com/youtube-stats/channel/@handle/ 、動画 …/@handle/videos/{videoId}/ 。
 * チャンネルIDで引く形式は確認できていないので、ハンドルが無ければ null。
 */
export const vidiqChannelUrl = (handle: string | null | undefined, videoId?: string): string | null => {
  const name = handle?.trim().replace(/^@/, '');
  if (!name) return null;
  const base = `https://vidiq.com/youtube-stats/channel/@${encodeURIComponent(name)}/`;
  return videoId ? `${base}videos/${encodeURIComponent(videoId)}/` : base;
};

export const localDate = (iso: string, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
};

export const addCalendarDay = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
};
