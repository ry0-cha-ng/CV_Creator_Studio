/**
 * シーン内の複数カットを、実際に Remotion で描いて確かめる。
 * - カットの切れ目で、映像が別の動画に切り替わる
 * - テロップ・S4 の CTA が、同じ尺の1本のシーンと同じフレームで出る（切れ目でやり直さない）
 * - 照準マーカーはカット1にだけ出る
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { startWorkspaceMediaServer } from '../electron/main/services/workspace-media-server';
import { addCut } from '../shared/scene-cut-edit';
import { createDefaultProject, parseProject, type Project, type SceneKey } from '../shared/schema/project';
import { activeTimeline } from '../shared/timeline';

const execFileAsync = promisify(execFile);
const ffmpeg = ffmpegStatic as unknown as string;
const root = path.resolve('out/scene-cuts-fixtures');
const footage = path.join(root, 'footage');
const stills = path.join(root, 'stills');
const FPS = 30;

const fail = (message: string): never => {
  console.error(`NG: ${message}`);
  process.exit(1);
};
const expect = (ok: boolean, message: string): void => {
  if (!ok) fail(message);
  console.log(`ok: ${message}`);
};

const makeFootage = async (file: string, color: string): Promise<void> => {
  const target = path.join(footage, file);
  if (await fs.stat(target).then(() => true).catch(() => false)) return;
  await execFileAsync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=${FPS}:d=10`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart',
    target,
  ]);
};

/** S1〜S4 のクリップが暗い動画にあるプロジェクト。尺は S1 3.5 秒・S4 3.5 秒（1本のとき）。 */
const baseProject = (): Project => {
  const project = createDefaultProject('scene-cuts-render', '2026-11-02T00:00:00.000Z');
  project.templateParams.fps = FPS;
  project.assets = [
    { id: 'dark', type: 'video', path: 'footage/dark.mp4', meta: { duration: 10, width: 1920, height: 1080, fps: FPS }, loudnessEnvelope: [], tags: [], role: 'main' },
    { id: 'bright', type: 'video', path: 'footage/bright.mp4', meta: { duration: 10, width: 1920, height: 1080, fps: FPS }, loudnessEnvelope: [], tags: [] },
  ];
  const ranges: Partial<Record<SceneKey, [number, number]>> = {
    hook: [1, 4.5],
    stand: [5, 7],
    aim: [1, 4],
    throw: [2, 5.5],
  };
  for (const scene of project.scenes) {
    const range = ranges[scene.sceneKey];
    if (!range) continue;
    project.clips.push({ id: `clip-${scene.sceneKey}`, assetId: 'dark', in: range[0], out: range[1] });
    scene.clipId = `clip-${scene.sceneKey}`;
  }
  project.templateParams.sceneDurations = { hook: 3.5, stand: 2, aim: 3, throw: 3.5 };
  // S4 に CTA を出す（高評価ではなく ClutchVault 誘導）
  project.templateParams.ctaDesign = 's4-block';
  project.templateParams.s4CtaPurpose = 'cv';
  return parseProject(project);
};

/** 1本のシーンを、カット1 2.0 秒＋カット2（明るい動画）1.5 秒に分けたプロジェクト。尺の合計は同じ。 */
const withTwoCuts = (project: Project, sceneKey: SceneKey): Project => {
  const clip = project.clips.find((item) => item.id === `clip-${sceneKey}`);
  if (!clip) return fail(`${sceneKey} のクリップがない`);
  const shortened: Project = {
    ...project,
    clips: project.clips.map((item) => (item.id === clip.id ? { ...item, out: item.in + 2 } : item)),
  };
  return addCut(shortened, sceneKey, 0, { cutId: `${sceneKey}-2`, clipId: `clip-${sceneKey}-2` });
};

const hideVideo = (project: Project): Project => ({
  ...project,
  timelineMix: { ...project.timelineMix, hideVideo: true },
});

const sceneStart = (project: Project, sceneKey: SceneKey): number =>
  activeTimeline(project).items.find((item) => item.sceneKey === sceneKey)?.start ?? fail(`${sceneKey} がない`);

const main = async (): Promise<void> => {
  await fs.mkdir(footage, { recursive: true });
  await fs.mkdir(stills, { recursive: true });
  await makeFootage('dark.mp4', '0x202020');
  await makeFootage('bright.mp4', '0xE0E0E0');

  const serveUrl = await bundle({ entryPoint: path.resolve('remotion/index.ts'), webpackOverride: (config) => config });
  const server = await startWorkspaceMediaServer({
    workspace: root,
    allowedRelativePaths: ['footage/dark.mp4', 'footage/bright.mp4'],
  });

  const still = async (name: string, project: Project, frame: number): Promise<Buffer> => {
    const inputProps = { project, language: 'ja', mediaBaseUrl: server.url, useOriginalMedia: true };
    const composition = await selectComposition({ serveUrl, id: 'LineupShortStandard', inputProps });
    const output = path.join(stills, `${name}.png`);
    await renderStill({ serveUrl, composition, inputProps, frame, output, overwrite: true });
    const { stdout } = await execFileAsync(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout as unknown as Buffer;
  };
  /** 画面中央付近（映像の上・テロップの外）の平均の明るさ。 */
  const brightness = (raw: Buffer): number => {
    let sum = 0;
    let count = 0;
    for (let y = 900; y < 1000; y += 4) {
      for (let x = 400; x < 700; x += 4) {
        const index = (y * 1080 + x) * 3;
        sum += (raw[index] ?? 0) + (raw[index + 1] ?? 0) + (raw[index + 2] ?? 0);
        count += 3;
      }
    }
    return sum / count;
  };
  const maxDiff = (a: Buffer, b: Buffer): number => {
    if (a.length !== b.length) return 255;
    let max = 0;
    for (let index = 0; index < a.length; index += 1) {
      max = Math.max(max, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
    }
    return max;
  };

  try {
    // ---- 映像の切り替え（S1）
    const hookCuts = withTwoCuts(baseProject(), 'hook');
    const boundary = Math.round(2 * FPS);
    const before = brightness(await still('hook-cut1', hookCuts, boundary - 3));
    const after = brightness(await still('hook-cut2', hookCuts, boundary + 3));
    // 切れ目のフレームそのものに暗転（黒）が入らない。直前はカット1、直後はカット2の映像
    const lastOfCut1 = brightness(await still('hook-cut1-last', hookCuts, boundary - 1));
    const firstOfCut2 = brightness(await still('hook-cut2-first', hookCuts, boundary));
    expect(
      Math.abs(lastOfCut1 - before) < 8 && Math.abs(firstOfCut2 - after) < 8,
      `S1 のカットの切れ目に暗転がない（直前 ${lastOfCut1.toFixed(0)}・直後 ${firstOfCut2.toFixed(0)}）`,
    );
    expect(before < 80 && after > 150, `S1 のカットの切れ目で別の動画に切り替わる（${before.toFixed(0)} → ${after.toFixed(0)}）`);

    // ---- テロップ（S1）：映像を隠して、1本のシーンと同じフレームか
    const single = hideVideo(baseProject());
    const multi = hideVideo(hookCuts);
    for (const frame of [boundary - 1, boundary, boundary + 2, boundary + 5]) {
      const diff = maxDiff(await still(`hook-single-${frame}`, single, frame), await still(`hook-multi-${frame}`, multi, frame));
      expect(diff <= 2, `S1 のテロップが 1本のシーンと同じ（フレーム ${frame}、最大差 ${diff}）`);
    }

    // ---- S4 の CTA：シーンの合計の尺で出る
    const throwSingle = hideVideo(baseProject());
    const throwMulti = hideVideo(withTwoCuts(baseProject(), 'throw'));
    const throwStart = Math.round(sceneStart(throwSingle, 'throw') * FPS);
    expect(
      Math.round(sceneStart(throwMulti, 'throw') * FPS) === throwStart,
      'S4 の開始が同じ',
    );
    // 0.5 秒：CTA はまだ出ない／2.5 秒（カット2の中）：出ている。どちらも1本のシーンと同じ
    for (const offset of [0.5, 1.6, 2.5, 3.2]) {
      const frame = throwStart + Math.round(offset * FPS);
      const diff = maxDiff(await still(`throw-single-${offset}`, throwSingle, frame), await still(`throw-multi-${offset}`, throwMulti, frame));
      expect(diff <= 2, `S4 の CTA が 1本のシーンと同じ（シーン ${offset} 秒、最大差 ${diff}）`);
    }
    const ctaOff = await still('throw-cta-off', throwMulti, throwStart + Math.round(0.5 * FPS));
    const ctaOn = await still('throw-cta-on', throwMulti, throwStart + Math.round(2.5 * FPS));
    expect(maxDiff(ctaOff, ctaOn) > 50, 'S4 の CTA はシーンの後半で出る（検証の前提）');

    // ---- 照準マーカー（S3）：カット1だけ
    const aimSingle = hideVideo(baseProject());
    const aimMulti = hideVideo(withTwoCuts(baseProject(), 'aim'));
    const aimStart = Math.round(sceneStart(aimSingle, 'aim') * FPS);
    const inCut1 = aimStart + Math.round(1.5 * FPS);
    const inCut2 = aimStart + Math.round(2.6 * FPS);
    expect(
      maxDiff(await still('aim-single-1', aimSingle, inCut1), await still('aim-multi-1', aimMulti, inCut1)) <= 2,
      'S3 のカット1では照準マーカーが出る（1本のシーンと同じ）',
    );
    expect(
      maxDiff(await still('aim-single-2', aimSingle, inCut2), await still('aim-multi-2', aimMulti, inCut2)) > 50,
      'S3 のカット2では照準マーカーが出ない',
    );
  } finally {
    await server.close();
  }
  console.log('check:scene-cuts-render ok');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
