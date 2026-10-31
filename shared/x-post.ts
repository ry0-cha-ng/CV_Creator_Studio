import twitterText from 'twitter-text';
import { isClutchVaultUrl, type DeliveryPresetId } from './delivery-presets';
import type { Project } from './schema/project';

/** X の無料枠。画像添付はカウントしない。 */
export const X_WEIGHTED_LIMIT = 280;

/** 必須ではない目安。最終判定は投稿全体の weightedLength。 */
export const X_HOOK_SOFT_LIMIT = { ja: 20, en: 60 } as const;

export const X_POST_LINEUP_LABEL = '試合用画像 / Lineup';
export const X_POST_WATCH_LABEL = '投げ方動画 / Watch';
export const X_POST_HASHTAGS = '#VAROLANT #定点';

const xSideLabel = (side: Project['lineup']['side']): string => (side === 'attack' ? 'Attacker' : 'Defender');

/** 投稿の1行目。例: 【Corrode A / Phoenix / Attacker】 */
export const xPostHeading = (project: Project): string => {
  const place = `${project.lineup.map.trim()} ${project.lineup.site}`.trim();
  const agent = project.lineup.agent.trim();
  return `【${[place, agent, xSideLabel(project.lineup.side)].filter(Boolean).join(' / ')}】`;
};

const LANDING_PATHS = new Set(['/', '/en']);
const LIST_PATHS = new Set(['/lineups', '/en/lineups']);

export const normalizeHook = (value: string): string =>
  value
    .replaceAll('\u00a0', ' ')
    .replaceAll(/[\r\n]+/g, ' ')
    .replaceAll(/[ \t]{2,}/g, ' ')
    .trim();

export const hookLength = (value: string): number => Array.from(normalizeHook(value)).length;

const fillLineupTokens = (text: string, project: Project, language: 'ja' | 'en'): string =>
  text
    .replaceAll('{map}', project.lineup.map)
    .replaceAll('{site}', project.lineup.site)
    .replaceAll('{side}', project.lineup.side)
    .replaceAll('{agent}', project.lineup.agent)
    .replaceAll('{ability}', project.lineup.ability)
    .replaceAll('{throwType}', project.lineup.throwType[language])
    .replaceAll('{charge}', String(project.lineup.charge ?? ''))
    .replaceAll('{bounce}', String(project.lineup.bounce ?? ''))
    .replaceAll('{standDescription}', project.lineup.standDescription[language])
    .replaceAll('{aimDescription}', project.lineup.aimDescription[language])
    .replaceAll('{br}', '\n');

/** 動画テロップのフックを、投稿用の1行にほどく。カード用の xText は使わない。 */
export const videoHookText = (project: Project, language: 'ja' | 'en'): string => {
  const raw = project.captions.find((caption) => caption.id === 'hook')?.text[language] ?? '';
  return normalizeHook(fillLineupTokens(raw, project, language).replaceAll(/[[\]]/g, ''));
};

const singleLine = (value: string): string => value.replaceAll('\u00a0', ' ').replaceAll(/[\r\n]+/g, ' ');

export const syncedXPost = (project: Project): Project['publishing']['xPost'] => {
  const current = project.publishing.xPost;
  return {
    ...current,
    ja: current.jaEdited ? singleLine(current.ja) : videoHookText(project, 'ja'),
    en: current.enEdited ? singleLine(current.en) : videoHookText(project, 'en'),
  };
};

/** 動画フックを X 用へ写す。動画のテロップとタイトルは変えない。 */
export const applyVideoHooks = (project: Project): Project => ({
  ...project,
  publishing: {
    ...project.publishing,
    xPost: {
      ...project.publishing.xPost,
      ja: videoHookText(project, 'ja'),
      en: videoHookText(project, 'en'),
      jaEdited: true,
      enEdited: true,
    },
  },
});

const replyPresets = (project: Project): DeliveryPresetId[] =>
  project.guide.xReplyVideo === 'tiktok' ? ['tt-jp', 'tt-en'] : ['yt-global', 'yt-ja'];

/** 選んだ投稿先の公開URL。本文に使う動画は常に1本。 */
export const savedReplyVideoUrl = (project: Project): string => {
  for (const preset of replyPresets(project)) {
    const post = project.posts.find((item) => item.preset === preset && item.url.trim());
    if (post) return post.url.trim();
  }
  return '';
};

export const xVideoInput = (project: Project): string => {
  if (project.publishing.xPost.videoUrlEdited) return project.publishing.xPost.videoUrl;
  return savedReplyVideoUrl(project);
};

export const xSpotInput = (project: Project): string => {
  if (project.publishing.xPost.spotDraft) return project.publishing.xPost.spotDraft;
  return project.publishing.memoUrl;
};

export const parseHttpUrl = (value: string): URL | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url;
  } catch {
    return null;
  }
};

const pathOf = (url: URL): string => {
  const path = url.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
};

export const isSpotDetailUrl = (value: string): boolean => {
  if (!isClutchVaultUrl(value)) return false;
  const url = parseHttpUrl(value);
  if (!url) return false;
  const path = pathOf(url);
  if (LANDING_PATHS.has(path) || LIST_PATHS.has(path)) return false;
  return true;
};

export const spotProblem = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return '定点詳細のURLが未入力です';
  const url = parseHttpUrl(trimmed);
  if (!url) return '定点詳細のURLが無効です';
  if (!isClutchVaultUrl(trimmed)) return '定点詳細のURLは https の ClutchVault ページにしてください';
  const path = pathOf(url);
  if (LANDING_PATHS.has(path)) return 'トップページではなく、定点の詳細ページのURLを入れてください';
  if (LIST_PATHS.has(path)) return '一覧ではなく、定点の詳細ページのURLを入れてください';
  return null;
};

export const videoProblem = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return '動画URLが未入力です';
  if (!parseHttpUrl(trimmed)) return '動画URLは http または https のURLにしてください';
  return null;
};

/** 投稿文の定点URLから utm_* だけ外す。他のクエリとハッシュは残す。 */
export const xPostSpotUrl = (value: string): string => {
  const url = parseHttpUrl(value);
  if (!url) return '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  }
  return url.toString();
};

export const assembleXPost = (input: {
  heading: string;
  ja: string;
  en: string;
  spotUrl: string;
  videoUrl: string;
}): string =>
  [
    input.heading,
    '',
    normalizeHook(input.ja),
    normalizeHook(input.en),
    '',
    X_POST_LINEUP_LABEL,
    input.spotUrl,
    '',
    X_POST_WATCH_LABEL,
    input.videoUrl,
    '',
    X_POST_HASHTAGS,
  ].join('\n');

export const weighXPost = (
  text: string,
): { weightedLength: number; valid: boolean; remaining: number } => {
  const parsed = twitterText.parseTweet(text);
  const weightedLength = parsed.weightedLength;
  const valid = parsed.valid && weightedLength <= X_WEIGHTED_LIMIT;
  return { weightedLength, valid, remaining: X_WEIGHTED_LIMIT - weightedLength };
};

export type XPostPreview = {
  text: string;
  copyable: boolean;
  problems: string[];
  weightedLength: number;
  remaining: number;
  valid: boolean;
  ja: string;
  en: string;
  spotInput: string;
  spotUrl: string;
  videoInput: string;
  videoUrl: string;
};

export const prepareXPost = (project: Project): XPostPreview => {
  const ja = normalizeHook(project.publishing.xPost.ja);
  const en = normalizeHook(project.publishing.xPost.en);
  const spotInput = xSpotInput(project);
  const videoInput = xVideoInput(project);
  const spotIssue = spotProblem(spotInput);
  const videoIssue = videoProblem(videoInput);
  const spotUrl = spotIssue ? '' : xPostSpotUrl(spotInput);
  const videoUrl = videoIssue ? '' : videoInput.trim();
  const text = assembleXPost({ heading: xPostHeading(project), ja, en, spotUrl, videoUrl });
  const count = weighXPost(text);
  const problems: string[] = [];
  if (!ja) problems.push('日本語フックが空です');
  if (!en) problems.push('英語フックが空です');
  if (spotIssue) problems.push(spotIssue);
  if (videoIssue) problems.push(videoIssue);
  if (!count.valid) problems.push(`280カウントを超えています（${count.weightedLength} / 280）`);
  const leaked = ['undefined', '{日本語フック}', '{英語フック}', '{CV定点詳細URL}', '{動画URL}', '{YouTube URL}', '{TikTok URL}'].some(
    (token) => text.includes(token),
  );
  if (leaked) problems.push('投稿文に未確定の値が入っています');
  return {
    text,
    copyable: problems.length === 0,
    problems,
    weightedLength: count.weightedLength,
    remaining: count.remaining,
    valid: count.valid,
    ja,
    en,
    spotInput,
    spotUrl,
    videoInput,
    videoUrl,
  };
};
