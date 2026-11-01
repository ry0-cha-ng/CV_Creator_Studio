import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, type WebContents } from 'electron';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { hasErrors, type Diagnostic } from '../../../shared/long/diagnostics';
import type {
  LongExportJobResult,
  LongExportPhase,
  LongExportProgress,
  LongExportRequest,
  LongExportResult,
} from '../../../shared/long/ipc';
import { buildChapters, buildLongMeta, buildPostText, buildSrt, longBasename, nextVersionNumber, type CreditTrack } from '../../../shared/long/outputs';
import { buildRenderPlan, type AudioTrackRef, type RenderPlan } from '../../../shared/long/render-plan';
import { parseLongProject, type LongLanguage, type LongProject } from '../../../shared/long/schema';
import { frameToTicks, ticksToSec } from '../../../shared/long/time';
import type { PublishedSnapshot } from '../../../shared/schema/published';
import type { AudioTrack } from '../../../shared/schema/audio';
import { fileStamp } from './long-media';
import { finalizeLongMedia, makeCancelSignal, removeQuietly, renderLongVideo, runFfmpeg } from './long-render';
import { longFfmpeg } from './long-project-service';
import { startWorkspaceMediaServer, type WorkspaceMediaServer } from './workspace-media-server';

/** 途中で失敗した言語の、完了した段階と中間ファイル */
type ResumeJob = {
  language: LongLanguage;
  basename: string;
  exportId: string;
  videoRaw: string;
  wav: string;
  noBgmWav: string;
  finalTemp: string;
  noBgmTemp: string;
  completed: LongExportPhase[];
  stamps: Record<string, { size: number; mtimeMs: number } | undefined>;
  loudness?: { measuredI: number | null; normalized: boolean };
};

/** 失敗した書き出しの再開情報（メモリ上だけ。内容・設定の照合キーが一致したときだけ使う） */
type ResumeState = {
  key: string;
  outputDir: string;
  date: string;
  done: LongExportJobResult[];
  current?: ResumeJob;
};

/**
 * 横動画の書き出し。
 * 開始時の Project を不変スナップショットとして固定し、そこから作った描画計画だけを使う。
 * 書き出し中の編集は次回の書き出しにだけ反映される。
 */
export class LongExportService {
  private serveUrl: string | null = null;
  private bundleStamp: string | null = null;
  private running: { abort: AbortController; cancelRender: () => void } | null = null;
  private resume: ResumeState | null = null;

  constructor(
    private readonly getWorkspace: () => string | null,
    private readonly getAudio: (id: string) => AudioTrack | null,
    private readonly freezeSnapshot: (snapshot: PublishedSnapshot) => void,
    private readonly recordUsage: (trackId: string, projectId: string, variantId: string) => void,
  ) {}

  cancel(): void {
    if (!this.running) return;
    this.running.abort.abort();
    this.running.cancelRender();
  }

  private workspace(): string {
    const workspace = this.getWorkspace();
    if (!workspace) throw new Error('保存先フォルダを先に選択してください');
    return workspace;
  }

  private emit(sender: WebContents, progress: LongExportProgress): void {
    if (!sender.isDestroyed()) sender.send('long:export-progress', progress);
  }

  private async hashTree(directory: string, hash: ReturnType<typeof createHash>): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await this.hashTree(full, hash);
      else {
        const info = await fs.stat(full);
        hash.update(`${full}\0${info.mtimeMs}\0${info.size}\n`);
      }
    }
  }

  private async getBundle(): Promise<string> {
    let stamp = 'packaged';
    if (!app.isPackaged) {
      const hash = createHash('sha1');
      await this.hashTree(path.join(app.getAppPath(), 'remotion'), hash);
      await this.hashTree(path.join(app.getAppPath(), 'shared'), hash);
      stamp = hash.digest('hex');
    }
    if (this.serveUrl && this.bundleStamp === stamp) return this.serveUrl;
    const entryPoint = app.isPackaged
      ? path.join(process.resourcesPath, 'remotion', 'index.ts')
      : path.join(app.getAppPath(), 'remotion', 'index.ts');
    this.serveUrl = await bundle({ entryPoint, webpackOverride: (config) => config });
    this.bundleStamp = stamp;
    return this.serveUrl;
  }

  private tracksFor(project: LongProject): Record<string, AudioTrackRef> {
    const ids = new Set<string>([
      ...project.bgm.map((item) => item.audioTrackId),
      ...project.se.map((item) => item.audioTrackId),
      ...project.overlays.map((item) => item.seTrackId).filter((id): id is string => Boolean(id)),
      ...project.avatarEvents.map((item) => item.seTrackId).filter((id): id is string => Boolean(id)),
    ]);
    const tracks: Record<string, AudioTrackRef> = {};
    for (const id of ids) {
      const track = this.getAudio(id);
      if (track) tracks[id] = { filePath: track.filePath, durationSec: track.durationSec };
    }
    return tracks;
  }

  private allowedPaths(plan: RenderPlan, extra: string[]): string[] {
    const paths = new Set<string>(extra);
    for (const layer of plan.layers) paths.add(layer.src);
    for (const still of plan.stills) if (still.src) paths.add(still.src);
    for (const item of plan.audio) paths.add(item.src);
    for (const item of plan.bgm) paths.add(item.src);
    for (const item of plan.se) paths.add(item.src);
    for (const item of plan.overlays) if (item.src) paths.add(item.src);
    for (const item of plan.avatars) {
      if (item.media.kind === 'still') paths.add(item.media.path);
      else for (const frame of item.media.frames) paths.add(frame);
    }
    return [...paths];
  }

  private async nextVersion(directory: string, base: (version: number) => string): Promise<number> {
    return nextVersionNumber(await fs.readdir(directory).catch(() => [] as string[]), base);
  }

  /** 書き出し前の検証（言語ごと）。エラーがあれば書き出さない */
  validate(project: LongProject, languages: LongLanguage[], tracks: Record<string, AudioTrackRef>): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const language of languages) {
      const plan = buildRenderPlan(project, { language, tracks });
      diagnostics.push(...plan.diagnostics.filter((item) => !item.language || item.language === language));
    }
    return diagnostics;
  }

  /** 再開の照合キー：編集画面の状態・更新日時・書き出し記録を除いた内容と、書き出し設定 */
  private resumeKey(snapshot: LongProject, request: LongExportRequest): string {
    const { editor: _editor, updatedAt: _updatedAt, exports: _exports, status: _status, ...content } = snapshot;
    const { project: _project, resume: _resume, ...settings } = request;
    return createHash('sha1').update(JSON.stringify({ content, settings })).digest('hex');
  }

  /** 保留中の再開情報を捨てる（中間ファイルを消す。完成したファイルは残す） */
  private async discardResume(): Promise<void> {
    const state = this.resume;
    this.resume = null;
    if (state?.current) {
      const job = state.current;
      await removeQuietly(job.videoRaw, job.wav, job.noBgmWav, job.finalTemp, job.noBgmTemp);
    }
  }

  private async removeOrphanTemps(directory: string): Promise<void> {
    const names = await fs.readdir(directory).catch(() => [] as string[]);
    const temps = names.filter((name) => /^\..+_long_[a-z]{2}_v\d+.*\.(video\.mp4|audio\.wav|nobgm\.wav|final\.mp4|nobgm\.mp4)$/.test(name));
    await removeQuietly(...temps.map((name) => path.join(directory, name)));
  }

  /** 開発時だけ：指定した段階で1回失敗させる（再開の確認用。CVCS_LONG_EXPORT_FAIL_ONCE=finalize など） */
  private failForTest(phase: LongExportPhase): void {
    if (app.isPackaged) return;
    if (process.env.CVCS_LONG_EXPORT_FAIL_ONCE === phase) {
      delete process.env.CVCS_LONG_EXPORT_FAIL_ONCE;
      throw new Error(`テスト用の失敗（${phase}）`);
    }
  }

  async export(request: LongExportRequest, sender: WebContents): Promise<LongExportResult> {
    if (this.running) throw new Error('別の書き出しが進行中です');
    // 不変スナップショット：以降の処理はこの値だけを使う
    const snapshot = parseLongProject(JSON.parse(JSON.stringify(request.project)));
    const languages = [...new Set(request.languages)];
    if (languages.length === 0) throw new Error('書き出す言語を選んでください');
    const workspace = this.workspace();
    const tracks = this.tracksFor(snapshot);
    const diagnostics = this.validate({ ...snapshot, output: { ...snapshot.output, fps: request.fps } }, languages, tracks);
    if (hasErrors(diagnostics)) {
      return { jobs: [], diagnostics };
    }
    // 再開：内容・設定が前回の失敗時と同じときだけ、完了した段階の成果物を使う
    const key = this.resumeKey(snapshot, request);
    const resume = request.resume && this.resume?.key === key ? this.resume : null;
    const restarted = Boolean(request.resume && !resume);
    if (!resume) await this.discardResume();
    this.resume = null;
    const reusedPhases = new Set<LongExportPhase>();

    const abort = new AbortController();
    const { cancelSignal, cancel } = makeCancelSignal();
    this.running = { abort, cancelRender: cancel };
    let server: WorkspaceMediaServer | null = null;
    const jobs: LongExportJobResult[] = [];
    let phase: LongExportPhase = 'prepare';
    let currentLanguage: LongLanguage = languages[0]!;
    let current: ResumeJob | null = null;
    const date = resume ? new Date(resume.date) : new Date();
    const outputDir = resume ? resume.outputDir : path.join(workspace, 'exports', date.toISOString().slice(0, 10));
    try {
      phase = 'bundle';
      this.emit(sender, { language: currentLanguage, phase: 'bundle', ratio: 0 });
      const serveUrl = await this.getBundle();
      // 素材の識別情報を固定（ジョブ中の差し替えを検出する）
      const stamps: Record<string, { size: number; mtimeMs: number } | undefined> = {};
      for (const asset of snapshot.assets) {
        try {
          stamps[asset.id] = await fileStamp(path.join(workspace, asset.path));
        } catch {
          stamps[asset.id] = undefined;
        }
      }
      await fs.mkdir(outputDir, { recursive: true });
      // 再開しない場合は、以前の失敗で残った中間ファイル（アプリ再起動で再開情報が消えたもの）を片付ける
      if (!resume) await this.removeOrphanTemps(outputDir);
      const plans = new Map<LongLanguage, RenderPlan>();
      for (const language of languages) {
        plans.set(
          language,
          buildRenderPlan(snapshot, {
            language,
            fps: request.fps,
            tracks,
            captionsOff: request.captionMode === 'srt',
            revision: snapshot.updatedAt,
          }),
        );
      }
      const thumbnailPaths = request.thumbnail?.kind === 'image' ? [request.thumbnail.path] : [];
      const allPaths = [...plans.values()].flatMap((plan) => this.allowedPaths(plan, thumbnailPaths));
      if (request.withoutBgm) {
        for (const language of languages) {
          allPaths.push(...this.allowedPaths(buildRenderPlan(snapshot, { language, fps: request.fps, tracks, withoutBgm: true }), []));
        }
      }
      server = await startWorkspaceMediaServer({ workspace, allowedRelativePaths: [...new Set(allPaths)] });
      const ffmpeg = longFfmpeg();
      const credits: CreditTrack[] = Object.keys(tracks)
        .map((id) => this.getAudio(id))
        .filter((track): track is AudioTrack => track !== null)
        .map((track) => ({ title: track.title, artist: track.artist, creditRequired: track.creditRequired, creditText: track.creditText }));
      const sameStamps = (before: ResumeJob['stamps']): boolean =>
        snapshot.assets.every((asset) => {
          const a = before[asset.id];
          const b = stamps[asset.id];
          return (!a && !b) || (a !== undefined && b !== undefined && a.size === b.size && a.mtimeMs === b.mtimeMs);
        });
      const exists = (file: string): Promise<boolean> => fs.stat(file).then(() => true).catch(() => false);

      for (const language of languages) {
        currentLanguage = language;
        // 前回完了した言語は書き出し直さない
        const done = resume?.done.find((job) => job.language === language);
        if (done && (await exists(path.join(workspace, done.files[0] ?? '')))) {
          jobs.push({ ...done, reused: true });
          reusedPhases.add('done');
          continue;
        }
        const plan = plans.get(language)!;
        const range = request.range
          ? {
              from: Math.max(0, Math.min(request.range.from, plan.durationInFrames - 1)),
              to: Math.max(1, Math.min(request.range.to, plan.durationInFrames)),
            }
          : undefined;
        if (range && range.to <= range.from) throw new Error('部分書き出しの範囲が不正です');
        const pending = resume?.current?.language === language ? resume.current : null;
        const partLabel = range ? `part_${Math.round(ticksToSec(frameToTicks(range.from, plan.fps)))}-${Math.round(ticksToSec(frameToTicks(range.to, plan.fps)))}s` : undefined;
        const basename = pending
          ? pending.basename
          : longBasename({
              date,
              slug: snapshot.slug || snapshot.title,
              language,
              version: await this.nextVersion(outputDir, (n) => longBasename({ date, slug: snapshot.slug || snapshot.title, language, version: n, part: partLabel })),
              part: partLabel,
            });
        const temp = (suffix: string): string => path.join(outputDir, `.${basename}.${suffix}`);
        current = pending
          ? { ...pending, completed: [...pending.completed] }
          : {
              language,
              basename,
              exportId: randomUUID(),
              videoRaw: temp('video.mp4'),
              wav: temp('audio.wav'),
              noBgmWav: temp('nobgm.wav'),
              finalTemp: temp('final.mp4'),
              noBgmTemp: temp('nobgm.mp4'),
              completed: [],
              stamps,
            };
        const job = current;
        const files: string[] = [];
        const startedAt = Date.now();

        // 1. 映像と音声の描画（前回の中間ファイルが揃い、素材が変わっていなければ使う）
        phase = 'render';
        if (job.completed.includes('render') && sameStamps(job.stamps) && (await exists(job.videoRaw)) && (await exists(job.wav))) {
          reusedPhases.add('render');
        } else {
          job.completed = [];
          job.stamps = stamps;
          this.emit(sender, { language, phase: 'render', ratio: 0 });
          this.failForTest('render');
          await renderLongVideo({
            serveUrl,
            plan,
            mediaBaseUrl: server.url,
            outputPath: job.videoRaw,
            audioTo: job.wav,
            frameRange: range ? [range.from, range.to - 1] : undefined,
            cancelSignal,
            onProgress: (progress) => {
              const elapsed = (Date.now() - startedAt) / 1000;
              const remainingSec = progress.ratio > 0.02 ? Math.round((elapsed / progress.ratio) * (1 - progress.ratio)) : undefined;
              this.emit(sender, { language, phase: 'render', ratio: progress.ratio, remainingSec });
            },
          });
          await this.assertStamps(snapshot, stamps, workspace);
          job.completed.push('render');
        }

        // 2. 音量の調整と合成
        phase = 'finalize';
        if (job.completed.includes('finalize') && job.loudness && (await exists(job.finalTemp))) {
          reusedPhases.add('finalize');
        } else {
          this.emit(sender, { language, phase: 'finalize', ratio: 0 });
          this.failForTest('finalize');
          job.loudness = await finalizeLongMedia(ffmpeg, job.videoRaw, job.wav, job.finalTemp, abort.signal);
          job.completed.push('finalize');
        }
        const loudness = job.loudness!;
        const finalVideo = path.join(outputDir, `${basename}.mp4`);
        const noBgmVideo = path.join(outputDir, `${basename}_nobgm.mp4`);
        files.push(finalVideo);

        // 3. BGMなし版（任意）
        if (request.withoutBgm && plan.bgm.length > 0) {
          phase = 'nobgm';
          if (job.completed.includes('nobgm') && (await exists(job.noBgmTemp))) {
            reusedPhases.add('nobgm');
          } else {
            this.emit(sender, { language, phase: 'nobgm', ratio: 0 });
            this.failForTest('nobgm');
            const noBgmPlan = buildRenderPlan(snapshot, {
              language,
              fps: request.fps,
              tracks,
              captionsOff: request.captionMode === 'srt',
              withoutBgm: true,
              revision: snapshot.updatedAt,
            });
            await renderLongVideo({
              serveUrl,
              plan: noBgmPlan,
              mediaBaseUrl: server.url,
              outputPath: job.noBgmWav,
              audioOnly: true,
              frameRange: range ? [range.from, range.to - 1] : undefined,
              cancelSignal,
              onProgress: (progress) => this.emit(sender, { language, phase: 'nobgm', ratio: progress.ratio }),
            });
            await finalizeLongMedia(ffmpeg, job.videoRaw, job.noBgmWav, job.noBgmTemp, abort.signal);
            await removeQuietly(job.noBgmWav);
            job.completed.push('nobgm');
          }
          files.push(noBgmVideo);
        }

        // 4. SRT・チャプター・投稿文（軽いので毎回作り直す）
        phase = 'outputs';
        this.emit(sender, { language, phase: 'outputs', ratio: 0 });
        this.failForTest('outputs');
        const srt = buildSrt(plan, range);
        if (srt.trim()) {
          const srtPath = path.join(outputDir, `${basename}.srt`);
          await fs.writeFile(srtPath, srt, 'utf8');
          files.push(srtPath);
        }
        const chapters = buildChapters(plan, snapshot.id);
        if (!range) {
          const chaptersPath = path.join(outputDir, `${basename}_chapters.txt`);
          await fs.writeFile(chaptersPath, `${chapters.text}\n`, 'utf8');
          files.push(chaptersPath);
          const postPath = path.join(outputDir, `${basename}.txt`);
          await fs.writeFile(postPath, buildPostText(snapshot, language, chapters, credits), 'utf8');
          files.push(postPath);
        }

        // 5. サムネイル
        if (request.thumbnail && !range) {
          phase = 'thumbnail';
          this.emit(sender, { language, phase: 'thumbnail', ratio: 0 });
          this.failForTest('thumbnail');
          const thumbPath = path.join(outputDir, `${basename}.jpg`);
          if (request.thumbnail.kind === 'frame') {
            const composition = await selectComposition({ serveUrl, id: 'LongVideo', inputProps: { plan, mediaBaseUrl: server.url } });
            await renderStill({
              serveUrl,
              composition,
              inputProps: { plan, mediaBaseUrl: server.url },
              frame: Math.min(plan.durationInFrames - 1, Math.max(0, request.thumbnail.frame)),
              output: thumbPath,
              imageFormat: 'jpeg',
              jpegQuality: 92,
              chromiumOptions: { gl: 'swangle' },
              overwrite: true,
            });
          } else {
            await runFfmpeg(ffmpeg, ['-hide_banner', '-y', '-i', path.join(workspace, request.thumbnail.path), '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2', '-q:v', '2', thumbPath], abort.signal);
          }
          files.push(thumbPath);
        }

        // 6. meta・出力版の記録
        phase = 'outputs';
        const meta = buildLongMeta({
          exportId: job.exportId,
          appVersion: app.getVersion(),
          exportedAt: new Date().toISOString(),
          basename,
          language,
          project: snapshot,
          plan,
          partial: range ? { fromFrame: range.from, toFrame: range.to } : undefined,
          files: files.map((file) => path.basename(file)),
          captionMode: request.captionMode,
          withoutBgm: request.withoutBgm,
          chapters,
          loudness,
          assetStamps: job.stamps,
        });
        const metaPath = path.join(outputDir, `${basename}.meta.json`);
        await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
        files.push(metaPath);
        // すべての段階が終わってから、完成ファイルを正式な名前にする（途中で失敗しても作りかけの完成品を残さない）
        await fs.rename(job.finalTemp, finalVideo);
        if (files.includes(noBgmVideo)) await fs.rename(job.noBgmTemp, noBgmVideo);
        // 出力版の固定保存（部分書き出しは公開版として扱わない）
        if (!range) {
          this.freezeSnapshot(this.publishedSnapshot(snapshot, plan, job.exportId, basename, language, meta));
          for (const id of Object.keys(tracks)) this.recordUsage(id, snapshot.id, `${basename}`);
        }
        await removeQuietly(job.videoRaw, job.wav, job.noBgmWav);
        current = null;
        const durationTicks = frameToTicks(range ? range.to - range.from : plan.durationInFrames, plan.fps);
        jobs.push({ language, exportId: job.exportId, basename, files: files.map((file) => path.relative(workspace, file).split(path.sep).join('/')), outputDir, durationTicks, partial: Boolean(range) });
        this.emit(sender, { language, phase: 'done', ratio: 1 });
      }
      return { jobs, diagnostics, restarted, reusedPhases: [...reusedPhases] };
    } catch (error) {
      if (abort.signal.aborted || /cancel/i.test(String(error))) {
        // キャンセル：作りかけ・中間ファイルを残さない（完了した言語のファイルは残す）
        if (current) await removeQuietly(current.videoRaw, current.wav, current.noBgmWav, current.finalTemp, current.noBgmTemp);
        this.emit(sender, { language: currentLanguage, phase: 'cancelled', ratio: 0, message: 'キャンセルしました' });
        throw new Error('書き出しをキャンセルしました');
      }
      const message = error instanceof Error ? error.message : String(error);
      const failedJob = current as ResumeJob | null;
      // 完了していない段階の成果物は消す（作りかけの完成品を残さない）
      if (failedJob) {
        if (!failedJob.completed.includes('render')) await removeQuietly(failedJob.videoRaw, failedJob.wav);
        if (!failedJob.completed.includes('finalize')) await removeQuietly(failedJob.finalTemp);
        if (!failedJob.completed.includes('nobgm')) await removeQuietly(failedJob.noBgmWav, failedJob.noBgmTemp);
        // この回に書いた SRT・投稿文・サムネイル・meta も消す（再開時に作り直す）
        const base = path.join(outputDir, failedJob.basename);
        await removeQuietly(`${base}.srt`, `${base}_chapters.txt`, `${base}.txt`, `${base}.jpg`, `${base}.meta.json`, `${base}.mp4`, `${base}_nobgm.mp4`);
      }
      const finished = [...(resume?.done ?? []), ...jobs.filter((job) => !job.reused)];
      const resumable = finished.length > 0 || Boolean(failedJob && failedJob.completed.length > 0);
      if (resumable) {
        this.resume = { key, outputDir, date: date.toISOString(), done: finished, current: failedJob ?? undefined };
      } else if (failedJob) {
        await removeQuietly(failedJob.videoRaw, failedJob.wav, failedJob.noBgmWav, failedJob.finalTemp, failedJob.noBgmTemp);
      }
      this.emit(sender, { language: currentLanguage, phase: 'error', ratio: 0, message });
      return {
        jobs,
        diagnostics,
        restarted,
        reusedPhases: [...reusedPhases],
        failure: { language: currentLanguage, phase, message, resumable, completed: failedJob?.completed ?? [] },
      };
    } finally {
      this.running = null;
      if (server) await server.close();
    }
  }

  private async assertStamps(
    project: LongProject,
    stamps: Record<string, { size: number; mtimeMs: number } | undefined>,
    workspace: string,
  ): Promise<void> {
    for (const asset of project.assets) {
      const before = stamps[asset.id];
      if (!before) continue;
      const after = await fileStamp(path.join(workspace, asset.path)).catch(() => undefined);
      if (!after || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        throw new Error(`書き出し中に素材「${asset.name}」が変更されました。結果が混ざるのを防ぐため、書き出しを中止しました。もう一度書き出してください`);
      }
    }
  }

  private publishedSnapshot(
    project: LongProject,
    plan: RenderPlan,
    exportId: string,
    basename: string,
    language: LongLanguage,
    meta: Record<string, unknown>,
  ): PublishedSnapshot {
    const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]));
    const sec = (frame: number): number => Math.round(ticksToSec(frameToTicks(frame, plan.fps)) * 1000) / 1000;
    return {
      exportId,
      projectId: project.id,
      basename,
      lang: language,
      format: 'long',
      output: { width: plan.width, height: plan.height, fps: plan.fps },
      source: 'export',
      needsReview: false,
      frozenAt: new Date().toISOString(),
      durationSec: sec(plan.durationInFrames),
      renderedDurationSec: sec(plan.durationInFrames),
      templateId: project.template.templateId,
      templateVersion: String(project.template.version),
      hookPattern: '',
      map: project.lineups[0]?.map,
      agent: project.lineups[0]?.agent,
      scenes: plan.scenes.map((scene, index) => {
        const purpose = sceneById.get(scene.id)?.purpose;
        return {
          id: scene.id,
          meaning: purpose === 'hook' ? 'hook' : purpose === 'action' || purpose === 'highlight' ? 'success' : 'other',
          label: scene.label || purpose || '',
          order: index,
          startSec: sec(scene.from),
          endSec: Math.max(sec(scene.to), sec(scene.from) + 0.001),
          source: 'export',
        };
      }),
      long: {
        chapters: meta.chapters,
        layers: meta.layers,
        avatars: meta.avatars,
        cutins: meta.cutins,
        captionMode: (meta.output as { captionMode?: string } | undefined)?.captionMode,
      },
    };
  }
}
