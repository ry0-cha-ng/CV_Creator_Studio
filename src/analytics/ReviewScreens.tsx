import { useMemo, useState } from 'react';
import { HOOK_PATTERN_LABELS } from '../../shared/guide';
import {
  ACTION_LABELS,
  HYPOTHESIS_LABELS,
  METRIC_LABELS,
  NOTICE_LABELS,
  OPENING_LABELS,
  STEP_HINTS,
  STEP_TITLES,
  appCtr,
  armAverage,
  comparisonCohort,
  ctaTypeLabel,
  decreasedFields,
  formatInt,
  formatPct,
  formatRatioPct,
  formatSignedPct,
  formatSignedPt,
  isReferenceSample,
  langLabel,
  latestSnapshot,
  percentDelta,
  platformLabel,
  pointDelta,
  readyTasks,
  weekRangeLabel,
} from '../../shared/analytics';
import type { AnalyticsScreenId } from '../../shared/analytics-screens';
import { HypothesisAi, NextActionAi, NoticesAi, SummaryAi } from '../ai/places';
import { screenForStep } from '../../shared/analytics-screens';
import type {
  AgeBucket,
  AnalysisTask,
  AnalyticsBundle,
  AnalyticsPost,
  MetricSnapshot,
  Notice,
  PrimaryMetric,
} from '../../shared/schema/analytics';
import { AboutButton } from './chrome';
import { ApiWindowHint } from './PostDetail';
import { useAnalytics } from './context';

const stamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const elapsed = (iso: string): string => {
  const posted = new Date(iso).getTime();
  if (Number.isNaN(posted)) return '';
  const days = Math.max(0, Math.floor((Date.now() - posted) / 86_400_000));
  return `${days}日経過`;
};

const mediaUrl = (filePath: string): string =>
  `studio-media://root/${filePath
    .split(/[\\/]/)
    .map((part) => encodeURIComponent(part))
    .join('/')}`;

const postOf = (bundle: AnalyticsBundle, task: AnalysisTask): AnalyticsPost | undefined =>
  bundle.posts.find((item) => item.id === task.postId);

export const ReviewHome = () => {
  const { bundle, pausedToday, setPausedToday, openReview, openWeekly } = useAnalytics();
  if (!bundle) return <p className="an-muted">読み込み中…</p>;
  const tasks = readyTasks(bundle);
  const current = tasks[0];
  const post = current ? postOf(bundle, current) : undefined;
  const upcoming = bundle.tasks
    .filter((item) => item.type === '7d-review' && item.status === 'waiting')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const decision = [...bundle.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const week = bundle.tasks.find((item) => item.type === 'weekly-review' && item.status !== 'done');
  const experiment = post?.experimentId
    ? bundle.experiments.find((item) => item.id === post.experimentId)
    : undefined;
  return (
    <div className="an-home">
      <div className="an-home-col">
        <div className="an-kicker">
          <span>次にすること</span>
          <span className="an-spacer" />
          <AboutButton screen="review-home" />
        </div>
        {pausedToday ? (
          <article className="an-card an-task">
            <h1 className="an-title">今日はここまで</h1>
            <p className="an-muted">残り{tasks.length}件は次に開いたときに1件ずつ出ます</p>
            <button type="button" className="an-secondary" onClick={() => setPausedToday(false)}>
              やっぱり続ける
            </button>
          </article>
        ) : post && current ? (
          <article className="an-card an-task">
            <div className="an-task-top">
              {post.content.thumbnailPath ? (
                <img className="an-thumb" alt="サムネイル" src={mediaUrl(post.content.thumbnailPath)} />
              ) : (
                <div className="an-thumb">サムネイル</div>
              )}
              <div>
                <div className="an-chips">
                  <span className="an-chip">{platformLabel(post.platform)}</span>
                  <span className="an-chip">{langLabel(post.lang)}</span>
                  <span className="an-chip is-good">{elapsed(post.postedAt)}</span>
                </div>
                <h1 className="an-title">
                  {post.content.map} / {post.content.agent} / {post.content.site} サイト{post.content.side}
                </h1>
                <p className="an-muted">
                  {post.content.ability} · 投稿 {stamp(post.postedAt)} · フック「{HOOK_PATTERN_LABELS[post.content.hookPattern]}」
                </p>
                {experiment && (
                  <p className="an-muted">
                    実験：{experiment.name}（この投稿は {post.experimentArm === 'control' ? experiment.controlLabel : experiment.variantLabels[0]}）
                  </p>
                )}
                <div className="an-row">
                  <button type="button" className="an-primary" onClick={() => openReview(current.id)}>
                    振り返りを始める →
                  </button>
                  <span className="an-muted">5分ほど · 6ステップ</span>
                </div>
              </div>
            </div>
          </article>
        ) : (
          <article className="an-card an-task">
            <h1 className="an-title">今は振り返るものはありません</h1>
            {decision && <p className="an-muted">直近の決定：{decision.summary}</p>}
          </article>
        )}
        {!pausedToday && tasks.length > 0 && (
          <div className="an-row">
            <span className="an-muted">残り {Math.max(0, tasks.length - 1)}件</span>
            {upcoming[0] && <span className="an-muted">次の準備：{stamp(upcoming[0].dueAt).slice(0, 5)}</span>}
            <span className="an-spacer" />
            <button type="button" className="an-ghost" onClick={() => setPausedToday(true)}>
              今日はここまで
            </button>
          </div>
        )}
        <div className="an-home-rule" />
        <div className="an-split">
          <article className="an-card an-mini">
            <span className="an-side-kicker">直近の決定{decision ? ` · ${stamp(decision.createdAt).slice(0, 5)}` : ''}</span>
            <strong>{decision?.summary || 'まだありません'}</strong>
            {decision?.remainingApplyCount !== undefined && (
              <span className="an-mono">あと {decision.remainingApplyCount}本</span>
            )}
            <span className="an-muted">新しいプロジェクトの定点情報に候補として出ます</span>
          </article>
          <article className="an-card an-mini">
            <span className="an-side-kicker">週次レビュー · 任意</span>
            <strong>{week ? `${weekRangeLabel(week.weekKey || week.dueAt.slice(0, 10))}はまだです` : '今週は完了'}</strong>
            <span className="an-muted">来週試すことを1つ決めます。10分ほど</span>
            {week && (
              <button type="button" className="an-text-btn" onClick={openWeekly}>
                週次レビューを始める
              </button>
            )}
          </article>
        </div>
      </div>
    </div>
  );
};

const summaries = (bundle: AnalyticsBundle, task: AnalysisTask, post: AnalyticsPost | undefined): string[] => {
  const snapshot = post ? latestSnapshot(bundle.snapshots, post.id) : undefined;
  const cohort = post ? comparisonCohort(bundle, post) : undefined;
  const views = percentDelta(snapshot?.views ?? null, cohort?.views ?? null);
  const rate = pointDelta(snapshot?.averagePercentageViewed ?? null, cohort?.averagePercentageViewed ?? null);
  return [
    snapshot ? '7日 · 入力済み' : '7日後の数字を写す',
    views !== null ? `視聴 ${formatSignedPct(views)} · 再生率 ${formatSignedPt(rate)}` : 'シリーズ平均と比べる',
    task.draft.hypothesis ? HYPOTHESIS_LABELS[task.draft.hypothesis] : '実験の主KPIだけ見る',
    task.draft.notices.length ? task.draft.notices.map((item) => NOTICE_LABELS[item]).slice(0, 2).join(' · ') : '選んで、必要ならメモ',
    task.draft.action ? ACTION_LABELS[task.draft.action] : '1つだけ決める',
    '決定を保存する',
  ];
};

export const GuideAnalysis = ({ taskId }: { taskId: string }) => {
  const { bundle, reload, openReview } = useAnalytics();
  const [narrowSide, setNarrowSide] = useState(false);
  const task = bundle?.tasks.find((item) => item.id === taskId);
  const post = bundle && task ? postOf(bundle, task) : undefined;
  if (!bundle || !task || !post) return <p className="an-muted">振り返りが見つかりません</p>;
  const step = task.currentStep;
  const saveTask = async (patch: Partial<AnalysisTask>): Promise<void> => {
    await window.studio.saveAnalyticsTask({ ...task, ...patch, draft: { ...task.draft, ...patch.draft } });
    await reload();
  };
  const go = (next: number) => void saveTask({ currentStep: next, status: 'in-progress', startedAt: task.startedAt ?? new Date().toISOString() });
  const snapshotReady = Boolean(
    latestSnapshot(bundle.snapshots, post.id)?.views !== undefined &&
      (post.platform === 'tiktok'
        ? latestSnapshot(bundle.snapshots, post.id)?.completionRate !== undefined ||
          latestSnapshot(bundle.snapshots, post.id)?.averagePercentageViewed !== undefined
        : latestSnapshot(bundle.snapshots, post.id)?.averagePercentageViewed !== undefined),
  );
  const experiment = post.experimentId ? bundle.experiments.find((item) => item.id === post.experimentId) : undefined;
  const canNext =
    step === 1 ? snapshotReady : step === 3 ? !experiment || Boolean(task.draft.hypothesis) : step === 5 ? Boolean(task.draft.action) : true;
  const lines = summaries(bundle, task, post);
  const screen = screenForStep(step) as AnalyticsScreenId;
  return (
    <div className="an-page">
      <div className="an-work">
        <nav className="an-rail" aria-label="振り返りの手順">
          <div className="an-rail-head">
            <strong>振り返りの手順</strong>
            <span className="an-muted">1件を判断まで終わらせる</span>
          </div>
          {STEP_TITLES.map((title, index) => {
            const number = index + 1;
            const done = number < step || task.status === 'done';
            return (
              <button key={title} type="button" className="an-step" aria-current={number === step ? 'step' : undefined} onClick={() => go(number)}>
                <span className={`an-num ${number === step ? 'is-current' : ''} ${done ? 'is-done' : ''}`}>{done ? '✓' : number}</span>
                <span>
                  {title}
                  <small>{lines[index]}</small>
                </span>
              </button>
            );
          })}
          <div className="an-rail-foot">
            <span className="an-muted">このあと 残り{Math.max(0, readyTasks(bundle).length - 1)}件</span>
            <span className="an-muted">途中でやめても入力は残ります。次に開くとこの手順から再開します</span>
            <button type="button" className="an-ghost" onClick={() => openReview()}>中断してホームへ</button>
          </div>
        </nav>
        <section className="an-main">
          <div className="an-main-head">
            <div>
              <span className="an-step-label">STEP {step} / 6</span>
              <h1>{step === 1 ? '実績入力（7日）' : STEP_TITLES[step - 1]}</h1>
              <p className="an-muted">
                {step === 1 && 'YouTube Studio と ClutchVault の管理画面から、投稿7日後の数字を写します'}
                {step === 2 && `比べる相手：${comparisonCohort(bundle, post).label}`}
                {step === 3 && 'この投稿が入っている実験の、主KPIだけを見ます'}
                {step === 4 && '今回の結果に効いたと思うものを選びます。当てはまるものすべて'}
                {step === 5 && '次の制作で何をするかを1つだけ決めます'}
                {step === 6 && '内容を確かめて保存します。直したいところは左の手順から戻れます'}
              </p>
            </div>
            <div className="an-row">
              {typeof window !== 'undefined' && window.innerWidth < 1280 && (
                <button type="button" className="an-ghost" onClick={() => setNarrowSide((value) => !value)}>この投稿</button>
              )}
              <AboutButton screen={screen} />
            </div>
          </div>
          {step === 1 && <StepMetrics bundle={bundle} post={post} onSaved={reload} />}
          {step === 2 && <StepResult bundle={bundle} post={post} />}
          {step === 3 && <StepHypothesis bundle={bundle} post={post} task={task} onChange={(draft) => saveTask({ draft })} />}
          {step === 4 && <StepNotices bundle={bundle} post={post} task={task} onChange={(draft) => saveTask({ draft })} />}
          {step === 5 && <StepAction bundle={bundle} post={post} task={task} onChange={(draft) => saveTask({ draft })} />}
          {step === 6 && <StepDone bundle={bundle} task={task} post={post} />}
        </section>
        <PostPanel post={post} bundle={bundle} collapsed={narrowSide} />
      </div>
      <footer className="an-footer">
        <div className="an-bars" aria-hidden="true">
          {STEP_TITLES.map((_, index) => (
            <i key={STEP_TITLES[index]} className={index < step ? 'is-on' : ''} />
          ))}
        </div>
        <span className="an-mono an-muted">STEP {step} / 6</span>
        <span className="an-muted">{STEP_HINTS[step - 1]}</span>
        <span className="an-spacer" />
        {step > 1 && (
          <button type="button" className="an-ghost" onClick={() => go(step - 1)}>戻る</button>
        )}
        {step < 6 && (
          <button type="button" className="an-primary" disabled={!canNext} onClick={() => go(step + 1)}>
            次へ：{STEP_TITLES[step]}
          </button>
        )}
      </footer>
    </div>
  );
};

const StepMetrics = ({
  bundle,
  post,
  onSaved,
}: {
  bundle: AnalyticsBundle;
  post: AnalyticsPost;
  onSaved: () => Promise<void>;
}) => {
  const existing = latestSnapshot(bundle.snapshots, post.id);
  const previous = bundle.snapshots
    .filter((item) => item.postId === post.id && item.ageBucket !== '7d')
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  const [values, setValues] = useState<Partial<MetricSnapshot>>(existing ?? {});
  const [capturedAt, setCapturedAt] = useState((existing?.capturedAt ?? new Date(new Date(post.postedAt).getTime() + 7 * 86_400_000).toISOString()).slice(0, 10));
  const [openExtra, setOpenExtra] = useState(false);
  const [extraBucket, setExtraBucket] = useState<AgeBucket>('24h');
  const youtube = post.platform !== 'tiktok';
  const warnings = decreasedFields({ ...values, id: '', postId: post.id, capturedAt, ageBucket: '7d', source: 'manual' }, previous);
  const setNumber = (key: keyof MetricSnapshot, raw: string) => {
    if (!raw.trim()) {
      setValues((current) => ({ ...current, [key]: undefined }));
      return;
    }
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) setValues((current) => ({ ...current, [key]: numeric }));
  };
  const save = async (bucket: AgeBucket) => {
    await window.studio.saveAnalyticsSnapshot({
      postId: post.id,
      ageBucket: bucket,
      capturedAt: new Date(`${capturedAt}T00:00:00`).toISOString(),
      values,
    });
    await onSaved();
  };
  const fields: Array<[keyof MetricSnapshot, string, boolean, string]> = youtube
    ? [
        ['views', '視聴回数', true, '回'],
        ['averagePercentageViewed', '平均再生率', true, '%'],
        ['viewedVsSwipedAway', 'スワイプされずに視聴', false, '%'],
        ['likes', '高評価', false, ''],
        ['shares', '共有', false, ''],
        ['subscribersGained', '登録者の増加', false, '人'],
      ]
    : [
        ['views', '視聴回数', true, '回'],
        ['averageViewDurationSec', '平均視聴時間', false, '秒'],
        ['completionRate', '完全視聴率', true, '%'],
        ['saves', '保存', false, ''],
        ['shares', '共有', false, ''],
        ['followersGained', 'フォロワーの増加', false, '人'],
      ];
  return (
    <div>
      {post.platform === 'youtube' && post.youtubeVideoId && <ApiWindowHint postId={post.id} />}
      <div className="an-row">
        <strong>{platformLabel(post.platform)}</strong>
        <span className="an-muted">取得日</span>
        <input className="an-date" type="date" aria-label="取得日" value={capturedAt} onChange={(event) => setCapturedAt(event.target.value)} />
      </div>
      <div className="an-grid-3">
        {fields.map(([key, label, required, unit]) => (
          <div key={key} className={`an-field ${warnings.some((warning) => warning.includes(label)) ? 'is-warn' : ''}`}>
            <label>
              {label}
              {required && <span className="an-req">必須</span>}
            </label>
            <span className="an-input">
              <input
                inputMode="decimal"
                aria-label={label}
                value={values[key] ?? ''}
                placeholder="—"
                onChange={(event) => setNumber(key, event.target.value)}
                onBlur={() => void save('7d')}
              />
              {unit && <span className="an-muted">{unit}</span>}
            </span>
          </div>
        ))}
      </div>
      <h2>ClutchVault</h2>
      <p className="an-muted">この投稿の UTM で絞った数字 · {post.utmContent}</p>
      <div className="an-grid-4">
        {(
          [
            ['clutchVaultVisits', '訪問'],
            ['lineupSaves', '定点の保存'],
            ['deckAdds', 'Deck追加'],
            ['signups', '登録'],
          ] as Array<[keyof MetricSnapshot, string]>
        ).map(([key, label]) => (
          <div key={key} className="an-field">
            <label>{label}</label>
            <span className="an-input">
              <input inputMode="decimal" aria-label={label} value={values[key] ?? ''} placeholder="—" onChange={(event) => setNumber(key, event.target.value)} onBlur={() => void save('7d')} />
            </span>
          </div>
        ))}
      </div>
      {warnings.map((warning) => (
        <p key={warning} className="an-warn">確認：{warning}。入力ミスでなければそのまま進めます</p>
      ))}
      <button type="button" className="an-ghost" aria-expanded={openExtra} onClick={() => setOpenExtra((value) => !value)}>
        ▸ ほかの時点（24時間・30日・任意）とその他の項目
      </button>
      {openExtra && (
        <div className="an-row">
          <select className="an-select" aria-label="時点" value={extraBucket} onChange={(event) => setExtraBucket(event.target.value as AgeBucket)}>
            <option value="1h">1時間</option>
            <option value="24h">24時間</option>
            <option value="30d">30日</option>
            <option value="custom">任意</option>
          </select>
          <button type="button" className="an-secondary" onClick={() => void save(extraBucket)}>この時点を追加</button>
        </div>
      )}
    </div>
  );
};

const Delta = ({ text, up }: { text: string; up: boolean | null }) => (
  <span className={`an-delta ${up === null ? '' : up ? 'is-up' : 'is-down'}`}>{text}</span>
);

const StepResult = ({ bundle, post }: { bundle: AnalyticsBundle; post: AnalyticsPost }) => {
  const snapshot = latestSnapshot(bundle.snapshots, post.id);
  const cohort = comparisonCohort(bundle, post);
  const views = snapshot?.views ?? null;
  const rate = snapshot?.averagePercentageViewed ?? snapshot?.completionRate ?? null;
  const ctr = appCtr(snapshot);
  const rows = [
    { name: '視聴回数', hint: '7日', current: formatInt(views), delta: formatSignedPct(percentDelta(views, cohort.views)), up: percentDelta(views, cohort.views), base: cohort.views, value: views },
    { name: '平均再生率', hint: post.platform === 'tiktok' && snapshot?.averagePercentageViewed === undefined ? '完全視聴率' : 'APV', current: formatPct(rate), delta: formatSignedPt(pointDelta(rate, cohort.averagePercentageViewed)), up: pointDelta(rate, cohort.averagePercentageViewed), base: cohort.averagePercentageViewed, value: rate },
    { name: 'App CTR', hint: '訪問 ÷ 視聴回数', current: formatRatioPct(ctr), delta: formatSignedPt(pointDelta(ctr === null ? null : ctr * 100, cohort.appCtr === null ? null : cohort.appCtr * 100), 1), up: pointDelta(ctr, cohort.appCtr), base: cohort.appCtr, value: ctr },
  ];
  return (
    <div>
      {rows.map((row) => {
        const max = Math.max(row.value ?? 0, row.base ?? 0, 1);
        return (
          <div key={row.name} className="an-metric-row">
            <div>
              <strong style={{ fontSize: 14, fontFamily: 'inherit' }}>{row.name}</strong>
              <div className="an-muted">{row.hint}</div>
            </div>
            <div>
              <strong>{row.current}</strong>
              <div className="an-muted">今回</div>
              <div className="an-bar"><span style={{ width: `${((row.value ?? 0) / max) * 100}%` }} /></div>
              <div className="an-muted">平均 {row.name === 'App CTR' ? formatRatioPct(row.base) : row.name === '平均再生率' ? formatPct(row.base) : formatInt(row.base)}</div>
              <div className="an-bar is-base"><span style={{ width: `${((row.base ?? 0) / max) * 100}%` }} /></div>
            </div>
            <Delta text={row.delta} up={row.up === null ? null : row.up >= 0} />
          </div>
        );
      })}
      {isReferenceSample(cohort.count) && <p className="an-muted an-ref">n={cohort.count} は参考値です。原因は断定しません。</p>}
      <SummaryAi bundle={bundle} post={post} />
    </div>
  );
};

const StepHypothesis = ({
  bundle,
  post,
  task,
  onChange,
}: {
  bundle: AnalyticsBundle;
  post: AnalyticsPost;
  task: AnalysisTask;
  onChange: (draft: AnalysisTask['draft']) => void;
}) => {
  const experiment = post.experimentId ? bundle.experiments.find((item) => item.id === post.experimentId) : undefined;
  if (!experiment) {
    return <p className="an-muted">実験なし。この手順は飛ばせます。</p>;
  }
  const control = armAverage(bundle, experiment, 'control');
  const variant = armAverage(bundle, experiment, 'variant');
  const metric = experiment.primaryMetric;
  const show = (value: number | null) =>
    metric === 'appCtr' ? formatRatioPct(value) : metric === 'views' || metric === 'lineupSaves' ? formatInt(value) : formatPct(value);
  return (
    <div>
      <article className="an-card an-task">
        <span className="an-muted">仮説</span>
        <strong>{experiment.hypothesis || '仮説は未記入です'}</strong>
        <span className="an-muted">動かす変数：{experiment.primaryVariable} · 主KPI：{METRIC_LABELS[metric]}（7日）</span>
        <div className="an-split">
          <div>
            <span>Control · {experiment.controlLabel}</span>
            <strong className="an-mono">{show(control.average)}</strong>
            <span className="an-muted">{control.count}本の平均</span>
          </div>
          <div>
            <span>Variant · {experiment.variantLabels[0]}（この投稿を含む）</span>
            <strong className="an-mono">{show(variant.average)}</strong>
            <span className="an-muted">{variant.count}本の平均 · 予定は{experiment.plannedCountPerArm}本</span>
          </div>
        </div>
        {(isReferenceSample(control.count) || isReferenceSample(variant.count)) && (
          <p className="an-ref">本数が少ないため、差は参考値です（Control {control.count}本 · Variant {variant.count}本）</p>
        )}
      </article>
      <div className="an-grid-3" role="radiogroup" aria-label="今の判断">
        {(Object.keys(HYPOTHESIS_LABELS) as Array<keyof typeof HYPOTHESIS_LABELS>).map((key) => (
          <button key={key} type="button" className="an-radio" role="radio" aria-checked={task.draft.hypothesis === key} onClick={() => onChange({ ...task.draft, hypothesis: key })}>
            {HYPOTHESIS_LABELS[key]}
          </button>
        ))}
      </div>
      <HypothesisAi bundle={bundle} post={post} task={task} onChange={onChange} />
    </div>
  );
};

const StepNotices = ({
  bundle,
  post,
  task,
  onChange,
}: {
  bundle: AnalyticsBundle;
  post: AnalyticsPost;
  task: AnalysisTask;
  onChange: (draft: AnalysisTask['draft']) => void;
}) => {
  const toggle = (notice: Notice) => {
    const has = task.draft.notices.includes(notice);
    onChange({
      ...task.draft,
      notices: has ? task.draft.notices.filter((item) => item !== notice) : [...task.draft.notices, notice],
    });
  };
  return (
    <div>
      <div className="an-grid-2">
        {(Object.keys(NOTICE_LABELS) as Notice[]).map((notice) => (
          <button key={notice} type="button" className="an-check" aria-pressed={task.draft.notices.includes(notice)} onClick={() => toggle(notice)}>
            {task.draft.notices.includes(notice) ? '✓ ' : ''}{NOTICE_LABELS[notice]}
          </button>
        ))}
      </div>
      <NoticesAi bundle={bundle} post={post} task={task} onChange={onChange} />
      <label className="an-muted">
        メモ（任意）
        <textarea className="an-memo" value={task.draft.memo} onChange={(event) => onChange({ ...task.draft, memo: event.target.value })} />
      </label>
    </div>
  );
};

const StepAction = ({
  bundle,
  post,
  task,
  onChange,
}: {
  bundle: AnalyticsBundle;
  post: AnalyticsPost;
  task: AnalysisTask;
  onChange: (draft: AnalysisTask['draft']) => void;
}) => (
  <div className="an-col">
    {(Object.keys(ACTION_LABELS) as Array<keyof typeof ACTION_LABELS>).map((action) => (
      <button key={action} type="button" className="an-choice" role="radio" aria-checked={task.draft.action === action} onClick={() => onChange({ ...task.draft, action })}>
        {ACTION_LABELS[action]}
        {action === 'continue' && task.draft.action === 'continue' && (
          <span className="an-row" onClick={(event) => event.stopPropagation()}>
            あと
            {([1, 2, 3] as const).map((count) => (
              <button key={count} type="button" className="an-check" aria-pressed={task.draft.continueCount === count} onClick={() => onChange({ ...task.draft, action: 'continue', continueCount: count })}>
                {count}
              </button>
            ))}
            本
            <button type="button" className="an-check" aria-pressed={task.draft.applyToNext} onClick={() => onChange({ ...task.draft, action: 'continue', applyToNext: !task.draft.applyToNext })}>
              次のプロジェクトに候補として出す
            </button>
          </span>
        )}
      </button>
    ))}
    <NextActionAi bundle={bundle} post={post} task={task} onChange={onChange} />
  </div>
);

const StepDone = ({ bundle, task, post }: { bundle: AnalyticsBundle; task: AnalysisTask; post: AnalyticsPost }) => {
  const { reload, openReview } = useAnalytics();
  const [saved, setSaved] = useState(task.status === 'done');
  const [nextBundle, setNextBundle] = useState<AnalyticsBundle | null>(null);
  const experiment = post.experimentId ? bundle.experiments.find((item) => item.id === post.experimentId) : undefined;
  const summary = task.draft.action === 'continue'
    ? `${experiment?.variantLabels[0] || 'この条件'}を、あと${task.draft.continueCount}本で検証`
    : task.draft.action
      ? ACTION_LABELS[task.draft.action]
      : '判断はまだ選ばれていません';
  const save = async () => {
    const next = await window.studio.completeAnalyticsReview(task.id);
    await reload();
    setNextBundle(next);
    setSaved(true);
  };
  const upcoming = (nextBundle ? readyTasks(nextBundle) : readyTasks(bundle)).filter((item) => item.id !== task.id);
  return (
    <div>
      <p className="an-muted">今回の決定</p>
      <h2>{summary}</h2>
      <p className="an-muted">次のプロジェクトの定点情報に「前回の振り返りから」として出ます</p>
      <p>結果：{latestSnapshot(bundle.snapshots, post.id)?.views ?? '—'} 視聴</p>
      <p>仮説：{task.draft.hypothesis ? HYPOTHESIS_LABELS[task.draft.hypothesis] : '実験なし'}</p>
      <p>気づき：{task.draft.notices.map((item) => NOTICE_LABELS[item]).join(' · ') || '—'}</p>
      <p>メモ：{task.draft.memo || '—'}</p>
      {!saved ? (
        <button type="button" className="an-primary" disabled={!task.draft.action} onClick={() => void save()}>決定を保存</button>
      ) : (
        <div className="an-ok">
          ✓ 保存しました／残り {upcoming.length}件
          <div className="an-row">
            <button type="button" className="an-ghost" onClick={() => openReview()}>今日はここまで</button>
            <button type="button" className="an-primary" onClick={() => openReview(upcoming[0]?.id)}>次の1件へ</button>
          </div>
        </div>
      )}
    </div>
  );
};

export const PostPanel = ({
  post,
  bundle,
  collapsed,
}: {
  post: AnalyticsPost;
  bundle: AnalyticsBundle;
  collapsed?: boolean;
}) => {
  const { openProject } = useAnalytics();
  const experiment = post.experimentId ? bundle.experiments.find((item) => item.id === post.experimentId) : undefined;
  const armCount = experiment
    ? bundle.posts.filter((item) => item.experimentId === experiment.id && item.experimentArm === post.experimentArm).length
    : 0;
  const armLabel = post.experimentArm === 'control' ? experiment?.controlLabel : experiment?.variantLabels[0];
  const cta = ctaTypeLabel(post.ctaType, post.content.ctaMotion);
  return (
    <aside className={`an-side ${collapsed ? 'is-collapsed' : ''}`} aria-label="この投稿">
      <span className="an-kicker an-side-kicker">この投稿</span>
      <div className="an-post-head">
        {post.content.thumbnailPath ? (
          <img className="an-thumb" alt="" src={mediaUrl(post.content.thumbnailPath)} />
        ) : (
          <div className="an-thumb">サムネイル</div>
        )}
        <div>
          <div className="an-title" style={{ fontSize: 14, fontWeight: 700 }}>
            {post.content.map} / {post.content.agent} / {post.content.site} サイト{post.content.side}
          </div>
          <div className="an-muted">{platformLabel(post.platform)} · {langLabel(post.lang)}</div>
          <div className="an-muted">{stamp(post.postedAt)} 投稿 · {elapsed(post.postedAt)}</div>
          <button type="button" className="an-text-btn" disabled={!post.url} onClick={() => post.url && window.open(post.url, '_blank', 'noopener')}>動画を開く</button>
          {post.projectId ? (
            <button type="button" className="an-text-btn" onClick={() => post.projectId && openProject(post.projectId)}>プロジェクトを開く</button>
          ) : (
            <span className="an-muted">制作プロジェクト未紐付け</span>
          )}
        </div>
      </div>
      <section>
        <strong>定点</strong>
        <div className="an-chips">
          {[post.content.map, post.content.site, post.content.side, post.content.agent, post.content.ability, post.content.lineupCategory].filter(Boolean).map((item) => (
            <span key={item} className="an-chip">{item}</span>
          ))}
        </div>
      </section>
      <section>
        <strong>作り方</strong>
        <div className="an-kv">
          <span>オープニング</span><span>{post.openingType ? OPENING_LABELS[post.openingType] : '未設定'}</span>
          <span>サムネイル</span><span>{post.thumbnailLayout === 'focus' || post.content.thumbnailLayout === 'focus' ? 'フォーカス' : '従来'}</span>
          <span>フック</span><span>{HOOK_PATTERN_LABELS[post.content.hookPattern]}</span>
          <span>尺</span><span>{post.durationSec ? `${post.durationSec.toFixed(1)}秒` : '未設定'}</span>
          <span>CTA</span><span>{cta}{post.content.ctaCopy ? ` · ${post.content.ctaCopy}` : ''}</span>
          <span>BGM</span><span>{post.withBgm ? 'あり' : 'なし'}</span>
        </div>
      </section>
      {experiment && (
        <article className="an-exp-card">
          <span className="an-step-label">実験 · {{ planned: '予定', running: '実施中', completed: '完了', archived: '保管' }[experiment.status]}</span>
          <strong>{experiment.name}</strong>
          <span>この投稿：{armLabel}（{post.experimentArm === 'control' ? 'Control' : 'Variant'}）</span>
          <span className="an-muted">主KPI：{METRIC_LABELS[experiment.primaryMetric as PrimaryMetric]} · {armCount}本目 / 予定{experiment.plannedCountPerArm}本</span>
        </article>
      )}
      <span className="an-spacer" />
      <span className="an-muted">UTM：utm_content={post.utmContent || '—'}</span>
    </aside>
  );
};

export const useReviewTask = (): AnalysisTask | undefined => {
  const { bundle } = useAnalytics();
  return useMemo(() => (bundle ? readyTasks(bundle)[0] : undefined), [bundle]);
};
