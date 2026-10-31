import { createDefaultProject, parseProject } from '../shared/schema/project';
import {
  cardStillFrames,
  normalizedStillFocus,
  panStillFocus,
  stillFocusAxes,
  stillObjectPosition,
  stillPreviewFrame,
} from '../shared/still-focus';
import {
  activeTimeline,
  applySceneCutDuration,
  defaultBgmPlacement,
  rangeForSceneDuration,
  rangeForSceneDurationFromOut,
  sceneDurations,
} from '../shared/timeline';
import { postsToCsv } from '../shared/post-metrics';
import { CTA_TEXT, buildTrackingUrl } from '../shared/delivery-presets';
import { copyForJob, jobsForPresets } from '../shared/export-copy';
import {
  applyDefaultVolumes,
  applyPublishingMemo,
  followPublishing,
  markPublishingEdited,
  reviewItems,
} from '../shared/guide';
import { precheckAuto } from '../shared/publishing';
import {
  applyPublishingTranslation,
  composePublishingTitle,
  normalizePublishingDraft,
  publishingShowsKorean,
  publishingTranslationLanguages,
  publishingTranslationStale,
  titleIssues,
} from '../shared/production';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const v3 = {
  schemaVersion: 3,
  id: 'legacy',
  title: '旧定点',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  lineup: {
    id: 'lineup-legacy',
    map: 'Ascent',
    site: 'A',
    side: 'defense',
    agent: 'Sova',
    ability: 'Recon Bolt',
    throwType: { ja: '通常', en: 'NORMAL' },
    crouch: false,
    standDescription: { ja: '角', en: 'CORNER' },
    aimDescription: { ja: '印', en: 'MARK' },
  },
  assets: [],
  clips: [],
  stills: [],
  scenes: [{ sceneKey: 'hook', layout916: 'blur-fit', cropCenterX: 0.5, volume: 1 }],
  captions: [
    {
      id: 'hook',
      sceneKey: 'hook',
      text: { ja: 'フック', en: 'HOOK' },
      styleId: 'cap.hook',
    },
  ],
  templateId: 't-std',
  timelineEdited: false,
  timeline: null,
  templateParams: { accent: '#FF4655', fps: 60, demoDuration: 11.5, sceneDurationOffsets: {} },
  hookPattern: 'custom',
  cardLayout: 'stack',
  cardStills: {},
  audio: { bgm: null },
  publishing: {
    title: { ja: '日本語', en: 'English' },
    description: { ja: '説明', en: 'Desc' },
    hashtags: { ja: '#a', en: '#b' },
  },
  posts: [
    {
      id: 'post-1',
      platform: 'youtube',
      lang: 'en',
      url: 'https://youtu.be/abc',
      postedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'post-2',
      platform: 'tiktok',
      lang: 'ja',
      url: '',
      postedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  status: 'editing',
  guide: {
    mode: 'guide',
    lastStep: 1,
    confirmedSteps: [],
    publishingEdited: {},
    exportPlatforms: ['youtube', 'x'],
    exportWithoutBgm: false,
  },
};

const upgraded = parseProject(v3);
if (upgraded.schemaVersion !== 7) fail(`expected version 7, got ${upgraded.schemaVersion}`);
if (upgraded.publishing.title.ko !== undefined) fail('v3 migration must not add Korean title');
if (upgraded.experiment.phase !== 'p1' || upgraded.experiment.series !== 'phoenix-lineups') {
  fail('experiment default missing');
}
if (upgraded.experiment.utmCampaign !== 'first_9_lineups') fail('utm campaign default');
if (upgraded.publishing.memoUrl !== '') fail('memo url should default empty');
if (upgraded.experiment.testVariables.length !== 0) fail('test variables should start empty');
if (upgraded.posts[0]?.preset !== 'yt-global') fail(`youtube en preset ${upgraded.posts[0]?.preset}`);
if (upgraded.posts[1]?.preset !== 'tt-jp') fail(`tiktok ja preset ${upgraded.posts[1]?.preset}`);
if (!upgraded.guide.exportPresets.includes('yt-global') || !upgraded.guide.exportPresets.includes('x-jp')) {
  fail(`presets ${upgraded.guide.exportPresets.join(',')}`);
}
if (upgraded.guide.exportPresets.includes('tt-jp')) fail('tiktok was not selected');
const upgradedCta = upgraded.captions.find((caption) => caption.id === 'cta');
if (!upgradedCta) fail('cta caption missing');
if (upgradedCta.text.ja !== CTA_TEXT.ja || upgradedCta.text.en !== CTA_TEXT.en) {
  fail(`default cta ${upgradedCta.text.ja} / ${upgradedCta.text.en}`);
}
if (Object.keys(upgraded.templateParams.sceneDurations).length !== 0) fail('legacy scene durations should stay empty');

const saved = parseProject(JSON.parse(JSON.stringify(upgraded)));
if (saved.schemaVersion !== 7) fail('resave should stay version 7');
if (saved.publishing.title.ko !== undefined) fail('roundtrip added Korean title');

const created = createDefaultProject('new', '2026-10-04T00:00:00.000Z');
if (created.lineup.agent !== 'Phoenix' || created.lineup.ability !== 'Curveball') {
  fail(`default agent ${created.lineup.agent} ${created.lineup.ability}`);
}
if (created.scenes.some((scene) => scene.volume !== 0.1)) fail('new project game volume should default to 0.1');
const resetVolumes = applyDefaultVolumes(
  { ...created, scenes: created.scenes.map((scene) => ({ ...scene, volume: 1 })) },
  true,
  false,
);
if (resetVolumes.scenes.some((scene) => scene.volume !== 0.1)) fail('reset game volume should use 0.1');
if (defaultBgmPlacement(created, 'bgm-test').gain !== 0.02) fail('new BGM volume should default to 0.02');
if (created.englishCaptionPreset !== 'en-concise') fail('english preset');
const createdCta = created.captions.find((caption) => caption.id === 'cta');
if (createdCta?.text.ja !== CTA_TEXT.ja || createdCta?.text.en !== CTA_TEXT.en) fail('new project cta');
const legacyCta = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  captions: created.captions.map((caption) =>
    caption.id === 'cta'
      ? {
          ...caption,
          text: { ja: '定点はプロフのリンクから保存', en: 'Save this lineup → ClutchVault' },
        }
      : caption,
  ),
});
const migratedCta = legacyCta.captions.find((caption) => caption.id === 'cta');
if (migratedCta?.text.ja !== CTA_TEXT.ja || migratedCta?.text.en !== CTA_TEXT.en) fail('legacy cta was not migrated');
const spaced = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  captions: created.captions.map((caption) =>
    caption.id === 'cta'
      ? { ...caption, text: { ja: 'この定点を\n[ClutchVaultに保存]', en: 'Save this lineup →\n[ClutchVault]' } }
      : caption,
  ),
});
const spacedCta = spaced.captions.find((caption) => caption.id === 'cta');
if (spacedCta?.text.ja !== CTA_TEXT.ja || spacedCta?.text.en !== CTA_TEXT.en) fail('unspaced cta was not migrated');
const customCta = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  captions: created.captions.map((caption) =>
    caption.id === 'cta' ? { ...caption, text: { ja: '保存して', en: 'Save it' } } : caption,
  ),
});
const kept = customCta.captions.find((caption) => caption.id === 'cta');
if (kept?.text.ja !== '保存して' || kept?.text.en !== 'Save it') fail('custom cta was overwritten');
const freshReview = reviewItems(created);
if (freshReview.find((item) => item.id === 'cta-duplicate')?.level !== 'ok') fail('cta should not be duplicated');
for (const id of ['brand-lockup', 'overflow', 'korean-title']) {
  if (freshReview.some((item) => item.id === id)) fail(`${id} should leave step 7`);
}
const duplicated = structuredClone(created);
duplicated.captions.push({
  id: 'loop-chip',
  sceneKey: 'loop',
  text: { ja: CTA_TEXT.ja, en: CTA_TEXT.en },
  styleId: 'cap.step',
});
if (reviewItems(duplicated).find((item) => item.id === 'cta-duplicate')?.level !== 'error') {
  fail('duplicate cta was not detected');
}
if (!created.guide.exportPresets.includes('yt-global') || !created.guide.exportPresets.includes('x-jp')) {
  fail('default presets');
}
if (created.guide.exportPresets.includes('tt-jp')) fail('tiktok ja should start off');
const ranged = rangeForSceneDuration(1, 4, 10);
if (ranged.in !== 1 || ranged.out !== 5) fail(`range ${ranged.in}-${ranged.out}`);
const stand = applySceneCutDuration(created, 'stand', 5);
if (sceneDurations(stand).stand !== 5) fail(`stand duration ${sceneDurations(stand).stand}`);
const card = applySceneCutDuration(created, 'card', 1.2);
if (sceneDurations(card).card !== 1.2) fail(`card duration ${sceneDurations(card).card}`);
if (activeTimeline(card).items.find((item) => item.sceneKey === 'card')?.duration !== 1.2) {
  fail('card timeline duration');
}
const edited = applySceneCutDuration(
  { ...created, timelineEdited: true, timeline: activeTimeline(created) },
  'hook',
  2.5,
);
if (sceneDurations(edited).hook !== 2.5) fail(`edited hook duration ${sceneDurations(edited).hook}`);
if (activeTimeline(edited).items.find((item) => item.sceneKey === 'hook')?.duration !== 2.5) {
  fail('edited timeline hook duration');
}
const demo = applySceneCutDuration(created, 'demo', 3);
if (sceneDurations(demo).demo !== 6) fail(`demo duration ${sceneDurations(demo).demo}`);
const shifted = rangeForSceneDuration(9, 4, 10);
if (shifted.in !== 6 || shifted.out !== 10) fail(`shifted range ${shifted.in}-${shifted.out}`);
const fromOut = rangeForSceneDurationFromOut(7, 4, 10);
if (fromOut.in !== 3 || fromOut.out !== 7) fail(`fromOut ${fromOut.in}-${fromOut.out}`);
const fromOutClamped = rangeForSceneDurationFromOut(2, 4, 10);
if (fromOutClamped.in !== 0 || fromOutClamped.out !== 4) fail(`fromOutClamped ${fromOutClamped.in}-${fromOutClamped.out}`);

const url = buildTrackingUrl({
  presetId: 'yt-global',
  basename: '20261010_Summit_A_Phoenix_lineup_en_v1',
  language: 'en',
  campaign: 'first_9_lineups',
});
const parsed = new URL(url);
if (parsed.origin + parsed.pathname !== 'https://clutchvault.app/en/') fail(`origin ${parsed.origin}${parsed.pathname}`);
if (parsed.searchParams.get('utm_source') !== 'youtube') fail('utm_source');
if (parsed.searchParams.get('utm_medium') !== 'short') fail('utm_medium');
if (parsed.searchParams.get('utm_campaign') !== 'first_9_lineups') fail('utm_campaign');
if (parsed.searchParams.get('utm_content') !== '20261010_Summit_A_Phoenix_lineup_en_v1') fail('utm_content');

const jaTracked = new URL(buildTrackingUrl({
  presetId: 'yt-global',
  basename: '20261010_Summit_A_Phoenix_lineup_en_v1',
  language: 'ja',
}));
if (jaTracked.origin + jaTracked.pathname !== 'https://clutchvault.app/') fail(`ja origin ${jaTracked.href}`);
if (jaTracked.searchParams.get('utm_campaign') !== 'first_9_lineups') fail('ja campaign fallback');

const xUrl = buildTrackingUrl({
  presetId: 'x-jp',
  basename: '20261010_Summit_A_Phoenix_lineup_x_v1',
});
const xParsed = new URL(xUrl);
if (!xParsed.href.startsWith('https://clutchvault.app/?')) fail(`x url ${xParsed.href}`);
if (xParsed.searchParams.get('utm_medium') !== 'card') fail('x medium');
if (xParsed.searchParams.get('utm_campaign') !== 'first_9_lineups') fail('x campaign');

const memo = 'https://gg.clutchvault.app/lineups/phoenix?note=1&utm_source=old';
const memoTracked = new URL(
  buildTrackingUrl({
    presetId: 'yt-global',
    basename: '20261010_Summit_A_Phoenix_lineup_en_v1',
    language: 'en',
    campaign: 'first_9_lineups',
    base: memo,
  }),
);
if (memoTracked.origin + memoTracked.pathname !== 'https://gg.clutchvault.app/lineups/phoenix') {
  fail(`memo origin ${memoTracked.href}`);
}
if (memoTracked.searchParams.get('note') !== '1') fail('memo query dropped');
if (memoTracked.searchParams.get('utm_source') !== 'youtube') fail('memo utm was not replaced');
if (memoTracked.searchParams.get('utm_content') !== '20261010_Summit_A_Phoenix_lineup_en_v1') fail('memo content');
const ignored = new URL(
  buildTrackingUrl({
    presetId: 'yt-global',
    basename: '20261010_Summit_A_Phoenix_lineup_en_v1',
    language: 'en',
    base: 'http://gg.clutchvault.app/lineups/phoenix',
  }),
);
if (ignored.origin + ignored.pathname !== 'https://clutchvault.app/en/') fail(`unsafe memo kept ${ignored.href}`);

const published = followPublishing(structuredClone(created));
const publishedTitles = `${published.publishing.title.ja}\n${published.publishing.title.en}`;
if (/[\[\]]|\{br\}/.test(publishedTitles) || publishedTitles.replaceAll('#valorant', '').includes('#')) {
  fail(`title kept markup ${published.publishing.title.en}`);
}
if (!published.publishing.title.en.startsWith('Phoenix lineups = FREE KILLS | Ascent A')) {
  fail(`en title ${published.publishing.title.en}`);
}
if (!published.publishing.title.en.endsWith('#valorant')) fail(`en title tag ${published.publishing.title.en}`);
if (!published.publishing.title.ja.endsWith('フェニックス定点 #valorant')) fail(`ja title ${published.publishing.title.ja}`);
if (!published.publishing.title.ja.includes('| アセント')) fail(`ja title missing map ${published.publishing.title.ja}`);
if (!published.publishing.title.ko?.includes('| 어센트')) fail(`ko title missing map ${published.publishing.title.ko}`);
const mappedHook = structuredClone(created);
const hookCaption = mappedHook.captions.find((caption) => caption.id === 'hook');
if (!hookCaption) fail('hook caption missing');
hookCaption.text = { ja: '{map}で一番使える定点', en: '1 lineup you NEED on {map}' };
const mappedTitles = followPublishing(mappedHook).publishing.title;
if (!mappedTitles.ja.includes('| アセント')) fail(`ja title missing map ${mappedTitles.ja}`);
if (!mappedTitles.ko?.includes('| 어센트')) fail(`ko title dropped map when English hook has it ${mappedTitles.ko}`);
if (mappedTitles.en.includes('| Ascent')) fail(`en title repeated map ${mappedTitles.en}`);
const namedHook = structuredClone(created);
const namedCaption = namedHook.captions.find((caption) => caption.id === 'hook');
if (!namedCaption) fail('named hook caption missing');
namedCaption.text = { ja: 'アセントで一番使える定点', en: '어센트 lineup' };
const namedTitles = followPublishing(namedHook).publishing.title;
if (namedTitles.ja.includes('| アセント')) fail(`ja title repeated map ${namedTitles.ja}`);
if (namedTitles.ko?.includes('| 어센트')) fail(`ko title repeated map ${namedTitles.ko}`);
if (!published.publishing.description.en.endsWith("I'm the developer of ClutchVault.\n\n#valorantshorts")) {
  fail('en description tag');
}
if (!published.publishing.description.ja.endsWith('ClutchVaultの開発者本人が投稿しています。\n\n#valorantshorts')) {
  fail('ja description tag');
}
if (!published.publishing.description.en.includes('Check this lineup on ClutchVault:')) fail('en lead');
if (!published.publishing.description.en.toLowerCase().includes('closed beta')) fail('en beta');
if (published.publishing.description.en.includes('Save it on ClutchVault')) fail('en save claim');
if (!published.publishing.description.ja.includes('ClutchVaultでこの定点をチェック：')) fail('ja lead');
if (!published.publishing.description.ja.includes('クローズドβテスター受付中')) fail('ja beta');
const expectedHashtags = 'valorant lineups,Phoenix,Ascent,valorant tips';
if (published.publishing.hashtags.ja !== expectedHashtags) {
  fail(`ja hashtags ${published.publishing.hashtags.ja}`);
}
if (published.publishing.hashtags.en !== expectedHashtags) {
  fail(`en hashtags ${published.publishing.hashtags.en}`);
}
if (published.publishing.hashtags.ko !== expectedHashtags) {
  fail(`ko hashtags ${published.publishing.hashtags.ko}`);
}
if (/utm_campaign|utm_content/.test(
  `${published.publishing.description.ja}\n${published.publishing.description.en}\n${published.publishing.description.ko ?? ''}`,
)) {
  fail('default description should not include utm_campaign or utm_content');
}
const midBody = published.publishing.description.ja;
const midAt = midBody.indexOf('utm_source');
if (midAt < 0) fail('description url missing');
const midInserted = `${midBody.slice(0, midAt + 4)}X${midBody.slice(midAt + 4)}`;
const midEdit = markPublishingEdited(structuredClone(published), 'description', 'ja');
midEdit.publishing.description.ja = midInserted;
const midKept = followPublishing(midEdit);
if (midKept.publishing.description.ja !== midInserted) {
  fail(`mid description edit was rewritten ${midKept.publishing.description.ja}`);
}
if (!midKept.publishing.description.ja.endsWith('投稿しています。\n\n#valorantshorts')) fail('description ending dropped');
const memoOnEdit = applyPublishingMemo(midKept, memo);
if (!memoOnEdit.publishing.description.ja.includes('gg.clutchvault.app/lineups/phoenix')) {
  fail('edited description did not take the memo url');
}
if (!memoOnEdit.publishing.description.ja.endsWith('投稿しています。\n\n#valorantshorts')) fail('memo sync dropped the ending');
if (/utm_campaign|utm_content/.test(memoOnEdit.publishing.description.ja)) {
  fail('memo sync put identity utm back into the description');
}
if (!published.publishing.description.ja.includes('https://t.co/fvdgfFPSXb')) fail('ja signup');
if (!published.publishing.description.en.includes('https://t.co/fvdgfFPSXb')) fail('en signup');
const koUrl = published.publishing.description.ko?.match(/https?:\/\/\S+/)?.[0] ?? '';
if (!koUrl.includes('https://clutchvault.app/en/')) fail(`ko url ${koUrl}`);

const withMemo = structuredClone(published);
withMemo.publishing.memoUrl = memo;
const followedMemo = followPublishing(withMemo);
if (followedMemo.publishing.memoUrl !== memo) fail('memo url dropped');
if (!followedMemo.publishing.description.ja.includes('gg.clutchvault.app/lineups/phoenix')) {
  fail(`ja memo ${followedMemo.publishing.description.ja}`);
}
if (!followedMemo.publishing.description.en.includes('gg.clutchvault.app/lineups/phoenix')) {
  fail(`en memo ${followedMemo.publishing.description.en}`);
}
if (followedMemo.publishing.description.en.includes('clutchvault.app/en/')) fail('en kept the landing page');
const cleared = structuredClone(followedMemo);
cleared.publishing.memoUrl = '';
const restored = followPublishing(cleared);
if (restored.publishing.description.ja.includes('gg.clutchvault.app')) fail('cleared ja still has the memo');
if (!restored.publishing.description.en.includes('https://clutchvault.app/en/')) fail('cleared en lost the landing page');
const memoJob = jobsForPresets(['tt-jp']).find((job) => job.slot === 'ja');
if (!memoJob) fail('ja job');
const memoCopy = copyForJob(followedMemo, memoJob, '20261010_Ascent_A_Phoenix_lineup_ja_v1', '');
if (!memoCopy.text.includes('gg.clutchvault.app/lineups/phoenix')) fail('export dropped the memo path');
if (!memoCopy.text.includes('utm_source=tiktok')) fail('export dropped tiktok utm');
if (memoCopy.text.includes('utm_source=old')) fail('export kept the pasted utm');

const enJob = jobsForPresets(['yt-global']).find((job) => job.slot === 'en');
if (!enJob) fail('en job');
const enCopy = copyForJob(published, enJob, '20261010_Ascent_A_Phoenix_lineup_en_v1', 'BGM: test');
const enBlock = enCopy.text.split('\n\n[ja]')[0] ?? '';
const enUrls = enBlock.match(/https?:\/\/\S+/g) ?? [];
const signupUrls = enUrls.filter((url) => url.startsWith('https://t.co/fvdgfFPSXb'));
const trackedUrls = enUrls.filter((url) => url.includes('clutchvault.app'));
if (signupUrls.length !== 1 || trackedUrls.length !== 1) fail(`en txt urls ${enUrls.join(' | ')}`);
const enLines = enBlock.split('\n');
const tagLine = enLines.findIndex((line) => line === expectedHashtags);
const creditLine = enLines.findIndex((line) => line === 'BGM: test');
if (tagLine < 0 || creditLine < tagLine) fail('credit should follow hashtags');
const xJob = jobsForPresets(['x-jp'])[0];
if (!xJob) fail('x job');
const bareX = copyForJob(published, xJob, '20261010_Ascent_A_Phoenix_lineup_x_v1', '');
if (bareX.text.includes('utm_source') || bareX.text.includes('undefined') || bareX.text.includes('クローズドβ')) {
  fail(`bare x copy should stay incomplete ${bareX.text}`);
}
const xSource = structuredClone(followedMemo);
xSource.publishing.xPost.videoUrl = 'https://youtube.com/shorts/dQw4w9WgXcQ';
xSource.publishing.xPost.videoUrlEdited = true;
const xCopy = copyForJob(xSource, xJob, '20261010_Ascent_A_Phoenix_lineup_x_v1', '');
if (xCopy.text.includes('クローズドβ') || xCopy.text.includes('#valorantshorts')) fail('x copy used the youtube description');
if (!xCopy.text.startsWith('【Ascent A / Phoenix / Defender】')) fail(`x heading ${xCopy.text}`);
if (!xCopy.text.includes('試合用画像 / Lineup') || !xCopy.text.includes('投げ方動画 / Watch')) fail('x template');
if (!xCopy.text.endsWith('#VAROLANT #定点')) fail('x hashtags');
if (!xCopy.text.includes('https://youtube.com/shorts/dQw4w9WgXcQ')) fail('x video url');
if (!xCopy.text.includes('gg.clutchvault.app/lineups/phoenix')) fail(`x spot ${xCopy.text}`);
if (!xCopy.text.includes('note=1')) fail('x dropped the memo query');
if (/utm_/i.test(xCopy.text)) fail(`x post kept utm ${xCopy.text}`);
const thumbOnly = jobsForPresets([], ['ja']);
if (thumbOnly.length !== 1 || thumbOnly[0]?.video || thumbOnly[0]?.finishedCard || !thumbOnly[0]?.thumbnail) {
  fail('thumbnail-only job');
}
const thumbWithVideo = jobsForPresets(['tt-jp'], ['ja']);
if (thumbWithVideo.length !== 1 || !thumbWithVideo[0]?.video || !thumbWithVideo[0]?.thumbnail) {
  fail('thumbnail stays on the video job');
}
const thumbAndX = jobsForPresets(['x-jp'], ['en']);
if (thumbAndX.length !== 2 || !thumbAndX.some((job) => job.slot === 'en' && job.thumbnail && !job.video)) {
  fail('thumbnail can export beside x');
}

const normalized = normalizePublishingDraft(created, {
  title: { ja: 'あ #VALORANT', en: 'Use [THIS] {br} now #valorant', ko: '' },
  description: {
    ja: '説明\n定点は ClutchVault に保存できます（開発者です）',
    en: 'Lineup\nSave it on ClutchVault',
    ko: '',
  },
  hashtags: { ja: '#定点', en: '', ko: '' },
});
if (/[#\[\]]|\{br\}/.test(normalized.title.en)) fail(`normalized title ${normalized.title.en}`);
if (!normalized.hashtags.en.includes('#valorant')) fail('hashtag was not moved');
if (!normalized.description.en.toLowerCase().includes('closed beta')) fail('normalized beta');
if (/Save it on ClutchVault/i.test(normalized.description.en)) fail('normalized save claim');

const checked = followPublishing(structuredClone(published));
checked.guide.exportPresets = ['yt-global'];
checked.publishing.links = { 'yt-global': enCopy.links['yt-global'] ?? '' };
const synced = followPublishing(checked);
const checks = precheckAuto(synced, {
  exportFresh: true,
  filesPresent: true,
  fileDetail: '',
  licenseOk: true,
  licenseDetail: '',
});
if (!checks.find((item) => item.key === 'utm-ready')?.ok) {
  fail(checks.find((item) => item.key === 'utm-ready')?.detail ?? 'utm check');
}
if (!checks.find((item) => item.key === 'title-markup')?.ok) fail('markup check');
synced.publishing.title.en = 'Hello #valorant';
const warned = precheckAuto(synced, {
  exportFresh: true,
  filesPresent: true,
  fileDetail: '',
  licenseOk: true,
  licenseDetail: '',
});
if (warned.some((item) => item.key === 'title-hashtag')) fail('title hashtag check should be gone');
if (titleIssues('Hello #valorant').some((item) => item.text.includes('ハッシュタグ'))) {
  fail('title hashtag warning should be gone');
}
const translationSource = followPublishing(createDefaultProject('tr', '2026-01-01T00:00:00.000Z'));
translationSource.publishing.title.en = 'Free kills #VALORANT';
translationSource.publishing.description.en = published.publishing.description.en;
const translated = applyPublishingTranslation(
  translationSource,
  {
    title: { ja: '無料キル', ko: '무료 킬' },
    description: { ja: 'アセントの定点です。', ko: '어센트 라인업입니다.' },
  },
  { fields: ['title', 'description'] },
);
if (translated.skipped.length !== 0) fail('first translation should fill template text');
if (!translated.project.publishing.title.ja.includes('#VALORANT')) fail('ja title dropped a hashtag');
if (!translated.project.publishing.title.ko?.includes('#VALORANT')) fail('ko title dropped a hashtag');
if (
  !translated.project.publishing.description.ja.includes(
    'ClutchVaultの開発者本人が投稿しています。\n\n#valorantshorts',
  )
) {
  fail('ja credit missing');
}
if (!translated.project.publishing.description.ko?.includes('utm_source=')) fail('ko description dropped the url');
if (!translated.project.guide.publishingEdited.title?.ja) fail('translated title should stay hand-owned');
const hand = structuredClone(translated.project);
hand.publishing.title.ja = '手で直した';
const keptTranslation = applyPublishingTranslation(hand, { title: { ja: '新しい訳', ko: '새 번역' } }, { fields: ['title'] });
if (keptTranslation.project.publishing.title.ja !== '手で直した') fail('hand edited title was overwritten');
if (!keptTranslation.skipped.some((item) => item.field === 'title' && item.language === 'ja')) fail('ja title should be skipped');
if (keptTranslation.project.publishing.title.ko !== '새 번역 #VALORANT') {
  fail(`ko title should update ${keptTranslation.project.publishing.title.ko}`);
}
const forced = applyPublishingTranslation(
  keptTranslation.project,
  { title: { ja: '新しい訳', ko: '새 번역' } },
  { fields: ['title'], force: true },
);
if (forced.project.publishing.title.ja !== '新しい訳 #VALORANT') fail('force should overwrite the hand edit');
const suffixed = structuredClone(forced.project);
suffixed.publishing.title.en = 'Free kills | Ascent A Phoenix Lineup';
const withSuffix = applyPublishingTranslation(
  suffixed,
  { title: { ja: '無料キル | 訳した末尾', ko: '무료 킬 | 끝' } },
  { fields: ['title'], force: true },
);
if (withSuffix.project.publishing.title.en !== 'Free kills | Ascent A Phoenix Lineup') {
  fail('english title suffix was rewritten');
}
const jaTitle = composePublishingTitle(suffixed, 'ja', '無料キル');
const koTitle = composePublishingTitle(suffixed, 'ko', '무료 킬');
if (withSuffix.project.publishing.title.ja !== jaTitle) {
  fail(`ja title suffix ${withSuffix.project.publishing.title.ja}`);
}
if (withSuffix.project.publishing.title.ko !== koTitle) {
  fail(`ko title suffix ${withSuffix.project.publishing.title.ko}`);
}
const leadTitle = composePublishingTitle(created, 'en', 'Free kills | ignore this tail');
if (leadTitle !== 'Free kills | Ascent A Phoenix Lineup #valorant') fail(`english lead title ${leadTitle}`);
const staleProject = structuredClone(forced.project);
staleProject.publishing.title.en = 'Changed hook';
if (!publishingTranslationStale(staleProject, 'title', 'ja')) fail('english change should mark the translation stale');
const withoutYoutube = structuredClone(translated.project);
withoutYoutube.guide.exportPresets = ['tt-jp'];
if (!publishingShowsKorean(withoutYoutube)) fail('korean copy should stay visible after youtube is turned off');
if (!publishingTranslationLanguages(withoutYoutube).includes('ko')) fail('korean translation target was dropped');
const japaneseOnly = followPublishing(createDefaultProject('ja-only', '2026-01-01T00:00:00.000Z'));
japaneseOnly.guide.exportPresets = ['tt-jp'];
japaneseOnly.publishing.title.ko = undefined;
japaneseOnly.publishing.description.ko = undefined;
japaneseOnly.publishing.hashtags.ko = undefined;
if (publishingShowsKorean(japaneseOnly)) fail('japanese-only project should not grow a korean column');

created.posts = [
  {
    id: 'p',
    platform: 'youtube',
    lang: 'en',
    url: 'https://youtu.be/abc',
    postedAt: '2026-10-01T00:00:00.000Z',
    preset: 'yt-global',
    metrics: { capturedAt: '2026-10-08T00:00:00.000Z', views: 10, cvSaves: 2 },
  },
];
created.experiment.hypothesis = 'Summit は伸びやすい';
const csv = postsToCsv([created], new Date('2026-10-10T00:00:00.000Z'));
if (!csv.startsWith('\uFEFF')) fail('csv missing BOM');
if (!csv.includes('yt-global') || !csv.includes('Summit は伸びやすい') || !csv.includes('結果型')) {
  fail('csv columns missing');
}

const legacyStill = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  stills: [{ id: 's', assetId: 'a', frame: 1, role: 'aim', path: 'stills/s.png' }],
});
if (legacyStill.stills[0]?.focus !== undefined) fail('legacy still should stay centered without a focus field');
if (stillObjectPosition(legacyStill.stills[0]) !== '50% 50%') fail('missing focus should be the center');
const keptFocus = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  stills: [{ id: 's', assetId: 'a', frame: 1, role: 'aim', path: 'stills/s.png', focus: { x: 0.2, y: 0.8 } }],
});
if (keptFocus.stills[0]?.focus?.x !== 0.2 || keptFocus.stills[0]?.focus?.y !== 0.8) fail('still focus was dropped');
if (stillObjectPosition(keptFocus.stills[0]) !== '20% 80%') fail(`object position ${stillObjectPosition(keptFocus.stills[0])}`);
const pannedX = panStillFocus({ x: 0.5, y: 0.5 }, 10, 40, { width: 100, height: 100 }, 2);
if (Math.abs(pannedX.x - 0.4) > 1e-9 || pannedX.y !== 0.5) fail(`pan x ${pannedX.x},${pannedX.y}`);
const pannedY = panStillFocus({ x: 0.5, y: 0.5 }, 30, -20, { width: 200, height: 50 }, 16 / 9);
if (pannedY.x !== 0.5 || Math.abs(pannedY.y - 0.82) > 1e-9) fail(`pan y ${pannedY.x},${pannedY.y}`);
if (normalizedStillFocus({ x: 0.5, y: 0.5 }) !== undefined) fail('center focus should be omitted');
const stackAxes = stillFocusAxes('stack', 'aim', 16 / 9);
if (stackAxes.x || !stackAxes.y) fail(`stack aim axes ${stackAxes.x},${stackAxes.y}`);
const aimAxes = stillFocusAxes('aim', 'aim', 16 / 9);
if (!aimAxes.x || aimAxes.y) fail(`aim axes ${aimAxes.x},${aimAxes.y}`);
const sidePreview = stillPreviewFrame('aim', 'stand');
const sideX = cardStillFrames('aim', 'stand').xCard;
if (sidePreview.width !== sideX.width || !sidePreview.matchesX) fail('stand preview should use the wider X crop');
const stackPreview = stillPreviewFrame('stack', 'stand');
if (stackPreview.matchesX) fail('stack preview should use the card crop');

const retiredGuide = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  templateId: 't-guide',
  timelineEdited: true,
  timeline: {
    durationSec: 24,
    items: [
      {
        id: 'guide-hook',
        sceneKey: 'hook',
        presentation: 'guide-title',
        start: 0,
        duration: 2.5,
      },
    ],
    volumePoints: [],
    effects: [],
  },
});
if (retiredGuide.templateId !== 't-std') fail(`t-guide should become t-std, got ${retiredGuide.templateId}`);
if (retiredGuide.timelineEdited) fail('retired t-guide should rebuild the T-STD timeline');
if (retiredGuide.timeline !== null) fail('retired t-guide timeline should be cleared');

console.log('schema migration ok');
