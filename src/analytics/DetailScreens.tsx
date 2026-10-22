import { useMemo, useState } from 'react';
import {
  METRIC_LABELS,
  VARIABLE_LABELS,
  VARIABLE_PRESETS,
  appCtr,
  attributesOf,
  differingVariables,
  filterPosts,
  formatInt,
  formatPct,
  formatRatioPct,
  groupMetric,
  isReferenceSample,
  langLabel,
  latestSnapshot,
  platformLabel,
  readyTasks,
  savesPer1k,
  savesPerHour,
  unlinkedConclusions,
  weekRangeLabel,
  type OverviewFilters,
} from '../../shared/analytics';
import type {
  AnalyticsExperiment,
  AnalyticsPost,
  Insight,
  InsightStatus,
  PrimaryMetric,
  PrimaryVariable,
} from '../../shared/schema/analytics';
import { AboutButton } from './chrome';
import type { DetailTab } from './context';
import { useAnalytics } from './context';

const statusLabel = (status: string): string => {
  if (status === 'running') return '実施中';
  if (status === 'planned') return '計画中';
  if (status === 'completed') return '完了';
  if (status === 'archived') return '完了・判断できず';
  if (status === 'done') return '完了';
  if (status === 'ready' || status === 'in-progress') return '振り返り待ち';
  if (status === 'waiting') return '7日前';
  return '7日の数字なし';
};

export const DetailShell = ({
  tab,
  onTab,
}: {
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
}) => {
  const screen = tab === 'overview' ? 'overview' : tab === 'posts' ? 'posts' : tab === 'experiments' ? 'experiments' : 'insights';
  return (
    <div className="an-page">
      <div className="an-tabs">
        {(['overview', 'posts', 'experiments', 'insights'] as const).map((item) => (
          <button key={item} type="button" aria-pressed={tab === item} onClick={() => onTab(item)}>
            {item === 'overview' ? 'Overview' : item === 'posts' ? 'Posts' : item === 'experiments' ? 'Experiments' : 'Insights'}
          </button>
        ))}
        <span className="an-spacer" />
        <AboutButton screen={screen} />
        {(tab === 'overview' || tab === 'posts') && (
          <button type="button" className="an-ghost" onClick={() => void window.studio.exportAnalyticsCsv()}>
            CSV に書き出す
          </button>
        )}
      </div>
      {tab === 'overview' && <OverviewPanel />}
      {tab === 'posts' && <PostsPanel />}
      {tab === 'experiments' && <ExperimentsPanel />}
      {tab === 'insights' && <InsightsPanel />}
    </div>
  );
};

const OverviewPanel = () => {
  const { bundle } = useAnalytics();
  const [filters, setFilters] = useState<OverviewFilters>({
    days: 30,
    platform: 'all',
    lang: 'all',
    series: 'all',
    templateId: 'all',
  });
  const [metric, setMetric] = useState<'savesPer1k' | 'views' | 'appCtr'>('savesPer1k');
  if (!bundle) return null;
  const posts = filterPosts(bundle, filters);
  const with7 = posts.filter((post) => latestSnapshot(bundle.snapshots, post.id));
  const previous = filterPosts(bundle, { ...filters, days: filters.days ? filters.days * 2 : null }).filter(
    (post) => !posts.includes(post),
  );
  const sum = (items: AnalyticsPost[], pick: (post: AnalyticsPost) => number | null) =>
    items.reduce((total, post) => total + (pick(post) ?? 0), 0);
  const saves = sum(with7, (post) => latestSnapshot(bundle.snapshots, post.id)?.lineupSaves ?? null);
  const views = sum(with7, (post) => latestSnapshot(bundle.snapshots, post.id)?.views ?? null);
  const visits = sum(with7, (post) => latestSnapshot(bundle.snapshots, post.id)?.clutchVaultVisits ?? null);
  const prevSaves = sum(previous, (post) => latestSnapshot(bundle.snapshots, post.id)?.lineupSaves ?? null);
  const delta = (current: number, before: number) => (before === 0 ? '—' : `${current - before >= 0 ? '+' : '−'}${Math.abs(Math.round(((current - before) / before) * 100))}%`);
  const ctrValues = with7.map((post) => appCtr(latestSnapshot(bundle.snapshots, post.id))).filter((item): item is number => item !== null);
  const ctr = ctrValues.length ? ctrValues.reduce((a, b) => a + b, 0) / ctrValues.length : null;
  const per1k = views === 0 ? null : (saves / views) * 1000;
  const hours = with7.reduce((total, post) => total + (post.content.durationSec ? 0 : 0), 0);
  void hours;
  const perHour = savesPerHour(
    { lineupSaves: saves, id: '', postId: '', capturedAt: '', ageBucket: '7d', source: 'manual' },
    undefined,
  );
  const panels = [
    ['マップ別', 'map'],
    ['フック別', 'hook'],
    ['オープニング別', 'opening'],
  ] as const;
  return (
    <div className="an-scroll">
      <div className="an-filters">
        <label>期間
          <select className="an-select" value={String(filters.days ?? 'all')} onChange={(event) => setFilters({ ...filters, days: event.target.value === 'all' ? null : Number(event.target.value) })}>
            <option value="7">直近7日</option>
            <option value="30">直近30日</option>
            <option value="90">直近90日</option>
            <option value="all">すべて</option>
          </select>
        </label>
        <label>媒体
          <select className="an-select" value={filters.platform} onChange={(event) => setFilters({ ...filters, platform: event.target.value })}>
            <option value="all">すべて</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="x">X</option>
          </select>
        </label>
        <label>言語
          <select className="an-select" value={filters.lang} onChange={(event) => setFilters({ ...filters, lang: event.target.value })}>
            <option value="all">すべて</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </label>
        <label>シリーズ
          <select className="an-select" value={filters.series} onChange={(event) => setFilters({ ...filters, series: event.target.value })}>
            <option value="all">すべて</option>
            {[...new Set(bundle.posts.map((post) => post.content.series))].map((series) => (
              <option key={series} value={series}>{series}</option>
            ))}
          </select>
        </label>
        <label>テンプレート
          <select className="an-select" value={filters.templateId} onChange={(event) => setFilters({ ...filters, templateId: event.target.value })}>
            <option value="all">すべて</option>
            <option value="t-std">T-STD</option>
            <option value="t-guide">T-GUIDE</option>
          </select>
        </label>
        <span className="an-muted">対象：投稿 {posts.length}件（7日の数字あり {with7.length}件）</span>
      </div>
      <div className="an-tiles">
        <article className="an-card an-tile is-north"><span>定点の保存（北極星）</span><b>{formatInt(saves)}</b><span>{delta(saves, prevSaves)}</span></article>
        <article className="an-card an-tile"><span>視聴回数</span><b>{formatInt(views)}</b></article>
        <article className="an-card an-tile"><span>ClutchVault 訪問</span><b>{formatInt(visits)}</b></article>
        <article className="an-card an-tile"><span>App CTR</span><b>{formatRatioPct(ctr)}</b></article>
        <article className="an-card an-tile"><span>保存 / 1,000視聴</span><b>{per1k === null ? '—' : per1k.toFixed(2)}</b></article>
        <article className="an-card an-tile"><span>保存 / 制作1時間</span><b>{perHour === null ? '—' : perHour.toFixed(1)}</b></article>
      </div>
      {panels.map(([title, key]) => {
        const rows = groupMetric(bundle, with7, key, metric);
        const max = Math.max(...rows.map((row) => row.value ?? 0), 1);
        return (
          <section key={key} className="an-card an-task">
            <div className="an-row">
              <strong>{title}</strong>
              <select className="an-select is-compact" aria-label={`${title}の指標`} value={metric} onChange={(event) => setMetric(event.target.value as typeof metric)}>
                <option value="savesPer1k">保存 / 1,000視聴</option>
                <option value="views">視聴回数</option>
                <option value="appCtr">App CTR</option>
              </select>
            </div>
            {rows.map((row) => (
              <div key={row.name} className={`an-row ${isReferenceSample(row.count) ? 'an-ref' : ''}`}>
                <span style={{ width: 120 }}>{row.name}</span>
                <span className="an-bar" style={{ flex: 1 }}><span style={{ width: `${((row.value ?? 0) / max) * 100}%` }} /></span>
                <span className="an-mono">{metric === 'appCtr' ? formatRatioPct(row.value) : metric === 'views' ? formatInt(row.value) : row.value === null ? '—' : row.value.toFixed(2)}</span>
                <span className="an-muted">n={row.count}{isReferenceSample(row.count) ? ' 参考値' : ''}</span>
              </div>
            ))}
            <p className="an-muted">n&lt;3 は薄く表示（参考値）。実験中の比較です。</p>
          </section>
        );
      })}
    </div>
  );
};

const reviewState = (bundle: ReturnType<typeof useAnalytics>['bundle'], post: AnalyticsPost): string => {
  if (!bundle) return '7日の数字なし';
  const task = bundle.tasks.find((item) => item.postId === post.id && item.type === '7d-review');
  if (!latestSnapshot(bundle.snapshots, post.id)) return task?.status === 'waiting' ? '7日前' : '7日の数字なし';
  if (!task || task.status === 'done') return '完了';
  if (task.status === 'ready' || task.status === 'in-progress') return '振り返り待ち';
  return statusLabel(task.status);
};

const PostsPanel = () => {
  const { bundle, openExperimentNew } = useAnalytics();
  const [filter, setFilter] = useState<'all' | 'missing' | 'open'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  if (!bundle) return null;
  const rows = bundle.posts.filter((post) => {
    const state = reviewState(bundle, post);
    if (filter === 'missing') return state === '7日の数字なし';
    if (filter === 'open') return state === '振り返り待ち' || state === '7日前';
    return true;
  });
  const selected = bundle.posts.filter((post) => picked.includes(post.id));
  const diffs = selected.length >= 2 ? differingVariables(selected) : [];
  const counts = {
    all: bundle.posts.length,
    missing: bundle.posts.filter((post) => reviewState(bundle, post) === '7日の数字なし').length,
    open: bundle.posts.filter((post) => ['振り返り待ち', '7日前'].includes(reviewState(bundle, post))).length,
  };
  return (
    <div className="an-scroll">
      <div className="an-chips">
        <button type="button" className="an-chip-btn" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>すべて {counts.all}</button>
        <button type="button" className="an-chip-btn" aria-pressed={filter === 'missing'} onClick={() => setFilter('missing')}>7日の数字なし {counts.missing}</button>
        <button type="button" className="an-chip-btn" aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>振り返り未完了 {counts.open}</button>
      </div>
      <p className="an-muted">2〜4件にチェックすると比べられます</p>
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              {['選択', '投稿日', '媒体', '定点', 'フック', 'オープニング', '視聴（7日）', '再生率', 'App CTR', '保存', '振り返り'].map((head) => (
                <th key={head}>{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((post) => {
              const snapshot = latestSnapshot(bundle.snapshots, post.id);
              const on = picked.includes(post.id);
              return (
                <tr key={post.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${post.content.map} を比較`}
                      checked={on}
                      onChange={() =>
                        setPicked((current) => {
                          if (current.includes(post.id)) return current.filter((id) => id !== post.id);
                          if (current.length >= 4) return current;
                          return [...current, post.id];
                        })
                      }
                    />
                  </td>
                  <td className="an-mono">{post.postedAt.slice(0, 10)}</td>
                  <td>{platformLabel(post.platform)}</td>
                  <td>{post.content.map}</td>
                  <td>{post.hookPattern}</td>
                  <td>{attributesOf(post).opening}</td>
                  <td className="an-mono">{formatInt(snapshot?.views)}</td>
                  <td className="an-mono">{formatPct(snapshot?.averagePercentageViewed ?? snapshot?.completionRate)}</td>
                  <td className="an-mono">{formatRatioPct(appCtr(snapshot))}</td>
                  <td className="an-mono">{formatInt(snapshot?.lineupSaves)}</td>
                  <td>{reviewState(bundle, post)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected.length >= 2 && (
        <section className="an-card an-task">
          <strong>{selected.length}件を比較</strong>
          <span className="an-muted">違う項目だけ強調しています</span>
          {(Object.keys(VARIABLE_LABELS) as PrimaryVariable[]).map((key) => {
            const values = selected.map((post) => attributesOf(post)[key]);
            const different = new Set(values).size > 1;
            if (!different && key !== 'hook') return null;
            return (
              <div key={key} className={`an-row ${different ? 'an-diff' : ''}`}>
                <span style={{ width: 100 }}>{VARIABLE_LABELS[key]}</span>
                {values.map((value, index) => (
                  <span key={selected[index]?.id}>{value}</span>
                ))}
              </div>
            );
          })}
          {diffs.length >= 2 && <p className="an-warn">差の原因は1つに決められません</p>}
          <button
            type="button"
            className="an-primary"
            onClick={() => openExperimentNew(diffs.length === 1 ? diffs[0] : undefined)}
          >
            この{selected.length}件で実験を作る
          </button>
        </section>
      )}
    </div>
  );
};

const ExperimentsPanel = () => {
  const { bundle, reload, openExperimentNew } = useAnalytics();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  if (!bundle) return null;
  const selected = bundle.experiments.find((item) => item.id === (selectedId ?? bundle.experiments[0]?.id));
  const running = bundle.experiments.some((item) => item.status === 'running');
  return (
    <div className="an-columns">
      <div className="an-list">
        <button type="button" className="an-primary" onClick={() => openExperimentNew()}>＋ 新しい実験</button>
        <p className="an-muted">実施中は同時に1つまでをおすすめします{running ? '（いま1つ実施中）' : ''}</p>
        {bundle.experiments.map((experiment) => (
          <button key={experiment.id} type="button" className="an-exp" aria-pressed={selected?.id === experiment.id} onClick={() => setSelectedId(experiment.id)}>
            <span className="an-chip">{experiment.status === 'running' ? '実施中' : experiment.status === 'planned' ? '計画中' : experiment.conclusion === 'adopt' ? '完了 · 採用' : '完了・判断できず'}</span>
            <div>動かす：{VARIABLE_LABELS[experiment.primaryVariable]}</div>
            <strong>{experiment.name}</strong>
            <span className="an-muted">主KPI {METRIC_LABELS[experiment.primaryMetric]}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="an-detail">
          <div className="an-row">
            <span className="an-chip">{selected.status === 'running' ? '実施中' : selected.status}</span>
            <span className="an-mono an-muted">{selected.startedAt?.slice(0, 10) || '未開始'}</span>
          </div>
          <h1>{selected.name}</h1>
          <p>仮説：{selected.hypothesis}</p>
          <div className="an-row">
            <button type="button" className="an-secondary" onClick={() => void (async () => {
              await window.studio.concludeAnalyticsExperiment(selected.id, 'adopt', summary || '採用');
              await reload();
            })()}>結論を記録</button>
            <button type="button" className="an-ghost" aria-label="アーカイブ" onClick={() => void window.studio.archiveAnalyticsExperiment(selected.id).then(reload)}>…</button>
          </div>
          <div className="an-grid-4">
            <article className="an-card an-mini"><span>動かす変数</span><b>{VARIABLE_LABELS[selected.primaryVariable]}</b></article>
            <article className="an-card an-mini"><span>主KPI</span><b>{METRIC_LABELS[selected.primaryMetric]}</b></article>
            <article className="an-card an-mini"><span>副KPI</span><b>App CTR</b></article>
            <article className="an-card an-mini"><span>媒体</span><b>{selected.targetPlatform || '指定なし'}</b></article>
          </div>
          <div className="an-split">
            <ArmCard bundle={bundle} experiment={selected} arm="control" />
            <ArmCard bundle={bundle} experiment={selected} arm="variant" />
          </div>
          <p className="an-muted">意図せず変わった項目：{selected.secondaryChangedVariables.join(' · ') || 'なし'}</p>
          <div className="an-table-wrap">
            <table className="an-table">
              <thead>
                <tr><th>投稿日</th><th>媒体</th><th>役割</th><th>定点</th><th>振り返り</th></tr>
              </thead>
              <tbody>
                {bundle.posts.filter((post) => post.experimentId === selected.id).map((post) => (
                  <tr key={post.id}>
                    <td className="an-mono">{post.postedAt.slice(0, 10)}</td>
                    <td>{platformLabel(post.platform)}</td>
                    <td>{post.experimentArm === 'control' ? 'Control' : 'Variant'}</td>
                    <td>{post.content.map}</td>
                    <td>{reviewState(bundle, post)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>結論のメモ
            <textarea className="an-memo" value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <div className="an-row">
            {(['adopt', 'hold', 'reject', 'inconclusive'] as const).map((conclusion) => (
              <button key={conclusion} type="button" className="an-ghost" onClick={() => void window.studio.concludeAnalyticsExperiment(selected.id, conclusion, summary).then(reload)}>
                {conclusion === 'adopt' ? '採用' : conclusion === 'hold' ? '保留' : conclusion === 'reject' ? '不採用' : '判断できず'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ArmCard = ({
  bundle,
  experiment,
  arm,
}: {
  bundle: NonNullable<ReturnType<typeof useAnalytics>['bundle']>;
  experiment: AnalyticsExperiment;
  arm: 'control' | 'variant';
}) => {
  const count = bundle.posts.filter((post) => post.experimentId === experiment.id && post.experimentArm === arm).length;
  return (
    <article className="an-card an-mini">
      <span>{arm === 'control' ? 'Control' : 'Variant'}</span>
      <strong>{arm === 'control' ? experiment.controlLabel : experiment.variantLabels[0]}</strong>
      <span className="an-mono">{count} / {experiment.plannedCountPerArm}本</span>
    </article>
  );
};

export const ExperimentNew = ({ variable }: { variable?: PrimaryVariable }) => {
  const { bundle, reload, openDetail } = useAnalytics();
  const initial = variable ?? 'cta';
  const preset = VARIABLE_PRESETS[initial];
  const [primary, setPrimary] = useState<PrimaryVariable>(initial);
  const [control, setControl] = useState(preset.control);
  const [variant, setVariant] = useState(preset.variant);
  const [hypothesis, setHypothesis] = useState(preset.hypothesis);
  const [metric, setMetric] = useState<PrimaryMetric>(preset.metric);
  const [platform, setPlatform] = useState('YouTube English');
  const [count, setCount] = useState<2 | 3 | 5>(3);
  const [wait, setWait] = useState(true);
  const latest = useMemo(
    () => [...(bundle?.posts ?? [])].sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0],
    [bundle],
  );
  const running = bundle?.experiments.some((item) => item.status === 'running');
  const choose = (next: PrimaryVariable) => {
    const nextPreset = VARIABLE_PRESETS[next];
    setPrimary(next);
    setControl(nextPreset.control);
    setVariant(nextPreset.variant);
    setHypothesis(nextPreset.hypothesis);
    setMetric(nextPreset.metric);
  };
  const fixed = latest ? Object.entries(attributesOf(latest)).filter(([key]) => key !== primary) : [];
  const create = async () => {
    await window.studio.saveAnalyticsExperiment({
      name: `${variant} vs ${control}`,
      hypothesis,
      primaryVariable: primary,
      controlLabel: control,
      variantLabels: [variant],
      primaryMetric: metric,
      targetPlatform: platform,
      plannedCountPerArm: count,
      fixedConditions: Object.fromEntries(fixed),
      status: running && wait ? 'planned' : 'running',
      startedAt: running && wait ? undefined : new Date().toISOString(),
      secondaryMetrics: ['averagePercentageViewed', 'lineupSaves'],
    });
    await reload();
    openDetail('experiments');
  };
  return (
    <div className="an-page">
      <div className="an-main">
        <div className="an-main-head">
          <div>
            <button type="button" className="an-ghost" onClick={() => openDetail('experiments')}>← Experiments</button>
            <h1>新しい実験</h1>
            <p className="an-muted">動かす変数は1つだけ選びます。ほかの条件は前回の動画にそろえます</p>
          </div>
          <AboutButton screen="experiment-new" />
        </div>
        <div className="an-work" style={{ overflow: 'auto' }}>
          <div style={{ flex: 1 }}>
            <h2>動かす変数</h2>
            <div className="an-grid-2" role="radiogroup" aria-label="動かす変数">
              {(Object.keys(VARIABLE_LABELS) as PrimaryVariable[]).map((item) => (
                <button key={item} type="button" className="an-radio" role="radio" aria-checked={primary === item} onClick={() => choose(item)}>
                  {VARIABLE_LABELS[item]}
                </button>
              ))}
            </div>
            <label>Control 今のやり方<input value={control} onChange={(event) => setControl(event.target.value)} /></label>
            <label>Variant 試すやり方<input value={variant} onChange={(event) => setVariant(event.target.value)} /></label>
            <label>仮説<textarea className="an-memo" value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} /></label>
            <label>主KPI（1つ）
              <select className="an-select is-field" value={metric} onChange={(event) => setMetric(event.target.value as PrimaryMetric)}>
                {(Object.keys(METRIC_LABELS) as PrimaryMetric[]).map((item) => (
                  <option key={item} value={item}>{METRIC_LABELS[item]}</option>
                ))}
              </select>
            </label>
            <label>媒体<input value={platform} onChange={(event) => setPlatform(event.target.value)} /></label>
            <div className="an-row" role="radiogroup" aria-label="本数">
              本数（それぞれ）
              {([2, 3, 5] as const).map((item) => (
                <button key={item} type="button" className="an-radio" role="radio" aria-checked={count === item} onClick={() => setCount(item)}>{item}</button>
              ))}
            </div>
            <p className="an-muted">副KPI：平均再生率・定点の保存は自動で記録します</p>
            {running && (
              <button type="button" className="an-check" aria-pressed={wait} onClick={() => setWait((value) => !value)}>
                今の実験が終わってから始める
              </button>
            )}
            <button type="button" className="an-primary" onClick={() => void create()}>実験を作る</button>
            <p className="an-muted">作ると、次のプロジェクトの定点情報で選べるようになります</p>
          </div>
          <aside className="an-side">
            <strong>そろえる条件</strong>
            <p className="an-muted">この実験の動画は、次の条件を前回のまま作ります。変わると「意図せず変わった項目」として記録します</p>
            {fixed.map(([key, value]) => (
              <div key={key} className="an-row"><span>{VARIABLE_LABELS[key as PrimaryVariable]}</span><b>{value}</b></div>
            ))}
          </aside>
        </div>
      </div>
    </div>
  );
};

const InsightsPanel = () => {
  const { bundle, reload } = useAnalytics();
  const [scope, setScope] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', conclusion: '', basis: 'policy' as Insight['basis'] });
  if (!bundle) return null;
  const insights = bundle.insights.filter((item) => scope === 'all' || item.scope.langs.includes(scope) || item.scope.platforms.includes(scope));
  const selected = insights.find((item) => item.id === selectedId) ?? bundle.insights.find((item) => item.id === selectedId);
  const pending = unlinkedConclusions(bundle);
  const columns: Array<{ status: InsightStatus; title: string; use: string }> = [
    { status: 'adopted', title: '採用', use: '新しいプロジェクトの初期値' },
    { status: 'testing', title: '検証中', use: '次に試す候補' },
    { status: 'rejected', title: '非採用', use: '同じ実験を繰り返さない' },
  ];
  const create = async () => {
    if (!draft.title.trim()) return;
    await window.studio.saveAnalyticsInsight({
      title: draft.title,
      conclusion: draft.conclusion,
      status: 'adopted',
      basis: draft.basis,
      applyAsDefault: true,
      evidenceSummary: draft.basis === 'policy' ? '方針決定' : draft.conclusion,
    });
    setDraft({ title: '', conclusion: '', basis: 'policy' });
    await reload();
  };
  return (
    <div className="an-scroll">
      <div className="an-main-head">
        <div>
          <h1>いまの制作方針</h1>
          <p className="an-muted">実験と振り返りの決定からまとめた知識。状態はいつでも見直せます</p>
        </div>
        <label className="an-muted">対象
          <select className="an-select" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="all">すべての媒体・言語</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="youtube">YouTube</option>
          </select>
        </label>
      </div>
      {pending.length > 0 && (
        <div className="an-warn">
          まだまとめていない結論 {pending.length}件
          <div>{pending.slice(0, 2).map((item) => item.label).join('、')}</div>
          <button type="button" className="an-secondary" onClick={() => setDraft({ title: pending[0]?.label ?? '', conclusion: '', basis: pending[0]?.kind === 'experiment' ? 'experiment' : 'decision' })}>
            1件ずつまとめる
          </button>
        </div>
      )}
      <div className="an-row">
        <input aria-label="Insight のタイトル" placeholder="タイトル" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        <input aria-label="結論" placeholder="結論" value={draft.conclusion} onChange={(event) => setDraft({ ...draft, conclusion: event.target.value })} />
        <button type="button" className="an-primary" onClick={() => void create()}>Insight を作る</button>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div className="an-board" style={{ flex: 1 }}>
        {columns.map((column) => {
          const cards = insights.filter((item) => item.status === column.status);
          return (
            <section key={column.status} className="an-col">
              <h2>{column.title} {cards.length}</h2>
              <span className="an-muted">{column.use}</span>
              {cards.map((insight) => (
                <button key={insight.id} type="button" className={`an-card an-insight is-${insight.status}`} onClick={() => setSelectedId(insight.id)}>
                  <strong>{insight.title}</strong>
                  {insight.applyAsDefault && <span className="an-chip">初期値に反映</span>}
                  {insight.suggestNext && <span className="an-chip">次に試す候補</span>}
                  <span>{insight.conclusion}</span>
                  <span className="an-muted">{insight.evidenceSummary || '根拠未記入'} · 実験 {insight.linkedExperimentIds.length}</span>
                  <span className="an-mono">{insight.updatedAt.slice(0, 10)}</span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
      {selected && (
        <aside className="an-drawer">
          <span className="an-chip">{selected.status === 'adopted' ? '採用' : selected.status === 'testing' ? '検証中' : '非採用'}</span>
          <h2>{selected.title}</h2>
          <p>{selected.conclusion}</p>
          <div className="an-row">
            {columns.map((column) => (
              <button key={column.status} type="button" className="an-radio" role="radio" aria-checked={selected.status === column.status} onClick={() => void window.studio.setAnalyticsInsightStatus(selected.id, column.status).then(reload)}>
                {column.title}
              </button>
            ))}
          </div>
          <p className="an-muted">
            {selected.status === 'adopted' && '新しいプロジェクトの初期値にする'}
            {selected.status === 'testing' && '次の動画で試す候補として出す'}
            {selected.status === 'rejected' && '同じ条件を選んだときに注意を出す'}
          </p>
          <h3>状態の履歴</h3>
          {bundle.events.filter((event) => event.insightId === selected.id).map((event) => (
            <p key={event.id} className="an-mono">{event.at.slice(5, 10)} {event.from ?? '—'} → {event.to}</p>
          ))}
          {pending[0] && (
            <button type="button" className="an-secondary" onClick={() => void window.studio.linkAnalyticsConclusion({
              insightId: selected.id,
              decisionId: pending[0]?.kind === 'decision' ? pending[0].id : undefined,
              experimentId: pending[0]?.kind === 'experiment' ? pending[0].id : undefined,
            }).then(reload)}>
              先頭の未まとめ結論をこの Insight に足す
            </button>
          )}
        </aside>
      )}
      </div>
    </div>
  );
};

export const WeeklyReview = () => {
  const { bundle, reload, openExperimentNew } = useAnalytics();
  const task = bundle?.tasks.find((item) => item.type === 'weekly-review' && item.status !== 'done');
  const [step, setStep] = useState(task?.draft.weeklyStep ?? 5);
  const [choice, setChoice] = useState<PrimaryVariable | null>(null);
  if (!bundle || !task) return <p className="an-muted">今週の週次レビューは完了しています</p>;
  const key = task.weekKey || task.dueAt.slice(0, 10);
  const start = new Date(`${key}T00:00:00`).getTime();
  const posts = bundle.posts.filter((post) => {
    const time = new Date(post.postedAt).getTime();
    return time >= start && time < start + 7 * 86_400_000;
  });
  const views = posts.reduce((total, post) => total + (latestSnapshot(bundle.snapshots, post.id)?.views ?? 0), 0);
  const visits = posts.reduce((total, post) => total + (latestSnapshot(bundle.snapshots, post.id)?.clutchVaultVisits ?? 0), 0);
  const saves = posts.reduce((total, post) => total + (latestSnapshot(bundle.snapshots, post.id)?.lineupSaves ?? 0), 0);
  const topView = [...posts].sort((a, b) => (latestSnapshot(bundle.snapshots, b.id)?.views ?? 0) - (latestSnapshot(bundle.snapshots, a.id)?.views ?? 0))[0];
  const topSave = [...posts].sort((a, b) => (latestSnapshot(bundle.snapshots, b.id)?.lineupSaves ?? 0) - (latestSnapshot(bundle.snapshots, a.id)?.lineupSaves ?? 0))[0];
  const lowCtr = posts.filter((post) => {
    const ctr = appCtr(latestSnapshot(bundle.snapshots, post.id));
    return ctr !== null && ctr < 0.01;
  });
  const candidates: Array<{ variable: PrimaryVariable; title: string; reason: string }> = [];
  if (lowCtr.length >= 1) candidates.push({ variable: 'cta', title: 'CTA の出し方を比べる', reason: `App CTR が低い投稿が今週${lowCtr.length}件。原因は断定しません` });
  if (topSave) candidates.push({ variable: 'map', title: `${topSave.content.map} と別マップを比べる`, reason: '保存が多いマップがあります。需要か作り方かは、まだ分けられません' });
  if (candidates.length < 3) candidates.push({ variable: 'postTime', title: '投稿時刻を1つだけずらす', reason: '時刻の差は候補です。同時にほかの変数は動かしません' });
  const finish = async (skip: boolean) => {
    await window.studio.saveAnalyticsTask({
      ...task,
      status: 'done',
      completedAt: new Date().toISOString(),
      draft: { ...task.draft, weeklyStep: 5, weeklyChoice: skip ? 'skip' : choice ?? undefined },
    });
    await reload();
    if (!skip && choice) openExperimentNew(choice);
  };
  const steps = ['今週の数字', '一番伸びた投稿', 'ClutchVaultに一番効いた投稿', '学びの候補', '来週の1つ'];
  return (
    <div className="an-page">
      <div className="an-work">
        <nav className="an-rail" aria-label="週次レビュー">
          <div className="an-rail-head">
            <strong>週次レビュー</strong>
            <span className="an-mono">{weekRangeLabel(key)}</span>
          </div>
          {steps.map((title, index) => (
            <button key={title} type="button" className="an-step" aria-current={step === index + 1 ? 'step' : undefined} onClick={() => setStep(index + 1)}>
              <span className={`an-num ${step === index + 1 ? 'is-current' : ''} ${index + 1 < step ? 'is-done' : ''}`}>{index + 1 < step ? '✓' : index + 1}</span>
              <span>{title}</span>
            </button>
          ))}
        </nav>
        <section className="an-main">
          <div className="an-main-head">
            <div>
              <span className="an-mono">{step} / 5</span>
              <h1>{steps[step - 1]}</h1>
            </div>
            <AboutButton screen="weekly" />
          </div>
          {step === 1 && (
            <div className="an-tiles">
              <article className="an-card an-tile"><span>投稿</span><b>{posts.length}件</b></article>
              <article className="an-card an-tile"><span>視聴回数</span><b>{formatInt(views)}</b></article>
              <article className="an-card an-tile"><span>ClutchVault 訪問</span><b>{formatInt(visits)}</b></article>
              <article className="an-card an-tile"><span>定点の保存</span><b>{formatInt(saves)}</b></article>
            </div>
          )}
          {step === 2 && <p>{topView ? `${topView.content.title || topView.content.map} · ${formatInt(latestSnapshot(bundle.snapshots, topView.id)?.views)} 視聴` : '数字のある投稿はまだありません'}</p>}
          {step === 3 && <p>{topSave ? `${topSave.content.title || topSave.content.map} · 保存 ${formatInt(latestSnapshot(bundle.snapshots, topSave.id)?.lineupSaves)}` : '保存の数字はまだありません'}</p>}
          {step === 4 && candidates.slice(0, 3).map((item) => (
            <article key={item.variable} className="an-card an-mini"><strong>{item.title}</strong><span className="an-muted">{item.reason}</span><span>動かす：{VARIABLE_LABELS[item.variable]}</span></article>
          ))}
          {step === 5 && (
            <div>
              <p className="an-muted">今週の学びから候補を出しました。新しく始める実験は1つだけです。</p>
              <div className="an-tiles">
                <article className="an-card an-tile"><span>投稿</span><b>{posts.length}件</b></article>
                <article className="an-card an-tile"><span>視聴回数</span><b>{formatInt(views)}</b></article>
                <article className="an-card an-tile"><span>ClutchVault 訪問</span><b>{formatInt(visits)}</b></article>
                <article className="an-card an-tile"><span>定点の保存</span><b>{formatInt(saves)}</b></article>
              </div>
              <div role="radiogroup" aria-label="来週の1つ">
                {candidates.slice(0, 3).map((item) => (
                  <button key={item.variable} type="button" className="an-choice" role="radio" aria-checked={choice === item.variable} onClick={() => setChoice(item.variable)}>
                    {item.title}
                    <small>{item.reason}</small>
                    <small>動かす：{VARIABLE_LABELS[item.variable]}</small>
                  </button>
                ))}
              </div>
              <div className="an-row">
                <button type="button" className="an-primary" disabled={!choice} onClick={() => void finish(false)}>この実験を作る</button>
                <button type="button" className="an-ghost" onClick={() => void finish(true)}>今週は決めない</button>
              </div>
            </div>
          )}
          <div className="an-row">
            {step > 1 && <button type="button" className="an-ghost" onClick={() => setStep((value) => value - 1)}>戻る</button>}
            {step < 5 && <button type="button" className="an-primary" onClick={() => setStep((value) => value + 1)}>次へ</button>}
          </div>
        </section>
      </div>
    </div>
  );
};
