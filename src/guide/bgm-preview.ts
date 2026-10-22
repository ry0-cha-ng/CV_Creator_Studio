/** ガイドのBGM試聴。同時に鳴るのは1本だけにする。 */

let audio: HTMLAudioElement | null = null;
let trackId: string | null = null;
let volume = 1;
let generation = 0;
const listeners = new Set<() => void>();

const clampVolume = (next: number): number => {
  if (!Number.isFinite(next)) return 1;
  return Math.min(1, Math.max(0, next));
};

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const getBgmPreviewTrackId = (): string | null => trackId;

export const getBgmPreviewVolume = (): number => volume;

export const setBgmPreviewVolume = (next: number): void => {
  volume = clampVolume(next);
  if (audio) audio.volume = volume;
};

export const subscribeBgmPreview = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const stopBgmPreview = (): void => {
  generation += 1;
  const current = audio;
  audio = null;
  const hadTrack = trackId !== null;
  trackId = null;
  if (current) {
    current.pause();
    current.src = '';
  }
  if (hadTrack) emit();
};

export const playBgmPreview = (id: string, url: string): void => {
  stopBgmPreview();
  const token = generation;
  const next = new Audio(url);
  next.volume = volume;
  audio = next;
  trackId = id;
  next.addEventListener('ended', () => {
    if (generation !== token) return;
    audio = null;
    trackId = null;
    emit();
  });
  emit();
  void next.play().then(
    () => {
      if (generation !== token) {
        next.pause();
        next.src = '';
        return;
      }
      next.volume = volume;
    },
    () => {
      if (generation === token) stopBgmPreview();
    },
  );
};
