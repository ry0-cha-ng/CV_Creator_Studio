import { clutchVaultUrlPattern, hasClutchVaultUrl, type CopyLanguage } from './delivery-presets';
import { trackingUrlFor } from './export-copy';
import type { Project } from './schema/project';
import { AGENT_NAMES_JA, MAP_NAMES_JA } from './valorant-labels';
import { AGENT_NAMES_KO, MAP_NAMES_KO } from './valorant-ko';

const lookup = (table: Record<string, string>, id: string): string => {
  if (table[id]) return table[id];
  const match = Object.entries(table).find(([key]) => key.toLowerCase() === id.toLowerCase());
  return match?.[1] ?? id;
};

export const HOOK_PATTERNS = {
  result: {
    ja: '{map}{site}リテイクは、\n[これ1個]でいい',
    en: '{agent} lineups = [FREE KILLS]',
  },
  number: {
    ja: '3秒で入れる{ability}定点',
    en: '{ability} in 3 SECONDS',
  },
  question: {
    ja: 'この{ability}、まだ知らない？',
    en: 'Do you know [THIS] {ability}?',
  },
  scarcity: {
    ja: '誰も使ってない{ability}',
    en: 'Nobody uses [THIS] {ability}',
  },
  score: {
    ja: 'スキルだけでスコアを稼ぐ定点',
    en: 'This {ability} = free Performance Score',
  },
  versatile: {
    ja: '{map}で一番使える{agent}定点',
    en: '1 lineup you NEED on {map}',
  },
  newmap: {
    ja: '{map}の定点、まだ誰も知らない',
    en: 'New map, new lineup: {map}',
  },
} as const;

export const DURATION_LIMITS = {
  minSec: 26,
  maxSec: 60,
};

export const durationWarnings = (durationSec: number): string[] => {
  const warnings: string[] = [];
  if (durationSec < DURATION_LIMITS.minSec) {
    warnings.push(`動画が${DURATION_LIMITS.minSec}秒より短いです`);
  }
  if (durationSec > DURATION_LIMITS.maxSec) {
    warnings.push(`ショートの上限${DURATION_LIMITS.maxSec}秒を超えています`);
  }
  return warnings;
};

export const publishingSafeText = (text: string): string =>
  text
    .replaceAll('{br}', ' ')
    .replaceAll(/[[\]]/g, '')
    .replaceAll(/\s*\n+\s*/g, ' ')
    .replaceAll(/[ \t]{2,}/g, ' ')
    .trim();

export const titleIssues = (title: string): Array<{ level: 'error' | 'warn'; text: string }> => {
  const issues: Array<{ level: 'error' | 'warn'; text: string }> = [];
  if (title.length > 100) {
    issues.push({ level: 'error', text: '100文字を超えています。後半の補足を削ってください' });
  }
  if (/[\[\]]|\{br\}/.test(title)) {
    issues.push({ level: 'warn', text: '[ ] と {br} は動画用の記法です。投稿タイトルからは外してください' });
  }
  if (/#[^\s#]/.test(title)) {
    issues.push({
      level: 'warn',
      text: 'タイトル内のハッシュタグは、説明文のハッシュタグ欄へ移してください',
    });
  }
  return issues;
};

const mentioned = (hook: string, token: string): boolean => {
  const value = token.trim();
  if (!value) return false;
  if ([...value].length <= 2) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(hook);
  }
  return hook.toLowerCase().includes(value.toLowerCase());
};

const mentionedAny = (hook: string, tokens: string[]): boolean =>
  tokens.some((token) => mentioned(hook, token));

const resolveHook = (text: string, project: Project, language: 'ja' | 'en'): string =>
  publishingSafeText(
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
      .replaceAll('{aimDescription}', project.lineup.aimDescription[language]),
  );

const hookOf = (project: Project, language: 'ja' | 'en'): string => {
  const raw = project.captions.find((caption) => caption.id === 'hook')?.text[language]?.trim();
  return resolveHook(raw || project.title, project, language);
};

const fitTitle = (hook: string, parts: string[]): string => {
  const safe = publishingSafeText(hook.replace(/#[^\s#]+/g, ' '));
  let kept = parts.filter(Boolean);
  while (kept.length > 0 && `${safe} | ${kept.join(' ')}`.length > 100) kept = kept.slice(0, -1);
  return kept.length > 0 ? `${safe} | ${kept.join(' ')}` : safe;
};

const CHECK_LEAD: Record<CopyLanguage, string> = {
  ja: 'ClutchVaultでこの定点をチェック：',
  en: 'Check this lineup on ClutchVault:',
  ko: 'ClutchVault에서 이 라인업을 확인하세요:',
};

const SIGNUP_URL = 'https://t.co/fvdgfFPSXb';

const CLOSED_BETA_NOTE: Record<CopyLanguage, string> = {
  ja: `クローズドβテスター受付中！早期参加者向けの限定特典も予定しています。\n事前登録はこちら → ${SIGNUP_URL}`,
  en: `Closed beta testers wanted! Early access perks available.\nSign up here → ${SIGNUP_URL}`,
  ko: '지금은 클로즈드 베타 준비 중이라, 로그인은 사전 등록한 사용자만 이용할 수 있습니다.',
};

const descriptionBody = (language: CopyLanguage, summary: string, url: string): string => {
  const about =
    language === 'ja'
      ? 'ClutchVaultはVALORANTの定点を保存し、ラウンド間でもすぐ呼び出せるツールです。'
      : language === 'ko'
        ? 'ClutchVault는 VALORANT 라인업을 저장하고 정리해, 필요할 때 바로 찾을 수 있는 도구입니다.'
        : 'ClutchVault lets you save VALORANT lineups and quickly pull them up between rounds.';
  const credit =
    language === 'ja'
      ? 'ClutchVaultの開発者本人が投稿しています。'
      : language === 'ko'
        ? 'ClutchVault 개발자가 직접 올리고 있습니다.'
        : "I'm the developer of ClutchVault.";
  return [summary, '', CHECK_LEAD[language], url, '', about, CLOSED_BETA_NOTE[language], '', credit].join('\n');
};

export const ensureTrackingUrl = (text: string, language: CopyLanguage, url: string): string => {
  if (!url.trim()) return text;
  if (hasClutchVaultUrl(text)) {
    return text.replace(clutchVaultUrlPattern(), () => url);
  }
  const lead = CHECK_LEAD[language];
  if (text.includes(lead)) return text.replace(lead, `${lead}\n${url}`);
  const blocks = text.trim() ? text.trim().split(/\n\s*\n/) : [];
  if (blocks.length === 0) return `${lead}\n${url}`;
  const [first, ...rest] = blocks;
  return [first, `${lead}\n${url}`, ...rest].join('\n\n');
};

export const stripTitleHashtags = (title: string): { title: string; hashtags: string[] } => {
  const hashtags = title.match(/#[^\s#]+/g) ?? [];
  return { title: publishingSafeText(title.replace(/#[^\s#]+/g, ' ')), hashtags };
};

const softenSaveClaim = (text: string, language: CopyLanguage): string => {
  if (language === 'ja') {
    return text
      .replace(/定点は\s*ClutchVault\s*に保存できます[^。\n]*/g, CHECK_LEAD.ja)
      .replace(/ClutchVaultに保存できます/g, 'ClutchVaultでチェックできます');
  }
  if (language === 'ko') {
    return text.replace(/ClutchVault에 저장할 수 있어요/g, CHECK_LEAD.ko);
  }
  return text.replace(/Save it on ClutchVault/gi, CHECK_LEAD.en);
};

const withClosedBeta = (text: string, language: CopyLanguage): string => {
  if (/クローズドβ|closed beta|클로즈드 베타/i.test(text)) return text;
  return `${text.trim()}\n\n${CLOSED_BETA_NOTE[language]}`;
};

/** 説明文に入れるURL。utm_source と utm_medium だけ。campaign と content は計測用URL側に残す。 */
export const publishingUrls = (project: Project): Record<CopyLanguage, string> => ({
  ja: trackingUrlFor(project, 'ja', new Date(), false),
  en: trackingUrlFor(project, 'en', new Date(), false),
  ko: trackingUrlFor(project, 'ko', new Date(), false),
});

export const defaultPublishing = (
  project: Project,
  urls: Record<CopyLanguage, string> = publishingUrls(project),
): Project['publishing'] => {
  const hookJa = hookOf(project, 'ja');
  const hookEn = hookOf(project, 'en');
  const mapJa = lookup(MAP_NAMES_JA, project.lineup.map);
  const agentJa = lookup(AGENT_NAMES_JA, project.lineup.agent);
  const mapKo = lookup(MAP_NAMES_KO, project.lineup.map);
  const agentKo = lookup(AGENT_NAMES_KO, project.lineup.agent);
  const agentAliases = [project.lineup.agent, agentJa, agentKo];
  const jaAgent = mentionedAny(hookJa, agentAliases) ? '' : agentJa;
  const jaTail = [jaAgent, mentioned(hookJa, '定点') ? '' : '定点'].filter(Boolean).join('');
  const enParts = [
    mentionedAny(hookEn, [project.lineup.map, mapJa, mapKo]) ? '' : project.lineup.map,
    mentioned(hookEn, project.lineup.site) ? '' : project.lineup.site,
    mentionedAny(hookEn, agentAliases) ? '' : project.lineup.agent,
    mentionedAny(hookEn, ['Lineup', 'lineups', '라인업', '定点']) ? '' : 'Lineup',
  ];
  const koParts = [
    mentioned(hookEn, mapKo) ? '' : mapKo,
    mentioned(hookEn, project.lineup.site) ? '' : project.lineup.site,
    mentionedAny(hookEn, agentAliases) ? '' : agentKo,
    mentionedAny(hookEn, ['Lineup', 'lineups', '라인업', '定点']) ? '' : '라인업',
  ];
  const hashtags = [
    'valorant',
    'valorant lineups',
    project.lineup.agent,
    project.lineup.map,
    'valorant tips',
  ].join(',');
  return {
    title: {
      ja: fitTitle(hookJa, [mentioned(hookJa, mapJa) ? '' : mapJa, jaTail]),
      en: fitTitle(hookEn, enParts),
      ko: fitTitle(hookEn, koParts),
    },
    description: {
      ja: descriptionBody('ja', `${mapJa} ${project.lineup.site}の${agentJa}定点です。`, urls.ja),
      en: descriptionBody('en', `${project.lineup.map} ${project.lineup.site} ${project.lineup.agent} lineup.`, urls.en),
      ko: descriptionBody('ko', `${mapKo} ${project.lineup.site} ${agentKo} 라인업입니다.`, urls.ko),
    },
    hashtags: {
      ja: hashtags,
      en: hashtags,
      ko: hashtags,
    },
    links: project.publishing.links,
    memoUrl: project.publishing.memoUrl,
    xPost: project.publishing.xPost,
  };
};

type LocalizedDraft = { ja: string; en: string; ko?: string };

export const normalizePublishingDraft = <
  T extends { title: LocalizedDraft; description: LocalizedDraft; hashtags: LocalizedDraft },
>(
  project: Project,
  draft: T,
): T => {
  const urls = publishingUrls(project);
  const title = { ...draft.title };
  const description = { ...draft.description };
  const hashtags = { ...draft.hashtags };
  for (const language of ['ja', 'en', 'ko'] as const) {
    const normalized = normalizePublishingFields(
      language,
      {
        title: title[language] ?? '',
        description: description[language] ?? '',
        hashtags: hashtags[language] ?? '',
      },
      urls[language],
    );
    title[language] = normalized.title;
    description[language] = normalized.description;
    hashtags[language] = normalized.hashtags;
  }
  return { ...draft, title, description, hashtags };
};

const mergeTags = (current: string, extra: string[]): string => {
  const tags = current.split(/\s+/).filter(Boolean);
  for (const tag of extra) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.join(' ');
};

export const normalizePublishingFields = <T extends { title: string; hashtags: string; description: string }>(
  language: CopyLanguage,
  fields: T,
  url: string,
): T => {
  const stripped = stripTitleHashtags(fields.title);
  const description = withClosedBeta(
    ensureTrackingUrl(softenSaveClaim(fields.description, language), language, url),
    language,
  );
  return {
    ...fields,
    title: stripped.title,
    hashtags: mergeTags(fields.hashtags, stripped.hashtags),
    description,
  };
};

export const koreanTitleUsesEnglishHook = (project: Project): boolean => {
  if (!project.guide.exportPresets.includes('yt-global')) return false;
  if (project.guide.publishingEdited.title?.ko) return false;
  const hookEn = hookOf(project, 'en');
  const titleKo = publishingSafeText(project.publishing.title.ko ?? '');
  return !titleKo || (hookEn.length > 0 && titleKo.includes(hookEn));
};
