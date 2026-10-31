import { useEffect, useState } from 'react';
import {
  COMPETITOR_TAGS,
  TIER_LABEL,
  VIDIQ_HOME,
  WATCH_LABEL,
  youtubeChannelUrl,
  type CompetitorTier,
  type CompetitorWatch,
} from '../../../../shared/competitor';
import type { CompetitorDetail } from '../../../../shared/schema/competitor';
import { AboutButton } from '../../chrome';
import { invalidate, keyOf, mutate, useResource } from '../api';
import { channelName, tierChip } from '../channels/ChannelListScreen';
import { JotComposer } from '../jots/JotComposer';
import { JotItem } from '../jots/JotItem';
import { ProfileGrid } from '../profile/ProfileGrid';
import { useCompetitors } from '../state';
import { countShort, dateOnly, dateTime, Icon, Stat } from '../ui';
import { VideoCard, VideoGrid } from './VideoGrid';

export const ChannelDetailScreen = ({ channelId, timeZone }: { channelId: string; timeZone: string }) => {
  const { openChannel, say } = useCompetitors();
  const detail = useResource(keyOf('detail', channelId), () => window.studio.competitorDetail(channelId));
  const data = detail.data;
  if (detail.error) {
    return (
      <>
        <button type="button" className="cp-link" onClick={() => openChannel(null)}>
          ← 競合
        </button>
        <p className="cp-message">{detail.error}</p>
      </>
    );
  }
  if (!data) return <p className="cp-loading">読み込んでいます…</p>;
  const name = channelName(data);

  const fetchNow = async () => {
    const result = await mutate(window.studio.syncCompetitors({ channelId, mode: 'refresh' }), ['overview']);
    if (!result.ok) say(result.message);
  };
  const openUrl = async (url: string) => {
    const result = await window.studio.openCompetitorUrl(url);
    if (!result.ok) say(result.message);
  };
  const openYoutube = () =>
    openUrl(
      data.canonicalChannelId
        ? youtubeChannelUrl(data.canonicalChannelId, data.session?.handle)
        : data.input.startsWith('http')
          ? data.input
          : `https://www.youtube.com/${data.input}`,
    );

  return (
    <>
      <button type="button" className="cp-link" style={{ alignSelf: 'flex-start', color: 'var(--cp-muted)' }} onClick={() => openChannel(null)}>
        ← 競合 / {name}
      </button>

      <header className="cp-row" style={{ gap: '16px 20px' }}>
        <div className="cp-avatar is-large">
          {data.session?.thumbnailUrl ? <img src={data.session.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : name.replace(/^@/, '').slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="cp-row">
            <h1 className="cp-h1">{name}</h1>
            <span className="cp-muted">{data.session?.handle ?? data.input}</span>
          </div>
          <div className="cp-row" style={{ gap: 6 }}>
            <span className={`cp-chip is-pill ${tierChip(data.tier)}`}>{TIER_LABEL[data.tier]}</span>
            <span className="cp-chip is-pill is-outline">{WATCH_LABEL[data.watchState]}</span>
            <span className={`cp-chip is-pill${data.syncEnabled ? ' is-good' : ''}`}>
              {data.syncEnabled ? `収集中 · ${data.cadence === 'daily' ? '毎日' : '毎週'}` : '収集停止'}
            </span>
          </div>
        </div>
        <div className="cp-row">
          <AboutButton screen="competitor-channel" />
          <button type="button" className="cp-btn" disabled={!data.syncEnabled} onClick={() => void fetchNow()}>
            <Icon name="refresh" />
            いま取得する
          </button>
          <button type="button" className="cp-btn" onClick={() => void openYoutube()}>
            <Icon name="external" />
            YouTube で開く
          </button>
          <button
            type="button"
            className="cp-btn"
            title={data.vidiqUrl ? undefined : 'ハンドルが分からないため vidIQ のトップを開きます'}
            onClick={() => void openUrl(data.vidiqUrl ?? VIDIQ_HOME)}
          >
            <Icon name="external" />
            vidIQ で開く
          </button>
          <ChannelMenu detail={data} />
        </div>
      </header>

      <section aria-label="公開値" className="cp-strip">
        <Stat
          large
          label="登録者"
          value={countShort(data.session?.subscriberCount)}
          note={data.session?.hiddenSubscriberCount ? '公開値は丸められています' : undefined}
        />
        <Stat large label="総再生" value={countShort(data.session?.viewCount)} />
        <Stat large label="動画数" value={countShort(data.session?.videoCount)} note={`この起動で持っている ${data.videoTotal} 本`} />
        <Stat
          label="取得"
          value={<span style={{ fontSize: 18 }}>{dateTime(data.session?.fetchedAt ?? null, timeZone)}</span>}
          note={data.session?.expiresAt ? `期限 ${dateOnly(data.session.expiresAt)} · 終了で破棄` : undefined}
        />
      </section>

      <Coverage detail={data} />

      <div className="cp-columns">
        <div className="cp-col-main">
          <TopVideos channelId={channelId} />
          <section aria-label="観察プロフィール" className="cp-card">
            <div className="cp-row" style={{ alignItems: 'baseline' }}>
              <h2 className="cp-h2">観察プロフィール</h2>
              <span className="cp-small cp-muted">vidIQ などで確かめて、自分の判断と言葉で残します。数値は書き写しません</span>
            </div>
            <ProfileGrid subject={channelId} vidiqUrl={data.vidiqUrl} />
          </section>
          <VideoGrid channelId={channelId} total={data.videoTotal} />
        </div>
        <aside className="cp-col-side">
          <ChannelSettings detail={data} />
          <ChannelJots channelId={channelId} />
        </aside>
      </div>
    </>
  );
};

const Coverage = ({ detail }: { detail: CompetitorDetail }) => {
  const coverage = detail.coverage;
  if (coverage.state !== 'ready') return <p className="cp-small cp-muted">{coverage.message}</p>;
  const saved = coverage.saved ?? 0;
  const excluded = coverage.excluded ?? 0;
  const missing = coverage.missing ?? 0;
  const total = Math.max(saved + excluded + missing, 1);
  return (
    <section aria-label="取得範囲" className="cp-card is-tight is-sunk" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px' }}>
      <span className="cp-small cp-muted">取得範囲</span>
      <strong className="cp-small">
        {dateOnly(coverage.oldest)} – {dateOnly(coverage.newest)}
      </strong>
      <div role="img" aria-label={`保存 ${saved}、除外 ${excluded}、欠落 ${missing}`} style={{ flex: '1 1 240px', display: 'flex', gap: 2, height: 6 }}>
        <span style={{ width: `${(saved / total) * 100}%`, background: 'var(--cp-info)', borderRadius: 3 }} />
        {excluded > 0 && <span style={{ width: `${(excluded / total) * 100}%`, background: '#4a5361', borderRadius: 3 }} />}
        {missing > 0 && <span style={{ width: `${(missing / total) * 100}%`, background: '#c97a2b', borderRadius: 3 }} />}
      </div>
      <span className="cp-small cp-muted">
        保存 {saved}　除外 {excluded}　欠落 {missing}
      </span>
      <span className="cp-faint" style={{ flexBasis: '100%' }}>
        {coverage.message}
      </span>
    </section>
  );
};

const TopVideos = ({ channelId }: { channelId: string }) => {
  const request = { channelIds: [channelId], sort: 'views' as const, limit: 5 };
  const top = useResource(keyOf('videos', request), () => window.studio.competitorVideos(request));
  const items = (top.data?.items ?? []).filter((item) => item.viewCount !== null);
  if (items.length === 0) return null;
  return (
    <section aria-label="いまの累計が多い動画" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="cp-row" style={{ alignItems: 'baseline' }}>
        <h2 className="cp-h2">いまの累計が多い動画</h2>
        <span className="cp-small cp-muted">累計は公開が古い動画に有利です。公開後7日の成績ではありません</span>
      </div>
      <div className="cp-grid-top">
        {items.map((video, index) => (
          <VideoCard key={video.videoId} video={video} list={items} rank={index + 1} />
        ))}
      </div>
    </section>
  );
};

const ChannelSettings = ({ detail }: { detail: CompetitorDetail }) => {
  const { say } = useCompetitors();
  const [reason, setReason] = useState(detail.reason);
  useEffect(() => setReason(detail.reason), [detail.id, detail.reason]);
  const update = async (patch: Record<string, unknown>) => {
    const result = await mutate(window.studio.updateCompetitor({ id: detail.id, ...patch }), ['detail', 'overview']);
    if (!result.ok) say(result.message);
  };
  return (
    <section className="cp-card is-tight" aria-label="観察の設定">
      <h2 className="cp-h3">観察の設定</h2>
      <label className="cp-field">
        選定理由
        <textarea
          className="cp-textarea"
          rows={3}
          value={reason}
          placeholder="なぜこのチャンネルを見るか"
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => {
            if (reason !== detail.reason) void update({ reason });
          }}
        />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <label className="cp-field">
          観察の区分
          <select className="cp-select" value={detail.tier} onChange={(event) => void update({ tier: event.target.value as CompetitorTier })}>
            {(Object.keys(TIER_LABEL) as CompetitorTier[]).map((tier) => (
              <option key={tier} value={tier}>
                {TIER_LABEL[tier]}
              </option>
            ))}
          </select>
        </label>
        <label className="cp-field">
          見方
          <select className="cp-select" value={detail.watchState} onChange={(event) => void update({ watchState: event.target.value as CompetitorWatch })}>
            {(Object.keys(WATCH_LABEL) as CompetitorWatch[]).map((state) => (
              <option key={state} value={state}>
                {WATCH_LABEL[state]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="cp-field">
        タグ
        <div className="cp-row" style={{ gap: 6 }}>
          {COMPETITOR_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className="cp-chip-btn is-accent"
              aria-pressed={detail.tags.includes(tag)}
              onClick={() => void update({ tags: detail.tags.includes(tag) ? detail.tags.filter((item) => item !== tag) : [...detail.tags, tag] })}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
      <span className="cp-faint">変更はその場で保存します</span>
    </section>
  );
};

const ChannelJots = ({ channelId }: { channelId: string }) => {
  const query = { channelId, status: 'all' as const, limit: 20 };
  const jots = useResource(keyOf('jots', query), () => window.studio.competitorJots(query));
  const open = jots.data?.items.filter((item) => item.status === 'open').length ?? 0;
  return (
    <section className="cp-card is-tight" aria-label="気づき">
      <div className="cp-row" style={{ alignItems: 'baseline' }}>
        <h2 className="cp-h3">気づき</h2>
        <span className="cp-faint">
          未整理 {open} · 全 {jots.data?.total ?? 0}
        </span>
      </div>
      <JotComposer channelId={channelId} videoId={null} compact placeholder="チャンネル全体について思ったこと" />
      {jots.data?.items.map((jot) => <JotItem key={jot.id} jot={jot} />)}
      {jots.data && jots.data.items.length === 0 && <span className="cp-faint">動画を開くと、その動画についての気づきも書けます。</span>}
    </section>
  );
};

const ChannelMenu = ({ detail }: { detail: CompetitorDetail }) => {
  const { openChannel, say } = useCompetitors();
  const [open, setOpen] = useState(false);
  const run = async (work: () => Promise<{ ok: boolean; message?: string }>) => {
    setOpen(false);
    const result = await work();
    if (!result.ok) say(result.message ?? '操作できませんでした');
  };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="cp-btn is-icon" aria-label="その他の操作" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="cp-popover" style={{ left: 'auto', right: 0 }} role="menu">
          {detail.syncEnabled ? (
            <button type="button" role="menuitem" onClick={() => void run(() => mutate(window.studio.archiveCompetitor(detail.id), ['detail', 'overview']))}>
              収集を止める
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => void run(() => mutate(window.studio.updateCompetitor({ id: detail.id, syncEnabled: true }), ['detail', 'overview']))}
            >
              収集を再開
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void run(async () => {
                if (!window.confirm('気づきの本文は残して、このチャンネルを削除しますか？ プロフィールと動画のタグ付けは消えます。')) return { ok: true };
                const result = await mutate(window.studio.removeCompetitor(detail.id, true), ['overview', 'jots', 'matrix', 'tags']);
                if (result.ok) {
                  invalidate('detail', 'videos');
                  openChannel(null);
                }
                return result;
              })
            }
          >
            気づきを残して削除
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void run(async () => {
                if (!window.confirm('気づきも含めて削除しますか？ YouTube 上の動画は消えません。')) return { ok: true };
                const result = await mutate(window.studio.removeCompetitor(detail.id, false), ['overview', 'jots', 'matrix', 'tags']);
                if (result.ok) {
                  invalidate('detail', 'videos');
                  openChannel(null);
                }
                return result;
              })
            }
          >
            気づきも削除
          </button>
        </div>
      )}
    </div>
  );
};
