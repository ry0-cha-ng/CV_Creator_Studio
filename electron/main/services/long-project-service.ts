import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, dialog } from 'electron';
import ffmpegPathImport from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { assertProjectPersisted } from '../../../shared/project-persistence';
import { addChapter } from '../../../shared/long/commands';
import type {
  LongCreateOptions,
  LongImageImport,
  LongImportResult,
  LongMediaKind,
  LongMediaProgress,
  LongProjectSummary,
  ProjectFormatResult,
  RelinkResult,
  ShortReuseRequest,
  ShortReuseSource,
} from '../../../shared/long/ipc';
import { LONG_IMAGE_EXTENSIONS, LONG_VIDEO_EXTENSIONS } from '../../../shared/long/ipc';
import { chapterDuration } from '../../../shared/long/render-plan';
import {
  LONG_FILE_NAME,
  longProjectSchema,
  parseLongProject,
  type Candidate,
  type LongAsset,
  type LongLineup,
  type LongProject,
} from '../../../shared/long/schema';
import { createLongProject, slugify } from '../../../shared/long/templates';
import { secToTicks } from '../../../shared/long/time';
import type { Project } from '../../../shared/schema/project';
import { compareProbe, createLongProxy, extractAudioStream, fileStamp, probeLongMedia, waveformPeaks } from './long-media';
import type { ProjectService } from './project-service';

const unpacked = (binary: string): string => (app.isPackaged ? binary.replace('app.asar', 'app.asar.unpacked') : binary);

export const longFfmpeg = (): string => {
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    : (ffmpegPathImport as unknown as string | null);
  if (!binary) throw new Error('FFmpegバイナリが見つかりません');
  return unpacked(binary);
};

export const longFfprobe = (): string =>
  unpacked(
    app.isPackaged
      ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
      : ffprobeStatic.path,
  );

const VIDEO_EXTENSIONS = LONG_VIDEO_EXTENSIONS;
const IMAGE_EXTENSIONS = LONG_IMAGE_EXTENSIONS;

const safeName = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'file';

export class LongProjectService {
  private readonly proxyJobs = new Map<string, AbortController>();

  constructor(
    private readonly getWorkspace: () => string | null,
    private readonly shortProjects: ProjectService,
    private readonly emitMedia: (progress: LongMediaProgress) => void,
  ) {}

  // -------------------------------------------------------------------------
  // パス

  private workspace(): string {
    const workspace = this.getWorkspace();
    if (!workspace) throw new Error('保存先フォルダを先に選択してください');
    return workspace;
  }

  private safeId(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('不正なプロジェクトIDです');
    return id;
  }

  private projectDir(id: string): string {
    return path.join(this.workspace(), 'projects', this.safeId(id));
  }

  private filePath(id: string): string {
    return path.join(this.projectDir(id), LONG_FILE_NAME);
  }

  private relative(absolute: string): string {
    return path.relative(this.workspace(), absolute).split(path.sep).join('/');
  }

  resolve(relativePath: string): string {
    const workspace = path.resolve(this.workspace());
    const absolute = path.resolve(workspace, relativePath);
    const rel = path.relative(workspace, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('保存先フォルダ外のパスは使用できません');
    return absolute;
  }

  private async exists(absolute: string): Promise<boolean> {
    try {
      await fs.access(absolute);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // 保存・一覧

  async list(): Promise<LongProjectSummary[]> {
    const directory = path.join(this.workspace(), 'projects');
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry): Promise<LongProjectSummary | null> => {
          const file = path.join(directory, entry.name, LONG_FILE_NAME);
          if (!(await this.exists(file))) return null;
          try {
            const project = parseLongProject(JSON.parse(await fs.readFile(file, 'utf8')));
            const enabled = project.chapters.filter((chapter) => chapter.enabled);
            return {
              id: project.id,
              title: project.title,
              status: project.status,
              updatedAt: project.updatedAt,
              chapters: project.chapters.length,
              disabledChapters: project.chapters.length - enabled.length,
              durationTicks: enabled.reduce((sum, chapter) => sum + chapterDuration(project, chapter.id), 0),
              languages: project.output.languages,
              guideStep: project.editor.guideStep,
              unassigned: project.scenes.filter(
                (scene) => scene.enabled && scene.content.kind === 'empty' && enabled.some((chapter) => chapter.id === scene.chapterId),
              ).length,
            };
          } catch {
            return null;
          }
        }),
    );
    return summaries
      .filter((item): item is LongProjectSummary => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<LongProject> {
    const raw = JSON.parse(await fs.readFile(this.filePath(id), 'utf8')) as unknown;
    // 未知の新しい版は parseLongProject が拒否する（ファイルは書き換えない）
    return parseLongProject(raw);
  }

  async save(input: LongProject): Promise<LongProject> {
    const stamped = { ...input, updatedAt: new Date().toISOString() };
    const project = parseLongProject(stamped);
    const serialized = JSON.stringify(project, null, 2);
    assertProjectPersisted(stamped, JSON.parse(serialized));
    const target = this.filePath(project.id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // 最後に正常だった版を残す
    if (await this.exists(target)) await fs.copyFile(target, `${target}.bak`).catch(() => undefined);
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, serialized, 'utf8');
    await fs.rename(temporary, target);
    return project;
  }

  async create(options: LongCreateOptions): Promise<LongProject> {
    const id = randomUUID();
    let project = createLongProject({
      id,
      title: options.title,
      slug: options.slug?.trim() ? slugify(options.slug) : undefined,
      fps: options.fps,
      languages: options.languages,
      template: options.template,
    });
    if (options.inheritFromId && options.inherit?.length) {
      const source = await this.load(options.inheritFromId);
      project = this.inherit(project, source, options.inherit);
    }
    await fs.mkdir(path.join(this.projectDir(id), 'cache'), { recursive: true });
    if (options.reuse) project = await this.applyReuse(project, options.reuse);
    return this.save(project);
  }

  private inherit(project: LongProject, source: LongProject, items: Array<'audio' | 'avatars' | 'cutins'>): LongProject {
    const next = structuredClone(project);
    if (items.includes('avatars')) {
      next.avatarSets = structuredClone(source.avatarSets);
      next.avatarBase = structuredClone(source.avatarBase);
      next.reactionPresets = structuredClone(source.reactionPresets);
      next.expressions = structuredClone(source.expressions);
    }
    if (items.includes('audio')) {
      next.bgm = source.bgm.filter((item) => item.anchor.kind === 'project').map((item) => ({ ...structuredClone(item), id: `bgm-${randomUUID().slice(0, 8)}` }));
    }
    if (items.includes('cutins')) {
      const used = new Set(source.overlays.filter((item) => item.kind === 'cutin').map((item) => item.assetId));
      next.assets.push(...source.assets.filter((asset) => asset.kind === 'image' && used.has(asset.id)).map((asset) => structuredClone(asset)));
    }
    return longProjectSchema.parse(next);
  }

  async duplicate(id: string): Promise<LongProject> {
    const source = await this.load(id);
    const now = new Date().toISOString();
    const copy: LongProject = {
      ...structuredClone(source),
      id: randomUUID(),
      title: `${source.title} のコピー`,
      createdAt: now,
      updatedAt: now,
      status: 'editing',
      exports: [],
      publishing: { ...structuredClone(source.publishing), url: undefined, postedAt: undefined },
    };
    await fs.mkdir(path.join(this.projectDir(copy.id), 'cache'), { recursive: true });
    return this.save(copy);
  }

  async remove(id: string): Promise<void> {
    const directory = this.projectDir(id);
    if (!(await this.exists(path.join(directory, LONG_FILE_NAME)))) throw new Error('横動画プロジェクトが見つかりません');
    await fs.rm(directory, { recursive: true });
  }

  async projectFormat(id: string): Promise<ProjectFormatResult> {
    const directory = this.projectDir(id);
    if (await this.exists(path.join(directory, LONG_FILE_NAME))) return { format: 'long', id };
    if (await this.exists(path.join(directory, 'project.json'))) return { format: 'short', id };
    return { format: null, id };
  }

  async openProjectFile(): Promise<ProjectFormatResult | null> {
    const result = await dialog.showOpenDialog({
      title: 'プロジェクトファイルを開く',
      defaultPath: path.join(this.workspace(), 'projects'),
      properties: ['openFile'],
      filters: [{ name: 'CV Creator Studio プロジェクト', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = path.resolve(result.filePaths[0]);
    const projects = path.resolve(this.workspace(), 'projects');
    const rel = path.relative(projects, file);
    const parts = rel.split(path.sep);
    if (rel.startsWith('..') || path.isAbsolute(rel) || parts.length !== 2) {
      throw new Error('保存先の projects フォルダ内のプロジェクトを選んでください（別の場所のものは「取り込み」を使います）');
    }
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { format?: unknown; id?: unknown };
    const id = parts[0]!;
    if (raw.format === 'long') return { format: 'long', id };
    return { format: 'short', id };
  }

  // -------------------------------------------------------------------------
  // 素材

  private async pickFiles(title: string, extensions: string[], multi: boolean): Promise<string[]> {
    const result = await dialog.showOpenDialog({
      title,
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: title, extensions }],
    });
    return result.canceled ? [] : result.filePaths;
  }

  private async copyInto(source: string, directory: string): Promise<string> {
    await fs.mkdir(directory, { recursive: true });
    const extension = path.extname(source).toLowerCase();
    const base = safeName(path.basename(source, extension));
    let name = `${base}${extension}`;
    let destination = path.join(directory, name);
    for (let suffix = 2; await this.exists(destination); suffix += 1) {
      // 同じファイル（大きさ・更新時刻が同じ）なら再利用する
      const [a, b] = await Promise.all([fs.stat(source), fs.stat(destination)]);
      if (a.size === b.size && Math.round(a.mtimeMs) === Math.round(b.mtimeMs)) return destination;
      name = `${base}-${suffix}${extension}`;
      destination = path.join(directory, name);
    }
    await fs.copyFile(source, destination);
    const info = await fs.stat(source);
    await fs.utimes(destination, info.atime, info.mtime).catch(() => undefined);
    return destination;
  }

  /** 同期点合わせ用の波形（保存先フォルダ内の音声ファイルの一部区間） */
  async waveform(relativePath: string, fromTicks: number, durationTicks: number, buckets: number): Promise<number[]> {
    if (![fromTicks, durationTicks, buckets].every(Number.isFinite) || durationTicks <= 0) throw new Error('波形の範囲が不正です');
    return waveformPeaks(longFfmpeg(), this.resolve(relativePath), fromTicks / 120_000, Math.min(60, durationTicks / 120_000), buckets);
  }

  /** 音声ストリームを個別のファイルへ抽出する（プレビューと書き出しで同じファイルを使う） */
  async extractAudio(projectId: string, asset: LongAsset): Promise<LongAsset> {
    if (!asset.probe) return asset;
    const absolute = this.resolve(asset.path);
    const next = structuredClone(asset);
    for (const stream of next.probe!.audioStreams) {
      const out = path.join(this.projectDir(projectId), 'cache', 'audio', `${safeName(asset.id)}_${stream.audioIndex}.m4a`);
      if (!(await this.exists(out))) await extractAudioStream(longFfmpeg(), absolute, stream, out);
      stream.extractedPath = this.relative(out);
    }
    return next;
  }

  private async describeVideo(projectId: string, absolute: string, name: string): Promise<LongAsset> {
    const probe = await probeLongMedia(longFfprobe(), absolute);
    const asset: LongAsset = {
      id: `asset-${randomUUID().slice(0, 12)}`,
      kind: 'video',
      name,
      path: this.relative(absolute),
      probe,
      stamp: await fileStamp(absolute),
      tags: [],
    };
    return this.extractAudio(projectId, asset);
  }

  /** プレビュー用プロキシを裏で作る。完了は onMediaProgress で通知 */
  private startProxy(projectId: string, asset: LongAsset): void {
    const key = `${projectId}:${asset.id}`;
    if (this.proxyJobs.has(key)) return;
    const controller = new AbortController();
    this.proxyJobs.set(key, controller);
    const output = path.join(this.projectDir(projectId), 'cache', 'proxies', `${safeName(asset.id)}.mp4`);
    const durationSec = (asset.probe?.durationTicks ?? 0) / 120_000;
    void createLongProxy(
      longFfmpeg(),
      this.resolve(asset.path),
      output,
      (ratio) => this.emitMedia({ projectId, assetId: asset.id, stage: 'proxy', ratio }),
      durationSec,
      controller.signal,
    )
      .then(() => this.emitMedia({ projectId, assetId: asset.id, stage: 'done', ratio: 1, proxyPath: this.relative(output) }))
      .catch((error: unknown) =>
        this.emitMedia({ projectId, assetId: asset.id, stage: 'error', ratio: 0, message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => this.proxyJobs.delete(key));
  }

  async importMedia(projectId: string, kind: LongMediaKind, paths?: string[]): Promise<LongImportResult | null> {
    const files = paths?.length
      ? paths
      : await this.pickFiles(kind === 'video' ? '録画・動画を取り込む' : '画像を取り込む', kind === 'video' ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS, true);
    if (files.length === 0) return null;
    const assets: LongAsset[] = [];
    for (const file of files) {
      const extension = path.extname(file).slice(1).toLowerCase();
      if (kind === 'video') {
        if (!VIDEO_EXTENSIONS.includes(extension)) throw new Error(`動画として読み込めない形式です: ${path.basename(file)}`);
        const destination = await this.copyInto(file, path.join(this.workspace(), 'library', 'footage', this.safeId(projectId)));
        const asset = await this.describeVideo(projectId, destination, path.basename(file));
        assets.push(asset);
        this.startProxy(projectId, asset);
      } else {
        if (!IMAGE_EXTENSIONS.includes(extension)) throw new Error(`画像として読み込めない形式です: ${path.basename(file)}`);
        const destination = await this.copyInto(file, path.join(this.workspace(), 'library', 'brand', 'long', this.safeId(projectId), 'images'));
        assets.push({ id: `asset-${randomUUID().slice(0, 12)}`, kind: 'image', name: path.basename(file), path: this.relative(destination), stamp: await fileStamp(destination), tags: [] });
      }
    }
    return { assets };
  }

  async importImages(projectId: string, purpose: 'avatar' | 'cutin' | 'still', paths?: string[]): Promise<LongImageImport | null> {
    const files = paths?.length ? paths : await this.pickFiles('画像を選ぶ', IMAGE_EXTENSIONS, true);
    if (files.length === 0) return null;
    const directory = path.join(this.workspace(), 'library', 'brand', 'long', this.safeId(projectId), purpose);
    const out: LongImageImport = { paths: [], names: [] };
    for (const file of files.slice().sort()) {
      out.paths.push(this.relative(await this.copyInto(file, directory)));
      out.names.push(path.basename(file));
    }
    return out;
  }

  /** 連番PNGのフォルダを取り込む（アバターのアニメーション） */
  async importImageFolder(projectId: string): Promise<LongImageImport | null> {
    const result = await dialog.showOpenDialog({ title: '連番PNGのフォルダを選ぶ', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = result.filePaths[0];
    const names = (await fs.readdir(folder)).filter((name) => /\.png$/i.test(name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (names.length === 0) throw new Error('PNG がありません');
    const directory = path.join(this.workspace(), 'library', 'brand', 'long', this.safeId(projectId), 'avatar', safeName(path.basename(folder)));
    const out: LongImageImport = { paths: [], names: [] };
    for (const name of names) {
      out.paths.push(this.relative(await this.copyInto(path.join(folder, name), directory)));
      out.names.push(name);
    }
    return out;
  }

  /** 再リンク：別のファイルを選び、同じ素材の移動か別素材への差し替えかを判定する */
  async relink(projectId: string, asset: LongAsset): Promise<RelinkResult | null> {
    const files = await this.pickFiles(`「${asset.name}」の場所を指定`, asset.kind === 'video' ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS, false);
    if (!files[0]) return null;
    if (asset.kind === 'image') {
      const destination = await this.copyInto(files[0], path.join(this.workspace(), 'library', 'brand', 'long', this.safeId(projectId), 'images'));
      return { asset: { ...asset, path: this.relative(destination), stamp: await fileStamp(destination), missing: false }, sameMedia: true, changes: [] };
    }
    const destination = await this.copyInto(files[0], path.join(this.workspace(), 'library', 'footage', this.safeId(projectId)));
    const probe = await probeLongMedia(longFfprobe(), destination);
    const compared = compareProbe(asset.probe, probe);
    // 音声の役割は同じ番号に引き継ぐ（本数が変わったら再確認）
    for (const stream of probe.audioStreams) {
      const before = asset.probe?.audioStreams.find((item) => item.audioIndex === stream.audioIndex);
      if (before?.role && compared.same) stream.role = before.role;
    }
    let next: LongAsset = { ...asset, path: this.relative(destination), probe, stamp: await fileStamp(destination), missing: false, proxyPath: undefined };
    next = await this.extractAudio(projectId, next);
    this.startProxy(projectId, next);
    return { asset: next, sameMedia: compared.same, changes: compared.changes };
  }

  /** 見つからない素材の ID を返す */
  async checkAssets(project: LongProject): Promise<string[]> {
    const missing: string[] = [];
    for (const asset of project.assets) {
      try {
        const absolute = this.resolve(asset.path);
        if (!(await this.exists(absolute))) missing.push(asset.id);
        else if (asset.kind === 'video' && asset.proxyPath && !(await this.exists(this.resolve(asset.proxyPath)))) {
          this.startProxy(project.id, asset);
        } else if (asset.kind === 'video' && !asset.proxyPath) {
          this.startProxy(project.id, asset);
        }
      } catch {
        missing.push(asset.id);
      }
    }
    return missing;
  }

  // -------------------------------------------------------------------------
  // ショートからの再利用（元 Project は変更しない）

  async shortSources(): Promise<ShortReuseSource[]> {
    const summaries = await this.shortProjects.listProjects();
    const sources: ShortReuseSource[] = [];
    for (const summary of summaries) {
      try {
        const project = await this.shortProjects.loadProject(summary.id);
        sources.push({
          id: project.id,
          title: project.title,
          updatedAt: project.updatedAt,
          map: project.lineup.map,
          agent: project.lineup.agent,
          ability: project.lineup.ability,
          clips: project.clips.map((clip) => {
            const asset = project.assets.find((item) => item.id === clip.assetId);
            const scene = project.scenes.find((item) => item.clipId === clip.id);
            return {
              id: clip.id,
              label: scene ? scene.sceneKey : 'clip',
              assetName: asset ? path.basename(asset.path) : '不明',
              in: clip.in,
              out: clip.out,
            };
          }),
          stills: project.stills.map((still) => ({ id: still.id, label: still.role ?? still.id })),
          captions: project.captions.length,
        });
      } catch {
        continue;
      }
    }
    return sources;
  }

  private async applyReuse(project: LongProject, request: ShortReuseRequest): Promise<LongProject> {
    const source: Project = await this.shortProjects.loadProject(request.projectId);
    const importedFrom = { projectId: source.id, projectTitle: source.title, importedAt: new Date().toISOString() };
    const next = structuredClone(project);
    const assetMap = new Map<string, LongAsset>();
    for (const clipId of request.clipIds) {
      const clip = source.clips.find((item) => item.id === clipId);
      if (!clip) continue;
      let asset = assetMap.get(clip.assetId);
      if (!asset) {
        const shortAsset = source.assets.find((item) => item.id === clip.assetId);
        if (!shortAsset) continue;
        // 元動画は同じファイルを参照する（コピーしない・元 Project を変更しない）
        asset = await this.describeVideo(next.id, this.resolve(shortAsset.path), path.basename(shortAsset.path));
        asset.importedFrom = { ...importedFrom, sourceId: shortAsset.id };
        assetMap.set(clip.assetId, asset);
        next.assets.push(asset);
        this.startProxy(next.id, asset);
      }
      const scene = source.scenes.find((item) => item.clipId === clip.id);
      const candidate: Candidate = {
        id: `cand-${randomUUID().slice(0, 12)}`,
        assetId: asset.id,
        name: `${source.title}・${scene?.sceneKey ?? 'clip'}`,
        in: secToTicks(clip.in),
        out: secToTicks(clip.out),
        tags: scene?.sceneKey === 'demo' ? ['成功'] : [],
        memo: '',
        markers: [],
        lineupIds: [],
        importedFrom: { ...importedFrom, sourceId: clip.id },
      };
      next.candidates.push(candidate);
    }
    for (const stillId of request.stillIds) {
      const still = source.stills.find((item) => item.id === stillId);
      if (!still) continue;
      // 静止画は元 Project のフォルダにあるため、横動画側へコピーする
      const destination = await this.copyInto(this.resolve(still.path), path.join(this.workspace(), 'library', 'brand', 'long', this.safeId(next.id), 'stills'));
      next.assets.push({
        id: `asset-${randomUUID().slice(0, 12)}`,
        kind: 'image',
        name: `${source.title}・${still.role ?? '静止画'}`,
        path: this.relative(destination),
        stamp: await fileStamp(destination),
        tags: ['再利用'],
        importedFrom: { ...importedFrom, sourceId: still.id },
      });
    }
    if (request.lineup) {
      const lineup: LongLineup = {
        ...structuredClone(source.lineup),
        id: `lineup-${randomUUID().slice(0, 12)}`,
        title: source.title,
        importedFrom: { ...importedFrom, sourceId: source.lineup.id },
      };
      next.lineups.push(lineup);
      for (const candidate of next.candidates) if (candidate.importedFrom?.projectId === source.id) candidate.lineupIds.push(lineup.id);
      const firstSet = next.chapters.find((chapter) => chapter.role === 'set');
      if (firstSet) firstSet.lineups.push({ lineupId: lineup.id, order: 1, cue: {}, role: {} });
    }
    if (request.captions) {
      const texts = source.captions
        .filter((caption) => caption.text.ja.trim() || caption.text.en.trim())
        .map((caption) => `${caption.sceneKey}: ${caption.text.ja.trim()}${caption.text.en.trim() ? ` / ${caption.text.en.trim()}` : ''}`);
      const firstSet = next.chapters.find((chapter) => chapter.role === 'set');
      if (firstSet && texts.length > 0) {
        // 縦型の配置は持ち込まず、文言だけを章のメモとして残す
        firstSet.note = [`取り込んだテキスト（${source.title}）`, ...texts].join('\n');
      }
    }
    if (next.chapters.length === 0) {
      const added = addChapter(next, 'set', { title: source.title });
      return longProjectSchema.parse(added.project);
    }
    return longProjectSchema.parse(next);
  }
}
