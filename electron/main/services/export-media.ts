import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import ffmpegPathImport from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import type { CardFrameSlot } from '../../../shared/export-media';
import { hookFrameRequest } from '../../../shared/thumbnail';
import {
  cardFrameRequests,
  mezzanineDimensions,
  spanCoversFile,
  usedSourceSpan,
} from '../../../shared/export-media';
import type { Project } from '../../../shared/schema/project';
import { bgmDurationForProject, bgmPlaybackGain } from '../../../shared/timeline';
import { resolveWorkspaceFile } from './workspace-media-server';

const execFileAsync = promisify(execFile);

const unpackedPath = (binaryPath: string): string =>
  app.isPackaged ? binaryPath.replace('app.asar', 'app.asar.unpacked') : binaryPath;

export const ffmpegBinary = (): string => {
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    : ffmpegPathImport;
  if (!binary) throw new Error('FFmpegバイナリが見つかりません');
  return unpackedPath(binary);
};

const ffprobeBinary = (): string =>
  unpackedPath(
    app.isPackaged
      ? path.join(
          process.resourcesPath,
          'bin',
          process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
        )
      : ffprobeStatic.path,
  );

export const exportRenderConcurrency = (): number => {
  const cores = os.cpus().length;
  return Math.max(1, Math.min(Math.floor(cores / 2), cores - 2));
};

const ffmpegThreads = (): string => String(Math.max(1, os.cpus().length - 2));

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'item';

const relativeTo = (workspace: string, absolute: string): string =>
  path.relative(workspace, absolute).split(path.sep).join('/');

type Probe = { duration: number; width: number; height: number; hasAudio: boolean };

const probeVideo = async (absolutePath: string): Promise<Probe> => {
  const { stdout } = await execFileAsync(ffprobeBinary(), [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,width,height',
    '-of',
    'json',
    absolutePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('動画の解像度を読み取れませんでした');
  return {
    duration: Number(parsed.format?.duration ?? 0),
    width: video.width,
    height: video.height,
    hasAudio: parsed.streams?.some((stream) => stream.codec_type === 'audio') ?? false,
  };
};

/** サムネイル用。幅を 1920 以下に縮小し、それより小さい映像は拡大しない。 */
const extractThumbnailStill = async (
  input: string,
  seconds: number,
  output: string,
): Promise<void> => {
  const preroll = Math.min(2, Math.max(0, seconds));
  const fast = Math.max(0, seconds - preroll);
  const fine = seconds - fast;
  await execFileAsync(ffmpegBinary(), [
    '-y',
    '-ss',
    fast.toFixed(3),
    '-i',
    input,
    '-ss',
    fine.toFixed(3),
    '-frames:v',
    '1',
    '-an',
    '-vf',
    "scale='min(1920,iw)':-2:flags=lanczos",
    output,
  ]);
};

const extractAccurateStill = async (
  input: string,
  seconds: number,
  output: string,
): Promise<void> => {
  const preroll = Math.min(2, Math.max(0, seconds));
  const fast = Math.max(0, seconds - preroll);
  const fine = seconds - fast;
  await execFileAsync(ffmpegBinary(), [
    '-y',
    '-ss',
    fast.toFixed(3),
    '-i',
    input,
    '-ss',
    fine.toFixed(3),
    '-frames:v',
    '1',
    '-an',
    output,
  ]);
};

export type PreparedExportMedia = {
  cardFrames: Partial<Record<CardFrameSlot, string>>;
  /** サムネイル用。フック映像の静止画1枚、または画像素材のパス。 */
  hookFrame?: string;
  videoProject: Project;
  relativePaths: string[];
};

export const prepareExportMedia = async ({
  workspace,
  project,
  cards,
  video,
  thumbnail = false,
}: {
  workspace: string;
  project: Project;
  cards: boolean;
  video: boolean;
  thumbnail?: boolean;
}): Promise<PreparedExportMedia> => {
  const relativePaths: string[] = [];
  const cardFrames: Partial<Record<CardFrameSlot, string>> = {};
  let hookFrame: string | undefined;
  const frameDirectory = path.join(
    workspace,
    'projects',
    safeSegment(project.id),
    'cache',
    'export-frames',
  );
  if (thumbnail) {
    const request = hookFrameRequest(project);
    if (request?.kind === 'image') {
      hookFrame = request.assetPath;
    } else if (request?.kind === 'video') {
      const absolute = resolveWorkspaceFile(workspace, request.assetPath);
      if (!absolute) throw new Error(`素材ファイルが見つかりません: ${request.assetPath}`);
      const stat = await fs.stat(absolute);
      const key = createHash('sha1')
        .update(`${absolute}|${stat.mtimeMs}|${stat.size}|${request.sourceTime.toFixed(3)}|thumb-1920-v1`)
        .digest('hex')
        .slice(0, 20);
      await fs.mkdir(frameDirectory, { recursive: true });
      const output = path.join(frameDirectory, `hook-${key}.png`);
      try {
        await fs.access(output);
      } catch {
        await extractThumbnailStill(absolute, request.sourceTime, output);
      }
      hookFrame = relativeTo(workspace, output);
      relativePaths.push(hookFrame);
    }
  }
  if (cards) {
    const directory = frameDirectory;
    await fs.mkdir(directory, { recursive: true });
    for (const request of cardFrameRequests(project)) {
      const absolute = resolveWorkspaceFile(workspace, request.assetPath);
      if (!absolute) throw new Error(`素材ファイルが見つかりません: ${request.assetPath}`);
      const stat = await fs.stat(absolute);
      const key = createHash('sha1')
        .update(`${absolute}|${stat.mtimeMs}|${stat.size}|${request.sourceTime.toFixed(3)}|png-v1`)
        .digest('hex')
        .slice(0, 20);
      const output = path.join(directory, `${request.slot}-${key}.png`);
      try {
        await fs.access(output);
      } catch {
        await extractAccurateStill(absolute, request.sourceTime, output);
      }
      const relative = relativeTo(workspace, output);
      cardFrames[request.slot] = relative;
      relativePaths.push(relative);
    }
  }

  if (!video) return { cardFrames, hookFrame, videoProject: project, relativePaths };

  const directory = path.join(
    workspace,
    'projects',
    safeSegment(project.id),
    'cache',
    'mezzanine',
  );
  await fs.mkdir(directory, { recursive: true });
  const replacements = new Map<string, { path: string; start: number; end: number }>();
  for (const asset of project.assets) {
    if (asset.type !== 'video') continue;
    if (!usedSourceSpan(project, asset.id, Number.POSITIVE_INFINITY)) continue;
    const absolute = resolveWorkspaceFile(workspace, asset.path);
    if (!absolute) throw new Error(`素材ファイルが見つかりません: ${asset.path}`);
    const stat = await fs.stat(absolute);
    const probed = await probeVideo(absolute);
    const duration = asset.meta.duration && asset.meta.duration > 0 ? asset.meta.duration : probed.duration;
    const span = usedSourceSpan(project, asset.id, duration);
    if (!span || span.end - span.start < 0.05) continue;
    const size = mezzanineDimensions(asset.meta.width ?? probed.width, asset.meta.height ?? probed.height);
    if (!size && spanCoversFile(span, duration)) continue;
    const key = createHash('sha1')
      .update(
        [
          absolute,
          stat.mtimeMs,
          stat.size,
          span.start.toFixed(3),
          span.end.toFixed(3),
          size ? `${size.width}x${size.height}` : 'native',
          'crf14-lanczos-v1',
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 20);
    const output = path.join(directory, `${safeSegment(asset.id)}-${key}.mp4`);
    try {
      await fs.access(output);
    } catch {
      const fast = Math.max(0, span.start - Math.min(2, span.start));
      const fine = span.start - fast;
      const length = span.end - span.start;
      const args = [
        '-y',
        '-ss',
        fast.toFixed(3),
        '-i',
        absolute,
        '-ss',
        fine.toFixed(3),
        '-t',
        length.toFixed(3),
        ...(size ? ['-vf', `scale=${size.width}:${size.height}:flags=lanczos`] : []),
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '14',
        '-pix_fmt',
        'yuv420p',
        '-threads',
        ffmpegThreads(),
        ...(probed.hasAudio ? ['-c:a', 'aac', '-b:a', '256k'] : ['-an']),
        '-movflags',
        '+faststart',
        output,
      ];
      await execFileAsync(ffmpegBinary(), args);
    }
    const relative = relativeTo(workspace, output);
    replacements.set(asset.id, { path: relative, start: span.start, end: span.end });
    relativePaths.push(relative);
  }

  if (replacements.size === 0) return { cardFrames, hookFrame, videoProject: project, relativePaths };

  const videoProject = structuredClone(project);
  for (const asset of videoProject.assets) {
    const replacement = replacements.get(asset.id);
    if (replacement) asset.path = replacement.path;
  }
  for (const clip of videoProject.clips) {
    const replacement = replacements.get(clip.assetId);
    if (!replacement) continue;
    const span = Math.max(0.05, replacement.end - replacement.start);
    clip.in = Math.min(span, Math.max(0, clip.in - replacement.start));
    clip.out = Math.min(span, Math.max(clip.in + 0.05, clip.out - replacement.start));
  }
  return { cardFrames, hookFrame, videoProject, relativePaths };
};

const filterPath = (filePath: string): string =>
  filePath.replace(/\\/g, '/').replace(/:/g, '\\:');

export const mixBgmOntoVideo = async ({
  videoPath,
  bgmPath,
  outputPath,
  commandPath,
  project,
}: {
  videoPath: string;
  bgmPath: string;
  outputPath: string;
  commandPath: string;
  project: Project;
}): Promise<void> => {
  const placement = project.audio.bgm;
  if (!placement) throw new Error('BGMが設定されていません');
  const duration = bgmDurationForProject(project);
  const lines: string[] = [];
  for (let time = 0; time <= duration + 0.0001; time += 0.05) {
    const at = Math.min(time, duration);
    lines.push(`${at.toFixed(3)} volume volume ${bgmPlaybackGain(project, at).toFixed(5)}`);
  }
  await fs.writeFile(commandPath, `${lines.join('\n')}\n`, 'utf8');
  const remaining = Math.max(0, duration - Math.max(0, placement.offset));
  const loop = duration > remaining + 0.05;
  const delayMs = Math.round(placement.start * 1000);
  const filter = [
    `[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS,asendcmd=f='${filterPath(commandPath)}',volume=volume=1:eval=frame,adelay=${delayMs}|${delayMs}[bgm]`,
    '[0:a]aformat=channel_layouts=stereo[base]',
    '[base][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]',
  ].join(';');
  const args = ['-y', '-i', videoPath];
  if (loop) args.push('-stream_loop', '-1');
  args.push(
    '-ss',
    placement.offset.toFixed(3),
    '-i',
    bgmPath,
    '-filter_complex',
    filter,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    outputPath,
  );
  await execFileAsync(ffmpegBinary(), args, { maxBuffer: 10 * 1024 * 1024 });
};
