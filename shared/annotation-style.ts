import type { AnnotationStyle } from './schema/project';

/** 動画・カードの出力幅。注釈の太さはこの幅のピクセルで持つ。 */
export const ANNOTATION_FRAME_WIDTH = 1080;

export const ANNOTATION_NAVY = '#0F1923';
export const ANNOTATION_LINE = '#ECE8E1';

/** ズーム内リングの内側直径 / ズーム画像の一辺。縁はこの外側に足す。 */
export const ZOOM_RING_RATIO = 0.13;

type StrokeBase = {
  red: number;
  edge: number;
  blur: number;
  blurAlpha: number;
  mat: number;
  shadowY: number;
  shadowBlur: number;
  shadowAlpha: number;
  line: number;
  lineEdge: number;
};

/**
 * 1080px 幅の出力フレームでの太さ。
 * プレビューは同じピクセルの描画を枠ごと縮小する。ここでプレビュー倍率を掛けない。
 */
const STROKES: Record<AnnotationStyle, StrokeBase> = {
  standard: {
    red: 4,
    edge: 3,
    blur: 6,
    blurAlpha: 0.7,
    mat: 10,
    shadowY: 12,
    shadowBlur: 32,
    shadowAlpha: 0.5,
    line: 3,
    lineEdge: 2,
  },
  strong: {
    red: 6,
    edge: 4,
    blur: 10,
    blurAlpha: 0.8,
    mat: 14,
    shadowY: 16,
    shadowBlur: 40,
    shadowAlpha: 0.6,
    line: 4,
    lineEdge: 3,
  },
  'strong-dim': {
    red: 6,
    edge: 4,
    blur: 10,
    blurAlpha: 0.8,
    mat: 14,
    shadowY: 16,
    shadowBlur: 40,
    shadowAlpha: 0.6,
    line: 4,
    lineEdge: 3,
  },
};

const RING_DIAMETER = 108;
const RING_GAP_DEG = 14;
const RING_TICK = 14;
const BRACKET_RATIO = 0.28;
const BRACKET_MIN = 24;
const BRACKET_MAX_RATIO = 0.35;
const TAB_SIZE = 26;
const TAB_PAD_X = 12;
const DIM_ALPHA = 0.42;
const DIM_R1_RATIO = 0.11;
const DIM_R2_RATIO = 0.45;
const DIM_R1_PAD = 16;

export type AnnotationMetrics = StrokeBase & {
  style: AnnotationStyle;
  /** ネイビーの線の太さ。赤の線の両側に縁が乗る。 */
  navy: number;
  ringDiameter: number;
  ringGapDeg: number;
  ringTick: number;
  bracketRatio: number;
  bracketMin: number;
  bracketMaxRatio: number;
  zoomRingRatio: number;
  tabSize: number;
  tabPadX: number;
  dim: boolean;
  dimAlpha: number;
  dimR1Ratio: number;
  dimR2Ratio: number;
  dimR1Pad: number;
};

/** 未指定・知らない値は標準。前回の emphasis は強調。 */
export const annotationStyleOf = (value: unknown): AnnotationStyle => {
  if (value === 'standard' || value === 'strong' || value === 'strong-dim') return value;
  if (value === 'emphasis') return 'strong';
  return 'standard';
};

/** 出力フレーム幅に比例した線幅。outputWidth はプレビューの表示幅ではなく出力幅。 */
export const getAnnotationStyle = (
  mode: unknown,
  outputWidth = ANNOTATION_FRAME_WIDTH,
): AnnotationMetrics => {
  const style = annotationStyleOf(mode);
  const scale = outputWidth > 0 ? outputWidth / ANNOTATION_FRAME_WIDTH : 1;
  const base = STROKES[style];
  const px = (value: number): number => value * scale;
  const red = px(base.red);
  const edge = px(base.edge);
  return {
    style,
    red,
    edge,
    blur: px(base.blur),
    blurAlpha: base.blurAlpha,
    mat: px(base.mat),
    shadowY: px(base.shadowY),
    shadowBlur: px(base.shadowBlur),
    shadowAlpha: base.shadowAlpha,
    line: px(base.line),
    lineEdge: px(base.lineEdge),
    navy: red + edge * 2,
    ringDiameter: px(RING_DIAMETER),
    ringGapDeg: RING_GAP_DEG,
    ringTick: px(RING_TICK),
    bracketRatio: BRACKET_RATIO,
    bracketMin: px(BRACKET_MIN),
    bracketMaxRatio: BRACKET_MAX_RATIO,
    zoomRingRatio: ZOOM_RING_RATIO,
    tabSize: px(TAB_SIZE),
    tabPadX: px(TAB_PAD_X),
    dim: style === 'strong-dim',
    dimAlpha: DIM_ALPHA,
    dimR1Ratio: DIM_R1_RATIO,
    dimR2Ratio: DIM_R2_RATIO,
    dimR1Pad: px(DIM_R1_PAD),
  };
};

/** 赤の線とマットの合計。拡大画像の外側に足す厚み。 */
export const zoomChromeThickness = (metrics: AnnotationMetrics): number => metrics.red + metrics.mat;

/**
 * 角括弧の腕。28% を基本に、24 以上かつ辺の 35% 以下。
 * 辺が小さく 35% が 24 を下回るときは、腕が辺に収まるほうを優先する。
 */
export const bracketArm = (
  side: number,
  metrics: Pick<AnnotationMetrics, 'bracketRatio' | 'bracketMin' | 'bracketMaxRatio'>,
): number => {
  const max = side * metrics.bracketMaxRatio;
  const raw = side * metrics.bracketRatio;
  return Math.min(max, Math.max(metrics.bracketMin, raw));
};

export type AnnotationPoint = { x: number; y: number };
export type AnnotationSegment = { x1: number; y1: number; x2: number; y2: number };

const rectCorners = (rect: { x: number; y: number; size: number }): AnnotationPoint[] => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.size, y: rect.y },
  { x: rect.x + rect.size, y: rect.y + rect.size },
  { x: rect.x, y: rect.y + rect.size },
];

const samePoint = (a: AnnotationPoint, b: AnnotationPoint): boolean =>
  Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;

const rectsOverlap = (
  a: { x: number; y: number; size: number },
  b: { x: number; y: number; size: number },
): boolean =>
  a.x < b.x + b.size &&
  a.x + a.size > b.x &&
  a.y < b.y + b.size &&
  a.y + a.size > b.y;

const convexHull = (points: AnnotationPoint[]): AnnotationPoint[] => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique: AnnotationPoint[] = [];
  for (const point of sorted) {
    const last = unique[unique.length - 1];
    if (last && samePoint(last, point)) continue;
    unique.push(point);
  }
  if (unique.length <= 1) return unique;
  const cross = (o: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (source: AnnotationPoint[]): AnnotationPoint[] => {
    const chain: AnnotationPoint[] = [];
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) {
        chain.pop();
      }
      chain.push(point);
    }
    return chain;
  };
  const lower = build(unique);
  const upper = build([...unique].reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

/**
 * 切り抜き範囲の角とズーム枠の角を結ぶ凸包の辺。
 * 重なっている、または辺が2本にならないときは引かない。
 */
export const connectorSegments = (
  crop: { x: number; y: number; size: number },
  frame: { x: number; y: number; size: number },
): AnnotationSegment[] => {
  if (rectsOverlap(crop, frame)) return [];
  const cropCorners = rectCorners(crop);
  const frameCorners = rectCorners(frame);
  const hull = convexHull([...cropCorners, ...frameCorners]);
  const onCrop = (point: AnnotationPoint): boolean => cropCorners.some((corner) => samePoint(corner, point));
  const onFrame = (point: AnnotationPoint): boolean => frameCorners.some((corner) => samePoint(corner, point));
  const edges: AnnotationSegment[] = [];
  for (let index = 0; index < hull.length; index += 1) {
    const start = hull[index];
    const end = hull[(index + 1) % hull.length];
    const startCrop = onCrop(start);
    const endCrop = onCrop(end);
    const startFrame = onFrame(start);
    const endFrame = onFrame(end);
    if (startCrop === endCrop || startFrame === endFrame) continue;
    if ((startCrop && endFrame) || (startFrame && endCrop)) {
      edges.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
    }
  }
  return edges.length === 2 ? edges : [];
};

export const annotationDim = ({
  shortSide,
  zoom,
  cropSize,
  center,
  metrics,
}: {
  shortSide: number;
  zoom: boolean;
  cropSize?: number;
  center: { x: number; y: number };
  metrics: AnnotationMetrics;
}): { r1: number; r2: number; center: { x: number; y: number } } | null => {
  if (!metrics.dim) return null;
  const r2 = shortSide * metrics.dimR2Ratio;
  let r1 = shortSide * metrics.dimR1Ratio;
  if (zoom && cropSize != null) {
    const circumradius = cropSize / Math.SQRT2 + metrics.dimR1Pad;
    if (circumradius > r1) r1 = circumradius;
  }
  return { r1, r2, center };
};

export const navyBlur = (metrics: AnnotationMetrics): string =>
  `drop-shadow(0 0 ${metrics.blur}px rgba(15,25,35,${metrics.blurAlpha}))`;
