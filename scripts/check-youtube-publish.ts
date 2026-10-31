import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnalyticsService } from '../electron/main/services/analytics-service';
import { hasPublishScope, hasReadScope, parseGrantedScopes, YOUTUBE_FORCE_SSL_SCOPE, YOUTUBE_READONLY_SCOPE } from '../electron/main/services/youtube-auth';
import { YoutubeApi } from '../electron/main/services/youtube-api';
import { ResumableUploadService } from '../electron/main/services/youtube-resumable-upload';
import { createDefaultProject } from '../shared/schema/project';
import { classifyHttpError } from '../shared/youtube-analytics';
import { createPublishing, currentTask, upsertPublicationVerify } from '../shared/publishing';
import {
  buildInsertResource,
  canApplySchedule,
  checkScheduleTime,
  defaultStudioChecks,
  derivePublicationState,
  fingerprintsMatch,
  healPublishMetadata,
  redactSecrets,
  snippetFromMetadata,
  remoteFingerprint,
  shouldCreateReviewTask,
  tagsCharCount,
  tagsFromHashtags,
  threeWayConflict,
  validatePublishMetadata,
  providedMetadataPatch,
  writableStatusFromRemote,
  youtubePublicUrl,
  zonedLocalToUtc,
} from '../shared/youtube-publish';
import { youtubePublishMetadataSchema, youtubePublishUpdateInputSchema, type YoutubePublishJob } from '../shared/schema/youtube-publish';

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

equal(zonedLocalToUtc('2026-10-30T20:00', 'Asia/Tokyo'), '2026-10-30T11:00:00.000Z', 'YTP-09 JST 20:00 = UTC 11:00');

const relatedOnly = { relatedVideosMode: 'set' as const, relatedVideoRefs: ['https://youtube.com/shorts/abcdefghijk'] };
const relatedParsed = youtubePublishUpdateInputSchema.parse({ jobId: 'job', revision: 1, metadata: relatedOnly });
expect(!('title' in (relatedParsed.metadata ?? {})), '部分更新でタイトルの既定値を埋めない');
expect(relatedParsed.metadata?.relatedVideosMode === 'set', '関連動画モードは送った値のまま');
equal(
  providedMetadataPatch(relatedOnly, { title: '', playlistIds: [], relatedVideosMode: 'unused', relatedVideoRefs: relatedOnly.relatedVideoRefs }),
  { relatedVideosMode: 'unused', relatedVideoRefs: relatedOnly.relatedVideoRefs },
  '入力に無いタイトルや再生リストはマージしない',
);
const past = checkScheduleTime('2026-10-30T11:00:00.000Z', new Date('2026-10-30T11:01:00.000Z'));
expect(!past.ok, '過去日時は予約できない');
const tight = checkScheduleTime('2026-10-30T11:03:00.000Z', new Date('2026-10-30T11:00:00.000Z'));
expect(!tight.ok, '5分未満はアプリ独自の余裕不足');
const okTime = checkScheduleTime('2026-10-30T11:10:00.000Z', new Date('2026-10-30T11:00:00.000Z'));
expect(okTime.ok, '5分以上先なら予約可');

const insert = buildInsertResource(
  youtubePublishMetadataSchema.parse({
    title: 'Hook [map] {br} site',
    description: 'desc',
    tags: ['valorant', 'lineup'],
    categoryId: '20',
  }),
);
equal(insert.status.privacyStatus, 'private', 'YTP-03 初回は private');
expect(!('publishAt' in insert.status), 'YTP-03 初回に publishAt を付けない');
equal((insert.snippet as { title: string }).title, 'Hook map site', '内部記法をタイトルから除く');
const english = snippetFromMetadata(
  youtubePublishMetadataSchema.parse({
    title: 'English title',
    description: 'Lineup',
    tags: ['valorant'],
    defaultLanguage: 'en',
    categoryId: '20',
  }),
);
equal(english.defaultLanguage, 'en', 'タイトルの言語を送る');
equal(english.defaultAudioLanguage, 'en', '動画の言語は英語');
const healed = healPublishMetadata(
  youtubePublishMetadataSchema.parse({ title: '', description: '', tags: [], playlistIds: ['PL1'] }),
  youtubePublishMetadataSchema.parse({
    title: 'From project',
    description: 'Project description',
    tags: ['ascent'],
    defaultLanguage: 'en',
  }),
);
equal(healed.title, 'From project', '空タイトルは投稿文で埋める');
equal(healed.description, 'Project description', '空の説明は投稿文で埋める');
equal(healed.tags, ['ascent'], '空のタグは投稿文で埋める');
equal(healed.defaultLanguage, 'en', '言語が空なら英語プリセットを使う');
equal(healed.playlistIds, ['PL1'], '選んだ再生リストは残す');
const kept = healPublishMetadata(
  youtubePublishMetadataSchema.parse({ title: 'Typed', description: 'Mine', tags: ['keep'], defaultLanguage: 'en' }),
  youtubePublishMetadataSchema.parse({ title: 'From project', description: 'Other', tags: ['other'], defaultLanguage: 'ja' }),
);
equal(kept.title, 'Typed', '入力済みタイトルは上書きしない');
equal(kept.tags, ['other'], 'タグは投稿文のカンマ区切りを正とする');

equal(
  tagsFromHashtags('Phoenix,Sunset,valorant tips,valorant lineups,molly'),
  ['Phoenix', 'Sunset', 'valorant tips', 'valorant lineups', 'molly'],
  '半角スペースを含むタグはカンマ区切りの1件として残す',
);
equal(tagsFromHashtags('"valorant tips",Phoenix'), ['valorant tips', 'Phoenix'], '引用符で囲んだタグは引用符を外す');
equal(tagsFromHashtags('#valorant #Phoenix #Sunset'), ['valorant', 'Phoenix', 'Sunset'], '#だけの列は空白で分ける');
equal(
  snippetFromMetadata(youtubePublishMetadataSchema.parse({ title: 't', tags: ['valorant tips', 'molly'] })).tags,
  ['valorant tips', 'molly'],
  'APIにはスペース込みの1タグとして送る',
);

expect(tagsCharCount(['aaaa', 'bbbb']) === 9, 'タグはカンマ込みで数える');
equal(
  tagsCharCount(['Phoenix', 'Sunset', 'molly', 'valorant lineups', 'valorant tips']),
  55,
  'スペースを含むタグは引用符込みで500文字制限を数える',
);
const longTitle = validatePublishMetadata(youtubePublishMetadataSchema.parse({ title: 'あ'.repeat(101), description: '', tags: [] }));
expect(longTitle.some((issue) => issue.field === 'title'), 'タイトル100文字超はエラー');

const remotePrivate = { privacyStatus: 'private', publishAt: '2026-10-30T11:00:00Z' };
equal(derivePublicationState(remotePrivate, new Date('2026-10-30T10:00:00Z')), 'scheduled', 'private+未来publishAtは予約済み');
equal(derivePublicationState(remotePrivate, new Date('2026-10-30T12:00:00Z')), 'private', '予定を過ぎても public と推測しない');
equal(derivePublicationState({ privacyStatus: 'public' }, new Date()), 'public', 'public は公開済み');

const jobBase = {
  youtubeVideoId: 'AbCdEfGhIjK',
  everPublished: false,
  publicationState: 'private',
  operationState: 'ready_to_publish',
  desiredPublishAt: '2026-10-30T11:10:00.000Z',
  metadata: youtubePublishMetadataSchema.parse({ title: 't', hasPaidProductPlacement: false }),
  studioChecks: defaultStudioChecks(youtubePublishMetadataSchema.parse({ title: 't' })),
} as YoutubePublishJob;
expect(!canApplySchedule(jobBase, new Date('2026-10-30T11:00:00.000Z')).ok, 'YTP-07 必須Studio確認なしでは予約できない');
jobBase.studioChecks = jobBase.studioChecks.map((item) => (item.required ? { ...item, status: 'done' } : item));
expect(canApplySchedule(jobBase, new Date('2026-10-30T11:00:00.000Z')).ok, '確認後は予約可');
jobBase.everPublished = true;
expect(!canApplySchedule(jobBase, new Date('2026-10-30T11:00:00.000Z')).ok, '既公開は再予約しない');

const status = writableStatusFromRemote(
  { videoId: 'x', fingerprint: 'f', fetchedAt: 't', embeddable: true, license: 'youtube', publicStatsViewable: false, privacyStatus: 'private' },
  { privacyStatus: 'private', publishAt: '2026-10-30T11:00:00Z' },
);
equal(status.privacyStatus, 'private', '予約は private を維持');
equal(status.publishAt, '2026-10-30T11:00:00Z', 'publishAt を載せる');
equal(status.embeddable, true, '他の書き込み可能値を保持');
const cancel = writableStatusFromRemote(
  { videoId: 'x', fingerprint: 'f', fetchedAt: 't', embeddable: true, privacyStatus: 'private', publishAt: '2026-10-30T11:00:00Z' },
  { privacyStatus: 'private' },
);
expect(!('publishAt' in cancel), 'YTP-11 解除は publishAt を送らない（省略）');

const baseline = {
  videoId: 'x',
  fingerprint: 'a',
  fetchedAt: 't',
  title: 'old',
  privacyStatus: 'private',
  publishAt: '2026-10-30T11:00:00Z',
};
const remoteChanged = { ...baseline, title: 'studio', fingerprint: remoteFingerprint({ ...baseline, title: 'studio' }) };
const diffs = threeWayConflict(baseline, remoteChanged, { title: 'app' });
expect(diffs.some((diff) => diff.field === 'title' && diff.remote === 'studio'), 'YTP-12 Studioのタイトル変更を検知');

expect(!shouldCreateReviewTask({ publicationState: 'scheduled', url: 'https://youtube.com/watch?v=AbCdEfGhIjK' }), 'YTP-13 予約では7dしない');
expect(!shouldCreateReviewTask({ publicationState: 'private', postedAt: '2026-10-01T00:00:00Z', url: 'https://x' }), 'private の publishedAt 相当では7dしない');
expect(shouldCreateReviewTask({ publicationState: 'public', actualPublishedAt: '2026-10-30T11:00:00Z' }), '公開後のみ7d');
expect(shouldCreateReviewTask({ url: 'https://youtube.com/shorts/AbCdEfGhIjK', postedAt: '2026-10-01T00:00:00Z' }), '手動経路は従来どおり');

equal(classifyHttpError(404, {}).message, 'HTTP 404', 'JSON本文がない404は HTTP 404 と出る');
equal(youtubePublicUrl('AbCdEfGhIjK', 'unknown').includes('watch?v='), true, 'YTP-17 不明なら watch URL');
equal(youtubePublicUrl('AbCdEfGhIjK', 'shorts').includes('/shorts/'), true, 'Shorts確定時だけ shorts URL');

const redacted = redactSecrets('token ya29.secret and https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc');
expect(!redacted.includes('ya29.secret'), 'YTP-18 トークンをログに出さない');
expect(!redacted.includes('upload_id=abc'), 'YTP-18 セッションURLをログに出さない');

expect(hasReadScope([YOUTUBE_READONLY_SCOPE]), 'readonly は読み取り可');
expect(!hasPublishScope([YOUTUBE_READONLY_SCOPE]), 'YTP-02 readonly では投稿不可');
expect(hasPublishScope([YOUTUBE_FORCE_SSL_SCOPE]), 'force-ssl で投稿可');
equal(parseGrantedScopes('a b').join(','), 'a,b', 'granted scopes を保存して分岐する');

expect(
  fingerprintsMatch(
    { path: 'a', size: 10, mtimeMs: 1, sha256: 'aa' },
    { path: 'a', size: 10, mtimeMs: 1, sha256: 'aa' },
  ),
  '同一指紋は再開可',
);
expect(
  !fingerprintsMatch(
    { path: 'a', size: 10, mtimeMs: 1, sha256: 'aa' },
    { path: 'a', size: 10, mtimeMs: 1, sha256: 'bb' },
  ),
  'YTP-04 差し替えファイルは拒否',
);

const now = '2026-10-05T09:00:00.000Z';
const project = createDefaultProject('pub', now);
project.guide.exportPresets = ['yt-global', 'tt-jp'];
project.guide.lastExport = {
  at: now,
  projectUpdatedAt: now,
  presets: ['yt-global', 'tt-jp'],
  contentStamp: 'stamp-1',
  outputDir: 'exports/2026-10-05',
};
project.publishing.title = { ja: '日本語', en: 'English' };
project.publishing.links = { 'yt-global': 'https://clutchvault.app/en/', 'tt-jp': 'https://clutchvault.app/' };
let sequence = 0;
const created = createPublishing(project, now, () => {
  sequence += 1;
  return `id-${sequence}`;
});
if (!created) fail('workflow');
const youtube = created.tasks.find((task) => task.type === 'youtube-publish');
if (!youtube) fail('youtube task');
const advanced = structuredClone(created);
advanced.tasks[0].status = 'done';
advanced.tasks[1].status = 'done';
const withVerify = upsertPublicationVerify(advanced, youtube, '2026-10-30T11:00:00.000Z', now, () => 'verify-1');
const currentBefore = currentTask(withVerify.tasks, new Date('2026-10-06T00:00:00Z'));
expect(currentBefore?.type !== 'youtube-publication-verify', 'YTP-14 予約待ちは次の1件を占有しない');
equal(currentBefore?.type, 'tiktok-publish', '予約待ち中でもTikTokへ進める');

const hash = createHash('sha256').update('x').digest('hex');
expect(hash.length === 64, '指紋はSHA-256');

const main = async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cvcs-ytp-'));
  try {
  const file = path.join(dir, 'clip.mp4');
  writeFileSync(file, Buffer.alloc(256 * 1024, 7));
  let inserts = 0;
  let lastRange = '';
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('session')) {
      const range = new Headers(init?.headers).get('Content-Range') ?? '';
      lastRange = range;
      if (range.endsWith('*/262144')) {
        return new Response(null, { status: 308, headers: { range: 'bytes=0-131071' } });
      }
      if (range.startsWith('bytes 0-')) {
        return new Response(null, { status: 308, headers: { range: 'bytes=0-131071' } });
      }
      return new Response(JSON.stringify({ id: 'AbCdEfGhIjK' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('uploadType=resumable')) {
      inserts += 1;
      return new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } });
    }
    return new Response('{}', { status: 400 });
  }) as typeof fetch;
  const uploader = new ResumableUploadService({ token: async () => 'token', fetch: fakeFetch });
  const offset = await uploader.queryOffset('https://www.googleapis.com/upload/session', 262144);
  equal(offset, 131072, 'YTP-04 サーバーoffsetから再開');
  const done = await uploader.upload({
    sessionUrl: 'https://www.googleapis.com/upload/session',
    filePath: file,
    total: 262144,
    start: 131072,
  });
  equal(done.kind, 'complete', '再開後に完了');
  expect(!lastRange.includes('insert'), '既存セッションへPUT');
  equal(inserts, 0, 'YTP-05 照会だけでは videos.insert を発行しない');

  const lost: string[] = [];
  const unknownFetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    lost.push(url);
    throw new TypeError('network down after last chunk');
  }) as typeof fetch;
  const unknownUploader = new ResumableUploadService({ token: async () => 'token', fetch: unknownFetch });
  const unknown = await unknownUploader.upload({
    sessionUrl: 'https://www.googleapis.com/upload/session',
    filePath: file,
    total: 262144,
    start: 0,
  });
  equal(unknown.kind, 'unknown', 'YTP-05 最終応答喪失は outcome_unknown');
  expect(!lost.some((url) => url.includes('uploadType=resumable')), 'YTP-05 新規insertを自動発行しない');

  writeFileSync(path.join(dir, 'studio.db'), '');
  const analytics = new AnalyticsService(() => dir);
  analytics.initialize();
  const projectA = createDefaultProject('p1', now);
  projectA.posts = [];
  const post = analytics.upsertFromPublishJob({
    project: projectA,
    preset: 'yt-global',
    videoId: 'AbCdEfGhIjK',
    url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK',
    publicationState: 'scheduled',
    scheduledPublishAt: '2026-10-30T11:00:00.000Z',
    uploadedAt: now,
    exportRef: { exportId: 'e1', frozenAt: now, basename: 'clip' },
    content: { title: 'frozen', map: 'Ascent', site: 'A', side: '守り', agent: 'Jett', ability: 'Dash', series: 's', templateId: 't-std', hookPattern: 'custom' },
  });
  equal(analytics.bundle().tasks.filter((task) => task.id === `7d:${post.id}`).length, 0, 'YTP-15 予約時は7dなし');
  analytics.upsertFromPublishJob({
    project: projectA,
    preset: 'yt-global',
    videoId: 'AbCdEfGhIjK',
    url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK',
    publicationState: 'public',
    uploadedAt: now,
    actualPublishedAt: '2026-10-01T00:00:00.000Z',
    publishedAtSource: 'api-public',
    exportRef: { exportId: 'e1', frozenAt: now, basename: 'clip' },
    content: { title: 'should-not-replace', map: 'Bind', site: 'B', side: '攻め', agent: 'Jett', ability: 'Dash', series: 's', templateId: 't-std', hookPattern: 'custom' },
  });
  const posts = analytics.bundle().posts.filter((item) => item.youtubeVideoId === 'AbCdEfGhIjK');
  equal(posts.length, 1, 'YTP-16 同じvideoIdは1件');
  equal(posts[0]?.content.title, 'frozen', '公開版スナップショットを現在の編集で上書きしない');
  equal(analytics.bundle().tasks.filter((task) => task.id === `7d:${post.id}`).length, 1, 'YTP-15 公開後に7dを1件');
  const review = analytics.bundle().tasks.find((task) => task.id === `7d:${post.id}`);
  expect(review?.status === 'ready', '起動時に7日経過済みなら ready');
  analytics.db().close();

  const thumbnailUrls: string[] = [];
  const thumbnailApi = new YoutubeApi({
    token: async () => 'token',
    fetch: (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      thumbnailUrls.push(url);
      return new Response(JSON.stringify({ kind: 'youtube#thumbnailSetResponse' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
    sleep: async () => undefined,
  });
  await thumbnailApi.setThumbnail('AbCdEfGhIjK', Buffer.from('jpeg'), 'image/jpeg');
  const thumbnailUrl = thumbnailUrls[0] ?? '';
  expect(thumbnailUrl.includes('/upload/youtube/v3/thumbnails/set'), '通常動画サムネイルは thumbnails.set を使う');
  expect(thumbnailUrl.includes('videoId=AbCdEfGhIjK'), 'thumbnails.set に videoId を付ける');
  expect(thumbnailUrl.includes('uploadType=media'), 'media アップロードで送る');
  expect(!/\/thumbnails\?/.test(thumbnailUrl), '存在しない /thumbnails には送らない');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('youtube publish checks ok');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
