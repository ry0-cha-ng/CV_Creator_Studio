/**
 * H0 技術検証：決定的な素材で、2視点＋拡大小窓＋アバター＋字幕＋音声の横動画を実際に描画し、
 * 同期フレーム・クリック音の位置・部分書き出し・BGMなし版・キャンセル・ラウドネス・所要時間を測る。
 *
 *   node scripts/generate-long-fixtures.mjs
 *   npx tsx scripts/long-h0-verify.ts [--quick]
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { bundle } from '@remotion/bundler';
import {
  extractAudioStream,
  createLongProxy,
  fileStamp,
  probeLongMedia,
} from '../electron/main/services/long-media';
import {
  finalizeLongMedia,
  makeCancelSignal,
  measureLoudness,
  renderLongVideo,
} from '../electron/main/services/long-render';
import { startWorkspaceMediaServer } from '../electron/main/services/workspace-media-server';
import {
  addChapter,
  addCutIn,
  addFreeze,
  addSecondary,
  addZoom,
  assignRange,
  setSpeed,
  upsert,
} from '../shared/long/commands';
import { sequentialIds } from '../shared/long/ids';
import { buildRenderPlan, type RenderPlan } from '../shared/long/render-plan';
import { longProjectSchema, type LongAsset, type LongProject } from '../shared/long/schema';
import { createLongProject } from '../shared/long/templates';
import { secToTicks } from '../shared/long/time';

const execFileAsync = promisify(execFile);
const ffmpeg = ffmpegStatic as unknown as string;
const ffprobe = ffprobeStatic.path;
const quick = process.argv.includes('--quick');
const root = path.resolve('out/long-fixtures');
const rel = (absolute: string): string => path.relative(root, absolute).split(path.sep).join('/');
const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9) },
};
const log = (key: string, value: unknown): void => {
  report[key] = value;
  console.log(`- ${key}: ${JSON.stringify(value)}`);
};

const ids = sequentialIds('h0');

const importAsset = async (id: string, file: string, name: string): Promise<LongAsset> => {
  const absolute = path.join(root, 'library', 'footage', 'long-h0', file);
  const probe = await probeLongMedia(ffprobe, absolute);
  for (const stream of probe.audioStreams) {
    const out = path.join(root, 'projects', 'long-h0', 'cache', 'audio', `${id}_${stream.audioIndex}.m4a`);
    await extractAudioStream(ffmpeg, absolute, stream, out);
    stream.extractedPath = rel(out);
  }
  return { id, kind: 'video', name, path: rel(absolute), probe, stamp: await fileStamp(absolute), tags: [] };
};

const copyDir = async (from: string, to: string): Promise<string[]> => {
  await fs.mkdir(to, { recursive: true });
  const names = (await fs.readdir(from)).filter((name) => name.endsWith('.png')).sort();
  for (const name of names) await fs.copyFile(path.join(from, name), path.join(to, name));
  return names.map((name) => rel(path.join(to, name)));
};

/** 指定フレーム範囲の輝度（192×108 グレー）を読み、領域ごとの平均を返す */
const brightness = async (
  file: string,
  first: number,
  last: number,
  regions: Record<string, [number, number, number, number]>,
): Promise<Array<Record<string, number>>> => {
  const { stdout } = await execFileAsync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `select='between(n\\,${first}\\,${last})',scale=192:108,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  const size = 192 * 108;
  const out: Array<Record<string, number>> = [];
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
      row[key] = Math.round(sum / count);
    }
    out.push(row);
  }
  return out;
};

const firstBright = (rows: Array<Record<string, number>>, key: string, offset: number): number | null => {
  const index = rows.findIndex((row) => (row[key] ?? 0) > 200);
  return index < 0 ? null : offset + index;
};

/** 800Hz 以上の成分のピーク時刻（クリック音） */
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
  const threshold = peak * 0.3;
  const index = samples.findIndex((sample) => Math.abs(sample) >= threshold);
  return index < 0 ? null : from + index / 48000;
};

const psnr = async (a: string, b: string): Promise<number | null> => {
  const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const match = /average:([\d.]+|inf)/.exec(stderr);
  return match ? (match[1] === 'inf' ? Number.POSITIVE_INFINITY : Number(match[1])) : null;
};

const main = async (): Promise<void> => {
  // --- 素材・アバター・カットイン
  const started = Date.now();
  const assets = [
    await importAsset('asset-a', 'a.mp4', 'A 投げる側'),
    await importAsset('asset-b', 'b.mp4', 'B 受ける側'),
    await importAsset('asset-c', 'c-noaudio.mp4', 'C 音声なし'),
    await importAsset('asset-v', 'v-vfr.mp4', 'V VFR'),
  ];
  log('probeAndExtractSec', (Date.now() - started) / 1000);
  log('probeA', { ...assets[0]!.probe, audioStreams: assets[0]!.probe!.audioStreams.map((s) => ({ i: s.audioIndex, codec: s.codec, ch: s.channels, title: s.title, startOffset: s.startOffset })) });
  log('probeVfr', { fps: assets[3]!.probe!.fps, avgFps: assets[3]!.probe!.avgFps, vfr: assets[3]!.probe!.vfr });
  const a = assets[0]!;
  a.probe!.audioStreams[0]!.role = 'mixed';
  a.probe!.audioStreams[1]!.role = 'game';
  a.probe!.audioStreams[2]!.role = 'voice';

  const avatarDir = path.join(root, 'library', 'brand', 'avatars');
  const baseFrames = await copyDir(path.resolve('resources/H1nya/frames_base'), path.join(avatarDir, 'base'));
  const cutinAbs = path.join(root, 'library', 'brand', 'cutins', 'cutin-1.png');
  await fs.mkdir(path.dirname(cutinAbs), { recursive: true });
  await fs.copyFile(path.resolve('resources/H1nya/大技前のねこカットイン-2.png'), cutinAbs);

  // --- Project
  let project: LongProject = createLongProject({ id: 'long-h0', title: 'H0 検証', template: null, ids, fps: 60 });
  project = longProjectSchema.parse({
    ...project,
    assets: [...assets, { id: 'asset-cutin', kind: 'image', name: 'カットイン', path: rel(cutinAbs), tags: [] }],
    avatarSets: [
      {
        id: 'set-base',
        name: '通常の猫',
        width: 768,
        height: 768,
        originX: 0.5,
        originY: 1,
        expressions: { E12: { kind: 'sequence', frames: baseFrames, fps: 25, loop: true } },
        offsets: {},
      },
    ],
  });
  const ch1 = addChapter(project, 'custom', { title: '2視点' }, ids);
  project = ch1.project;
  const scene1 = project.chapters.find((c) => c.id === ch1.chapterId)!.sceneIds[0]!;
  project = assignRange(project, scene1, { assetId: 'asset-a', sourceIn: secToTicks(10), sourceOut: secToTicks(20) }, ids);
  const main1 = (project.scenes.find((s) => s.id === scene1)!.content as { placementId: string }).placementId;
  project = addSecondary(project, main1, 'asset-b', { mainAt: secToTicks(12), secondaryAt: secToTicks(7.5) }, ids).project;
  project = addZoom(project, main1, 'map', { start: secToTicks(1), end: secToTicks(6) }, ids).project;
  project = upsert(project, 'markers', { id: 'mk-hl', kind: 'highlight', placementId: main1, at: secToTicks(12), label: '着弾', needsReview: false });
  project = addCutIn(project, 'mk-hl', 'asset-cutin', { lead: secToTicks(1.2), duration: secToTicks(0.7), seTrackId: 'se-click' }, ids).project;
  project = upsert(project, 'captions', {
    id: 'cap-speech',
    kind: 'speech',
    anchor: { kind: 'source', placementId: main1, ticks: secToTicks(11) },
    duration: secToTicks(1.5),
    text: { ja: 'ここ絶対通るでしょ', en: 'They always come this way' },
    excluded: [],
    style: { preset: 'subtitle', x: 0.5, y: 0.9, width: 0.8, size: 46, align: 'center', color: '#FFFFFF', accent: '#FF4655', background: false },
    sceneId: scene1,
  });
  project = upsert(project, 'overlays', {
    id: 'ov-arrow',
    kind: 'arrow',
    anchor: { kind: 'scene', sceneId: scene1, offset: secToTicks(3) },
    duration: secToTicks(2),
    target: main1,
    rect: { x: 0.35, y: 0.55, w: 0.12, h: -0.12 },
    color: '#FF4655',
    strokeWidth: 10,
    text: { ja: '着弾' },
    motion: 'pop',
    seGainDb: 0,
    sceneId: scene1,
  });
  project = upsert(project, 'avatarEvents', {
    id: 'av-ace',
    setId: 'set-base',
    expressionId: 'E12',
    anchor: { kind: 'event', markerId: 'mk-hl', offset: 0 },
    duration: secToTicks(2),
    x: 0.12,
    y: 0.97,
    height: 0.3,
    motion: 'bounce',
    after: 'hidden',
    seGainDb: 0,
    text: {},
  });
  project = upsert(project, 'ducking', { id: 'duck-1', anchor: { kind: 'event', markerId: 'mk-hl', offset: -secToTicks(0.2) }, duration: secToTicks(1.5), depthDb: -12, attack: secToTicks(0.2), release: secToTicks(0.8) });
  const ch2 = addChapter(project, 'custom', { title: '速度・フリーズ・VFR' }, ids);
  project = ch2.project;
  const ch2Scene = project.chapters.find((c) => c.id === ch2.chapterId)!.sceneIds[0]!;
  project = assignRange(project, ch2Scene, { assetId: 'asset-a', sourceIn: 0, sourceOut: secToTicks(4) }, ids);
  const main2 = (project.scenes.find((s) => s.id === ch2Scene)!.content as { placementId: string }).placementId;
  project = setSpeed(project, main2, 2);
  project = addFreeze(project, main2, secToTicks(1), secToTicks(0.5), ids);
  const more = (await import('../shared/long/commands')).addScene;
  const s3 = more(project, ch2.chapterId, 'action', {}, ids);
  project = assignRange(s3.project, s3.sceneId, { assetId: 'asset-c', sourceIn: 0, sourceOut: secToTicks(2) }, ids);
  const s4 = more(project, ch2.chapterId, 'action', {}, ids);
  project = assignRange(s4.project, s4.sceneId, { assetId: 'asset-v', sourceIn: secToTicks(3), sourceOut: secToTicks(5) }, ids);
  project = upsert(project, 'bgm', { id: 'bgm-1', audioTrackId: 'bgm-main', anchor: { kind: 'project', ticks: 0 }, duration: secToTicks(30), offset: 0, gainDb: -14, fadeIn: secToTicks(0.5), fadeOut: secToTicks(1), loop: true, volumePoints: [] });
  project = upsert(project, 'se', { id: 'se-hl', audioTrackId: 'se-click', anchor: { kind: 'event', markerId: 'mk-hl', offset: 0 }, gainDb: -6 });
  project.avatarBase = { enabled: false, expressionId: 'E01', x: 0.1, y: 0.95, height: 0.28, missing: 'hidden' };
  await fs.writeFile(path.join(root, 'projects', 'long-h0', 'long-project.json'), JSON.stringify(project, null, 2));

  const tracks = {
    'se-click': { filePath: 'library/se/long-h0/click.wav', durationSec: 0.3 },
    'bgm-main': { filePath: 'library/se/long-h0/bgm.m4a', durationSec: 30 },
  };
  const plan60 = buildRenderPlan(project, { language: 'ja', fps: 60, tracks });
  log('planDurationFrames60', plan60.durationInFrames);
  log('planDiagnostics', plan60.diagnostics.map((d) => `${d.severity}:${d.code}`));

  // --- bundle・メディアサーバー
  const bundleStart = Date.now();
  const serveUrl = await bundle({ entryPoint: path.resolve('remotion/index.ts'), webpackOverride: (config) => config });
  log('bundleSec', (Date.now() - bundleStart) / 1000);
  const allowed = new Set<string>();
  const collect = (plan: RenderPlan): void => {
    for (const layer of plan.layers) allowed.add(layer.src);
    for (const item of plan.audio) allowed.add(item.src);
    for (const item of plan.bgm) allowed.add(item.src);
    for (const item of plan.se) allowed.add(item.src);
    for (const item of plan.overlays) if (item.src) allowed.add(item.src);
    for (const item of plan.avatars) {
      if (item.media.kind === 'still') allowed.add(item.media.path);
      else for (const frame of item.media.frames) allowed.add(frame);
    }
  };
  collect(plan60);
  const server = await startWorkspaceMediaServer({ workspace: root, allowedRelativePaths: [...allowed] });
  const outDir = path.join(root, 'exports', 'h0');
  await fs.mkdir(outDir, { recursive: true });

  try {
    // --- 全体（60fps）
    const raw60 = path.join(outDir, 'h0-60.raw.mp4');
    const t60 = Date.now();
    const wav60 = path.join(outDir, 'h0-60.wav');
    await renderLongVideo({ serveUrl, plan: plan60, mediaBaseUrl: server.url, outputPath: raw60, audioTo: wav60 });
    const sec60 = (Date.now() - t60) / 1000;
    log('render60', { seconds: sec60, frames: plan60.durationInFrames, fpsRendered: Math.round((plan60.durationInFrames / sec60) * 10) / 10, estimate10minMinutes: Math.round(((36000 / plan60.durationInFrames) * sec60) / 6) / 10 });
    const final60 = path.join(outDir, 'h0-60.mp4');
    const loud = await finalizeLongMedia(ffmpeg, raw60, wav60, final60);
    log('loudnorm', { ...loud, after: await measureLoudness(ffmpeg, final60) });
    log('clickFinal60Sec', await clickTime(final60, 1.5, 2.5));
    log('clickWav60Sec', await clickTime(wav60, 1.5, 2.5));

    const regions = {
      main: [60, 40, 110, 60] as [number, number, number, number],
      pip: [140, 12, 175, 30] as [number, number, number, number],
      zoom: [14, 42, 46, 70] as [number, number, number, number],
    };
    const rows = await brightness(raw60, 110, 130, regions);
    const syncResult = {
      expectedFrame: 120,
      main: firstBright(rows, 'main', 110),
      pip: firstBright(rows, 'pip', 110),
      zoom: firstBright(rows, 'zoom', 110),
    };
    log('sync60', syncResult);

    // 速度・フリーズ：章2 の開始（10秒 = 600f）から A0〜4秒を2倍速、素材1秒で0.5秒フリーズ
    log('chapter2StartFrame', plan60.chapters[1]?.from);
    // VFR：シーン4（V の 3〜5秒）。V の 4.0秒（30fps→60fps の切り替わり）にフラッシュ
    const vfrScene = plan60.scenes[3]!;
    const vfrExpected = vfrScene.from + 60;
    const vfrRows = await brightness(final60, vfrExpected - 6, vfrExpected + 6, regions);
    log('vfr', { expectedFrame: vfrExpected, flash: firstBright(vfrRows, 'main', vfrExpected - 6) });
    // フリーズ：章2 の 0.5秒（素材1.0秒）から 0.5秒は同じフレーム
    const freezeStart = plan60.chapters[1]!.from + 30;
    const freezeRows = await brightness(final60, freezeStart - 2, freezeStart + 32, { full: [0, 0, 192, 108] });
    log('freezeFramesConstant', freezeRows.slice(2, 32).every((row) => row.full === freezeRows[2]!.full));

    // --- 部分書き出し（同じフレームを全体と比較）
    const partial = path.join(outDir, 'h0-partial.mp4');
    const tPartial = Date.now();
    await renderLongVideo({ serveUrl, plan: plan60, mediaBaseUrl: server.url, outputPath: partial, frameRange: [100, 179] });
    const fullCut = path.join(outDir, 'h0-fullcut.mp4');
    await execFileAsync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw60, '-vf', "select='between(n\\,100\\,179)',setpts=N/60/TB", '-an', '-fps_mode', 'passthrough', '-c:v', 'libx264', '-crf', '0', fullCut]);
    log('partial', { seconds: (Date.now() - tPartial) / 1000, psnrVsFull: await psnr(partial, fullCut), partialFlash: firstBright(await brightness(partial, 15, 25, regions), 'main', 15) });

    if (!quick) {
      // --- 並列数の比較（先頭300フレーム）
      const concurrencyResults: Record<string, number> = {};
      for (const concurrency of [4, 8, 12]) {
        const file = path.join(outDir, `h0-c${concurrency}.mp4`);
        const tc = Date.now();
        await renderLongVideo({ serveUrl, plan: plan60, mediaBaseUrl: server.url, outputPath: file, frameRange: [0, 299], concurrency, muted: true });
        concurrencyResults[String(concurrency)] = Math.round((300 / ((Date.now() - tc) / 1000)) * 10) / 10;
        await fs.rm(file, { force: true });
      }
      log('renderFpsByConcurrency', concurrencyResults);
      // --- 30fps
      const plan30 = buildRenderPlan(project, { language: 'ja', fps: 30, tracks });
      const raw30 = path.join(outDir, 'h0-30.raw.mp4');
      const t30 = Date.now();
      const wav30 = path.join(outDir, 'h0-30.wav');
      await renderLongVideo({ serveUrl, plan: plan30, mediaBaseUrl: server.url, outputPath: raw30, audioTo: wav30 });
      const final30 = path.join(outDir, 'h0-30.mp4');
      await finalizeLongMedia(ffmpeg, raw30, wav30, final30);
      log('render30', { seconds: (Date.now() - t30) / 1000, frames: plan30.durationInFrames });
      const rows30 = await brightness(raw30, 55, 65, regions);
      log('sync30', { expectedFrame: 60, main: firstBright(rows30, 'main', 55), pip: firstBright(rows30, 'pip', 55), zoom: firstBright(rows30, 'zoom', 55) });
      log('click30Sec', await clickTime(final30, 1.5, 2.5));

      // --- BGMなし版：音声だけ描画して映像はコピー
      const noBgmPlan = buildRenderPlan(project, { language: 'ja', fps: 60, tracks, withoutBgm: true });
      const audioOnly = path.join(outDir, 'h0-nobgm.wav');
      const tAudio = Date.now();
      await renderLongVideo({ serveUrl, plan: noBgmPlan, mediaBaseUrl: server.url, outputPath: audioOnly, audioOnly: true });
      const muxed = path.join(outDir, 'h0-nobgm.mp4');
      await finalizeLongMedia(ffmpeg, raw60, audioOnly, muxed);
      log('noBgm', { audioOnlyAndMuxSeconds: (Date.now() - tAudio) / 1000, click: await clickTime(muxed, 1.5, 2.5), loudness: await measureLoudness(ffmpeg, muxed) });

      // --- キャンセル
      const { cancelSignal, cancel } = makeCancelSignal();
      const cancelOut = path.join(outDir, 'h0-cancel.mp4');
      const tCancel = Date.now();
      setTimeout(cancel, 1500);
      let cancelled = false;
      try {
        await renderLongVideo({ serveUrl, plan: plan60, mediaBaseUrl: server.url, outputPath: cancelOut, cancelSignal });
      } catch (error) {
        cancelled = /cancel/i.test(String(error));
      }
      const leftover = await fs.stat(cancelOut).then(() => true).catch(() => false);
      log('cancel', { cancelled, afterSeconds: (Date.now() - tCancel) / 1000, leftoverFile: leftover });
      await fs.rm(cancelOut, { force: true });

      // --- プロキシ作成時間（20秒素材）
      const tProxy = Date.now();
      await createLongProxy(ffmpeg, path.join(root, a.path), path.join(root, 'projects', 'long-h0', 'cache', 'proxies', 'asset-a.mp4'));
      log('proxy20s', { seconds: (Date.now() - tProxy) / 1000 });
    }
  } finally {
    await server.close();
  }
  await fs.writeFile(path.join(root, 'h0-report.json'), JSON.stringify(report, null, 2));
  console.log(`report: ${path.join(root, 'h0-report.json')}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
