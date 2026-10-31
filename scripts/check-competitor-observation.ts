import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CompetitorObservationService } from '../electron/main/services/competitor-observation-service';
import type { CompetitorPort } from '../electron/main/services/competitor-port';
import { CompetitorService } from '../electron/main/services/competitor-service';
import { CompetitorSession } from '../electron/main/services/competitor-session';
import { runStudioMigrations } from '../electron/main/services/studio-db-migrations';
import {
  buildFeatureIdeaInput,
  computeCommons,
  DEFAULT_FEATURE_TAGS,
  isProfileStale,
  parseFeatureIdeas,
  SELF_SUBJECT,
} from '../shared/competitor-observation';

const fail = (message: string): never => {
  console.error(`NG: ${message}`);
  process.exit(1);
};

const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cvcs-observation-'));
  dirs.push(dir);
  return dir;
};

/** 移行の前提になる分析テーブル（本番では analytics-service が作る）。 */
const openDb = (dir: string): DatabaseSync => {
  const db = new DatabaseSync(path.join(dir, 'studio.db'));
  db.exec(`CREATE TABLE analytics_posts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    preset TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    data TEXT NOT NULL
  )`);
  return db;
};

// 純粋関数
const commons = computeCommons(
  [
    { subject: 'self', theme: 'rhythm', labels: ['夜'] },
    { subject: 'a', theme: 'rhythm', labels: ['夜', '週末中心'] },
    { subject: 'b', theme: 'rhythm', labels: ['昼'] },
    { subject: 'a', theme: 'format', labels: ['Shorts 中心'] },
    { subject: 'b', theme: 'format', labels: ['Shorts 中心'] },
    { subject: 'c', theme: 'format', labels: ['通常中心'] },
    { subject: 'd', theme: 'format', labels: ['通常中心'] },
    { subject: 'x', theme: 'rhythm', labels: ['夜'] },
  ],
  ['self', 'a', 'b', 'c', 'd'],
);
const night = commons.find((item) => item.label === '夜');
if (!night || night.count !== 2 || night.total !== 3 || night.subjects.join() !== 'self,a') fail('majority within filled subjects');
if (commons.some((item) => item.label === 'Shorts 中心' || item.label === '通常中心')) fail('2 of 4 is not a majority');
if (commons.some((item) => item.label === '週末中心')) fail('a single subject is not common');
if (isProfileStale('2026-01-01T00:00:00.000Z', '2026-02-15T00:00:00.000Z')) fail('45 days is not stale');
if (!isProfileStale('2026-01-01T00:00:00.000Z', '2026-03-05T00:00:00.000Z')) fail('63 days is stale');
if (isProfileStale(null, '2026-03-05T00:00:00.000Z')) fail('unconfirmed is not stale');

const ideas = parseFeatureIdeas(
  '前置き {"ideas":[{"name":"結論を先に","group":"構成","fact":"V1とV2","hypothesis":"続きが気になる","counter":"V3は違う","refs":["V1","v2","V9","x"]},{"name":""}]} 後書き',
  3,
);
if (!ideas || ideas.length !== 1 || ideas[0].refs.join() !== '0,1') fail('feature ideas parse and clamp refs');
if (parseFeatureIdeas('not json', 3) !== null) fail('unreadable output is null');
const built = buildFeatureIdeaInput({
  videos: [{ ref: 'abc', focus: true, focusReason: 'x'.repeat(500), format: 'shorts', tags: ['t'], jots: ['j'] }],
  existingTags: [],
});
if (built.videos[0].ref !== 'V1' || built.videos[0].focusReason.length !== 200) fail('feature idea input is clipped and renamed');

// 移行：旧観察メモがある状態から
const upgradeDir = temp();
const upgrade = openDb(upgradeDir);
runStudioMigrations(upgrade, upgradeDir, undefined, '2026-11-competitor-renewal');
upgrade
  .prepare(
    `INSERT INTO competitor_channels (id, user_input, input_key, tier, learn, audience, created_at, updated_at)
     VALUES ('old', '@old', 'handle:old', 'primary', 'まなぶ', '視聴者', '2026-01-01', '2026-01-01')`,
  )
  .run();
upgrade
  .prepare(
    `INSERT INTO competitor_notes (id, channel_id, question, client_request_id, created_at, updated_at)
     VALUES ('n1', 'old', '問い', 'r1', '2026-01-01', '2026-01-01')`,
  )
  .run();
const migrated = runStudioMigrations(upgrade, upgradeDir);
if (!migrated.applied.includes('2026-11-competitor-renewal')) fail('renewal migration applied');
if (!migrated.backupPath || !existsSync(migrated.backupPath)) fail('backup before dropping notes');
const tables = (upgrade.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name);
if (tables.includes('competitor_notes') || tables.includes('competitor_evidence')) fail('old note tables dropped');
for (const name of ['competitor_jots', 'competitor_profile_entries', 'competitor_profile_options', 'competitor_feature_tags']) {
  if (!tables.includes(name)) fail(`${name} created`);
}
const columns = (upgrade.prepare('PRAGMA table_info(competitor_channels)').all() as Array<{ name: string }>).map((row) => row.name);
if (columns.includes('learn') || columns.includes('audience')) fail('unused channel columns dropped');
const kept = upgrade.prepare("SELECT reason FROM competitor_channels WHERE id = 'old'").get();
if (!kept) fail('channel kept through migration');
upgrade.close();

const main = async (): Promise<void> => {
// サービス
const dir = temp();
const db = openDb(dir);
runStudioMigrations(db, dir);
let clock = new Date('2026-10-01T00:00:00.000Z');
const now = () => clock;
const session = new CompetitorSession(now);
const port: CompetitorPort = {
  connected: async () => false,
  ownChannelId: () => undefined,
  priorityBusy: () => false,
  lookup: async () => null,
  uploadsPage: async () => ({ ids: [] }),
  videos: async () => [],
  openExternal: async () => undefined,
};
let competitors: CompetitorService;
const observation = new CompetitorObservationService({ database: () => db, competitors: () => competitors, now });
competitors = new CompetitorService({ database: () => db, port, now, session, hooks: observation.hooks });

const register = async (text: string): Promise<string> => {
  const preview = await competitors.preview({ text });
  if (!preview.ok) return fail(preview.message);
  const saved = await competitors.confirm({ previewId: preview.data.previewId, keys: preview.data.rows.map((row) => row.key) });
  if (!saved.ok || !saved.data.channels[0]) return fail('register');
  return saved.data.channels[0].id;
};
const alpha = await register('@AlphaChannel');
const beta = await register('@BetaChannel');

const tags = observation.tags();
if (!tags.ok || tags.data.length !== DEFAULT_FEATURE_TAGS.length) fail('default feature tags seeded');
const options = observation.profileOptions();
if (!options.ok || !options.data.rhythm.includes('夜')) fail('default profile options seeded');

// 気づき
const request = '6d9f5a30-6a0e-4f3e-9c1a-0d0c2a6e1b11';
const jot = observation.saveJot({ clientRequestId: request, channelId: alpha, videoId: 'vid00000001', body: '冒頭で結果', atSeconds: 42 });
if (!jot.ok) fail(jot.message);
observation.saveJot({ clientRequestId: request, channelId: alpha, videoId: 'vid00000001', body: '冒頭で結果を見せる', atSeconds: 42 });
const loose = observation.saveJot({ clientRequestId: '7d9f5a30-6a0e-4f3e-9c1a-0d0c2a6e1b11', channelId: null, videoId: null, body: 'ふと思った' });
if (!loose.ok) fail('jot without channel');
if (observation.saveJot({ clientRequestId: '8d9f5a30-6a0e-4f3e-9c1a-0d0c2a6e1b11', channelId: 'missing', body: 'x' }).ok) fail('unknown channel');
if (observation.saveJot({ clientRequestId: '9d9f5a30-6a0e-4f3e-9c1a-0d0c2a6e1b11', channelId: null, body: '   ' }).ok) fail('empty body');
const open = observation.jots({ status: 'open' });
if (!open.ok || open.data.total !== 2) fail('double save duplicated the jot');
const saved = open.data.items.find((item) => item.id === jot.data.id);
if (!saved || saved.body !== '冒頭で結果を見せる' || saved.channelLabel !== '@AlphaChannel') fail('jot updated in place with channel label');
const handed = observation.handOff({ ids: [loose.data.id] });
if (!handed.ok || handed.data.count !== 1) fail('hand off');
const summary = observation.summary();
if (!summary.ok || summary.data.openJots !== 1 || summary.data.profileSubjects !== 3) fail('summary counts');
const refs = observation.referenceState([jot.data.id, 'old-note']);
if (!refs.ok || refs.data[0]?.state !== 'ok' || refs.data[1]?.state !== 'deleted') fail('reference state');

// 観察プロフィール
for (const [subject, labels] of [
  [SELF_SUBJECT, ['夜']],
  [alpha, ['夜', '週末中心']],
  [beta, ['昼', '自分で作ったラベル']],
] as const) {
  const result = observation.saveProfile({ subject, theme: 'rhythm', labels: [...labels], note: '自分の言葉' });
  if (!result.ok) fail(result.message);
}
if (observation.saveProfile({ subject: 'missing', theme: 'rhythm', labels: [] }).ok) fail('unknown subject');
const matrix = observation.profileMatrix({ subjects: [] });
if (!matrix.ok || matrix.data.filled !== 3 || matrix.data.commons[0]?.label !== '夜') fail('matrix and commons');
const alphaSubject = matrix.data.subjects.find((subject) => subject.id === alpha);
if (alphaSubject?.vidiqUrl !== 'https://vidiq.com/youtube-stats/channel/@AlphaChannel/') fail('subject vidiq url from the handle');
if (matrix.data.subjects.find((subject) => subject.self)?.vidiqUrl !== null) fail('self has no vidiq url');
const grown = observation.profileOptions();
if (!grown.ok || !grown.data.rhythm.includes('自分で作ったラベル')) fail('new label becomes an option');
clock = new Date('2026-12-15T00:00:00.000Z');
const later = observation.profileMatrix({ subjects: [alpha] });
if (!later.ok || later.data.subjects.length !== 1 || !later.data.entries[0]?.stale) fail('stale after 60 days');
observation.saveProfile({ subject: alpha, theme: 'rhythm', labels: ['夜'], confirmed: false });
const unconfirmed = observation.profileMatrix({ subjects: [alpha] });
if (!unconfirmed.ok || !unconfirmed.data.entries[0]?.stale) fail('label-only edit keeps the confirm date');

// 注目動画と特徴タグ
const focus = observation.addFocusUrls({
  channelId: alpha,
  urls: 'https://www.youtube.com/watch?v=vid00000001\nhttps://youtu.be/vid00000002\nnot a url',
  reason: 'いつもより明らかに伸びている',
});
if (!focus.ok || focus.data.added.length !== 2 || focus.data.invalid.length !== 1) fail('focus urls');
const newTag = observation.saveTag({ name: '最初の1秒で結論', group: '冒頭・フック', criteria: '1秒目に答えを言う' });
if (!newTag.ok) fail(newTag.message);
const sameTag = observation.saveTag({ name: '最初の1秒で結論', group: '構成' });
if (!sameTag.ok || sameTag.data.id !== newTag.data.id) fail('same name reuses the tag');
observation.assignTag({ videoIds: ['vid00000001', 'vid00000003'], tagId: newTag.data.id });
const counted = observation.tags();
const count = counted.ok ? counted.data.find((tag) => tag.id === newTag.data.id) : undefined;
if (!count || count.focusCount !== 1 || count.allCount !== 2) fail(`tag counts ${JSON.stringify(count)}`);
const page = observation.videos({ channelIds: [alpha], focusOnly: true });
if (!page.ok || page.data.total !== 2 || page.data.focusTotal !== 2) fail('focus videos listed');
const first = page.data.items.find((item) => item.videoId === 'vid00000001');
if (!first || first.jotCount !== 1 || first.tagIds[0] !== newTag.data.id || first.focusReason !== 'いつもより明らかに伸びている') {
  fail('video decorated with jots, tags and reason');
}
if (first.availability !== 'not_in_session' || first.title !== null) fail('focus video without session has no api data');
if (first.vidiqUrl !== 'https://vidiq.com/youtube-stats/channel/@AlphaChannel/videos/vid00000001/') fail('video vidiq url');
const untagged = observation.videos({ channelIds: [alpha], untaggedOnly: true });
if (!untagged.ok || untagged.data.items.some((item) => item.videoId === 'vid00000001')) fail('untagged filter');
observation.setFocus({ channelId: alpha, videoId: 'vid00000002', focus: false });
const unfocused = observation.videos({ channelIds: [alpha], focusOnly: true });
if (!unfocused.ok || unfocused.data.total !== 1) fail('unfocus');

// AI に送る内容に API の値が混ざらない
session.putMeta({
  entityType: 'video',
  entityId: 'vid00000001',
  channelId: alpha,
  title: 'SECRET_TITLE',
  description: 'SECRET_DESCRIPTION',
  publishedAt: '2026-09-01T00:00:00.000Z',
  durationIso: 'PT42S',
  fetchedAt: clock.toISOString(),
  expiresAt: '2027-01-01T00:00:00.000Z',
  runId: 'run',
  availability: 'available',
});
const prepared = observation.featureIdeaInput({ focusVideoIds: ['vid00000001'], compareVideoIds: ['vid00000003'] });
if (!prepared.ok) fail(prepared.message);
const sentText = JSON.stringify(prepared.data.sent);
if (sentText.includes('SECRET') || sentText.includes('PT42S') || sentText.includes('vid0000000')) fail('api data or ids sent to ai');
if (!sentText.includes('冒頭で結果を見せる') || !sentText.includes('いつもより明らかに伸びている')) fail('own notes sent to ai');
const resolved = observation.resolveIdeas(
  [{ name: '結論を先に', group: '構成', fact: '', hypothesis: '', counter: '', refs: [0, 1] }],
  prepared.data,
);
if (resolved.ideas[0]?.videoIds.join() !== 'vid00000001,vid00000003' || resolved.ideas[0].focusHits !== 1 || resolved.ideas[0].compareHits !== 1) {
  fail('resolve ideas');
}

// チャンネル削除：気づきは本文だけ残し、プロフィールとタグ付けは消す
const removed = competitors.remove({ id: alpha, keepNotes: true });
if (!removed.ok) fail('remove');
const afterRemove = observation.jots({ status: 'all' });
const orphan = afterRemove.ok ? afterRemove.data.items.find((item) => item.id === jot.data.id) : undefined;
if (!orphan || orphan.channelId !== null) fail('kept jot is detached from the channel');
const profilesLeft = db.prepare('SELECT COUNT(*) AS n FROM competitor_profile_entries WHERE subject = ?').get(alpha) as { n: number };
if (Number(profilesLeft.n) !== 0) fail('profile removed with channel');
const assignLeft = db.prepare("SELECT COUNT(*) AS n FROM competitor_video_feature_tags WHERE video_id = 'vid00000001'").get() as { n: number };
if (Number(assignLeft.n) !== 0) fail('tag assignments removed with channel videos');

db.close();
for (const item of dirs) rmSync(item, { recursive: true, force: true });
console.log('competitor observation checks ok');
};

void main();
