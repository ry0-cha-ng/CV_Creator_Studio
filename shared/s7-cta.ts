import type { Project } from './schema/project';

/** blur-fit の映像窓。S7 の CTA 帯はこの下端に合わせる。 */
const FOOTAGE_TOP = 656;
const FOOTAGE_HEIGHT = 608;
const FOOTAGE_BOTTOM = FOOTAGE_TOP + FOOTAGE_HEIGHT;
const PLATE_HEIGHT = 170;

/**
 * S7 の主CTAと Brand Lockup。位置は日英・全定点で固定する。
 * CTA は映像下端の半透明帯の上。Brand Lockup は映像の外、その下。
 */
export const S7_FRAME = {
  width: 1080,
  height: 1920,
  footageTop: FOOTAGE_TOP,
  footageHeight: FOOTAGE_HEIGHT,
  footageBottom: FOOTAGE_BOTTOM,
  plateTop: FOOTAGE_BOTTOM - PLATE_HEIGHT,
  plateHeight: PLATE_HEIGHT,
  plateBackground:
    'linear-gradient(to bottom, rgba(15,25,35,0) 0%, rgba(7,9,12,0.86) 10%, rgba(7,9,12,0.92) 100%)',
  ctaTop: 1112,
  ctaFontSize: 62,
  ctaLineHeight: 1.12,
  lockupTop: 1308,
  lockupHeight: 56,
  lockupWidth: 334,
  chromeTop: 200,
  chromeBottom: 1500,
  watermark: { x: 72, y: 1420, width: 230, height: 48 },
} as const;

const LEGACY_CTA = {
  ja: ['定点はプロフのリンクから保存', 'この定点を\n[ClutchVaultに保存]', 'この定点をClutchVaultに保存'],
  en: ['Save this lineup → ClutchVault', 'Save this lineup →\n[ClutchVault]'],
} as const;

type Box = { x: number; y: number; width: number; height: number };

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const wording = (text: string): string => text.replace(/[[\]]/g, '').replace(/\s+/g, '');

export const s7CtaLineCount = (text: string): number =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;

/** 旧定型文だけ、2行・2行目アクセントの定型文へ置き換える。手入力はそのまま。 */
export const refreshLegacyCta = <T extends { captions: Project['captions'] }>(
  project: T,
  next: { ja: string; en: string },
): T => ({
  ...project,
  captions: project.captions.map((caption) => {
    if (caption.id !== 'cta') return caption;
    const ja = (LEGACY_CTA.ja as readonly string[]).includes(caption.text.ja.trim()) ? next.ja : caption.text.ja;
    const en = (LEGACY_CTA.en as readonly string[]).includes(caption.text.en.trim()) ? next.en : caption.text.en;
    if (ja === caption.text.ja && en === caption.text.en) return caption;
    return { ...caption, text: { ...caption.text, ja, en } };
  }),
});

export const s7CtaDuplicate = (project: Project): boolean => {
  if (project.templateId !== 't-std') return false;
  const cta = project.captions.find((caption) => caption.id === 'cta');
  if (!cta || cta.hidden) return false;
  return (['ja', 'en'] as const).some((language) => {
    const main = wording(cta.text[language]);
    if (!main) return false;
    return project.captions.some((other) => {
      if (other.id === cta.id || other.hidden || other.sceneKey !== 'loop') return false;
      return wording(other.text[language]) === main;
    });
  });
};

/** 固定位置のCTAと Brand Lockup が、互い・H1gher・プラットフォームUIに重なるとき文言を返す。 */
export const s7BrandOverlapDetail = (lineCount: number): string | null => {
  if (lineCount <= 0) return null;
  const cta: Box = {
    x: 80,
    y: S7_FRAME.ctaTop,
    width: 920,
    height: lineCount * S7_FRAME.ctaFontSize * S7_FRAME.ctaLineHeight,
  };
  const lockup: Box = {
    x: (S7_FRAME.width - S7_FRAME.lockupWidth) / 2,
    y: S7_FRAME.lockupTop,
    width: S7_FRAME.lockupWidth,
    height: S7_FRAME.lockupHeight,
  };
  const chromeTop: Box = { x: 0, y: 0, width: S7_FRAME.width, height: S7_FRAME.chromeTop };
  const chromeBottom: Box = {
    x: 0,
    y: S7_FRAME.chromeBottom,
    width: S7_FRAME.width,
    height: S7_FRAME.height - S7_FRAME.chromeBottom,
  };
  if (intersects(cta, lockup)) return 'CTAが Brand Lockup に重なっています。2行までに収めてください';
  if (intersects(cta, S7_FRAME.watermark) || intersects(lockup, S7_FRAME.watermark)) {
    return 'CTAか Brand Lockup が H1gher に重なっています';
  }
  if (
    intersects(cta, chromeTop) ||
    intersects(lockup, chromeTop) ||
    intersects(cta, chromeBottom) ||
    intersects(lockup, chromeBottom)
  ) {
    return 'CTAか Brand Lockup がプラットフォームUIに重なっています';
  }
  return null;
};
