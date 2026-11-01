/**
 * 横動画の出力物：総フレーム数・SRT（書き出し／取り込み）・チャプター・ファイル名・版番号・BGMの音量の線。
 *   npx tsx scripts/check-long-outputs.ts
 */
import { addChapter, assignRange, moveChapter, setPlacementRange, setSpeed, upsert } from '../shared/long/commands';
import { sequentialIds } from '../shared/long/ids';
import { buildChapters, buildSrt, longBasename, nextVersionNumber, safeFileSegment } from '../shared/long/outputs';
import { bgmCurveGain, bgmVolume, buildRenderPlan, dbToGain, type PlanBgm } from '../shared/long/render-plan';
import type { LongProject } from '../shared/long/schema';
import { applySrtImport, parseSrt, planSrtImport, type SrtImportOptions } from '../shared/long/srt';
import { secToTicks, ticksToFrame } from '../shared/long/time';
import { baseProject, expect, expectClose, expectEqual } from './long-test-utils';

const ids = sequentialIds('o');

/** 章1：A 10〜20秒（10秒）、章2：A 0〜4秒（4秒）、章3：B 0〜12秒（12秒） */
const setup = (): { project: LongProject; chapters: string[]; scenes: string[]; mains: string[] } => {
  let project = baseProject('empty');
  const chapters: string[] = [];
  const scenes: string[] = [];
  const mains: string[] = [];
  const ranges: Array<[string, number, number, string]> = [
    ['asset-a', 10, 20, '導入'],
    ['asset-a', 0, 4, '短い章'],
    ['asset-b', 0, 12, '受け側'],
  ];
  for (const [assetId, from, to, title] of ranges) {
    const chapter = addChapter(project, 'custom', { title }, ids);
    project = chapter.project;
    const sceneId = project.chapters.find((item) => item.id === chapter.chapterId)!.sceneIds[0]!;
    project = assignRange(project, sceneId, { assetId, sourceIn: secToTicks(from), sourceOut: secToTicks(to) }, ids);
    chapters.push(chapter.chapterId);
    scenes.push(sceneId);
    mains.push((project.scenes.find((item) => item.id === sceneId)!.content as { placementId: string }).placementId);
  }
  return { project, chapters, scenes, mains };
};

const caption = (id: string, anchor: LongProject['captions'][number]['anchor'], seconds: number, text: string, sceneId?: string): LongProject['captions'][number] => ({
  id,
  kind: 'speech',
  anchor,
  duration: secToTicks(seconds),
  text: { ja: text },
  excluded: [],
  style: { preset: 'subtitle', x: 0.5, y: 0.88, width: 0.8, size: 46, align: 'center', color: '#FFFFFF', accent: '#FF4655', background: false },
  sceneId,
});

// ---------------------------------------------------------------------------
// 総フレーム数
for (const fps of [60, 30] as const) {
  const { project } = setup();
  const plan = buildRenderPlan(project, { language: 'ja', fps });
  expectEqual(plan.durationInFrames, 26 * fps, `${fps}fps 総フレーム数 = 26秒`);
  expectEqual(plan.chapters.map((chapter) => [chapter.from, chapter.to]), [[0, 10 * fps], [10 * fps, 14 * fps], [14 * fps, 26 * fps]], `${fps}fps 章の境界`);
  expectEqual(plan.scenes[plan.scenes.length - 1]!.to, plan.durationInFrames, `${fps}fps 最後のシーンの終わり = 総フレーム数`);
}

// ---------------------------------------------------------------------------
// SRT の書き出し：最終フレーム時刻と一致し、配置の速度変更に追従する
{
  const { project, mains, scenes } = setup();
  let p = upsert(project, 'captions', caption('cap-1', { kind: 'source', placementId: mains[0]!, ticks: secToTicks(12) }, 1.5, 'A の12秒'));
  p = upsert(p, 'captions', caption('cap-2', { kind: 'scene', sceneId: scenes[2]!, offset: secToTicks(1) }, 2, 'B シーンの1秒後'));
  const plan = buildRenderPlan(p, { language: 'ja', fps: 60 });
  expectEqual(
    buildSrt(plan),
    '1\n00:00:02,000 --> 00:00:03,500\nA の12秒\n\n2\n00:00:15,000 --> 00:00:17,000\nB シーンの1秒後\n',
    'SRT の時刻 = 完成動画の時刻',
  );
  // 主映像を2倍速にすると、素材時刻に付いた字幕も前へ（12秒 → シーン内1秒）。後ろの章も5秒早まる
  const fast = buildRenderPlan(setSpeed(p, mains[0]!, 2), { language: 'ja', fps: 60 });
  const parsed = parseSrt(buildSrt(fast)).cues;
  expectEqual(parsed.map((cue) => cue.start), [secToTicks(1), secToTicks(10)], '2倍速後の SRT の開始');
  // 部分書き出し：範囲の先頭を 0 にし、範囲外は切る
  const partial = buildSrt(plan, { from: 2.5 * 60, to: 16 * 60 });
  expectEqual(parseSrt(partial).cues.map((cue) => [cue.start, cue.end]), [[0, secToTicks(1)], [secToTicks(12.5), secToTicks(13.5)]], '部分書き出しの SRT は範囲の先頭が 0');
  // 30fps でも同じ秒
  const plan30 = buildRenderPlan(p, { language: 'ja', fps: 30 });
  expectEqual(buildSrt(plan30), buildSrt(plan), '30fps でも SRT の時刻は同じ');
}

// ---------------------------------------------------------------------------
// SRT の読み取り
{
  const text = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>こんにちは</i>\r\n二行目\r\n\r\n00:00:03.2 --> 00:00:04.000\r\n番号なし\r\n\r\n3\r\n00:00:05,000 --> 00:00:04,000\r\n逆転\r\n\r\n4\r\nこわれた時刻\r\n\r\n5\r\n00:01:00,000 --> 00:01:01,000\r\n{\\an8}位置指定付き\r\n';
  const result = parseSrt(text);
  expectEqual(result.cues.map((cue) => [cue.start, cue.end, cue.text]), [
    [secToTicks(1), secToTicks(2.5), 'こんにちは\n二行目'],
    [secToTicks(3.2), secToTicks(4), '番号なし'],
    [secToTicks(60), secToTicks(61), '位置指定付き'],
  ], 'SRT の読み取り（BOM・CRLF・番号なし・ピリオド・タグ除去）');
  expectEqual(result.problems.length, 2, '読めないブロック（逆転・時刻なし）を報告');
  // 書き出した SRT は読み直して同じ時刻になる
  const { project, mains } = setup();
  const p = upsert(project, 'captions', caption('cap-r', { kind: 'source', placementId: mains[0]!, ticks: secToTicks(13.25) }, 0.75, '往復'));
  const plan = buildRenderPlan(p, { language: 'ja', fps: 60 });
  const round = parseSrt(buildSrt(plan)).cues[0]!;
  expectEqual([round.start, round.end, round.text], [secToTicks(3.25), secToTicks(4), '往復'], '書き出し→読み取りの往復');
}

// ---------------------------------------------------------------------------
// SRT の取り込み
{
  const { project, chapters, scenes, mains } = setup();
  const srt = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n一つ目\n\n2\n00:00:11,000 --> 00:00:12,000\n二つ目\n\n3\n00:00:30,000 --> 00:00:31,000\n範囲外\n').cues;
  const base: Omit<SrtImportOptions, 'base'> = { shift: 0, language: 'ja', kind: 'speech', mode: 'new' };

  // 完成動画の先頭基準
  const all = planSrtImport(project, srt, { ...base, base: { kind: 'project' } });
  expectEqual(all.map((item) => item.action), ['add', 'add', 'add'], '完成動画基準はすべて追加');
  expect(all[2]!.action === 'add' && Boolean(all[2]!.note), '完成動画の後ろは注意付きで追加');

  // 章基準：章2（10秒から）→ 1秒 = 全体11秒
  const ch = planSrtImport(project, srt, { ...base, base: { kind: 'chapter', chapterId: chapters[1]! } });
  expect(ch[0]!.action === 'add' && ch[0]!.at === secToTicks(11), '章基準の位置');

  // ずらす：−2秒で先頭のキューは基準より前 → 取り込まない
  const shifted = planSrtImport(project, srt, { ...base, shift: -secToTicks(2), base: { kind: 'scene', sceneId: scenes[0]! } });
  expect(shifted[0]!.action === 'skip', '負になるキューは取り込まない');
  expect(shifted[1]!.action === 'add' && shifted[1]!.at === secToTicks(9), 'ずらした位置');

  // 録画の時刻：A を使う配置（章1 は A10〜20、章2 は A0〜4）へ振り分ける
  const byAsset = planSrtImport(project, srt, { ...base, base: { kind: 'asset', assetId: 'asset-a' } });
  expectEqual(
    byAsset.map((item) => (item.action === 'add' && item.anchor.kind === 'source' ? item.anchor.placementId : item.action)),
    [mains[1], mains[0], 'skip'],
    '録画の時刻で、その素材を使う配置へ振り分ける',
  );
  expect(byAsset[0]!.action === 'add' && byAsset[0]!.at === secToTicks(11), '素材1秒 → 章2（10秒〜）の1秒後');
  expect(byAsset[1]!.action === 'add' && byAsset[1]!.at === secToTicks(1), '素材11秒 → 章1 の1秒後');

  // 反映して、章の並べ替え後も同じ発話に付いている
  const applied = applySrtImport(project, byAsset, { ...base, base: { kind: 'asset', assetId: 'asset-a' } }, ids);
  expectEqual([applied.added, applied.translated], [2, 0], '追加件数');
  const moved = moveChapter(applied.project, chapters[1]!, 0);
  const movedPlan = buildRenderPlan(moved, { language: 'ja', fps: 60 });
  expectEqual(movedPlan.captions.map((item) => [item.from, item.text]).sort((a, b) => Number(a[0]) - Number(b[0])), [[60, '一つ目'], [5 * 60, '二つ目']], '章を並べ替えても素材時刻の字幕は追従');

  // 2倍速の配置では、字幕の長さも半分
  const fast = setSpeed(project, mains[0]!, 2);
  const fastItems = planSrtImport(fast, srt, { ...base, base: { kind: 'asset', assetId: 'asset-a' } });
  expect(fastItems[1]!.action === 'add' && fastItems[1]!.duration === secToTicks(0.5), '2倍速の配置では長さも半分');

  // 訳として入れる：開始±0.5秒の既存字幕に en を足す
  const withJa = upsert(project, 'captions', caption('cap-ja', { kind: 'project', ticks: secToTicks(1.3) }, 1, '日本語'));
  const en = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nEnglish\n\n2\n00:00:05,000 --> 00:00:06,000\nNo match\n').cues;
  const translate: SrtImportOptions = { ...base, language: 'en', mode: 'translate', base: { kind: 'project' } };
  const items = planSrtImport(withJa, en, translate);
  expectEqual(items.map((item) => item.action), ['translate', 'skip'], '訳の照合（±0.5秒）');
  const translated = applySrtImport(withJa, items, translate, ids);
  expectEqual(translated.project.captions.find((item) => item.id === 'cap-ja')!.text, { ja: '日本語', en: 'English' }, '既存字幕に訳を追加し、元の言語は変えない');
  expectEqual(translated.project.captions.length, withJa.captions.length, '訳の取り込みでは字幕を増やさない');
}

// ---------------------------------------------------------------------------
// チャプター
{
  const { project } = setup();
  const plan = buildRenderPlan(project, { language: 'ja', fps: 60 });
  const draft = buildChapters(plan, project.id);
  expectEqual(draft.text, '0:00 導入\n0:10 短い章\n0:14 受け側', 'チャプター草案');
  expect(draft.diagnostics.some((item) => item.code === 'CHAPTER_TOO_CLOSE'), '10秒未満の間隔を警告');
  // 端数は切り捨て（章1 を 9.5秒にすると、章2 は 9.5秒 → 0:09）
  const { project: p2, mains } = setup();
  const shorter = buildRenderPlan(setPlacementRange(p2, mains[0]!, secToTicks(10), secToTicks(19.5)), { language: 'ja', fps: 60 });
  const entries = buildChapters(shorter, p2.id).entries;
  expectEqual(entries.map((entry) => entry.time), ['0:00', '0:09', '0:13'], '端数は切り捨て');
}

// ---------------------------------------------------------------------------
// ファイル名と版番号
{
  expectEqual(safeFileSegment(' Ascent: B/ロング? 定点*  '), 'Ascent-Bロング-定点', '使えない文字を除く');
  const date = new Date(2026, 10, 1);
  const base = (version: number): string => longBasename({ date, slug: 'ascent', language: 'ja', version });
  expectEqual(base(3), '20261101_ascent_long_ja_v3', 'ファイル名の形式');
  expectEqual(longBasename({ date, slug: '', language: 'en', version: 1, part: 'part 0-5s' }), '20261101_video_long_en_v1_part-0-5s', '空の slug・部分書き出し');
  expectEqual(nextVersionNumber([], base), 1, '最初は v1');
  expectEqual(nextVersionNumber(['20261101_ascent_long_ja_v1.mp4', '20261101_ascent_long_ja_v1.srt', '20261101_ascent_long_ja_v2_nobgm.mp4'], base), 3, '使用済みの版を避ける');
  expectEqual(nextVersionNumber(['20261101_ascent_long_ja_v10.mp4'], base), 1, 'v10 があっても v1 は空き（取り違えない）');
  expectEqual(nextVersionNumber(['.20261101_ascent_long_ja_v1.video.mp4'], base), 1, '中間ファイルは数えない');
}

// ---------------------------------------------------------------------------
// BGM の音量の線
{
  const bgm: PlanBgm = { id: 'b', src: 'x', from: 100, duration: 600, offset: 0, loop: true, trackFrames: 600, gain: dbToGain(-18), fadeIn: 0, fadeOut: 0, ducks: [], curve: [] };
  expectClose(bgmVolume(bgm, 300), dbToGain(-18), 1e-12, '点がなければ基準音量のまま');
  const curved: PlanBgm = { ...bgm, curve: [{ frame: 60, db: 0 }, { frame: 180, db: -12 }] };
  expectClose(bgmCurveGain(curved.curve, 0), 1, 1e-12, '最初の点より前は最初の値');
  expectClose(bgmCurveGain(curved.curve, 120), dbToGain(-6), 1e-12, '点の間は dB で直線補間');
  expectClose(bgmCurveGain(curved.curve, 500), dbToGain(-12), 1e-12, '最後の点より後は最後の値');
  expectClose(bgmVolume(curved, 100 + 120), dbToGain(-18) * dbToGain(-6), 1e-12, '基準音量 × 線');
  // 描画計画へ：BGM の開始からの時刻をフレームに変換し、章の移動に追従する
  const { project, chapters } = setup();
  const withBgm = upsert(project, 'bgm', {
    id: 'bgm-1',
    audioTrackId: 'bgm-main',
    anchor: { kind: 'chapter', chapterId: chapters[2]!, offset: 0 },
    duration: secToTicks(12),
    offset: 0,
    gainDb: -18,
    fadeIn: 0,
    fadeOut: 0,
    loop: true,
    volumePoints: [{ at: secToTicks(2), db: -6 }, { at: secToTicks(1), db: 0 }],
  });
  const tracks = { 'bgm-main': { filePath: 'library/se/bgm.m4a', durationSec: 30 } };
  const plan = buildRenderPlan(withBgm, { language: 'ja', fps: 60, tracks });
  expectEqual(plan.bgm[0]!.curve, [{ frame: 60, db: 0 }, { frame: 120, db: -6 }], '点は時刻順のフレームに並ぶ');
  expectEqual(plan.bgm[0]!.from, 14 * 60, '章の BGM は章の先頭から');
  const movedPlan = buildRenderPlan(moveChapter(withBgm, chapters[2]!, 0), { language: 'ja', fps: 60, tracks });
  expectEqual([movedPlan.bgm[0]!.from, movedPlan.bgm[0]!.curve], [0, plan.bgm[0]!.curve], '章を動かしても線は BGM と一緒に動く');
  expectEqual(ticksToFrame(secToTicks(2), 60), 120, '時刻 → フレーム');
}

console.log('long outputs ok');
