import {
  ANNOTATION_FRAME_WIDTH,
  annotationDim,
  annotationStyleOf,
  bracketArm,
  connectorSegments,
  getAnnotationStyle,
} from '../shared/annotation-style';
import { createDefaultProject, parseProject } from '../shared/schema/project';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const crosses = (
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean => {
  const side = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): number =>
    Math.sign((y2 - y1) * (x - x2) - (x2 - x1) * (y - y2));
  const ab = side(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const ac = side(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const ba = side(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const bc = side(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return ab !== ac && ba !== bc && ab !== 0 && ac !== 0 && ba !== 0 && bc !== 0;
};

const expectStyle = (
  mode: unknown,
  width: number,
  expected: { red: number; edge: number; blur: number; mat: number; line: number; lineEdge: number; dim: boolean },
): void => {
  const style = getAnnotationStyle(mode, width);
  const scale = width / ANNOTATION_FRAME_WIDTH;
  if (style.red !== expected.red || style.edge !== expected.edge) fail(`${mode} @${width} stroke ${style.red}/${style.edge}`);
  if (style.blur !== expected.blur || style.mat !== expected.mat) fail(`${mode} @${width} blur/mat`);
  if (style.line !== expected.line || style.lineEdge !== expected.lineEdge) fail(`${mode} @${width} connector`);
  if (style.dim !== expected.dim) fail(`${mode} dim flag`);
  if (style.ringDiameter !== 108 * scale) fail(`${mode} ring diameter`);
  if (style.zoomRingRatio !== 0.13) fail('zoom ring ratio');
  if (style.ringGapDeg !== 14 || style.ringTick !== 14 * scale) fail('ring gap or tick');
  if (style.tabSize !== 26 * scale) fail('tab size');
  if (style.navy !== style.red + style.edge * 2) fail('navy width');
};

expectStyle('standard', 1080, { red: 4, edge: 3, blur: 6, mat: 10, line: 3, lineEdge: 2, dim: false });
expectStyle('strong', 1080, { red: 6, edge: 4, blur: 10, mat: 14, line: 4, lineEdge: 3, dim: false });
expectStyle('strong-dim', 1080, { red: 6, edge: 4, blur: 10, mat: 14, line: 4, lineEdge: 3, dim: true });
expectStyle('standard', 540, { red: 2, edge: 1.5, blur: 3, mat: 5, line: 1.5, lineEdge: 1, dim: false });
expectStyle('strong', 540, { red: 3, edge: 2, blur: 5, mat: 7, line: 2, lineEdge: 1.5, dim: false });
expectStyle('strong-dim', 540, { red: 3, edge: 2, blur: 5, mat: 7, line: 2, lineEdge: 1.5, dim: true });
if (getAnnotationStyle('strong', 1080).shadowY !== 16 || getAnnotationStyle('standard', 1080).shadowAlpha !== 0.5) {
  fail('shadow values');
}
if (getAnnotationStyle('standard', 1080).blurAlpha !== 0.7 || getAnnotationStyle('strong-dim', 1080).dimAlpha !== 0.42) {
  fail('alpha values');
}

if (annotationStyleOf(undefined) !== 'standard' || annotationStyleOf('nope') !== 'standard') {
  fail('unknown style should read as standard');
}
if (annotationStyleOf('emphasis') !== 'strong') fail('emphasis should read as strong');

const created = createDefaultProject('style', '2026-10-10T00:00:00.000Z');
const raw = JSON.parse(JSON.stringify(created)) as Record<string, unknown>;
delete raw.annotationStyle;
const missing = parseProject(raw);
if (missing.annotationStyle !== 'standard') fail('missing style should load as standard');
const unknown = parseProject({ ...JSON.parse(JSON.stringify(created)), annotationStyle: 'auto' });
if (unknown.annotationStyle !== 'standard') fail('unknown style should load as standard');
const legacy = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  annotationStyle: undefined,
  cardAimZoom: { ...created.cardAimZoom, weight: 'emphasis' },
});
if (legacy.annotationStyle !== 'strong') fail('old emphasis should load as strong');
const keptStandard = parseProject({
  ...JSON.parse(JSON.stringify(created)),
  cardAimZoom: { ...created.cardAimZoom, weight: 'standard' },
});
if (keptStandard.annotationStyle !== 'standard') fail('old standard should stay standard');
const kept = parseProject({ ...JSON.parse(JSON.stringify(created)), annotationStyle: 'strong-dim' });
if (kept.annotationStyle !== 'strong-dim') fail('strong-dim should survive save and load');
if ('weight' in (kept.cardAimZoom ?? {})) fail('weight should not stay on the zoom settings');

const crop = { x: 200, y: 220, size: 120 };
const placements = {
  tr: { x: 460, y: 40, size: 100 },
  br: { x: 460, y: 420, size: 100 },
  tl: { x: 20, y: 40, size: 100 },
  bl: { x: 20, y: 420, size: 100 },
  above: { x: 200, y: 20, size: 120 },
};
for (const [name, frame] of Object.entries(placements)) {
  const lines = connectorSegments(crop, frame);
  if (lines.length !== 2) fail(`${name} should draw 2 connectors, got ${lines.length}`);
  if (crosses(lines[0], lines[1])) fail(`${name} connectors cross`);
}
if (connectorSegments(crop, { x: 240, y: 250, size: 80 }).length !== 0) fail('overlap should draw no connector');

const full = getAnnotationStyle('standard', ANNOTATION_FRAME_WIDTH);
if (bracketArm(80, full) !== 24) fail(`lower arm bound ${bracketArm(80, full)}`);
if (bracketArm(40, full) !== 14) fail(`upper arm bound ${bracketArm(40, full)}`);
if (bracketArm(250, full) !== 70) fail(`mid arm ${bracketArm(250, full)}`);

const dimmed = getAnnotationStyle('strong-dim', ANNOTATION_FRAME_WIDTH);
const plain = annotationDim({
  shortSide: 1000,
  zoom: false,
  center: { x: 0.2, y: 0.3 },
  metrics: dimmed,
});
if (!plain || plain.r1 !== 110 || plain.r2 !== 450 || plain.center.x !== 0.2) fail('dim without zoom');
const tight = annotationDim({
  shortSide: 1000,
  zoom: true,
  cropSize: 100,
  center: { x: 0.5, y: 0.4 },
  metrics: dimmed,
});
if (!tight || tight.r1 !== 110 || tight.center.y !== 0.4) fail('small crop should keep the short-side radius');
const wideCrop = annotationDim({
  shortSide: 1000,
  zoom: true,
  cropSize: 200,
  center: { x: 0.5, y: 0.5 },
  metrics: dimmed,
});
const expectedR1 = 200 / Math.SQRT2 + 16;
if (!wideCrop || Math.abs(wideCrop.r1 - expectedR1) > 1e-6 || wideCrop.r2 !== 450) fail('crop circumradius should widen r1');
if (annotationDim({ shortSide: 1000, zoom: false, center: { x: 0.5, y: 0.5 }, metrics: full })) {
  fail('standard should not dim');
}

console.log('annotation style ok');
