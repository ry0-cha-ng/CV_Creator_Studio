import type { ManualMetric } from './schema/manual-metric';
import type { YoutubeAnalysisRow } from './youtube-compare';
import { WINDOW_LABELS } from './youtube-analytics';

export const YOUTUBE_EXPORT_DEFINITION =
  '公開日を含む7日間は太平洋時間の公開日を1日目、6日後を末日とする。公開後ちょうど168時間ではない。28日間は公開日から27日後まで。手入力はAPIの行を置き換えない。';

const COLUMNS = [
  'postId',
  'videoId',
  'title',
  'contentType',
  'windowKind',
  'windowLabel',
  'periodStart',
  'periodEnd',
  'timezone',
  'horizon',
  'metricStatus',
  'source',
  'views',
  'engagedViews',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
  'shares',
  'snapshotSource',
  'manualMetric',
  'manualValue',
  'manualNote',
  'enteredAt',
] as const;

export type YoutubeExportRow = Record<(typeof COLUMNS)[number], string | number>;

export type YoutubeExportPost = {
  id: string;
  title: string;
  videoId?: string;
  contentType?: string;
};

export type YoutubeExportDocument = {
  exportedAt: string;
  timezone: 'America/Los_Angeles';
  definition: string;
  horizon: string;
  rows: YoutubeExportRow[];
};

const cell = (value: string | number | undefined): string | number => (value === undefined ? '' : value);

export const youtubeExportDocument = (input: {
  exportedAt: string;
  horizon?: string;
  posts: YoutubeExportPost[];
  rows: YoutubeAnalysisRow[];
  manuals: ManualMetric[];
}): YoutubeExportDocument => {
  const byPost = new Map(input.rows.map((row) => [row.postId, row]));
  const rows: YoutubeExportRow[] = [];
  for (const post of input.posts) {
    const analysis = byPost.get(post.id);
    for (const windowKind of ['publish-calendar-7d', 'publish-calendar-28d'] as const) {
      const view = analysis?.windows[windowKind];
      const metrics = view?.metrics;
      rows.push({
        postId: post.id,
        videoId: post.videoId ?? analysis?.videoId ?? '',
        title: post.title,
        contentType: post.contentType ?? analysis?.contentType ?? '',
        windowKind,
        windowLabel: WINDOW_LABELS[windowKind],
        periodStart: view?.start ?? '',
        periodEnd: view?.end ?? '',
        timezone: 'America/Los_Angeles',
        horizon: input.horizon ?? '',
        metricStatus: view?.status ?? 'missing',
        source: 'youtube-analytics-api',
        views: cell(metrics?.views),
        engagedViews: cell(metrics?.engagedViews),
        estimatedMinutesWatched: cell(metrics?.estimatedMinutesWatched),
        averageViewDuration: cell(metrics?.averageViewDuration),
        averageViewPercentage: cell(metrics?.averageViewPercentage),
        subscribersGained: cell(metrics?.subscribersGained),
        subscribersLost: cell(metrics?.subscribersLost),
        likes: cell(metrics?.likes),
        comments: cell(metrics?.comments),
        shares: cell(metrics?.shares),
        snapshotSource: analysis?.snapshotSource ?? '',
        manualMetric: '',
        manualValue: '',
        manualNote: '',
        enteredAt: '',
      });
    }
  }
  for (const manual of input.manuals) {
    const post = input.posts.find((item) => item.id === manual.postId);
    const analysis = byPost.get(manual.postId);
    rows.push({
      postId: manual.postId,
      videoId: post?.videoId ?? analysis?.videoId ?? '',
      title: post?.title ?? '',
      contentType: post?.contentType ?? analysis?.contentType ?? '',
      windowKind: manual.windowKind,
      windowLabel: WINDOW_LABELS[manual.windowKind],
      periodStart: manual.periodStart ?? '',
      periodEnd: manual.periodEnd ?? '',
      timezone: 'America/Los_Angeles',
      horizon: input.horizon ?? '',
      metricStatus: 'value',
      source: 'manual',
      views: '',
      engagedViews: '',
      estimatedMinutesWatched: '',
      averageViewDuration: '',
      averageViewPercentage: '',
      subscribersGained: '',
      subscribersLost: '',
      likes: '',
      comments: '',
      shares: '',
      snapshotSource: analysis?.snapshotSource ?? '',
      manualMetric: manual.metric,
      manualValue: manual.value,
      manualNote: manual.note,
      enteredAt: manual.enteredAt,
    });
  }
  return {
    exportedAt: input.exportedAt,
    timezone: 'America/Los_Angeles',
    definition: YOUTUBE_EXPORT_DEFINITION,
    horizon: input.horizon ?? '',
    rows,
  };
};

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const youtubeExportCsv = (document: YoutubeExportDocument): string => {
  const lines = [COLUMNS.join(',')];
  for (const row of document.rows) {
    lines.push(COLUMNS.map((key) => csvCell(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
};

export const youtubeExportJson = (document: YoutubeExportDocument): string => `${JSON.stringify(document, null, 2)}\n`;
