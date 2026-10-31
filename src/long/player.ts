import type { PlayerRef } from '@remotion/player';
import { createContext, useContext, type RefObject } from 'react';

/** プレビューの Player をタイムライン・インスペクターから操作する */
export const LongPlayerContext = createContext<RefObject<PlayerRef | null> | null>(null);

export const useLongPlayer = (): {
  seek: (frame: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  playRange: (from: number, to: number) => void;
} => {
  const ref = useContext(LongPlayerContext);
  return {
    seek: (frame) => ref?.current?.seekTo(Math.max(0, Math.round(frame))),
    play: () => ref?.current?.play(),
    pause: () => ref?.current?.pause(),
    toggle: () => ref?.current?.toggle(),
    playRange: (from, to) => {
      const player = ref?.current;
      if (!player) return;
      player.seekTo(Math.max(0, from));
      player.play();
      const stop = (): void => {
        if (player.getCurrentFrame() >= to) {
          player.pause();
          player.removeEventListener('frameupdate', stop);
        }
      };
      player.addEventListener('frameupdate', stop);
    },
  };
};
