import { useEffect, useState } from 'react';
import { MANUAL_METRIC_LABELS, type ManualMetricKey } from '../../shared/schema/manual-metric';
import type { AnalyticsPost } from '../../shared/schema/analytics';
import { snapshotSourceLabel, type PublishedScene, type SceneMeaning } from '../../shared/schema/published';
import type { MetadataChange } from '../../shared/schema/youtube';
import {
  CONTENT_TYPE_LABELS,
  retentionPoints,
  TRAFFIC_LABELS,
  type CompareWindow,
  type RetentionPoint,
  type WindowMetricView,
  type YoutubePostView,
} from '../../shared/youtube-compare';

const SCENE_COLOR: Record<SceneMeaning, string> = {
  hook: '#ff4655',
  stand: '#7aa2ff',
  aim: '#f5c16c',
  throw: '#c084fc',
  card: '#3dd6c6',
  cta: '#ff8a4c',
  success: '#7dce6a',
  loop: '#8b93a0',
  other: '#6d7680',
};

const CHANGE_LABELS: Record<MetadataChange['kind'], string> = {
  'first-observed': '初めて取得した値',
  'detected-on-sync': '同期で変化を検知',
  'changed-in-cvcs': 'CVCS上で変更',
};

const num = (value: number | undefined, digits = 0): string =>
  value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('ja-JP', { maximumFractionDigits: digits });

const metricLine = (view: WindowMetricView | undefined): string => {
  if (!view) return '';
  if (view.status !== 'ok') return `${view.label}は${view.statusLabel}です。${view.start && view.end ? `${view.start} 〜 ${view.end}。` : ''}`;
  const metrics = view.metrics;
  return `${view.label}（${view.start} 〜 ${view.end}）の再生は ${num(metrics?.views)}、平均視聴率は ${num(metrics?.averageViewPercentage, 1)}% です。これは公開日からの暦日集計で、下の7日時点の手入力とは別です。手入力は上書きしません。`;
};

export const ApiWindowHint = ({ postId }: { postId: string }) => {
  const [text, setText] = useState('');
  useEffect(() => {
    let live = true;
    void window.studio
      .getYoutubePostView(postId)
      .then((view) => {
        if (live) setText(metricLine(view.windows['publish-calendar-7d']));
      })
      .catch(() => {
        if (live) setText('');
      });
    return () => {
      live = false;
    };
  }, [postId]);
  if (!text) return null;
  return <p className="an-muted">{text}</p>;
};

const RetentionChart = ({
  points,
  scenes,
  duration,
}: {
  points: RetentionPoint[];
  scenes: PublishedScene[];
  duration: number;
}) => {
  const width = 640;
  const height = 220;
  const pad = { l: 40, r: 12, t: 16, b: 28 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const maxWatch = Math.max(1, ...points.map((point) => point.watch));
  const yMax = maxWatch * 1.08;
  const x = (sec: number) => pad.l + (sec / duration) * plotW;
  const y = (watch: number) => pad.t + (1 - watch / yMax) * plotH;
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.sec).toFixed(1)},${y(point.watch).toFixed(1)}`).join(' ');
  return (
    <svg className="yt-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="視聴維持の曲線">
      {scenes.map((scene) => (
        <g key={scene.id}>
          <rect
            x={x(scene.startSec)}
            y={pad.t}
            width={Math.max(0, x(scene.endSec) - x(scene.startSec))}
            height={plotH}
            fill={SCENE_COLOR[scene.meaning]}
            opacity={scene.meaning === 'cta' ? 0.28 : 0.16}
          />
          {x(scene.endSec) - x(scene.startSec) > 36 && (
            <text x={x(scene.startSec) + 4} y={height - 8} fill="#c9ced4" fontSize="10">
              {scene.label}
            </text>
          )}
        </g>
      ))}
      <line x1={pad.l} x2={width - pad.r} y1={y(1)} y2={y(1)} stroke="#5c6770" strokeDasharray="4 4" />
      <text x={4} y={y(1) + 4} fill="#9aa3ad" fontSize="10">
        100%
      </text>
      {points.length > 0 && <path d={line} fill="none" stroke="#ffffff" strokeWidth="2" />}
      {points.map((point) => (
        <circle key={point.ratio} cx={x(point.sec)} cy={y(point.watch)} r="2.5" fill="#ffffff" />
      ))}
    </svg>
  );
};

export const AlignedRetention = ({
  series,
}: {
  series: Array<{ id: string; title: string; points: RetentionPoint[]; color: string }>;
}) => {
  const all = series.flatMap((item) => item.points);
  if (all.length === 0) return <p className="an-muted">揃えて描ける維持データがありません。</p>;
  const min = Math.min(...all.map((point) => point.sec));
  const max = Math.max(...all.map((point) => point.sec));
  const span = Math.max(0.1, max - min);
  const width = 640;
  const height = 200;
  const pad = { l: 40, r: 12, t: 16, b: 24 };
  const yMax = Math.max(1, ...all.map((point) => point.watch)) * 1.08;
  const x = (sec: number) => pad.l + ((sec - min) / span) * (width - pad.l - pad.r);
  const y = (watch: number) => pad.t + (1 - watch / yMax) * (height - pad.t - pad.b);
  return (
    <svg className="yt-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="完成カードの開始で揃えた維持">
      <line x1={x(0)} x2={x(0)} y1={pad.t} y2={height - pad.b} stroke="#3dd6c6" />
      <text x={x(0) + 4} y={pad.t + 12} fill="#3dd6c6" fontSize="10">
        完成カードの開始
      </text>
      {series.map((item) => (
        <path
          key={item.id}
          d={item.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.sec).toFixed(1)},${y(point.watch).toFixed(1)}`).join(' ')}
          fill="none"
          stroke={item.color}
          strokeWidth="2"
        />
      ))}
    </svg>
  );
};

export const PostDetail = ({
  post,
  view,
  experimentName,
  onBack,
  onSaved,
}: {
  post: AnalyticsPost;
  view: YoutubePostView;
  experimentName?: string;
  onBack: () => void;
  onSaved: (next: YoutubePostView) => void;
}) => {
  const [windowKind, setWindowKind] = useState<CompareWindow>('publish-calendar-7d');
  const [manualMetric, setManualMetric] = useState<ManualMetricKey>('views');
  const [manualValue, setManualValue] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualError, setManualError] = useState('');
  const period = view.windows[windowKind];
  const duration = view.snapshot?.durationSec || view.publishedDurationSec || 0;
  const points = retentionPoints(view.retention[windowKind], duration);
  const traffic = view.traffic[windowKind];
  const trafficRows = (traffic?.status === 'ok' ? traffic.rows : [])
    .map((row) => ({
      key: String(row.insightTrafficSourceType ?? ''),
      views: Number(row.views),
    }))
    .filter((row) => row.key)
    .sort((a, b) => (b.views || 0) - (a.views || 0));
  const maxDaily = Math.max(...view.daily.map((row) => row.metrics.views ?? 0), 1);
  const metrics = period.metrics;
  return (
    <div className="an-scroll">
      <div className="an-row">
        <button type="button" className="an-ghost" onClick={onBack}>
          ← 一覧
        </button>
        <span className="an-muted">{CONTENT_TYPE_LABELS[post.contentType ?? 'UNKNOWN']}</span>
      </div>
      <h1>{post.content.title || post.basename || post.id}</h1>
      <p className="an-muted">
        公開 {view.publishedAt ? new Date(view.publishedAt).toLocaleString('ja-JP') : post.postedAt.slice(0, 10)}
        {view.publishedDurationSec ? ` · ${view.publishedDurationSec.toFixed(0)}秒` : ''}
        {experimentName ? ` · 実験「${experimentName}」` : ''}
      </p>
      <label className="ai-field">
        集計期間
        <select className="an-select" value={windowKind} onChange={(event) => setWindowKind(event.target.value as CompareWindow)}>
          <option value="publish-calendar-7d">公開日を含む7日間</option>
          <option value="publish-calendar-28d">公開日を含む28日間</option>
        </select>
      </label>
      <p className="an-muted">
        {period.label}は、太平洋時間の公開日を1日目にした暦日です。公開後ちょうど168時間ではありません。
        {period.start && period.end ? ` 対象は ${period.start} 〜 ${period.end}。` : ''} 状態は{period.statusLabel}です。
        {view.horizon ? ` データの最終日は ${view.horizon} です。` : ''}
      </p>
      <div className="an-tiles">
        <article className="an-card an-tile"><span>再生</span><b>{num(metrics?.views)}</b></article>
        <article className="an-card an-tile"><span>エンゲージビュー</span><b>{num(metrics?.engagedViews)}</b></article>
        <article className="an-card an-tile"><span>平均視聴時間</span><b>{num(metrics?.averageViewDuration, 1)}</b><span>秒</span></article>
        <article className="an-card an-tile"><span>平均視聴率</span><b>{metrics?.averageViewPercentage === undefined ? '—' : `${num(metrics.averageViewPercentage, 1)}%`}</b></article>
        <article className="an-card an-tile"><span>登録者獲得</span><b>{num(metrics?.subscribersGained)}</b></article>
        <article className="an-card an-tile"><span>共有</span><b>{num(metrics?.shares)}</b></article>
      </div>

      <section className="an-card an-task">
        <strong>日別の再生</strong>
        <p className="an-muted">太平洋時間の日付です。行が返っていない日は、0とは別です。</p>
        {view.daily.length === 0 && <p className="an-muted">日別データはまだありません。</p>}
        {view.daily.map((row) => (
          <div key={row.reportDate} className="an-row">
            <span className="an-mono" style={{ width: 96 }}>{row.reportDate.slice(5)}</span>
            <span className="an-bar" style={{ flex: 1 }}>
              <span style={{ width: `${((row.metrics.views ?? 0) / maxDaily) * 100}%` }} />
            </span>
            <span className="an-mono">{num(row.metrics.views)}</span>
          </div>
        ))}
      </section>

      <section className="an-card an-task">
        <strong>視聴維持</strong>
        <p className="an-muted">
          縦軸は維持指標です。1を超えることがあります。到達人数や離脱人数ではありません。点と点のあいだは表示用の直線です。
        </p>
        {points.length === 0 && <p className="an-muted">この期間の維持曲線はまだありません。</p>}
        {points.length > 0 && duration > 0 && (
          <RetentionChart points={points} scenes={view.snapshot?.scenes ?? []} duration={duration} />
        )}
        {view.durationDiffers && (
          <p className="an-warn">公開動画の尺とシーンの基準尺が違います。曲線の秒はシーン側の尺です。</p>
        )}
      </section>

      <section className="an-card an-task">
        <div className="an-row">
          <strong>投稿版</strong>
          {view.snapshot && <span className="an-chip">{snapshotSourceLabel(view.snapshot.source)}</span>}
        </div>
        {!view.snapshot && <p className="an-muted">投稿版はまだ保存されていません。</p>}
        {view.snapshot?.note && <p className="an-muted">{view.snapshot.note}</p>}
        {view.snapshot && (
          <p className="an-muted">
            {view.snapshot.map || '—'} · {view.snapshot.agent || '—'} · フック「{view.snapshot.hookText || '—'}」 · CTA {view.snapshot.ctaMode || '—'}
            {view.snapshot.ctaText ? `「${view.snapshot.ctaText}」` : ''}
          </p>
        )}
        {view.snapshot?.scenes.map((scene) => (
          <div key={scene.id} className="an-row">
            <span style={{ width: 12, height: 12, background: SCENE_COLOR[scene.meaning], borderRadius: 2 }} />
            <span style={{ width: 120 }}>{scene.label}</span>
            <span className="an-mono">
              {scene.startSec.toFixed(1)}–{scene.endSec.toFixed(1)}秒
            </span>
          </div>
        ))}
      </section>

      <section className="an-card an-task">
        <strong>流入元</strong>
        <p className="an-muted">YouTubeの情報カードは、映像の中の完成カードとは別です。内訳を足して全体の再生にはしません。</p>
        {trafficRows.length === 0 && <p className="an-muted">{traffic ? traffic.status === 'ok' ? '内訳の行はありません。' : 'この期間の流入元はまだありません。' : 'この期間の流入元はまだありません。'}</p>}
        {trafficRows.map((row) => (
          <div key={row.key} className="an-row">
            <span style={{ width: 180 }}>{TRAFFIC_LABELS[row.key] ?? row.key}</span>
            <span className="an-mono">{num(Number.isFinite(row.views) ? row.views : undefined)}</span>
          </div>
        ))}
      </section>

      <section className="an-card an-task">
        <strong>手入力の補完</strong>
        <p className="an-muted">APIの日別・期間集計はそのまま残します。ここに入れた値は手入力として別に保存します。</p>
        {view.manuals.filter((item) => item.windowKind === windowKind).map((item) => (
          <p key={item.id} className="an-muted">
            手入力 · {MANUAL_METRIC_LABELS[item.metric]} {item.value} · {item.enteredAt.slice(0, 16).replace('T', ' ')}
            {item.note ? ` · ${item.note}` : ''}
          </p>
        ))}
        <div className="an-row">
          <select className="an-select" value={manualMetric} onChange={(event) => setManualMetric(event.target.value as ManualMetricKey)} aria-label="補完する指標">
            {(Object.keys(MANUAL_METRIC_LABELS) as ManualMetricKey[]).map((key) => (
              <option key={key} value={key}>{MANUAL_METRIC_LABELS[key]}</option>
            ))}
          </select>
          <input aria-label="補完する値" inputMode="decimal" value={manualValue} placeholder="値" onChange={(event) => setManualValue(event.target.value)} />
          <input aria-label="補完のメモ" value={manualNote} placeholder="メモ" onChange={(event) => setManualNote(event.target.value)} />
          <button
            type="button"
            className="an-secondary"
            onClick={() => {
              const value = Number(manualValue);
              if (!Number.isFinite(value)) {
                setManualError('数値を入れてください');
                return;
              }
              setManualError('');
              void window.studio
                .saveYoutubeManual({
                  postId: post.id,
                  windowKind,
                  periodStart: period.start,
                  periodEnd: period.end,
                  metric: manualMetric,
                  value,
                  note: manualNote,
                })
                .then((next) => {
                  setManualValue('');
                  setManualNote('');
                  onSaved(next);
                })
                .catch((reason: unknown) => setManualError(reason instanceof Error ? reason.message : '保存できませんでした'));
            }}
          >
            手入力を追加
          </button>
        </div>
        {manualError && <p className="ai-error">{manualError}</p>}
      </section>

      {view.changes.length > 0 && (
        <section className="an-card an-task">
          <strong>タイトルなどの変化</strong>
          <p className="an-muted">初めて取得した値は、公開当初から同じだったとは限りません。</p>
          {view.changes.slice(0, 8).map((change) => (
            <p key={change.id} className="an-muted">
              {CHANGE_LABELS[change.kind]} · {change.field} · {change.newValue || '（空）'}
            </p>
          ))}
        </section>
      )}
    </div>
  );
};

export const ALIGN_COLORS = ['#ffffff', '#ff4655', '#3dd6c6', '#f5c16c'];
