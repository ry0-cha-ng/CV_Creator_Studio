import { applyInheritance, exportContentStamp } from '../shared/guide';
import { captionTextFor, createDefaultProject, parseProject } from '../shared/schema/project';
import {
  fitFocusHook,
  resolveThumbCrop,
  thumbnailLayoutOf,
  THUMB_FOCUS,
} from '../shared/thumbnail-focus';
import {
  abilityAbbreviation,
  fitThumbnailHookFontSize,
  fitThumbnailLabel,
  hookFrameRequest,
  thumbnailFrameStatus,
  thumbnailHookLayout,
  thumbnailHookLines,
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
if (thumbnailHookLines('1行目\n2行目\n3行目').join('|') !== '1行目|2行目|3行目') {
  fail('thumbnail hook keeps 3 explicit lines');
}
if (thumbnailHookLines('1\n2\n3\n4').length !== 3) fail('thumbnail hook drops a 4th line');
const threeLines = thumbnailHookLayout('1行目\n2行目\n3行目');
const twoLines = thumbnailHookLayout('1行目\n2行目');
if (threeLines.maxLines !== 3 || THUMBNAIL.hookMaxLines !== 3) fail('thumbnail hook allows 3 lines');
if (threeLines.maxHeight !== Math.ceil(THUMBNAIL.hookFontSize * THUMBNAIL.hookLineHeight * 3)) {
  fail(`3-line box ${threeLines.maxHeight}`);
}
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

const fresh = parseProject(JSON.parse(JSON.stringify(createDefaultProject('fresh-focus'))));
if (fresh.thumbnail?.layout !== 'focus') fail('new projects start on focus');

const withoutThumb = JSON.parse(JSON.stringify(createDefaultProject('no-thumb'))) as Record<string, unknown>;
delete withoutThumb.thumbnail;
const classicRead = parseProject(withoutThumb);
if (classicRead.thumbnail) fail('missing thumbnail stays absent');
if (thumbnailLayoutOf(classicRead) !== 'classic') fail('missing thumbnail reads as classic');

const broken = parseProject({
  ...withoutThumb,
  id: 'broken-thumb',
  thumbnail: { layout: 'sideways', zoom: 2, focus: { x: -1, y: 4 } },
});
if (broken.thumbnail?.layout !== 'classic') fail(`bad layout ${broken.thumbnail?.layout}`);
if (broken.thumbnail?.zoom !== 1.5) fail(`zoom clamp ${broken.thumbnail?.zoom}`);
if (broken.thumbnail?.focus?.x !== 0 || broken.thumbnail?.focus?.y !== 1) {
  fail(`focus clamp ${JSON.stringify(broken.thumbnail?.focus)}`);
}
const dropped = parseProject({ ...withoutThumb, id: 'dropped-thumb', thumbnail: 'nope' });
if (dropped.thumbnail) fail('garbage thumbnail should be dropped');
const lowZoom = parseProject({
  ...withoutThumb,
  id: 'low-zoom',
  thumbnail: { layout: 'focus', zoom: 0.8, focus: { x: 0.2, y: 'nope' } },
});
if (lowZoom.thumbnail?.layout !== 'focus' || lowZoom.thumbnail.zoom !== 1 || lowZoom.thumbnail.focus) {
  fail(`low zoom ${JSON.stringify(lowZoom.thumbnail)}`);
}

const center = resolveThumbCrop({ w: 1920, h: 1080 }, { x: 0.5, y: 0.5 }, 1);
if (Math.abs(center.h - 1080) > 1e-6) fail(`center height ${center.h}`);
if (Math.abs(center.w - (1080 * 1080) / 1130) > 1e-6) fail(`center width ${center.w}`);
if (Math.abs(center.x - (1920 - center.w) / 2) > 1e-6 || center.y !== 0) fail(`center origin ${center.x},${center.y}`);
const corner = resolveThumbCrop({ w: 1920, h: 1080 }, { x: 0, y: 0 }, 1);
const far = resolveThumbCrop({ w: 1920, h: 1080 }, { x: 1, y: 1 }, 1);
if (corner.x < 0 || corner.y < 0 || far.x + far.w > 1920 + 1e-6 || far.y + far.h > 1080 + 1e-6) {
  fail('crop left the frame');
}
const zoomed = resolveThumbCrop({ w: 1920, h: 1080 }, { x: 0.5, y: 0.5 }, 1.5);
if (Math.abs(zoomed.h - 720) > 1e-6 || Math.abs(zoomed.upscale - 1130 / 720) > 1e-6) {
  fail(`zoom 1.5 ${zoomed.h} ${zoomed.upscale}`);
}
const clampedLow = resolveThumbCrop({ w: 1920, h: 1080 }, { x: 0.5, y: 0.5 }, 0.8);
const clampedHigh = resolveThumbCrop({ w: 1920, h: 1080 }, { x: 0.5, y: 0.5 }, 2);
if (Math.abs(clampedLow.h - 1080) > 1e-6 || Math.abs(clampedHigh.h - 720) > 1e-6) fail('zoom clamp');
const soft = resolveThumbCrop({ w: 1280, h: 720 }, { x: 0.5, y: 0.5 }, 1.5);
if (soft.upscale <= THUMB_FOCUS.zoom.warnUpscale) fail(`720p upscale ${soft.upscale}`);
const sample = resolveThumbCrop({ w: 1920, h: 1080 }, { x: 0.57, y: 0.5 }, 1);
if (Math.round(sample.x) !== 578 || sample.y !== 0 || Math.round(sample.w) !== 1032 || sample.h !== 1080) {
  fail(`sample crop ${JSON.stringify(sample)}`);
}

if (THUMB_FOCUS.hook.maxLines !== 3) fail('focus hook allows 3 lines');
const fitted = fitFocusHook('Flush them out before the retake', 'en');
if (fitted.warning || fitted.lines.length !== 3 || fitted.fontSize !== 96) {
  fail(`english fit ${fitted.fontSize} ${fitted.lines.length} ${fitted.warning}`);
}
const overflowing = fitFocusHook(`${'BURN THE SITE FROM THIS LINEUP '.repeat(8)}NOW`, 'en');
if (!overflowing.warning || overflowing.fontSize !== 76 || overflowing.lines.length !== 3) {
  fail(`overflow ${overflowing.fontSize} ${overflowing.lines.length} ${overflowing.warning}`);
}
const explicit = fitFocusHook("See them?\nBurn it.", 'en');
const explicitText = explicit.lines.map((line) => line.map((run) => run.text).join(''));
if (explicitText[0] !== 'SEE THEM?' || explicitText[1] !== 'BURN IT.') {
  fail(`explicit breaks ${explicitText.join('|')}`);
}
const threeFocus = fitFocusHook("See them?\nBurn it.\nTake site.", 'en');
if (threeFocus.warning || threeFocus.lines.length !== 3) {
  fail(`3 explicit lines ${threeFocus.lines.length} ${threeFocus.warning}`);
}
const focusBottom =
  THUMB_FOCUS.hook.top + threeFocus.fontSize * THUMB_FOCUS.hook.en.lineHeight * threeFocus.lines.length;
if (focusBottom > THUMB_FOCUS.infoBar.y) {
  fail(`3-line focus hook overlaps the info bar ${focusBottom}`);
}
const fourFocus = fitFocusHook("One\nTwo\nThree\nFour", 'en');
if (!fourFocus.warning || fourFocus.lines.length !== 3) {
  fail(`a 4th line stays inside the 3-line box ${fourFocus.lines.length} ${fourFocus.warning}`);
}

const source = createDefaultProject('inherit-source');
source.thumbnail = { layout: 'focus', zoom: 1.3, focus: { x: 0.2, y: 0.8 }, frame: { assetId: 'a', timeSec: 3 } };
const inherited = applyInheritance(createDefaultProject('inherit-child'), source, ['thumbnail']);
if (inherited.thumbnail?.layout !== 'focus' || inherited.thumbnail.zoom !== 1.3) fail('inherit layout and zoom');
if (inherited.thumbnail.frame || inherited.thumbnail.focus) fail('frame and focus stay behind');
if (!inherited.inheritedFrom?.items.includes('thumbnail')) fail('thumbnail is recorded as inherited');

console.log('thumbnail checks ok');
