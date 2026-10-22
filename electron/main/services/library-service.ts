import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { app, dialog } from 'electron';
import ffmpegPathImport from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import {
  audioRegistrationSchema,
  audioTrackSchema,
  type AudioRegistration,
  type AudioTrack,
} from '../../../shared/schema/audio';
import { sceneKeySchema, type SceneKey } from '../../../shared/schema/project-keys';
import {
  normalizeSceneDurationDefaults,
  TRIM_DURATION_SCENES,
  clampSceneDuration,
} from '../../../shared/timeline';
import {
  BUILTIN_VIDEO_STRUCTURE_TEMPLATES,
  normalizeVideoStructureTemplates,
  videoStructureTemplateSchema,
  type VideoStructureTemplate,
} from '../../../shared/video-structure';

const getBinaryPath = (kind: 'ffmpeg' | 'ffprobe'): string => {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'bin',
      `${kind}${process.platform === 'win32' ? '.exe' : ''}`,
    );
  }
  const binary = kind === 'ffmpeg' ? ffmpegPathImport : ffprobeStatic.path;
  if (!binary) throw new Error(`${kind}バイナリが見つかりません`);
  return binary.replace('app.asar', 'app.asar.unpacked');
};

export class LibraryService {
  private database: DatabaseSync | null = null;

  constructor(private readonly getWorkspace: () => string | null) {}

  initialize(): void {
    const workspace = this.requireWorkspace();
    this.database?.close();
    this.database = new DatabaseSync(path.join(workspace, 'studio.db'));
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS audio_tracks (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        file_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audio_usage (
        id TEXT PRIMARY KEY,
        audio_track_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        variant_id TEXT NOT NULL,
        exported_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audio_usage_track_idx
        ON audio_usage(audio_track_id);
      CREATE TABLE IF NOT EXISTS studio_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  getDefaultBgmId(): string | null {
    const row = this.requireDatabase()
      .prepare('SELECT value FROM studio_settings WHERE key = ?')
      .get('defaultBgmTrackId') as { value: string } | undefined;
    return row?.value || null;
  }

  getDefaultAgentId(): string {
    if (!this.database) return 'Phoenix';
    const row = this.database
      .prepare('SELECT value FROM studio_settings WHERE key = ?')
      .get('defaultAgentId') as { value: string } | undefined;
    return row?.value || 'Phoenix';
  }

  setDefaultAgentId(agentId: string): string {
    const trimmed = agentId.trim();
    if (!/^[\p{L}\p{N} /'.-]{1,40}$/u.test(trimmed)) {
      throw new Error('不正なエージェントです');
    }
    this.requireDatabase()
      .prepare('INSERT OR REPLACE INTO studio_settings (key, value) VALUES (?, ?)')
      .run('defaultAgentId', trimmed);
    return trimmed;
  }

  getSceneDurationDefaults(): Partial<Record<SceneKey, number>> {
    if (!this.database) return {};
    const row = this.database
      .prepare('SELECT value FROM studio_settings WHERE key = ?')
      .get('sceneDurationDefaults') as { value: string } | undefined;
    if (!row?.value) return {};
    try {
      return normalizeSceneDurationDefaults(JSON.parse(row.value));
    } catch {
      return {};
    }
  }

  setSceneDurationDefault(sceneKey: string, seconds: number): Partial<Record<SceneKey, number>> {
    if (!sceneKeySchema.safeParse(sceneKey).success || !TRIM_DURATION_SCENES.includes(sceneKey as SceneKey)) {
      throw new Error('このシーンのデフォルト秒数は保存できません');
    }
    if (!Number.isFinite(seconds)) throw new Error('秒数が不正です');
    const key = sceneKey as SceneKey;
    const next = {
      ...this.getSceneDurationDefaults(),
      [key]: clampSceneDuration(key, seconds),
    };
    this.requireDatabase()
      .prepare('INSERT OR REPLACE INTO studio_settings (key, value) VALUES (?, ?)')
      .run('sceneDurationDefaults', JSON.stringify(next));
    return next;
  }

  listVideoStructureTemplates(): VideoStructureTemplate[] {
    let custom: VideoStructureTemplate[] = [];
    if (this.database) {
      const row = this.database
        .prepare('SELECT value FROM studio_settings WHERE key = ?')
        .get('videoStructureTemplates') as { value: string } | undefined;
      if (row?.value) {
        try {
          custom = normalizeVideoStructureTemplates(JSON.parse(row.value));
        } catch {
          custom = [];
        }
      }
    }
    return [
      ...BUILTIN_VIDEO_STRUCTURE_TEMPLATES.map((template) => ({
        ...template,
        sceneOrder: [...template.sceneOrder],
      })),
      ...custom,
    ];
  }

  saveVideoStructureTemplate(input: VideoStructureTemplate): VideoStructureTemplate[] {
    const template = videoStructureTemplateSchema.parse({ ...input, builtIn: false });
    if (BUILTIN_VIDEO_STRUCTURE_TEMPLATES.some((item) => item.id === template.id)) {
      throw new Error('組み込み構成テンプレートは上書きできません');
    }
    const custom = this.listVideoStructureTemplates().filter((item) => !item.builtIn);
    const next = [
      ...custom.filter((item) => item.id !== template.id),
      { ...template, builtIn: false },
    ];
    this.requireDatabase()
      .prepare('INSERT OR REPLACE INTO studio_settings (key, value) VALUES (?, ?)')
      .run('videoStructureTemplates', JSON.stringify(next));
    return this.listVideoStructureTemplates();
  }

  deleteVideoStructureTemplate(id: string): VideoStructureTemplate[] {
    if (BUILTIN_VIDEO_STRUCTURE_TEMPLATES.some((item) => item.id === id)) {
      throw new Error('組み込み構成テンプレートは削除できません');
    }
    const next = this.listVideoStructureTemplates().filter(
      (item) => !item.builtIn && item.id !== id,
    );
    this.requireDatabase()
      .prepare('INSERT OR REPLACE INTO studio_settings (key, value) VALUES (?, ?)')
      .run('videoStructureTemplates', JSON.stringify(next));
    return this.listVideoStructureTemplates();
  }

  setDefaultBgmId(trackId: string | null): string | null {
    const database = this.requireDatabase();
    if (!trackId) {
      database.prepare('DELETE FROM studio_settings WHERE key = ?').run('defaultBgmTrackId');
      return null;
    }
    const track = this.getAudio(trackId);
    if (!track || track.kind !== 'bgm') {
      throw new Error('デフォルトに設定できるBGMが見つかりません');
    }
    database
      .prepare('INSERT OR REPLACE INTO studio_settings (key, value) VALUES (?, ?)')
      .run('defaultBgmTrackId', track.id);
    return track.id;
  }

  listAudio(): AudioTrack[] {
    const rows = this.requireDatabase()
      .prepare('SELECT data FROM audio_tracks ORDER BY updated_at DESC')
      .all() as Array<{ data: string }>;
    return rows.map((row) => audioTrackSchema.parse(JSON.parse(row.data)));
  }

  getAudio(id: string): AudioTrack | null {
    const row = this.requireDatabase()
      .prepare('SELECT data FROM audio_tracks WHERE id = ?')
      .get(id) as { data: string } | undefined;
    return row ? audioTrackSchema.parse(JSON.parse(row.data)) : null;
  }

  async registerAudio(
    input: AudioRegistration,
    droppedSourcePath?: string,
  ): Promise<AudioTrack | null> {
    const registration = audioRegistrationSchema.parse(input);
    let sourcePath = droppedSourcePath;
    if (!sourcePath) {
      const result = await dialog.showOpenDialog({
        title: registration.kind === 'bgm' ? 'BGMを登録' : '効果音を登録',
        properties: ['openFile'],
        filters: [{ name: '音声', extensions: ['mp3', 'wav', 'm4a', 'ogg'] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      sourcePath = result.filePaths[0];
    }
    const extension = path.extname(sourcePath).toLowerCase();
    if (!['.mp3', '.wav', '.m4a', '.ogg'].includes(extension)) {
      throw new Error('対応している音声形式はMP3・WAV・M4A・OGGです');
    }
    const fileHash = await this.hashFile(sourcePath);
    const duplicate = this.requireDatabase()
      .prepare('SELECT data FROM audio_tracks WHERE file_hash = ?')
      .get(fileHash) as { data: string } | undefined;
    if (duplicate) {
      const track = audioTrackSchema.parse(JSON.parse(duplicate.data));
      throw new Error(`同じ音源は登録済みです: ${track.title}`);
    }

    const workspace = this.requireWorkspace();
    const directory = path.join(
      workspace,
      'library',
      registration.kind,
      registration.source,
    );
    await fs.mkdir(directory, { recursive: true });
    const id = randomUUID();
    const destinationPath = path.join(directory, `${id}${extension}`);
    await fs.copyFile(sourcePath, destinationPath);

    try {
      const analysis = await this.analyzeAudio(destinationPath);
      const now = new Date().toISOString();
      const track = audioTrackSchema.parse({
        id,
        ...registration,
        filePath: path.relative(workspace, destinationPath).split(path.sep).join('/'),
        fileHash,
        durationSec: analysis.durationSec,
        lufs: analysis.lufs,
        waveform: analysis.waveform,
        createdAt: now,
        updatedAt: now,
      });
      this.requireDatabase()
        .prepare(
          `INSERT INTO audio_tracks (id, data, file_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, JSON.stringify(track), fileHash, now, now);
      return track;
    } catch (error) {
      await fs.rm(destinationPath, { force: true });
      throw error;
    }
  }

  listUsage(): Array<{
    id: string;
    audioTrackId: string;
    projectId: string;
    variantId: string;
    exportedAt: string;
  }> {
    return this.requireDatabase()
      .prepare(
        `SELECT id, audio_track_id AS audioTrackId, project_id AS projectId,
                variant_id AS variantId, exported_at AS exportedAt
         FROM audio_usage ORDER BY exported_at DESC`,
      )
      .all() as Array<{
      id: string;
      audioTrackId: string;
      projectId: string;
      variantId: string;
      exportedAt: string;
    }>;
  }

  recordUsage(
    audioTrackId: string,
    projectId: string,
    variantId: string,
    exportedAt: string,
  ): void {
    this.requireDatabase()
      .prepare(
        `INSERT INTO audio_usage
          (id, audio_track_id, project_id, variant_id, exported_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), audioTrackId, projectId, variantId, exportedAt);
  }

  private async analyzeAudio(
    filePath: string,
  ): Promise<{ durationSec: number; lufs: number | null; waveform: number[] }> {
    const probe = await this.run(getBinaryPath('ffprobe'), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const durationSec = Number(probe.stdout.trim());
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error('音源の長さを解析できませんでした');
    }

    const loudness = await this.run(getBinaryPath('ffmpeg'), [
      '-i',
      filePath,
      '-af',
      'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
      '-f',
      'null',
      '-',
    ]);
    const lufsMatch = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(loudness.stderr);
    const lufs = lufsMatch ? Number(lufsMatch[1]) : null;

    const pcm = await this.run(getBinaryPath('ffmpeg'), [
      '-v',
      'error',
      '-i',
      filePath,
      '-ac',
      '1',
      '-ar',
      '100',
      '-f',
      'f32le',
      'pipe:1',
    ], true);
    const samples = new Float32Array(
      pcm.stdoutBuffer.buffer,
      pcm.stdoutBuffer.byteOffset,
      Math.floor(pcm.stdoutBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT),
    );
    const bucketSize = Math.max(1, Math.ceil(samples.length / 240));
    const waveform: number[] = [];
    for (let offset = 0; offset < samples.length; offset += bucketSize) {
      let peak = 0;
      for (let index = offset; index < Math.min(offset + bucketSize, samples.length); index += 1) {
        peak = Math.max(peak, Math.abs(samples[index] ?? 0));
      }
      waveform.push(Math.min(1, peak));
    }
    return { durationSec, lufs: Number.isFinite(lufs) ? lufs : null, waveform };
  }

  private run(
    executable: string,
    args: string[],
    binary = false,
  ): Promise<{ stdout: string; stderr: string; stdoutBuffer: Buffer }> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { windowsHide: true });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', reject);
      child.once('close', (code) => {
        const stdoutBuffer = Buffer.concat(stdout);
        const stderrText = Buffer.concat(stderr).toString('utf8');
        if (code !== 0) {
          reject(new Error(`音源の解析に失敗しました: ${stderrText.slice(-800)}`));
          return;
        }
        resolve({
          stdout: binary ? '' : stdoutBuffer.toString('utf8'),
          stderr: stderrText,
          stdoutBuffer,
        });
      });
    });
  }

  private hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.once('error', reject);
      stream.once('end', () => resolve(hash.digest('hex')));
    });
  }

  private requireWorkspace(): string {
    const workspace = this.getWorkspace();
    if (!workspace) throw new Error('保存先フォルダを先に選択してください');
    return workspace;
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) this.initialize();
    return this.database!;
  }
}
