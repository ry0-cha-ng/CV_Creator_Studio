import {
  aimZoomBox,
  aimZoomCenter,
  aimZoomMetadata,
  aimZoomOverlapWarning,
  cardAimPoint,
  resolveAimZoom,
  resolveVideoAimZoom,
  defaultSceneAimZoom,
  nudgeCardAimPoint,
} from '../shared/aim-zoom';
import { markerNormalizedFromPixel, markerPixel } from '../shared/aim-marker';
import { applyInheritance } from '../shared/guide';
import { createDefaultProject, parseProject, type CardAimZoom } from '../shared/schema/project';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const zoom = (patch: Partial<CardAimZoom> = {}): CardAimZoom => ({
  enabled: true,
  style: 'corner',
  position: 'auto',
  zoom: 4,
  guide: true,
  ...patch,
});

const created = createDefaultProject('zoom', '2026-10-05T00:00:00.000Z');
if (!created.cardAimZoom?.enabled) fail('new projects should start with aim zoom on');
const meta = aimZoomMetadata(created);
if (!meta.enabled || meta.size !== 'l' || meta.zoom !== 4 || meta.style !== 'corner') {
  fail(`default meta ${JSON.stringify(meta)}`);
}
if (meta.enabled && meta.position === 'auto') fail('meta position should be resolved');

const raw = JSON.parse(JSON.stringify(created)) as Record<string, unknown>;
delete raw.cardAimZoom;
const legacy = parseProject(raw);
if (legacy.cardAimZoom) fail('missing cardAimZoom should stay missing');
if (aimZoomMetadata(legacy).enabled) fail('legacy export must stay off');

const stack = aimZoomBox('card-stack', 'ja');
const nearTopLeft = resolveAimZoom(stack, zoom(), { x: 0.15, y: 0.2 }, 'card-stack');
if (nearTopLeft.position === 'tl') fail(`auto placed on the near corner ${nearTopLeft.position}`);
if (nearTopLeft.overlapsCenter) fail('auto window overlaps the center');
const belowLabel = resolveAimZoom(stack, zoom({ position: 'tl' }), { x: 0.8, y: 0.8 }, 'card-stack');
if (belowLabel.window.y < stack.labelHeight - 0.5) fail('top-left window must clear the step label');

const manual = resolveAimZoom(
  stack,
  zoom({ position: 'tl' }),
  { x: 0.12, y: 0.28 },
  'card-stack',
);
if (!manual.overlapsCenter) fail('manual overlap should be detected');
const project = {
  ...created,
  cardAimZoom: zoom({ position: 'tl', center: { x: 0.12, y: 0.28 } }),
};
if (!aimZoomOverlapWarning(project)) fail('review warning missing');
if (aimZoomOverlapWarning({ ...project, cardAimZoom: zoom({ position: 'auto' }) })) {
  fail('auto placement should not warn');
}

const narrow = resolveAimZoom(
  aimZoomBox('card-aim', 'ja'),
  zoom({ style: 'split', position: 'left' }),
  { x: 0.5, y: 0.5 },
  'card-aim',
);
if (narrow.style !== 'corner') fail('narrow frames should fall back to corner');

const wide = resolveAimZoom(stack, zoom({ style: 'split', position: 'left' }), { x: 0.4, y: 0.5 }, 'card-stack');
if (wide.style !== 'split' || wide.position !== 'left' || wide.guideLine) fail('split should drop the guide line');
if (!wide.split || wide.split.panelSize !== stack.height) fail('split panel should match the frame height');

const loupe = resolveAimZoom(stack, zoom({ style: 'loupe', guide: true }), { x: 0.5, y: 0.5 }, 'card-stack');
if (!loupe.guideLine) fail('guide line missing');

const videoLinked = {
  ...created,
  scenes: created.scenes.map((scene) =>
    scene.sceneKey === 'aim' ? { ...scene, aimMarker: { enabled: true, x: 0.2, y: 0.3, size: 1, at: 0 } } : scene,
  ),
};
const followed = cardAimPoint(videoLinked);
if (!followed || followed.x !== 0.2 || followed.y !== 0.3) fail('card ring should follow the video until placed');
if (aimZoomCenter(videoLinked).x !== 0.2) fail('zoom should follow the video until the card is placed');
const placed = { ...videoLinked, cardAimMarker: { x: 0.66, y: 0.4 } };
const cardPoint = cardAimPoint(placed);
if (!cardPoint || cardPoint.x !== 0.66 || cardPoint.y !== 0.4) fail('card ring should use its own point');
if (aimZoomCenter(placed).y !== 0.4) fail('zoom center should stay on the card ring');
const legacyCenter = { ...videoLinked, cardAimZoom: zoom({ center: { x: 0.7, y: 0.25 } }) };
if (cardAimPoint(legacyCenter)?.x !== 0.7) fail('legacy zoom center should move the card ring');

const xBox = aimZoomBox('x-stack', 'en');
if (xBox.width < xBox.height * 2.5) fail('x stack frame should allow split');

const inherited = applyInheritance(
  createDefaultProject('next', '2026-10-05T00:00:00.000Z'),
  {
    ...created,
    cardAimZoom: zoom({ position: 'br', center: { x: 0.2, y: 0.2 }, note: { ja: '角', en: 'corner' } }),
  },
  ['cardAimZoom'],
);
if (inherited.cardAimZoom?.center || inherited.cardAimZoom?.note) fail('inherit must drop center and note');
if (inherited.cardAimZoom?.position !== 'br') fail('inherit should keep placement');
const emphasized = applyInheritance(
  createDefaultProject('next-style', '2026-10-05T00:00:00.000Z'),
  { ...created, annotationStyle: 'strong' },
  ['cardAimZoom'],
);
if (emphasized.annotationStyle !== 'strong') fail('inherit should keep annotation style');

const placedBefore = resolveAimZoom(stack, zoom(), { x: 0.42, y: 0.58 }, 'card-stack');
const placedAfter = resolveAimZoom(stack, zoom(), { x: 0.42, y: 0.58 }, 'card-stack', 14);
if (
  placedBefore.source.x !== placedAfter.source.x ||
  placedBefore.source.y !== placedAfter.source.y ||
  placedBefore.source.size !== placedAfter.source.size ||
  placedBefore.zoom !== placedAfter.zoom
) {
  fail('zoom chrome must not move the crop or the zoom level');
}
if (placedBefore.window.x === placedAfter.window.x && placedBefore.window.y === placedAfter.window.y) {
  fail('zoom chrome should move the image inward');
}

const nudged = nudgeCardAimPoint({ x: 0.5, y: 0.5 }, { x: 1, y: 0 }, { width: 840, height: 520 }, 1);
if (Math.abs(nudged.x - (0.5 + 1 / 840)) > 1e-9 || nudged.y !== 0.5) fail('arrow nudge should move one frame pixel');
const shifted = nudgeCardAimPoint({ x: 0.5, y: 0.2 }, { x: 0, y: -1 }, { width: 840, height: 520 }, 10);
if (Math.abs(shifted.y - (0.2 - 10 / 520)) > 1e-9) fail('shift nudge should move ten frame pixels');
const pinned = nudgeCardAimPoint({ x: 0.999, y: 0 }, { x: 1, y: -1 }, { width: 100, height: 100 }, 10);
if (pinned.x !== 1 || pinned.y !== 0) fail('nudge should stay inside the frame');

const videoDefault = defaultSceneAimZoom({ x: 0.5, y: 0.5 });
const videoLayout = resolveVideoAimZoom(videoDefault, { x: 0.5, y: 0.5 }, 0);
const mediumSide = 1080 * 0.333;
if (Math.abs(videoLayout.window.size - mediumSide) > 1e-6) fail('video zoom medium side should be 33.3% of the frame width');
if (videoLayout.window.y > 400) fail('a centered aim should place the window in the upper half');
if (videoLayout.overlapsCenter) fail('the default window should stay off the aim point');
const aimX = 0.5 * 1080;
const aimY = 0.5 * 1920;
if (Math.abs(videoLayout.source.x + videoLayout.source.size / 2 - aimX) > 1e-6) fail('video crop should stay centered on the aim x');
if (Math.abs(videoLayout.source.y + videoLayout.source.size / 2 - aimY) > 1e-6) fail('video crop should stay centered on the aim y');
if (Math.abs(videoLayout.source.size - mediumSide / 4) > 1e-6) fail('video crop side should be the window divided by the zoom');
if (videoLayout.connectors.length !== 2) fail('a separated video window should draw two connectors');

const stored = resolveVideoAimZoom({ ...videoDefault, x: 0.2, y: 0.1 }, { x: 0.5, y: 0.5 }, 0);
if (Math.abs(stored.window.x - 0.2 * 1080) > 1e-6 || Math.abs(stored.window.y - 0.1 * 1920) > 1e-6) {
  fail('video window origin should follow the stored top-left when chrome is zero');
}
const inset = resolveVideoAimZoom({ ...videoDefault, x: 0, y: 0 }, { x: 0.5, y: 0.5 }, 14);
if (inset.window.x < 14 || inset.window.y < 14) fail('video chrome should stay inside the frame');
const covered = resolveVideoAimZoom(
  { enabled: true, zoom: 4, size: 'l', x: 0.2, y: 0.35, guide: true },
  { x: 0.4, y: 0.5 },
  0,
);
if (!covered.overlapsCenter || covered.connectors.length !== 0) fail('a window over the aim point should drop the connectors');
const quiet = resolveVideoAimZoom({ ...videoDefault, guide: false }, { x: 0.5, y: 0.5 }, 0);
if (quiet.connectors.length !== 0) fail('video guide off should draw no connectors');

if (markerPixel(0.5, 'x') !== 540 || markerPixel(0.5, 'y') !== 960) fail('marker pixels should use the 1080x1920 frame');
if (markerNormalizedFromPixel(1080, 'x') !== 1 || markerNormalizedFromPixel(0, 'y') !== 0) {
  fail('marker pixels should reach the frame edges');
}
if (markerNormalizedFromPixel(1081, 'x') !== 1 || markerNormalizedFromPixel(-4, 'y') !== 0) {
  fail('marker pixels should stay inside the frame');
}
if (Math.abs(markerNormalizedFromPixel(1, 'x') - 1 / 1080) > 1e-12) fail('one pixel on X should be 1/1080');
if (Math.abs(markerNormalizedFromPixel(1, 'y') - 1 / 1920) > 1e-12) fail('one pixel on Y should be 1/1920');

const off = aimZoomMetadata({ ...created, cardAimZoom: zoom({ enabled: false }) });
if (off.enabled !== false || 'style' in off) fail('disabled meta should be enabled:false only');

console.log('aim zoom ok');
