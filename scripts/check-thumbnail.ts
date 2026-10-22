import { exportContentStamp } from '../shared/guide';
import { captionTextFor, createDefaultProject, parseProject } from '../shared/schema/project';
import {
  abilityAbbreviation,
  fitThumbnailHookFontSize,
  fitThumbnailLabel,
  hookFrameRequest,
  thumbnailFrameStatus,
  thumbnailHookLayout,
  thumbnailIconWarning,
  thumbnailMapLabel,
  thumbnailSourceAt,
  THUMBNAIL,
} from '../shared/thumbnail';

const fail = (message: string): never => {
  throw new Error(message);
};

if (abilityAbbreviation('Hot Hands') !== 'HH') fail('hot hands');
if (abilityAbbreviation('Curveball') !== 'CU') fail('curveball');
if (abilityAbbreviation('Run it Back') !== 'RIB') fail('run it back');
if (abilityAbbreviation('  ') !== '?') fail('empty ability');
if (thumbnailMapLabel('Haven', 'C') !== 'HAVEN C') fail('map label');

const shortLabel = fitThumbnailLabel('HAVEN C');
if (shortLabel.fontSize !== THUMBNAIL.labelMax || shortLabel.text !== 'HAVEN C') {
  fail(`short label ${shortLabel.fontSize} ${shortLabel.text}`);
}
const fracture = fitThumbnailLabel('FRACTURE C');
if (fracture.fontSize !== THUMBNAIL.labelMax || fracture.text !== 'FRACTURE C') {
  fail(`fracture label ${fracture.fontSize} ${fracture.text}`);
}
const longLabel = fitThumbnailLabel('W'.repeat(40));
if (longLabel.fontSize !== THUMBNAIL.labelMin || !longLabel.text.endsWith('…') || longLabel.text.length >= 40) {
  fail(`long label ${longLabel.fontSize} ${longLabel.text}`);
}

const project = createDefaultProject('thumb-check');
const hook = project.captions.find((caption) => caption.id === 'hook');
if (!hook) fail('hook caption missing');
if (captionTextFor(hook, 'ja', 'thumb') !== hook.text.ja) fail('thumbnail follows the video caption');
hook.thumbText = { ja: '1行目\n2行目', en: '' };
if (captionTextFor(hook, 'ja', 'thumb') !== '1行目\n2行目') fail('thumbnail uses its own breaks');
if (captionTextFor(hook, 'en', 'thumb') !== hook.text.en) fail('empty thumbnail text follows the video');
if (captionTextFor(hook, 'ja', 'video') !== hook.text.ja) fail('video caption stays independent');
const threeLines = thumbnailHookLayout('1行目\n2行目\n3行目');
const twoLines = thumbnailHookLayout('1行目\n2行目');
if (threeLines.maxLines !== 3 || THUMBNAIL.hookMaxLines !== 3) fail('thumbnail hook allows 3 lines');
if (threeLines.top !== THUMBNAIL.hookTop || twoLines.top !== THUMBNAIL.hookTop) {
  fail(`headline should stay at ${THUMBNAIL.hookTop}, got ${threeLines.top}/${twoLines.top}`);
}
if (threeLines.top + threeLines.maxHeight > THUMBNAIL.footageTop - THUMBNAIL.hookClearance) {
  fail('3-line hook overlaps the footage window');
}
if (THUMBNAIL.footageTop + THUMBNAIL.footageHeight !== THUMBNAIL.badgeTop) {
  fail('footage window should meet the identity band');
}
if (fitThumbnailHookFontSize('FLUSH THEM OUT') !== THUMBNAIL.hookFontSize) {
  fail('short headline stays at the design size');
}
if (fitThumbnailHookFontSize('PHOENIX LINEUPS = FREE KILLS') !== THUMBNAIL.hookFontSize) {
  fail('a long english line keeps the design size');
}
const jaHookSize = fitThumbnailHookFontSize('アセントAサイトリテイクは、\n[これ1個]でいい');
if (jaHookSize >= THUMBNAIL.hookFontSize || jaHookSize > 72) {
  fail(`japanese hook should shrink to keep its line breaks, got ${jaHookSize}`);
}
const fourLines = thumbnailHookLayout('1\n2\n3\n4');
if (fourLines.maxLines !== 3 || fourLines.top !== threeLines.top) fail('a 4th line stays inside the 3-line box');
if (thumbnailIconWarning(project)) fail('phoenix curveball should have icons');
if (hookFrameRequest(project)) fail('default project has no hook clip');

const missing = structuredClone(project);
missing.lineup.agent = 'Not An Agent';
missing.lineup.ability = 'Not An Ability';
const warning = thumbnailIconWarning(missing);
if (!warning?.includes('エージェント') || !warning.includes('スキル')) fail(`warning ${warning}`);

const filmed = createDefaultProject('thumb-frame');
filmed.templateParams.fps = 30;
filmed.assets.push({
  id: 'asset-1',
  type: 'video',
  path: 'media/hook.mp4',
  meta: { duration: 20 },
  loudnessEnvelope: [],
  tags: [],
});
filmed.clips.push({ id: 'clip-1', assetId: 'asset-1', in: 4, out: 12 });
const hookScene = filmed.scenes.find((scene) => scene.sceneKey === 'hook');
if (!hookScene) fail('hook scene missing');
hookScene.clipId = 'clip-1';
const start = hookFrameRequest(filmed);
if (!start || start.kind !== 'video' || Math.abs(start.sourceTime - 4) > 1e-6) fail(`hook start ${JSON.stringify(start)}`);
const atOne = thumbnailSourceAt(filmed, 1);
if (!atOne || Math.abs(atOne.sourceTime - 5) > 0.05) fail(`source at 1s ${atOne?.sourceTime}`);
const cardAt = thumbnailSourceAt(filmed, 12.2);
if (cardAt) fail('card scene has no source footage');
if (exportContentStamp(filmed).includes('thumbnailFrame')) fail('unset frame stays out of the export stamp');
filmed.thumbnailFrame = { assetId: 'asset-1', sourceTime: 7.5 };
const custom = hookFrameRequest(filmed);
if (!custom || custom.kind !== 'video' || custom.sourceTime !== 7.5 || custom.assetPath !== 'media/hook.mp4') {
  fail(`custom frame ${JSON.stringify(custom)}`);
}
if (!thumbnailFrameStatus(filmed).includes('指定した位置')) fail(`status ${thumbnailFrameStatus(filmed)}`);
if (!exportContentStamp(filmed).includes('"thumbnailFrame"')) fail('custom frame changes the export stamp');
filmed.thumbnailFrame = { assetId: 'missing', sourceTime: 1 };
const fallback = hookFrameRequest(filmed);
if (!fallback || fallback.kind !== 'video' || Math.abs(fallback.sourceTime - 4) > 1e-6) fail('missing asset falls back to the hook');
if (!thumbnailFrameStatus(filmed).includes('フックの先頭')) fail(`missing status ${thumbnailFrameStatus(filmed)}`);

const round = parseProject({
  ...JSON.parse(JSON.stringify(createDefaultProject('round'))),
  thumbnailFrame: { assetId: 'a', sourceTime: 1.25 },
});
if (round.thumbnailFrame?.assetId !== 'a' || round.thumbnailFrame.sourceTime !== 1.25) fail('thumbnail frame roundtrip');
const legacy = parseProject(JSON.parse(JSON.stringify(createDefaultProject('legacy'))));
if (legacy.thumbnailFrame) fail('legacy projects stay on the hook frame');

console.log('thumbnail checks ok');
