import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import h1IconUrl from '../../resources/brand/h1-icon.png';

const iconProps = {
  viewBox: '0 0 24 24',
  'aria-hidden': true as const,
};

const BackIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path d="M14.8 5.2 8 12l6.8 6.8" fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SearchIcon = (): ReactNode => (
  <svg {...iconProps}>
    <circle cx="10.8" cy="10.8" r="5.3" fill="none" stroke="currentColor" strokeWidth="2.05" />
    <path d="m14.8 14.8 4.2 4.2" fill="none" stroke="currentColor" strokeWidth="2.05" strokeLinecap="round" />
  </svg>
);

const MoreIcon = (): ReactNode => (
  <svg {...iconProps}>
    <circle cx="12" cy="5.4" r="1.45" fill="currentColor" />
    <circle cx="12" cy="12" r="1.45" fill="currentColor" />
    <circle cx="12" cy="18.6" r="1.45" fill="currentColor" />
  </svg>
);

const HeartIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M12 18.7c-.25-.18-6.3-3.85-6.3-8a3.45 3.45 0 0 1 6.3-2 3.45 3.45 0 0 1 6.3 2c0 4.15-6.05 7.82-6.3 8z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinejoin="round"
    />
  </svg>
);

const CommentIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M6.2 5.5h11.6A2.2 2.2 0 0 1 20 7.7v6.6a2.2 2.2 0 0 1-2.2 2.2H12l-3.8 2.8v-2.8H6.2A2.2 2.2 0 0 1 4 14.3V7.7a2.2 2.2 0 0 1 2.2-2.2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
  </svg>
);

const SaveIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M7 4.2h10a1.2 1.2 0 0 1 1.2 1.2V20L12 16.6 5.8 20V5.4A1.2 1.2 0 0 1 7 4.2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
  </svg>
);

const ShareIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path d="M7.4 16.5 16.5 7.4" fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
    <path d="M9.8 7.2h6.9v6.9" fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RemixIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path d="M7.5 9.5h6.2a2.5 2.5 0 0 1 2.5 2.5V13" fill="none" stroke="currentColor" strokeWidth="2.05" strokeLinecap="round" />
    <path d="M16.5 14.5H10.3a2.5 2.5 0 0 1-2.5-2.5V11" fill="none" stroke="currentColor" strokeWidth="2.05" strokeLinecap="round" />
    <path d="M12.5 6.8 16.2 9.5 12.5 12.1" fill="none" stroke="currentColor" strokeWidth="2.05" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M11.5 17.2 7.8 14.5 11.5 11.9" fill="none" stroke="currentColor" strokeWidth="2.05" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const HomeIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M4 11.2 12 4.6l8 6.6V20a1 1 0 0 1-1 1h-5v-6.2H10V21H5a1 1 0 0 1-1-1z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
);

const ShortsIcon = (): ReactNode => (
  <svg {...iconProps}>
    <rect x="6.2" y="3.2" width="11.6" height="17.6" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M10.3 9.1v5.8l4.9-2.9z" fill="currentColor" />
  </svg>
);

const PlusIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path d="M12 6.2v11.6M6.2 12h11.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

const SubsIcon = (): ReactNode => (
  <svg {...iconProps}>
    <rect x="3.2" y="8.2" width="13.2" height="11" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M7.4 8.2V6.2A1.6 1.6 0 0 1 9 4.6h10.2A1.6 1.6 0 0 1 20.8 6.2V16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);

const PlayIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path d="M8 5.4v13.2l10.4-6.6z" fill="currentColor" />
  </svg>
);

const Scrubber = ({
  playerRef,
  origin,
  span,
}: {
  playerRef: RefObject<PlayerRef | null>;
  origin: number;
  span: number;
}): ReactNode => {
  const [local, setLocal] = useState(0);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }): void => {
      const frame = event.detail.frame;
      setLocal(Math.min(Math.max(0, frame - origin), Math.max(0, span - 1)));
    };
    player.addEventListener('frameupdate', onFrame);
    setLocal(Math.min(Math.max(0, player.getCurrentFrame() - origin), Math.max(0, span - 1)));
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [playerRef, origin, span]);

  const progress = span <= 1 ? 0 : (local / (span - 1)) * 100;

  return (
    <div className="gd-shorts-scrub">
      <span style={{ width: `${progress}%` }} />
    </div>
  );
};

export const ShortsChrome = ({
  title,
  sound,
  playerRef,
  origin,
  span,
}: {
  title: string;
  sound: string;
  playerRef: RefObject<PlayerRef | null>;
  origin: number;
  span: number;
}): ReactNode => (
  <div className="gd-shorts" aria-hidden="true">
    <div className="gd-shorts-topshade" />
    <div className="gd-shorts-shade" />
    <header className="gd-shorts-top">
      <BackIcon />
      <span className="gd-shorts-top-actions">
        <SearchIcon />
        <MoreIcon />
      </span>
    </header>
    <ul className="gd-shorts-rail">
      <li className="is-bare">
        <HeartIcon />
      </li>
      <li className="is-bare">
        <CommentIcon />
      </li>
      <li>
        <SaveIcon />
        <span>保存</span>
      </li>
      <li>
        <ShareIcon />
        <span>共有</span>
      </li>
      <li>
        <RemixIcon />
        <span>リミックス</span>
      </li>
      <li className="gd-shorts-disc-slot">
        <img className="gd-shorts-disc" src={h1IconUrl} alt="" draggable={false} />
      </li>
    </ul>
    <div className="gd-shorts-dock">
      <div className="gd-shorts-stage">
        <div className="gd-shorts-copy">
          <div className="gd-shorts-channel">
            <img className="gd-shorts-avatar" src={h1IconUrl} alt="" draggable={false} />
            <span className="gd-shorts-name">@H1gher</span>
            <span className="gd-shorts-sub">チャンネル登録</span>
          </div>
          <p className={`gd-shorts-title${title ? '' : ' is-empty'}`}>{title || 'タイトル'}</p>
        </div>
        <div className="gd-shorts-sound">
          <PlayIcon />
          <span>{sound}</span>
        </div>
      </div>
      <Scrubber playerRef={playerRef} origin={origin} span={span} />
      <nav className="gd-shorts-nav">
        <div className="gd-shorts-tab">
          <HomeIcon />
          <span>ホーム</span>
        </div>
        <div className="gd-shorts-tab is-on">
          <ShortsIcon />
          <span>ショート</span>
        </div>
        <div className="gd-shorts-create">
          <PlusIcon />
        </div>
        <div className="gd-shorts-tab">
          <SubsIcon />
          <span>登録チャンネル</span>
        </div>
        <div className="gd-shorts-tab">
          <img src={h1IconUrl} alt="" draggable={false} />
          <span>マイページ</span>
        </div>
        <div className="gd-shorts-home" />
      </nav>
    </div>
  </div>
);
