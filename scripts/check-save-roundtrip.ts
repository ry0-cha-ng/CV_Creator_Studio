import { aimMarkerVisibleAt, sceneSourceTime } from '../shared/aim-marker';
import { persistenceMismatches } from '../shared/project-persistence';
import { createDefaultProject, parseProject } from '../shared/schema/project';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const stamped = createDefaultProject('id', '2026-01-01T00:00:00.000Z');
stamped.updatedAt = '2026-01-02T00:00:00.000Z';
stamped.title = 'テスト定点';
stamped.lineup.crouch = true;
stamped.lineup.charge = 2;
stamped.lineup.bounce = 0;
stamped.lineup.throwType = {
  ja: 'しゃがみ + 0バウンス・2チャージ',
  en: 'CROUCH + 0 BOUNCE · 2 CHARGE',
};
stamped.captions[0].text = { ja: '編集済み', en: 'EDITED' };
stamped.captions[0].cardText = { ja: 'カード', en: 'CARD' };
stamped.captions[0].xText = { ja: '投稿', en: 'POST' };
stamped.captions[0].thumbText = { ja: 'サムネ\nイル', en: 'THUMB\nNAIL' };
const aim = stamped.scenes.find((scene) => scene.sceneKey === 'aim');
if (!aim) fail('aim scene missing');
aim.aimMarker = { enabled: true, x: 0.2, y: 0.4, size: 1.75, at: 1.25 };
stamped.audio.bgm = {
  audioTrackId: 'track-1',
  start: 0.25,
  duration: 8,
  offset: 1,
  fadeIn: 0.2,
  fadeOut: 0.3,
  ducking: false,
  gain: 0,
};
stamped.timeline = {
  durationSec: 12,
  items: [
    {
      id: 'item-1',
      sceneKey: 'hook',
      presentation: 'standard',
      start: 0,
      duration: 2,
      sourceOffset: 0.5,
      speed: 1.25,
      layout: 'center-crop',
      transition: 'fade',
      volume: 0.5,
      arrow: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
    },
  ],
  volumePoints: [{ id: 'vp-1', time: 1, game: 0.4, bgm: 0.2 }],
  effects: [{ id: 'fx-1', label: 'hit', audioTrackId: null, start: 1.5, volume: 0.7 }],
};

const durable = JSON.parse(JSON.stringify(parseProject(structuredClone(stamped)))) as unknown;
const mismatches = persistenceMismatches(stamped, durable);
if (mismatches.length > 0) fail(`roundtrip dropped edits:\n${mismatches.join('\n')}`);

const stripped = structuredClone(durable) as { lineup: { crouch?: boolean } };
delete stripped.lineup.crouch;
const dropped = persistenceMismatches(stamped, stripped);
if (!dropped.includes('lineup.crouch')) fail(`expected lineup.crouch, got ${dropped.join(', ')}`);

const updatedAtOnly = persistenceMismatches(stamped, { ...(durable as object), updatedAt: 'other' });
if (updatedAtOnly.length > 0) fail(`updatedAt should be ignored: ${updatedAtOnly.join(', ')}`);

const legacy = createDefaultProject('legacy');
delete (legacy.lineup as { crouch?: boolean }).crouch;
const legacyDurable = JSON.parse(JSON.stringify(parseProject(structuredClone(legacy)))) as unknown;
const legacyDiff = persistenceMismatches(legacy, legacyDurable);
if (legacyDiff.length > 0) fail(`legacy project should still save:\n${legacyDiff.join('\n')}`);

const legacyAim = createDefaultProject('legacy-aim');
const rawAim = JSON.parse(JSON.stringify(legacyAim)) as {
  scenes: Array<{ sceneKey: string; aimMarker?: { at?: number } }>;
};
const aimScene = rawAim.scenes.find((scene) => scene.sceneKey === 'aim');
if (!aimScene?.aimMarker) fail('legacy aim marker missing');
delete aimScene.aimMarker.at;
const restored = parseProject(rawAim);
const restoredAt = restored.scenes.find((scene) => scene.sceneKey === 'aim')?.aimMarker?.at;
if (restoredAt !== 0) fail(`missing aim marker at should default to 0, got ${restoredAt}`);

const fps = 60;
const freeze = { enabled: true, at: 2, duration: 1 };
if (sceneSourceTime(Math.round(1.5 * fps), fps, { freeze }) !== 1.5) fail('source time before freeze');
if (sceneSourceTime(Math.round(2.4 * fps), fps, { freeze }) !== 2) fail('source time during freeze');
if (Math.abs(sceneSourceTime(Math.round(3.5 * fps), fps, { freeze }) - 2.5) > 1e-6) {
  fail('source time after freeze');
}
const marker = { enabled: true, at: 1.25 };
if (aimMarkerVisibleAt(marker, 1)) fail('marker should stay hidden before appear time');
if (!aimMarkerVisibleAt(marker, 1.25)) fail('marker should appear at the specified time');
if (!aimMarkerVisibleAt({ enabled: true, at: 0 }, 0)) fail('at 0 should show from the start');

console.log('save roundtrip ok');
