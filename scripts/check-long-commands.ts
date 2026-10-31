import {
  addChapter,
  addCutIn,
  assignRange,
  createReplay,
  deleteScene,
  duplicateChapter,
  duplicateScene,
  moveChapter,
  placeAvatarEvent,
  rebuildChapter,
  setChapterEnabled,
  setPlacementRange,
  setSceneEnabled,
  updateScene,
} from '../shared/long/commands';
import { sequentialIds } from '../shared/long/ids';
import { buildRenderPlan, chapterDuration, resolveAnchor, resolveTimeline } from '../shared/long/render-plan';
import type { LongProject } from '../shared/long/schema';
import { createLongProject, estimateTemplateSeconds, DEFAULT_TEMPLATE_PARAMS } from '../shared/long/templates';
import { secToTicks } from '../shared/long/time';
import { baseProject, expect, expectEqual } from './long-test-utils';

const ids = sequentialIds('t');

// --- テンプレート（HV-01）
const created = createLongProject({ id: 'p1', title: 'Ascent 定点セット Vol.4', ids: sequentialIds() });
expectEqual(created.chapters.map((chapter) => chapter.role), ['hook', 'set', 'set', 'set', 'set', 'closing', 'ending'], 'フック・4セット・締め・エンディング');
expectEqual(created.chapters.filter((chapter) => chapter.contentKind === 'combo').length, 1, '単一定点と複数スキルの章が混在');
expectEqual(created.slug, 'ascent-vol-4', 'スラッグは安全な文字列');
expectEqual(created.scenes.filter((scene) => scene.content.kind === 'empty').length, 1 + 6 * 3 + 6 + 3, '未割当の枠');
expect(estimateTemplateSeconds(DEFAULT_TEMPLATE_PARAMS) > 0, '尺の目安');
const emptyPlan = buildRenderPlan(created, { language: 'ja' });
expect(emptyPlan.diagnostics.filter((item) => item.code === 'MAIN_MEDIA_MISSING').length === 28, '未割当の枠は書き出し前に検出（HV-02）');

// --- 実戦③の削除と失敗の挿入（HV-02）
let project: LongProject = baseProject();
const set1 = project.chapters.find((chapter) => chapter.role === 'set')!;
for (const sceneId of set1.sceneIds) {
  project = assignRange(project, sceneId, { assetId: 'asset-a', sourceIn: 0, sourceOut: secToTicks(5) }, ids);
}
const before = chapterDuration(project, set1.id);
const third = set1.sceneIds[4]!;
project = deleteScene(project, third);
expectEqual(chapterDuration(project, set1.id), before - secToTicks(5), '実戦③を削除すると空白を残さず尺を再計算');
// 途中に失敗を挿入（テンプレート変更なし）
const failAdded = addChapter(project, 'custom', {}, ids); // 別の章の確認用
project = failAdded.project;
const timelineBefore = resolveTimeline(project);
const failScene = updateScene(project, set1.sceneIds[2]!, { purpose: 'fail', label: '失敗（挿入）' });
expectEqual(resolveTimeline(failScene).total, timelineBefore.total, 'シーンの用途変更で尺は変わらない');

// --- 無効化は尺・出力から除外し、内容は残す
const disabled = setSceneEnabled(project, set1.sceneIds[0]!, false);
expectEqual(chapterDuration(disabled, set1.id), chapterDuration(project, set1.id) - secToTicks(5), '無効化したシーンは尺から除外');
expect(disabled.scenes.some((scene) => scene.id === set1.sceneIds[0]), '無効化しても内容を保持');
const chapterOff = setChapterEnabled(project, set1.id, false);
expect(!resolveTimeline(chapterOff).chapters.some((chapter) => chapter.id === set1.id), '無効化した章は全体から除外');

// --- 複製：新IDを発行し、内部参照を付け替える（HV-11）
const sceneWithEvent = set1.sceneIds[0]!;
const placementId = (project.scenes.find((scene) => scene.id === sceneWithEvent)!.content as { placementId: string }).placementId;
project = {
  ...project,
  markers: [...project.markers, { id: 'mk-hl', kind: 'highlight', placementId, at: secToTicks(3), label: '見せ場', needsReview: false }],
  captions: [
    ...project.captions,
    {
      id: 'cap-1',
      kind: 'speech',
      anchor: { kind: 'source', placementId, ticks: secToTicks(1) },
      duration: secToTicks(1),
      text: { ja: 'ここ通るでしょ' },
      excluded: [],
      style: { preset: 'subtitle', x: 0.5, y: 0.86, width: 0.8, size: 48, align: 'center', color: '#FFFFFF', accent: '#FF4655', background: false },
    },
  ],
};
project = addCutIn(project, 'mk-hl', 'asset-a', {}, ids).project;
const dup = duplicateChapter(project, set1.id, ids);
const dupChapter = dup.project.chapters.find((chapter) => chapter.id === dup.chapterId)!;
expectEqual(dupChapter.sceneIds.length, project.chapters.find((chapter) => chapter.id === set1.id)!.sceneIds.length, '複製した章のシーン数');
const allIds = [
  ...dup.project.scenes.map((item) => item.id),
  ...dup.project.placements.map((item) => item.id),
  ...dup.project.markers.map((item) => item.id),
  ...dup.project.captions.map((item) => item.id),
  ...dup.project.overlays.map((item) => item.id),
];
expectEqual(new Set(allIds).size, allIds.length, '複製後もIDが重複しない');
const dupCaption = dup.project.captions.find((item) => item.id !== 'cap-1' && item.text.ja === 'ここ通るでしょ')!;
expect(dupCaption.anchor.kind === 'source' && dupCaption.anchor.placementId !== placementId, '複製した字幕は複製先の配置を参照');
const dupCutIn = dup.project.overlays.find((item) => item.kind === 'cutin' && item.anchor.kind === 'event' && item.anchor.markerId !== 'mk-hl');
expect(dupCutIn, '複製したカットインは複製先の見せ場を参照');
const dupPlan = buildRenderPlan(dup.project, { language: 'ja' });
expect(!dupPlan.diagnostics.some((item) => item.code === 'BROKEN_REFERENCE'), '複製後に参照切れがない');

// 同じ素材を冒頭と本編で使い、1配置だけを変更（HV-03）
const hook = dup.project.chapters.find((chapter) => chapter.role === 'hook')!;
let reuse = assignRange(dup.project, hook.sceneIds[0]!, { assetId: 'asset-a', sourceIn: 0, sourceOut: secToTicks(5) }, ids);
const hookPlacement = (reuse.scenes.find((scene) => scene.id === hook.sceneIds[0])!.content as { placementId: string }).placementId;
reuse = setPlacementRange(reuse, hookPlacement, secToTicks(1), secToTicks(3));
const mainPlacement = reuse.placements.find((item) => item.id === placementId)!;
expect(mainPlacement.role === 'main' && mainPlacement.sourceIn === 0 && mainPlacement.sourceOut === secToTicks(5), '一方の配置の変更が他方へ波及しない');

// --- 前の章を短縮・移動しても、字幕・カットインと見せ場の対応を保つ（HV-10）
const highlightBefore = resolveAnchor(project, resolveTimeline(project), { kind: 'event', markerId: 'mk-hl', offset: 0 });
const captionBefore = resolveAnchor(project, resolveTimeline(project), project.captions[0]!.anchor);
const hookChapter = project.chapters.find((chapter) => chapter.role === 'hook')!;
let shifted = assignRange(project, hookChapter.sceneIds[0]!, { assetId: 'asset-a', sourceIn: 0, sourceOut: secToTicks(4) }, ids);
// フックは 15秒の未割当 → 4秒の素材へ（前の章を短縮）
const highlightAfter = resolveAnchor(shifted, resolveTimeline(shifted), { kind: 'event', markerId: 'mk-hl', offset: 0 });
const captionAfter = resolveAnchor(shifted, resolveTimeline(shifted), shifted.captions[0]!.anchor);
expect(highlightBefore.ok && highlightAfter.ok && highlightAfter.ticks === highlightBefore.ticks - secToTicks(11), '前の章を11秒短縮すると見せ場も11秒前へ');
expect(captionBefore.ok && captionAfter.ok && captionAfter.ticks === captionBefore.ticks - secToTicks(11), '字幕も同じだけ追従');
const planShifted = buildRenderPlan(shifted, { language: 'ja', fps: 60 });
const cutin = planShifted.overlays.find((item) => item.kind === 'cutin')!;
expectEqual(cutin.from, Math.round(((highlightAfter as { ticks: number }).ticks - 144_000) / 2000), 'カットインは見せ場の1.2秒前に開始');
expectEqual(cutin.duration, 42, 'カットインは0.7秒表示（60fps）');
shifted = moveChapter(shifted, set1.id, shifted.chapterOrder.length - 1);
const moved = resolveAnchor(shifted, resolveTimeline(shifted), { kind: 'event', markerId: 'mk-hl', offset: 0 });
const movedChapter = resolveTimeline(shifted).chapterIndex[set1.id]!;
expect(moved.ok && moved.ticks === movedChapter.start + secToTicks(3), '章を移動しても見せ場は章の中で同じ位置');

// トリムで範囲外になったイベントは移動せず警告
const trimmed = setPlacementRange(project, placementId, 0, secToTicks(2));
const trimmedPlan = buildRenderPlan(trimmed, { language: 'ja' });
expect(trimmedPlan.diagnostics.some((item) => item.code === 'EVENT_OUT_OF_RANGE' && item.entity.kind === 'overlay'), 'トリムでカットインの基準が範囲外 → 警告');
expect(!trimmedPlan.overlays.some((item) => item.kind === 'cutin'), '範囲外のカットインは出力しない');

// 負の開始は警告し、0へ丸めない（HV-13）
const earlyMarker = { ...project, markers: project.markers.map((item) => (item.id === 'mk-hl' ? { ...item, at: secToTicks(0.5) } : item)) };
const hookOff = setChapterEnabled(earlyMarker, hookChapter.id, false);
const earlyPlan = buildRenderPlan(hookOff, { language: 'ja' });
expect(earlyPlan.diagnostics.some((item) => item.code === 'NEGATIVE_START'), '負の開始を検出');
expect(!earlyPlan.overlays.some((item) => item.kind === 'cutin'), '負の開始のカットインは出力しない');

// --- 削除：所有要素も一緒に削除し、外部の参照は欠落として検出
const removed = deleteScene(project, sceneWithEvent);
expect(!removed.captions.some((item) => item.id === 'cap-1'), '所有する字幕は一緒に削除');
expect(!removed.markers.some((item) => item.id === 'mk-hl'), '所有するマーカーは一緒に削除');
expect(!removed.overlays.some((item) => item.kind === 'cutin'), '見せ場に結び付いたカットインも削除');

// --- リプレイ：既定はコピーなし・原音ミュート（HV-16）
const replay = createReplay(project, sceneWithEvent, {}, ids);
const replayScene = replay.project.scenes.find((scene) => scene.id === replay.sceneId)!;
const replayPlacement = replay.project.placements.find((item) => item.id === (replayScene.content as { placementId: string }).placementId)!;
expect(replayPlacement.role === 'main' && replayPlacement.speed === 0.5, 'リプレイは既定 0.5倍');
expect(replayPlacement.role === 'main' && replayPlacement.audio.every((use) => use.muted), 'リプレイの原音は既定ミュート');
expectEqual(replay.project.captions.length, project.captions.length, 'リプレイは字幕を再発火しない');
expectEqual(replay.project.overlays.length, project.overlays.length, 'リプレイはカットインを再発火しない');
const replayWithCopy = createReplay(project, sceneWithEvent, { copy: { captions: true } }, ids);
expectEqual(replayWithCopy.project.captions.length, project.captions.length + 1, '選んだものだけコピー');
const original = replay.project.placements.find((item) => item.id === placementId)!;
expect(original.role === 'main' && original.speed === 1, 'リプレイの速度を元配置へ逆反映しない');

// --- シーン複製
const dupScene = duplicateScene(project, sceneWithEvent, ids);
expect(dupScene.project.captions.length === project.captions.length + 1, 'シーン複製で字幕も複製');

// --- 組み直し：差分を返し、割り当て済みを引き継ぐ
const rebuild = rebuildChapter(project, set1.id, 'explain-first', ids);
expect(rebuild.diff.kept.length > 0, '割り当て済みのシーンを引き継ぐ');
expect(rebuild.diff.removed.length + rebuild.diff.kept.length >= 4, '差分の一覧');

// --- 表情の重なりは上書き（分割）で解決
const scene0 = set1.sceneIds[1]!;
let avatar = placeAvatarEvent(project, { id: 'av-1', expressionId: 'E01', anchor: { kind: 'scene', sceneId: scene0, offset: 0 }, duration: secToTicks(4), motion: 'none', after: 'base', seGainDb: 0, text: {} }, ids);
avatar = placeAvatarEvent(avatar, { id: 'av-2', expressionId: 'E04', anchor: { kind: 'scene', sceneId: scene0, offset: secToTicks(1) }, duration: secToTicks(1), motion: 'bounce', after: 'base', seGainDb: 0, text: {} }, ids);
const pieces = avatar.avatarEvents.filter((item) => item.anchor.kind === 'scene' && item.anchor.sceneId === scene0);
expectEqual(pieces.length, 3, '重なった区間は前・新・後の3つに分割');
const ranges = pieces
  .map((item) => [(item.anchor as { offset: number }).offset, (item.anchor as { offset: number }).offset + item.duration])
  .sort((a, b) => a[0]! - b[0]!);
for (let index = 1; index < ranges.length; index += 1) {
  expectEqual(ranges[index]![0], ranges[index - 1]![1], '表情区間は重ならず、境界が一意');
}

console.log('long commands ok');
