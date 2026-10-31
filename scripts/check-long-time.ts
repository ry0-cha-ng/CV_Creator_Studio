import { addChapter, addFreeze, addScene, assignRange, setSpeed, splitScene } from '../shared/long/commands';
import { sequentialIds } from '../shared/long/ids';
import { buildRenderPlan, resolveAnchor, resolveTimeline } from '../shared/long/render-plan';
import {
  TICKS_PER_SECOND,
  buildTimeSegments,
  formatChapterTime,
  formatSrtTime,
  frameToTicks,
  localTimeOfSource,
  parseSrtTime,
  parseTimecode,
  secToTicks,
  segmentsDuration,
  sourceTimeAt,
  ticksToFrame,
} from '../shared/long/time';
import { baseProject, expect, expectEqual } from './long-test-utils';

// --- tick の基本
expectEqual(TICKS_PER_SECOND, 120_000, 'tick 単位');
expectEqual((1001 * TICKS_PER_SECOND) / 30000, 4004, '29.97fps の1フレームが整数 tick');
expectEqual((1001 * TICKS_PER_SECOND) / 60000, 2002, '59.94fps の1フレームが整数 tick');
expectEqual((1001 * TICKS_PER_SECOND) / 24000, 5005, '23.976fps の1フレームが整数 tick');
expectEqual(frameToTicks(1, 60), 2000, '60fps の1フレーム');
expectEqual(frameToTicks(1, 30), 4000, '30fps の1フレーム');
expectEqual(ticksToFrame(1000, 60), 1, '半フレームは切り上げ');
expectEqual(ticksToFrame(999, 60), 0, '半フレーム未満は切り捨て');
expectEqual(ticksToFrame(secToTicks(600), 60), 36000, '10分 = 36000フレーム');
expectEqual(formatChapterTime(secToTicks(3725.9)), '1:02:05', 'チャプター表記');
expectEqual(formatSrtTime(secToTicks(62.345)), '00:01:02,345', 'SRT 表記');
expectEqual(parseSrtTime('00:01:02,345'), secToTicks(62.345), 'SRT 読み取り');
expectEqual(parseTimecode('1:02.5'), secToTicks(62.5), 'タイムコード入力');
expectEqual(parseTimecode('-1.2'), -secToTicks(1.2), '負のオフセット入力');
expectEqual(parseTimecode('abc'), null, '不正な入力');

// --- 速度・フリーズ
const plain = buildTimeSegments({ sourceIn: secToTicks(10), sourceOut: secToTicks(20), speed: 1, freezes: [] });
expectEqual(segmentsDuration(plain), secToTicks(10), '等速の尺');
expectEqual(sourceTimeAt(plain, secToTicks(2)), secToTicks(12), '等速の素材時刻 = sourceIn + 速度×配置内時刻');

const fast = buildTimeSegments({ sourceIn: secToTicks(10), sourceOut: secToTicks(20), speed: 2, freezes: [] });
expectEqual(segmentsDuration(fast), secToTicks(5), '2倍速の尺');
expectEqual(sourceTimeAt(fast, secToTicks(1)), secToTicks(12), '2倍速の素材時刻');

const quarter = buildTimeSegments({ sourceIn: 0, sourceOut: secToTicks(1), speed: 0.25, freezes: [] });
expectEqual(segmentsDuration(quarter), secToTicks(4), '0.25倍の尺');

const frozen = buildTimeSegments({
  sourceIn: secToTicks(10),
  sourceOut: secToTicks(20),
  speed: 1,
  freezes: [{ id: 'f1', at: secToTicks(13), duration: secToTicks(2) }],
});
expectEqual(segmentsDuration(frozen), secToTicks(12), 'フリーズ込みの尺');
expectEqual(sourceTimeAt(frozen, secToTicks(4)), secToTicks(13), 'フリーズ中は素材時刻が進まない');
expectEqual(sourceTimeAt(frozen, secToTicks(5.5)), secToTicks(13.5), 'フリーズ後に再開');
expectEqual(localTimeOfSource(frozen, secToTicks(13)), secToTicks(3), 'フリーズ地点のイベントは最初の到達で1回だけ');
expectEqual(localTimeOfSource(frozen, secToTicks(14)), secToTicks(6), 'フリーズ後のイベント');
expectEqual(localTimeOfSource(frozen, secToTicks(25)), null, '範囲外のイベントは未配置');

const frozenFast = buildTimeSegments({
  sourceIn: 0,
  sourceOut: secToTicks(8),
  speed: 2,
  freezes: [{ id: 'f', at: secToTicks(4), duration: secToTicks(1) }],
});
expectEqual(segmentsDuration(frozenFast), secToTicks(5), '2倍速＋フリーズの尺');
expectEqual(sourceTimeAt(frozenFast, secToTicks(3.5)), secToTicks(5), '2倍速＋フリーズ後の素材時刻');

// --- 丸め誤差を累積させない：1/3秒のシーンを90個
let project = baseProject('empty');
const added = addChapter(project, 'custom', {}, sequentialIds('c'));
project = added.project;
const chapter = project.chapters.find((item) => item.id === added.chapterId)!;
for (const sceneId of chapter.sceneIds) {
  project = assignRange(project, sceneId, { assetId: 'asset-a', sourceIn: 0, sourceOut: 40_000 });
}
const ids = sequentialIds('t');
for (let index = 0; index < 89; index += 1) {
  const result = addScene(project, added.chapterId, 'action', {}, ids);
  project = assignRange(result.project, result.sceneId, { assetId: 'asset-a', sourceIn: 0, sourceOut: 40_000 }, ids);
}
const timeline = resolveTimeline(project);
expectEqual(timeline.total, 90 * 40_000, '1/3秒×90 = 30秒ちょうど');
const plan60 = buildRenderPlan(project, { language: 'ja', fps: 60 });
expectEqual(plan60.durationInFrames, 1800, '30秒 = 1800フレーム（60fps）');
for (let index = 1; index < plan60.scenes.length; index += 1) {
  expectEqual(plan60.scenes[index]!.from, plan60.scenes[index - 1]!.to, 'シーン境界は前の終端と次の始端が同じフレーム');
}
const plan30 = buildRenderPlan(project, { language: 'ja', fps: 30 });
expectEqual(plan30.durationInFrames, 900, '30秒 = 900フレーム（30fps）');
const covered = plan30.layers.reduce((sum, layer) => sum + layer.pieces.reduce((s, piece) => s + piece.duration, 0), 0);
expectEqual(covered, 900, '黒フレームなし：全フレームを主映像が覆う');

// --- 分割でイベントを二重発火させない
let splitProject = baseProject('empty');
const splitChapter = addChapter(splitProject, 'custom', {}, sequentialIds('c'));
splitProject = splitChapter.project;
const sceneId = splitProject.chapters.find((item) => item.id === splitChapter.chapterId)!.sceneIds[0]!;
splitProject = assignRange(splitProject, sceneId, { assetId: 'asset-a', sourceIn: secToTicks(10), sourceOut: secToTicks(20) });
const placementId = (splitProject.scenes.find((item) => item.id === sceneId)!.content as { placementId: string }).placementId;
splitProject = {
  ...splitProject,
  markers: [{ id: 'mk-boundary', kind: 'impact', placementId, at: secToTicks(14), label: '着弾', needsReview: false }],
  se: [{ id: 'se-1', audioTrackId: 'track-se', anchor: { kind: 'event', markerId: 'mk-boundary', offset: 0 }, gainDb: 0 }],
};
const beforeSplit = resolveAnchor(splitProject, resolveTimeline(splitProject), { kind: 'event', markerId: 'mk-boundary', offset: 0 });
const split = splitScene(splitProject, sceneId, secToTicks(4), sequentialIds('s'));
const afterTimeline = resolveTimeline(split.project);
expectEqual(afterTimeline.scenes.length, 2, '分割で2シーン');
const marker = split.project.markers.find((item) => item.id === 'mk-boundary')!;
expect(marker.placementId !== placementId, '境界上のマーカーは後半に所属');
const afterSplit = resolveAnchor(split.project, afterTimeline, { kind: 'event', markerId: 'mk-boundary', offset: 0 });
expectEqual(afterSplit, beforeSplit, '分割しても見せ場の全体時刻は変わらない');
const sePlan = buildRenderPlan(split.project, {
  language: 'ja',
  tracks: { 'track-se': { filePath: 'library/se/x.wav', durationSec: 1 } },
});
expectEqual(sePlan.se.length, 1, '分割後も SE は1回だけ');

// --- 速度変更で素材基準の要素が追従
let speedProject = split.project;
const leftPlacement = (speedProject.scenes.find((item) => item.id === sceneId)!.content as { placementId: string }).placementId;
speedProject = setSpeed(speedProject, leftPlacement, 2);
const afterSpeed = resolveAnchor(speedProject, resolveTimeline(speedProject), { kind: 'event', markerId: 'mk-boundary', offset: 0 });
expect(afterSpeed.ok && afterSplit.ok && afterSpeed.ticks === afterSplit.ticks - secToTicks(2), '前のシーンを2倍速にすると見せ場が2秒前へ追従');
speedProject = addFreeze(speedProject, leftPlacement, secToTicks(11), secToTicks(1));
const afterFreeze = resolveAnchor(speedProject, resolveTimeline(speedProject), { kind: 'event', markerId: 'mk-boundary', offset: 0 });
expect(afterFreeze.ok && afterSpeed.ok && afterFreeze.ticks === afterSpeed.ticks + secToTicks(1), 'フリーズ1秒で見せ場が1秒後ろへ追従');

console.log('long time ok');
