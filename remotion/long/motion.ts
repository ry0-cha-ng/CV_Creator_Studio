import type { MotionKind } from '../../shared/long/schema';

/**
 * 簡易モーション。経過フレームだけから計算し、前フレームの状態を蓄積しない
 * （任意のフレームへのシーク・部分書き出しでも同じ見た目になる）。
 */
export type MotionStyle = { scale: number; dx: number; dy: number; opacity: number; rotate: number };

const IDENTITY: MotionStyle = { scale: 1, dx: 0, dy: 0, opacity: 1, rotate: 0 };

export const motionAt = (
  kind: MotionKind,
  elapsedFrames: number,
  durationFrames: number,
  fps: number,
  /** 揺れ・跳ねの大きさの基準（px） */
  size = 100,
): MotionStyle => {
  const t = elapsedFrames / fps;
  const remaining = (durationFrames - elapsedFrames) / fps;
  switch (kind) {
    case 'none':
      return IDENTITY;
    case 'fade': {
      const fade = 0.15;
      const opacity = Math.min(1, Math.max(0, t / fade), Math.max(0, remaining / fade));
      return { ...IDENTITY, opacity };
    }
    case 'pop': {
      // 0.18秒で 0.6 → 1.08 → 1.0
      const p = Math.min(1, t / 0.18);
      const overshoot = p < 1 ? 0.6 + 0.48 * Math.sin((p * Math.PI) / 2) : 1;
      const settle = p >= 1 ? 1 + 0.08 * Math.max(0, 1 - (t - 0.18) / 0.1) : overshoot;
      const fadeOut = Math.min(1, Math.max(0, remaining / 0.1));
      return { ...IDENTITY, scale: p < 1 ? overshoot : settle, opacity: Math.min(1, t / 0.05) * fadeOut };
    }
    case 'bounce': {
      // 単発バウンス：0.45秒で1回跳ねて着地
      const p = Math.min(1, t / 0.45);
      const height = p < 1 ? Math.sin(p * Math.PI) * (1 - p * 0.3) : 0;
      const squash = p < 1 ? 1 + 0.06 * Math.sin(p * Math.PI * 2) : 1;
      return { ...IDENTITY, dy: -height * size * 0.25, scale: squash };
    }
    case 'shake': {
      const decay = Math.max(0, 1 - t / 0.6);
      return {
        ...IDENTITY,
        dx: Math.sin(t * Math.PI * 2 * 14) * size * 0.06 * decay,
        rotate: Math.sin(t * Math.PI * 2 * 11) * 3 * decay,
      };
    }
  }
};

export const motionTransform = (style: MotionStyle): string =>
  `translate(${style.dx.toFixed(2)}px, ${style.dy.toFixed(2)}px) rotate(${style.rotate.toFixed(2)}deg) scale(${style.scale.toFixed(4)})`;
