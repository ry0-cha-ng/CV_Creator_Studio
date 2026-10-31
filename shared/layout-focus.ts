import { s4CtaRect } from './s4-cta';
import type { Scene } from './schema/project';
import type { TimelineItem } from './schema/timeline';
import { S7_FRAME } from './s7-cta';

/**
 * 縦型変換 focus。映像矩形と読みやすさの定数。
 * legacyAnchorRect は blur-fit の映像窓（S7_FRAME）を参照し、値を二重に持たない。
 */
export const LAYOUT_FOCUS = {
  video: { x: 0, y: 150, w: 1080, h: 1430 },
  fade: { top: { from: 150, to: 290 }, bottom: { from: 1524, to: 1580 } },
  grade: { contrast: 1.06, saturate: 1.1 },
  vignette: { cx: 0.5, cy: 0.64, rx: 0.72, ry: 0.58, inner: 0.48, color: '#0F1923', alpha: 0.34 },
  topGradient: {
    color: '#0F1923',
    stops: [
      [0, 0.9],
      [260, 0.84],
      [470, 0.7],
      [640, 0.32],
      [800, 0],
    ] as const,
  },
  legacyAnchorRect: {
    x: 0,
    y: S7_FRAME.footageTop,
    w: S7_FRAME.width,
    h: S7_FRAME.footageHeight,
  },
  hookStroke: { color: 'rgba(15,25,35,0.95)', outside: 7 },
  hookShadow: '0 6px 18px rgba(0,0,0,0.65)',
  signatureShadow: 'drop-shadow(0 2px 10px rgba(0,0,0,0.75))',
  cvCtaPanel: { bg: 'rgba(6,9,13,0.72)', radius: 16 },
  signatureYWhenCvCtaOverlaps: 1440,
} as const;

/**
 * プレビュー専用。iPhone の通常の Shorts 画面を 2026-10-24 に実測し、動画座標へ戻した値。
 * ホーム／ショートなどの下部タブは再生領域の外で、動画座標にもセーフゾーンにも含めない。
 * 書き出しには重ねない。
 */
export const YT_SHORTS_UI_GUIDE = {
  top: { y: [175, 240] as const },
  rightRail: { x: [915, 1080] as const, y: [1040, 1730] as const },
  /** チャンネル名・タイトル・音声・シーク。タブバーは含まない。 */
  bottom: { y: [1645, 1920] as const },
  sideCrop: 50,
  /** タブの高さ ÷ 画面幅。iPhone の YouTube（83pt / 393pt）。動画の下の不透明な帯。 */
  tabBar: 83 / 393,
} as const;

const YT_SHORTS_FRAME = { width: 1080, height: 1920 } as const;

/** 投稿プレビュー。左右を切った 9:16 をタブの上いっぱいに置き、タブには映像を載せない。 */
export const ytShortsPlayback = (
  width: number,
): {
  viewportHeight: number;
  tabHeight: number;
  phoneHeight: number;
  playerWidth: number;
  playerOffset: number;
} => {
  const visible = YT_SHORTS_FRAME.width - YT_SHORTS_UI_GUIDE.sideCrop * 2;
  const viewportHeight = (width * YT_SHORTS_FRAME.height) / visible;
  const tabHeight = width * YT_SHORTS_UI_GUIDE.tabBar;
  return {
    viewportHeight,
    tabHeight,
    phoneHeight: viewportHeight + tabHeight,
    playerWidth: (width * YT_SHORTS_FRAME.width) / visible,
    playerOffset: (width * YT_SHORTS_UI_GUIDE.sideCrop) / visible,
  };
};

/** 幅 / 高さ。投稿プレビューの電話枠を欄の高さに収める。 */
export const ytShortsPhoneAspect = (): number => 1 / ytShortsPlayback(1).phoneHeight;

/** 新規プロジェクトで focus にするシーン。カード（S5）と T-GUIDE 相当は含まない。 */
export const FOCUS_DEFAULT_SCENE_KEYS = ['hook', 'throw', 'demo', 'loop'] as const;

/** 切り抜く範囲の拡大率。1 は高さいっぱい。サムネイルのフォーカスと同じ範囲。 */
export const FOCUS_CROP_ZOOM = { min: 1, max: 1.5, step: 0.01 } as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const roundFocusZoom = (zoom: number | undefined): number => {
  const value = typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : FOCUS_CROP_ZOOM.min;
  const rounded = Number(value.toFixed(2));
  return clamp(rounded, FOCUS_CROP_ZOOM.min, FOCUS_CROP_ZOOM.max);
};

export const focusCropZoomOf = (scene: { cropZoom?: number } | undefined): number =>
  roundFocusZoom(scene?.cropZoom);

/** フォーカスの縦位置。未指定は中央。 */
export const focusCropCenterYOf = (scene: { cropCenterY?: number } | undefined): number => {
  const value = scene?.cropCenterY;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return clamp(value, 0, 1);
};

export type FocusCrop = { x: number; y: number; w: number; h: number; scale: number };

/**
 * 元フレームから、フォーカス映像矩形へ入れる範囲。小数のまま返す。
 * zoom 1 は高さいっぱい。大きくすると範囲が狭まり、横は cropCenterX、縦は cropCenterY。
 * 縦位置の未指定は中央。範囲が高さいっぱいのときは上下に動かせない。
 */
export const resolveFocusCrop = (
  frame: { w: number; h: number },
  cropCenterX: number,
  zoom = 1,
  cropCenterY = 0.5,
): FocusCrop => {
  const ratio = LAYOUT_FOCUS.video.w / LAYOUT_FOCUS.video.h;
  const z = roundFocusZoom(zoom);
  const centerY = focusCropCenterYOf({ cropCenterY });
  let height = frame.h / z;
  let width = height * ratio;
  if (width > frame.w) {
    width = frame.w;
    height = width / ratio;
  }
  const x = clamp(cropCenterX * frame.w - width / 2, 0, Math.max(0, frame.w - width));
  const y = clamp(centerY * frame.h - height / 2, 0, Math.max(0, frame.h - height));
  return {
    x,
    y,
    w: width,
    h: height,
    scale: LAYOUT_FOCUS.video.h / height,
  };
};

export const focusCropContains = (
  crop: FocusCrop,
  srcX: number,
  srcY: number,
): boolean =>
  srcX >= crop.x &&
  srcX <= crop.x + crop.w &&
  srcY >= crop.y &&
  srcY <= crop.y + crop.h;

export type FocusFootagePlacement = {
  /** 1080×1920 に対する映像矩形の割合。 */
  box: { x: number; y: number; w: number; h: number };
  /** 映像矩形に対する、元フレーム全体を置いた要素の割合。左上は負になる。 */
  video: { x: number; y: number; w: number; h: number };
};

/**
 * フォーカス本編と同じ画素を、1080×1920 の割合で置く。
 * 狙いズームの拡大絵はこれを使う。中央切り抜きの object-fit: cover で読むと、
 * 画面座標が元フレームの別の高さ（合わせ位置より上の空）を指す。
 */
export const focusFootagePlacement = (
  frame: { w: number; h: number },
  cropCenterX: number,
  zoom = 1,
  cropCenterY = 0.5,
): FocusFootagePlacement => {
  const crop = resolveFocusCrop(frame, cropCenterX, zoom, cropCenterY);
  const box = LAYOUT_FOCUS.video;
  return {
    box: {
      x: box.x / S7_FRAME.width,
      y: box.y / S7_FRAME.height,
      w: box.w / S7_FRAME.width,
      h: box.h / S7_FRAME.height,
    },
    video: {
      x: -crop.x / crop.w,
      y: -crop.y / crop.h,
      w: frame.w / crop.w,
      h: frame.h / crop.h,
    },
  };
};

/** 元の録画のピクセルを、フォーカス映像矩形上の画面座標へ直す。 */
export const focusScreenPoint = (
  frame: { w: number; h: number },
  cropCenterX: number,
  srcX: number,
  srcY: number,
  zoom = 1,
  cropCenterY = 0.5,
): { x: number; y: number; inside: boolean } => {
  const crop = resolveFocusCrop(frame, cropCenterX, zoom, cropCenterY);
  return {
    x: (srcX - crop.x) * crop.scale + LAYOUT_FOCUS.video.x,
    y: (srcY - crop.y) * crop.scale + LAYOUT_FOCUS.video.y,
    inside: focusCropContains(crop, srcX, srcY),
  };
};

const videoRectContains = (x: number, y: number): boolean => {
  const box = LAYOUT_FOCUS.video;
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
};

export type FocusEffectInput = {
  aim?: { enabled: boolean; x: number; y: number } | null;
  zoom?: { enabled: boolean; x: number; y: number } | null;
  arrow?: { x1: number; y1: number; x2: number; y2: number } | null;
};

/** 範囲の外にある演出の名前。照準・ズームは元の録画の 0〜1、矢印は 1080×1920 の 0〜1。 */
export const focusOutsideNames = (
  frame: { w: number; h: number },
  cropCenterX: number,
  effects: FocusEffectInput,
  zoom = 1,
  cropCenterY = 0.5,
): string[] => {
  const names: string[] = [];
  if (effects.aim?.enabled) {
    const point = focusScreenPoint(frame, cropCenterX, effects.aim.x * frame.w, effects.aim.y * frame.h, zoom, cropCenterY);
    if (!point.inside) names.push('照準マーカー');
  }
  if (effects.zoom?.enabled) {
    const point = focusScreenPoint(frame, cropCenterX, effects.zoom.x * frame.w, effects.zoom.y * frame.h, zoom, cropCenterY);
    if (!point.inside) names.push('ズームの中心');
  }
  if (effects.arrow) {
    const start = videoRectContains(effects.arrow.x1 * S7_FRAME.width, effects.arrow.y1 * S7_FRAME.height);
    const end = videoRectContains(effects.arrow.x2 * S7_FRAME.width, effects.arrow.y2 * S7_FRAME.height);
    if (!start || !end) names.push('矢印');
  }
  return names;
};

export const focusOutsideDetail = (
  frame: { w: number; h: number },
  cropCenterX: number,
  effects: FocusEffectInput,
  zoom = 1,
  cropCenterY = 0.5,
): string | null => {
  const names = focusOutsideNames(frame, cropCenterX, effects, zoom, cropCenterY);
  if (names.length === 0) return null;
  return `${names.join('・')}が切り抜く範囲の外にあります。切り抜く位置を動かすか、縦型変換を変えてください`;
};

/** CV誘導CTAと署名が重なるときだけ、署名を指定の y に下げる。重ならなければそのまま。 */
export const cvSignatureTop = (watermarkTop: number = S7_FRAME.watermark.y): number => {
  const cta = s4CtaRect();
  const mark = S7_FRAME.watermark;
  const overlaps =
    mark.x < cta.x + cta.width &&
    mark.x + mark.width > cta.x &&
    watermarkTop < cta.y + cta.height &&
    watermarkTop + mark.height > cta.y;
  return overlaps ? LAYOUT_FOCUS.signatureYWhenCvCtaOverlaps : watermarkTop;
};

export const focusFrameOf = (
  width: number | undefined,
  height: number | undefined,
): { w: number; h: number } => ({
  w: width && width > 0 ? width : 1920,
  h: height && height > 0 ? height : 1080,
});

export const focusTopGradientCss = (): string => {
  const hex = LAYOUT_FOCUS.topGradient.color.replace('#', '');
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const stops = LAYOUT_FOCUS.topGradient.stops
    .map(([offset, alpha]) => `rgba(${r},${g},${b},${alpha}) ${offset}px`)
    .join(', ');
  return `linear-gradient(to bottom, ${stops})`;
};

export const focusVideoMaskCss = (): string => {
  const box = LAYOUT_FOCUS.video;
  const top = LAYOUT_FOCUS.fade.top.to - LAYOUT_FOCUS.fade.top.from;
  const bottomFrom = LAYOUT_FOCUS.fade.bottom.from - box.y;
  const bottomTo = LAYOUT_FOCUS.fade.bottom.to - box.y;
  return `linear-gradient(to bottom, transparent 0px, #000 ${top}px, #000 ${bottomFrom}px, transparent ${bottomTo}px)`;
};

export const focusVignetteCss = (): string => {
  const vignette = LAYOUT_FOCUS.vignette;
  return `radial-gradient(ellipse ${vignette.rx * 100}% ${vignette.ry * 100}% at ${vignette.cx * 100}% ${vignette.cy * 100}%, transparent ${vignette.inner * 100}%, rgba(15,25,35,${vignette.alpha}) 100%)`;
};

export const sceneFocusEffects = (
  scene: Pick<Scene, 'aimMarker' | 'zoom'>,
  arrow: TimelineItem['arrow'],
): FocusEffectInput => ({
  aim: scene.aimMarker,
  zoom: scene.zoom,
  arrow,
});
