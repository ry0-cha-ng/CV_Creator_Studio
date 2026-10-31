import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CompetitorService } from '../electron/main/services/competitor-service';
import { CompetitorSession } from '../electron/main/services/competitor-session';
import { CompetitorPortError, type CompetitorPort, type PublicChannel, type PublicVideo } from '../electron/main/services/competitor-port';
import { quoteUnsafeIntegers } from '../electron/main/services/youtube-api';
import { runStudioMigrations } from '../electron/main/services/studio-db-migrations';
import {
  basicPolicy,
  canUseDerivedMetrics,
  parseChannelLine,
  publicCount,
  readableEvidence,
  vidiqChannelUrl,
  youtubeHandle,
} from '../shared/competitor';
import { countDelta, durationByFormat, formatRatio, highlightContext, postFrequency, selectObserved7d } from '../shared/competitor-metrics';

const fail = (message: string): never => {
  console.error(`NG: ${message}`);
  process.exit(1);
};

const id = (suffix: string): string => `UC${suffix.padEnd(22, 'a').slice(0, 22)}`;
const OWN = id('own');
const A = id('alpha');
const B = id('beta');
const SENTINEL = '424242424242424242';

const channel = (channelId: string, title = 'Example'): PublicChannel => ({
  channelId,
  title,
  description: 'about',
  handle: '@example',
  uploadsPlaylistId: `UU${channelId.slice(2)}`,
  subscriberCount: '1200',
  hiddenSubscriberCount: true,
  videoCount: '3',
  viewCount: '9000',
  reasons: {},
});

const video = (videoId: string, channelId: string, publishedAt: string, extra: Partial<PublicVideo> = {}): PublicVideo => ({
  videoId,
  channelId,
  title: extra.title ?? `video ${videoId}`,
  description: '',
  publishedAt,
  durationIso: 'PT20S',
  viewCount: SENTINEL,
  likeCount: null,
  commentCount: '0',
  reasons: { likeCount: 'not_returned' },
  ...extra,
  videoId,
  channelId,
});

const openDb = (): { db: DatabaseSync; dir: string } => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cvcs-competitor-'));
  const db = new DatabaseSync(path.join(dir, 'studio.db'));
  db.exec(`CREATE TABLE analytics_posts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    preset TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    data TEXT NOT NULL
  )`);
  db.prepare('INSERT INTO analytics_posts (id, project_id, preset, posted_at, data) VALUES (?, ?, ?, ?, ?)').run(
    'keep-me',
    'project',
    'yt-global',
    '2026-01-01T00:00:00.000Z',
    JSON.stringify({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk' }),
  );
  runStudioMigrations(db, dir);
  return { db, dir };
};

const dump = (db: DatabaseSync): string => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  return tables
    .map((table) => JSON.stringify(db.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`).all()))
    .join('\n');
};

type Harness = {
  service: CompetitorService;
  session: CompetitorSession;
  calls: { lookups: number; pages: number; videos: number };
  setBusy: (value: boolean) => void;
  setConnected: (value: boolean) => void;
  setPages: (pages: Array<{ ids: string[]; next?: string; failToken?: boolean }>) => void;
  setVideos: (impl: (ids: string[]) => PublicVideo[] | Promise<PublicVideo[]>) => void;
};

const harness = (options?: { now?: () => Date }): Harness & { db: DatabaseSync; dir: string } => {
  const { db, dir } = openDb();
  const session = new CompetitorSession(options?.now);
  const calls = { lookups: 0, pages: 0, videos: 0 };
  let busy = false;
  let connected = true;
  let pages: Array<{ ids: string[]; next?: string; failToken?: boolean }> = [{ ids: [] }];
  let videoImpl = (ids: string[]): PublicVideo[] => ids.map((videoId) => video(videoId, A, '2026-10-01T00:00:00.000Z'));
  let staleThrown = false;
  let service: CompetitorService;
  const port: CompetitorPort = {
    connected: async () => connected,
    ownChannelId: () => OWN,
    priorityBusy: () => busy,
    lookup: async (parsed) => {
      calls.lookups += 1;
      service.spend();
      if (parsed.kind === 'id') return parsed.channelId === OWN ? channel(OWN, 'mine') : channel(parsed.channelId, parsed.channelId === A ? 'Alpha' : 'Other');
      if (parsed.kind === 'handle') return channel(parsed.handle.toLowerCase().includes('same') ? A : B, 'Handled');
      if (parsed.kind === 'username') return channel(B, 'User');
      return null;
    },
    uploadsPage: async (_playlist, token) => {
      calls.pages += 1;
      service.spend();
      if (token === 'stale') {
        if (!staleThrown) {
          staleThrown = true;
          throw new CompetitorPortError('unavailable');
        }
        return { ids: pages[1]?.ids ?? [] };
      }
      const page = pages[token ? Number(token) : 0] ?? { ids: [] };
      if (page.failToken) throw new CompetitorPortError('network');
      return { ids: page.ids, nextPageToken: page.next };
    },
    videos: async (ids) => {
      calls.videos += 1;
      service.spend();
      return videoImpl(ids);
    },
    openExternal: async () => undefined,
  };
  service = new CompetitorService({ database: () => db, port, now: options?.now, session });
  return {
    service,
    session,
    calls,
    db,
    dir,
    setBusy: (value) => {
      busy = value;
    },
    setConnected: (value) => {
      connected = value;
    },
    setPages: (next) => {
      pages = next;
    },
    setVideos: (impl) => {
      videoImpl = impl;
    },
  };
};

const register = async (service: CompetitorService, text: string): Promise<void> => {
  const preview = await service.preview({ text });
  if (!preview.ok) fail(preview.message);
  const keys = preview.data.rows.filter((row) => row.canSave).map((row) => row.key);
  const saved = await service.confirm({ previewId: preview.data.previewId, keys });
  if (!saved.ok) fail(saved.message);
  await service.waitUntilIdle();
};

const published = '2026-01-01T00:00:00.000Z';
const hours = (value: number) => new Date(Date.parse(published) + value * 3_600_000).toISOString();

if (parseChannelLine('https://youtu.be/abcdefghijk').kind !== 'invalid') fail('video short link is not a channel');
if (parseChannelLine('https://www.youtube.com/c/Custom').kind !== 'unresolved') fail('custom url must stay unresolved');
if (parseChannelLine(`https://www.youtube.com/channel/${A}`).kind !== 'id') fail('channel url');
if (parseChannelLine('@PhoenixLab').kind !== 'handle') fail('handle');
if (youtubeHandle('@FromApi', '@typed') !== 'FromApi') fail('session handle wins');
if (youtubeHandle(null, 'https://www.youtube.com/@Typed/videos') !== 'Typed') fail('handle from the registered url');
if (youtubeHandle(null, `https://www.youtube.com/channel/${id('alpha')}`) !== null) fail('channel id has no handle');
if (vidiqChannelUrl('@vshred') !== 'https://vidiq.com/youtube-stats/channel/@vshred/') fail('vidiq channel url');
if (vidiqChannelUrl('vshred', 'abcdefghijk') !== 'https://vidiq.com/youtube-stats/channel/@vshred/videos/abcdefghijk/') fail('vidiq video url');
if (vidiqChannelUrl(null) !== null || vidiqChannelUrl('  ') !== null) fail('no handle, no vidiq url');
const huge = publicCount(SENTINEL);
if (huge.value !== SENTINEL) fail('huge count must stay a string');
if (publicCount(undefined).value !== null) fail('missing count is null');
const quoted = JSON.parse(quoteUnsafeIntegers(`{"viewCount": ${SENTINEL}, "n": 3}`)) as { viewCount: string; n: number };
if (quoted.viewCount !== SENTINEL || quoted.n !== 3) fail('only unsafe integers are quoted');

const policy = basicPolicy();
if (policy.persistentCache || canUseDerivedMetrics(policy, 'observed_7d') || !canUseDerivedMetrics(policy, 'current_public')) {
  fail('basic policy blocks derived metrics and persistent cache');
}
if (readableEvidence({ expiresAt: '2026-01-01T00:00:00.000Z', expired: false, present: true }, '2026-02-01T00:00:00.000Z', true).state !== 'expired') {
  fail('expired evidence');
}

const freq = postFrequency({
  publishedAt: ['2026-10-21T15:00:00.000Z', '2026-10-21T14:59:59.000Z'],
  startDate: '2026-10-22',
  endDateExclusive: '2026-10-23',
  timeZone: 'Asia/Tokyo',
  coverageComplete: false,
});
if (freq.count !== 1 || freq.partial !== true || freq.label !== '取得済み分') fail(`frequency boundary ${freq.count}`);

const ratio = formatRatio([
  { format: 'shorts', orientation: 'horizontal' },
  { format: 'shorts', orientation: 'vertical' },
  { format: 'shorts', orientation: 'vertical' },
  { format: 'standard', orientation: 'horizontal' },
  { format: 'unknown', orientation: 'unknown' },
  { format: 'unknown', orientation: 'unknown' },
]);
if (ratio.shortsRatio !== 0.75 || ratio.counts.unknown !== 2 || ratio.orientation.horizontal !== 2) fail('format ratio denominator');
const lengths = durationByFormat([
  { format: 'standard', seconds: 10 },
  { format: 'standard', seconds: 20 },
  { format: 'live', seconds: 100 },
]);
if (!lengths.find((item) => item.format === 'standard')?.reference) fail('n<5 is reference');
if (lengths.find((item) => item.format === 'live')?.n !== 1) fail('live stays separate');

const delta = countDelta(
  { at: '2026-01-01T00:00:00.000Z', value: '10', definitionVersion: 'youtube-public-viewcount-2026-08' },
  { at: '2026-01-02T00:00:00.000Z', value: '7', definitionVersion: 'youtube-public-viewcount-2026-08' },
);
if (delta.value !== '-3' || !delta.negative) fail('negative delta stays negative');
const big = countDelta(
  { at: '2026-01-01T00:00:00.000Z', value: SENTINEL, definitionVersion: 'youtube-public-viewcount-2026-08' },
  { at: '2026-01-01T01:00:00.000Z', value: SENTINEL, definitionVersion: 'youtube-public-viewcount-2026-08' },
);
if (big.value !== '0') fail('bigint delta');

const observation = (atHours: number, expires = '2026-12-01T00:00:00.000Z') => ({
  observedAt: hours(atHours),
  expiresAt: expires,
  definitionVersion: 'youtube-public-viewcount-2026-08',
});
const selected = selectObserved7d(published, [observation(156), observation(180), observation(162), observation(174)], hours(200));
if (selected.state !== 'selected' || selected.observedAt !== hours(162)) fail(`7d pick ${selected.observedAt}`);
if (selectObserved7d(published, [observation(150)], hours(200)).state !== 'unobserved') fail('outside window');
if (selectObserved7d(published, [observation(160)], hours(100)).state !== 'immature') fail('immature before target');
if (selectObserved7d(published, [observation(168, hours(10))], hours(200)).state !== 'expired') fail('expired window');
const highlight = highlightContext({
  orderedIds: ['a', 'b', 'c'],
  selectedId: 'b',
  basis: 'current_total',
  peerMedian: 10,
  peerCount: 12,
  selectedValue: 40,
  threshold: 3,
});
if (highlight.buzzDate !== null || highlight.basisLabel !== '現在の累計が高い動画') fail('no buzz date');

const main = async (): Promise<void> => {
const first = harness();
const kept = first.db.prepare('SELECT id FROM analytics_posts WHERE id = ?').get('keep-me') as { id: string } | undefined;
if (!kept) fail('existing post was dropped');
const tables = first.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
if (!tables.some((table) => table.name === 'competitor_channels')) fail('competitor tables missing');
if (tables.some((table) => table.name.includes('competitor_api'))) fail('api cache table must not exist');

const preview = await first.service.preview({
  text: [
    `https://www.youtube.com/channel/${A}`,
    'https://www.youtube.com/@SameHandle',
    'https://www.youtube.com/c/CustomName',
    'https://www.youtube.com/watch?v=abcdefghijk',
    OWN,
  ].join('\n'),
});
if (!preview.ok) fail(preview.message);
const statuses = Object.fromEntries(preview.data.rows.map((row) => [row.raw, row.status]));
if (statuses[`https://www.youtube.com/channel/${A}`] !== 'ready') fail('id should be ready');
if (statuses['https://www.youtube.com/@SameHandle'] !== 'duplicate') fail('changed handle is the same channel');
if (statuses['https://www.youtube.com/c/CustomName'] !== 'unresolved') fail('custom stays unresolved');
if (statuses['https://www.youtube.com/watch?v=abcdefghijk'] !== 'invalid') fail('video url rejected');
if (statuses[OWN] !== 'own_channel') fail('own channel blocked');
const saved = await first.service.confirm({
  previewId: preview.data.previewId,
  keys: preview.data.rows.map((row) => row.key),
});
if (!saved.ok) fail(saved.message);
await first.service.confirm({ previewId: preview.data.previewId, keys: preview.data.rows.map((row) => row.key) });
await first.service.waitUntilIdle();
const listed = first.service.list();
if (!listed.ok || listed.data.length !== 2) fail(`expected 2 channels, got ${listed.ok ? listed.data.length : listed.message}`);

first.setConnected(false);
const offline = await first.service.preview({ text: '@NotConnected' });
if (!offline.ok || !offline.data.rows[0]?.canSave) fail('offline url can be saved');
await first.service.confirm({ previewId: offline.data.previewId, keys: [offline.data.rows[0]!.key] });
const offlineChannel = first.service.list();
if (!offlineChannel.ok) fail(offlineChannel.message);
const unresolved = offlineChannel.data.find((item) => item.input === '@NotConnected');
if (!unresolved || unresolved.canonicalChannelId) fail('unresolved channel has no canonical id');
const offlineDetail = first.service.detail(unresolved.id);
if (!offlineDetail.ok || offlineDetail.data.videoTotal !== 0 || offlineDetail.data.coverage.state !== 'not_in_session') {
  fail('offline channel detail');
}

const paging = harness();
const ids = Array.from({ length: 60 }, (_item, index) => `v${String(index).padStart(10, '0')}`);
paging.setPages([
  { ids: ids.slice(0, 50), next: '1' },
  { ids: ids.slice(50), next: undefined },
]);
paging.setVideos((batch) => batch.map((videoId) => video(videoId, A, '2026-10-01T00:00:00.000Z', { title: videoId === ids[0] ? 'hook #shorts' : videoId })));
await register(paging.service, `https://www.youtube.com/channel/${A}`);
const pagedId = paging.service.list().ok ? paging.service.list().data[0]!.id : '';
const paged = paging.service.detail(pagedId);
if (!paged.ok) fail(paged.message);
const pagedVideos = paging.service.channelVideos(pagedId);
if (paged.data.videoTotal !== 60 || pagedVideos.length !== 60 || paged.data.coverage.scan !== 'complete') {
  fail(`51+ paging ${paged.data.videoTotal} ${paged.data.coverage.scan}`);
}
if (pagedVideos.some((item) => item.format !== null)) fail('shorts was inferred from duration or hashtag');
const sample = pagedVideos[0];
if (!sample || sample.viewCount !== SENTINEL || sample.likeCount !== null) fail('missing like became zero or view was rounded');
if (dump(paging.db).includes(SENTINEL)) fail('api statistic was written to sqlite');
if (!paging.session.hasSentinel(SENTINEL)) fail('session lost the exact integer');
const restarted = new CompetitorSession();
if (restarted.hasSentinel(SENTINEL)) fail('new process restored api cache');

const capped = harness();
capped.setPages(Array.from({ length: 5 }, (_item, index) => ({ ids: Array.from({ length: 50 }, (_v, n) => `c${index}${String(n).padStart(9, '0')}`), next: index < 4 ? String(index + 1) : undefined })));
await register(capped.service, `https://www.youtube.com/channel/${A}`);
const cappedDetail = capped.service.detail((capped.service.list().ok && capped.service.list().data[0]?.id) || '');
if (!cappedDetail.ok || cappedDetail.data.videoTotal !== 200 || cappedDetail.data.coverage.scan !== 'capped') {
  fail(`cap ${cappedDetail.ok ? `${cappedDetail.data.videoTotal} ${cappedDetail.data.coverage.scan}` : cappedDetail.message}`);
}

const partial = harness();
partial.setPages([{ ids: Array.from({ length: 50 }, (_v, n) => `p${String(n).padStart(10, '0')}`), next: '1' }, { ids: ['p999'], failToken: true }]);
await register(partial.service, `https://www.youtube.com/channel/${A}`);
const partialDetail = partial.service.detail((partial.service.list().ok && partial.service.list().data[0]?.id) || '');
if (!partialDetail.ok || partialDetail.data.videoTotal !== 50) fail('partial sync dropped the saved batch');
const partialStatus = partial.service.syncStatus();
if (!partialStatus.ok || partialStatus.data.run?.status !== 'partial') fail('partial status');

const token = harness();
token.setPages([
  { ids: ['tok00000001'], next: 'stale' },
  { ids: ['tok00000002'] },
]);
await register(token.service, `https://www.youtube.com/channel/${A}`);
const tokenDetail = token.service.detail((token.service.list().ok && token.service.list().data[0]?.id) || '');
if (!tokenDetail.ok || tokenDetail.data.videoTotal !== 2) fail(`token restart duplicated or dropped ${tokenDetail.ok ? tokenDetail.data.videoTotal : tokenDetail.message}`);
const before = token.session.observationCount();
token.session.addObservation({
  entityType: 'video',
  entityId: 'tok00000001',
  channelId: A,
  observedAt: '2026-10-02T00:00:00.000Z',
  runId: 'same-run',
  viewCount: '1',
  likeCount: null,
  commentCount: null,
  subscriberCount: null,
  videoCount: null,
  hiddenSubscriberCount: false,
  reasons: {},
});
token.session.addObservation({
  entityType: 'video',
  entityId: 'tok00000001',
  channelId: A,
  observedAt: '2026-10-02T00:00:00.000Z',
  runId: 'same-run',
  viewCount: '9',
  likeCount: null,
  commentCount: null,
  subscriberCount: null,
  videoCount: null,
  hiddenSubscriberCount: false,
  reasons: {},
});
if (token.session.observationCount() !== before + 1) fail('same run duplicated an observation');

const missing = harness();
missing.setPages([{ ids: ['keep0000001', 'gone0000001'] }]);
missing.setVideos((batch) => batch.filter((item) => item !== 'gone0000001').map((videoId) => video(videoId, A, '2026-10-01T00:00:00.000Z')));
await register(missing.service, `https://www.youtube.com/channel/${A}`);
const missingDetail = missing.service.detail((missing.service.list().ok && missing.service.list().data[0]?.id) || '');
const gone = missingDetail.ok ? missing.service.channelVideos(missingDetail.data.id).find((item) => item.videoId === 'gone0000001') : undefined;
if (!gone || gone.availability !== 'unavailable' || gone.title !== null) fail('missing video was treated as deleted content');

let clock = new Date('2026-01-01T00:00:00.000Z');
const later = harness({ now: () => clock });
later.setPages([{ ids: ['late0000001'] }]);
await register(later.service, `https://www.youtube.com/channel/${A}`);
const afterFirst = later.session.observationCount();
clock = new Date('2026-01-03T00:00:00.000Z');
await later.service.catchUp();
await later.service.waitUntilIdle();
if (later.session.observationCount() !== afterFirst * 2) fail(`offline gap fabricated observations ${later.session.observationCount()}`);

const busy = harness();
busy.setBusy(true);
const busyResult = busy.service.sync({});
if (busyResult.ok) fail('busy sync started');
if (busy.calls.pages !== 0) fail('busy sync called the api');

const quota = harness();
const quotaSaved = quota.service.updateGlobal({ quotaBudget: 50 });
if (!quotaSaved.ok) fail(quotaSaved.message);
for (let spent = 0; spent < 50; spent += 1) quota.service.spend();
const quotaPreview = await quota.service.preview({ text: `https://www.youtube.com/channel/${A}\nhttps://www.youtube.com/channel/${B}` });
if (!quotaPreview.ok) fail(quotaPreview.message);
if (!quotaPreview.data.rows.some((row) => row.status === 'error')) fail('quota did not stop the second lookup');
if (quota.calls.lookups !== 1) fail('quota continued lookups');

const removed = harness();
removed.setPages([{ ids: ['note0000001'] }]);
await register(removed.service, `https://www.youtube.com/channel/${A}`);
const removedId = (removed.service.list().ok && removed.service.list().data[0]?.id) || '';
removed.service.remove({ id: removedId, keepNotes: true });
if (removed.session.hasSentinel(SENTINEL)) fail('deleted channel left api cache');
const afterRemove = removed.service.list();
if (!afterRemove.ok || afterRemove.data.length !== 0) fail('channel was not removed');

for (const item of [first, paging, capped, partial, token, missing, later, busy, quota, removed]) {
  item.db.close();
  rmSync(item.dir, { recursive: true, force: true });
}

console.log('competitor checks ok');
};

void main();
