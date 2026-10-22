import twitterText from 'twitter-text';
import { buildTrackingUrl } from '../shared/delivery-presets';
import { guessBasename } from '../shared/export-copy';
import { followPublishing } from '../shared/guide';
import { createDefaultProject, parseProject, type Project } from '../shared/schema/project';
import {
  applyVideoHooks,
  assembleXPost,
  normalizeHook,
  prepareXPost,
  videoHookText,
  weighXPost,
  xTrackingUrl,
  X_WEIGHTED_LIMIT,
} from '../shared/x-post';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const now = new Date('2026-10-11T00:00:00.000Z');
const basename = '20261011_Ascent_Phoenix_std_x_v1';
const spot = 'https://gg.clutchvault.app/lineups/phoenix?note=1&utm_source=old&utm_source=dup#aim';
const video = 'https://youtube.com/shorts/dQw4w9WgXcQ?t=12';

const readyProject = (): Project => {
  const project = followPublishing(createDefaultProject('x-post', now.toISOString()));
  project.plannedPostDate = '2026-10-11';
  project.publishing.memoUrl = spot;
  project.publishing.xPost.spotDraft = '';
  project.publishing.xPost.ja = 'あ';
  project.publishing.xPost.jaEdited = true;
  project.publishing.xPost.en = 'Hold the angle';
  project.publishing.xPost.enEdited = true;
  project.publishing.xPost.videoUrl = video;
  project.publishing.xPost.videoUrlEdited = true;
  project.experiment.utmCampaign = 'first_9_lineups';
  return project;
};

if (weighXPost('a'.repeat(280)).weightedLength !== 280 || !weighXPost('a'.repeat(280)).valid) {
  fail('280 ascii should be valid');
}
if (weighXPost('a'.repeat(281)).weightedLength !== 281 || weighXPost('a'.repeat(281)).valid) {
  fail('281 ascii should be invalid');
}
if (weighXPost('あ').weightedLength !== 2) fail('hiragana should weigh 2');
if (weighXPost('😀').weightedLength !== 2) fail('emoji should weigh 2');
const longUrl = `https://gg.clutchvault.app/lineups/phoenix?${'q='}${'a'.repeat(180)}`;
if (weighXPost(longUrl).weightedLength !== 23) fail(`long url weighed ${weighXPost(longUrl).weightedLength}`);
if (weighXPost(`${longUrl}\n${longUrl}`).weightedLength !== 47) fail('two urls should be 23 each plus the break');

const project = readyProject();
const prepared = prepareXPost(project, { basename, now });
const lines = prepared.text.split('\n');
if (lines.length !== 7) fail(`template lines ${lines.length}: ${prepared.text}`);
if (lines[0] !== 'あ' || lines[1] !== 'Hold the angle' || lines[2] !== '') fail('hook block');
if (lines[3] !== '試合用画像 / Lineup' || lines[5] !== '投げ方動画 / Watch') fail('labels');
if (lines[6] !== video) fail(`video url changed ${lines[6]}`);
if (lines[6].includes('utm_')) fail('video url gained utm');
if (prepared.text !== assembleXPost({ ja: 'あ', en: 'Hold the angle', spotUrl: prepared.spotUrl, videoUrl: video })) {
  fail('preview and assembled text diverged');
}
if (!prepared.copyable || prepared.text.includes('undefined')) fail('ready post should copy');
if ((prepared.text.match(/utm_source=/g) ?? []).length !== 1) fail(`utm duplicated ${prepared.spotUrl}`);
if (!prepared.spotUrl.includes('utm_source=x') || prepared.spotUrl.includes('utm_source=old')) fail(prepared.spotUrl);
if (!prepared.spotUrl.includes('utm_medium=card')) fail(`medium ${prepared.spotUrl}`);
if (!prepared.spotUrl.includes('utm_campaign=first_9_lineups')) fail(`campaign ${prepared.spotUrl}`);
if (!prepared.spotUrl.includes(`utm_content=${basename}`)) fail(`content ${prepared.spotUrl}`);
if (!prepared.spotUrl.includes('note=1') || !prepared.spotUrl.endsWith('#aim')) fail(`url structure ${prepared.spotUrl}`);
if (prepared.spotUrl !== xTrackingUrl(project, prepared.spotUrl, basename)) fail('tracking grew a second utm set');
if (guessBasename(project, 'x-jp', now) !== '20261011_Ascent_Phoenix_std_x_v1') {
  fail(`basename ${guessBasename(project, 'x-jp', now)}`);
}

const again = buildTrackingUrl({
  presetId: 'x-jp',
  basename,
  campaign: 'first_9_lineups',
  base: prepared.spotUrl,
});
if (again !== prepared.spotUrl) fail(`rebuild changed the url ${again}`);

const padded = (extra: string): ReturnType<typeof prepareXPost> => {
  const next = readyProject();
  next.publishing.xPost.en = extra;
  return prepareXPost(next, { basename, now });
};
let exact = '';
for (let count = 0; count < 400; count += 1) {
  const extra = `😀${'a'.repeat(count)}`;
  const post = padded(extra);
  if (post.weightedLength === X_WEIGHTED_LIMIT) {
    exact = extra;
    if (!post.valid || !post.copyable) fail('280 weighted should be copyable');
    if (post.text.length === post.weightedLength) fail('weighted length matched raw length');
    if (post.weightedLength !== twitterText.parseTweet(post.text).weightedLength) fail('count left twitter-text');
    break;
  }
}
if (!exact) fail('could not build a 280-count post');
const over = padded(`${exact}a`);
if (over.weightedLength !== 281 || over.valid || over.copyable) fail(`281 should block copy (${over.weightedLength})`);
if (!over.problems.some((problem) => problem.includes('280カウントを超えています'))) fail('missing over-limit reason');
if (!over.text.endsWith(`${exact}a`) && !over.text.includes(`${exact}a`)) fail('over-limit text was truncated');

const shortVideo = readyProject();
shortVideo.publishing.xPost.videoUrl = 'https://youtu.be/dQw4w9WgXcQ';
const longVideo = readyProject();
longVideo.publishing.xPost.videoUrl = `https://www.youtube.com/watch?v=dQw4w9WgXcQ&${'feature='}${'share'.repeat(40)}`;
if (prepareXPost(shortVideo, { basename, now }).weightedLength !== prepareXPost(longVideo, { basename, now }).weightedLength) {
  fail('url length changed the post count');
}

const broken = readyProject();
broken.publishing.xPost.videoUrl = 'notaurl';
broken.publishing.memoUrl = '';
const incomplete = prepareXPost(broken, { basename, now });
if (incomplete.copyable) fail('incomplete post was copyable');
if (incomplete.text.includes('notaurl') || incomplete.text.includes('undefined') || incomplete.text.includes('{')) {
  fail(`placeholder leaked ${incomplete.text}`);
}
if (!incomplete.problems.some((problem) => problem.includes('動画URL')) || !incomplete.problems.some((problem) => problem.includes('未入力'))) {
  fail(`problems ${incomplete.problems.join(' / ')}`);
}

const landing = readyProject();
landing.publishing.memoUrl = 'https://clutchvault.app/en/';
landing.publishing.xPost.spotDraft = '';
const landingPost = prepareXPost(landing, { basename, now });
if (landingPost.copyable || landingPost.text.includes('clutchvault.app') || !landingPost.problems.some((problem) => problem.includes('トップページ'))) {
  fail(`landing page was accepted ${landingPost.problems.join(' / ')}`);
}
const list = readyProject();
list.publishing.memoUrl = 'https://gg.clutchvault.app/lineups';
const listPost = prepareXPost(list, { basename, now });
if (listPost.copyable || !listPost.problems.some((problem) => problem.includes('一覧'))) fail('list page was accepted');

const multiline = readyProject();
multiline.publishing.xPost.ja = 'あ\nい';
const flat = prepareXPost(multiline, { basename, now });
if (flat.text.split('\n')[0] !== 'あ い' || flat.ja !== 'あ い') fail(`newline survived ${flat.ja}`);
if (normalizeHook('  English\r\nline  ') !== 'English line') fail('hook normalize');

const isolated = readyProject();
const captionBefore = isolated.captions.find((caption) => caption.id === 'hook')?.text.ja;
const titleBefore = isolated.publishing.title.ja;
isolated.publishing.xPost.ja = '別フック';
const kept = followPublishing(isolated);
if (kept.captions.find((caption) => caption.id === 'hook')?.text.ja !== captionBefore) fail('x hook edited the caption');
if (kept.publishing.title.ja !== titleBefore) fail('x hook edited the title');
if (kept.publishing.xPost.ja !== '別フック') fail('edited x hook was overwritten');
isolated.publishing.xPost.ja = '途中 ';
isolated.publishing.xPost.jaEdited = true;
const typing = followPublishing(isolated);
if (typing.publishing.xPost.ja !== '途中 ') fail('trailing space was eaten while typing');
if (prepareXPost(typing, { basename, now }).text.split('\n')[0] !== '途中') fail('assembled hook kept the trailing space');
const hook = kept.captions.find((caption) => caption.id === 'hook');
if (!hook) fail('hook caption');
hook.text = { ...hook.text, ja: '動画側を変えた' };
const still = followPublishing(kept);
if (still.publishing.xPost.ja !== '別フック') fail('video update overwrote the edited x hook');
if (still.captions.find((caption) => caption.id === 'hook')?.text.ja !== '動画側を変えた') fail('video caption was reverted');

const fresh = followPublishing(createDefaultProject('fresh', now.toISOString()));
const live = fresh.captions.find((caption) => caption.id === 'hook');
if (!live) fail('fresh hook');
live.text = { ...live.text, ja: '新しい一行' };
const followed = followPublishing(fresh);
if (followed.publishing.xPost.ja !== '新しい一行' || followed.publishing.xPost.jaEdited) {
  fail(`unedited x hook did not follow ${followed.publishing.xPost.ja}`);
}
const imported = applyVideoHooks({
  ...followed,
  publishing: {
    ...followed.publishing,
    xPost: { ...followed.publishing.xPost, ja: '別フック', jaEdited: true },
  },
});
if (imported.captions.find((caption) => caption.id === 'hook')?.text.ja !== '新しい一行') fail('import changed the caption');
if (imported.publishing.title.ja !== followed.publishing.title.ja) fail('import changed the title');
if (imported.publishing.xPost.ja !== videoHookText(imported, 'ja') || !imported.publishing.xPost.jaEdited) {
  fail('import did not copy the video hook');
}

const custom = readyProject();
custom.posts = [
  {
    id: 'yt',
    platform: 'youtube',
    lang: 'en',
    url: 'https://youtube.com/shorts/dQw4w9WgXcQ',
    postedAt: now.toISOString(),
    preset: 'yt-global',
  },
  {
    id: 'tt',
    platform: 'tiktok',
    lang: 'ja',
    url: 'https://tiktok.com/@h1gher/video/1234567890',
    postedAt: now.toISOString(),
    preset: 'tt-jp',
  },
];
custom.publishing.xPost.videoUrl = '';
custom.publishing.xPost.videoUrlEdited = false;
custom.guide.xReplyVideo = 'youtube';
const fromYoutube = prepareXPost(custom, { basename, now });
if (fromYoutube.videoUrl !== 'https://youtube.com/shorts/dQw4w9WgXcQ') fail('published youtube url was ignored');
if (fromYoutube.text.includes('tiktok.com')) fail('both video urls were inserted');
custom.guide.xReplyVideo = 'tiktok';
if (prepareXPost(custom, { basename, now }).videoUrl !== 'https://tiktok.com/@h1gher/video/1234567890') {
  fail('platform switch did not change the single video url');
}
custom.publishing.xPost.videoUrl = 'https://example.com/watch';
custom.publishing.xPost.videoUrlEdited = true;
if (prepareXPost(custom, { basename, now }).videoUrl !== 'https://example.com/watch') fail('saved video url was overwritten');

const stored = readyProject();
stored.publishing.xPost.ja = '残す';
stored.publishing.xPost.en = 'Keep 😀';
stored.publishing.xPost.spotDraft = 'https://example.com/not-yet';
const revived = parseProject(JSON.parse(JSON.stringify(stored)));
if (revived.publishing.xPost.ja !== '残す' || revived.publishing.xPost.en !== 'Keep 😀') fail('x hooks dropped on reload');
if (revived.publishing.xPost.videoUrl !== video || !revived.publishing.xPost.videoUrlEdited) fail('video url dropped on reload');
if (revived.publishing.xPost.spotDraft !== 'https://example.com/not-yet') fail('spot draft dropped on reload');
if (revived.captions.find((caption) => caption.id === 'hook')?.text.ja === '残す') fail('saved x hook leaked into the caption');
const legacy = JSON.parse(JSON.stringify(createDefaultProject('legacy-x', now.toISOString()))) as {
  publishing: { xPost?: unknown };
};
delete legacy.publishing.xPost;
const upgraded = parseProject(legacy);
if (upgraded.publishing.xPost.jaEdited || upgraded.publishing.xPost.videoUrl || upgraded.publishing.xPost.spotDraft) {
  fail('legacy project did not default x post fields');
}
const restored = followPublishing(revived);
if (restored.publishing.xPost.ja !== '残す' || restored.publishing.xPost.en !== 'Keep 😀') {
  fail('reload followed by sync overwrote edited hooks');
}

const soft = readyProject();
soft.publishing.xPost.ja = 'あ'.repeat(21);
soft.publishing.xPost.en = `b${'c'.repeat(60)}`;
const softPost = prepareXPost(soft, { basename, now });
if (!softPost.copyable) fail('soft hook limits blocked a post that fits');

console.log('x post checks ok');
