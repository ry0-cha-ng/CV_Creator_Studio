import assert from 'node:assert/strict';
import { CTA_TEXT } from '../shared/delivery-presets';
import {
  assignClipsFromRoles,
  compositionBlocks,
  includeDemoFromMain,
  reviewItems,
  trimScenes,
} from '../shared/guide';
import {
  LIKE_CTA,
  S4_CTA,
  likeCtaActive,
  likeCtaRect,
  likeLineWidth,
  likeThumbMotion,
  likeWatermarkTop,
  resolveS4CtaPurpose,
  s4CtaHoldFrames,
  s4CtaOverlapDetail,
  s4CtaRect,
  s4CtaVisibleAtFrame,
  s4WatermarkTop,
  resolveCtaDesign,
  videoCtaRenders,
} from '../shared/s4-cta';
import { S7_FRAME } from '../shared/s7-cta';
import { createDefaultProject, parseProject } from '../shared/schema/project';
import { activeTimeline, applySceneOrder } from '../shared/timeline';
import {
  BUILTIN_VIDEO_STRUCTURE_TEMPLATES,
  DEFAULT_SCENE_ORDER,
  normalizeVideoStructureTemplates,
} from '../shared/video-structure';

const project = createDefaultProject('structure-check', '2026-10-14T00:00:00.000Z');
assert.deepEqual(
  activeTimeline(project).items.map((item) => item.sceneKey),
  DEFAULT_SCENE_ORDER.filter((sceneKey) => sceneKey !== 'demo'),
);

const analyticsPattern = BUILTIN_VIDEO_STRUCTURE_TEMPLATES.find(
  (template) => template.id === 'structure-card-early',
);
assert.ok(analyticsPattern);
assert.equal(analyticsPattern.ctaDesign, 's4-block');
assert.equal(
  BUILTIN_VIDEO_STRUCTURE_TEMPLATES.find((template) => template.id === 'structure-standard')?.ctaDesign,
  's7-band',
);

const reordered = applySceneOrder(project, analyticsPattern.sceneOrder, analyticsPattern.id);
assert.equal(reordered.timelineEdited, false);
assert.equal(reordered.timeline, null);
assert.equal(reordered.structureTemplateId, analyticsPattern.id);
assert.equal(reordered.templateParams.ctaDesign, 's4-block');
assert.equal(reordered.templateParams.s4CtaPurpose, 'like');
assert.equal(
  reordered.captions.find((caption) => caption.id === 'cta')?.text.ja,
  CTA_TEXT.ja,
);
assert.equal(
  reordered.captions.find((caption) => caption.id === 'cta')?.text.en,
  CTA_TEXT.en,
);
assert.match(
  reviewItems(reordered).find((item) => item.id === 'cta-duplicate')?.detail ?? '',
  /高評価CTA/,
);
const legacyShort = structuredClone(reordered);
delete legacyShort.templateParams.s4CtaPurpose;
assert.equal(resolveS4CtaPurpose(parseProject(legacyShort)), 'cv');
assert.equal(likeCtaActive(parseProject(legacyShort)), false);
assert.equal(
  reviewItems(parseProject(legacyShort)).find((item) => item.id === 'cta-duplicate')?.detail,
  '映像直下に1ブロックだけ表示します',
);
const reapplied = applySceneOrder(
  parseProject(legacyShort),
  analyticsPattern.sceneOrder,
  analyticsPattern.id,
);
assert.equal(reapplied.templateParams.s4CtaPurpose, undefined);
assert.match(
  reviewItems(project).find((item) => item.id === 'cta-duplicate')?.detail ?? '',
  /主CTAは1か所/,
);
const restored = applySceneOrder(reordered, [...DEFAULT_SCENE_ORDER], 'structure-standard');
assert.equal(restored.templateParams.ctaDesign, 's7-band');
const keptS7 = structuredClone(reordered);
delete (keptS7.templateParams as { ctaDesign?: string }).ctaDesign;
keptS7.structureTemplateId = 'structure-card-early';
assert.equal(resolveCtaDesign(parseProject(keptS7)), 's4-block');
assert.equal(resolveCtaDesign(project), 's7-band');
assert.equal(s4CtaRect().x, S4_CTA.left);
assert.equal(s4CtaRect().y, S7_FRAME.footageBottom + 24);
assert.equal(s4CtaRect().y, 1288);
assert.equal(s4CtaRect().width, 768);
assert.equal(s4CtaRect().height, 120);
assert.equal(s4WatermarkTop(), S7_FRAME.watermark.y);
assert.equal(LIKE_CTA.thumbFill, '#FFC83D');
assert.notEqual(LIKE_CTA.thumbFill, LIKE_CTA.line2Color);
assert.equal(likeCtaRect().x, 120);
assert.equal(likeCtaRect().y, 448);
assert.equal(likeCtaRect().width, LIKE_CTA.width);
assert.equal(likeCtaRect().height, 164);
assert.equal(likeCtaRect(700).y, 700 - 44 - 164);
assert.equal(likeWatermarkTop(), 1290);
assert.deepEqual(likeThumbMotion(0.15, true, 2), { dy: 0, scale: 1 });
assert.equal(likeThumbMotion(0.3, true, 2).dy, -8);
assert.equal(likeThumbMotion(0.3, true, 2).scale, 1.1);
assert.deepEqual(likeThumbMotion(0.5, true, 2), { dy: 0, scale: 1 });
assert.deepEqual(likeThumbMotion(0.3, false, 2), { dy: 0, scale: 1 });
assert.deepEqual(likeThumbMotion(0.3, true, 0.4), { dy: 0, scale: 1 });
assert.equal(likeCtaActive(reordered, 'youtube'), true);
assert.equal(likeCtaActive(reordered, 'tiktok'), false);
assert.ok(likeLineWidth('en', 'LIKE ', ' TO REVISIT.') <= LIKE_CTA.safeTextWidth);
assert.deepEqual(videoCtaRenders(['yt-global'], reordered), [{ platform: 'youtube', suffix: '' }]);
assert.deepEqual(videoCtaRenders(['tt-jp'], reordered), [{ platform: 'tiktok', suffix: '' }]);
assert.deepEqual(videoCtaRenders(['yt-ja', 'tt-jp'], reordered), [
  { platform: 'youtube', suffix: '' },
  { platform: 'tiktok', suffix: '_tt' },
]);
assert.deepEqual(videoCtaRenders(['yt-ja', 'tt-jp'], parseProject(legacyShort)), [
  { platform: 'youtube', suffix: '' },
]);
assert.equal(s4CtaOverlapDetail(), null);
assert.equal(s4CtaHoldFrames(30, 3), 60);
assert.equal(s4CtaHoldFrames(60, 3), 120);
assert.equal(s4CtaVisibleAtFrame(59, 60, 3), false);
assert.equal(s4CtaVisibleAtFrame(60, 60, 3), true);
assert.equal(s4CtaVisibleAtFrame(179, 60, 3), true);
assert.equal(s4CtaVisibleAtFrame(29, 30, 3), false);
assert.equal(s4CtaVisibleAtFrame(30, 30, 3), true);
assert.equal(s4CtaVisibleAtFrame(0, 60, 1.5), true);
assert.equal(s4CtaHoldFrames(60, 1.5), 90);
assert.equal(S7_FRAME.plateHeight, 170);
assert.equal(S7_FRAME.ctaTop, 1112);
assert.equal(S7_FRAME.lockupTop, 1308);
assert.deepEqual(
  activeTimeline(reordered).items.map((item) => item.sceneKey),
  ['hook', 'card', 'stand', 'aim', 'throw'],
);
assert.deepEqual(
  activeTimeline(reordered).items.map((item) => item.start),
  [0, 4, 6.5, 9.5, 13.5],
);
assert.deepEqual(trimScenes(reordered), ['hook', 'card', 'stand', 'aim', 'throw']);
assert.deepEqual(
  compositionBlocks(reordered).map((block) => block.sceneKey),
  ['hook', 'card', 'stand', 'aim', 'throw'],
);

assert.deepEqual(
  applySceneOrder(project, ['hook', 'hook', 'card']).templateParams.sceneOrder,
  ['hook', 'card'],
);

const legacy = structuredClone(project) as unknown as {
  templateParams: Record<string, unknown>;
};
delete legacy.templateParams.sceneOrder;
assert.deepEqual(parseProject(legacy).templateParams.sceneOrder, DEFAULT_SCENE_ORDER);

assert.deepEqual(
  normalizeVideoStructureTemplates([
    {
      id: 'custom',
      name: 'カード先出し',
      sceneOrder: ['hook', 'card', 'stand'],
      builtIn: false,
    },
  ]),
  [
    {
      id: 'custom',
      name: 'カード先出し',
      sceneOrder: ['hook', 'card', 'stand'],
      ctaDesign: 's7-band',
      builtIn: false,
    },
  ],
);
assert.deepEqual(
  normalizeVideoStructureTemplates([
    {
      id: 'duplicate',
      name: '重複',
      sceneOrder: ['hook', 'hook'],
      builtIn: false,
    },
  ]),
  [],
);

let demoProject = applySceneOrder(
  createDefaultProject('demo-insert', '2026-10-14T00:00:00.000Z'),
  ['hook', 'demo', 'card', 'stand'],
);
demoProject.assets = [
  {
    id: 'asset-main',
    type: 'video',
    path: 'main.mp4',
    meta: { duration: 30 },
    loudnessEnvelope: [],
    tags: [],
    role: 'main',
  },
];
demoProject = assignClipsFromRoles(demoProject);
demoProject.timeline = activeTimeline(demoProject);
demoProject.timelineEdited = true;
demoProject = includeDemoFromMain(demoProject);
assert.deepEqual(
  activeTimeline(demoProject).items.map((item) => item.sceneKey),
  ['hook', 'demo', 'card', 'stand'],
);

console.log('video structure checks passed');
