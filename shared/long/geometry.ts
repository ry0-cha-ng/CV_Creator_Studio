import type { Aspect, Easing, Fit, NormRect } from './schema';

/**
 * 可変比率ズーム・PiP・図形の座標変換。
 * 正規化矩形は保存用、実寸（px）は計算用。縦横の比率は必ず実寸で扱い、非等方の伸縮はしない。
 */

export type Size = { w: number; h: number };
export type PxRect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

const EPSILON = 1e-6;

export const OUTPUT_SIZE: Size = { w: 1920, h: 1080 };

export const isFiniteRect = (rect: NormRect): boolean =>
  [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value));

/** 0〜1 の範囲に収まり、幅・高さが正の矩形か。 */
export const rectProblem = (rect: NormRect): string | null => {
  if (!isFiniteRect(rect)) return '数値ではない値があります';
  if (rect.w <= 0 || rect.h <= 0) return '幅と高さは0より大きくしてください';
  if (rect.x < -EPSILON || rect.y < -EPSILON) return '範囲の外にはみ出しています';
  if (rect.x + rect.w > 1 + EPSILON || rect.y + rect.h > 1 + EPSILON) return '範囲の外にはみ出しています';
  return null;
};

export const toPx = (rect: NormRect, size: Size): PxRect => ({
  x: rect.x * size.w,
  y: rect.y * size.h,
  w: rect.w * size.w,
  h: rect.h * size.h,
});

export const toNorm = (rect: PxRect, size: Size): NormRect => ({
  x: rect.x / size.w,
  y: rect.y / size.h,
  w: rect.w / size.w,
  h: rect.h / size.h,
});

/** 比率（px の幅/高さ）。'free' は null。 */
export const aspectRatio = (aspect: Aspect, source: Size): number | null => {
  if (aspect === 'free') return null;
  if (aspect === 'source') return source.w / source.h;
  return aspect.w / aspect.h;
};

export const pxAspect = (rect: NormRect, size: Size): number => (rect.w * size.w) / (rect.h * size.h);

/** はみ出した矩形を、大きさ→位置の順で範囲内に収める（比率は保つ）。 */
export const clampRect = (rect: NormRect): NormRect => {
  let { x, y, w, h } = rect;
  const shrink = Math.max(w, h, 1) > 1 ? 1 / Math.max(w, h) : 1;
  if (shrink < 1) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    w *= shrink;
    h *= shrink;
    x = cx - w / 2;
    y = cy - h / 2;
  }
  x = Math.min(1 - w, Math.max(0, x));
  y = Math.min(1 - h, Math.max(0, y));
  return { x, y, w, h };
};

/**
 * 比率を当てはめる。中心と面積を保ち、範囲を超えたら比率を保ったまま縮小・移動する。
 * 返り値は実際に適用した値（入力と表示の値を一致させるため）。
 */
export const applyAspect = (rect: NormRect, ratio: number | null, size: Size): NormRect => {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return clampRect(rect);
  const pw = Math.max(rect.w * size.w, 1);
  const ph = Math.max(rect.h * size.h, 1);
  const area = pw * ph;
  let nw = Math.sqrt(area * ratio);
  let nh = Math.sqrt(area / ratio);
  const fit = Math.min(1, size.w / nw, size.h / nh);
  nw *= fit;
  nh *= fit;
  const cx = (rect.x + rect.w / 2) * size.w;
  const cy = (rect.y + rect.h / 2) * size.h;
  return clampRect({ x: (cx - nw / 2) / size.w, y: (cy - nh / 2) / size.h, w: nw / size.w, h: nh / size.h });
};

/**
 * 中心を基準に拡大（切り抜きを縮める）。factor > 1 で拡大。
 * 端では中心をずらして素材内に収める。
 */
export const zoomCrop = (crop: NormRect, factor: number): NormRect => {
  if (!Number.isFinite(factor) || factor <= 0) return crop;
  const w = crop.w / factor;
  const h = crop.h / factor;
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
};

export type FitLayout = {
  /** 等方スケール（出力px / 素材px） */
  scale: number;
  /** 表示枠（出力px） */
  dest: PxRect;
  /** 切り抜き部分が出力上に占める矩形（出力px）。contain では dest の内側、cover では外側にはみ出す */
  content: PxRect;
  /** 素材フレーム全体の出力上の位置（出力px）。video 要素の配置に使う */
  frame: PxRect;
  /** 実際に見える部分（content と dest の交差） */
  visible: PxRect;
};

export const intersect = (a: PxRect, b: PxRect): PxRect => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
};

/**
 * 切り抜き（素材の正規化矩形）を表示枠（出力の正規化矩形）へ収める。
 * contain：min(dw/cw, dh/ch)、cover：max(dw/cw, dh/ch)。中心揃え。
 */
export const fitLayout = (
  crop: NormRect,
  rect: NormRect,
  fit: Fit,
  source: Size,
  output: Size = OUTPUT_SIZE,
): FitLayout => {
  const cropPx = toPx(crop, source);
  const dest = toPx(rect, output);
  const scale =
    fit === 'contain'
      ? Math.min(dest.w / cropPx.w, dest.h / cropPx.h)
      : Math.max(dest.w / cropPx.w, dest.h / cropPx.h);
  const cw = cropPx.w * scale;
  const ch = cropPx.h * scale;
  const content: PxRect = {
    x: dest.x + (dest.w - cw) / 2,
    y: dest.y + (dest.h - ch) / 2,
    w: cw,
    h: ch,
  };
  const frame: PxRect = {
    x: content.x - cropPx.x * scale,
    y: content.y - cropPx.y * scale,
    w: source.w * scale,
    h: source.h * scale,
  };
  return { scale, dest, content, frame, visible: intersect(content, dest) };
};

/** 素材の正規化座標 → 出力px（元フレーム→切り抜き→スケール→表示枠）。 */
export const sourceToOutput = (point: Point, layout: FitLayout): Point => ({
  x: layout.frame.x + point.x * layout.frame.w,
  y: layout.frame.y + point.y * layout.frame.h,
});

/** 出力px → 素材の正規化座標（クリック編集用の逆変換）。 */
export const outputToSource = (point: Point, layout: FitLayout): Point => ({
  x: (point.x - layout.frame.x) / layout.frame.w,
  y: (point.y - layout.frame.y) / layout.frame.h,
});

export const pointInside = (point: Point, rect: PxRect): boolean =>
  point.x >= rect.x - EPSILON &&
  point.y >= rect.y - EPSILON &&
  point.x <= rect.x + rect.w + EPSILON &&
  point.y <= rect.y + rect.h + EPSILON;

export const ease = (progress: number, easing: Easing): number => {
  const p = Math.min(1, Math.max(0, progress));
  if (easing === 'step') return p < 1 ? 0 : 1;
  if (easing === 'linear') return p;
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};

export const lerpRect = (a: NormRect, b: NormRect, t: number): NormRect => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});

/**
 * 比率ロック中の補間。中心と大きさを別々に補間し、比率は ratio に固定する。
 */
export const lerpRectLocked = (
  a: NormRect,
  b: NormRect,
  t: number,
  ratio: number,
  size: Size,
): NormRect => {
  const mixed = lerpRect(a, b, t);
  const cx = (mixed.x + mixed.w / 2) * size.w;
  const cy = (mixed.y + mixed.h / 2) * size.h;
  const aw = a.w * size.w + (b.w * size.w - a.w * size.w) * t;
  const w = aw;
  const h = w / ratio;
  return { x: (cx - w / 2) / size.w, y: (cy - h / 2) / size.h, w: w / size.w, h: h / size.h };
};

// ---------------------------------------------------------------------------
// プリセット・PiP配置

export type ZoomPreset = {
  id: string;
  label: string;
  /** 素材内の初期切り抜き（UIの位置は素材ごとに違うので、あくまで初期値） */
  crop: NormRect;
  cropAspect: Aspect;
  /** 出力の初期表示枠 */
  rect: NormRect;
};

const square = (cx: number, cy: number, heightNorm: number, size: Size): NormRect => {
  const h = heightNorm;
  const w = (heightNorm * size.h) / size.w;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
};

export const zoomPresets = (source: Size): ZoomPreset[] => [
  {
    id: 'map',
    label: 'マップ 1:1',
    crop: clampRect(square(0.09, 0.16, 0.28, source)),
    cropAspect: { w: 1, h: 1 },
    rect: clampRect(square(0.16, 0.5, 0.42, OUTPUT_SIZE)),
  },
  {
    id: 'killfeed',
    label: 'キルログ 横長',
    crop: { x: 0.76, y: 0.02, w: 0.225, h: 0.1 },
    cropAspect: { w: 4, h: 1 },
    rect: { x: 0.6, y: 0.14, w: 0.36, h: 0.16 },
  },
  {
    id: 'aim',
    label: '照準',
    crop: clampRect(square(0.5, 0.5, 0.3, source)),
    cropAspect: { w: 1, h: 1 },
    rect: clampRect(square(0.8, 0.65, 0.4, OUTPUT_SIZE)),
  },
  {
    id: 'position',
    label: '立ち位置',
    crop: { x: 0.25, y: 0.2, w: 0.5, h: 0.6 },
    cropAspect: 'source',
    rect: { x: 0.55, y: 0.08, w: 0.4, h: 0.4 },
  },
];

export const CORNER_SIZE = 0.3;
export const CORNER_MARGIN = 0.03;

export const cornerRect = (
  corner: 'tl' | 'tr' | 'bl' | 'br',
  widthNorm = CORNER_SIZE,
  ratio = 16 / 9,
  output: Size = OUTPUT_SIZE,
): NormRect => {
  const w = widthNorm;
  const h = (widthNorm * output.w) / ratio / output.h;
  const mx = CORNER_MARGIN;
  const my = (CORNER_MARGIN * output.w) / output.h;
  const x = corner.endsWith('l') ? mx : 1 - mx - w;
  const y = corner.startsWith('t') ? my : 1 - my - h;
  return { x, y, w, h };
};

/** 分割表示の主・副の枠。split-h は左右、split-v は上下。 */
export const splitRects = (
  layout: 'split-h' | 'split-v',
  ratio: number,
): { main: NormRect; secondary: NormRect } => {
  const r = Math.min(0.8, Math.max(0.2, ratio));
  return layout === 'split-h'
    ? { main: { x: 0, y: 0, w: r, h: 1 }, secondary: { x: r, y: 0, w: 1 - r, h: 1 } }
    : { main: { x: 0, y: 0, w: 1, h: r }, secondary: { x: 0, y: r, w: 1, h: 1 - r } };
};
