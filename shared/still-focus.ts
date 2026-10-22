import { aimZoomBox, type AimZoomSurface } from './aim-zoom';
import type { CardLayout } from './schema/project';

export type StillFocus = { x: number; y: number };

export type CardStillRole = 'stand' | 'aim' | 'result';

type FrameSize = { width: number; height: number };

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const frameOf = (surface: AimZoomSurface): FrameSize => {
  const box = aimZoomBox(surface, 'ja');
  return { width: box.width, height: box.height };
};

/**
 * 完成カードとX用カードで、その枠が実際に使う画像サイズ。
 * 立ち位置・発動の小枠は LineupCardAim / LineupCardX45Aim と同じ。
 */
export const cardStillFrames = (
  layout: CardLayout,
  role: CardStillRole,
): { card: FrameSize; xCard: FrameSize } => {
  if (layout === 'stack') return { card: frameOf('card-stack'), xCard: frameOf('x-stack') };
  if (role === 'aim') return { card: frameOf('card-aim'), xCard: frameOf('x-aim') };
  return { card: { width: 412, height: 232 }, xCard: { width: 486, height: 354 } };
};

const cropGap = (frame: FrameSize, imageAspect: number): number => {
  if (frame.height <= 0 || imageAspect <= 0) return 0;
  return Math.abs(Math.log(frame.width / frame.height / imageAspect));
};

/** 手順4のプレビュー枠。合わせ位置はズーム枠と座標を揃えるため完成カード側。 */
export const stillPreviewFrame = (
  layout: CardLayout,
  role: CardStillRole,
): FrameSize & { matchesX: boolean } => {
  const frames = cardStillFrames(layout, role);
  if (role === 'aim') return { ...frames.card, matchesX: false };
  const imageAspect = 16 / 9;
  const useX = cropGap(frames.xCard, imageAspect) > cropGap(frames.card, imageAspect) + 0.02;
  return { ...(useX ? frames.xCard : frames.card), matchesX: useX };
};

const overflows = (frame: FrameSize, imageAspect: number, axis: 'x' | 'y'): boolean => {
  if (frame.height <= 0 || imageAspect <= 0) return false;
  const boxAspect = frame.width / frame.height;
  if (axis === 'x') return imageAspect > boxAspect + 0.015;
  return boxAspect > imageAspect + 0.015;
};

/** 完成カードかX用カードのどちらかで、その軸に切れしろがあるか。 */
export const stillFocusAxes = (
  layout: CardLayout,
  role: CardStillRole,
  imageAspect: number,
): { x: boolean; y: boolean } => {
  const frames = cardStillFrames(layout, role);
  return {
    x: overflows(frames.card, imageAspect, 'x') || overflows(frames.xCard, imageAspect, 'x'),
    y: overflows(frames.card, imageAspect, 'y') || overflows(frames.xCard, imageAspect, 'y'),
  };
};

export const stillFocusOf = (still?: { focus?: StillFocus }): StillFocus => ({
  x: clamp01(still?.focus?.x ?? 0.5),
  y: clamp01(still?.focus?.y ?? 0.5),
});

/** 中央のままなら項目を持たない。 */
export const normalizedStillFocus = (focus: StillFocus): StillFocus | undefined => {
  const next = { x: clamp01(focus.x), y: clamp01(focus.y) };
  if (Math.abs(next.x - 0.5) < 0.0005 && Math.abs(next.y - 0.5) < 0.0005) return undefined;
  return next;
};

const percent = (value: number): string => `${Math.round(clamp01(value) * 1000) / 10}%`;

export const stillObjectPosition = (still?: { focus?: StillFocus }): string => {
  const focus = stillFocusOf(still);
  return `${percent(focus.x)} ${percent(focus.y)}`;
};

/**
 * 画像をつかんで動かした量（px）を object-position に換算する。
 * 右へドラッグすると左が見える。切れしろのない軸は動かさない。
 */
export const panStillFocus = (
  focus: StillFocus,
  deltaX: number,
  deltaY: number,
  box: FrameSize,
  imageAspect: number,
): StillFocus => {
  if (!(box.width > 0) || !(box.height > 0) || !(imageAspect > 0)) return focus;
  const boxAspect = box.width / box.height;
  let x = focus.x;
  let y = focus.y;
  if (imageAspect > boxAspect) {
    const overflow = box.height * imageAspect - box.width;
    if (overflow > 0.5) x = clamp01(focus.x - deltaX / overflow);
  } else if (boxAspect > imageAspect) {
    const overflow = box.width / imageAspect - box.height;
    if (overflow > 0.5) y = clamp01(focus.y - deltaY / overflow);
  }
  return { x, y };
};
