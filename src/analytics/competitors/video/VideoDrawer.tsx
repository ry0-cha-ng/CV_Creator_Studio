import { useEffect, useMemo, useState } from 'react';
import type { VideoFormat } from '../../../../shared/competitor';
import type { ObservedVideo } from '../../../../shared/schema/competitor-observation';
import { AboutButton } from '../../chrome';
import { keyOf, mutate, useResource } from '../api';
import { JotComposer } from '../jots/JotComposer';
import { JotItem } from '../jots/JotItem';
import { useCompetitors } from '../state';
import { countShort, dateOnly, dateTime, Icon, Segmented, Thumb, videoTitle } from '../ui';
import { FeatureTagInput } from './FeatureTagInput';

export const VideoDrawer = () => {
  const { state, closeVideo, stepVideo, openChannel } = useCompetitors();
  const drawer = state.drawer;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeVideo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeVideo]);
  if (!drawer) return null;
  const video = drawer.list[drawer.index];
  if (!video) return null;
  return (
    <div className="cp-overlay" role="presentation" onClick={closeVideo}>
      <aside className="cp-drawer" role="dialog" aria-modal="true" aria-label="動画の気づき" onClick={(event) => event.stopPropagation()}>
        <div className="cp-drawer-head">
          <button
            type="button"
            className="cp-link"
            style={{ color: 'var(--cp-muted)' }}
            onClick={() => {
              closeVideo();
              openChannel(video.channelId);
            }}
          >
            {video.channelLabel}
          </button>
          <span className="cp-spacer" />
          <AboutButton screen="competitor-video" />
          <button type="button" className="cp-btn is-icon is-small" aria-label="前の動画" disabled={drawer.index === 0} onClick={() => stepVideo(-1)}>
            <Icon name="left" size={14} />
          </button>
          <button
            type="button"
            className="cp-btn is-icon is-small"
            aria-label="次の動画"
            disabled={drawer.index >= drawer.list.length - 1}
            onClick={() => stepVideo(1)}
          >
            <Icon name="right" size={14} />
          </button>
          <button type="button" className="cp-btn is-icon is-small is-quiet" aria-label="閉じる" onClick={closeVideo}>
            <Icon name="close" />
          </button>
        </div>
        <VideoBody key={video.videoId} video={video} />
      </aside>
    </div>
  );
};

const VideoBody = ({ video }: { video: ObservedVideo }) => {
  const { say, updateVideo } = useCompetitors();
  const [reason, setReason] = useState(video.focusReason);
  const jotQuery = { videoId: video.videoId, status: 'all' as const, limit: 50 };
  const jots = useResource(keyOf('jots', jotQuery), () => window.studio.competitorJots(jotQuery));

  const classify = async (format: VideoFormat | null) => {
    const result = await mutate(
      window.studio.classifyCompetitor({ entityType: 'video', entityId: video.videoId, format, tags: video.tags }),
      ['videos', 'tags'],
    );
    if (!result.ok) say(result.message);
    else updateVideo({ ...video, format });
  };

  const setFocus = async (focus: boolean) => {
    const result = await mutate(
      window.studio.setCompetitorFocus({ channelId: video.channelId, videoId: video.videoId, focus, reason: focus ? reason : undefined }),
      ['videos', 'tags'],
    );
    if (!result.ok) say(result.message);
    else updateVideo({ ...video, focusAt: focus ? (video.focusAt ?? new Date().toISOString()) : null, focusReason: focus ? reason : video.focusReason });
  };

  const openUrl = async (url: string) => {
    const result = await window.studio.openCompetitorUrl(url);
    if (!result.ok) say(result.message);
  };

  const formatValue = useMemo(() => video.format ?? 'none', [video.format]);

  return (
    <>
      <div className="cp-drawer-body">
        <Thumb video={video} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="cp-h2" style={{ fontSize: 16, lineHeight: 1.5 }}>
            {videoTitle(video)}
          </h2>
          <span className="cp-small cp-muted">
            {video.publishedAt ? `公開 ${dateTime(video.publishedAt)}` : '公開日は未取得'}
            {video.expiresAt ? ` · 数値の期限 ${dateOnly(video.expiresAt)}（アプリを閉じると破棄）` : ''}
          </span>
        </div>
        <div className="cp-strip" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div style={{ background: 'var(--cp-surface-2)' }}>
            <span className="cp-stat-label">いまの累計再生</span>
            <span className="cp-stat-value">{countShort(video.viewCount)}</span>
          </div>
          <div style={{ background: 'var(--cp-surface-2)' }}>
            <span className="cp-stat-label">高評価</span>
            <span className="cp-stat-value">{countShort(video.likeCount)}</span>
          </div>
          <div style={{ background: 'var(--cp-surface-2)' }}>
            <span className="cp-stat-label">コメント</span>
            <span className="cp-stat-value">{countShort(video.commentCount)}</span>
          </div>
        </div>

        <div className="cp-field">
          <span>
            形式 <span className="cp-faint">— 尺やハッシュタグだけでは決めません。見たあとで選びます</span>
          </span>
          <Segmented
            label="形式"
            sunk
            value={formatValue}
            onChange={(value) => void classify(value === 'none' ? null : (value as VideoFormat))}
            options={[
              { value: 'none', label: '未確認' },
              { value: 'shorts', label: 'Shorts' },
              { value: 'standard', label: '通常' },
              { value: 'live', label: 'ライブ' },
              { value: 'unknown', label: '不明' },
            ]}
          />
        </div>

        <div className="cp-card is-tight is-sunk">
          <div className="cp-row">
            <strong className="cp-small">特徴タグ</strong>
            <span className="cp-spacer" />
            <button
              type="button"
              className="cp-chip-btn is-accent"
              aria-pressed={Boolean(video.focusAt)}
              onClick={() => void setFocus(!video.focusAt)}
            >
              {video.focusAt ? '注目動画（外す）' : '注目動画にする'}
            </button>
          </div>
          {video.focusAt && (
            <input
              className="cp-input"
              style={{ height: 32, fontSize: 12 }}
              value={reason}
              placeholder="注目した理由（自分の言葉で）"
              aria-label="注目した理由"
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => {
                if (reason !== video.focusReason) void setFocus(true);
              }}
            />
          )}
          <FeatureTagInput video={video} />
        </div>

        <JotComposer channelId={video.channelId} videoId={video.videoId} withClock hint="チャンネルと動画は自動で付きます" />

        <section aria-label="この動画の気づき" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="cp-row" style={{ alignItems: 'baseline' }}>
            <h3 className="cp-h3">この動画の気づき</h3>
            <span className="cp-faint">{jots.data?.total ?? 0} 件</span>
          </div>
          {jots.data?.items.map((jot) => <JotItem key={jot.id} jot={jot} />)}
        </section>
      </div>
      <div className="cp-drawer-foot">
        <span className="cp-faint">仮説検証へ渡すのは「気づき」の受け箱から選べます</span>
        <span className="cp-spacer" />
        {video.vidiqUrl && (
          <button type="button" className="cp-btn is-small" onClick={() => void openUrl(video.vidiqUrl ?? '')}>
            <Icon name="external" size={14} />
            vidIQ で開く
          </button>
        )}
        <button type="button" className="cp-btn is-small" onClick={() => void openUrl(video.userUrl)}>
          <Icon name="external" size={14} />
          YouTube で開く
        </button>
      </div>
    </>
  );
};
