import { z } from 'zod';
import { lineupSchema } from '../schema/project';

/**
 * 横動画 Project（long-project.json）。
 * 短尺の project.json（schemaVersion 7）とは別ファイル・別スキーマで保存する。
 * 時刻はすべて整数 tick（shared/long/time.ts）。座標は 0〜1 の正規化値。
 */

export const LONG_SCHEMA_VERSION = 1 as const;
export const LONG_FILE_NAME = 'long-project.json';

const ticks = z.number().int();
const positiveTicks = z.number().int().positive();
const nonNegativeTicks = z.number().int().nonnegative();
const unit = z.number().finite();
const id = z.string().min(1);

export const longLanguageSchema = z.enum(['ja', 'en', 'ko']);
export type LongLanguage = z.infer<typeof longLanguageSchema>;
export const LONG_LANGUAGES: readonly LongLanguage[] = ['ja', 'en', 'ko'];

export const localizedSchema = z.object({
  ja: z.string().optional(),
  en: z.string().optional(),
  ko: z.string().optional(),
});
export type Localized = z.infer<typeof localizedSchema>;

/** 正規化矩形（x, y は左上）。範囲検証は geometry.ts で行う。 */
export const normRectSchema = z.object({ x: unit, y: unit, w: unit, h: unit });
export type NormRect = z.infer<typeof normRectSchema>;

export const FULL_RECT: NormRect = { x: 0, y: 0, w: 1, h: 1 };

export const fitSchema = z.enum(['contain', 'cover']);
export type Fit = z.infer<typeof fitSchema>;

export const easingSchema = z.enum(['step', 'linear', 'ease']);
export type Easing = z.infer<typeof easingSchema>;

/** 比率の指定。'source' は素材の実寸比、'free' は固定しない。 */
export const aspectSchema = z.union([
  z.enum(['source', 'free']),
  z.object({ w: z.number().positive(), h: z.number().positive() }),
]);
export type Aspect = z.infer<typeof aspectSchema>;

export const frameStyleSchema = z.object({
  borderWidth: z.number().min(0).max(40).default(0),
  borderColor: z.string().default('#FFFFFF'),
  /** contain の余白。null は透明 */
  background: z.string().nullable().default(null),
  opacity: z.number().min(0).max(1).default(1),
  radius: z.number().min(0).max(200).default(0),
});
export type FrameStyle = z.infer<typeof frameStyleSchema>;

export const defaultFrameStyle = (): FrameStyle => ({
  borderWidth: 0,
  borderColor: '#FFFFFF',
  background: null,
  opacity: 1,
  radius: 0,
});

/** 開始→終了の2点補間（H1）。to が無ければ固定。 */
export const rectMotionSchema = z.object({
  to: normRectSchema.optional(),
  cropTo: normRectSchema.optional(),
  easing: easingSchema.default('ease'),
});
export type RectMotion = z.infer<typeof rectMotionSchema>;

// ---------------------------------------------------------------------------
// アンカー

export const anchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source'), placementId: id, ticks }),
  z.object({ kind: z.literal('scene'), sceneId: id, offset: ticks }),
  z.object({ kind: z.literal('chapter'), chapterId: id, offset: ticks }),
  z.object({ kind: z.literal('project'), ticks }),
  z.object({ kind: z.literal('event'), markerId: id, offset: ticks }),
]);
export type Anchor = z.infer<typeof anchorSchema>;

// ---------------------------------------------------------------------------
// 素材

export const audioStreamRoleSchema = z.enum(['game', 'voice', 'mixed', 'secondary', 'unused']);
export type AudioStreamRole = z.infer<typeof audioStreamRoleSchema>;

export const audioStreamInfoSchema = z.object({
  /** 音声ストリームだけを数えた番号（ffmpeg の 0:a:N） */
  audioIndex: z.number().int().nonnegative(),
  /** ファイル全体でのストリーム番号 */
  streamIndex: z.number().int().nonnegative(),
  codec: z.string(),
  channels: z.number().int().nonnegative(),
  sampleRate: z.number().int().nonnegative(),
  title: z.string().optional(),
  language: z.string().optional(),
  /** 映像の開始時刻との差（tick）。抽出した音声ファイルを素材時刻へ合わせる */
  startOffset: ticks.default(0),
  /** 抽出済みの音声ファイル（保存先からの相対パス） */
  extractedPath: z.string().optional(),
  role: audioStreamRoleSchema.optional(),
});
export type AudioStreamInfo = z.infer<typeof audioStreamInfoSchema>;

export const mediaProbeSchema = z.object({
  durationTicks: nonNegativeTicks,
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  /** r_frame_rate（公称） */
  fps: z.number().nonnegative(),
  /** avg_frame_rate（実測平均） */
  avgFps: z.number().nonnegative(),
  vfr: z.boolean().default(false),
  codec: z.string(),
  audioStreams: z.array(audioStreamInfoSchema).default([]),
});
export type MediaProbe = z.infer<typeof mediaProbeSchema>;

export const fileStampSchema = z.object({
  size: z.number().nonnegative(),
  mtimeMs: z.number().nonnegative(),
});
export type FileStamp = z.infer<typeof fileStampSchema>;

export const reuseSourceSchema = z.object({
  projectId: z.string(),
  projectTitle: z.string(),
  importedAt: z.string(),
  /** 元 Project 側の ID（clip, still, asset 等） */
  sourceId: z.string().optional(),
});
export type ReuseSource = z.infer<typeof reuseSourceSchema>;

export const longAssetSchema = z.object({
  id,
  kind: z.enum(['video', 'image']),
  name: z.string(),
  /** 保存先からの相対パス */
  path: z.string(),
  proxyPath: z.string().optional(),
  probe: mediaProbeSchema.optional(),
  stamp: fileStampSchema.optional(),
  tags: z.array(z.string()).default([]),
  /** 副視点として使う録画など */
  viewLabel: z.string().optional(),
  importedFrom: reuseSourceSchema.optional(),
  missing: z.boolean().optional(),
});
export type LongAsset = z.infer<typeof longAssetSchema>;

export const markerKindSchema = z.enum(['highlight', 'sync', 'throw', 'impact', 'kill', 'speech', 'custom']);
export type MarkerKind = z.infer<typeof markerKindSchema>;

export const candidateMarkerSchema = z.object({
  id,
  kind: markerKindSchema,
  ticks,
  label: z.string().default(''),
});

export const candidateSchema = z
  .object({
    id,
    assetId: id,
    name: z.string(),
    in: nonNegativeTicks,
    out: positiveTicks,
    tags: z.array(z.string()).default([]),
    memo: z.string().default(''),
    markers: z.array(candidateMarkerSchema).default([]),
    lineupIds: z.array(z.string()).default([]),
    importedFrom: reuseSourceSchema.optional(),
  })
  .refine((value) => value.out > value.in, { message: 'OUT は IN より後にしてください', path: ['out'] });
export type Candidate = z.infer<typeof candidateSchema>;

export const CANDIDATE_TAGS = ['成功', '応用', '失敗', '想定外', 'ハイライト', '反応', '副視点'] as const;

// ---------------------------------------------------------------------------
// 定点

export const longLineupSchema = lineupSchema.extend({
  title: z.string().default(''),
  importedFrom: reuseSourceSchema.optional(),
});
export type LongLineup = z.infer<typeof longLineupSchema>;

// ---------------------------------------------------------------------------
// 章・シーン

export const chapterRoleSchema = z.enum(['hook', 'set', 'closing', 'ending', 'custom']);
export type ChapterRole = z.infer<typeof chapterRoleSchema>;

export const contentKindSchema = z.enum(['single', 'combo']);
export type ContentKind = z.infer<typeof contentKindSchema>;

export const showOrderSchema = z.enum(['success-first', 'explain-first', 'success-fail-retry']);
export type ShowOrder = z.infer<typeof showOrderSchema>;

export const lineupLinkSchema = z.object({
  lineupId: id,
  /** 組み合わせでの使用順（1始まり） */
  order: z.number().int().positive().default(1),
  /** 合図・条件 */
  cue: localizedSchema.default({}),
  /** このスキルの役割 */
  role: localizedSchema.default({}),
  /** 任意の使用時刻 */
  useAt: anchorSchema.optional(),
});
export type LineupLink = z.infer<typeof lineupLinkSchema>;

export const chapterSchema = z.object({
  id,
  role: chapterRoleSchema,
  title: localizedSchema,
  contentKind: contentKindSchema.nullable().default(null),
  showOrder: showOrderSchema.nullable().default(null),
  lineups: z.array(lineupLinkSchema).default([]),
  sceneIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  /** チャプター草案に載せる（既定 true） */
  inChapters: z.boolean().default(true),
  note: z.string().default(''),
});
export type Chapter = z.infer<typeof chapterSchema>;

export const scenePurposeSchema = z.enum([
  'hook',
  'action',
  'explain',
  'condition',
  'fail',
  'unexpected',
  'reaction',
  'replay',
  'summary',
  'card',
  'pause',
  'highlight',
  'ending',
  'custom',
]);
export type ScenePurpose = z.infer<typeof scenePurposeSchema>;

export const sceneContentSchema = z.discriminatedUnion('kind', [
  /** 主映像の配置（尺は配置の出力尺） */
  z.object({ kind: z.literal('placement'), placementId: id }),
  /** 静止画・説明カード・間（尺を明示） */
  z.object({
    kind: z.literal('still'),
    assetId: z.string().optional(),
    color: z.string().default('#0F1216'),
    duration: positiveTicks,
  }),
  /** 未割当の枠。書き出し前に割り当てるか除外する */
  z.object({ kind: z.literal('empty'), plannedDuration: positiveTicks }),
]);
export type SceneContent = z.infer<typeof sceneContentSchema>;

export const sceneSchema = z.object({
  id,
  chapterId: id,
  purpose: scenePurposeSchema,
  label: z.string().default(''),
  /** テンプレート上の狙い（例：状況を一言添え、まず成功を見せる） */
  hint: z.string().default(''),
  enabled: z.boolean().default(true),
  content: sceneContentSchema,
  /** 同じシーンに重ねる派生配置（副視点・拡大小窓） */
  layerIds: z.array(z.string()).default([]),
  replayOf: z.string().optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

// ---------------------------------------------------------------------------
// 配置

export const freezeSchema = z.object({ id, at: nonNegativeTicks, duration: positiveTicks });

export const audioUseSchema = z.object({
  audioIndex: z.number().int().nonnegative(),
  gainDb: z.number().min(-60).max(24).default(0),
  muted: z.boolean().default(false),
});
export type AudioUse = z.infer<typeof audioUseSchema>;

const placementBase = {
  id,
  sceneId: id,
  /** 素材内の切り抜き範囲 */
  crop: normRectSchema.default(FULL_RECT),
  cropAspect: aspectSchema.default('source'),
  cropLocked: z.boolean().default(true),
  /** 完成画面内の表示枠 */
  rect: normRectSchema.default(FULL_RECT),
  rectAspect: aspectSchema.default('free'),
  rectLocked: z.boolean().default(false),
  fit: fitSchema.default('contain'),
  style: frameStyleSchema.default(defaultFrameStyle()),
  motion: rectMotionSchema.optional(),
  z: z.number().int().default(0),
  label: localizedSchema.default({}),
  showLabel: z.boolean().default(false),
};

export const mainPlacementSchema = z.object({
  ...placementBase,
  role: z.literal('main'),
  assetId: id,
  candidateId: z.string().optional(),
  sourceIn: nonNegativeTicks,
  sourceOut: positiveTicks,
  speed: z.number().min(0.25).max(4).default(1),
  freezes: z.array(freezeSchema).default([]),
  audio: z.array(audioUseSchema).default([]),
  /** フリーズ・スロー時の原音。既定はフリーズでミュート、スローは速度に連動 */
  muteDuringSlow: z.boolean().default(false),
  fadeIn: nonNegativeTicks.default(0),
  fadeOut: nonNegativeTicks.default(0),
});

export const secondaryGapPolicySchema = z.enum(['hide-main-full', 'hide-keep-layout', 'hold-last']);
export type SecondaryGapPolicy = z.infer<typeof secondaryGapPolicySchema>;

export const pipLayoutSchema = z.enum(['corner', 'free', 'split-h', 'split-v']);
export type PipLayout = z.infer<typeof pipLayoutSchema>;

export const secondaryPlacementSchema = z.object({
  ...placementBase,
  role: z.literal('secondary'),
  assetId: id,
  /** 主映像（同期元） */
  parentId: id,
  syncGroupId: id,
  layout: pipLayoutSchema.default('corner'),
  corner: z.enum(['tl', 'tr', 'bl', 'br']).default('tr'),
  /** 分割の主側の割合（0.2〜0.8） */
  splitRatio: z.number().min(0.2).max(0.8).default(0.5),
  /** 主側の分割枠（split のとき自動計算） */
  mainRectOverride: normRectSchema.optional(),
  /** 主配置の出力時刻（配置内）で表示する区間。空なら全区間 */
  visible: z.array(z.object({ start: nonNegativeTicks, end: positiveTicks })).default([]),
  gapPolicy: secondaryGapPolicySchema.default('hide-main-full'),
  swapped: z.boolean().default(false),
  audio: z.array(audioUseSchema).default([]),
});

export const zoomPlacementSchema = z.object({
  ...placementBase,
  role: z.literal('zoom'),
  /** 同じ映像を拡大する元の配置 */
  parentId: id,
  mode: z.enum(['window', 'fullscreen']).default('window'),
  /** 主配置の出力時刻（配置内）での表示区間 */
  start: nonNegativeTicks,
  end: positiveTicks,
  preset: z.string().optional(),
});

export const placementSchema = z.discriminatedUnion('role', [
  mainPlacementSchema,
  secondaryPlacementSchema,
  zoomPlacementSchema,
]);
export type Placement = z.infer<typeof placementSchema>;
export type MainPlacement = z.infer<typeof mainPlacementSchema>;
export type SecondaryPlacement = z.infer<typeof secondaryPlacementSchema>;
export type ZoomPlacement = z.infer<typeof zoomPlacementSchema>;

// ---------------------------------------------------------------------------
// 同期・マーカー

export const syncGroupSchema = z.object({
  id,
  /** 各配置で「同じ出来事」が起きる素材時刻 */
  members: z
    .array(z.object({ placementId: id, syncAt: nonNegativeTicks }))
    .min(2),
  linked: z.boolean().default(true),
  /** 「参考映像／再現」等、同じ瞬間ではない場合 */
  reference: z.boolean().default(false),
  /** 後半で確認した同期点（ドリフト確認用・記録のみ） */
  checks: z
    .array(z.object({ placementId: id, at: nonNegativeTicks, partnerAt: nonNegativeTicks, note: z.string().default('') }))
    .default([]),
});
export type SyncGroup = z.infer<typeof syncGroupSchema>;

export const markerSchema = z.object({
  id,
  kind: markerKindSchema,
  /** 素材時刻で持つ（配置ID＋素材時刻） */
  placementId: id,
  at: nonNegativeTicks,
  label: z.string().default(''),
  /** 素材差し替え後に要確認 */
  needsReview: z.boolean().default(false),
});
export type Marker = z.infer<typeof markerSchema>;

// ---------------------------------------------------------------------------
// 字幕・図形・カットイン

export const captionKindSchema = z.enum(['speech', 'explain', 'reaction']);
export type CaptionKind = z.infer<typeof captionKindSchema>;

export const captionStyleSchema = z.object({
  preset: z.enum(['subtitle', 'explain', 'reaction', 'title']).default('subtitle'),
  /** 中心位置（正規化） */
  x: unit.default(0.5),
  y: unit.default(0.86),
  /** 最大幅（正規化） */
  width: unit.default(0.8),
  size: z.number().min(12).max(200).default(48),
  align: z.enum(['left', 'center', 'right']).default('center'),
  color: z.string().default('#FFFFFF'),
  accent: z.string().default('#FF4655'),
  background: z.boolean().default(false),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const captionSchema = z.object({
  id,
  kind: captionKindSchema,
  anchor: anchorSchema,
  duration: positiveTicks,
  text: localizedSchema,
  /** 明示的に出さない言語（未訳を意図して除外） */
  excluded: z.array(longLanguageSchema).default([]),
  style: captionStyleSchema.default({
    preset: 'subtitle',
    x: 0.5,
    y: 0.86,
    width: 0.8,
    size: 48,
    align: 'center',
    color: '#FFFFFF',
    accent: '#FF4655',
    background: false,
  }),
  /** 所有シーン（シーン削除で一緒に消す） */
  sceneId: z.string().optional(),
});
export type Caption = z.infer<typeof captionSchema>;

export const motionKindSchema = z.enum(['none', 'pop', 'bounce', 'shake', 'fade']);
export type MotionKind = z.infer<typeof motionKindSchema>;

export const overlayKindSchema = z.enum(['arrow', 'rect', 'circle', 'marker', 'image', 'card', 'cutin']);
export type OverlayKind = z.infer<typeof overlayKindSchema>;

export const overlaySchema = z.object({
  id,
  kind: overlayKindSchema,
  anchor: anchorSchema,
  duration: positiveTicks,
  /** 'screen' は画面固定、それ以外は配置IDの映像に追従（元フレーム座標） */
  target: z.string().default('screen'),
  /** arrow は (x,y)→(x+w,y+h) の始点終点、他は矩形 */
  rect: normRectSchema,
  color: z.string().default('#FF4655'),
  strokeWidth: z.number().min(1).max(40).default(8),
  assetId: z.string().optional(),
  text: localizedSchema.default({}),
  motion: motionKindSchema.default('pop'),
  seTrackId: z.string().optional(),
  seGainDb: z.number().min(-60).max(24).default(0),
  sceneId: z.string().optional(),
});
export type Overlay = z.infer<typeof overlaySchema>;

// ---------------------------------------------------------------------------
// アバター

export const expressionDefSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  name: z.string(),
});
export type ExpressionDef = z.infer<typeof expressionDefSchema>;

export const DEFAULT_EXPRESSIONS: ExpressionDef[] = [
  { id: 'E01', name: '通常' },
  { id: 'E02', name: '話す' },
  { id: 'E03', name: '称賛' },
  { id: 'E04', name: 'どや顔' },
  { id: 'E05', name: '喜び' },
  { id: 'E06', name: '呆然' },
  { id: 'E07', name: '悔しい' },
  { id: 'E08', name: '照れ・気まずい' },
  { id: 'E09', name: '大泣き' },
  { id: 'E10', name: '白目・魂が抜けた' },
  { id: 'E11', name: 'ブチ切れ' },
  { id: 'E12', name: 'パーティー' },
];

export const expressionMediaSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('still'), path: z.string() }),
  /** 連番PNG（RGBA）。frames は保存先からの相対パス */
  z.object({
    kind: z.literal('sequence'),
    frames: z.array(z.string()).min(1),
    fps: z.number().positive().default(25),
    loop: z.boolean().default(true),
  }),
]);
export type ExpressionMedia = z.infer<typeof expressionMediaSchema>;

export const avatarSetSchema = z.object({
  id,
  name: z.string(),
  /** 画像の実寸（共通。透明余白を含めた全体） */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** 画像内の原点（正規化。既定は中央下） */
  originX: unit.default(0.5),
  originY: unit.default(1),
  expressions: z.record(z.string(), expressionMediaSchema).default({}),
  /** 画像ごとの原点補正（正規化） */
  offsets: z.record(z.string(), z.object({ dx: unit, dy: unit })).default({}),
});
export type AvatarSet = z.infer<typeof avatarSetSchema>;

export const avatarAfterSchema = z.enum(['previous', 'base', 'hidden']);

export const avatarEventSchema = z.object({
  id,
  setId: z.string().optional(),
  expressionId: z.string(),
  anchor: anchorSchema,
  duration: positiveTicks,
  /** 原点の位置（正規化）と高さ（出力高さ比） */
  x: unit.optional(),
  y: unit.optional(),
  height: unit.optional(),
  motion: motionKindSchema.default('pop'),
  after: avatarAfterSchema.default('base'),
  seTrackId: z.string().optional(),
  seGainDb: z.number().min(-60).max(24).default(0),
  text: localizedSchema.default({}),
  sceneId: z.string().optional(),
});
export type AvatarEvent = z.infer<typeof avatarEventSchema>;

export const avatarBaseSchema = z.object({
  enabled: z.boolean().default(false),
  setId: z.string().optional(),
  expressionId: z.string().default('E01'),
  x: unit.default(0.1),
  y: unit.default(0.95),
  height: unit.default(0.28),
  missing: z.enum(['base', 'hidden']).default('base'),
});
export type AvatarBase = z.infer<typeof avatarBaseSchema>;

export const reactionPresetSchema = z.object({
  id,
  name: z.string(),
  expressionId: z.string(),
  motion: motionKindSchema,
  duration: positiveTicks,
  seTrackId: z.string().optional(),
  text: localizedSchema.default({}),
});
export type ReactionPreset = z.infer<typeof reactionPresetSchema>;

// ---------------------------------------------------------------------------
// 音声（BGM・SE・ダッキング）

export const bgmUseSchema = z.object({
  id,
  audioTrackId: id,
  anchor: anchorSchema,
  duration: positiveTicks,
  /** 曲内の開始位置 */
  offset: nonNegativeTicks.default(0),
  gainDb: z.number().min(-60).max(12).default(-18),
  fadeIn: nonNegativeTicks.default(0),
  fadeOut: nonNegativeTicks.default(0),
  loop: z.boolean().default(true),
  chapterId: z.string().optional(),
});
export type BgmUse = z.infer<typeof bgmUseSchema>;

export const seUseSchema = z.object({
  id,
  audioTrackId: id,
  anchor: anchorSchema,
  gainDb: z.number().min(-60).max(12).default(-6),
  sceneId: z.string().optional(),
});
export type SeUse = z.infer<typeof seUseSchema>;

export const duckingSchema = z.object({
  id,
  anchor: anchorSchema,
  duration: positiveTicks,
  depthDb: z.number().min(-60).max(0).default(-12),
  attack: nonNegativeTicks.default(24_000),
  release: nonNegativeTicks.default(96_000),
  sceneId: z.string().optional(),
});
export type Ducking = z.infer<typeof duckingSchema>;

// ---------------------------------------------------------------------------
// 出力・テンプレート・画面状態

export const longOutputSchema = z.object({
  width: z.literal(1920).default(1920),
  height: z.literal(1080).default(1080),
  fps: z.union([z.literal(30), z.literal(60)]).default(60),
  languages: z.array(longLanguageSchema).min(1).default(['ja']),
  captionMode: z.enum(['burn', 'srt']).default('burn'),
  withoutBgm: z.boolean().default(false),
  thumbnail: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('frame'), at: nonNegativeTicks }),
      z.object({ kind: z.literal('image'), path: z.string() }),
    ])
    .optional(),
});
export type LongOutput = z.infer<typeof longOutputSchema>;

export const templateSnapshotSchema = z.object({
  templateId: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const longExportRecordSchema = z.object({
  exportId: z.string(),
  at: z.string(),
  language: longLanguageSchema,
  fps: z.number(),
  range: z.object({ start: nonNegativeTicks, end: positiveTicks }).optional(),
  files: z.array(z.string()).default([]),
  basename: z.string(),
  durationTicks: nonNegativeTicks,
});
export type LongExportRecord = z.infer<typeof longExportRecordSchema>;

export const longPublishingSchema = z.object({
  title: localizedSchema.default({}),
  description: localizedSchema.default({}),
  tags: z.array(z.string()).default([]),
  url: z.string().optional(),
  postedAt: z.string().optional(),
});

export const editorStateSchema = z.object({
  mode: z.enum(['guide', 'editor']).default('guide'),
  guideStep: z.number().int().min(1).max(8).default(1),
  chapterId: z.string().optional(),
  playhead: nonNegativeTicks.default(0),
  previewRange: z.enum(['scene', 'chapter', 'all']).default('chapter'),
  collapsedRows: z.array(z.string()).default([]),
  confirmed: z.array(z.string()).default([]),
});
export type EditorState = z.infer<typeof editorStateSchema>;

export const longProjectSchema = z.object({
  format: z.literal('long'),
  longSchemaVersion: z.literal(LONG_SCHEMA_VERSION),
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]*$/).default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['editing', 'exported', 'posted']).default('editing'),
  output: longOutputSchema,
  template: templateSnapshotSchema,
  assets: z.array(longAssetSchema).default([]),
  candidates: z.array(candidateSchema).default([]),
  lineups: z.array(longLineupSchema).default([]),
  chapterOrder: z.array(z.string()).default([]),
  chapters: z.array(chapterSchema).default([]),
  scenes: z.array(sceneSchema).default([]),
  placements: z.array(placementSchema).default([]),
  syncGroups: z.array(syncGroupSchema).default([]),
  markers: z.array(markerSchema).default([]),
  captions: z.array(captionSchema).default([]),
  overlays: z.array(overlaySchema).default([]),
  expressions: z.array(expressionDefSchema).default(DEFAULT_EXPRESSIONS),
  avatarSets: z.array(avatarSetSchema).default([]),
  avatarBase: avatarBaseSchema.default({
    enabled: false,
    expressionId: 'E01',
    x: 0.1,
    y: 0.95,
    height: 0.28,
    missing: 'base',
  }),
  avatarEvents: z.array(avatarEventSchema).default([]),
  reactionPresets: z.array(reactionPresetSchema).default([]),
  bgm: z.array(bgmUseSchema).default([]),
  se: z.array(seUseSchema).default([]),
  ducking: z.array(duckingSchema).default([]),
  publishing: longPublishingSchema.default({ title: {}, description: {}, tags: [] }),
  exports: z.array(longExportRecordSchema).default([]),
  editor: editorStateSchema.default({
    mode: 'guide',
    guideStep: 1,
    playhead: 0,
    previewRange: 'chapter',
    collapsedRows: [],
    confirmed: [],
  }),
});
export type LongProject = z.infer<typeof longProjectSchema>;

export class LongProjectVersionError extends Error {
  constructor(version: unknown) {
    super(
      `この横動画プロジェクトは新しい形式（longSchemaVersion ${String(version)}）です。` +
        'アプリを更新してから開いてください。ファイルは変更していません。',
    );
  }
}

/** 読み込み。未知の新しい版は拒否し、書き換えない。 */
export const parseLongProject = (input: unknown): LongProject => {
  const raw = input as { format?: unknown; longSchemaVersion?: unknown } | null;
  if (!raw || raw.format !== 'long') throw new Error('横動画プロジェクトではありません');
  if (typeof raw.longSchemaVersion === 'number' && raw.longSchemaVersion > LONG_SCHEMA_VERSION) {
    throw new LongProjectVersionError(raw.longSchemaVersion);
  }
  return longProjectSchema.parse(input);
};

export const placementById = (project: LongProject, placementId: string): Placement | undefined =>
  project.placements.find((placement) => placement.id === placementId);

export const assetById = (project: LongProject, assetId: string): LongAsset | undefined =>
  project.assets.find((asset) => asset.id === assetId);

export const localizedText = (value: Localized, language: LongLanguage): string =>
  (value[language] ?? '').trim();
