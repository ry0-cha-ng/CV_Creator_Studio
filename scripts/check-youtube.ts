import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnalyticsService } from '../electron/main/services/analytics-service';
import { YoutubeApi } from '../electron/main/services/youtube-api';
import { YoutubeAuth } from '../electron/main/services/youtube-auth';
import { YoutubeStore } from '../electron/main/services/youtube-store';
import { YoutubeSyncService } from '../electron/main/services/youtube-sync-service';
import { youtubeVideoIdFromUrl } from '../shared/post-url';
import { analyticsPostSchema } from '../shared/schema/analytics';
import { createDefaultProject } from '../shared/schema/project';
import type { YoutubeSyncSettings } from '../shared/schema/youtube';
import {
  addDays,
  classifyHttpError,
  normalizeRanges,
  pacificDate,
  parseIsoDuration,
  plannedDailyRanges,
  publishWindow,
  subtractRanges,
  sumAdditive,
  windowComplete,
} from '../shared/youtube-analytics';

const fail = (message: string): never => {
  console.error(`NG: ${message}`);
  process.exit(1);
};
const expect = (condition: unknown, message: string): void => {
  if (!condition) fail(message);
};
const equal = (actual: unknown, expected: unknown, message: string): void => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${message}\n  actual:   ${a}\n  expected: ${b}`);
};

// --- 太平洋時間の日付境界と夏時間 ---
equal(pacificDate('2026-10-22T00:00:00Z'), '2026-10-21', '日本時間 10/22 9:00 の公開は太平洋時間では 10/21');
equal(pacificDate('2026-03-08T07:30:00Z'), '2026-03-07', '夏時間開始前（PST）');
equal(pacificDate('2026-03-08T08:30:00Z'), '2026-03-08', '夏時間開始日の0時台（PST）');
equal(pacificDate('2026-03-09T06:59:00Z'), '2026-03-08', '夏時間開始後（PDT）の23:59');
equal(pacificDate('2026-03-09T07:00:00Z'), '2026-03-09', '夏時間開始後（PDT）の0:00');
equal(pacificDate('2026-11-01T07:30:00Z'), '2026-11-01', '夏時間終了日の0:30（まだPDT）');
equal(pacificDate('2026-11-02T07:30:00Z'), '2026-11-01', '夏時間終了後（PST）の23:30');
equal(addDays('2026-12-30', 3), '2027-01-02', '年またぎの加算');
equal(addDays('2026-03-07', 2), '2026-03-09', '夏時間をまたいでも暦日で加算');
equal(publishWindow('2026-10-22T00:00:00Z', 'publish-calendar-7d'), { start: '2026-10-21', end: '2026-10-27' }, '公開日を含む7日間');
equal(publishWindow('2026-10-20T12:00:00Z', 'publish-calendar-28d'), { start: '2026-10-20', end: '2026-11-16' }, '夏時間をまたぐ28日間');
expect(!windowComplete({ start: '2026-10-15', end: '2026-10-21' }, '2026-10-20'), '終了日が確定日より後なら集計途中');
expect(windowComplete({ start: '2026-10-14', end: '2026-10-20' }, '2026-10-20'), '終了日が確定日なら確定');
expect(!windowComplete({ start: '2026-10-14', end: '2026-10-20' }, undefined), '確定日が不明なら集計途中');

// --- 範囲計算 ---
equal(
  normalizeRanges([
    { start: '2026-10-05', end: '2026-10-09' },
    { start: '2026-10-01', end: '2026-10-04' },
    { start: '2026-10-12', end: '2026-10-13' },
  ]),
  [
    { start: '2026-10-01', end: '2026-10-09' },
    { start: '2026-10-12', end: '2026-10-13' },
  ],
  '隣接する範囲は結合し、離れた範囲は残す',
);
equal(
  subtractRanges({ start: '2026-10-01', end: '2026-10-20' }, [{ start: '2026-10-05', end: '2026-10-09' }]),
  [
    { start: '2026-10-01', end: '2026-10-04' },
    { start: '2026-10-10', end: '2026-10-20' },
  ],
  '取得済みを除いた範囲',
);
equal(
  plannedDailyRanges({
    desired: { start: '2026-07-01', end: '2026-10-21' },
    covered: [{ start: '2026-07-01', end: '2026-10-19' }],
    horizon: '2026-10-19',
    refetchDays: 10,
  }),
  [{ start: '2026-10-10', end: '2026-10-21' }],
  '直近10日は確定済みでも取り直す',
);
equal(
  plannedDailyRanges({
    desired: { start: '2026-01-01', end: '2026-06-30' },
    covered: [],
    horizon: '2026-10-19',
    refetchDays: 10,
  }).length,
  3,
  '長い期間は90日ごとに分割',
);

// --- 変換・集計 ---
equal(parseIsoDuration('PT28S'), 28, '尺 28秒');
equal(parseIsoDuration('PT1M5S'), 65, '尺 1分5秒');
equal(parseIsoDuration('PT1H2M3.5S'), 3723.5, '尺 小数秒');
equal(parseIsoDuration('P0D'), 0, '尺 0');
equal(parseIsoDuration('bad'), undefined, '読めない尺は未設定');
const total = sumAdditive([
  { views: 100, averageViewPercentage: 50, averageViewDuration: 10 },
  { views: 900, averageViewPercentage: 90, averageViewDuration: 20 },
]);
equal(total.views, 1000, '再生回数は合算');
expect(!('averageViewPercentage' in total) && !('averageViewDuration' in total), '平均値は日別から合算・単純平均しない');

for (const url of [
  'https://youtube.com/shorts/AbCdEfGhIjK',
  'https://www.youtube.com/watch?v=AbCdEfGhIjK&si=x',
  'https://youtu.be/AbCdEfGhIjK',
  'https://studio.youtube.com/video/AbCdEfGhIjK/edit',
]) {
  equal(youtubeVideoIdFromUrl(url), 'AbCdEfGhIjK', `URL表記違いでも同じ動画ID: ${url}`);
}
equal(youtubeVideoIdFromUrl('https://youtube.com/@h1gher'), undefined, 'チャンネルURLは動画IDなし');

equal(classifyHttpError(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }).kind, 'quota', 'クォータ');
equal(classifyHttpError(403, { error: { errors: [{ reason: 'forbidden' }] } }).kind, 'permission', '権限');
expect(classifyHttpError(429, {}).retryable, 'レート制限は再試行する');
expect(classifyHttpError(503, {}).retryable, 'サーバーエラーは再試行する');
equal(classifyHttpError(400, { error: { message: 'Unknown identifier' } }).kind, 'unsupported-query', '未対応の組み合わせ');
expect(!classifyHttpError(400, {}).retryable, '未対応の組み合わせは再試行しない');
equal(classifyHttpError(401, {}).kind, 'auth', '認証切れ');

// --- DB移行（旧スキーマ → 新スキーマ） ---
const workspace = mkdtempSync(path.join(tmpdir(), 'cvcs-youtube-'));
const legacyPost = analyticsPostSchema.parse({
  id: 'post-a',
  projectId: 'project-a',
  preset: 'yt-global',
  platform: 'youtube',
  lang: 'en',
  url: 'https://youtube.com/shorts/AAAAAAAAAAA',
  postedAt: '2026-10-01T10:05:00.000Z',
  templateId: 't-std',
  hookPattern: 'question',
  content: { title: 'Ascent B', map: 'Ascent' },
  createdAt: '2026-10-01T10:05:00.000Z',
  updatedAt: '2026-10-01T10:05:00.000Z',
});
{
  const legacy = new DatabaseSync(path.join(workspace, 'studio.db'));
  legacy.exec(`
    CREATE TABLE analytics_posts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, preset TEXT NOT NULL, posted_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE UNIQUE INDEX analytics_posts_key ON analytics_posts(project_id, preset);
  `);
  legacy
    .prepare('INSERT INTO analytics_posts (id, project_id, preset, posted_at, data) VALUES (?, ?, ?, ?, ?)')
    .run(legacyPost.id, 'project-a', 'yt-global', legacyPost.postedAt, JSON.stringify(legacyPost));
  legacy.close();
}
const analytics = new AnalyticsService(() => workspace);
analytics.initialize();
const backups = readdirSync(path.join(workspace, 'backups'));
equal(backups.length, 1, '移行前にバックアップを1つ作る');
const migrated = analytics.bundle().posts.find((post) => post.id === 'post-a');
expect(migrated, '旧Postが移行後も残る');
equal(migrated?.youtubeVideoId, 'AAAAAAAAAAA', '旧PostのURLから動画IDを補う');
analytics.initialize();
equal(readdirSync(path.join(workspace, 'backups')).length, 1, '移行済みなら再実行しない');

// --- 偽のAPIで同期 ---
const HORIZON = '2026-10-20';
const NOW = new Date('2026-10-22T03:00:00Z');
const videos = {
  AAAAAAAAAAA: { publishedAt: '2026-10-01T10:00:00Z', title: 'Ascent B 定点', duration: 'PT28S' },
  BBBBBBBBBBB: { publishedAt: '2026-09-10T10:00:00Z', title: 'Bind A 定点', duration: 'PT31S' },
  CCCCCCCCCCC: { publishedAt: '2026-10-19T02:00:00Z', title: '横動画', duration: 'PT9M30S' },
} as const;
type VideoId = keyof typeof videos;

const calls: string[] = [];
let bump = 0;
let failDailyFor: string | null = 'BBBBBBBBBBB';
let cancelAtDaily: (() => void) | null = null;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch = (async (input: string | URL | Request) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const p = url.searchParams;
  if (url.pathname.endsWith('/channels')) {
    return json({
      items: [{ id: 'UC1', snippet: { title: 'H1gher', customUrl: '@h1gher' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }],
    });
  }
  if (url.pathname.endsWith('/playlistItems')) {
    return p.get('pageToken') === 'p2'
      ? json({ items: [{ contentDetails: { videoId: 'CCCCCCCCCCC' } }] })
      : json({
          items: [{ contentDetails: { videoId: 'AAAAAAAAAAA' } }, { contentDetails: { videoId: 'BBBBBBBBBBB' } }],
          nextPageToken: 'p2',
        });
  }
  if (url.pathname.endsWith('/videos')) {
    return json({
      items: (p.get('id') ?? '').split(',').map((id) => ({
        id,
        snippet: { channelId: 'UC1', title: videos[id as VideoId].title, publishedAt: videos[id as VideoId].publishedAt },
        contentDetails: { duration: videos[id as VideoId].duration },
        statistics: { viewCount: '999', likeCount: '9' },
        status: { privacyStatus: 'public' },
      })),
    });
  }
  const dimensions = p.get('dimensions') ?? '';
  const filters = p.get('filters') ?? '';
  const metrics = (p.get('metrics') ?? '').split(',');
  const start = p.get('startDate') ?? '';
  const end = p.get('endDate') ?? '';
  const videoId = filters.replace('video==', '');
  calls.push(`${dimensions || 'none'}|${filters || 'channel'}|${start}..${end}`);
  if (dimensions === 'day' && !filters) {
    const rows: Array<[string, number]> = [];
    for (let day = start; day <= HORIZON && day <= end; day = addDays(day, 1)) rows.push([day, 10]);
    return json({ columnHeaders: [{ name: 'day' }, { name: 'views' }], rows });
  }
  if (dimensions === 'video,creatorContentType') {
    return json({
      columnHeaders: [{ name: 'video' }, { name: 'creatorContentType' }, { name: 'views' }],
      rows: [
        ['AAAAAAAAAAA', 'SHORTS', 500],
        ['BBBBBBBBBBB', 'SHORTS', 300],
        ['CCCCCCCCCCC', 'VIDEO_ON_DEMAND', 20],
      ],
    });
  }
  if (dimensions === 'day') {
    if (cancelAtDaily) {
      const cancel = cancelAtDaily;
      cancelAtDaily = null;
      cancel();
    }
    if (failDailyFor === videoId) throw new TypeError('fetch failed');
    const publish = pacificDate(videos[videoId as VideoId].publishedAt);
    const rows: Array<Array<string | number>> = [];
    for (let day = start < publish ? publish : start; day <= HORIZON && day <= end; day = addDays(day, 1)) {
      rows.push([day, ...metrics.map((metric) => (metric === 'views' ? 100 + bump : metric === 'averageViewPercentage' ? 105.5 : 1))]);
    }
    return json({ columnHeaders: [{ name: 'day' }, ...metrics.map((name) => ({ name }))], rows });
  }
  if (dimensions === 'elapsedVideoTimeRatio') {
    if (videoId === 'BBBBBBBBBBB') return json({ error: { code: 400, message: 'The query is not supported.' } }, 400);
    return json({
      columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }, { name: 'relativeRetentionPerformance' }],
      rows: Array.from({ length: 100 }, (_, index) => [(index + 1) / 100, index < 5 ? 1.2 : 0.6, 0.5]),
    });
  }
  if (dimensions === 'insightTrafficSourceType') {
    return json({
      columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }, { name: 'engagedViews' }, { name: 'estimatedMinutesWatched' }],
      rows: [
        ['SHORTS', 400, 300, 50],
        ['YT_SEARCH', 20, 18, 4],
      ],
    });
  }
  if (!dimensions) {
    return json({ columnHeaders: metrics.map((name) => ({ name })), rows: [metrics.map((metric) => (metric === 'averageViewPercentage' ? 98.2 : 700))] });
  }
  return json({ error: { message: `unexpected ${url}` } }, 400);
}) as typeof fetch;

const settings: YoutubeSyncSettings = { initialDays: 90, fromPublish: false, refetchDays: 10, syncOnStartup: true };
const store = new YoutubeStore(() => analytics.db());
const api = new YoutubeApi({ token: async () => 'test-token', fetch: fakeFetch, sleep: async () => undefined });
const sync = new YoutubeSyncService({
  store,
  api,
  importVideos: (items) => analytics.upsertImportedVideos(items),
  settings: async () => settings,
  now: () => NOW,
});

const main = async () => {
  // 1回目：Bの日別だけ通信失敗、Bの維持曲線は未対応
  const first = await sync.start('manual');
  equal(first.status, 'partial', '一部失敗は partial');
  equal(first.horizon, HORIZON, 'データの最終日');
  const posts1 = analytics.bundle().posts;
  equal(posts1.length, 3, '既存Post1件＋未紐付け2件（重複なし）');
  const postA = posts1.find((post) => post.youtubeVideoId === 'AAAAAAAAAAA');
  equal(postA?.id, 'post-a', '既存Postと動画IDで照合');
  equal(postA?.postedAt, legacyPost.postedAt, '手入力の投稿日時は上書きしない');
  equal(postA?.apiPublishedAt, '2026-10-01T10:00:00.000Z', 'APIの公開日時は別に保持');
  equal(postA?.contentType, 'SHORTS', '形式はAPIの creatorContentType');
  const postC = posts1.find((post) => post.youtubeVideoId === 'CCCCCCCCCCC');
  equal(postC?.projectId, undefined, 'CVCS外の動画はProject未紐付け');
  equal(postC?.contentType, 'VIDEO_ON_DEMAND', '横動画の形式');
  equal(postC?.content.series, '', '取り込んだ動画を既定シリーズに混ぜない');
  analytics.ensure24hTasks();
  const tasks = analytics.bundle().tasks.filter((task) => task.postId && task.postId !== 'post-a');
  equal(tasks.length, 0, '取り込みだけでは振り返りタスクを作らない');

  const dailyA = store.daily('AAAAAAAAAAA');
  equal(dailyA.length, 20, 'Aの日別は公開日〜最終日の20日分');
  equal(dailyA[0]?.metrics.averageViewPercentage, 105.5, '100%超の平均視聴率を壊さない');
  equal(store.daily('BBBBBBBBBBB').length, 0, 'Bの日別は失敗');
  equal(store.state('daily:BBBBBBBBBBB').lastError?.kind, 'network', '失敗の種類を記録');
  const reportsB = store.reports('BBBBBBBBBBB');
  equal(
    reportsB.filter((report) => report.kind === 'period-basic' && report.status === 'ok').length,
    2,
    'Bの日別が失敗しても期間集計は取得（7日・28日）',
  );
  equal(
    reportsB.filter((report) => report.kind === 'retention').map((report) => report.status),
    ['unsupported', 'unsupported'],
    '維持曲線だけ未対応でも基本指標は残る',
  );
  const reportsA = store.reports('AAAAAAAAAAA');
  equal(
    reportsA.filter((report) => report.windowKind === 'publish-calendar-28d').length,
    0,
    'Aの28日間は集計途中なので取得しない',
  );
  const retentionA = reportsA.find((report) => report.kind === 'retention');
  equal(retentionA?.rows.length, 100, '維持曲線は100点');
  equal(retentionA?.rows[0]?.audienceWatchRatio, 1.2, '1を超える維持指標を保持');
  equal(store.reports('CCCCCCCCCCC').length, 0, '公開後7日に満たない動画は期間集計を取らない');

  // 2回目：失敗が直り、値に訂正が入る
  failDailyFor = null;
  bump = 5;
  calls.length = 0;
  const second = await sync.start('manual');
  equal(second.status, 'done', '2回目は成功');
  equal(store.daily('BBBBBBBBBBB').length > 0, true, 'Bの日別を補完');
  const dailyA2 = store.daily('AAAAAAAAAAA');
  equal(dailyA2.length, 20, '再取得しても行は増えない');
  equal(dailyA2[dailyA2.length - 1]?.metrics.views, 105, '直近は訂正値に置き換え（加算しない）');
  equal(dailyA2[0]?.metrics.views, 100, '確定済みの古い日は取り直さない');
  const dailyCallsA = calls.filter((call) => call.startsWith('day|video==AAAAAAAAAAA'));
  equal(dailyCallsA, ['day|video==AAAAAAAAAAA|2026-10-11..2026-10-21'], 'Aは直近10日だけ再取得');
  equal(
    calls.filter((call) => call.includes('video==AAAAAAAAAAA') && !call.startsWith('day|')).length,
    0,
    '確定済みの7日間集計は取り直さない',
  );

  // 3回目：途中で中止 → 4回目で再開
  cancelAtDaily = () => sync.cancel();
  const third = await sync.start('manual');
  equal(third.status, 'cancelled', '中止');
  const fourth = await sync.start('manual');
  equal(fourth.status, 'done', '中止後に再開できる');
  equal(store.daily('AAAAAAAAAAA').length, 20, '中止・再開でも重複しない');

  // 制作プロジェクトに投稿URLを記録 → 未紐付けPostを取り込む
  const project = createDefaultProject('project-c', '2026-10-19T00:00:00.000Z');
  project.posts = [
    { id: 'log-c', platform: 'youtube', lang: 'ja', url: 'https://youtu.be/CCCCCCCCCCC', postedAt: '2026-10-19T02:05:00.000Z', preset: 'yt-ja' },
  ];
  analytics.syncProject(project);
  const postsC = analytics.bundle().posts.filter((post) => post.youtubeVideoId === 'CCCCCCCCCCC');
  equal(postsC.length, 1, '同じ動画のPostは1件にまとめる');
  equal(postsC[0]?.projectId, 'project-c', '後から制作プロジェクトに紐付く');
  equal(postsC[0]?.id, postC?.id, '取り込み時のIDを引き継ぐ');
  equal(postsC[0]?.contentType, 'VIDEO_ON_DEMAND', 'APIの形式を引き継ぐ');
  equal(store.daily('CCCCCCCCCCC').length > 0, true, '動画IDで保存した日別実績はそのまま使える');

  // 認証：保存とトークン更新・失効
  const authDir = path.join(workspace, 'auth');
  const box = {
    available: () => true,
    encrypt: (plain: string) => Buffer.from(Buffer.from(plain).toString('base64')),
    decrypt: (cipher: Buffer) => Buffer.from(cipher.toString(), 'base64').toString(),
  };
  let tokenResponse: Response = json({ access_token: 'access-1', expires_in: 3600 });
  const auth = new YoutubeAuth({
    directory: authDir,
    box,
    openExternal: async () => undefined,
    fetch: (async () => tokenResponse) as typeof fetch,
  });
  let rejected = false;
  try {
    await auth.setClient('not-a-client-id');
  } catch {
    rejected = true;
  }
  expect(rejected, '形式の違うクライアントIDは保存しない');
  await auth.setClient('123-abc.apps.googleusercontent.com', 'secret');
  const stateBefore = await auth.state();
  expect(stateBefore.hasClientSecret && !stateBefore.connected, 'クライアント保存直後は未接続');
  const secretsFile = path.join(authDir, 'youtube-secrets.bin');
  expect(existsSync(secretsFile), '秘密情報は暗号化ファイルに保存');
  const raw = (await import('node:fs')).readFileSync(secretsFile, 'utf8');
  expect(!raw.includes('secret'), '秘密情報を平文で保存しない');
  // 接続済みの状態を作る
  (await import('node:fs')).writeFileSync(
    secretsFile,
    box.encrypt(JSON.stringify({ clientSecret: 'secret', refreshToken: 'refresh-1' })),
  );
  equal(await auth.accessToken(), 'access-1', 'リフレッシュトークンでアクセストークンを取得');
  tokenResponse = json({ error: 'invalid_grant' }, 400);
  let authKind = '';
  try {
    await auth.accessToken(true);
  } catch (error) {
    authKind = (error as { kind?: string }).kind ?? '';
  }
  equal(authKind, 'auth', '失効は認証エラー');
  equal((await auth.state()).needsReauth, true, '再ログインが必要と表示できる');

  analytics.db().close();
  rmSync(workspace, { recursive: true, force: true });
  console.log('youtube checks ok');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
