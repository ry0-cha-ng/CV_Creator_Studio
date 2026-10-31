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

const TITLE_HASHTAG = '#valorant';
const DESCRIPTION_HASHTAG = '#valorantshorts';

const fitTitle = (hook: string, parts: string[]): string => {
  const safe = publishingSafeText(hook.replace(/#[^\s#]+/g, ' '));
  const limit = 100 - TITLE_HASHTAG.length - 1;
  let kept = parts.filter(Boolean);
  const bodyOf = (items: string[]): string => (items.length > 0 ? `${safe} | ${items.join(' ')}` : safe);
  while (kept.length > 0 && bodyOf(kept).length > limit) kept = kept.slice(0, -1);
  let body = bodyOf(kept).trim();
  if (body.length > limit) {
    const sliced = body.slice(0, limit);
    const space = sliced.lastIndexOf(' ');
    body = (space > 0 ? sliced.slice(0, space) : sliced).trimEnd();
  }
  return body ? `${body} ${TITLE_HASHTAG}` : TITLE_HASHTAG;
};

/** ` | ` より前だけをタイトルの本文として扱う。 */
export const publishingTitleLead = (text: string): string => {
  const head = text.split(/\s*[|｜]\s*/)[0] ?? text;
  return head.trim();
};

const titleParts = (project: Project, language: CopyLanguage, lead: string): string[] => {
  const mapJa = lookup(MAP_NAMES_JA, project.lineup.map);
  const agentJa = lookup(AGENT_NAMES_JA, project.lineup.agent);
  const mapKo = lookup(MAP_NAMES_KO, project.lineup.map);
  const agentKo = lookup(AGENT_NAMES_KO, project.lineup.agent);
  const agentAliases = [project.lineup.agent, agentJa, agentKo];
  if (language === 'ja') {
    const jaAgent = mentionedAny(lead, agentAliases) ? '' : agentJa;
    const jaTail = [jaAgent, mentioned(lead, '定点') ? '' : '定点'].filter(Boolean).join('');
    return [mentioned(lead, mapJa) ? '' : mapJa, jaTail];
  }
  if (language === 'ko') {
    return [
      mentioned(lead, mapKo) ? '' : mapKo,
      mentioned(lead, project.lineup.site) ? '' : project.lineup.site,
      mentionedAny(lead, agentAliases) ? '' : agentKo,
      mentionedAny(lead, ['Lineup', 'lineups', '라인업', '定点']) ? '' : '라인업',
    ];
  }
  return [
    mentionedAny(lead, [project.lineup.map, mapJa, mapKo]) ? '' : project.lineup.map,
    mentioned(lead, project.lineup.site) ? '' : project.lineup.site,
    mentionedAny(lead, agentAliases) ? '' : project.lineup.agent,
    mentionedAny(lead, ['Lineup', 'lineups', '라인업', '定点']) ? '' : 'Lineup',
  ];
};

/** 本文のうしろに、言語ごとの従来の末尾と `#valorant` を付ける。英語は `{map} {site} {agent} Lineup #valorant`。 */
export const composePublishingTitle = (project: Project, language: CopyLanguage, lead: string): string => {
  const text = publishingTitleLead(lead);
  return fitTitle(text, titleParts(project, language, text));
};

const CHECK_LEAD: Record<CopyLanguage, string> = {
  ja: 'ClutchVaultでこの定点をチェック：',
  en: 'Check this lineup on ClutchVault:',
  ko: 'ClutchVault에서 이 라인업을 확인하세요:',
};

const SIGNUP_URL = 'https://t.co/fvdgfFPSXb';

export const PUBLISHING_CREDIT: Record<CopyLanguage, string> = {
  ja: 'ClutchVaultの開発者本人が投稿しています。',
  en: "I'm the developer of ClutchVault.",
  ko: 'ClutchVault 개발자가 직접 올리고 있습니다.',
};

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
  const credit = PUBLISHING_CREDIT[language];
  return [summary, '', CHECK_LEAD[language], url, '', about, CLOSED_BETA_NOTE[language], '', credit, '', DESCRIPTION_HASHTAG].join(
    '\n',
  );
};

/** 開発者表記の直後に空行を挟んで `#valorantshorts` を置く。 */
const withDescriptionTag = (text: string, language: CopyLanguage): string => {
  const stripped = text
    .replace(new RegExp(`(?:\\n|\\s)*${DESCRIPTION_HASHTAG}(?=\\s|$)`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const credit = PUBLISHING_CREDIT[language];
  const at = stripped.lastIndexOf(credit);
  if (at < 0) return `${stripped}\n\n${DESCRIPTION_HASHTAG}`;
  const head = stripped.slice(0, at + credit.length).trimEnd();
  const tail = stripped.slice(at + credit.length).trim();
  return tail ? `${head}\n\n${DESCRIPTION_HASHTAG}\n\n${tail}` : `${head}\n\n${DESCRIPTION_HASHTAG}`;
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
  const hashtags = ['valorant lineups', project.lineup.agent, project.lineup.map, 'valorant tips'].join(',');
  return {
    title: {
      ja: composePublishingTitle(project, 'ja', hookJa),
      en: composePublishingTitle(project, 'en', hookEn),
      ko: composePublishingTitle(project, 'ko', hookEn),
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
    pinnedComment: project.publishing.pinnedComment,
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

export const publishingGlossary = (project: Project) => ({
  map: {
    en: project.lineup.map,
    ja: lookup(MAP_NAMES_JA, project.lineup.map),
    ko: lookup(MAP_NAMES_KO, project.lineup.map),
  },
  agent: {
    en: project.lineup.agent,
    ja: lookup(AGENT_NAMES_JA, project.lineup.agent),
    ko: lookup(AGENT_NAMES_KO, project.lineup.agent),
  },
  site: project.lineup.site,
  credits: {
    en: PUBLISHING_CREDIT.en,
    ja: PUBLISHING_CREDIT.ja,
    ko: PUBLISHING_CREDIT.ko,
  },
});

export type PublishingTranslationField = 'title' | 'description';
export type PublishingTranslationLanguage = 'ja' | 'ko';

export type PublishingTranslationDraft = {
  title?: { ja?: string; ko?: string };
  description?: { ja?: string; ko?: string };
};

/** YouTube（海外）を外しても、翻訳または手入力した韓国語の欄は残す。 */
export const publishingShowsKorean = (project: Project): boolean => {
  if (project.guide.exportPresets.includes('yt-global')) return true;
  const fields = ['title', 'description', 'hashtags'] as const;
  return fields.some((field) => {
    if (project.guide.publishingEdited[field]?.ko) return true;
    if (field === 'hashtags') return false;
    return Boolean(project.guide.publishingTranslation?.[field]?.ko);
  });
};

export const publishingTranslationLanguages = (project: Project): PublishingTranslationLanguage[] =>
  publishingShowsKorean(project) ? ['ja', 'ko'] : ['ja'];

const translationCell = (
  project: Project,
  field: PublishingTranslationField,
  language: PublishingTranslationLanguage,
) => project.guide.publishingTranslation?.[field]?.[language];

export const publishingTranslationHandEdited = (
  project: Project,
  field: PublishingTranslationField,
  language: PublishingTranslationLanguage,
): boolean => {
  const current = project.publishing[field][language] ?? '';
  if (!current.trim()) return false;
  const cell = translationCell(project, field, language);
  if (cell) return current !== cell.text;
  return Boolean(project.guide.publishingEdited[field]?.[language]);
};

export const publishingTranslationStale = (
  project: Project,
  field: PublishingTranslationField,
  language: PublishingTranslationLanguage,
): boolean => {
  const cell = translationCell(project, field, language);
  if (!cell) return false;
  return cell.source !== (project.publishing[field].en ?? '');
};

const hashtagsIn = (text: string): string[] => text.match(/#[^\s#]+/g) ?? [];

const keepHashtags = (source: string, translated: string, field: PublishingTranslationField): string => {
  const missing = hashtagsIn(source).filter((tag) => !translated.includes(tag));
  if (missing.length === 0) return translated;
  const joiner = field === 'description' ? '\n' : ' ';
  return `${translated.trim()}${joiner}${missing.join(' ')}`.trim();
};

const keepCredit = (source: string, translated: string, language: CopyLanguage): string => {
  if (!source.includes(PUBLISHING_CREDIT.en)) return translated;
  const next = translated.replaceAll(PUBLISHING_CREDIT.en, PUBLISHING_CREDIT[language]);
  if (next.includes(PUBLISHING_CREDIT[language])) return next;
  return `${next.trim()}\n\n${PUBLISHING_CREDIT[language]}`;
};

const prepareTranslation = (
  project: Project,
  field: PublishingTranslationField,
  language: PublishingTranslationLanguage,
  raw: string,
): string => {
  const source = project.publishing[field].en ?? '';
  if (field === 'title') {
    const shaped = /[|｜]/.test(source) ? composePublishingTitle(project, language, raw) : raw;
    return keepHashtags(source, shaped, field);
  }
  const urls = publishingUrls(project);
  const lead = raw.replaceAll(CHECK_LEAD.en, CHECK_LEAD[language]);
  const credited = keepCredit(source, lead, language);
  return withDescriptionTag(keepHashtags(source, ensureTrackingUrl(credited, language, urls[language]), field), language);
};

export const applyPublishingTranslation = (
  project: Project,
  draft: PublishingTranslationDraft,
  options: { fields: PublishingTranslationField[]; force?: boolean },
): {
  project: Project;
  skipped: Array<{ field: PublishingTranslationField; language: PublishingTranslationLanguage }>;
} => {
  let next = project;
  const skipped: Array<{ field: PublishingTranslationField; language: PublishingTranslationLanguage }> = [];
  for (const field of options.fields) {
    const source = next.publishing[field].en ?? '';
    if (!source.trim()) continue;
    const incoming = draft[field];
    if (!incoming) continue;
    for (const language of publishingTranslationLanguages(next)) {
      const raw = incoming[language];
      if (!raw?.trim()) continue;
      if (!options.force && publishingTranslationHandEdited(next, field, language)) {
        skipped.push({ field, language });
        continue;
      }
      const text = prepareTranslation(next, field, language, raw);
      next = {
        ...next,
        publishing: {
          ...next.publishing,
          [field]: { ...next.publishing[field], [language]: text },
        },
        guide: {
          ...next.guide,
          publishingEdited: {
            ...next.guide.publishingEdited,
            [field]: {
              ...next.guide.publishingEdited[field],
              [language]: true,
            },
          },
          publishingTranslation: {
            ...next.guide.publishingTranslation,
            [field]: {
              ...next.guide.publishingTranslation?.[field],
              [language]: { source, text },
            },
          },
        },
      };
    }
  }
  return { project: next, skipped };
};
