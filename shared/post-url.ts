export type PostUrlPlatform = 'youtube' | 'tiktok' | 'x';
export type PostUrlStatus = 'valid' | 'warning' | 'error' | 'empty';

export type PostUrlSuggestion = {
  url: string;
  label: string;
};

export type PostUrlVerdict = {
  status: PostUrlStatus;
  normalizedUrl?: string;
  videoId?: string;
  message?: string;
  suggestion?: PostUrlSuggestion;
};

export type TakenPostUrl = {
  url: string;
  projectTitle: string;
  projectId?: string;
  preset?: string;
};

export type PostUrlContext = {
  accounts?: Partial<Record<PostUrlPlatform, string>>;
  taken?: TakenPostUrl[];
  ignore?: { projectId: string; preset: string };
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const DIGITS = /^\d+$/;
const SHARE_PARAMS = new Set(['si', 'feature', 'is_from_webapp', 's', 't', 'share_app_id']);
const X_APP_PATHS = new Set([
  'home',
  'explore',
  'search',
  'compose',
  'messages',
  'settings',
  'notifications',
  'i',
  'intent',
  'share',
  'hashtag',
  'login',
  'signup',
]);

const FIELD_LABEL: Record<PostUrlPlatform, string> = {
  youtube: 'YouTube の投稿URL',
  tiktok: 'TikTok の投稿URL',
  x: 'X の投稿URL',
};

const PLATFORM_NAME: Record<PostUrlPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
};

const EMPTY_MESSAGE: Record<PostUrlPlatform, string> = {
  youtube: '公開したら、YouTube のURLを貼ってください',
  tiktok: '公開したら、TikTok のURLを貼ってください',
  x: '公開したら、X のURLを貼ってください',
};

const GENERIC_ERROR: Record<PostUrlPlatform, string> = {
  youtube: 'YouTube Shorts のURLではありません（youtube.com/shorts/… か youtu.be/…）',
  tiktok: 'TikTok の動画のURLではありません（tiktok.com/@…/video/…）',
  x: 'ポストのURLではありません（x.com/…/status/…）',
};

const bareHost = (hostname: string): string => {
  let host = hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  if (host.startsWith('m.')) host = host.slice(2);
  return host;
};

const familyOf = (host: string): PostUrlPlatform | null => {
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
    return 'x';
  }
  return null;
};

const readUrl = (input: string): URL | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
};

const segments = (url: URL): string[] =>
  url.pathname
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .filter(Boolean);

const shortsUrl = (videoId: string): string => `https://youtube.com/shorts/${videoId}`;

const valid = (normalizedUrl: string, videoId?: string): PostUrlVerdict => ({
  status: 'valid',
  normalizedUrl,
  videoId,
  message: '✓ 有効なURLです',
});

const warning = (
  message: string,
  normalizedUrl: string,
  suggestion?: PostUrlSuggestion,
  videoId?: string,
): PostUrlVerdict => ({
  status: 'warning',
  normalizedUrl,
  videoId,
  message,
  suggestion,
});

const error = (message: string): PostUrlVerdict => ({ status: 'error', message });

const judgeYoutube = (url: URL, host: string): PostUrlVerdict => {
  const parts = segments(url);
  if (host === 'studio.youtube.com') {
    const videoId = parts[0] === 'video' ? parts[1] : undefined;
    if (!videoId || !YOUTUBE_ID.test(videoId)) return error(GENERIC_ERROR.youtube);
    return warning(
      'YouTube Studio の編集画面のURLです',
      `https://studio.youtube.com/video/${videoId}/edit`,
      { url: shortsUrl(videoId), label: '公開URLに置き換える' },
      videoId,
    );
  }
  if (host === 'youtu.be') {
    const videoId = parts[0];
    if (!videoId || !YOUTUBE_ID.test(videoId)) return error(GENERIC_ERROR.youtube);
    return valid(shortsUrl(videoId), videoId);
  }
  const head = parts[0] ?? '';
  if (head.startsWith('@') || head === 'channel' || head === 'c' || head === 'user') {
    return error('チャンネルのURLです。公開した Shorts を開いてURLをコピーしてください');
  }
  if (head === 'shorts') {
    const videoId = parts[1];
    if (!videoId || !YOUTUBE_ID.test(videoId)) return error(GENERIC_ERROR.youtube);
    return valid(shortsUrl(videoId), videoId);
  }
  if (head === 'watch') {
    const videoId = url.searchParams.get('v') ?? '';
    if (!YOUTUBE_ID.test(videoId)) return error(GENERIC_ERROR.youtube);
    return warning(
      'Shorts のURLではありません。Shorts として公開されたか確認してください',
      `https://youtube.com/watch?v=${videoId}`,
      { url: shortsUrl(videoId), label: 'Shorts のURLに置き換える' },
      videoId,
    );
  }
  return error(GENERIC_ERROR.youtube);
};

const judgeTiktok = (url: URL, host: string): PostUrlVerdict => {
  const parts = segments(url);
  if (host === 'vm.tiktok.com') {
    const code = parts[0];
    if (!code) return error(GENERIC_ERROR.tiktok);
    return warning(
      '短縮URLです。このままでも記録できますが、動画を開いて表示されるURLに置き換えると確実です',
      `https://vm.tiktok.com/${code}`,
    );
  }
  if (parts[0] === 't' && parts[1]) {
    return warning(
      '短縮URLです。このままでも記録できますが、動画を開いて表示されるURLに置き換えると確実です',
      `https://tiktok.com/t/${parts[1]}`,
    );
  }
  if (parts[0] === 'tiktokstudio' || url.pathname.toLowerCase().includes('/tiktokstudio')) {
    return error('TikTok Studio の画面のURLです。公開した動画を開いてURLをコピーしてください');
  }
  const user = parts[0]?.startsWith('@') ? parts[0].slice(1) : '';
  if (user && parts.length === 1) {
    return error('動画のURLではありません。プロフィールではなく動画を開いてURLをコピーしてください');
  }
  if (user && parts[1] === 'photo') {
    return error('写真投稿のURLです。動画の投稿を開いてURLをコピーしてください');
  }
  if (user && parts[1] === 'video' && parts[2] && DIGITS.test(parts[2])) {
    return valid(`https://tiktok.com/@${user}/video/${parts[2]}`, parts[2]);
  }
  return error(GENERIC_ERROR.tiktok);
};

const judgeX = (url: URL): PostUrlVerdict => {
  const parts = segments(url);
  const statusAt = parts.indexOf('status');
  if (statusAt >= 1) {
    const postId = parts[statusAt + 1];
    const user = parts[statusAt - 1];
    if (!postId || !DIGITS.test(postId) || !user) return error(GENERIC_ERROR.x);
    const normalizedUrl =
      user === 'i' ? `https://x.com/i/status/${postId}` : `https://x.com/${user}/status/${postId}`;
    return valid(normalizedUrl, postId);
  }
  if (parts.length === 1 && parts[0] && !X_APP_PATHS.has(parts[0].toLowerCase())) {
    return error('プロフィールのURLです。投稿したポストを開いてURLをコピーしてください');
  }
  return error(GENERIC_ERROR.x);
};

const judge = (platform: PostUrlPlatform, input: string): PostUrlVerdict => {
  if (!input.trim()) return { status: 'empty', message: EMPTY_MESSAGE[platform] };
  const url = readUrl(input);
  if (!url) return error(GENERIC_ERROR[platform]);
  for (const key of [...url.searchParams.keys()]) {
    if (SHARE_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  const host = bareHost(url.hostname);
  const family = familyOf(host);
  if (family && family !== platform) {
    return error(`${PLATFORM_NAME[family]} のURLです。この欄は ${FIELD_LABEL[platform]}です`);
  }
  if (!family) return error(GENERIC_ERROR[platform]);
  if (platform === 'youtube') return judgeYoutube(url, host);
  if (platform === 'tiktok') return judgeTiktok(url, host);
  return judgeX(url);
};

const samePost = (left: PostUrlVerdict, right: PostUrlVerdict): boolean => {
  if (left.videoId && right.videoId && left.videoId === right.videoId) return true;
  return Boolean(left.normalizedUrl && right.normalizedUrl && left.normalizedUrl === right.normalizedUrl);
};

const accountHandle = (platform: PostUrlPlatform, verdict: PostUrlVerdict): string | null => {
  if (!verdict.normalizedUrl) return null;
  try {
    const parts = segments(new URL(verdict.normalizedUrl));
    if (platform === 'tiktok' && parts[0]?.startsWith('@')) return parts[0].slice(1);
    if (platform === 'x') {
      const statusAt = parts.indexOf('status');
      const user = statusAt >= 1 ? parts[statusAt - 1] : '';
      if (!user || user === 'i') return null;
      return user;
    }
    return null;
  } catch {
    return null;
  }
};

const normalizeAccount = (value: string): string => value.trim().replace(/^@+/, '').toLowerCase();

const applyContext = (
  platform: PostUrlPlatform,
  verdict: PostUrlVerdict,
  context?: PostUrlContext,
): PostUrlVerdict => {
  if (!context || verdict.status === 'error' || verdict.status === 'empty') return verdict;
  const taken = context.taken?.find((row) => {
    if (context.ignore && row.projectId === context.ignore.projectId && row.preset === context.ignore.preset) {
      return false;
    }
    const other = judge(platform, row.url);
    return other.status !== 'error' && other.status !== 'empty' && samePost(verdict, other);
  });
  if (taken) {
    return error(`このURLは${taken.projectTitle}の投稿として登録済みです`);
  }
  if (verdict.status !== 'valid') return verdict;
  const configured = context.accounts?.[platform];
  const expected = configured ? normalizeAccount(configured) : '';
  const actual = accountHandle(platform, verdict);
  if (!expected || !actual || normalizeAccount(actual) === expected) return verdict;
  const shown = configured?.trim().startsWith('@') ? configured.trim() : `@${expected}`;
  return {
    ...verdict,
    status: 'warning',
    message: `設定のアカウント（${shown}）と違います。別のアカウントで投稿していないか確認してください`,
  };
};

export const checkPostUrl = (
  platform: PostUrlPlatform,
  input: string,
  context?: PostUrlContext,
): PostUrlVerdict => applyContext(platform, judge(platform, input), context);

const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * YouTube 通常動画（横動画）の URL。watch?v= を正とし、youtu.be と Studio の URL は置き換えを提案する。
 * Shorts の URL は通常動画として公開されていない可能性があるため警告する（Shorts 用の判定は変えない）。
 */
const judgeYoutubeVideo = (input: string): PostUrlVerdict => {
  const base = judge('youtube', input);
  if (base.status === 'empty') return { status: 'empty', message: '公開したら、YouTube の動画のURL（watch?v=…）を貼ってください' };
  if (base.status === 'error' || !base.videoId) {
    return error(
      base.message === GENERIC_ERROR.youtube
        ? 'YouTube 動画のURLではありません（youtube.com/watch?v=… か youtu.be/…）'
        : (base.message ?? '').replace('公開した Shorts', '公開した動画'),
    );
  }
  const videoId = base.videoId;
  const url = readUrl(input);
  const host = url ? bareHost(url.hostname) : '';
  const head = url ? segments(url)[0] ?? '' : '';
  if (host === 'studio.youtube.com') {
    return warning('YouTube Studio の編集画面のURLです', `https://studio.youtube.com/video/${videoId}/edit`, { url: watchUrl(videoId), label: '公開URLに置き換える' }, videoId);
  }
  if (head === 'shorts') {
    return warning(
      'Shorts のURLです。横動画は通常動画として公開されたか確認してください',
      watchUrl(videoId),
      { url: watchUrl(videoId), label: '通常動画のURL（watch?v=）にする' },
      videoId,
    );
  }
  return valid(watchUrl(videoId), videoId);
};

/** 横動画（YouTube 通常動画）の投稿URL。登録済みURLの重複も検出する */
export const checkYoutubeVideoUrl = (input: string, context?: PostUrlContext): PostUrlVerdict =>
  applyContext('youtube', judgeYoutubeVideo(input), context);

/** Shorts・watch・youtu.be・Studio のどの表記でも同じ動画IDを返す。横動画の照合にも使う。 */
export const youtubeVideoIdFromUrl = (input: string): string | undefined => {
  const verdict = judge('youtube', input);
  return verdict.status === 'error' || verdict.status === 'empty' ? undefined : verdict.videoId;
};
