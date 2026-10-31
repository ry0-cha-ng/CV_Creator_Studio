import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AudioStreamInfo, FileStamp, MediaProbe } from '../../../shared/long/schema';
import { secToTicks } from '../../../shared/long/time';

/**
 * 横動画の素材解析（Electron に依存しない）。検証スクリプトとアプリで共有する。
 */

const execFileAsync = promisify(execFile);

type FfprobeStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
  start_time?: string;
  duration?: string;
  tags?: Record<string, string>;
};

const rate = (value: string | undefined): number => {
  const [num = '0', den = '1'] = (value ?? '0/1').split('/');
  const n = Number(num);
  const d = Number(den);
  return d > 0 && Number.isFinite(n) ? n / d : 0;
};

export const probeLongMedia = async (ffprobe: string, absolutePath: string): Promise<MediaProbe> => {
  const { stdout } = await execFileAsync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,channels,sample_rate,start_time,duration:stream_tags=title,language,handler_name',
      '-of',
      'json',
      absolutePath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: FfprobeStream[] };
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('動画ストリームを読み取れませんでした');
  const fps = rate(video.r_frame_rate);
  const avgFps = rate(video.avg_frame_rate);
  const videoStart = Number(video.start_time ?? 0) || 0;
  const audioStreams: AudioStreamInfo[] = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream, audioIndex) => ({
      audioIndex,
      streamIndex: stream.index ?? 0,
      codec: stream.codec_name ?? 'unknown',
      channels: stream.channels ?? 0,
      sampleRate: Number(stream.sample_rate ?? 0) || 0,
      title: stream.tags?.title || stream.tags?.handler_name || undefined,
      language: stream.tags?.language && stream.tags.language !== 'und' ? stream.tags.language : undefined,
      startOffset: secToTicks((Number(stream.start_time ?? 0) || 0) - videoStart),
    }));
  const duration = Number(probe.format?.duration ?? video.duration ?? 0) || 0;
  return {
    durationTicks: secToTicks(duration),
    width: video.width,
    height: video.height,
    fps,
    avgFps,
    vfr: fps > 0 && avgFps > 0 && Math.abs(fps - avgFps) / fps > 0.005,
    codec: video.codec_name ?? 'unknown',
    audioStreams,
  };
};

export const fileStamp = async (absolutePath: string): Promise<FileStamp> => {
  const info = await fs.stat(absolutePath);
  return { size: info.size, mtimeMs: Math.round(info.mtimeMs) };
};

/**
 * 音声ストリームを単独のファイルへ抽出する。AAC はコピー、それ以外は AAC 192k に変換。
 * 抽出したファイルは素材時刻 − startOffset で再生する。
 */
export const extractAudioStream = async (
  ffmpeg: string,
  absoluteInput: string,
  stream: Pick<AudioStreamInfo, 'audioIndex' | 'codec'>,
  absoluteOutput: string,
): Promise<void> => {
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const temporary = `${absoluteOutput}.tmp.m4a`;
  const copy = stream.codec === 'aac';
  await execFileAsync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      absoluteInput,
      '-map',
      `0:a:${stream.audioIndex}`,
      '-vn',
      ...(copy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000']),
      '-movflags',
      '+faststart',
      temporary,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await fs.rename(temporary, absoluteOutput);
};

/** プレビュー用プロキシ（音声なし。音声は抽出ファイルで鳴らす） */
export const createLongProxy = async (
  ffmpeg: string,
  absoluteInput: string,
  absoluteOutput: string,
  onProgress?: (ratio: number) => void,
  durationSec?: number,
  signal?: AbortSignal,
): Promise<void> => {
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  const temporary = `${absoluteOutput}.tmp.mp4`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-progress',
        'pipe:1',
        '-y',
        '-i',
        absoluteInput,
        '-map',
        '0:v:0',
        '-an',
        '-vf',
        'scale=960:-2',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '25',
        '-force_key_frames',
        'expr:gte(t,n_forced*0.5)',
        '-sc_threshold',
        '0',
        '-movflags',
        '+faststart',
        temporary,
      ],
      { windowsHide: true },
    );
    const onAbort = (): void => {
      child.kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString('utf8');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (!onProgress || !durationSec) return;
      const match = /out_time_us=(\d+)/.exec(chunk.toString('utf8'));
      if (match) onProgress(Math.min(1, Number(match[1]) / 1e6 / durationSec));
    });
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) reject(new Error('キャンセルしました'));
      else if (code === 0) resolve();
      else reject(new Error(`プロキシの作成に失敗しました: ${errors.slice(-400)}`));
    });
  });
  await fs.rename(temporary, absoluteOutput);
};

/** 素材の再リンク判定：同じ素材の移動か、別素材への差し替えか */
export const compareProbe = (
  before: MediaProbe | undefined,
  after: MediaProbe,
): { same: boolean; changes: string[] } => {
  if (!before) return { same: true, changes: [] };
  const changes: string[] = [];
  if (before.width !== after.width || before.height !== after.height) changes.push(`解像度 ${before.width}×${before.height} → ${after.width}×${after.height}`);
  if (Math.abs(before.durationTicks - after.durationTicks) > secToTicks(0.05)) changes.push('長さが違います');
  if (before.audioStreams.length !== after.audioStreams.length) changes.push(`音声の本数 ${before.audioStreams.length} → ${after.audioStreams.length}`);
  if (Math.abs(before.fps - after.fps) > 0.01) changes.push(`fps ${before.fps} → ${after.fps}`);
  return { same: changes.length === 0, changes };
};
