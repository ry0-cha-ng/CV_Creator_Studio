import type { ReactNode } from 'react';
import {
  ANNOTATION_FRAME_WIDTH,
  ANNOTATION_NAVY,
  annotationDim,
  bracketArm,
  getAnnotationStyle,
  navyBlur,
  type AnnotationMetrics,
} from '../shared/annotation-style';
import type { AnnotationStyle } from '../shared/schema/project';

const ringDash = (
  radius: number,
  gapDeg: number,
): { dash: string; offset: number } => {
  const circ = 2 * Math.PI * radius;
  const gap = circ * (gapDeg / 360);
  const arc = circ * ((90 - gapDeg) / 360);
  return { dash: `${arc} ${gap}`, offset: arc + gap / 2 };
};

/** 切れ目のあるリング。直径は内側の空き。線は外へ太らせる。 */
export const HudRing = ({
  diameter,
  accent,
  metrics,
  ticks,
}: {
  diameter: number;
  accent: string;
  metrics: AnnotationMetrics;
  ticks: boolean;
}): ReactNode => {
  const hole = diameter / 2;
  const pathRadius = hole + metrics.navy / 2;
  const pad = metrics.navy / 2 + metrics.blur * 2 + 2;
  const box = (pathRadius + pad) * 2;
  const center = box / 2;
  const { dash, offset } = ringDash(pathRadius, metrics.ringGapDeg);
  const tick = metrics.ringTick;
  return (
    <svg
      width={box}
      height={box}
      style={{ display: 'block', overflow: 'visible', filter: navyBlur(metrics) }}
    >
      <circle
        cx={center}
        cy={center}
        r={pathRadius}
        fill="none"
        stroke={ANNOTATION_NAVY}
        strokeOpacity={0.9}
        strokeWidth={metrics.navy}
        strokeDasharray={dash}
        strokeDashoffset={offset}
      />
      <circle
        cx={center}
        cy={center}
        r={pathRadius}
        fill="none"
        stroke={accent}
        strokeWidth={metrics.red}
        strokeDasharray={dash}
        strokeDashoffset={offset}
      />
      {ticks &&
        [0, 90, 180, 270].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const x1 = center + cos * hole;
          const y1 = center + sin * hole;
          const x2 = center + cos * (hole - tick);
          const y2 = center + sin * (hole - tick);
          return (
            <g key={deg}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={ANNOTATION_NAVY}
                strokeOpacity={0.9}
                strokeWidth={metrics.navy}
                strokeLinecap="butt"
              />
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={accent}
                strokeWidth={metrics.red}
                strokeLinecap="butt"
              />
            </g>
          );
        })}
    </svg>
  );
};

/**
 * 合わせ位置のリング。内側は空で、縁は穴の外側に重ねる。
 * frameWidth は出力フレームの幅。プレビュー縮小は親の scale に任せる。
 */
export const AimMarker = ({
  x,
  y,
  accent,
  size = 1,
  style,
  frameWidth = ANNOTATION_FRAME_WIDTH,
  zIndex,
  ticks = true,
}: {
  x: number;
  y: number;
  accent: string;
  size?: number;
  style?: AnnotationStyle;
  frameWidth?: number;
  zIndex?: number;
  ticks?: boolean;
}): ReactNode => {
  const metrics = getAnnotationStyle(style, frameWidth);
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex,
      }}
    >
      <HudRing diameter={metrics.ringDiameter * size} accent={accent} metrics={metrics} ticks={ticks} />
    </div>
  );
};

/** 切り抜き範囲の四隅。内側の縁が範囲の外周に一致し、線は外へ伸びる。 */
export const CropBrackets = ({
  source,
  box,
  accent,
  metrics,
}: {
  source: { x: number; y: number; size: number };
  box: { width: number; height: number };
  accent: string;
  metrics: AnnotationMetrics;
}): ReactNode => {
  const arm = bracketArm(source.size, metrics);
  const half = metrics.navy / 2;
  const pad = half + metrics.blur * 2 + 2;
  const left = pad;
  const top = pad;
  const right = left + source.size;
  const bottom = top + source.size;
  const reach = Math.max(half, arm - half);
  const path = [
    `M ${left - half} ${top + reach} L ${left - half} ${top - half} L ${left + reach} ${top - half}`,
    `M ${right - reach} ${top - half} L ${right + half} ${top - half} L ${right + half} ${top + reach}`,
    `M ${right + half} ${bottom - reach} L ${right + half} ${bottom + half} L ${right - reach} ${bottom + half}`,
    `M ${left + reach} ${bottom + half} L ${left - half} ${bottom + half} L ${left - half} ${bottom - reach}`,
  ].join(' ');
  const width = source.size + pad * 2;
  const height = source.size + pad * 2;
  const paint = (stroke: string, strokeWidth: number, opacity?: number): ReactNode => (
    <path
      d={path}
      fill="none"
      stroke={stroke}
      strokeOpacity={opacity}
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
  );
  return (
    <svg
      width={width}
      height={height}
      style={{
        position: 'absolute',
        left: `${((source.x - pad) / box.width) * 100}%`,
        top: `${((source.y - pad) / box.height) * 100}%`,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 2,
        filter: navyBlur(metrics),
      }}
    >
      {paint(ANNOTATION_NAVY, metrics.navy, 0.9)}
      {paint(accent, metrics.red)}
    </svg>
  );
};

/** 強調＋減光のときだけ、画像の直上に円形の減光を置く。 */
export const AnnotationDim = ({
  style,
  frameWidth = ANNOTATION_FRAME_WIDTH,
  center,
  shortSide,
  zoom,
  cropSize,
}: {
  style?: AnnotationStyle;
  frameWidth?: number;
  center: { x: number; y: number };
  shortSide: number;
  zoom: boolean;
  cropSize?: number;
}): ReactNode => {
  const metrics = getAnnotationStyle(style, frameWidth);
  const dim = annotationDim({ shortSide, zoom, cropSize, center, metrics });
  if (!dim) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1,
        background: `radial-gradient(circle at ${dim.center.x * 100}% ${dim.center.y * 100}%, rgba(15,25,35,0) ${dim.r1}px, rgba(15,25,35,${metrics.dimAlpha}) ${dim.r2}px)`,
      }}
    />
  );
};
