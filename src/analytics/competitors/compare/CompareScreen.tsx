import { useMemo, useState } from 'react';
import { VIDIQ_HOME } from '../../../../shared/competitor';
import { computeCommons, PROFILE_THEMES, type CommonCandidate, type ProfileTheme } from '../../../../shared/competitor-observation';
import type { ProfileEntry, ProfileSubject } from '../../../../shared/schema/competitor-observation';
import { AboutButton } from '../../chrome';
import { keyOf, mutate, useResource } from '../api';
import { ProfileGrid } from '../profile/ProfileGrid';
import { useCompetitors } from '../state';
import { dateOnly, Empty, requestId } from '../ui';

const themeLabel = new Map<string, string>(PROFILE_THEMES.map((theme) => [theme.key, theme.label]));

const FUTURE = [
  { title: '投稿の曜日 × 時間帯', note: 'どの枠に投稿が集まっているか' },
  { title: '投稿頻度と継続性', note: '本数の推移と、空いた期間' },
  { title: '形式と画面の向きの比率', note: 'Shorts・通常・ライブの割合' },
  { title: '尺の分布', note: '形式ごとの長さのばらつき' },
  { title: 'タイトルの型', note: '文字数・【】・数字・疑問形の傾向' },
];

export const CompareScreen = () => {
  const { state, setCompareSubjects, say } = useCompetitors();
  const matrix = useResource(keyOf('matrix', []), () => window.studio.competitorProfileMatrix([]));
  const [editing, setEditing] = useState<ProfileSubject | null>(null);
  const subjects = matrix.data?.subjects ?? [];
  const chosen = state.compareSubjects ? subjects.filter((subject) => state.compareSubjects?.includes(subject.id)) : subjects;
  const chosenIds = chosen.map((subject) => subject.id);
  const entries = matrix.data?.entries ?? [];
  const commons = useMemo(() => computeCommons(entries, chosenIds), [entries, chosenIds.join()]);
  const commonKeys = useMemo(() => new Set(commons.map((item) => `${item.theme}\u0000${item.label}`)), [commons]);
  const filled = new Set(entries.filter((entry) => chosenIds.includes(entry.subject) && (entry.labels.length > 0 || entry.note)).map((entry) => entry.subject));
  const labelOf = new Map(subjects.map((subject) => [subject.id, subject.label]));

  const toggle = (id: string) => {
    const current = state.compareSubjects ?? subjects.map((subject) => subject.id);
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    setCompareSubjects(next.length === subjects.length ? null : next);
  };

  const jotCommon = async (item: CommonCandidate) => {
    const who = item.subjects.map((id) => labelOf.get(id) ?? id).join('・');
    const result = await mutate(
      window.studio.saveCompetitorJot({
        clientRequestId: requestId(),
        channelId: null,
        videoId: null,
        body: `共通点の候補：${themeLabel.get(item.theme)}「${item.label}」（${who}）`,
      }),
      ['jots', 'overview'],
    );
    if (!result.ok) say(result.message);
    else say('気づきの受け箱に書き留めました', 'info');
  };

  const openVidiq = async (url: string = VIDIQ_HOME) => {
    const result = await window.studio.openCompetitorUrl(url);
    if (!result.ok) say(result.message);
  };

  return (
    <>
      <header className="cp-row" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 420px' }}>
          <h1 className="cp-h1">横断比較</h1>
          <p className="cp-lead">vidIQ などで確かめた内容を、あなたが選んだラベルと自分の言葉で残した「観察プロフィール」を並べます。数値は書き写しません。</p>
        </div>
        <AboutButton screen="competitor-compare" />
      </header>

      <section aria-label="比べる対象" className="cp-card is-tight" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="cp-small cp-muted" style={{ width: 48 }}>
          対象
        </span>
        {subjects.map((subject) => (
          <button key={subject.id} type="button" className="cp-chip-btn" aria-pressed={chosenIds.includes(subject.id)} onClick={() => toggle(subject.id)} style={subject.self ? { fontWeight: 700 } : undefined}>
            {subject.label}
          </button>
        ))}
        <span className="cp-spacer" />
        <span className="cp-small cp-muted">
          プロフィール記入 <strong style={{ color: 'var(--cp-text)' }}>{filled.size} / {chosen.length}</strong>
        </span>
      </section>

      <section aria-label="共通点の候補" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="cp-row" style={{ alignItems: 'baseline' }}>
          <h2 className="cp-h2" style={{ fontSize: 16 }}>
            共通点の候補
          </h2>
          <span className="cp-small cp-muted">あなたが付けたラベルのうち、記入したチャンネルの過半数で同じものを並べます</span>
        </div>
        {commons.length === 0 ? (
          <Empty title="まだ共通点の候補はありません">2つ以上の対象で、同じテーマに同じラベルを付けると出てきます。</Empty>
        ) : (
          <div className="cp-grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {commons.slice(0, 6).map((item) => (
              <article key={`${item.theme}-${item.label}`} className="cp-card is-tight">
                <div className="cp-row" style={{ gap: 8 }}>
                  <span className="cp-chip is-info" style={{ fontWeight: 700 }}>
                    {themeLabel.get(item.theme)}
                  </span>
                  <span className="cp-small cp-muted">
                    {item.count} / {item.total}
                  </span>
                </div>
                <strong style={{ fontSize: 15 }}>「{item.label}」</strong>
                <div style={{ display: 'flex', gap: 3 }} aria-hidden="true">
                  {Array.from({ length: item.total }, (_value, index) => (
                    <span key={index} style={{ width: 24, height: 6, borderRadius: 3, background: index < item.count ? '#3987e5' : 'var(--cp-line-strong)' }} />
                  ))}
                </div>
                <span className="cp-faint">{item.subjects.map((id) => labelOf.get(id) ?? id).join('・')}</span>
                <div className="cp-row">
                  <span className="cp-spacer" />
                  <button type="button" className="cp-btn is-small" onClick={() => void jotCommon(item)}>
                    気づきとして書き留める
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-label="観察マトリクス" className="cp-card">
        <div className="cp-row" style={{ alignItems: 'baseline' }}>
          <h2 className="cp-h2" style={{ fontSize: 16 }}>
            観察マトリクス
          </h2>
          <span className="cp-small cp-muted">行がテーマ、列が対象です。セルを押すと、その対象の観察プロフィールを編集できます</span>
          <span className="cp-spacer" />
          <span className="cp-faint">
            <span className="cp-chip is-common" style={{ fontSize: 10 }}>
              青枠
            </span>{' '}
            ＝共通点の候補に入っているラベル · 見直し時期＝確認から60日以上
          </span>
        </div>
        {matrix.error && <p className="cp-message">{matrix.error}</p>}
        <div className="cp-table-wrap">
          <table className="cp-matrix">
            <thead>
              <tr>
                <th scope="col" style={{ width: 150, color: 'var(--cp-faint)', fontSize: 11 }}>
                  テーマ
                </th>
                {chosen.map((subject) => (
                  <th key={subject.id} scope="col" className={subject.self ? 'is-self' : undefined} style={subject.self ? { fontWeight: 700 } : undefined}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>{subject.label}</span>
                      {subject.vidiqUrl && (
                        <button
                          type="button"
                          className="cp-link"
                          style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 400 }}
                          onClick={() => void openVidiq(subject.vidiqUrl ?? VIDIQ_HOME)}
                        >
                          vidIQ で確かめる ↗
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PROFILE_THEMES.map((theme) => (
                <tr key={theme.key}>
                  <th scope="row">
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{theme.label}</span>
                  </th>
                  {chosen.map((subject) => (
                    <td key={subject.id} className={subject.self ? 'is-self' : undefined}>
                      <MatrixCell
                        entry={entries.find((entry) => entry.subject === subject.id && entry.theme === theme.key)}
                        theme={theme.key}
                        commonKeys={commonKeys}
                        onEdit={() => setEditing(subject)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="将来やりたい分析" className="cp-card is-dashed">
        <div className="cp-row" style={{ alignItems: 'baseline' }}>
          <h2 className="cp-h3" style={{ fontSize: 14 }}>
            将来やりたい分析
          </h2>
          <span className="cp-small cp-muted">数値での集計は、いまは vidIQ で確かめて、結果を観察プロフィールに自分の言葉で残します</span>
        </div>
        <div className="cp-grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {FUTURE.map((item) => (
            <div key={item.title} className="cp-card is-tight is-sunk" style={{ gap: 6, border: 0 }}>
              <strong className="cp-small" style={{ fontSize: 13 }}>
                {item.title}
              </strong>
              <span className="cp-faint">{item.note}</span>
              <button type="button" className="cp-link" style={{ alignSelf: 'flex-start' }} onClick={() => void openVidiq()}>
                いまは vidIQ で確かめる ↗
              </button>
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <div className="cp-dialog-layer" role="presentation" onClick={() => setEditing(null)}>
          <section
            className="cp-dialog"
            style={{ width: 'min(1040px, 100%)' }}
            role="dialog"
            aria-modal="true"
            aria-label={`${editing.label}の観察プロフィール`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="cp-row">
              <h2 className="cp-h2">{editing.label}の観察プロフィール</h2>
              <span className="cp-spacer" />
              <button type="button" className="cp-btn is-small" onClick={() => setEditing(null)}>
                閉じる
              </button>
            </div>
            <ProfileGrid subject={editing.id} vidiqUrl={editing.vidiqUrl} />
          </section>
        </div>
      )}
    </>
  );
};

const MatrixCell = ({
  entry,
  theme,
  commonKeys,
  onEdit,
}: {
  entry: ProfileEntry | undefined;
  theme: ProfileTheme;
  commonKeys: Set<string>;
  onEdit: () => void;
}) => {
  if (!entry || (entry.labels.length === 0 && !entry.note)) {
    return (
      <button type="button" className="cp-matrix-empty" onClick={onEdit}>
        + 記入する
      </button>
    );
  }
  return (
    <button type="button" className="cp-matrix-cell" style={entry.stale ? { opacity: 0.7 } : undefined} onClick={onEdit}>
      <span className="cp-row" style={{ gap: 4 }}>
        {entry.labels.map((label) => (
          <span key={label} className={`cp-chip${commonKeys.has(`${theme}\u0000${label}`) ? ' is-common' : ''}`}>
            {label}
          </span>
        ))}
      </span>
      {entry.note && <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--cp-text-2)' }}>{entry.note}</span>}
      <span className={`cp-faint${entry.stale ? ' cp-stale' : ''}`} style={{ fontSize: 10 }}>
        {entry.confirmedAt ? `確認 ${dateOnly(entry.confirmedAt)}` : '未確認'}
        {entry.stale ? ' · 見直し時期' : ''}
      </span>
    </button>
  );
};
