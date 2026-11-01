import { addChapter, addFreeze, addSecondary, assignRange, linkedSecondaryOf, setSpeed, setSyncLinked, swapSecondary, updatePlacement } from '../shared/long/commands';
import { sequentialIds } from '../shared/long/ids';
import { buildRenderPlan, type PlanVideoLayer } from '../shared/long/render-plan';
import { FULL_RECT, type LongProject } from '../shared/long/schema';
import { mainSourceAt, secondarySourceAt } from '../shared/long/sync';
import { secToTicks } from '../shared/long/time';
import { baseProject, expect, expectClose, expectEqual } from './long-test-utils';

// --- 例：A=12.0秒、B=7.5秒
const pair = { mainAt: secToTicks(12), secondaryAt: secToTicks(7.5) };
expectEqual(secondarySourceAt(secToTicks(12), pair), secToTicks(7.5), '同期点で A12.0 = B7.5');
expectEqual(secondarySourceAt(secToTicks(13), pair), secToTicks(8.5), '等速で A13.0 = B8.5');
expectEqual(mainSourceAt(secToTicks(8.5), pair), secToTicks(13), '逆変換 B8.5 → A13.0');

const ids = sequentialIds('t');
const setup = (): { project: LongProject; mainId: string; secondaryId: string } => {
  let project = baseProject('empty');
  const chapter = addChapter(project, 'custom', {}, ids);
  project = chapter.project;
  const sceneId = project.chapters.find((item) => item.id === chapter.chapterId)!.sceneIds[0]!;
  // 主 A を 10〜20秒で配置（シーン内 2秒 = 素材 12.0秒）
  project = assignRange(project, sceneId, { assetId: 'asset-a', sourceIn: secToTicks(10), sourceOut: secToTicks(20) }, ids);
  const mainId = (project.scenes.find((item) => item.id === sceneId)!.content as { placementId: string }).placementId;
  const added = addSecondary(project, mainId, 'asset-b', { mainAt: secToTicks(12), secondaryAt: secToTicks(7.5) }, ids);
  return { project: added.project, mainId, secondaryId: added.placementId };
};

const layerOf = (layers: PlanVideoLayer[], role: PlanVideoLayer['role']): PlanVideoLayer => {
  const layer = layers.find((item) => item.role === role);
  if (!layer) throw new Error(`layer ${role} missing`);
  return layer;
};

/** 出力フレーム f の素材時刻（秒） */
const sourceSecAt = (layer: PlanVideoLayer, frame: number, fps: number): number | null => {
  const piece = layer.pieces.find((item) => frame >= item.from && frame < item.from + item.duration);
  if (!piece) return null;
  if (piece.kind === 'freeze') return piece.trimBefore / fps;
  return (piece.trimBefore + (frame - piece.from) * piece.speed) / fps;
};

for (const fps of [60, 30] as const) {
  const { project } = setup();
  const plan = buildRenderPlan(project, { language: 'ja', fps });
  const main = layerOf(plan.layers, 'main');
  const secondary = layerOf(plan.layers, 'secondary');
  // シーン内 2.0 秒（同期点）
  const syncFrame = 2 * fps;
  expectClose(sourceSecAt(main, syncFrame, fps)!, 12, 1e-9, `${fps}fps 同期点で A=12.0`);
  expectClose(sourceSecAt(secondary, syncFrame, fps)!, 7.5, 1e-9, `${fps}fps 同期点で B=7.5`);
  expectClose(sourceSecAt(secondary, 3 * fps, fps)!, 8.5, 1e-9, `${fps}fps 1秒後に B=8.5`);
  expectClose(sourceSecAt(secondary, 0, fps)!, 5.5, 1e-9, `${fps}fps 同期点の前も対応（A10.0=B5.5）`);
  // B は 15 秒しかない：A=19.5 以降は副素材がない → 非表示＋警告
  expect(sourceSecAt(secondary, Math.round(9.6 * fps), fps) === null, `${fps}fps 副素材の範囲外は非表示`);
  expect(plan.diagnostics.some((item) => item.code === 'SECONDARY_RANGE_GAP'), '副素材不足の警告');
  // 既定（hide-main-full）：範囲外では主映像を全画面に戻す
  const gapPiece = main.pieces.find((piece) => Math.round(9.6 * fps) >= piece.from && Math.round(9.6 * fps) < piece.from + piece.duration)!;
  expectEqual(gapPiece.rect, FULL_RECT, '範囲外では主映像が全画面');
}

// --- グループの速度変更・フリーズ
{
  const { project, mainId } = setup();
  const fast = setSpeed(project, mainId, 2);
  const plan = buildRenderPlan(fast, { language: 'ja', fps: 60 });
  const secondary = layerOf(plan.layers, 'secondary');
  // 2倍速：シーン内 1.0 秒 = A12.0
  expectClose(sourceSecAt(layerOf(plan.layers, 'main'), 60, 60)!, 12, 1e-9, '2倍速で主が A12.0');
  expectClose(sourceSecAt(secondary, 60, 60)!, 7.5, 1e-9, '2倍速でも副が B7.5（同期を保つ）');
  expectEqual(secondary.pieces[0]!.speed, 2, '副もグループの速度で進む');

  const frozen = addFreeze(project, mainId, secToTicks(12), secToTicks(1), ids);
  const framePlan = buildRenderPlan(frozen, { language: 'ja', fps: 60 });
  const s2 = layerOf(framePlan.layers, 'secondary');
  expectClose(sourceSecAt(s2, Math.round(2.5 * 60), 60)!, 7.5, 1e-9, 'フリーズ中は副も止まる');
  expectClose(sourceSecAt(s2, Math.round(3.5 * 60), 60)!, 8.0, 1e-9, 'フリーズ後は副も同じ共通時刻から再開');
}

// --- 表示区間だけを変更しても同期元は変わらない
{
  const { project, secondaryId } = setup();
  const limited = updatePlacement(project, secondaryId, { visible: [{ start: secToTicks(3), end: secToTicks(5) }] } as never);
  const plan = buildRenderPlan(limited, { language: 'ja', fps: 60 });
  const secondary = layerOf(plan.layers, 'secondary');
  expectEqual(sourceSecAt(secondary, 120, 60), null, '表示区間の前は副を出さない');
  expectClose(sourceSecAt(secondary, 180, 60)!, 8.5, 1e-9, '途中から出しても共通時刻（B8.5）から表示');
}

// --- 主副の交換：枠だけを入れ替え、音声・切り抜き・同期は維持
{
  const { project, secondaryId } = setup();
  const before = buildRenderPlan(project, { language: 'ja', fps: 60 });
  const swapped = swapSecondary(project, secondaryId);
  const after = buildRenderPlan(swapped, { language: 'ja', fps: 60 });
  const mainBefore = layerOf(before.layers, 'main').pieces[0]!;
  const secondaryBefore = layerOf(before.layers, 'secondary').pieces[0]!;
  const mainAfter = layerOf(after.layers, 'main').pieces[0]!;
  const secondaryAfter = layerOf(after.layers, 'secondary').pieces[0]!;
  expectEqual(mainAfter.rect, secondaryBefore.rect, '交換後、主は副の枠');
  expectEqual(secondaryAfter.rect, mainBefore.rect, '交換後、副は主の枠');
  expectEqual(secondaryAfter.trimBefore, secondaryBefore.trimBefore, '交換しても同期は同じ');
  expectEqual(after.audio.map((item) => item.placementId), before.audio.map((item) => item.placementId), '交換しても音声選択は同じ');
  expect(layerOf(after.layers, 'main').z > layerOf(after.layers, 'secondary').z, '小さい枠になった主が手前');
}

// --- 分割表示
{
  const { project, secondaryId } = setup();
  const split = updatePlacement(project, secondaryId, { layout: 'split-h', splitRatio: 0.5 } as never);
  const plan = buildRenderPlan(split, { language: 'ja', fps: 60 });
  expectEqual(layerOf(plan.layers, 'main').pieces[0]!.rect, { x: 0, y: 0, w: 0.5, h: 1 }, '左右分割で主は左半分');
  expectEqual(layerOf(plan.layers, 'secondary').pieces[0]!.rect, { x: 0.5, y: 0, w: 0.5, h: 1 }, '左右分割で副は右半分');
  // 手動の分割配置を維持する選択
  const keep = updatePlacement(split, secondaryId, { gapPolicy: 'hide-keep-layout' } as never);
  const keepPlan = buildRenderPlan(keep, { language: 'ja', fps: 60 });
  const gapFrame = Math.round(9.6 * 60);
  const piece = layerOf(keepPlan.layers, 'main').pieces.find((item) => gapFrame >= item.from && gapFrame < item.from + item.duration)!;
  expectEqual(piece.rect, { x: 0, y: 0, w: 0.5, h: 1 }, '分割配置を維持');
  // 直前フレーム保持（明示選択時のみ）
  const hold = updatePlacement(split, secondaryId, { gapPolicy: 'hold-last' } as never);
  const holdPlan = buildRenderPlan(hold, { language: 'ja', fps: 60 });
  const held = layerOf(holdPlan.layers, 'secondary').pieces.find((item) => gapFrame >= item.from && gapFrame < item.from + item.duration);
  expect(held?.kind === 'freeze', '直前フレーム保持は静止で、ループしない');
}

// --- 同期リンクの解除：主の速度・フリーズに追従せず、シーン先頭の同期位置から等速
{
  const { project, mainId, secondaryId } = setup();
  const groupId = (project.placements.find((item) => item.id === secondaryId) as { syncGroupId: string }).syncGroupId;
  expect(linkedSecondaryOf(project, mainId) === secondaryId, '既定はリンク中');
  const fast = setSpeed(project, mainId, 2);
  const unlinked = setSyncLinked(fast, groupId, false);
  expect(linkedSecondaryOf(unlinked, mainId) === undefined, '解除後はリンク中の副視点なし');
  expectEqual(unlinked.syncGroups.find((item) => item.id === groupId)!.members, fast.syncGroups.find((item) => item.id === groupId)!.members, '解除しても同期点は残る');
  const plan = buildRenderPlan(unlinked, { language: 'ja', fps: 60 });
  const main = layerOf(plan.layers, 'main');
  const secondary = layerOf(plan.layers, 'secondary');
  expectClose(sourceSecAt(main, 0, 60)!, 10, 1e-9, '解除中：主の先頭は A10.0');
  expectClose(sourceSecAt(secondary, 0, 60)!, 5.5, 1e-9, '解除中：副の先頭はシーン先頭の同期位置（B5.5）');
  expectEqual(secondary.pieces[0]!.speed, 1, '解除中：副は等速');
  expectClose(sourceSecAt(main, 120, 60)!, 14, 1e-9, '解除中：主は2倍速（2秒後に A14.0）');
  expectClose(sourceSecAt(secondary, 120, 60)!, 7.5, 1e-9, '解除中：副は等速（2秒後に B7.5）');
  // 主は 2倍速で 5秒。副 B は 15秒あるので全区間表示できる
  expect(sourceSecAt(secondary, 299, 60) !== null, '解除中：副素材が足りる区間は表示');
  expect(plan.diagnostics.some((item) => item.code === 'SYNC_UNLINKED' && item.severity === 'warning'), '速度変更ありの解除は警告');
  // フリーズしても副は止まらない
  const frozen = setSyncLinked(addFreeze(project, mainId, secToTicks(12), secToTicks(1), ids), groupId, false);
  const frozenPlan = buildRenderPlan(frozen, { language: 'ja', fps: 60 });
  const s2 = layerOf(frozenPlan.layers, 'secondary');
  expect(s2.pieces.every((piece) => piece.kind === 'play'), '解除中：主のフリーズで副は止まらない');
  expectClose(sourceSecAt(s2, Math.round(2.5 * 60), 60)!, 8.0, 1e-9, '解除中：フリーズ中も副は進む（B8.0）');
  // 再リンクで元に戻る
  const relinked = setSyncLinked(unlinked, groupId, true);
  const back = buildRenderPlan(relinked, { language: 'ja', fps: 60 });
  expectClose(sourceSecAt(layerOf(back.layers, 'secondary'), 60, 60)!, 7.5, 1e-9, '再リンク後は2倍速でも同期（B7.5）');
  expect(!back.diagnostics.some((item) => item.code === 'SYNC_UNLINKED'), '再リンク後は解除の警告なし');
}

// --- 副視点の音声は既定ミュート
{
  const { project } = setup();
  const plan = buildRenderPlan(project, { language: 'ja', fps: 60 });
  expect(!plan.audio.some((item) => item.placementId.includes('pl') && item.src.includes('asset-b')), '副視点の音声は既定でミュート');
}

console.log('long sync ok');
