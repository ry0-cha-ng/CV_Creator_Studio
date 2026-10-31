import { useEffect, useState } from 'react';
import type { ObservedVideo } from '../../../../shared/schema/competitor-observation';
import { keyOf, useResource } from '../api';
import { useCompetitors } from '../state';
import { ago, countShort, Empty, Segmented, Thumb, videoTitle } from '../ui';

const PAGE = 48;

type Query = {
  channelIds: string[];
  sort: 'new' | 'views';
  format: 'all' | 'shorts' | 'standard' | 'live' | 'unconfirmed';
  jotsOnly: boolean;
};

export const VideoCard = ({ video, list, rank }: { video: ObservedVideo; list: ObservedVideo[]; rank?: number }) => {
  const { openVideo } = useCompetitors();
  return (
    <button type="button" className="cp-video" onClick={() => openVideo(list, video.videoId)}>
      <Thumb video={video} rank={rank} mark={video.focusAt ? '注目' : video.jotCount > 0 ? `気づき ${video.jotCount}` : undefined} />
      <span className="cp-video-title">{videoTitle(video)}</span>
      <span className="cp-video-meta">
        <strong>{countShort(video.viewCount)}</strong> 再生
        {video.likeCount !== null ? ` · 高評価 ${countShort(video.likeCount)}` : ''}
        {video.publishedAt ? ` · ${ago(video.publishedAt)}` : ''}
      </span>
    </button>
  );
};

const Page = ({ query, offset, onTotal }: { query: Query; offset: number; onTotal?: (total: number) => void }) => {
  const request = { ...query, offset, limit: PAGE };
  const page = useResource(keyOf('videos', request), () => window.studio.competitorVideos(request));
  const total = page.data?.total;
  useEffect(() => {
    if (total !== undefined) onTotal?.(total);
  }, [total, onTotal]);
  if (page.loading && !page.data) return <p className="cp-loading">読み込んでいます…</p>;
  if (page.error) return <p className="cp-message">{page.error}</p>;
  if (!page.data) return null;
  if (offset === 0 && page.data.items.length === 0) {
    return <Empty title="表示できる動画はありません">取得すると、アプリを閉じるまで表示します。</Empty>;
  }
  return (
    <div className="cp-grid-videos">
      {page.data.items.map((video) => (
        <VideoCard key={video.videoId} video={video} list={page.data?.items ?? []} />
      ))}
    </div>
  );
};

/** チャンネルの動画。48本ずつ読み込む。 */
export const VideoGrid = ({ channelId, total }: { channelId: string; total: number }) => {
  const [sort, setSort] = useState<Query['sort']>('new');
  const [format, setFormat] = useState<Query['format']>('all');
  const [jotsOnly, setJotsOnly] = useState(false);
  const [pages, setPages] = useState(1);
  const [filtered, setFiltered] = useState(total);
  const query: Query = { channelIds: [channelId], sort, format, jotsOnly };
  const reset = () => setPages(1);
  return (
    <section aria-label="動画" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="cp-row">
        <h2 className="cp-h2">
          動画 <span className="cp-muted" style={{ fontWeight: 400 }}>{filtered}</span>
        </h2>
        <span className="cp-spacer" />
        <Segmented
          label="並び"
          value={sort}
          onChange={(value) => {
            setSort(value);
            reset();
          }}
          options={[
            { value: 'new', label: '公開日' },
            { value: 'views', label: 'いまの累計再生' },
          ]}
        />
        <Segmented
          label="形式"
          value={format}
          onChange={(value) => {
            setFormat(value);
            reset();
          }}
          options={[
            { value: 'all', label: 'すべて' },
            { value: 'shorts', label: 'Shorts' },
            { value: 'standard', label: '通常' },
            { value: 'live', label: 'ライブ' },
            { value: 'unconfirmed', label: '未確認' },
          ]}
        />
        <button
          type="button"
          className="cp-chip-btn"
          aria-pressed={jotsOnly}
          onClick={() => {
            setJotsOnly((value) => !value);
            reset();
          }}
        >
          気づきありのみ
        </button>
      </div>
      {sort === 'views' && <span className="cp-faint">いまの累計は公開が古い動画に有利です。公開後7日の成績ではありません。</span>}
      {Array.from({ length: pages }, (_item, index) => (
        <Page key={index} query={query} offset={index * PAGE} onTotal={index === 0 ? setFiltered : undefined} />
      ))}
      {pages * PAGE < filtered && (
        <button type="button" className="cp-btn" style={{ alignSelf: 'center' }} onClick={() => setPages((value) => value + 1)}>
          さらに表示
        </button>
      )}
    </section>
  );
};
