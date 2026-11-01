/**
 * 横動画の書き出し検証（検証用素材を使う。HV-08・18）。
 * 実際に Remotion で書き出し、ffmpeg で次を判定する。
 *   - 2視点の同期：A の 12.0秒と B の 7.5秒のフラッシュが、主映像・PiP・拡大小窓で同じフレーム（60fps / 30fps）
 *   - 音の位置：A のクリック音が完成動画の 2.0秒（1フレーム以内）
 *   - 速度・フリーズ：2倍速の後のフリーズ区間が同じフレームのまま
 *   - 部分書き出し：全体の同じ区間とフレームが一致（PSNR）
 *
 *   npm run long:fixtures   # 初回だけ
 *   npm run check:long-render [-- --quick]   # --quick は 30fps を省く
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { bundle } from '@remotion/bundler';
import { extractAudioStream, fileStamp, probeLongMedia } from '../electron/main/services/long-media';
import { finalizeLongMedia, renderLongVideo } from '../electron/main/services/long-render';
import { startWorkspaceMediaServer } from '../electron/main/services/workspace-media-server';
import { addChapter, addFreeze, addSecondary, addZoom, assignRange, setSpeed } from '../shared/long/commands';
import { sequentialIds } from '../shared/long/ids';
import { buildRenderPlan, type RenderPlan } from '../shared/long/render-plan';
import { longProjectSchema, type LongAsset, type LongProject } from '../shared/long/schema';
import { createLongProject } from '../shared/long/templates';
import { secToTicks } from '../shared/long/time';
import { expect, expectClose, expectEqual, fail } from './long-test-utils';

const execFileAsync = promisify(execFile);
const ffmpeg = ffmpegStatic as unknown as string;
const ffprobe = ffprobeStatic.path;
const quick = process.argv.includes('--quick');
const root = path.resolve('out/long-fixtures');
const footage = path.join(root, 'library', 'footage', 'long-h0');
const projectDir = path.join(root, 'projects', 'long-render-check');
const outDir = path.join(root, 'exports', 'check-render');
const rel = (absolute: string): string => path.relative(root, absolute).split(path.sep).join('/');
const ids = sequentialIds('r');

const importAsset = async (id: string, file: string, name: string): Promise<LongAsset> => {
  const absolute = path.join(footage, file);
  const probe = await probeLongMedia(ffprobe, absolute);
  for (const stream of probe.audioStreams) {
    const out = path.join(projectDir, 'cache', 'audio', `${id}_${stream.audioIndex}.m4a`);
    await extractAudioStream(ffmpeg, absolute, stream, out);
    stream.extractedPath = rel(out);
  }
  return { id, kind: 'video', name, path: rel(absolute), probe, stamp: await fileStamp(absolute), tags: [] };
};

type Region = [number, number, number, number];
const REGIONS: Record<string, Region> = {
  main: [60, 40, 110, 60],
  pip: [140, 12, 175, 30],
  zoom: [14, 42, 46, 70],
};

/** 指定フレーム範囲の、領域ごとの平均輝度（192×108 グレー） */
const brightness = async (file: string, first: number, last: number, regions: Record<string, Region>): Promise<Array<Record<string, number>>> => {
  const { stdout } = await execFileAsync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `select='between(n\\,${first}\\,${last})',scale=192:108,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  const size = 192 * 108;
  const rows: Array<Record<string, number>> = [];
  for (let frame = 0; frame * size < stdout.length; frame += 1) {
    const row: Record<string, number> = {};
    for (const [key, [x0, y0, x1, y1]] of Object.entries(regions)) {
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += stdout[frame * size + y * 192 + x]!;
          count += 1;
        }
      }
      row[key] = sum / count;
    }
    rows.push(row);
  }
  return rows;
};

const firstBright = (rows: Array<Record<string, number>>, key: string, offset: number): number | null => {
  const index = rows.findIndex((row) => (row[key] ?? 0) > 200);
  return index < 0 ? null : offset + index;
};

/** 800Hz 以上の成分が立ち上がる時刻（クリック音） */
const clickTime = async (file: string, from: number, to: number): Promise<number | null> => {
  const { stdout } = await execFileAsync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-ss', String(from), '-to', String(to), '-i', file, '-map', '0:a:0', '-af', 'highpass=f=800,highpass=f=800', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak < 0.01) return null;
  const index = samples.findIndex((sample) => Math.abs(sample) >= peak * 0.3);
  return index < 0 ? null : from + index / 48000;
};

const psnr = async (a: string, b: string): Promise<number> => {
  const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const match = /average:([\d.]+|inf)/.exec(stderr);
  if (!match) return 0;
  return match[1] === 'inf' ? Number.POSITIVE_INFINITY : Number(match[1]);
};

const buildProject = async (): Promise<LongProject> => {
  const a = await importAsset('asset-a', 'a.mp4', 'A 投げる側');
  const b = await importAsset('asset-b', 'b.mp4', 'B 受ける側');
  // 主映像は「混合」だけを鳴らす（クリック音の位置を測る）
  for (const stream of a.probe!.audioStreams) stream.role = stream.audioIndex === 0 ? 'mixed' : 'unused';
  let project = longProjectSchema.parse({ ...createLongProject({ id: 'long-render-check', title: '書き出し検証', template: null, ids, fps: 60 }), assets: [a, b] });
  // 章1：A 10〜20秒、B を同期（A12.0 = B7.5）、マップの拡大小窓
  const ch1 = addChapter(project, 'custom', { title: '2視点' }, ids);
  project = ch1.project;
  const scene1 = project.chapters.find((item) => item.id === ch1.chapterId)!.sceneIds[0]!;
  project = assignRange(project, scene1, { assetId: 'asset-a', sourceIn: secToTicks(10), sourceOut: secToTicks(20) }, ids);
  const main1 = (project.scenes.find((item) => item.id === scene1)!.content as { placementId: string }).placementId;
  project = addSecondary(project, main1, 'asset-b', { mainAt: secToTicks(12), secondaryAt: secToTicks(7.5) }, ids).project;
  project = addZoom(project, main1, 'map', { start: secToTicks(1), end: secToTicks(6) }, ids).project;
  // 章2：A 0〜4秒を2倍速、素材1秒で0.5秒フリーズ
  const ch2 = addChapter(project, 'custom', { title: '速度・フリーズ' }, ids);
  project = ch2.project;
  const scene2 = project.chapters.find((item) => item.id === ch2.chapterId)!.sceneIds[0]!;
  project = assignRange(project, scene2, { assetId: 'asset-a', sourceIn: 0, sourceOut: secToTicks(4) }, ids);
  const main2 = (project.scenes.find((item) => item.id === scene2)!.content as { placementId: string }).placementId;
  project = setSpeed(project, main2, 2);
  project = addFreeze(project, main2, secToTicks(1), secToTicks(0.5), ids);
  // 音声：章1 の主は混合だけ、章2 は無音
  project = {
    ...project,
    placements: project.placements.map((item) =>
      item.role === 'main' ? { ...item, audio: item.id === main1 ? [{ audioIndex: 0, gainDb: 0, muted: false }] : [] } : item.role === 'secondary' ? { ...item, audio: [] } : item,
    ),
  };
  return project;
};

const main = async (): Promise<void> => {
  const missing = await fs.stat(path.join(footage, 'a.mp4')).then(() => false).catch(() => true);
  if (missing) fail('検証用素材がありません。先に npm run long:fixtures を実行してください');
  const started = Date.now();
  const project = await buildProject();
  const plan60 = buildRenderPlan(project, { language: 'ja', fps: 60 });
  expect(!plan60.diagnostics.some((item) => item.severity === 'error'), `描画計画にエラーがない：${plan60.diagnostics.map((item) => item.code).join(',')}`);
  expectEqual(plan60.durationInFrames, 600 + 150, '総フレーム数（10秒 + 2倍速2秒 + フリーズ0.5秒）');

  const serveUrl = await bundle({ entryPoint: path.resolve('remotion/index.ts'), webpackOverride: (config) => config });
  const allowed = new Set<string>();
  const collect = (plan: RenderPlan): void => {
    for (const layer of plan.layers) allowed.add(layer.src);
    for (const item of plan.audio) allowed.add(item.src);
  };
  collect(plan60);
  const server = await startWorkspaceMediaServer({ workspace: root, allowedRelativePaths: [...allowed] });
  await fs.mkdir(outDir, { recursive: true });
  try {
    // --- 60fps 全体
    const raw = path.join(outDir, 'check-60.raw.mp4');
    const wav = path.join(outDir, 'check-60.wav');
    const final = path.join(outDir, 'check-60.mp4');
    await renderLongVideo({ serveUrl, plan: plan60, mediaBaseUrl: server.url, outputPath: raw, audioTo: wav });
    await finalizeLongMedia(ffmpeg, raw, wav, final);
    const rows = await brightness(raw, 110, 130, REGIONS);
    const sync = { main: firstBright(rows, 'main', 110), pip: firstBright(rows, 'pip', 110), zoom: firstBright(rows, 'zoom', 110) };
    expectEqual(sync, { main: 120, pip: 120, zoom: 120 }, '60fps：主映像・PiP・拡大小窓のフラッシュが同じフレーム（120）');
    const click = await clickTime(final, 1.5, 2.5);
    expect(click !== null, '60fps：クリック音がある');
    expectClose(click!, 2.0, 1 / 60, '60fps：クリック音が 2.0秒（1フレーム以内）');
    // フリーズ：章2 の 0.5秒（素材1.0秒）から 0.5秒間は同じフレーム
    const freezeStart = plan60.chapters[1]!.from + 30;
    // H.264 の圧縮で静止画でも平均輝度がわずかに揺れるため、0.01 の差までは同じフレームとみなす
    const SAME = 0.01;
    const freezeRows = await brightness(final, freezeStart, freezeStart + 29, { full: [0, 0, 192, 108] });
    const spread = Math.max(...freezeRows.map((row) => Math.abs(row.full! - freezeRows[0]!.full!)));
    expect(freezeRows.length === 30 && spread <= SAME, `フリーズ区間は同じフレーム（最大差 ${spread.toFixed(4)}）`);
    // 再開直後（+30）は素材1.0秒で、フリーズと同じ絵。+31 から動く
    const afterRows = await brightness(final, freezeStart + 31, freezeStart + 33, { full: [0, 0, 192, 108] });
    expect(afterRows.some((row) => Math.abs(row.full! - freezeRows[0]!.full!) > SAME), 'フリーズの後は再び動く');

    // --- 部分書き出し：全体の 100〜179 フレームと一致
    const partial = path.join(outDir, 'check-partial.mp4');
    await renderLongVideo({ serveUrl, plan: plan60, mediaBaseUrl: server.url, outputPath: partial, frameRange: [100, 179], muted: true });
    const fullCut = path.join(outDir, 'check-fullcut.mp4');
    await execFileAsync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-vf', "select='between(n\\,100\\,179)',setpts=N/60/TB", '-an', '-fps_mode', 'passthrough', '-c:v', 'libx264', '-crf', '0', fullCut]);
    const quality = await psnr(partial, fullCut);
    expect(quality >= 40, `部分書き出しが全体の同じ区間と一致（PSNR ${quality.toFixed(1)}dB ≥ 40）`);
    expectEqual(firstBright(await brightness(partial, 15, 25, REGIONS), 'main', 15), 20, '部分書き出しは範囲の先頭を 0 に詰める（フラッシュが 20 フレーム目）');

    // --- 30fps
    if (!quick) {
      const plan30 = buildRenderPlan(project, { language: 'ja', fps: 30 });
      const raw30 = path.join(outDir, 'check-30.raw.mp4');
      const wav30 = path.join(outDir, 'check-30.wav');
      const final30 = path.join(outDir, 'check-30.mp4');
      await renderLongVideo({ serveUrl, plan: plan30, mediaBaseUrl: server.url, outputPath: raw30, audioTo: wav30 });
      await finalizeLongMedia(ffmpeg, raw30, wav30, final30);
      const rows30 = await brightness(raw30, 55, 65, REGIONS);
      expectEqual({ main: firstBright(rows30, 'main', 55), pip: firstBright(rows30, 'pip', 55), zoom: firstBright(rows30, 'zoom', 55) }, { main: 60, pip: 60, zoom: 60 }, '30fps：同期フレーム（60）');
      expectClose((await clickTime(final30, 1.5, 2.5)) ?? -1, 2.0, 1 / 30, '30fps：クリック音が 2.0秒（1フレーム以内）');
    }
  } finally {
    await server.close();
  }
  console.log(`long render ok（${Math.round((Date.now() - started) / 1000)}秒${quick ? '・30fps 省略' : ''}）`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
