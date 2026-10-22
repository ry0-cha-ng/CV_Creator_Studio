import { z } from 'zod';
import type { CtaDesign } from './cta-design';
import { DELIVERY_PRESETS, type DeliveryPresetId } from './delivery-presets';
import type { SceneKey } from './schema/project-keys';
import { S7_FRAME } from './s7-cta';

/** 短尺S4の統合CTA。寸法は1080×1920、映像矩形（blur-fit）に追従する。 */
export const S4_CTA_HOLD_SEC = 2;

export const S4_CTA = {
  left: 72,
  gapBelowFootage: 24,
  maxWidth: 768,
  height: 120,
  radius: 14,
  background: 'rgba(6, 9, 13, 0.72)',
  iconSize: 54,
  mainFontSize: 46,
  subFontSize: 30,
  paddingLeft: 22,
  paddingRight: 28,
  gap: 20,
  watermarkGap: 12,
} as const;

export const S4_CTA_COPY = {
  ja: { main: 'ラウンド間に、さっと確認。', sub: 'ClutchVault｜プロフィールのリンクへ' },
  en: { main: 'Check it between rounds.', sub: 'ClutchVault · Link on profile' },
} as const;

/** 高評価CTA（B案）。寸法は1080×1920。下端は映像上端から44px。 */
export const LIKE_CTA = {
  width: 840,
  height: 164,
  gapAboveFootage: 44,
  radius: 20,
  background: 'rgba(15, 25, 35, 0.72)',
  border: '2px solid rgba(236, 232, 225, 0.18)',
  paddingY: 14,
  paddingX: 28,
  rowGap: 12,
  line1Color: 'rgba(236, 232, 225, 0.82)',
  line2Color: '#ECE8E1',
  /** 👍の塗り。文字色（line2Color）とは別に指定する。 */
  thumbFill: '#FFC83D',
  watermarkGap: 26,
  watermarkHeight: 40,
  risePx: 8,
  peakScale: 1.1,
  /** 中央揃えの文字が、右側UIを避けた x=72〜912 に収まる幅。 */
  safeTextWidth: 744,
} as const;

export const LIKE_CTA_TYPE = {
  en: { line1: 40, line2: 60, slot: 78, line1Height: 46, line2Height: 70 },
  ja: { line1: 36, line2: 52, slot: 68, line1Height: 46, line2Height: 70 },
} as const;

export const LIKE_CTA_COPY = {
  ja: { line1: '次の試合で使おう。', before: '高評価 ', after: ' であとから見返そう。' },
  en: { line1: 'TRY IT NEXT MATCH.', before: 'LIKE ', after: ' TO REVISIT.' },
} as const;

const localizedSchema = z.object({
  ja: z.string(),
  en: z.string(),
});

export const s4CtaTextSchema = z.object({
  main: localizedSchema,
  sub: localizedSchema,
});

export type S4CtaText = z.infer<typeof s4CtaTextSchema>;

export const s4CtaPurposeSchema = z.enum(['cv', 'like']);
export type S4CtaPurpose = z.infer<typeof s4CtaPurposeSchema>;

export const s4LikeCtaSchema = z.object({
  line1: localizedSchema,
  before: localizedSchema,
  after: localizedSchema,
  motion: z.boolean().optional(),
});

export type S4LikeCtaText = z.infer<typeof s4LikeCtaSchema>;

export type CtaDeliveryPlatform = 'youtube' | 'tiktok';

type Box = { x: number; y: number; width: number; height: number };

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const CARD_EARLY_ORDER: SceneKey[] = ['hook', 'card', 'stand', 'aim', 'throw'];

const sameOrder = (order: SceneKey[] | undefined, expected: SceneKey[]): boolean =>
  Boolean(order && order.length === expected.length && order.every((key, index) => key === expected[index]));

/**
 * 保存値がなければ、分析テスト構成（S1→S5→S2→S3→S4）だけ新しいブロックを使う。
 * それ以外は既存のS7帯のまま。
 */
type CtaProject = {
  structureTemplateId?: string;
  templateParams: {
    ctaDesign?: CtaDesign;
    sceneOrder?: SceneKey[];
    s4CtaPurpose?: S4CtaPurpose;
    s4LikeCta?: S4LikeCtaText;
  };
};

/** 未保存は従来のClutchVault案内。開いただけでは高評価CTAにしない。 */
export const resolveS4CtaPurpose = (input: CtaProject): S4CtaPurpose =>
  input.templateParams.s4CtaPurpose ?? 'cv';

export const resolveLikeCtaText = (input: CtaProject): S4LikeCtaText => {
  const stored = input.templateParams.s4LikeCta;
  return {
    line1: stored?.line1 ?? { ja: LIKE_CTA_COPY.ja.line1, en: LIKE_CTA_COPY.en.line1 },
    before: stored?.before ?? { ja: LIKE_CTA_COPY.ja.before, en: LIKE_CTA_COPY.en.before },
    after: stored?.after ?? { ja: LIKE_CTA_COPY.ja.after, en: LIKE_CTA_COPY.en.after },
    motion: stored?.motion !== false,
  };
};

/**
 * 高評価CTAはYouTube短尺だけ。プレビュー（媒体未指定）は編集中のYouTube表示。
 * TikTokへは適用しない。
 */
export const likeCtaActive = (input: CtaProject, platform?: CtaDeliveryPlatform): boolean => {
  if (resolveCtaDesign(input) !== 's4-block') return false;
  if (resolveS4CtaPurpose(input) !== 'like') return false;
  return platform !== 'tiktok';
};

export const resolveCtaDesign = (input: {
  structureTemplateId?: string;
  templateParams: { ctaDesign?: CtaDesign; sceneOrder?: SceneKey[] };
}): CtaDesign => {
  if (input.templateParams.ctaDesign) return input.templateParams.ctaDesign;
  if (input.structureTemplateId === 'structure-card-early') return 's4-block';
  if (sameOrder(input.templateParams.sceneOrder, CARD_EARLY_ORDER)) return 's4-block';
  return 's7-band';
};

export const s4CtaRect = (
  footageBottom: number = S7_FRAME.footageBottom,
): Box => ({
  x: S4_CTA.left,
  y: footageBottom + S4_CTA.gapBelowFootage,
  width: S4_CTA.maxWidth,
  height: S4_CTA.height,
});

/** CTAと重なるときだけ、映像外の空きへ署名を下げる。足りなければ下部UIの手前で止める。 */
export const s4WatermarkTop = (footageBottom: number = S7_FRAME.footageBottom): number => {
  const cta = s4CtaRect(footageBottom);
  const preferred = S7_FRAME.watermark.y;
  const needed = cta.y + cta.height + S4_CTA.watermarkGap;
  if (needed <= preferred) return preferred;
  const limit = S7_FRAME.chromeBottom - S7_FRAME.watermark.height;
  return Math.min(needed, limit);
};

export const s4CtaOverlapDetail = (footageBottom: number = S7_FRAME.footageBottom): string | null => {
  const cta = s4CtaRect(footageBottom);
  const footage: Box = {
    x: 0,
    y: S7_FRAME.footageTop,
    width: S7_FRAME.width,
    height: S7_FRAME.footageHeight,
  };
  const watermark: Box = { ...S7_FRAME.watermark, y: s4WatermarkTop(footageBottom) };
  const chromeTop: Box = { x: 0, y: 0, width: S7_FRAME.width, height: S7_FRAME.chromeTop };
  const chromeRight: Box = { x: 924, y: 760, width: 156, height: 740 };
  const chromeBottom: Box = {
    x: 0,
    y: S7_FRAME.chromeBottom,
    width: S7_FRAME.width,
    height: S7_FRAME.height - S7_FRAME.chromeBottom,
  };
  if (intersects(cta, footage)) return 'CTAがゲーム映像に重なっています';
  if (intersects(cta, watermark)) return 'CTAが H1gher に重なっています';
  if (intersects(cta, chromeTop) || intersects(cta, chromeRight) || intersects(cta, chromeBottom)) {
    return 'CTAがプラットフォームUIに重なっています';
  }
  return null;
};

/** 末尾2秒。シーンが2秒未満ならシーン全体。フェードはなく、区間の外では即非表示。 */
export const s4CtaVisibleAtFrame = (frame: number, fps: number, durationSec: number): boolean => {
  const total = Math.max(1, Math.round(Math.max(0, durationSec) * fps));
  const hold = Math.min(total, Math.round(S4_CTA_HOLD_SEC * fps));
  const start = total - hold;
  return frame >= start && frame < total;
};

export const s4CtaHoldFrames = (fps: number, durationSec: number): number => {
  const total = Math.max(1, Math.round(Math.max(0, durationSec) * fps));
  return Math.min(total, Math.round(S4_CTA_HOLD_SEC * fps));
};

export const splitS4Subline = (sub: string): { brand: string; rest: string } => {
  const brand = 'ClutchVault';
  if (sub.startsWith(brand)) return { brand, rest: sub.slice(brand.length) };
  return { brand: sub, rest: '' };
};

/** 映像上端に追従。映像位置が変わっても下端＝映像上端−44px。 */
export const likeCtaRect = (footageTop: number = S7_FRAME.footageTop): Box => ({
  x: (S7_FRAME.width - LIKE_CTA.width) / 2,
  y: footageTop - LIKE_CTA.gapAboveFootage - LIKE_CTA.height,
  width: LIKE_CTA.width,
  height: LIKE_CTA.height,
});

/** S4で高評価CTAを出しているあいだだけ、署名を映像直下へ小さく置く。 */
export const likeWatermarkTop = (footageBottom: number = S7_FRAME.footageBottom): number =>
  footageBottom + LIKE_CTA.watermarkGap;

const glyphWidth = (char: string, fontSize: number, language: 'ja' | 'en'): number => {
  if (char === ' ') return fontSize * (language === 'ja' ? 0.33 : 0.28);
  if (language === 'ja') return fontSize;
  return fontSize * 0.68;
};

/** 2行目（👍の頂点のはみ出しを含む）の見込み幅。中央揃えで安全範囲に収まるかを見る。 */
export const likeLineWidth = (
  language: 'ja' | 'en',
  before: string,
  after: string,
): number => {
  const type = LIKE_CTA_TYPE[language];
  let width = type.slot + type.line2 * (LIKE_CTA.peakScale - 1);
  for (const char of `${before}${after}`) width += glyphWidth(char, type.line2, language);
  return width;
};

export const likeCtaFitWarning = (
  language: 'ja' | 'en',
  before: string,
  after: string,
): string | null => {
  const width = likeLineWidth(language, before, after);
  if (width <= LIKE_CTA.safeTextWidth) return null;
  const label = language === 'ja' ? '日本語' : '英語';
  return `${label}の2行目が安全範囲を超える見込みです（約${Math.ceil(width)}px / ${LIKE_CTA.safeTextWidth}px）。短くしてください`;
};

/**
 * CTA開始からの秒。0.50秒未満の区間は静止。
 * 0.15まで静止、0.30で頂点（ease-out）、0.50で着地（ease-in-out）。
 */
export const likeThumbMotion = (
  elapsedSec: number,
  enabled: boolean,
  holdSec: number,
): { dy: number; scale: number } => {
  if (!enabled || holdSec < 0.5 || elapsedSec <= 0.15) return { dy: 0, scale: 1 };
  if (elapsedSec <= 0.3) {
    const progress = (elapsedSec - 0.15) / 0.15;
    const eased = 1 - (1 - progress) ** 3;
    return { dy: -LIKE_CTA.risePx * eased, scale: 1 + (LIKE_CTA.peakScale - 1) * eased };
  }
  if (elapsedSec < 0.5) {
    const progress = (elapsedSec - 0.3) / 0.2;
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    return {
      dy: -LIKE_CTA.risePx * (1 - eased),
      scale: LIKE_CTA.peakScale - (LIKE_CTA.peakScale - 1) * eased,
    };
  }
  return { dy: 0, scale: 1 };
};

/** 同じ言語にYouTubeとTikTokが同時にあるときだけ、動画を媒体別に分ける。 */
export const videoCtaRenders = (
  presetIds: DeliveryPresetId[],
  project: CtaProject,
): Array<{ platform: CtaDeliveryPlatform; suffix: string }> => {
  const platforms = new Set<CtaDeliveryPlatform>();
  for (const id of presetIds) {
    const platform = DELIVERY_PRESETS[id].platform;
    if (platform === 'youtube' || platform === 'tiktok') platforms.add(platform);
  }
  const like = resolveS4CtaPurpose(project) === 'like' && resolveCtaDesign(project) === 's4-block';
  if (like && platforms.has('youtube') && platforms.has('tiktok')) {
    return [
      { platform: 'youtube', suffix: '' },
      { platform: 'tiktok', suffix: '_tt' },
    ];
  }
  if (platforms.has('tiktok') && !platforms.has('youtube')) return [{ platform: 'tiktok', suffix: '' }];
  return [{ platform: 'youtube', suffix: '' }];
};
