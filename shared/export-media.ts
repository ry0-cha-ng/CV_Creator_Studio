import type { Project, SceneKey } from './schema/project';
import { activeTimeline, playbackClip } from './timeline';

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;

export type CardFrameSlot = 'stand' | 'aim' | 'result';

export type CardFrameRequest = {
  slot: CardFrameSlot;
  sceneKey: SceneKey;
  sourceTime: number;
  assetPath: string;
};

const even = (value: number): number => Math.max(2, 2 * Math.round(value / 2));

/**
 * 1080×1920 に cover したとき、元映像を縮小しても出力の画素が減らないサイズ。
 * 縮小する余地がなければ null（元ファイルのまま使う）。
 */
export const mezzanineDimensions = (
  width: number,
  height: number,
): { width: number; height: number } | null => {
  if (width < 2 || height < 2) return null;
  const scale = Math.max(OUTPUT_WIDTH / width, OUTPUT_HEIGHT / height);
  if (scale >= 0.999) return null;
  const targetWidth = even(width * scale);
  const targetHeight = even((targetWidth * height) / width);
  if (targetWidth >= width || targetHeight >= height) return null;
  return { width: targetWidth, height: targetHeight };
};

const includeSourceRange = (
  project: Project,
  assetId: string,
  sceneKey: SceneKey,
  ranges: Array<{ from: number; to: number }>,
  bounds: { start: number; end: number },
): void => {
  const scene = project.scenes.find((entry) => entry.sceneKey === sceneKey);
  const clip = project.clips.find((entry) => entry.id === scene?.clipId);
  const asset = project.assets.find((entry) => entry.id === clip?.assetId);
  if (!clip || asset?.id !== assetId) return;
  for (const range of ranges) {
    bounds.start = Math.min(bounds.start, clip.in + range.from);
    bounds.end = Math.max(bounds.end, clip.in + range.to);
  }
};

/** タイムラインが実際に表示するソース区間。前後に余裕を足してファイル長へ収める。 */
export const usedSourceSpan = (
  project: Project,
  assetId: string,
  assetDurationSec: number,
): { start: number; end: number } | null => {
  const bounds = { start: Number.POSITIVE_INFINITY, end: 0 };
  const cardSlots: Array<{ slot: CardFrameSlot; sceneKey: SceneKey }> =
    (project.cardLayout ?? 'stack') === 'stack'
      ? [
          { slot: 'stand', sceneKey: 'stand' },
          { slot: 'aim', sceneKey: 'aim' },
          { slot: 'result', sceneKey: 'throw' },
        ]
      : [{ slot: 'aim', sceneKey: 'aim' }];
  for (const item of activeTimeline(project).items) {
    const clip = playbackClip(project, item.sceneKey);
    const speed = item.speed ?? 1;
    const offset = item.sourceOffset ?? 0;
    if (clip?.assetId === assetId) {
      bounds.start = Math.min(bounds.start, clip.in + offset, clip.in);
      bounds.end = Math.max(
        bounds.end,
        clip.in + offset + item.duration * speed,
        clip.in + item.duration,
      );
    }
    if (item.sceneKey === 'card') {
      for (const slot of cardSlots) {
        if (project.cardStills[slot.slot]) continue;
        includeSourceRange(project, assetId, slot.sceneKey, [{ from: 0, to: item.duration }], bounds);
      }
    }
  }
  if (!Number.isFinite(bounds.start) || bounds.end <= bounds.start) return null;
  const duration = Math.max(bounds.end, assetDurationSec);
  return {
    start: Math.max(0, bounds.start - 0.5),
    end: Math.min(duration, bounds.end + 0.5),
  };
};

export const spanCoversFile = (
  span: { start: number; end: number },
  assetDurationSec: number,
): boolean => span.start <= 0.25 && span.end >= assetDurationSec - 0.25;

export const cardFrameRequests = (project: Project): CardFrameRequest[] => {
  const slots: Array<{ slot: CardFrameSlot; sceneKey: SceneKey }> =
    (project.cardLayout ?? 'stack') === 'stack'
      ? [
          { slot: 'stand', sceneKey: 'stand' },
          { slot: 'aim', sceneKey: 'aim' },
          { slot: 'result', sceneKey: 'throw' },
        ]
      : [{ slot: 'aim', sceneKey: 'aim' }];
  const requests: CardFrameRequest[] = [];
  for (const { slot, sceneKey } of slots) {
    if (project.cardStills[slot]) continue;
    const scene = project.scenes.find((item) => item.sceneKey === sceneKey);
    const clip = project.clips.find((item) => item.id === scene?.clipId);
    const asset = project.assets.find((item) => item.id === clip?.assetId);
    if (!clip || !asset || asset.type === 'image') continue;
    requests.push({
      slot,
      sceneKey,
      sourceTime: clip.in,
      assetPath: asset.path,
    });
  }
  return requests;
};
