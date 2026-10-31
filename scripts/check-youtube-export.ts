import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AnalyticsService } from '../electron/main/services/analytics-service';
import { experimentSchemaV7 } from '../shared/schema/analytics';
import { createDefaultProject } from '../shared/schema/project';
import { youtubeExportCsv, youtubeExportDocument, youtubeExportJson } from '../shared/youtube-export';
import type { YoutubeAnalysisRow } from '../shared/youtube-compare';

const fail = (message: string): never => {
  throw new Error(message);
};

const secret = 'super-secret-token-value';
const row: YoutubeAnalysisRow = {
  postId: 'post-1',
  videoId: 'abcdefghijk',
  contentType: 'UNKNOWN',
  snapshotSource: 'estimate',
  windows: {
    'publish-calendar-7d': {
      windowKind: 'publish-calendar-7d',
      label: '公開日を含む7日間',
      start: '2026-10-01',
      end: '2026-10-07',
      complete: true,
      status: 'ok',
      statusLabel: '確定',
      metrics: { views: 120, averageViewPercentage: 80.5 },
    },
    'publish-calendar-28d': {
      windowKind: 'publish-calendar-28d',
      label: '公開日を含む28日間',
      start: '2026-10-01',
      end: '2026-10-28',
      complete: false,
      status: 'in-progress',
      statusLabel: '集計途中',
    },
  },
};
const document = youtubeExportDocument({
  exportedAt: '2026-10-25T00:00:00.000Z',
  horizon: '2026-10-21',
  posts: [{ id: 'post-1', title: 'Bind A', videoId: 'abcdefghijk', contentType: 'UNKNOWN' }],
  rows: [row],
  manuals: [
    {
      id: 'manual-1',
      postId: 'post-1',
      windowKind: 'publish-calendar-7d',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-07',
      metric: 'views',
      value: 99,
      note: 'Studioの表示',
      enteredAt: '2026-10-25T01:00:00.000Z',
    },
  ],
});
const csv = youtubeExportCsv(document);
const json = youtubeExportJson(document);
if (!csv.includes('periodStart') || !csv.includes('youtube-analytics-api') || !csv.includes('in-progress')) fail('CSVに期間・出所・状態が要る');
if (!csv.includes('manual') || !csv.includes('Studioの表示')) fail('手入力を別行で残す');
if (csv.includes(secret) || json.includes(secret) || json.includes('refreshToken') || json.includes('client_secret')) {
  fail('認証情報を出さない');
}
const manualRow = document.rows.find((item) => item.source === 'manual');
const apiRow = document.rows.find((item) => item.source === 'youtube-analytics-api' && item.windowKind === 'publish-calendar-7d');
if (manualRow?.views !== '' || apiRow?.views !== 120) fail('手入力でAPIの再生を置き換えない');

const legacy = experimentSchemaV7.parse({
  id: 'exp-old',
  name: '旧実験',
  primaryVariable: 'hook',
  primaryMetric: 'views',
  status: 'running',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
if (legacy.linkedPostIds.length !== 0 || legacy.comparisonWindow) fail('旧実験の比較窓は空のまま');

const workspace = mkdtempSync(path.join(tmpdir(), 'cvcs-export-'));
const service = new AnalyticsService(() => workspace);
try {
  service.initialize();
  const project = createDefaultProject('project-1', '2026-10-01T00:00:00.000Z');
  project.posts = [
    {
      id: 'log-1',
      platform: 'youtube',
      lang: 'en',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      postedAt: '2026-10-01T12:00:00.000Z',
      preset: 'yt-global',
    },
  ];
  service.syncProject(project);
  const post = service.bundle().posts[0];
  if (!post) fail('投稿がない');
  const database = service.db();
  const before = '{"status":"ok","rows":[{"views":10}]}';
  database.prepare(
    `INSERT INTO youtube_reports (id, video_id, kind, window_kind, period_start, period_end, filters, fetched_at, data)
     VALUES ('report-1', 'abcdefghijk', 'period-basic', 'publish-calendar-7d', '2026-10-01', '2026-10-07', '', '2026-10-02T00:00:00.000Z', ?)`,
  ).run(before);
  const view = service.saveManualMetric({
    postId: post.id,
    windowKind: 'publish-calendar-7d',
    metric: 'views',
    value: 50,
    note: secret,
  });
  const after = database.prepare('SELECT data FROM youtube_reports WHERE id = ?').get('report-1') as { data: string };
  if (after.data !== before) fail('手入力がAPIのレポートを変えた');
  if (view.manuals.length !== 1 || view.manuals[0]?.value !== 50) fail('手入力が残らない');
  const exported = service.youtubeExport('json');
  if (!exported.includes(secret)) fail('手入力のメモは残す');
  if (exported.includes('client_secret') || exported.includes('refreshToken')) fail('書き出しに認証項目がある');
  service.saveExperiment({
    id: 'exp-1',
    name: 'フック',
    primaryVariable: 'hook',
    primaryMetric: 'views',
    status: 'running',
    linkedPostIds: [],
  });
  service.linkPostsToExperiment('exp-1', [post.id, post.id], 'publish-calendar-7d');
  service.linkPostsToExperiment('exp-1', [post.id], 'publish-calendar-28d');
  const experiment = service.bundle().experiments.find((item) => item.id === 'exp-1');
  if (experiment?.linkedPostIds.length !== 1 || experiment.comparisonWindow !== 'publish-calendar-7d') {
    fail('実験への接続は一度だけ。最初の集計窓を残す');
  }
  if (service.bundle().posts[0]?.experimentArm) fail('接続で投稿の役割を変えない');
  console.log('youtube export checks ok');
} finally {
  try {
    service.db().close();
  } catch {
    // 初期化前なら閉じない。
  }
  rmSync(workspace, { recursive: true, force: true });
}
