import type { ManualMetric } from './schema/manual-metric';
import type { PublishedSnapshot } from './schema/published';
import type { DailyMetrics, MetadataChange, YoutubeDailyRow, YoutubeReport } from './schema/youtube';
import { dailyMetricsFromRow, publishWindow, WINDOW_LABELS, windowComplete } from './youtube-analytics';

export type CompareWindow = 'publish-calendar-7d' | 'publish-calendar-28d';

export type YoutubeExperimentLink = {
  postIds: string[];
  windowKind: CompareWindow;
  titles: string[];
};

export type WindowMetricStatus = 'ok' | 'in-progress' | 'no-data' | 'unsupported' | 'failed' | 'missing';

export type WindowMetricView = {
  windowKind: CompareWindow;
  label: string;
  start?: string;
  end?: string;
  complete: boolean;
  status: WindowMetricStatus;
  statusLabel: string;
  metrics?: DailyMetrics;
  errorMessage?: string;
};

const STATUS_LABELS: Record<WindowMetricStatus, string> = {
  ok: '確定',
  'in-progress': '集計途中',
  'no-data': 'データなし',
  unsupported: '取得できない組み合わせ',
  failed: '取得失敗',
  missing: '未取得',
};

const matchingReport = (
  reports: YoutubeReport[],
  kind: YoutubeReport['kind'],
  windowKind: CompareWindow,
  start: string,
  end: string,
): YoutubeReport | undefined =>
  reports.find(
    (report) =>
      report.kind === kind && report.windowKind === windowKind && report.periodStart === start && report.periodEnd === end,
  );

export const describeWindow = (
  publishedAt: string | undefined,
  horizon: string | undefined,
  reports: YoutubeReport[],
  windowKind: CompareWindow,
): WindowMetricView => {
  const label = WINDOW_LABELS[windowKind];
  if (!publishedAt) {
    return { windowKind, label, complete: false, status: 'missing', statusLabel: '公開日がありません' };
  }
  const window = publishWindow(publishedAt, windowKind);
  const complete = windowComplete(window, horizon);
  const base = { windowKind, label, start: window.start, end: window.end, complete };
  if (!complete) return { ...base, status: 'in-progress', statusLabel: STATUS_LABELS['in-progress'] };
  const report = matchingReport(reports, 'period-basic', windowKind, window.start, window.end);
  if (!report) return { ...base, status: 'missing', statusLabel: STATUS_LABELS.missing };
  if (report.status === 'unsupported') {
    return { ...base, status: 'unsupported', statusLabel: STATUS_LABELS.unsupported, errorMessage: report.errorMessage };
  }
  if (report.status === 'failed') {
    return { ...base, status: 'failed', statusLabel: STATUS_LABELS.failed, errorMessage: report.errorMessage };
  }
  if (report.status !== 'ok' || report.rows.length === 0) {
    return { ...base, status: 'no-data', statusLabel: STATUS_LABELS['no-data'] };
  }
  return { ...base, status: 'ok', statusLabel: STATUS_LABELS.ok, metrics: dailyMetricsFromRow(report.rows[0]) };
};

export const reportForWindow = (
  publishedAt: string | undefined,
  reports: YoutubeReport[],
  kind: 'retention' | 'traffic-source',
  windowKind: CompareWindow,
): YoutubeReport | undefined => {
  if (!publishedAt) return undefined;
  const window = publishWindow(publishedAt, windowKind);
  return matchingReport(reports, kind, windowKind, window.start, window.end);
};

export type RetentionPoint = {
  ratio: number;
  sec: number;
  watch: number;
};

/** 割合は残す。秒は尺×割合。点のあいだは補間しない。 */
export const retentionPoints = (
  report: YoutubeReport | undefined,
  durationSec: number,
): RetentionPoint[] => {
  if (!report || report.status !== 'ok' || durationSec <= 0) return [];
  return report.rows
    .flatMap((row) => {
      const ratio = Number(row.elapsedVideoTimeRatio);
      const watch = Number(row.audienceWatchRatio);
      if (!Number.isFinite(ratio) || !Number.isFinite(watch)) return [];
      return [{ ratio, sec: durationSec * ratio, watch }];
    })
    .sort((a, b) => a.ratio - b.ratio);
};

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

export const spread = (values: number[]): { min: number; max: number } | null =>
  values.length === 0 ? null : { min: Math.min(...values), max: Math.max(...values) };

/** 群の分子合計÷分母合計。動画ごとの比率の中央値とは別。 */
export const pooledPerThousand = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 1000 : null;

export const cardSpan = (snapshot: PublishedSnapshot | undefined): { startSec: number; durationSec: number } | undefined => {
  const card = snapshot?.scenes.find((scene) => scene.meaning === 'card');
  if (!card) return undefined;
  return { startSec: card.startSec, durationSec: card.endSec - card.startSec };
};

export const durationMismatch = (snapshotSec: number, publishedSec: number | undefined): boolean =>
  publishedSec !== undefined && Math.abs(snapshotSec - publishedSec) > 1;

export type YoutubeWindowPair = {
  'publish-calendar-7d': WindowMetricView;
  'publish-calendar-28d': WindowMetricView;
};

export type YoutubeAnalysisRow = {
  postId: string;
  videoId?: string;
  contentType?: string;
  cardStartSec?: number;
  snapshotSource?: PublishedSnapshot['source'];
  windows: YoutubeWindowPair;
};

export type YoutubePostView = {
  postId: string;
  horizon?: string;
  publishedAt?: string;
  publishedDurationSec?: number;
  snapshot?: PublishedSnapshot;
  durationDiffers: boolean;
  daily: YoutubeDailyRow[];
  windows: YoutubeWindowPair;
  retention: { 'publish-calendar-7d'?: YoutubeReport; 'publish-calendar-28d'?: YoutubeReport };
  traffic: { 'publish-calendar-7d'?: YoutubeReport; 'publish-calendar-28d'?: YoutubeReport };
  changes: MetadataChange[];
  manuals: ManualMetric[];
};

export const CONTENT_TYPE_LABELS: Record<string, string> = {
  SHORTS: 'ショート',
  VIDEO_ON_DEMAND: '横動画',
  LIVE_STREAM: 'ライブ',
  STORY: 'ストーリー',
  UNKNOWN: '形式不明',
};

export const TRAFFIC_LABELS: Record<string, string> = {
  SHORTS: 'ショートフィード',
  SUBSCRIBER: '登録者',
  YT_SEARCH: 'YouTube検索',
  RELATED_VIDEO: '関連動画',
  EXT_URL: '外部リンク',
  YT_CHANNEL: 'チャンネルページ',
  NOTIFICATION: '通知',
  END_SCREEN: '終了画面',
  ANNOTATION: 'YouTubeの情報カード',
  NO_LINK_OTHER: 'その他',
  ADVERTISING: '広告',
  YT_OTHER_PAGE: 'その他のYouTubeページ',
  PLAYLIST: '再生リスト',
  HASHTAGS: 'ハッシュタグ',
};
