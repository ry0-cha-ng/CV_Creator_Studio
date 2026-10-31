import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { makeCancelSignal, renderMedia, selectComposition, type CancelSignal } from '@remotion/renderer';
import type { RenderPlan } from '../../../shared/long/render-plan';

/**
 * 横動画の描画・音声後処理（Electron に依存しない）。
 * 音声のミックスは Remotion が一か所で行い、ffmpeg は最終ラウドネスと多重化だけを行う。
 */

const execFileAsync = promisify(execFile);

/** 要件定義書 v2.13.2：短尺と同じ最終ラウドネス */
export const LONG_LOUDNORM_TARGET = 'I=-36.5:TP=-9:LRA=11';

export const LONG_VIDEO_BITRATE: Record<30 | 60, string> = { 30: '12M', 60: '20M' };

export type RenderProgress = { ratio: number; renderedFrames: number; encodedFrames: number; stage: string };

export type LongRenderOptions = {
  serveUrl: string;
  plan: RenderPlan;
  mediaBaseUrl: string;
  outputPath: string;
  /** [start, end] 出力フレーム（両端含む）。部分書き出し */
  frameRange?: [number, number];
  concurrency?: number;
  /** 音声だけを WAV（PCM）で書き出す。outputPath は .wav */
  audioOnly?: boolean;
  /**
   * 音声を別の WAV に書き出す（映像ファイルは無音）。
   * Remotion の AAC 出力は先頭のプライミング（2048サンプル≒42.7ms）が補正されず音が遅れるため、
   * 横動画では必ず WAV で受け取り、ffmpeg で1回だけ AAC にする（H0 で確認）。
   */
  audioTo?: string;
  muted?: boolean;
  cancelSignal?: CancelSignal;
  onProgress?: (progress: RenderProgress) => void;
};

export const renderLongVideo = async (options: LongRenderOptions): Promise<void> => {
  const inputProps = { plan: options.plan, mediaBaseUrl: options.mediaBaseUrl, useProxy: false };
  const composition = await selectComposition({
    serveUrl: options.serveUrl,
    id: 'LongVideo',
    inputProps,
    chromiumOptions: { gl: 'swangle' },
  });
  const fps = options.plan.fps === 30 ? 30 : 60;
  await renderMedia({
    serveUrl: options.serveUrl,
    composition,
    inputProps,
    codec: options.audioOnly ? 'wav' : 'h264',
    ...(options.audioOnly || options.audioTo ? {} : { audioCodec: 'aac' as const, audioBitrate: '192k' }),
    separateAudioTo: options.audioOnly ? undefined : options.audioTo,
    ...(options.audioOnly ? {} : { videoBitrate: LONG_VIDEO_BITRATE[fps], x264Preset: 'medium' as const, pixelFormat: 'yuv420p' as const }),
    muted: options.muted ?? false,
    enforceAudioTrack: !options.muted,
    outputLocation: options.outputPath,
    frameRange: options.frameRange ?? null,
    concurrency: options.concurrency ?? null,
    chromiumOptions: { gl: 'swangle' },
    offthreadVideoThreads: 2,
    offthreadVideoCacheSizeInBytes: 1024 * 1024 * 1024,
    cancelSignal: options.cancelSignal,
    overwrite: true,
    onProgress: ({ progress, renderedFrames, encodedFrames, stitchStage }) =>
      options.onProgress?.({ ratio: progress, renderedFrames, encodedFrames, stage: stitchStage }),
  });
};

export { makeCancelSignal };

/** 実行中の ffmpeg を AbortSignal で止められる execFile */
export const runFfmpeg = (ffmpeg: string, args: string[], signal?: AbortSignal): Promise<string> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('キャンセルしました'));
      return;
    }
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    const onAbort = (): void => {
      child.kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) reject(new Error('キャンセルしました'));
      else if (code === 0) resolve(stderr);
      else reject(new Error(`FFmpeg が失敗しました: ${stderr.slice(-600)}`));
    });
  });

type LoudnormPlan = { filter: string; measuredI: number | null; normalized: boolean };

/** 1パス目：統合ラウドネスを測り、2パス目のフィルターを作る。無音などで測れないときは正規化しない。 */
const planLoudnorm = async (ffmpeg: string, audioInput: string, signal?: AbortSignal): Promise<LoudnormPlan> => {
  const first = await runFfmpeg(
    ffmpeg,
    ['-hide_banner', '-i', audioInput, '-map', '0:a:0', '-vn', '-af', `loudnorm=${LONG_LOUDNORM_TARGET}:print_format=json`, '-f', 'null', '-'],
    signal,
  );
  const match = /\{[\s\S]*"input_i"[\s\S]*\}/m.exec(first);
  const report = match ? (JSON.parse(match[0]) as Record<string, string>) : null;
  const measured = report ? Number(report.input_i) : Number.NaN;
  if (!report || !Number.isFinite(measured) || measured <= -70) {
    return { filter: 'anull', measuredI: null, normalized: false };
  }
  return {
    filter: [
      `loudnorm=${LONG_LOUDNORM_TARGET}`,
      `measured_I=${report.input_i}`,
      `measured_TP=${report.input_tp}`,
      `measured_LRA=${report.input_lra}`,
      `measured_thresh=${report.input_thresh}`,
      `offset=${report.target_offset}`,
      'linear=true',
      'print_format=summary',
    ].join(':'),
    measuredI: measured,
    normalized: true,
  };
};

/**
 * 映像（無音）と WAV を多重化し、音声に2パス loudnorm（−36.5 LUFS）をかけて AAC 192k にする。
 * AAC へのエンコードはここで1回だけ行う（ffmpeg は edit list を書くので先頭のずれが出ない）。
 */
export const finalizeLongMedia = async (
  ffmpeg: string,
  videoPath: string,
  wavPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<{ measuredI: number | null; normalized: boolean }> => {
  const plan = await planLoudnorm(ffmpeg, wavPath, signal);
  await runFfmpeg(
    ffmpeg,
    [
      '-hide_banner', '-y',
      '-i', videoPath,
      '-i', wavPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-af', plan.filter,
      '-movflags', '+faststart',
      outputPath,
    ],
    signal,
  );
  return { measuredI: plan.measuredI, normalized: plan.normalized };
};

/** 統合ラウドネスの測定（検証用） */
export const measureLoudness = async (ffmpeg: string, inputPath: string): Promise<number | null> => {
  const { stderr } = await execFileAsync(ffmpeg, ['-hide_banner', '-i', inputPath, '-map', '0:a:0', '-af', 'ebur128', '-f', 'null', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const match = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/m.exec(stderr);
  return match ? Number(match[1]) : null;
};

export const removeQuietly = async (...paths: string[]): Promise<void> => {
  await Promise.all(paths.map((item) => fs.rm(item, { force: true }).catch(() => undefined)));
};
