import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, dialog } from 'electron';
import ffmpegPathImport from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import type { ImportedVideo, MediaInfo } from '../../../shared/ipc';

const execFileAsync = promisify(execFile);

const unpackedPath = (binaryPath: string): string =>
  app.isPackaged ? binaryPath.replace('app.asar', 'app.asar.unpacked') : binaryPath;

const getFfprobePath = (): string =>
  app.isPackaged
    ? path.join(
        process.resourcesPath,
        'bin',
        process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
      )
    : ffprobeStatic.path;

const getFfmpegPath = (): string | null =>
  app.isPackaged
    ? path.join(
        process.resourcesPath,
        'bin',
        process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
      )
    : ffmpegPathImport;

export class MediaService {
  constructor(private readonly getWorkspace: () => string | null) {}

  async importVideo(projectId: string): Promise<ImportedVideo | null> {
    const result = await dialog.showOpenDialog({
      title: '録画ファイルを取り込む',
      properties: ['openFile'],
      filters: [
        { name: '動画', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const workspace = this.requireWorkspace();
    const sourcePath = result.filePaths[0];
    const safeProjectId = this.safeSegment(projectId);
    const destinationDirectory = path.join(workspace, 'library', 'footage', safeProjectId);
    await fs.mkdir(destinationDirectory, { recursive: true });

    const extension = path.extname(sourcePath).toLowerCase();
    const baseName = path
      .basename(sourcePath, extension)
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '');
    let fileName = `${baseName || 'footage'}${extension}`;
    let destinationPath = path.join(destinationDirectory, fileName);
    for (let suffix = 2; await this.exists(destinationPath); suffix += 1) {
      fileName = `${baseName || 'footage'}-${suffix}${extension}`;
      destinationPath = path.join(destinationDirectory, fileName);
    }

    await fs.copyFile(sourcePath, destinationPath);
    const loudnessEnvelope = await this.analyzeLoudnessEnvelope(destinationPath);
    return {
      sourceName: path.basename(sourcePath),
      relativePath: path.relative(workspace, destinationPath).split(path.sep).join('/'),
      meta: await this.inspectMedia(destinationPath),
      loudnessEnvelope,
    };
  }

  async inspectMedia(inputPath: string): Promise<MediaInfo> {
    const absolutePath = this.resolveWorkspacePath(inputPath);
    const { stdout } = await execFileAsync(unpackedPath(getFfprobePath()), [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of',
      'json',
      absolutePath,
    ]);
    const probe = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
      }>;
    };
    const video = probe.streams?.find((stream) => stream.codec_type === 'video');
    if (!video?.width || !video.height) {
      throw new Error('動画ストリームを読み取れませんでした');
    }
    const [numerator = '0', denominator = '1'] = (video.r_frame_rate ?? '0/1').split('/');
    return {
      duration: Number(probe.format?.duration ?? 0),
      width: video.width,
      height: video.height,
      fps: Number(numerator) / Number(denominator),
      codec: video.codec_name ?? 'unknown',
    };
  }

  async createProxy(inputPath: string, projectId: string, assetId: string): Promise<string> {
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) throw new Error('FFmpegバイナリが見つかりません');

    const workspace = this.requireWorkspace();
    const directory = path.join(
      workspace,
      'projects',
      this.safeSegment(projectId),
      'cache',
      'proxies',
    );
    await fs.mkdir(directory, { recursive: true });
    const outputPath = path.join(directory, `${this.safeSegment(assetId)}.mp4`);
    await execFileAsync(unpackedPath(ffmpegPath), [
      '-y',
      '-i',
      this.resolveWorkspacePath(inputPath),
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
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
    return path.relative(workspace, outputPath).split(path.sep).join('/');
  }

  async extractStill(
    inputPath: string,
    projectId: string,
    stillId: string,
    seconds: number,
  ): Promise<string> {
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) throw new Error('FFmpegバイナリが見つかりません');
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error('静止画の時刻が不正です');
    }
    const workspace = this.requireWorkspace();
    const directory = path.join(
      workspace,
      'projects',
      this.safeSegment(projectId),
      'stills',
    );
    await fs.mkdir(directory, { recursive: true });
    const outputPath = path.join(directory, `${this.safeSegment(stillId)}.png`);
    await execFileAsync(unpackedPath(ffmpegPath), [
      '-y',
      '-ss',
      seconds.toFixed(3),
      '-i',
      this.resolveWorkspacePath(inputPath),
      '-frames:v',
      '1',
      outputPath,
    ]);
    return path.relative(workspace, outputPath).split(path.sep).join('/');
  }

  private analyzeLoudnessEnvelope(
    inputPath: string,
  ): Promise<Array<{ time: number; level: number }>> {
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const child = spawn(
        unpackedPath(ffmpegPath),
        [
          '-v',
          'error',
          '-i',
          inputPath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '400',
          '-f',
          'f32le',
          'pipe:1',
        ],
        { windowsHide: true },
      );
      const chunks: Buffer[] = [];
      const errors: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
      child.once('error', reject);
      child.once('close', (code) => {
        if (code !== 0) {
          const message = Buffer.concat(errors).toString('utf8');
          if (/does not contain any stream|matches no streams/i.test(message)) {
            resolve([]);
            return;
          }
          reject(new Error(`ゲーム音の解析に失敗しました: ${message.slice(-500)}`));
          return;
        }
        const buffer = Buffer.concat(chunks);
        const samples = new Float32Array(
          buffer.buffer,
          buffer.byteOffset,
          Math.floor(buffer.byteLength / Float32Array.BYTES_PER_ELEMENT),
        );
        const samplesPerPoint = 20;
        const envelope: Array<{ time: number; level: number }> = [];
        for (let offset = 0; offset < samples.length; offset += samplesPerPoint) {
          let sumSquares = 0;
          const end = Math.min(offset + samplesPerPoint, samples.length);
          for (let index = offset; index < end; index += 1) {
            const sample = samples[index] ?? 0;
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / Math.max(1, end - offset));
          envelope.push({
            time: Number((offset / 400).toFixed(3)),
            level: Math.min(1, rms * 4),
          });
        }
        resolve(envelope);
      });
    });
  }

  resolveWorkspacePath(inputPath: string): string {
    const workspace = this.requireWorkspace();
    const absolutePath = path.resolve(workspace, inputPath);
    const relative = path.relative(workspace, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('保存先フォルダ外のパスは使用できません');
    }
    return absolutePath;
  }

  private requireWorkspace(): string {
    const workspace = this.getWorkspace();
    if (!workspace) throw new Error('保存先フォルダを先に選択してください');
    return workspace;
  }

  private safeSegment(value: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('不正な識別子です');
    return value;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
