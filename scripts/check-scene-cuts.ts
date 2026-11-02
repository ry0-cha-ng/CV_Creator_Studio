import assert from 'node:assert/strict';
import { usedSourceSpan } from '../shared/export-media';
import { compositionBlocks, removeVideoAsset } from '../shared/guide';
import {
  addCut,
  canAddCut,
  moveCut,
  removeCut,
  retargetCutVideo,
  setCutCrop,
  setCutRange,
} from '../shared/scene-cut-edit';
import {
  MAX_CUTS_PER_SCENE,
  PRIMARY_CUT_ID,
  isPrimaryItem,
  itemCrop,
  sceneClipsForExport,
  sceneCuts,
} from '../shared/scene-cuts';
import { createDefaultProject, parseProject, type Project, type SceneKey } from '../shared/schema/project';
import {
  activeTimeline,
  applySceneCutDuration,
  buildTimeline,
  itemClip,
  sceneSpanOf,
  sceneTotalDuration,
  splitTimelineItemAt,
  syncTimelineDurationsToScenes,
} from '../shared/timeline';

const near = (actual: number, expected: number, message: string): void =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} !== ${expected}`);

/** 動画2本と、S1〜S4・S7 にクリップがあるプロジェクト。 */
const fixture = (): Project => {
  const project = createDefaultProject('scene-cuts', '2026-11-02T00:00:00.000Z');
  project.assets = [
    { id: 'main', type: 'video', path: 'main.mp4', meta: { duration: 60, width: 1920, height: 1080 }, loudnessEnvelope: [], tags: [], role: 'main' },
    { id: 'alt', type: 'video', path: 'alt.mp4', meta: { duration: 30, width: 1280, height: 720 }, loudnessEnvelope: [], tags: [] },
  ];
  const ranges: Partial<Record<SceneKey, [number, number]>> = {
    hook: [10, 12],
    stand: [20, 23],
    aim: [30, 34],
    throw: [40, 43],
  };
  for (const scene of project.scenes) {
    const range = ranges[scene.sceneKey];
    if (!range) continue;
    const id = `clip-${scene.sceneKey}`;
    project.clips.push({ id, assetId: 'main', in: range[0], out: range[1] });
    scene.clipId = id;
  }
  project.templateParams.sceneDurations = { hook: 2, stand: 3, aim: 4, throw: 3 };
  return parseProject(project);
};

const hookItems = (project: Project) => activeTimeline(project).items.filter((item) => item.sceneKey === 'hook');

// ---- 互換：カットが1本のシーンは今までと同じ ----
{
  const project = fixture();
  assert.equal(project.scenes.some((scene) => 'extraCuts' in scene), false, '既定では extraCuts を持たない');
  const roundtrip = parseProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(roundtrip.scenes, project.scenes, '保存の往復でシーンが変わらない');
  const timeline = buildTimeline(project);
  const order = timeline.items.map((item) => item.sceneKey);
  assert.equal(new Set(order).size, order.length, '1本のシーンは項目が1つ');
  assert.equal(timeline.items.some((item) => item.clipId !== undefined), false, 'clipId を持たない');
  assert.equal(timeline.volumePoints.length, timeline.items.length, '音量の点は項目ごと（従来どおり）');
}

// ---- タイムラインの展開 ----
{
  const base = fixture();
  const project = addCut(base, 'hook', 0, { cutId: 'cut-b', clipId: 'clip-b' });
  const cuts = sceneCuts(project, 'hook');
  assert.equal(cuts.length, 2);
  assert.equal(cuts[1]?.clip.assetId, 'alt', '動画が2本あれば別の動画を使う');
  near(cuts[1]?.clip.in ?? -1, 0, '別の動画は 0 秒から');
  near((cuts[1]?.clip.out ?? 0) - (cuts[1]?.clip.in ?? 0), 1.5, '新しいカットは 1.5 秒');
  const items = hookItems(project);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.clipId, undefined);
  assert.equal(items[1]?.clipId, 'clip-b');
  assert.equal(items[1]?.transition, 'cut');
  near(items[0]?.duration ?? 0, 2, 'カット1の尺');
  near(items[1]?.duration ?? 0, 1.5, 'カット2の尺');
  near(sceneTotalDuration(project, 'hook'), 3.5, 'シーンの合計');
  near(project.templateParams.sceneDurations.hook ?? 0, 3.5, 'sceneDurations は合計');
  const timeline = activeTimeline(project);
  const before = buildTimeline(base);
  const standBefore = before.items.find((item) => item.sceneKey === 'stand');
  const standAfter = timeline.items.find((item) => item.sceneKey === 'stand');
  near((standAfter?.start ?? 0) - (standBefore?.start ?? 0), 1.5, '後ろのシーンはカット2の分ずれる');
  assert.equal(
    timeline.volumePoints.length,
    new Set(timeline.items.map((item) => item.sceneKey)).size,
    '音量の点はシーンに1つ',
  );
  assert.equal(itemClip(project, items[1] as never)?.id, 'clip-b');
  assert.equal(itemClip(project, items[0] as never)?.id, 'clip-hook');
  assert.equal(isPrimaryItem(project, items[0]), true);
  assert.equal(isPrimaryItem(project, items[1]), false);
  const span = sceneSpanOf(timeline.items, timeline.items.findIndex((item) => item.clipId === 'clip-b'));
  near(span.offset, 2, 'カット2はシーンの先頭から 2 秒');
  near(span.duration, 3.5, 'シーンの区間');
  assert.deepEqual(
    compositionBlocks(project).find((block) => block.sceneKey === 'hook')?.duration,
    3.5,
    '構成の帯はシーンの合計',
  );
}

// ---- 同じ動画しかないときは、直前のカットの OUT から ----
{
  const base = fixture();
  base.assets = base.assets.filter((asset) => asset.id === 'main');
  const project = addCut(base, 'stand', 0, { cutId: 'cut-s', clipId: 'clip-s' });
  const second = sceneCuts(project, 'stand')[1];
  assert.equal(second?.clip.assetId, 'main');
  near(second?.clip.in ?? 0, 23, 'カット1の OUT から');
}

// ---- 対象外のシーン（S5〜S7）の extraCuts は無視 ----
{
  const project = fixture();
  const loop = project.scenes.find((scene) => scene.sceneKey === 'loop');
  assert.ok(loop);
  project.clips.push({ id: 'clip-x', assetId: 'alt', in: 0, out: 1 });
  loop.extraCuts = [{ id: 'cut-x', clipId: 'clip-x' }];
  assert.equal(sceneCuts(project, 'loop').length, 0, 'S7 はカットを解決しない');
  assert.equal(canAddCut(project, 'loop'), false);
  assert.equal(canAddCut(project, 'card'), false);
  assert.equal(
    activeTimeline(project).items.some((item) => item.clipId === 'clip-x'),
    false,
    'S7 のカットは項目にならない',
  );
}

// ---- 操作 ----
{
  let project = fixture();
  project = addCut(project, 'aim', 0, { cutId: 'a2', clipId: 'clip-a2' });
  project = addCut(project, 'aim', 1, { cutId: 'a3', clipId: 'clip-a3' });
  project = addCut(project, 'aim', 2, { cutId: 'a4', clipId: 'clip-a4' });
  assert.equal(sceneCuts(project, 'aim').length, MAX_CUTS_PER_SCENE);
  assert.equal(canAddCut(project, 'aim'), false);
  assert.equal(addCut(project, 'aim', 0), project, '上限を超えて足せない');
  assert.deepEqual(
    sceneCuts(project, 'aim').map((cut) => cut.cutId),
    [PRIMARY_CUT_ID, 'a2', 'a3', 'a4'],
  );

  // 範囲
  project = setCutRange(project, 'aim', 'a3', { in: 5, out: 7.5 });
  const a3 = sceneCuts(project, 'aim').find((cut) => cut.cutId === 'a3');
  near((a3?.clip.out ?? 0) - (a3?.clip.in ?? 0), 2.5, 'カット3の範囲');
  const total = sceneCuts(project, 'aim').reduce((sum, cut) => sum + cut.clip.out - cut.clip.in, 0);
  near(project.templateParams.sceneDurations.aim ?? 0, total, '範囲の変更で合計が変わる');
  near(sceneTotalDuration(project, 'aim'), total, 'タイムラインの合計');

  // カット1の尺（手順3の秒数）はカット1だけを変える
  project = applySceneCutDuration(project, 'aim', 3);
  near(sceneCuts(project, 'aim')[0]?.clip.out ?? 0, 33, 'カット1の OUT');
  near(
    project.templateParams.sceneDurations.aim ?? 0,
    sceneCuts(project, 'aim').reduce((sum, cut) => sum + cut.clip.out - cut.clip.in, 0),
    'カット1の秒数の変更でも合計を保つ',
  );

  // クロップ
  project = setCutCrop(project, 'aim', 'a2', { cropCenterX: 0.2 });
  const aimScene = project.scenes.find((scene) => scene.sceneKey === 'aim');
  assert.ok(aimScene);
  const a2Item = activeTimeline(project).items.find((item) => item.clipId === 'clip-a2');
  assert.equal(itemCrop(project, aimScene, a2Item).cropCenterX, 0.2);
  assert.equal(itemCrop(project, aimScene, undefined).cropCenterX, 0.5, 'カット1はシーンの値');

  // 並べ替え（カット1と入れ替え）
  const primaryClip = aimScene.clipId;
  project = moveCut(project, 'aim', 'a2', -1);
  const moved = project.scenes.find((scene) => scene.sceneKey === 'aim');
  assert.equal(moved?.clipId, 'clip-a2', 'カット2がカット1になる');
  assert.equal(moved?.cropCenterX, 0.2, 'クロップも移る');
  assert.equal(moved?.extraCuts?.[0]?.clipId, primaryClip, '元のカット1はカット2へ');
  assert.equal(moved?.extraCuts?.[0]?.cropCenterX, 0.5, '元のカット1のクロップを持つ');
  assert.ok(moved?.aimMarker?.enabled, '照準マーカーはシーンに残る（新しいカット1に付く）');

  // 並べ替え（カット2以降どうし）
  project = moveCut(project, 'aim', 'a4', -1);
  assert.deepEqual(
    sceneCuts(project, 'aim').map((cut) => cut.clip.id),
    ['clip-a2', primaryClip, 'clip-a4', 'clip-a3'],
  );

  // 動画の差し替え
  project = retargetCutVideo(project, 'aim', 'a4', 'alt');
  const a4 = sceneCuts(project, 'aim').find((cut) => cut.clip.id === 'clip-a4');
  assert.equal(a4?.clip.assetId, 'alt');
  assert.ok((a4?.clip.out ?? 99) <= 30, '素材の長さに収まる');

  // 削除（カット1）：カット2が繰り上がり、使わないクリップは消える
  project = removeCut(project, 'aim', PRIMARY_CUT_ID);
  const removed = project.scenes.find((scene) => scene.sceneKey === 'aim');
  assert.equal(removed?.clipId, primaryClip);
  assert.equal(removed?.cropCenterX, 0.5);
  assert.equal(project.clips.some((clip) => clip.id === 'clip-a2'), false, '使わないクリップは残らない');
  project = removeCut(project, 'aim', 'a3');
  project = removeCut(project, 'aim', 'a4');
  const single = project.scenes.find((scene) => scene.sceneKey === 'aim');
  assert.equal(single?.extraCuts, undefined, '最後のカットを消すと extraCuts もなくなる');
  assert.equal(activeTimeline(project).items.filter((item) => item.sceneKey === 'aim').length, 1);
  assert.equal(removeCut(project, 'aim', PRIMARY_CUT_ID), project, 'カットが1本なら消せない');
}

// ---- 詳細編集済みのタイムライン ----
{
  const base = fixture();
  const timeline = buildTimeline(base);
  const stand = timeline.items.find((item) => item.sceneKey === 'stand');
  assert.ok(stand);
  const split = splitTimelineItemAt(timeline, stand.id, stand.start + 1);
  const edited: Project = { ...base, timelineEdited: true, timeline: split };
  const pointsBefore = split.volumePoints.map((point) => point.time);
  const effectsBefore = split.effects.map((effect) => effect.start);
  const project = addCut(edited, 'hook', 0, { cutId: 'h2', clipId: 'clip-h2' });
  const next = activeTimeline(project);
  assert.equal(next.items.filter((item) => item.sceneKey === 'stand').length, 2, 'ほかのシーンの分割は残る');
  assert.equal(next.items.filter((item) => item.sceneKey === 'hook').length, 2);
  near(next.durationSec - split.durationSec, 1.5, '全体の尺');
  // S1 より後ろの点は 1.5 秒ずれる。S1 の中の点は S1 の中に収まる
  next.volumePoints.forEach((point, index) => {
    const old = pointsBefore[index] ?? 0;
    if (old >= 2) near(point.time, old + 1.5, `音量の点 ${index}`);
    else assert.ok(point.time < 3.5, `S1 の中の音量の点 ${index}`);
  });
  next.effects.forEach((effect, index) => {
    const old = effectsBefore[index] ?? 0;
    if (old >= 2) near(effect.start, old + 1.5, `効果音 ${index}`);
  });

  // カット2の尺をタイムラインで変えると、そのクリップの範囲が合う
  const cut2 = next.items.find((item) => item.clipId === 'clip-h2');
  assert.ok(cut2);
  const trimmed = { ...next, items: next.items.map((item) => (item.id === cut2.id ? { ...item, duration: 1 } : item)) };
  const synced = syncTimelineDurationsToScenes(project, trimmed);
  const h2 = synced.clips.find((clip) => clip.id === 'clip-h2');
  near((h2?.out ?? 0) - (h2?.in ?? 0), 1, 'カット2のクリップが項目の尺に合う');
  near(synced.templateParams.sceneDurations.hook ?? 0, 3, 'シーンの尺は合計');
}

// ---- 書き出し ----
{
  const project = addCut(fixture(), 'throw', 0, { cutId: 't2', clipId: 'clip-t2' });
  assert.ok(sceneClipsForExport(project).some((clip) => clip.id === 'clip-t2'), '書き出しのクリップに入る');
  const span = usedSourceSpan(project, 'alt', 30);
  assert.ok(span, 'カット2の素材の区間がある');
  assert.ok(span.start <= 0 && span.end >= 1.5, `カット2の区間を含む: ${JSON.stringify(span)}`);

  // 動画を消すと、その動画のカットが外れる
  const removed = removeVideoAsset(project, 'alt');
  const throwScene = removed.scenes.find((scene) => scene.sceneKey === 'throw');
  assert.equal(throwScene?.extraCuts, undefined);
  assert.equal(activeTimeline(removed).items.filter((item) => item.sceneKey === 'throw').length, 1);

  // カット1の動画を消すと、カット2が繰り上がる
  const promoted = removeVideoAsset(project, 'main');
  const promotedThrow = promoted.scenes.find((scene) => scene.sceneKey === 'throw');
  assert.equal(promotedThrow?.clipId, 'clip-t2');
  assert.equal(promotedThrow?.extraCuts, undefined);
}

console.log('check:scene-cuts ok');
