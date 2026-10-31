import { useMemo, useState } from 'react';
import type { CompetitorListItem } from '../../../../shared/schema/competitor';
import type { FeatureTag, ObservedVideo } from '../../../../shared/schema/competitor-observation';
import { AboutButton } from '../../chrome';
import { keyOf, mutate, useResource } from '../api';
import { channelName } from '../channels/ChannelListScreen';
import { useCompetitors } from '../state';
import { ago, countShort, Empty, Segmented, Thumb, videoTitle } from '../ui';
import { AiFeatureIdeas } from './AiFeatureIdeas';
import { FeatureTagPanel } from './FeatureTagPanel';

const LIMIT = 96;

export const FocusScreen = ({ channels }: { channels: CompetitorListItem[] }) => {
  const { say } = useCompetitors();
  const [channelFilter, setChannelFilter] = useState('all');
  const [format, setFormat] = useState<'all' | 'shorts' | 'standard' | 'live' | 'unconfirmed'>('all');
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tagging, setTagging] = useState(false);
  const [ideaTarget, setIdeaTarget] = useState<string[] | null>(null);
  const query = {
    ...(channelFilter === 'all' ? {} : { channelIds: [channelFilter] }),
    focusOnly: true,
    format,
    untaggedOnly,
    limit: LIMIT,
  };
  const videos = useResource(keyOf('videos', query), () => window.studio.competitorVideos(query));
  const tags = useResource(keyOf('tags'), () => window.studio.competitorTags());
  const items = videos.data?.items ?? [];
  const tagById = useMemo(() => new Map((tags.data ?? []).map((tag) => [tag.id, tag])), [tags.data]);
  const selectedVisible = selected.filter((id) => items.some((item) => item.videoId === id));

  const assign = async (tag: FeatureTag) => {
    setTagging(false);
    const result = await mutate(window.studio.assignCompetitorTag({ videoIds: selectedVisible, tagId: tag.id }), ['tags', 'videos']);
    if (!result.ok) say(result.message);
    else say(`${selectedVisible.length} 本に「${tag.name}」を付けました`, 'info');
  };

  return (
    <>
      <header className="cp-row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 420px' }}>
          <h1 className="cp-h1">伸びた動画と特徴</h1>
          <p className="cp-lead">伸びた動画を集めて特徴タグを付け、どの特徴が共通しているかを見ます。タグはすべてあなたが付けた独自のものです。</p>
        </div>
        <AboutButton screen="competitor-focus" />
      </header>

      <div className="cp-columns">
        <aside className="cp-col-left">
          <FocusCollector channels={channels} />
          <section className="cp-card is-tight" aria-label="絞り込み">
            <label className="cp-field">
              チャンネル
              <select className="cp-select" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
                <option value="all">すべて</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channelName(channel)}
                  </option>
                ))}
              </select>
            </label>
            <label className="cp-field">
              形式
              <select className="cp-select" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
                <option value="all">すべて</option>
                <option value="shorts">Shorts</option>
                <option value="standard">通常</option>
                <option value="live">ライブ</option>
                <option value="unconfirmed">未確認</option>
              </select>
            </label>
            <div className="cp-small" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--cp-bg)' }}>
              注目動画 <strong style={{ fontSize: 16 }}>{videos.data?.focusTotal ?? 0}</strong> 本
            </div>
          </section>
        </aside>

        <section aria-label="注目動画" className="cp-col-main" style={{ gap: 12 }}>
          <div className="cp-selectbar">
            <strong>{selectedVisible.length > 0 ? `${selectedVisible.length} 本を選択中` : '注目動画'}</strong>
            <div style={{ position: 'relative' }}>
              <button type="button" className="cp-btn is-light is-small" disabled={selectedVisible.length === 0} onClick={() => setTagging((value) => !value)}>
                タグを付ける
              </button>
              {tagging && (
                <div className="cp-popover" role="menu">
                  {(tags.data ?? []).map((tag) => (
                    <button key={tag.id} type="button" role="menuitem" onClick={() => void assign(tag)}>
                      {tag.name}
                      <span className="cp-faint" style={{ marginLeft: 6 }}>
                        {tag.group}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="cp-btn is-info is-small"
              disabled={selectedVisible.length === 0 || selectedVisible.length > 15}
              title={selectedVisible.length > 15 ? '一度に送れるのは15本までです' : undefined}
              onClick={() => setIdeaTarget(selectedVisible)}
            >
              AI に特徴を挙げてもらう
            </button>
            <span className="cp-spacer" />
            <Segmented
              label="タグの状態"
              sunk
              value={untaggedOnly ? 'untagged' : 'all'}
              onChange={(value) => setUntaggedOnly(value === 'untagged')}
              options={[
                { value: 'all', label: 'すべて' },
                { value: 'untagged', label: '未タグ' },
              ]}
            />
          </div>
          {videos.loading && !videos.data && <p className="cp-loading">読み込んでいます…</p>}
          {videos.error && <p className="cp-message">{videos.error}</p>}
          {videos.data && items.length === 0 && (
            <Empty title="注目動画はまだありません">左の欄に URL を貼るか、動画を開いて「注目動画にする」を押すと集まります。</Empty>
          )}
          {items.map((video) => (
            <FocusRow
              key={video.videoId}
              video={video}
              list={items}
              tagNames={video.tagIds.map((id) => tagById.get(id)?.name).filter((name): name is string => Boolean(name))}
              selected={selected.includes(video.videoId)}
              onSelect={(value) => setSelected((current) => (value ? [...current, video.videoId] : current.filter((id) => id !== video.videoId)))}
            />
          ))}
          {videos.data && videos.data.total > items.length && (
            <span className="cp-faint">先頭の {items.length} 本を表示しています。チャンネルや形式で絞り込んでください。</span>
          )}
        </section>

        <aside className="cp-col-side">
          <FeatureTagPanel tags={tags.data ?? []} focusTotal={videos.data?.focusTotal ?? 0} />
        </aside>
      </div>

      {ideaTarget && <AiFeatureIdeas key={ideaTarget.join()} focusVideoIds={ideaTarget} channelIds={channelFilter === 'all' ? undefined : [channelFilter]} onClose={() => setIdeaTarget(null)} />}
    </>
  );
};

const FocusRow = ({
  video,
  list,
  tagNames,
  selected,
  onSelect,
}: {
  video: ObservedVideo;
  list: ObservedVideo[];
  tagNames: string[];
  selected: boolean;
  onSelect: (value: boolean) => void;
}) => {
  const { openVideo } = useCompetitors();
  return (
    <article className={`cp-focus-row${selected ? ' is-selected' : ''}`}>
      <input type="checkbox" checked={selected} aria-label="この動画を選ぶ" onChange={(event) => onSelect(event.target.checked)} style={{ marginTop: 4, accentColor: 'var(--cp-info)' }} />
      <button type="button" className="cp-video" style={{ width: 168, flex: 'none' }} aria-label="動画を開く" onClick={() => openVideo(list, video.videoId)}>
        <Thumb video={video} />
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" className="cp-link" style={{ color: 'var(--cp-text)', fontSize: 13, fontWeight: 500, textAlign: 'left', lineHeight: 1.5 }} onClick={() => openVideo(list, video.videoId)}>
          {videoTitle(video)}
        </button>
        {video.focusReason && <span className="cp-small" style={{ color: 'var(--cp-text-2)' }}>{video.focusReason}</span>}
        <div className="cp-row cp-small cp-muted" style={{ gap: '4px 14px' }}>
          <span>{video.channelLabel}</span>
          {video.viewCount !== null && <span>{countShort(video.viewCount)} 再生</span>}
          {video.publishedAt && <span>{ago(video.publishedAt)}</span>}
          {video.jotCount > 0 && <span>気づき {video.jotCount}</span>}
        </div>
        <div className="cp-row" style={{ gap: 6 }}>
          {tagNames.length === 0 ? (
            <span className="cp-faint">タグなし</span>
          ) : (
            tagNames.map((name) => (
              <span key={name} className="cp-chip">
                {name}
              </span>
            ))
          )}
          <button type="button" className="cp-chip-btn" style={{ height: 24, fontSize: 11 }} onClick={() => openVideo(list, video.videoId)}>
            + タグ
          </button>
        </div>
      </div>
    </article>
  );
};

const FocusCollector = ({ channels }: { channels: CompetitorListItem[] }) => {
  const { say } = useCompetitors();
  const [channelId, setChannelId] = useState('');
  const [urls, setUrls] = useState('');
  const [reason, setReason] = useState('');
  const target = channelId || channels[0]?.id || '';
  const add = async () => {
    const result = await mutate(window.studio.addCompetitorFocusUrls({ channelId: target, urls, reason }), ['videos', 'tags']);
    if (!result.ok) {
      say(result.message);
      return;
    }
    setUrls('');
    setReason('');
    say(
      `${result.data.added.length} 本を注目動画にしました${result.data.invalid.length > 0 ? `。読めなかった行：${result.data.invalid.length}` : ''}`,
      result.data.invalid.length > 0 ? 'error' : 'info',
    );
  };
  return (
    <section className="cp-card is-tight" aria-label="注目動画を集める">
      <h2 className="cp-h3" style={{ fontSize: 14 }}>
        注目動画を集める
      </h2>
      {channels.length === 0 ? (
        <span className="cp-faint">先にチャンネルを登録してください。</span>
      ) : (
        <>
          <label className="cp-field">
            どのチャンネルの動画か
            <select className="cp-select" value={target} onChange={(event) => setChannelId(event.target.value)}>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channelName(channel)}
                </option>
              ))}
            </select>
          </label>
          <label className="cp-field">
            動画の URL（1行に1本）
            <textarea className="cp-textarea" rows={3} value={urls} placeholder="vidIQ の Outliers などで見つけた動画の URL" onChange={(event) => setUrls(event.target.value)} style={{ fontSize: 12 }} />
          </label>
          <label className="cp-field">
            注目した理由（任意）
            <input className="cp-input" value={reason} placeholder="自分の言葉で。例：いつもより明らかに伸びている" onChange={(event) => setReason(event.target.value)} />
          </label>
          <button type="button" className="cp-btn is-primary is-small" style={{ alignSelf: 'flex-start' }} disabled={!urls.trim()} onClick={() => void add()}>
            注目動画に追加
          </button>
          <span className="cp-faint">動画を開いて「注目動画にする」からも追加できます。</span>
        </>
      )}
    </section>
  );
};
