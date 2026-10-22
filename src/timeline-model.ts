export const CLIP_DRAG_TYPE = 'application/x-cv-clip';
export const AUDIO_DRAG_TYPE = 'application/x-cv-audio';

export type TimelineSelection =
  | { kind: 'clip'; id: string }
  | { kind: 'caption'; id: string }
  | { kind: 'effect'; id: string }
  | { kind: 'volume'; id: string; channel: 'game' | 'bgm' }
  | { kind: 'bgm' };

export type TimelineTrackId = 'v2' | 'v1' | 'a1' | 'a2' | 'a3';

export const mixKeyForTrack: Record<
  TimelineTrackId,
  'hideCaptions' | 'hideVideo' | 'muteGame' | 'muteBgm' | 'muteEffects'
> = {
  v2: 'hideCaptions',
  v1: 'hideVideo',
  a1: 'muteGame',
  a2: 'muteBgm',
  a3: 'muteEffects',
};

export const encodeAudioDrag = (kind: 'bgm' | 'se', id: string): string => `${kind}:${id}`;

export const decodeAudioDrag = (value: string): { kind: 'bgm' | 'se'; id: string } | null => {
  const [kind, id] = value.split(':');
  if ((kind !== 'bgm' && kind !== 'se') || !id) return null;
  return { kind, id };
};
