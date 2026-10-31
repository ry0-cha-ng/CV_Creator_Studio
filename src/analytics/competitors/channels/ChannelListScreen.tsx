import { useMemo, useState } from 'react';
import { PROFILE_THEMES } from '../../../../shared/competitor-observation';
import { TIER_LABEL, WATCH_LABEL, type CompetitorTier, type CompetitorWatch } from '../../../../shared/competitor';
import type { CompetitorListItem, CompetitorSyncView } from '../../../../shared/schema/competitor';
import type { CompetitorOverview } from '../../../../shared/schema/competitor-observation';
import { AboutButton } from '../../chrome';
import { keyOf, mutate, useResource } from '../api';
import { JotComposer } from '../jots/JotComposer';
import { JotItem } from '../jots/JotItem';
import { useCompetitors } from '../state';
import { ago, countShort, dateTime, Empty, Icon, Segmented, Thumb } from '../ui';
import { AddChannelDialog } from './AddChannelDialog';

const themeLabel = new Map<string, string>(PROFILE_THEMES.map((theme) => [theme.key, theme.label]));

export const tierChip = (tier: CompetitorTier): string => (tier === 'primary' ? 'is-accent' : tier === 'reference' ? 'is-info' : '');

export const channelName = (item: CompetitorListItem): string => item.alias || item.session?.title || item.input;

export const ChannelListScreen = ({ overview, loading }: { overview: CompetitorOverview | null; loading: boolean }) => {
  const { go, say } = useCompetitors();
  const [tier, setTier] = useState<'all' | CompetitorTier>('all');
  const [watch, setWatch] = useState<CompetitorWatch | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const channels = overview?.channels ?? [];

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return channels.filter((item) => {
      if (tier !== 'all' && item.tier !== tier) return false;
      if (watch && item.watchState !== watch) return false;
      if (!text) return true;
      return [channelName(item), item.input, ...item.tags].some((value) => value.toLowerCase().includes(text));
    });
  }, [channels, tier, watch, query]);

  const counts = useMemo(() => {
    const result: Record<'all' | CompetitorTier, number> = { all: channels.length, primary: 0, reference: 0, hold: 0 };
    for (const item of channels) result[item.tier] += 1;
    return result;
  }, [channels]);

  const syncAll = async () => {
    const result = await mutate(window.studio.syncCompetitors({ mode: 'refresh' }), ['overview']);
    if (!result.ok) say(result.message);
  };

  return (
    <>
      <header className="cp-row" style={{ alignItems: 'flex-end', gap: 16 }}>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <h1 className="cp-h1">競合</h1>
          <p className="cp-lead">数字が高いことと、自分にもできることは別です。学ぶ対象を先に見ます。</p>
        </div>
        <div className="cp-row">
          <AboutButton screen="competitors" />
          <button type="button" className="cp-btn" onClick={() => void syncAll()} disabled={overview?.sync.running}>
            <Icon name="refresh" />
            すべて更新
          </button>
          <button type="button" className="cp-btn" onClick={() => go('compare')}>
            <Icon name="compare" />
            横断比較
          </button>
          <button type="button" className="cp-btn is-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            チャンネルを追加
          </button>
        </div>
      </header>

      {overview && <StatusStrip sync={overview.sync} openJots={overview.observation.openJots} />}

      <div className="cp-row">
        <Segmented
          label="観察の区分"
          value={tier}
          onChange={setTier}
          options={[
            { value: 'all', label: 'すべて', count: counts.all },
            { value: 'primary', label: TIER_LABEL.primary, count: counts.primary },
            { value: 'reference', label: TIER_LABEL.reference, count: counts.reference },
            { value: 'hold', label: TIER_LABEL.hold, count: counts.hold },
          ]}
        />
        <div className="cp-row" style={{ gap: 6 }}>
          {(Object.keys(WATCH_LABEL) as CompetitorWatch[]).map((key) => (
            <button key={key} type="button" className="cp-chip-btn" aria-pressed={watch === key} onClick={() => setWatch(watch === key ? null : key)}>
              {WATCH_LABEL[key]}
            </button>
          ))}
        </div>
        <span className="cp-spacer" />
        <label className="cp-search">
          <Icon name="search" size={14} />
          <input type="search" value={query} placeholder="チャンネル名・タグで絞り込み" aria-label="チャンネルを絞り込み" onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      {loading && !overview ? (
        <p className="cp-loading">読み込んでいます…</p>
      ) : (
        <section aria-label="チャンネル" className="cp-grid-channels">
          {visible.map((item) => (
            <ChannelCard key={item.id} item={item} timeZone={overview?.sync.quota.timeZone} />
          ))}
          <button type="button" className="cp-add-card" onClick={() => setAdding(true)}>
            <Icon name="plus" size={28} />
            <span>URL・@ハンドル・チャンネルIDで追加</span>
            <span className="cp-faint">YouTube未接続でも登録できます</span>
          </button>
        </section>
      )}
      {channels.length > 0 && visible.length === 0 && <p className="cp-muted">条件に合うチャンネルはありません。</p>}

      {overview && <CompareEntry overview={overview} />}
      <InboxPreview />
      {adding && <AddChannelDialog onClose={() => setAdding(false)} />}
    </>
  );
};

const StatusStrip = ({ sync, openJots }: { sync: CompetitorSyncView; openJots: number }) => {
  const { go, say } = useCompetitors();
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState(String(sync.quota.budget));
  const run = sync.run;
  const progress = run && sync.running && run.processed > 0 ? Math.min(100, Math.round((run.succeeded / Math.max(run.processed, 1)) * 100)) : 0;
  const saveBudget = async () => {
    const result = await mutate(window.studio.updateCompetitorSettings({ quotaBudget: Number(budget) }), ['overview']);
    if (!result.ok) say(result.message);
    else setEditing(false);
  };
  return (
    <section aria-label="取得の状況" className="cp-strip">
      <div>
        <span className="cp-stat-label">取得</span>
        <div className="cp-row" style={{ gap: 8 }}>
          <span className="cp-dot" style={sync.running ? undefined : { background: 'var(--cp-faint)' }} />
          <strong style={{ fontSize: 14 }}>
            {sync.running ? `取得しています ${run?.succeeded ?? 0} 件` : run ? `最終 ${dateTime(run.finishedAt ?? run.requestedAt, sync.quota.timeZone)}` : 'まだ取得していません'}
          </strong>
        </div>
        {sync.running ? (
          <div className="cp-bar">
            <span style={{ width: `${progress || 8}%` }} />
          </div>
        ) : (
          run?.message && <span className="cp-faint">{run.message}</span>
        )}
      </div>
      <div>
        <span className="cp-stat-label">今日の使用 / 1日の上限</span>
        {editing ? (
          <div className="cp-row" style={{ gap: 6 }}>
            <input className="cp-input" style={{ width: 90, height: 30 }} value={budget} inputMode="numeric" aria-label="1日の上限" onChange={(event) => setBudget(event.target.value)} />
            <button type="button" className="cp-btn is-small" onClick={() => void saveBudget()}>
              保存
            </button>
          </div>
        ) : (
          <div className="cp-row" style={{ gap: 8 }}>
            <strong style={{ fontSize: 14 }}>
              {sync.quota.used.toLocaleString('ja-JP')} / {sync.quota.budget.toLocaleString('ja-JP')}
            </strong>
            <button type="button" className="cp-link" onClick={() => setEditing(true)}>
              上限を変える
            </button>
          </div>
        )}
        <div className="cp-bar">
          <span style={{ width: `${Math.min(100, (sync.quota.used / Math.max(sync.quota.budget, 1)) * 100)}%`, background: 'var(--cp-text-2)' }} />
        </div>
      </div>
      <div>
        <span className="cp-stat-label">数値の扱い</span>
        <div className="cp-row" style={{ gap: 6 }}>
          <span className="cp-chip is-pill">公開値は起動中だけ</span>
          <span className="cp-chip is-pill is-outline">数値の集計は vidIQ で確認</span>
        </div>
        <span className="cp-faint">公開APIの数値はアプリを閉じると破棄します</span>
      </div>
      <div>
        <span className="cp-stat-label">気づき</span>
        <strong style={{ fontSize: 14 }}>未整理 {openJots} 件</strong>
        <button type="button" className="cp-link" style={{ alignSelf: 'flex-start' }} onClick={() => go('inbox')}>
          受け箱を見る →
        </button>
      </div>
    </section>
  );
};

const ChannelCard = ({ item, timeZone }: { item: CompetitorListItem; timeZone?: string }) => {
  const { openChannel } = useCompetitors();
  const name = channelName(item);
  return (
    <button type="button" className="cp-channel" onClick={() => openChannel(item.id)}>
      <div className="cp-row" style={{ flexWrap: 'nowrap' }}>
        <div className="cp-avatar">
          {item.session?.thumbnailUrl ? <img src={item.session.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : name.replace(/^@/, '').slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div className="cp-faint">{item.session?.handle ?? item.input}</div>
        </div>
        <span className={`cp-chip is-pill ${tierChip(item.tier)}`}>{TIER_LABEL[item.tier]}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <div>
          <div className="cp-stat-label">登録者</div>
          <div className="cp-stat-value">{countShort(item.session?.subscriberCount)}</div>
        </div>
        <div>
          <div className="cp-stat-label">総再生</div>
          <div className="cp-stat-value">{countShort(item.session?.viewCount)}</div>
        </div>
        <div>
          <div className="cp-stat-label">動画数</div>
          <div className="cp-stat-value">{countShort(item.session?.videoCount)}</div>
        </div>
      </div>
      {item.recentVideos.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {item.recentVideos.map((video) => (
            <div key={video.videoId} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <Thumb video={video} />
              <span className="cp-faint">
                {countShort(video.viewCount)} · {ago(video.publishedAt)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="cp-faint">この起動ではまだ動画を取得していません。</span>
      )}
      {item.lastErrorMessage && <p className="cp-message" style={{ fontSize: 12 }}>{item.lastErrorMessage}</p>}
      <div className="cp-channel-foot">
        {item.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="cp-chip">
            {tag}
          </span>
        ))}
        <span className="cp-chip is-outline">{WATCH_LABEL[item.watchState]}</span>
        {!item.syncEnabled && <span className="cp-chip is-outline">収集停止</span>}
        <span className="cp-spacer" />
        <span className="cp-faint">最終取得 {dateTime(item.lastSuccessAt, timeZone)}</span>
      </div>
    </button>
  );
};

const CompareEntry = ({ overview }: { overview: CompetitorOverview }) => {
  const { go } = useCompetitors();
  const { profileFilled, profileSubjects, commons } = overview.observation;
  return (
    <section aria-label="横断比較" className="cp-card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '16px 28px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
        <strong style={{ fontSize: 15 }}>横断比較</strong>
        <span className="cp-small cp-muted">
          観察プロフィールの記入 <strong style={{ color: 'var(--cp-text)' }}>{profileFilled} / {profileSubjects}</strong>
        </span>
        <div className="cp-bar" style={{ width: 200 }}>
          <span style={{ width: `${(profileFilled / Math.max(profileSubjects, 1)) * 100}%` }} />
        </div>
      </div>
      <div className="cp-row" style={{ flex: '1 1 360px' }}>
        <span className="cp-small cp-muted">共通点の候補</span>
        {commons.length === 0 ? (
          <span className="cp-faint">2つ以上のチャンネルで同じラベルを付けると出ます</span>
        ) : (
          commons.map((item) => (
            <span key={`${item.theme}-${item.label}`} className="cp-chip is-common" style={{ fontSize: 12, padding: '3px 9px' }}>
              {themeLabel.get(item.theme)}「{item.label}」 {item.count}/{item.total}
            </span>
          ))
        )}
      </div>
      <button type="button" className="cp-btn" onClick={() => go('compare')}>
        横断比較を開く →
      </button>
    </section>
  );
};

const InboxPreview = () => {
  const { go } = useCompetitors();
  const jots = useResource(keyOf('jots', { status: 'open', limit: 5 }), () => window.studio.competitorJots({ status: 'open', limit: 5 }));
  return (
    <section id="inbox" aria-label="気づきの受け箱" className="cp-card">
      <div className="cp-row">
        <strong style={{ fontSize: 15 }}>気づきの受け箱</strong>
        <span className="cp-small cp-muted">観察中に書き溜めたものを、選んで仮説検証へ渡します</span>
        <span className="cp-spacer" />
        <button type="button" className="cp-btn is-small" onClick={() => go('inbox')}>
          すべて見る（未整理 {jots.data?.total ?? 0}）
        </button>
      </div>
      <JotComposer channelId={null} videoId={null} compact placeholder="チャンネルに紐づけずに書くこともできます" />
      {jots.data && jots.data.items.length === 0 && <Empty title="未整理の気づきはありません">動画を見ながら思ったことを書き溜めていきます。</Empty>}
      {jots.data?.items.map((jot) => <JotItem key={jot.id} jot={jot} showChannel />)}
    </section>
  );
};
