import { useEffect, useRef } from 'react';
import type { CompetitorSyncView } from '../../../shared/schema/competitor';
import { invalidate, keyOf, useResource } from './api';
import { ChannelListScreen } from './channels/ChannelListScreen';
import { InboxScreen } from './channels/InboxScreen';
import { CompareScreen } from './compare/CompareScreen';
import { ChannelDetailScreen } from './detail/ChannelDetailScreen';
import { FocusScreen } from './focus/FocusScreen';
import { CompetitorStateProvider, useCompetitors, type CompetitorView } from './state';
import { VideoDrawer } from './video/VideoDrawer';
import './competitors.css';

const VIEWS: Array<{ view: CompetitorView; label: string }> = [
  { view: 'channels', label: 'チャンネル' },
  { view: 'compare', label: '横断比較' },
  { view: 'focus', label: '伸びた動画' },
  { view: 'inbox', label: '気づき' },
];

const Body = () => {
  const { state, go, say } = useCompetitors();
  const overview = useResource(keyOf('overview'), () => window.studio.competitorOverview());
  const running = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      window.studio.onCompetitorSyncProgress((view: CompetitorSyncView) => {
        invalidate('overview');
        if (running.current && !view.running) invalidate('detail', 'videos', 'matrix');
        running.current = view.running;
      }),
    [],
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [state.view, state.channelId]);

  const openJots = overview.data?.observation.openJots ?? 0;
  return (
    <div className="cp-root" ref={scroller}>
      <div className="cp-main">
        <nav className="cp-subnav" aria-label="競合の表示">
          {VIEWS.map((item) => (
            <button
              key={item.view}
              type="button"
              aria-current={state.view === item.view && !(item.view === 'channels' && state.channelId) ? 'page' : undefined}
              onClick={() => go(item.view)}
            >
              {item.label}
              {item.view === 'inbox' && openJots > 0 && <span className="cp-count">{openJots}</span>}
            </button>
          ))}
        </nav>
        {state.message && (
          <div className="cp-row">
            <p className={`cp-message${state.message.tone === 'info' ? ' is-info' : ''}`} role="status">
              {state.message.text}
            </p>
            <button type="button" className="cp-link" onClick={() => say('')}>
              閉じる
            </button>
          </div>
        )}
        {overview.error && <p className="cp-message">{overview.error}</p>}
        {state.view === 'channels' && !state.channelId && <ChannelListScreen overview={overview.data} loading={overview.loading} />}
        {state.view === 'channels' && state.channelId && (
          <ChannelDetailScreen channelId={state.channelId} timeZone={overview.data?.sync.quota.timeZone ?? 'Asia/Tokyo'} />
        )}
        {state.view === 'compare' && <CompareScreen />}
        {state.view === 'focus' && <FocusScreen channels={overview.data?.channels ?? []} />}
        {state.view === 'inbox' && <InboxScreen />}
      </div>
      {state.drawer && <VideoDrawer />}
    </div>
  );
};

const CompetitorsRoot = () => (
  <CompetitorStateProvider>
    <Body />
  </CompetitorStateProvider>
);

export default CompetitorsRoot;
