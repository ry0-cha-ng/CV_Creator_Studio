import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import h1IconUrl from '../../resources/brand/h1-icon.png';

const iconProps = {
  viewBox: '0 0 24 24',
  'aria-hidden': true as const,
};

const SearchIcon = (): ReactNode => (
  <svg {...iconProps}>
    <circle cx="10.8" cy="10.8" r="5.4" fill="none" stroke="currentColor" strokeWidth="2.1" />
    <path d="m14.8 14.8 4.3 4.3" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);

const HeartIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M12 19.2c-.3-.2-6.6-4-6.6-8.3A3.6 3.6 0 0 1 12 8.2a3.6 3.6 0 0 1 6.6 2.7c0 4.3-6.3 8.1-6.6 8.3z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
  </svg>
);

const CommentIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M6 6.2h12a2 2 0 0 1 2 2v6.2a2 2 0 0 1-2 2H11l-3.6 2.6v-2.6H6a2 2 0 0 1-2-2V8.2a2 2 0 0 1 2-2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
    <circle cx="9" cy="11.2" r="0.9" fill="currentColor" />
    <circle cx="12" cy="11.2" r="0.9" fill="currentColor" />
    <circle cx="15" cy="11.2" r="0.9" fill="currentColor" />
  </svg>
);

const BookmarkIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M7 4.4h10a1 1 0 0 1 1 1V20l-6-3.3L6 20V5.4a1 1 0 0 1 1-1z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
  </svg>
);

const ShareIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M14.2 7.2 18.6 12l-4.4 4.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M18 12H9.2A4.2 4.2 0 0 0 5 16.2V18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  </svg>
);

const PlusIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path d="M12 6.4v11.2M6.4 12h11.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

const HomeIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path d="M4.2 11.2 12 4.8l7.8 6.4V20a1 1 0 0 1-1 1h-4.6v-5.6H9.8V21H5.2a1 1 0 0 1-1-1z" fill="currentColor" />
  </svg>
);

const FriendsIcon = (): ReactNode => (
  <svg {...iconProps}>
    <circle cx="9" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M4.8 17.2a4.2 4.2 0 0 1 8.4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="16" cy="9.4" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M15.2 13.2a3.6 3.6 0 0 1 4.2 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const InboxIcon = (): ReactNode => (
  <svg {...iconProps}>
    <path
      d="M5.5 7.2h13a1.4 1.4 0 0 1 1.4 1.4v7.6a1.4 1.4 0 0 1-1.4 1.4H10l-3.4 2.4v-2.4H5.5a1.4 1.4 0 0 1-1.4-1.4V8.6a1.4 1.4 0 0 1 1.4-1.4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const ProfileIcon = (): ReactNode => (
  <svg {...iconProps}>
    <circle cx="12" cy="8.6" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M5.6 18.4a6.4 6.4 0 0 1 12.8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
      setLocal(Math.min(Math.max(0, event.detail.frame - origin), Math.max(0, span - 1)));
    };
    player.addEventListener('frameupdate', onFrame);
    setLocal(Math.min(Math.max(0, player.getCurrentFrame() - origin), Math.max(0, span - 1)));
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [playerRef, origin, span]);

  const progress = span <= 1 ? 0 : (local / (span - 1)) * 100;

  return (
    <div className="gd-tiktok-scrub">
      <span style={{ width: `${progress}%` }} />
    </div>
  );
};

export const TikTokChrome = ({
  title,
  hashtags,
  playerRef,
  origin,
  span,
}: {
  title: string;
  hashtags: string;
  playerRef: RefObject<PlayerRef | null>;
  origin: number;
  span: number;
}): ReactNode => (
  <div className="gd-tiktok" aria-hidden="true">
    <div className="gd-tiktok-topshade" />
    <div className="gd-tiktok-shade" />
    <header className="gd-tiktok-tabs">
      <span>ドラマ</span>
      <span>フォロー中</span>
      <span>ショップ</span>
      <span className="is-on">おすすめ</span>
      <SearchIcon />
    </header>
    <ul className="gd-tiktok-rail">
      <li className="gd-tiktok-avatar">
        <img src={h1IconUrl} alt="" draggable={false} />
        <span className="gd-tiktok-follow">
          <PlusIcon />
        </span>
      </li>
      <li>
        <HeartIcon />
      </li>
      <li>
        <CommentIcon />
      </li>
      <li>
        <BookmarkIcon />
      </li>
      <li>
        <ShareIcon />
      </li>
      <li className="gd-tiktok-disc">
        <img src={h1IconUrl} alt="" draggable={false} />
      </li>
    </ul>
    <div className="gd-tiktok-dock">
      <div className="gd-tiktok-meta">
        <strong>H1gher</strong>
        <p className={title ? '' : 'is-empty'}>{title || 'タイトル'}</p>
        {hashtags ? <p className="gd-tiktok-tags">{hashtags}</p> : null}
      </div>
      <Scrubber playerRef={playerRef} origin={origin} span={span} />
      <nav className="gd-tiktok-nav">
        <div className="gd-tiktok-tab is-on">
          <HomeIcon />
          <span>ホーム</span>
        </div>
        <div className="gd-tiktok-tab">
          <FriendsIcon />
          <span>友達</span>
        </div>
        <div className="gd-tiktok-create">
          <span className="gd-tiktok-create-cyan" />
          <span className="gd-tiktok-create-pink" />
          <span className="gd-tiktok-create-face">
            <PlusIcon />
          </span>
        </div>
        <div className="gd-tiktok-tab">
          <InboxIcon />
          <span>メッセージ</span>
        </div>
        <div className="gd-tiktok-tab">
          <ProfileIcon />
          <span>プロフィール</span>
        </div>
        <div className="gd-tiktok-home" />
      </nav>
    </div>
  </div>
);
