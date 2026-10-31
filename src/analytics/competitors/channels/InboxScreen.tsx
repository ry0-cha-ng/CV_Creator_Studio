import { useState } from 'react';
import { AboutButton } from '../../chrome';
import { keyOf, mutate, useResource } from '../api';
import { JotComposer } from '../jots/JotComposer';
import { JotItem } from '../jots/JotItem';
import { useCompetitors } from '../state';
import { Empty, Segmented } from '../ui';

const PAGE = 50;
/** competitors:jots:list が一度に返せる上限。 */
const MAX = 200;

/** 全チャンネルの気づき。選んで仮説検証へ渡す。 */
export const InboxScreen = () => {
  const { say } = useCompetitors();
  const [status, setStatus] = useState<'open' | 'handed_off' | 'all'>('open');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string[]>([]);
  const query = { status, limit };
  const jots = useResource(keyOf('jots', query), () => window.studio.competitorJots(query));
  const openCount = useResource(keyOf('jots', { status: 'open', limit: 1 }), () => window.studio.competitorJots({ status: 'open', limit: 1 }));
  const handedCount = useResource(keyOf('jots', { status: 'handed_off', limit: 1 }), () =>
    window.studio.competitorJots({ status: 'handed_off', limit: 1 }),
  );

  const handOff = async () => {
    const result = await mutate(window.studio.handOffCompetitorJots(selected), ['jots', 'overview']);
    if (!result.ok) {
      say(result.message);
      return;
    }
    setSelected([]);
    say(`${result.data.count} 件を仮説検証へ渡しました。仮説検証の機能ができるまでは、渡した印だけが付きます`, 'info');
  };

  return (
    <>
      <header className="cp-row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 420px' }}>
          <h1 className="cp-h1">気づき</h1>
          <p className="cp-lead">観察中に書き溜めたものです。数字の書き写しではなく、自分の言葉で残します。</p>
        </div>
        <AboutButton screen="competitors" />
      </header>
      <section className="cp-card" aria-label="気づきの受け箱">
        <div className="cp-row">
          <Segmented
            label="状態"
            value={status}
            sunk
            onChange={(value) => {
              setStatus(value);
              setSelected([]);
              setLimit(PAGE);
            }}
            options={[
              { value: 'open', label: '未整理', count: openCount.data?.total },
              { value: 'handed_off', label: '渡した', count: handedCount.data?.total },
              { value: 'all', label: 'すべて' },
            ]}
          />
          <span className="cp-spacer" />
          <button type="button" className="cp-btn is-info is-small" disabled={selected.length === 0} onClick={() => void handOff()}>
            選んだ {selected.length} 件を仮説検証へ渡す
          </button>
        </div>
        <JotComposer channelId={null} videoId={null} compact placeholder="チャンネルに紐づけずに書くこともできます" />
        {jots.loading && !jots.data && <p className="cp-loading">読み込んでいます…</p>}
        {jots.error && <p className="cp-message">{jots.error}</p>}
        {jots.data && jots.data.items.length === 0 && <Empty title="ここに表示する気づきはありません" />}
        {jots.data?.items.map((jot) => (
          <JotItem
            key={jot.id}
            jot={jot}
            showChannel
            selected={selected.includes(jot.id)}
            onSelect={(value) => setSelected((current) => (value ? [...current, jot.id] : current.filter((id) => id !== jot.id)))}
          />
        ))}
        {jots.data && jots.data.total > jots.data.items.length && limit < MAX && (
          <button type="button" className="cp-btn" style={{ alignSelf: 'center' }} onClick={() => setLimit((value) => Math.min(MAX, value + PAGE))}>
            さらに表示
          </button>
        )}
        {jots.data && jots.data.total > MAX && limit >= MAX && <span className="cp-faint">新しい順に {MAX} 件まで表示しています。</span>}
      </section>
    </>
  );
};
