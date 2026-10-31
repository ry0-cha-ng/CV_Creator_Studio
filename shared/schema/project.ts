import { z } from 'zod';
import { bgmPlacementSchema, platformSchema } from './audio';
import {
  CTA_TEXT,
  DEFAULT_EXPORT_PRESETS,
  deliveryPresetIdSchema,
  experimentPhaseSchema,
  experimentVariableSchema,
  inferPreset,
  presetsFromPlatforms,
} from '../delivery-presets';
import {
  ctaTypeSchema,
  lineupCategorySchema,
  openingTypeSchema,
  structureTypeSchema,
} from './analytics';
import { sceneKeySchema } from './project-keys';
import { refreshLegacyCta } from '../s7-cta';
import { timelineSchema } from './timeline';
import { ctaDesignSchema } from '../cta-design';
import { s4CtaPurposeSchema, s4CtaTextSchema, s4LikeCtaSchema } from '../s4-cta';
import { DEFAULT_SCENE_ORDER, sceneOrderSchema } from '../video-structure';

export const languageSchema = z.enum(['ja', 'en']);
export type Language = z.infer<typeof languageSchema>;

export const assetRoleSchema = z.enum(['main', 'demo', 'hook']);
export type AssetRole = z.infer<typeof assetRoleSchema>;

export const inheritItemSchema = z.enum([
  'agent',
  'bgm',
  'effects',
  'templateParams',
  'cardLayout',
  'cardAimZoom',
  'hookRotation',
  'experiment',
  'thumbnail',
]);
export type InheritItem = z.infer<typeof inheritItemSchema>;

export const hookPatternSchema = z.enum([
  'result',
  'number',
  'question',
  'scarcity',
  'score',
  'versatile',
  'newmap',
  'custom',
]);
export type HookPattern = z.infer<typeof hookPatternSchema>;

const localizedTextSchema = z.object({
  ja: z.string(),
  en: z.string(),
});

const publishingTextSchema = localizedTextSchema.extend({
  ko: z.string().optional(),
});

export const lineupSchema = z.object({
  id: z.string(),
  map: z.string(),
  site: z.enum(['A', 'B', 'C', 'Mid']),
  side: z.enum(['attack', 'defense']),
  agent: z.string(),
  ability: z.string(),
  throwType: localizedTextSchema,
  charge: z.number().int().min(0).max(3).optional(),
  bounce: z.number().int().min(0).max(2).optional(),
  crouch: z.boolean().default(false),
  standDescription: localizedTextSchema,
  aimDescription: localizedTextSchema,
  externalId: z.string().optional(),
});

export const assetSchema = z.object({
  id: z.string(),
  type: z.enum(['video', 'image', 'font', 'brand']),
  path: z.string(),
  proxyPath: z.string().optional(),
  meta: z
    .object({
      duration: z.number().positive().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      fps: z.number().positive().optional(),
      codec: z.string().optional(),
    })
    .default({}),
  loudnessEnvelope: z
    .array(
      z.object({
        time: z.number().min(0),
        level: z.number().min(0).max(1),
      }),
    )
    .default([]),
  tags: z.array(z.string()).default([]),
  role: assetRoleSchema.optional(),
});

export const clipSchema = z
  .object({
    id: z.string(),
    assetId: z.string(),
    in: z.number().min(0),
    out: z.number().positive(),
  })
  .refine((clip) => clip.out > clip.in, {
    message: '終了位置は開始位置より後にしてください',
    path: ['out'],
  });

export const stillSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  frame: z.number().min(0),
  role: z.enum(['stand', 'aim', 'impact', 'result']),
  path: z.string(),
  /** カード枠へ cover するときの基準。0 が上・左、1 が下・右。未指定は中央。 */
  focus: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .optional(),
});

export { sceneKeySchema } from './project-keys';

export const sceneSchema = z.object({
  sceneKey: sceneKeySchema,
  clipId: z.string().optional(),
  layout916: z.enum(['center-crop', 'blur-fit', 'focus', 'split']).default('blur-fit'),
  cropCenterX: z.number().min(0).max(1).default(0.5),
  /** フォーカスの切り抜き縦位置。未指定は中央。 */
  cropCenterY: z.number().min(0).max(1).optional(),
  /** フォーカスの切り抜き拡大率。未指定は 1（高さいっぱい）。 */
  cropZoom: z.number().min(1).max(1.5).optional(),
  volume: z.number().min(0).max(1).default(0.1),
  bgmVolume: z.number().min(0).max(1).optional(),
  zoom: z
    .object({
      enabled: z.boolean(),
      from: z.number().min(1),
      to: z.number().min(1),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .optional(),
  freeze: z
    .object({
      enabled: z.boolean(),
      at: z.number().min(0),
      duration: z.number().min(0),
    })
    .optional(),
  aimMarker: z
    .object({
      enabled: z.boolean(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      size: z.number().min(0.3).max(3).default(1),
      /** 切り抜き開始からマーカーを出すまでの秒。0 は最初から。 */
      at: z.number().min(0).default(0),
    })
    .optional(),
  /** 動画フレーム上の拡大枠。未指定はオフ。 */
  aimZoom: z
    .object({
      enabled: z.boolean(),
      zoom: z.union([z.literal(3), z.literal(4), z.literal(6)]),
      size: z.enum(['s', 'm', 'l']),
      /** 拡大画像の左上。動画フレームの幅・高さに対する割合。 */
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      guide: z.boolean(),
    })
    .optional(),
});

export const captionSchema = z.object({
  id: z.string(),
  sceneKey: sceneKeySchema,
  text: localizedTextSchema,
  cardText: localizedTextSchema.optional(),
  xText: localizedTextSchema.optional(),
  thumbText: localizedTextSchema.optional(),
  styleId: z.enum(['cap.hook', 'cap.step', 'cap.throw', 'cta']),
  hidden: z.boolean().optional(),
});

export type CaptionSurface = 'video' | 'card' | 'x' | 'thumb';

export const captionTextFor = (
  caption: z.infer<typeof captionSchema> | undefined,
  language: Language,
  surface: CaptionSurface = 'video',
): string => {
  if (!caption) return '';
  if (surface === 'card' && caption.cardText?.[language]) return caption.cardText[language];
  if (surface === 'x' && caption.xText?.[language]) return caption.xText[language];
  if (surface === 'thumb' && caption.thumbText?.[language]) return caption.thumbText[language];
  return caption.text[language];
};

export const cardLayoutSchema = z.enum(['aim', 'stack']);
export type CardLayout = z.infer<typeof cardLayoutSchema>;

export const ANNOTATION_STYLES = ['standard', 'strong', 'strong-dim'] as const;
export type AnnotationStyle = (typeof ANNOTATION_STYLES)[number];

/** 未指定・知らない値は標準。前回の emphasis は強調として読む。 */
export const annotationStyleSchema = z.preprocess((value: unknown): AnnotationStyle => {
  if (value === 'standard' || value === 'strong' || value === 'strong-dim') return value;
  if (value === 'emphasis') return 'strong';
  return 'standard';
}, z.enum(ANNOTATION_STYLES));

export const cardAimZoomSchema = z.object({
  enabled: z.boolean(),
  style: z.enum(['corner', 'loupe', 'split']),
  position: z.enum(['auto', 'tl', 'tr', 'bl', 'br', 'left', 'right']),
  zoom: z.union([z.literal(3), z.literal(4), z.literal(6)]),
  size: z.enum(['s', 'm', 'l']).optional(),
  guide: z.boolean(),
  center: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .optional(),
  note: z
    .object({
      ja: z.string(),
      en: z.string(),
    })
    .optional(),
});
export type CardAimZoom = z.infer<typeof cardAimZoomSchema>;
export type SceneAimZoom = NonNullable<Scene['aimZoom']>;

/** 新規プロジェクトの初期値。未保存の古いプロジェクトはフィールドなし＝オフ。 */
export const defaultCardAimZoom = (): CardAimZoom => ({
  enabled: true,
  style: 'corner',
  position: 'auto',
  zoom: 4,
  guide: true,
});

/** X投稿文の入力。生成済み本文は持たず、ここから組み立て直す。 */
export const xPostSchema = z.object({
  ja: z.string().default(''),
  en: z.string().default(''),
  jaEdited: z.boolean().default(false),
  enEdited: z.boolean().default(false),
  /** 本文に使う動画URL。未編集のときは公開済み投稿のURLを表示する。 */
  videoUrl: z.string().default(''),
  videoUrlEdited: z.boolean().default(false),
  /** 定点URLの未確定入力。空のときは memoUrl を表示する。 */
  spotDraft: z.string().default(''),
});

export const emptyXPost = (): z.infer<typeof xPostSchema> => ({
  ja: '',
  en: '',
  jaEdited: false,
  enEdited: false,
  videoUrl: '',
  videoUrlEdited: false,
  spotDraft: '',
});

export const publishingSchema = z
  .object({
    title: publishingTextSchema,
    description: publishingTextSchema,
    hashtags: publishingTextSchema,
    links: z.partialRecord(deliveryPresetIdSchema, z.string()).default({}),
    /** この動画に紐づける ClutchVault の定点メモ。空ならトップページの計測URL。 */
    memoUrl: z.string().default(''),
    /** YouTubeの固定コメント。投稿APIには送らず、コピーして自分で固定する。 */
    pinnedComment: z.string().default(''),
    xPost: xPostSchema.default(emptyXPost),
  })
  .default(() => ({
    title: { ja: '', en: '' },
    description: { ja: '', en: '' },
    hashtags: { ja: '', en: '' },
    links: {},
    memoUrl: '',
    pinnedComment: '',
    xPost: emptyXPost(),
  }));

export const postMetricsSchema = z.object({
  capturedAt: z.string(),
  views: z.number().optional(),
  avgViewPct: z.number().optional(),
  retention3s: z.number().optional(),
  likes: z.number().optional(),
  saves: z.number().optional(),
  shares: z.number().optional(),
  bookmarks: z.number().optional(),
  profileVisits: z.number().optional(),
  linkClicks: z.number().optional(),
  subscribersGained: z.number().optional(),
  cvSaves: z.number().optional(),
});

export const postLogSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  lang: languageSchema,
  url: z.string().default(''),
  postedAt: z.string().default(''),
  preset: deliveryPresetIdSchema,
  metrics: postMetricsSchema.optional(),
  publicationState: z.enum(['private', 'unlisted', 'scheduled', 'public']).optional(),
  scheduledPublishAt: z.string().optional(),
  timezone: z.string().optional(),
});

const editedSideSchema = z
  .object({
    ja: z.boolean().optional(),
    en: z.boolean().optional(),
    ko: z.boolean().optional(),
  })
  .optional();

const translationCellSchema = z.object({
  source: z.string(),
  text: z.string(),
});

const translationSideSchema = z
  .object({
    ja: translationCellSchema.optional(),
    ko: translationCellSchema.optional(),
  })
  .optional();

export const guideSchema = z.object({
  mode: z.enum(['guide', 'editor']).default('guide'),
  lastStep: z.number().int().min(0).max(10).default(1),
  confirmedSteps: z.array(z.enum(['sound', 'review'])).default([]),
  publishingEdited: z
    .object({
      title: editedSideSchema,
      description: editedSideSchema,
      hashtags: editedSideSchema,
    })
    .default({}),
  /** 直近の翻訳と、そのときの英語原稿。手修正と再翻訳の判定に使う。 */
  publishingTranslation: z
    .object({
      title: translationSideSchema,
      description: translationSideSchema,
    })
    .default({}),
  previousHookPattern: hookPatternSchema.optional(),
  exportPresets: z.array(deliveryPresetIdSchema).default(() => [...DEFAULT_EXPORT_PRESETS]),
  xReplyVideo: z.enum(['youtube', 'tiktok']).default('youtube'),
  exportWithoutBgm: z.boolean().default(false),
  /** その言語の動画プリセットがオフのとき、サムネイル JPG だけ書き出す。 */
  thumbnailOnly: z.array(z.enum(['ja', 'en'])).default([]),
  /** テロップ手順の案出しに渡す、動画の特徴。 */
  wordingBrief: z.string().default(''),
  /** テロップ手順の案出しに渡す、ほしい雰囲気。 */
  wordingTone: z.string().default(''),
  lastExport: z
    .object({
      at: z.string(),
      projectUpdatedAt: z.string(),
      presets: z.array(deliveryPresetIdSchema),
      contentStamp: z.string(),
      outputDir: z.string().optional(),
    })
    .optional(),
});

export const experimentSchema = z.object({
  phase: experimentPhaseSchema,
  testVariables: z.array(experimentVariableSchema).default([]),
  hypothesis: z.string().optional(),
  series: z.string(),
  utmCampaign: z.string().default('first_9_lineups'),
});

export const defaultExperiment = (): z.infer<typeof experimentSchema> => ({
  phase: 'p1',
  testVariables: [],
  series: 'phoenix-lineups',
  utmCampaign: 'first_9_lineups',
});

export const templateParamsSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fps: z.union([z.literal(30), z.literal(60)]),
  demoDuration: z.number().min(6),
  sceneOrder: sceneOrderSchema.default(() => [...DEFAULT_SCENE_ORDER]),
  sceneDurations: z
    .partialRecord(sceneKeySchema, z.number().min(0.3).max(300))
    .default({}),
  sceneDurationOffsets: z
    .partialRecord(sceneKeySchema, z.number().min(-1).max(1))
    .default({}),
  /** 未設定のプロジェクトは構成から決める。標準構成は既存のS7帯のまま。 */
  ctaDesign: ctaDesignSchema.optional(),
  /** 映像下ブロックの文言。未設定のときは短尺CTAの定型文。S7のCTA本文は変えない。 */
  s4Cta: s4CtaTextSchema.optional(),
  /** 未設定の既存プロジェクトは ClutchVault 案内。高評価は明示したときだけ。 */
  s4CtaPurpose: s4CtaPurposeSchema.optional(),
  /** 高評価CTAの文言と動き。未設定のときは定型文・動きON。CV案内の文言とは別に持つ。 */
  s4LikeCta: s4LikeCtaSchema.optional(),
});

export const projectAnalyticsSchema = z
  .object({
    lineupCategory: lineupCategorySchema.optional(),
    difficulty: z.enum(['easy', 'normal', 'hard']).optional(),
    productionStartedAt: z.string().optional(),
    productionFinishedAt: z.string().optional(),
    productionMinutes: z.number().optional(),
    exportMinutes: z.number().optional(),
    openingType: openingTypeSchema.optional(),
    structureType: structureTypeSchema.optional(),
    ctaType: ctaTypeSchema.optional(),
    series: z.string().optional(),
    durationLabel: z.string().optional(),
  })
  .default({});

export const experimentRefSchema = z.object({
  experimentId: z.string(),
  arm: z.enum(['control', 'variant']),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(7),
  id: z.string(),
  title: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  lineup: lineupSchema,
  assets: z.array(assetSchema),
  clips: z.array(clipSchema),
  stills: z.array(stillSchema).default([]),
  scenes: z.array(sceneSchema),
  captions: z.array(captionSchema),
  templateId: z.literal('t-std').default('t-std'),
  structureTemplateId: z.string().optional(),
  timelineEdited: z.boolean().default(false),
  timeline: timelineSchema.nullable().default(null),
  timelineMix: z
    .object({
      hideCaptions: z.boolean().default(false),
      hideVideo: z.boolean().default(false),
      muteGame: z.boolean().default(false),
      muteBgm: z.boolean().default(false),
      muteEffects: z.boolean().default(false),
    })
    .default({
      hideCaptions: false,
      hideVideo: false,
      muteGame: false,
      muteBgm: false,
      muteEffects: false,
    }),
  templateParams: templateParamsSchema,
  hookPattern: hookPatternSchema.default('custom'),
  englishCaptionPreset: z.enum(['en-concise', 'standard']).default('en-concise'),
  experiment: experimentSchema.default(defaultExperiment),
  experimentRef: experimentRefSchema.optional(),
  appliedInsightIds: z.array(z.string()).default([]),
  appliedDecisionId: z.string().optional(),
  skippedCandidateIds: z.array(z.string()).default([]),
  analytics: projectAnalyticsSchema,
  cardLayout: cardLayoutSchema.default('stack'),
  /** 動画とカードで共通の注釈の強さ。未指定は標準。 */
  annotationStyle: annotationStyleSchema,
  cardAimZoom: cardAimZoomSchema.optional(),
  /** カード上の照準の丸。未指定のあいだは動画の合わせ位置を使う。 */
  cardAimMarker: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .optional(),
  cardStills: z.object({
    aim: z.string().optional(),
    stand: z.string().optional(),
    result: z.string().optional(),
  }),
  /** 未設定のときはフックの先頭をサムネイル映像にする。classic 用。 */
  thumbnailFrame: z
    .object({
      assetId: z.string(),
      sourceTime: z.number().min(0),
    })
    .optional(),
  /**
   * サムネイルの配置。未設定の既存プロジェクトは classic。
   * 新規は focus。frame が無い focus は 03 発動イメージに追従する。
   */
  thumbnail: z
    .object({
      layout: z.enum(['classic', 'focus']),
      frame: z
        .object({
          assetId: z.string().min(1),
          timeSec: z.number().min(0),
        })
        .optional(),
      focus: z
        .object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        })
        .optional(),
      zoom: z.number().min(1).max(1.5).optional(),
    })
    .optional(),
  audio: z
    .object({
      bgm: bgmPlacementSchema.nullable(),
    })
    .default({ bgm: null }),
  publishing: publishingSchema,
  posts: z.array(postLogSchema).default([]),
  plannedPostDate: z.string().optional(),
  status: z.enum(['editing', 'exported', 'posted']).default('editing'),
  inheritedFrom: z
    .object({
      projectId: z.string(),
      items: z.array(inheritItemSchema),
    })
    .optional(),
  guide: guideSchema,
});

export type Project = z.infer<typeof projectSchema>;
export type Lineup = z.infer<typeof lineupSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Caption = z.infer<typeof captionSchema>;

export const defaultDemoCaption = (): Caption => ({
  id: 'demo',
  sceneKey: 'demo',
  text: { ja: '実戦で使うと ↓', en: 'IN A REAL MATCH ↓' },
  styleId: 'cap.step',
});

export const defaultCtaCaption = (): Caption => ({
  id: 'cta',
  sceneKey: 'loop',
  text: { ja: CTA_TEXT.ja, en: CTA_TEXT.en },
  styleId: 'cta',
});

export type { SceneKey } from './project-keys';

const editedFlag = (value: unknown): true | undefined =>
  typeof value === 'string' && value.trim() ? true : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withCtaCaption = (captions: unknown): unknown => {
  if (!Array.isArray(captions)) return captions;
  if (captions.some((item) => isRecord(item) && item.id === 'cta')) return captions;
  return [...captions, defaultCtaCaption()];
};

const upgradeProjectV4 = (input: Record<string, unknown>): Record<string, unknown> => {
  const experiment = isRecord(input.experiment) ? input.experiment : {};
  const series = typeof experiment.series === 'string' ? experiment.series : 'phoenix-lineups';
  const analytics = isRecord(input.analytics) ? input.analytics : {};
  return {
    ...input,
    schemaVersion: 7,
    analytics: { series, ...analytics },
    appliedInsightIds: Array.isArray(input.appliedInsightIds) ? input.appliedInsightIds : [],
    skippedCandidateIds: Array.isArray(input.skippedCandidateIds) ? input.skippedCandidateIds : [],
  };
};

const upgradeProjectV3 = (input: Record<string, unknown>): Record<string, unknown> => {
  const guide = isRecord(input.guide) ? input.guide : {};
  const platforms = Array.isArray(guide.exportPlatforms)
    ? guide.exportPlatforms.filter(
        (platform): platform is 'youtube' | 'tiktok' | 'x' =>
          platform === 'youtube' || platform === 'tiktok' || platform === 'x',
      )
    : (['youtube', 'tiktok', 'x'] as const);
  const lastExport = isRecord(guide.lastExport) ? guide.lastExport : undefined;
  const lastPlatforms = Array.isArray(lastExport?.platforms)
    ? lastExport.platforms.filter(
        (platform): platform is 'youtube' | 'tiktok' | 'x' =>
          platform === 'youtube' || platform === 'tiktok' || platform === 'x',
      )
    : platforms;
  const { exportPlatforms: _exportPlatforms, ...guideRest } = guide;
  const posts = Array.isArray(input.posts)
    ? input.posts.map((post) => {
        if (!isRecord(post) || post.preset) return post;
        const platform = post.platform === 'tiktok' || post.platform === 'x' ? post.platform : 'youtube';
        const lang = post.lang === 'en' ? 'en' : 'ja';
        return { ...post, preset: inferPreset(platform, lang) };
      })
    : input.posts;
  return {
    ...input,
    schemaVersion: 4,
    posts,
    experiment: isRecord(input.experiment) ? input.experiment : defaultExperiment(),
    englishCaptionPreset: input.englishCaptionPreset ?? 'en-concise',
    captions: withCtaCaption(input.captions),
    guide: {
      ...guideRest,
      exportPresets: Array.isArray(guide.exportPresets)
        ? guide.exportPresets
        : presetsFromPlatforms([...platforms]),
      xReplyVideo: guide.xReplyVideo === 'tiktok' ? 'tiktok' : 'youtube',
      lastExport: lastExport
        ? {
            at: lastExport.at,
            projectUpdatedAt: lastExport.projectUpdatedAt,
            presets: Array.isArray(lastExport.presets)
              ? lastExport.presets
              : presetsFromPlatforms([...lastPlatforms]),
            contentStamp: lastExport.contentStamp,
            outputDir: lastExport.outputDir,
          }
        : undefined,
    },
  };
};

const upgradeLegacyProject = (input: Record<string, unknown>): Record<string, unknown> => {
  let videoIndex = 0;
  const assets = Array.isArray(input.assets)
    ? input.assets.map((asset) => {
        if (!isRecord(asset) || asset.type !== 'video' || asset.role) return asset;
        videoIndex += 1;
        if (videoIndex === 1) return { ...asset, role: 'main' };
        if (videoIndex === 2) return { ...asset, role: 'demo' };
        return asset;
      })
    : input.assets;
  const publishing = isRecord(input.publishing) ? input.publishing : {};
  const text = (field: string): { ja: unknown; en: unknown } => {
    const value = publishing[field];
    if (!isRecord(value)) return { ja: '', en: '' };
    return { ja: value.ja, en: value.en };
  };
  const title = text('title');
  const description = text('description');
  const hashtags = text('hashtags');
  return upgradeProjectV3({
    ...input,
    schemaVersion: 3,
    assets,
    audio: isRecord(input.audio) ? input.audio : { bgm: null },
    guide: {
      mode: 'editor',
      lastStep: 1,
      confirmedSteps: [],
      publishingEdited: {
        title: { ja: editedFlag(title.ja), en: editedFlag(title.en) },
        description: { ja: editedFlag(description.ja), en: editedFlag(description.en) },
        hashtags: { ja: editedFlag(hashtags.ja), en: editedFlag(hashtags.en) },
      },
      exportPlatforms: ['youtube', 'tiktok', 'x'],
      exportWithoutBgm: false,
    },
  });
};

const clampAimMarkerSize = (size: number): number => Math.min(3, Math.max(0.3, size));

const asLocalizedText = (value: unknown): { ja: string; en: string } | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const ja = (value as { ja?: unknown }).ja;
  const en = (value as { en?: unknown }).en;
  if (typeof ja !== 'string' || typeof en !== 'string') return undefined;
  return { ja, en };
};

const restoreCaptionSurfaces = (parsed: Project, source: unknown): Project => {
  if (typeof source !== 'object' || source === null) return parsed;
  const captions = (source as { captions?: unknown }).captions;
  if (!Array.isArray(captions)) return parsed;
  const byId = new Map<string, { text?: unknown; cardText?: unknown; xText?: unknown; thumbText?: unknown }>();
  for (const item of captions) {
    if (typeof item !== 'object' || item === null) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string') {
      byId.set(id, item as { text?: unknown; cardText?: unknown; xText?: unknown; thumbText?: unknown });
    }
  }
  return {
    ...parsed,
    captions: parsed.captions.map((caption) => {
      const raw = byId.get(caption.id);
      if (!raw) return caption;
      const text = asLocalizedText(raw.text) ?? caption.text;
      const cardText = asLocalizedText(raw.cardText) ?? caption.cardText;
      const xText = asLocalizedText(raw.xText) ?? caption.xText;
      const thumbText = asLocalizedText(raw.thumbText) ?? caption.thumbText;
      return { ...caption, text, cardText, xText, thumbText };
    }),
  };
};

const restoreAimMarkerSizes = (parsed: Project, source: unknown): Project => {
  if (typeof source !== 'object' || source === null) return parsed;
  const scenes = (source as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes)) return parsed;
  const sizes = new Map<string, number>();
  const appearAt = new Map<string, number>();
  for (const scene of scenes) {
    if (typeof scene !== 'object' || scene === null) continue;
    const key = (scene as { sceneKey?: unknown }).sceneKey;
    const marker = (scene as { aimMarker?: { size?: unknown; at?: unknown } }).aimMarker;
    if (typeof key !== 'string' || !marker) continue;
    if (typeof marker.size === 'number' && Number.isFinite(marker.size)) {
      sizes.set(key, clampAimMarkerSize(marker.size));
    }
    if (typeof marker.at === 'number' && Number.isFinite(marker.at)) {
      appearAt.set(key, Math.max(0, marker.at));
    }
  }
  return {
    ...parsed,
    scenes: parsed.scenes.map((scene) => {
      if (!scene.aimMarker) return scene;
      const size = sizes.get(scene.sceneKey) ?? scene.aimMarker.size ?? 1;
      const at = appearAt.get(scene.sceneKey) ?? scene.aimMarker.at ?? 0;
      if (scene.aimMarker.size === size && scene.aimMarker.at === at) return scene;
      return { ...scene, aimMarker: { ...scene.aimMarker, size, at } };
    }),
  };
};

/** 前回の cardAimZoom.weight を、プロジェクト共通の annotationStyle へ読み替える。 */
const hoistAnnotationStyle = (input: Record<string, unknown>): Record<string, unknown> => {
  if (input.annotationStyle != null) return input;
  const zoom = input.cardAimZoom;
  if (!isRecord(zoom) || zoom.weight == null) return input;
  return { ...input, annotationStyle: zoom.weight };
};

const clampUnit = (value: unknown, min: number, max: number): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
};

/** 壊れた thumbnail は落とさず、layout 不明は classic、数値は範囲へ収める。無いときは足さない。 */
const normalizeThumbnail = (input: Record<string, unknown>): Record<string, unknown> => {
  if (!('thumbnail' in input) || input.thumbnail == null) return input;
  const raw = input.thumbnail;
  if (!isRecord(raw)) {
    const { thumbnail: _thumbnail, ...rest } = input;
    return rest;
  }
  const layout = raw.layout === 'focus' ? 'focus' : 'classic';
  const frameRaw = isRecord(raw.frame) ? raw.frame : undefined;
  const timeSec = clampUnit(frameRaw?.timeSec, 0, Number.POSITIVE_INFINITY);
  const frame =
    frameRaw && typeof frameRaw.assetId === 'string' && frameRaw.assetId.trim() && timeSec !== undefined
      ? { assetId: frameRaw.assetId, timeSec }
      : undefined;
  const focusRaw = isRecord(raw.focus) ? raw.focus : undefined;
  const focusX = clampUnit(focusRaw?.x, 0, 1);
  const focusY = clampUnit(focusRaw?.y, 0, 1);
  const focus = focusX !== undefined && focusY !== undefined ? { x: focusX, y: focusY } : undefined;
  const zoom = clampUnit(raw.zoom, 1, 1.5);
  return {
    ...input,
    thumbnail: {
      layout,
      ...(frame ? { frame } : {}),
      ...(focus ? { focus } : {}),
      ...(zoom !== undefined ? { zoom } : {}),
    },
  };
};

/** 廃止した T-GUIDE は T-STD として開き、ガイド専用タイムラインは組み直す。 */
const retireGuideTemplate = (input: Record<string, unknown>): Record<string, unknown> => {
  if (input.templateId !== 't-guide') return input;
  return {
    ...input,
    templateId: 't-std',
    timelineEdited: false,
    timeline: null,
  };
};

export const parseProject = (input: unknown): Project => {
  const version =
    typeof input === 'object' && input !== null && 'schemaVersion' in input
      ? (input as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  const source = isRecord(input) ? input : {};
  const prepared = normalizeThumbnail(
    hoistAnnotationStyle(
      retireGuideTemplate(
        version === 7
          ? source
          : upgradeProjectV4(
              version === 4 ? source : version === 3 ? upgradeProjectV3(source) : upgradeLegacyProject(source),
            ),
      ),
    ),
  );
  const parsed = projectSchema.parse(prepared);
  return refreshLegacyCta(restoreCaptionSurfaces(restoreAimMarkerSizes(parsed, input), input), CTA_TEXT);
};

export const emptyGuide = (): Project['guide'] => ({
  mode: 'guide',
  lastStep: 1,
  confirmedSteps: [],
  publishingEdited: {},
  publishingTranslation: {},
  exportPresets: [...DEFAULT_EXPORT_PRESETS],
  xReplyVideo: 'youtube',
  exportWithoutBgm: false,
  thumbnailOnly: [],
  wordingBrief: '',
  wordingTone: '',
});

export const createDefaultProject = (
  id: string,
  now = new Date().toISOString(),
  agent: { id: string; ability: string } = { id: 'Phoenix', ability: 'Curveball' },
): Project => ({
  schemaVersion: 7,
  id,
  title: '新しい定点',
  createdAt: now,
  updatedAt: now,
  lineup: {
    id: `lineup-${id}`,
    map: 'Ascent',
    site: 'A',
    side: 'defense',
    agent: agent.id,
    ability: agent.ability,
    throwType:
      agent.id === 'Sova'
        ? { ja: '0バウンス・1チャージ', en: '0 BOUNCE · 1 CHARGE' }
        : { ja: '通常投げ', en: 'NORMAL THROW' },
    ...(agent.id === 'Sova' ? { charge: 1, bounce: 0 } : {}),
    crouch: false,
    standDescription: { ja: 'ここに立つ', en: 'STAND HERE' },
    aimDescription: { ja: '印に合わせる', en: 'AIM AT THE MARK' },
  },
  assets: [],
  clips: [],
  stills: [],
  scenes: [
    { sceneKey: 'hook', layout916: 'focus', cropCenterX: 0.5, volume: 0.1 },
    {
      sceneKey: 'stand',
      layout916: 'center-crop',
      cropCenterX: 0.5,
      volume: 0.1,
      zoom: { enabled: true, from: 1, to: 1.15, x: 0.5, y: 0.5 },
    },
    {
      sceneKey: 'aim',
      layout916: 'center-crop',
      cropCenterX: 0.5,
      volume: 0.1,
      freeze: { enabled: true, at: 2, duration: 1 },
      aimMarker: { enabled: true, x: 0.5, y: 0.5, size: 1, at: 0 },
    },
    { sceneKey: 'throw', layout916: 'focus', cropCenterX: 0.5, volume: 0.1 },
    { sceneKey: 'card', layout916: 'blur-fit', cropCenterX: 0.5, volume: 0.1 },
    { sceneKey: 'demo', layout916: 'focus', cropCenterX: 0.5, volume: 0.1 },
    { sceneKey: 'loop', layout916: 'focus', cropCenterX: 0.5, volume: 0.1 },
  ],
  captions: [
    {
      id: 'hook',
      sceneKey: 'hook',
      text: {
        ja: '{map}{site}リテイクは、\n[これ1個]でいい',
        en: '{agent} lineups = [FREE KILLS]',
      },
      styleId: 'cap.hook',
    },
    {
      id: 'stand',
      sceneKey: 'stand',
      text: { ja: '{standDescription}', en: '{standDescription}' },
      styleId: 'cap.step',
    },
    {
      id: 'throw',
      sceneKey: 'aim',
      text: { ja: '{throwType}', en: '{throwType}' },
      styleId: 'cap.throw',
    },
    defaultDemoCaption(),
    defaultCtaCaption(),
  ],
  templateId: 't-std',
  timelineEdited: false,
  timeline: null,
  timelineMix: {
    hideCaptions: false,
    hideVideo: false,
    muteGame: false,
    muteBgm: false,
    muteEffects: false,
  },
  templateParams: {
    accent: '#FF4655',
    fps: 60,
    demoDuration: 11.5,
    sceneOrder: [...DEFAULT_SCENE_ORDER],
    sceneDurations: {},
    sceneDurationOffsets: {},
  },
  hookPattern: 'result',
  englishCaptionPreset: 'en-concise',
  experiment: defaultExperiment(),
  appliedInsightIds: [],
  skippedCandidateIds: [],
  analytics: { series: 'phoenix-lineups' },
  cardLayout: 'stack',
  annotationStyle: 'standard',
  cardAimZoom: defaultCardAimZoom(),
  cardStills: {},
  thumbnail: { layout: 'focus' },
  audio: { bgm: null },
  publishing: {
    title: { ja: '', en: '' },
    description: { ja: '', en: '' },
    hashtags: { ja: '', en: '' },
    links: {},
    memoUrl: '',
    pinnedComment: '',
    xPost: emptyXPost(),
  },
  posts: [],
  status: 'editing',
  guide: emptyGuide(),
});
