import assert from 'node:assert/strict';
import {
  cvSignatureTop,
  focusCropZoomOf,
  focusFootagePlacement,
  focusScreenPoint,
  LAYOUT_FOCUS,
  resolveFocusCrop,
  YT_SHORTS_UI_GUIDE,
  ytShortsPlayback,
  roundFocusZoom,
} from '../shared/layout-focus';
import { createDefaultProject, parseProject } from '../shared/schema/project';
import { likeCtaRect, likeWatermarkTop, s4CtaRect, s4WatermarkTop } from '../shared/s4-cta';
import { S7_FRAME } from '../shared/s7-cta';
import { buildTimeline } from '../shared/timeline';

const fail = (message: string): never => {
  throw new Error(message);
};

const center = resolveFocusCrop({ w: 1920, h: 1080 }, 0.5);
if (Math.abs(center.x - 552.2) > 0.2) fail(`center x ${center.x}`);
if (Math.abs(center.w - 815.7) > 0.2) fail(`center w ${center.w}`);
if (center.h !== 1080) fail(`center h ${center.h}`);
if (center.y !== 0) fail(`center y ${center.y}`);

const left = resolveFocusCrop({ w: 1920, h: 1080 }, 0);
const right = resolveFocusCrop({ w: 1920, h: 1080 }, 1);
if (left.x !== 0) fail(`left edge ${left.x}`);
if (Math.abs(right.x - (1920 - right.w)) > 0.001) fail(`right edge ${right.x}`);

const hd = resolveFocusCrop({ w: 1280, h: 720 }, 0.5);
if (Math.abs(hd.w / hd.h - 1080 / 1430) > 0.0001) fail(`720 ratio ${hd.w / hd.h}`);

const portrait = resolveFocusCrop({ w: 1080, h: 1920 }, 0.5);
if (portrait.w !== 1080) fail(`portrait w ${portrait.w}`);
if (Math.abs(portrait.h - 1430) > 0.001) fail(`portrait h ${portrait.h}`);
if (portrait.y <= 0) fail('portrait should sit in the vertical middle');

const middle = focusScreenPoint({ w: 1920, h: 1080 }, 0.5, 1920 / 2, 1080 / 2);
if (Math.abs(middle.x - 540) > 0.01) fail(`screen x ${middle.x}`);
if (!middle.inside) fail('crop center should be inside');
const outside = focusScreenPoint({ w: 1920, h: 1080 }, 0.5, 0, 540);
if (outside.inside) fail('source left edge should be outside a centered focus crop');

const zoomed = resolveFocusCrop({ w: 1920, h: 1080 }, 0.5, 1.5);
if (Math.abs(zoomed.h - 720) > 0.01) fail(`zoomed h ${zoomed.h}`);
if (Math.abs(zoomed.y - 180) > 0.01) fail(`zoomed y ${zoomed.y}`);
if (Math.abs(zoomed.w / zoomed.h - 1080 / 1430) > 0.0001) fail(`zoomed ratio ${zoomed.w / zoomed.h}`);
const zoomedMiddle = focusScreenPoint({ w: 1920, h: 1080 }, 0.5, 1920 / 2, 1080 / 2, 1.5);
if (Math.abs(zoomedMiddle.x - 540) > 0.01) fail(`zoomed screen x ${zoomedMiddle.x}`);
if (!zoomedMiddle.inside) fail('zoomed crop center should stay inside');
const zoomedTop = focusScreenPoint({ w: 1920, h: 1080 }, 0.5, 1920 / 2, 0, 1.5);
if (zoomedTop.inside) fail('source top should leave a 1.5x focus crop');
const zoomedRaised = resolveFocusCrop({ w: 1920, h: 1080 }, 0.5, 1.5, 0);
if (zoomedRaised.y !== 0) fail(`raised crop y ${zoomedRaised.y}`);
const zoomedLowered = resolveFocusCrop({ w: 1920, h: 1080 }, 0.5, 1.5, 1);
if (Math.abs(zoomedLowered.y - (1080 - 720)) > 0.01) fail(`lowered crop y ${zoomedLowered.y}`);
const raisedPoint = focusScreenPoint({ w: 1920, h: 1080 }, 0.5, 1920 / 2, 0, 1.5, 0);
if (!raisedPoint.inside) fail('source top should enter a crop raised to the top');

const backToSource = (
  frame: { w: number; h: number },
  cropCenterX: number,
  zoom: number,
  cropCenterY: number,
  srcX: number,
  srcY: number,
): { x: number; y: number } => {
  const screen = focusScreenPoint(frame, cropCenterX, srcX, srcY, zoom, cropCenterY);
  const placed = focusFootagePlacement(frame, cropCenterX, zoom, cropCenterY);
  const localX = (screen.x / S7_FRAME.width - placed.box.x) / placed.box.w;
  const localY = (screen.y / S7_FRAME.height - placed.box.y) / placed.box.h;
  return {
    x: ((localX - placed.video.x) / placed.video.w) * frame.w,
    y: ((localY - placed.video.y) / placed.video.h) * frame.h,
  };
};
const roof = { x: 860, y: 520 };
const roofFrame = { w: 1920, h: 1080 };
const roofScreen = focusScreenPoint(roofFrame, 0.5, roof.x, roof.y);
const asCenterCropY = (roofScreen.y / S7_FRAME.height) * roofFrame.h;
if (!(asCenterCropY < roof.y - 20)) {
  fail(`center-crop sampling should read above the focus point: ${asCenterCropY} vs ${roof.y}`);
}
for (const sample of [
  { cropCenterX: 0.5, zoom: 1, cropCenterY: 0.5, srcX: roof.x, srcY: roof.y },
  { cropCenterX: 0.42, zoom: 1.25, cropCenterY: 0.35, srcX: 700, srcY: 240 },
  { cropCenterX: 0.7, zoom: 1.5, cropCenterY: 1, srcX: 1400, srcY: 900 },
]) {
  const back = backToSource(roofFrame, sample.cropCenterX, sample.zoom, sample.cropCenterY, sample.srcX, sample.srcY);
  if (Math.abs(back.x - sample.srcX) > 0.05 || Math.abs(back.y - sample.srcY) > 0.05) {
    fail(`focus zoom footage left the aim point: ${back.x}, ${back.y}`);
  }
}
const portraitTop = resolveFocusCrop({ w: 1080, h: 1920 }, 0.5, 1, 0);
if (portraitTop.y !== 0) fail(`portrait top y ${portraitTop.y}`);
if (roundFocusZoom(undefined) !== 1) fail('missing zoom should stay 1');
if (roundFocusZoom(1.234) !== 1.23) fail(`zoom round ${roundFocusZoom(1.234)}`);
if (roundFocusZoom(9) !== 1.5) fail('zoom should clamp to 1.5');

if (likeCtaRect().y !== likeCtaRect(S7_FRAME.footageTop).y) fail('like cta should stay on the blur-fit footage');
if (s4CtaRect().y !== s4CtaRect(S7_FRAME.footageBottom).y) fail('cv cta should stay on the blur-fit footage');
if (cvSignatureTop() !== s4WatermarkTop()) fail(`signature moved without overlap: ${cvSignatureTop()} vs ${s4WatermarkTop()}`);
if (cvSignatureTop(1300) !== LAYOUT_FOCUS.signatureYWhenCvCtaOverlaps) fail('overlapping signature should drop to 1440');
if (likeWatermarkTop() !== S7_FRAME.footageBottom + 26) fail('like watermark anchor changed');
if (LAYOUT_FOCUS.legacyAnchorRect.y !== 656 || LAYOUT_FOCUS.legacyAnchorRect.h !== 608) {
  fail('legacy anchor drifted from blur-fit');
}

const created = createDefaultProject('focus-new', '2026-10-24T00:00:00.000Z');
for (const key of ['hook', 'throw', 'demo', 'loop'] as const) {
  const scene = created.scenes.find((item) => item.sceneKey === key);
  if (scene?.layout916 !== 'focus') fail(`${key} should default to focus`);
}
if (created.scenes.find((item) => item.sceneKey === 'card')?.layout916 !== 'blur-fit') fail('card stays blur-fit');
if (created.scenes.find((item) => item.sceneKey === 'stand')?.layout916 !== 'center-crop') fail('stand stays center-crop');
if (created.scenes.find((item) => item.sceneKey === 'aim')?.layout916 !== 'center-crop') fail('aim stays center-crop');

const legacy = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  scenes: created.scenes.map((scene) =>
    scene.sceneKey === 'hook' ? { ...scene, layout916: 'blur-fit' } : scene,
  ),
});
if (legacy.scenes.find((scene) => scene.sceneKey === 'hook')?.layout916 !== 'blur-fit') {
  fail('saved blur-fit was rewritten');
}
const missing = JSON.parse(JSON.stringify(created)) as { scenes: Array<Record<string, unknown>> };
delete missing.scenes[0]?.layout916;
const filled = parseProject(missing);
if (filled.scenes[0]?.layout916 !== 'blur-fit') fail('omitted layout should stay blur-fit');
if (focusCropZoomOf(created.scenes[0]) !== 1) fail('new focus scene should crop at 1x');

const zoomedProject = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  scenes: created.scenes.map((scene) =>
    scene.sceneKey === 'hook' ? { ...scene, cropZoom: 1.25 } : scene,
  ),
});
const savedZoom = zoomedProject.scenes.find((scene) => scene.sceneKey === 'hook')?.cropZoom;
if (savedZoom !== 1.25) fail(`crop zoom was not kept: ${savedZoom}`);
const shifted = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  scenes: created.scenes.map((scene) =>
    scene.sceneKey === 'hook' ? { ...scene, cropCenterY: 0.2 } : scene,
  ),
});
const savedY = shifted.scenes.find((scene) => scene.sceneKey === 'hook')?.cropCenterY;
if (savedY !== 0.2) fail(`crop y was not kept: ${savedY}`);
if (created.scenes[0]?.cropCenterY !== undefined) fail('new focus scene should keep the vertical center implicit');

const kept = {
  ...legacy,
  timelineEdited: false as const,
  timeline: null,
};
if (buildTimeline(kept).items.find((item) => item.sceneKey === 'hook')?.layout !== 'blur-fit') {
  fail('rebuild changed a saved layout');
}
if (buildTimeline(created).items.find((item) => item.sceneKey === 'hook')?.layout !== 'focus') {
  fail('new timeline should copy focus');
}

assert.equal(LAYOUT_FOCUS.video.y + LAYOUT_FOCUS.video.h, 1580);

const phone = ytShortsPlayback(393);
assert.equal(Math.round(phone.tabHeight), 83);
assert.ok(Math.abs(phone.viewportHeight - 393 * (1920 / 980)) < 0.01);
assert.ok(Math.abs(phone.playerWidth / phone.viewportHeight - 1080 / 1920) < 0.0001);
assert.ok(phone.playerOffset > 0);
assert.equal(YT_SHORTS_UI_GUIDE.bottom.y[1], 1920);
assert.ok(phone.phoneHeight > phone.viewportHeight);
console.log('focus layout ok');
