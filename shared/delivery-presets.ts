import { z } from 'zod';

export const deliveryPresetIdSchema = z.enum(['yt-global', 'tt-jp', 'x-jp', 'yt-ja', 'tt-en']);
export type DeliveryPresetId = z.infer<typeof deliveryPresetIdSchema>;

export const experimentPhaseSchema = z.enum(['p1', 'p2', 'p3']);
export type ExperimentPhase = z.infer<typeof experimentPhaseSchema>;

export const experimentVariableSchema = z.enum([
  'map',
  'lang',
  'hook',
  'length',
  'agent',
  'postTime',
]);
export type ExperimentVariable = z.infer<typeof experimentVariableSchema>;

export type VideoLanguage = 'ja' | 'en';
export type CopyLanguage = 'ja' | 'en' | 'ko';
export type BasenameSlot = VideoLanguage | 'x';

export type DeliveryPreset = {
  id: DeliveryPresetId;
  label: string;
  detail: string;
  platform: 'youtube' | 'tiktok' | 'x';
  videoLanguage: VideoLanguage | null;
  copyLanguages: CopyLanguage[];
  outputs: Array<'video' | 'card' | 'thumbnail' | 'xCard' | 'txt'>;
  defaultOn: boolean;
  utmSource: 'youtube' | 'tiktok' | 'x';
  utmMedium: 'short' | 'card';
};

export const CTA_TEXT = {
  en: 'Save this lineup →\n[Clutch Vault]',
  ja: 'この定点を\n[Clutch Vaultに保存]',
} as const;

export const CLUTCHVAULT_ORIGIN = {
  ja: 'https://clutchvault.app/',
  en: 'https://clutchvault.app/en/',
} as const;

/** 最初の9定点（18本）は施策を分けない。動画の識別は utm_content に置く。 */
export const FIRST_9_LINEUPS_CAMPAIGN = 'first_9_lineups';

export const DELIVERY_PRESETS: Record<DeliveryPresetId, DeliveryPreset> = {
  'yt-global': {
    id: 'yt-global',
    label: 'YouTube（英語）',
    detail: '英語の動画・完成カード・サムネイル・日英韓の投稿文',
    platform: 'youtube',
    videoLanguage: 'en',
    copyLanguages: ['en', 'ja', 'ko'],
    outputs: ['video', 'card', 'thumbnail', 'txt'],
    defaultOn: true,
    utmSource: 'youtube',
    utmMedium: 'short',
  },
  'tt-jp': {
    id: 'tt-jp',
    label: 'TikTok（日本語）',
    detail: '日本語の動画・完成カード・サムネイル・投稿文',
    platform: 'tiktok',
    videoLanguage: 'ja',
    copyLanguages: ['ja'],
    outputs: ['video', 'card', 'thumbnail', 'txt'],
    defaultOn: true,
    utmSource: 'tiktok',
    utmMedium: 'short',
  },
  'x-jp': {
    id: 'x-jp',
    label: 'X（日本語カード）',
    detail: 'X用カード・完成カード・本文と返信文',
    platform: 'x',
    videoLanguage: null,
    copyLanguages: ['ja'],
    outputs: ['xCard', 'card', 'txt'],
    defaultOn: true,
    utmSource: 'x',
    utmMedium: 'card',
  },
  'yt-ja': {
    id: 'yt-ja',
    label: 'YouTube（日本語）',
    detail: '日本語の動画。初期はオフ',
    platform: 'youtube',
    videoLanguage: 'ja',
    copyLanguages: ['ja'],
    outputs: ['video', 'card', 'thumbnail', 'txt'],
    defaultOn: false,
    utmSource: 'youtube',
    utmMedium: 'short',
  },
  'tt-en': {
    id: 'tt-en',
    label: 'TikTok（英語）',
    detail: '英語の動画。初期はオフ',
    platform: 'tiktok',
    videoLanguage: 'en',
    copyLanguages: ['en'],
    outputs: ['video', 'card', 'thumbnail', 'txt'],
    defaultOn: false,
    utmSource: 'tiktok',
    utmMedium: 'short',
  },
};

export const DELIVERY_PRESET_ORDER: DeliveryPresetId[] = [
  'yt-global',
  'tt-jp',
  'x-jp',
  'yt-ja',
  'tt-en',
];

export const DEFAULT_EXPORT_PRESETS: DeliveryPresetId[] = DELIVERY_PRESET_ORDER.filter(
  (id) => DELIVERY_PRESETS[id].defaultOn,
);

const PLATFORM_TO_DEFAULT_PRESET: Record<DeliveryPreset['platform'], DeliveryPresetId> = {
  youtube: 'yt-global',
  tiktok: 'tt-jp',
  x: 'x-jp',
};

export const presetsFromPlatforms = (
  platforms: Array<'youtube' | 'tiktok' | 'x'>,
): DeliveryPresetId[] =>
  DELIVERY_PRESET_ORDER.filter(
    (id) => DELIVERY_PRESETS[id].defaultOn && platforms.includes(DELIVERY_PRESETS[id].platform),
  );

export const inferPreset = (
  platform: 'youtube' | 'tiktok' | 'x',
  lang: 'ja' | 'en',
): DeliveryPresetId => {
  if (platform === 'x') return 'x-jp';
  if (platform === 'youtube') return lang === 'ja' ? 'yt-ja' : 'yt-global';
  return lang === 'en' ? 'tt-en' : 'tt-jp';
};

export const presetById = (id: string): DeliveryPreset | undefined =>
  deliveryPresetIdSchema.safeParse(id).success
    ? DELIVERY_PRESETS[id as DeliveryPresetId]
    : undefined;

export const videoLanguagesFor = (presets: DeliveryPresetId[]): VideoLanguage[] => {
  const languages: VideoLanguage[] = [];
  for (const id of DELIVERY_PRESET_ORDER) {
    if (!presets.includes(id)) continue;
    const language = DELIVERY_PRESETS[id].videoLanguage;
    if (language && !languages.includes(language)) languages.push(language);
  }
  return languages;
};

export const platformsFor = (presets: DeliveryPresetId[]): Array<'youtube' | 'tiktok' | 'x'> => {
  const platforms: Array<'youtube' | 'tiktok' | 'x'> = [];
  for (const id of presets) {
    const platform = DELIVERY_PRESETS[id].platform;
    if (!platforms.includes(platform)) platforms.push(platform);
  }
  return platforms;
};

/** 同じ言語の動画は1本。CTA は英語なら yt-global、日本語なら tt-jp の文言。 */
export const ctaTextForLanguage = (language: VideoLanguage): string => CTA_TEXT[language];

export const ctaLanguageForPreset = (id: DeliveryPresetId): VideoLanguage | null =>
  DELIVERY_PRESETS[id].videoLanguage;

export const basenameSlotFor = (id: DeliveryPresetId): BasenameSlot =>
  DELIVERY_PRESETS[id].videoLanguage ?? 'x';

export const trackingOriginFor = (language: CopyLanguage): string =>
  CLUTCHVAULT_ORIGIN[language === 'ja' ? 'ja' : 'en'];

/** 呼び出しごとに新しい正規表現を返す。共有すると lastIndex がずれる。 */
export const clutchVaultUrlPattern = (): RegExp =>
  /https?:\/\/(?:(?:www|gg)\.)?clutchvault\.app[^\s)]*/gi;

export const hasClutchVaultUrl = (text: string): boolean =>
  /https?:\/\/(?:(?:www|gg)\.)?clutchvault\.app/i.test(text);

export const isClutchVaultUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && /^(?:www\.|gg\.)?clutchvault\.app$/i.test(url.hostname);
  } catch {
    return false;
  }
};

export const buildTrackingUrl = (input: {
  presetId: DeliveryPresetId;
  basename: string;
  language?: CopyLanguage;
  campaign?: string;
  /** 定点メモなど。パスと utm 以外のクエリを残し、計測パラメータだけ付け直す。 */
  base?: string;
  /**
   * 説明文の初期URLでは false。utm_source と utm_medium だけ付ける。
   * 書き出し・計測用URLでは true のまま、utm_campaign と utm_content も付ける。
   */
  identity?: boolean;
}): string => {
  const preset = DELIVERY_PRESETS[input.presetId];
  const language = input.language ?? (preset.videoLanguage === 'en' ? 'en' : 'ja');
  const memo = input.base?.trim() ?? '';
  const url = new URL(memo && isClutchVaultUrl(memo) ? memo : trackingOriginFor(language));
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  }
  url.searchParams.set('utm_source', preset.utmSource);
  url.searchParams.set('utm_medium', preset.utmMedium);
  if (input.identity !== false) {
    url.searchParams.set('utm_campaign', input.campaign?.trim() || FIRST_9_LINEUPS_CAMPAIGN);
    url.searchParams.set('utm_content', input.basename);
  }
  return url.toString();
};

export type TrackingMeta = {
  url: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
};

export const trackingMetaFromUrl = (url: string): TrackingMeta | null => {
  try {
    const parsed = new URL(url);
    const source = parsed.searchParams.get('utm_source');
    const medium = parsed.searchParams.get('utm_medium');
    const campaign = parsed.searchParams.get('utm_campaign');
    const content = parsed.searchParams.get('utm_content');
    if (!source || !medium || !campaign || !content) return null;
    return { url, utm_source: source, utm_medium: medium, utm_campaign: campaign, utm_content: content };
  } catch {
    return null;
  }
};

export const campaignDate = (plannedPostDate: string | undefined, now = new Date()): string => {
  const source = plannedPostDate ?? now.toISOString();
  return source.slice(0, 10).replaceAll('-', '');
};

export const provisionalBasename = (input: {
  plannedPostDate?: string;
  map: string;
  agent: string;
  slot: BasenameSlot;
  now?: Date;
}): string =>
  `${campaignDate(input.plannedPostDate, input.now)}_${input.map}_${input.agent}_std_${input.slot}_v1`;

export const presetOutputsLabel = (id: DeliveryPresetId): string => {
  const labels: Record<DeliveryPreset['outputs'][number], string> = {
    video: '動画',
    card: '完成カード',
    thumbnail: 'サムネイル',
    xCard: 'X用カード',
    txt: '投稿文',
  };
  return DELIVERY_PRESETS[id].outputs.map((output) => labels[output]).join('・');
};

export const defaultPresetForPlatform = (
  platform: 'youtube' | 'tiktok' | 'x',
): DeliveryPresetId => PLATFORM_TO_DEFAULT_PRESET[platform];

export type CopyBlock = {
  heading?: string;
  language: CopyLanguage;
  title: string;
  description: string;
  hashtags: string;
  url: string;
  credit?: string;
};

const section = (block: CopyBlock): string => {
  const description = block.description.trim();
  const hasUrl = hasClutchVaultUrl(description);
  const lines = [
    ...(block.heading ? [block.heading, ''] : []),
    `[${block.language}]`,
    block.title.trim(),
    '',
    hasUrl || !block.url.trim() ? description : `${description}\n${block.url.trim()}`,
    '',
    block.hashtags.trim(),
  ];
  if (block.credit?.trim()) lines.push('', block.credit.trim());
  return lines.join('\n');
};

export const formatPresetCopy = (blocks: CopyBlock[]): string =>
  blocks.map((block) => section(block)).join('\n\n');

export const replaceClutchVaultUrl = (text: string, tracked: string): string =>
  text.replace(clutchVaultUrlPattern(), () => tracked);

export const EXPERIMENT_VARIABLE_LABELS: Record<ExperimentVariable, string> = {
  map: 'マップ',
  lang: '言語',
  hook: 'フック',
  length: '尺',
  agent: 'エージェント',
  postTime: '投稿時刻',
};

export const EXPERIMENT_PHASE_LABELS: Record<ExperimentPhase, string> = {
  p1: 'P1',
  p2: 'P2',
  p3: 'P3',
};
