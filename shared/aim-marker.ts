import { ANNOTATION_FRAME_WIDTH } from './annotation-style';
import type { Scene } from './schema/project';
import type { TimelineItem } from './schema/timeline';

/** 動画フレーム上のマーカー座標。X は幅、Y は高さのピクセル。 */
export const AIM_MARKER_FRAME = { width: ANNOTATION_FRAME_WIDTH, height: 1920 } as const;

export const markerFrameSpan = (axis: 'x' | 'y'): number =>
  axis === 'x' ? AIM_MARKER_FRAME.width : AIM_MARKER_FRAME.height;

/** 保存値 0〜1 を、フレーム左上からのピクセルへ戻す。 */
export const markerPixel = (normalized: number, axis: 'x' | 'y'): number =>
  normalized * markerFrameSpan(axis);

/** ピクセル指定を保存値 0〜1 に収め、フレームの外には出さない。 */
export const markerNormalizedFromPixel = (pixel: number, axis: 'x' | 'y'): number => {
  if (!Number.isFinite(pixel)) return 0;
  return Math.min(1, Math.max(0, pixel / markerFrameSpan(axis)));
};

type AimMarker = NonNullable<Scene['aimMarker']>;

/** 既存の位置・大きさを残したまま、照準マーカーの一部だけを書き換える。 */
export const withAimMarker = (
  current: Partial<AimMarker> | undefined,
  patch: Partial<AimMarker>,
): AimMarker => ({
  enabled: patch.enabled ?? current?.enabled ?? true,
  x: patch.x ?? current?.x ?? 0.5,
  y: patch.y ?? current?.y ?? 0.5,
  size: patch.size ?? current?.size ?? 1,
  at: patch.at ?? current?.at ?? 0,
});

/** 切り抜き開始から、マーカーを出し始める秒。未指定は最初から。 */
export const aimMarkerAppearAt = (marker: Pick<AimMarker, 'at'> | undefined): number => {
  const at = marker?.at;
  return typeof at === 'number' && Number.isFinite(at) ? Math.max(0, at) : 0;
};

/**
 * シーン先頭からの再生時刻を、切り抜き開始からのソース時刻へ戻す。
 * フリーズ中はソース時刻を止める。速度とソースオフセットは進める。
 */
export const sceneSourceTime = (
  frame: number,
  fps: number,
  scene: Pick<Scene, 'freeze'>,
  item?: Pick<TimelineItem, 'speed' | 'sourceOffset'>,
): number => {
  const speed = item?.speed && item.speed > 0 ? item.speed : 1;
  const sourceOffset = item?.sourceOffset ?? 0;
  const elapsed = (frame / Math.max(1, fps)) * speed + sourceOffset;
  const freeze = scene.freeze;
  if (!freeze?.enabled || speed !== 1 || sourceOffset !== 0) return elapsed;
  if (elapsed <= freeze.at) return elapsed;
  if (elapsed <= freeze.at + freeze.duration) return freeze.at;
  return elapsed - freeze.duration;
};

/** 書き出し上で、そのフレームに照準マーカーを描くか。 */
export const aimMarkerVisibleAt = (
  marker: Pick<AimMarker, 'enabled' | 'at'> | undefined,
  sourceTime: number,
): boolean => Boolean(marker?.enabled) && sourceTime + 1e-4 >= aimMarkerAppearAt(marker);
