import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, type WebContents } from 'electron';
import ffmpegPathImport from 'ffmpeg-static';
import { bundle } from '@remotion/bundler';
import {
  renderMedia,
  renderStill,
  selectComposition,
} from '@remotion/renderer';
import type {
  ExportProgress,
  ExportRequest,
  ExportResult,
} from '../../../shared/ipc';
import { aimZoomMetadata } from '../../../shared/aim-zoom';
import {
  DELIVERY_PRESETS,
  platformsFor,
  trackingMetaFromUrl,
  type DeliveryPresetId,
} from '../../../shared/delivery-presets';
import { captionLanguagesFor, copyForJob, jobsForPresets } from '../../../shared/export-copy';
import { videoCtaRenders } from '../../../shared/s4-cta';
import { parseProject, type Project } from '../../../shared/schema/project';
import { activeTimeline } from '../../../shared/timeline';
import type { AudioTrack } from '../../../shared/schema/audio';
import type { LibraryService } from './library-service';
import {
  exportRenderConcurrency,
  mixBgmOntoVideo,
  prepareExportMedia,
} from './export-media';
import {
  isInsideRoot,
  resolveWorkspaceFile,
  startWorkspaceMediaServer,
  workspaceRelativePath,
  type WorkspaceMediaServer,
} from './workspace-media-server';
import {
  catalogMediaRelativePath,
  getAbilityCardIconPath,
  getAgentCardIconPath,
} from '../../../shared/valorant-catalog';
import { catalogRootFromApp } from './catalog-path';

const execFileAsync = promisify(execFile);

const EXPORT_FRAME_CACHE_BYTES = 1024 * 1024 * 1024;
const EXPORT_CHROMIUM = { gl: 'swangle' as const };

const getFfmpegPath = (): string => {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'bin',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );
  }
  if (!ffmpegPathImport) throw new Error('FFmpegバイナリが見つかりません');
  return ffmpegPathImport.replace('app.asar', 'app.asar.unpacked');
};

export class ExportService {
  private serveUrl: string | null = null;
  private running = false;
  private exportStartedAt = 0;

  constructor(
    private readonly getWorkspace: () => string | null,
    private readonly libraryService: LibraryService,
  ) {}

  async export(request: ExportRequest, sender: WebContents): Promise<ExportResult> {
    const presets = (request.presets?.length ? request.presets : request.project.guide.exportPresets).filter(
      (id): id is DeliveryPresetId => id in DELIVERY_PRESETS,
    );
    if (this.running) throw new Error('別の書き出しが進行中です');
    this.running = true;
    let mediaServer: WorkspaceMediaServer | null = null;
    try {
      const project = parseProject(request.project);
      const jobs = jobsForPresets(presets, project.guide.thumbnailOnly);
      const wantVideo = jobs.some((job) => job.video);
      const wantXCard = jobs.some((job) => job.xCard);
      const wantFinishedCard = jobs.some((job) => job.finishedCard);
      const wantThumbnail = jobs.some((job) => job.thumbnail);
      if (!wantVideo && !wantXCard && !wantThumbnail) {
        throw new Error('書き出す項目にチェックを入れてください');
      }
      this.validateAssets(project, wantVideo, wantVideo ? captionLanguagesFor(presets) : []);
      if (wantThumbnail && !wantVideo) {
        const hook = project.scenes.find((scene) => scene.sceneKey === 'hook');
        const hasHook = Boolean(hook?.clipId && project.clips.some((clip) => clip.id === hook.clipId));
        if (!hasHook) throw new Error('サムネイルにはフックの動画が必要です');
      }
      const audioTrack = project.audio.bgm
        ? this.libraryService.getAudio(project.audio.bgm.audioTrackId)
        : null;
      const audioTracks = [
        ...new Set([
          project.audio.bgm?.audioTrackId,
          ...activeTimeline(project).effects.map((effect) => effect.audioTrackId),
        ]),
      ]
        .filter((id): id is string => Boolean(id))
        .map((id) => this.libraryService.getAudio(id))
        .filter((track): track is NonNullable<typeof track> => track !== null);
      if (wantVideo) {
        this.validateAudio(
          project,
          audioTrack,
          platformsFor(presets).filter(
            (platform): platform is 'youtube' | 'tiktok' =>
              platform === 'youtube' || platform === 'tiktok',
          ),
        );
      }
      const workspace = this.requireWorkspace();
      const outputDirectory = path.join(
        workspace,
        'exports',
        new Date().toISOString().slice(0, 10),
      );
      await fs.mkdir(outputDirectory, { recursive: true });

      this.exportStartedAt = Date.now();
      const progressLanguage = jobs[0]?.slot ?? 'ja';
      this.emit(sender, progressLanguage, 'bundle', 0);
      const serveUrl = await this.getBundle();
      this.emit(
        sender,
        progressLanguage,
        wantFinishedCard || wantXCard ? 'card' : wantVideo ? 'video' : 'thumbnail',
        0,
      );
      const prepared = await prepareExportMedia({
        workspace,
        project,
        cards: wantFinishedCard || wantXCard,
        video: wantVideo,
        thumbnail: wantThumbnail,
      });
      const allowedRelativePaths = await this.prepareMediaAllowlist(
        workspace,
        project,
        audioTracks,
        prepared.relativePaths,
      );
      const catalogRoot = catalogRootFromApp(
        app.getAppPath(),
        process.resourcesPath,
        app.isPackaged,
      );
      const allowedCatalogPaths = this.prepareCatalogAllowlist(project);
      mediaServer = await startWorkspaceMediaServer({
        workspace,
        allowedRelativePaths,
        catalogRoot,
        allowedCatalogPaths,
      });
      const outputs: string[] = [];
      const links: ExportResult['links'] = {};
      for (const job of jobs) {
        const language = job.language;
        const inputProps = {
          project,
          language,
          mediaBaseUrl: mediaServer.url,
          useOriginalMedia: true,
          audioTrack: audioTrack ?? undefined,
          audioTracks,
          frozenFrames: prepared.cardFrames,
        };
        const videoInputProps = {
          ...inputProps,
          project: prepared.videoProject,
          frozenFrames: undefined,
        };
        const basename = await this.nextBasename(outputDirectory, project, job.slot);
        const cardPath = path.join(outputDirectory, `${basename}_card.png`);
        const card45Path = path.join(outputDirectory, `${basename}_card45.png`);
        const videoPath = path.join(outputDirectory, `${basename}.mp4`);
        const temporaryVideoPath = path.join(outputDirectory, `.${basename}.rendering.mp4`);
        const metadataPath = path.join(outputDirectory, `${basename}.meta.json`);
        const copyPath = path.join(outputDirectory, `${basename}.txt`);
        const thumbnailPath = path.join(outputDirectory, `${basename}.jpg`);

        let videoDurationSec = activeTimeline(project).durationSec;
        const stillOptions = {
          chromiumOptions: EXPORT_CHROMIUM,
          offthreadVideoThreads: 2,
          offthreadVideoCacheSizeInBytes: EXPORT_FRAME_CACHE_BYTES,
        };
        if (job.finishedCard) {
          const card = await selectComposition({
            serveUrl,
            id: 'LineupCard',
            inputProps,
            chromiumOptions: EXPORT_CHROMIUM,
          });
          this.emit(sender, job.slot, 'card', 0);
          await renderStill({
            serveUrl,
            composition: card,
            inputProps,
            output: cardPath,
            imageFormat: 'png',
            ...stillOptions,
          });
        }
        if (job.thumbnail) {
          const thumbnailInput = {
            project,
            language,
            mediaBaseUrl: mediaServer.url,
            useOriginalMedia: true,
            hookFrame: prepared.hookFrame,
          };
          const thumb = await selectComposition({
            serveUrl,
            id: 'LineupThumbnail',
            inputProps: thumbnailInput,
            chromiumOptions: EXPORT_CHROMIUM,
          });
          this.emit(sender, job.slot, 'thumbnail', 0);
          await renderStill({
            serveUrl,
            composition: thumb,
            inputProps: thumbnailInput,
            output: thumbnailPath,
            imageFormat: 'jpeg',
            jpegQuality: 92,
            ...stillOptions,
          });
          this.emit(sender, job.slot, 'thumbnail', 1);
        }
        if (job.xCard) {
          const card45 = await selectComposition({
            serveUrl,
            id: 'LineupCardX45',
            inputProps,
            chromiumOptions: EXPORT_CHROMIUM,
          });
          this.emit(sender, job.slot, 'card', 0);
          await renderStill({
            serveUrl,
            composition: card45,
            inputProps,
            output: card45Path,
            imageFormat: 'png',
            ...stillOptions,
          });
        }

        if (job.video) {
          const video = await selectComposition({
            serveUrl,
            id: 'LineupShortStandard',
            inputProps: videoInputProps,
            chromiumOptions: EXPORT_CHROMIUM,
          });
          videoDurationSec = video.durationInFrames / video.fps;
          const mediaOptions = {
            ...stillOptions,
            concurrency: exportRenderConcurrency(),
          };
          const targets = videoCtaRenders(job.presetIds, prepared.videoProject);
          for (const target of targets) {
            const renderProps = { ...videoInputProps, deliveryPlatform: target.platform };
            const fileBase = target.suffix ? `${basename}${target.suffix}` : basename;
            const targetVideoPath = path.join(outputDirectory, `${fileBase}.mp4`);
            const targetTempPath = path.join(outputDirectory, `.${fileBase}.rendering.mp4`);
            const renderVideo = (withoutBgm: boolean, outputLocation: string, phase: 'video' | 'nobgm') =>
              renderMedia({
                serveUrl,
                composition: video,
                inputProps: { ...renderProps, withoutBgm },
                codec: 'h264',
                audioCodec: 'aac',
                outputLocation,
                ...mediaOptions,
                onProgress: ({ progress }) => this.emit(sender, job.slot, phase, progress),
              });
            if (request.exportWithoutBgm && audioTrack) {
              const noBgmPath = path.join(outputDirectory, `${fileBase}_nobgm.mp4`);
              const noBgmTempPath = path.join(outputDirectory, `.${fileBase}.nobgm.rendering.mp4`);
              const mixedPath = path.join(outputDirectory, `.${fileBase}.mixed.mp4`);
              const gainPath = path.join(outputDirectory, `.${fileBase}.bgm-gain.txt`);
              try {
                await renderVideo(true, noBgmTempPath, 'video');
                this.emit(sender, job.slot, 'nobgm', 0);
                try {
                  await mixBgmOntoVideo({
                    videoPath: noBgmTempPath,
                    bgmPath: resolveWorkspaceFile(workspace, audioTrack.filePath) ?? audioTrack.filePath,
                    outputPath: mixedPath,
                    commandPath: gainPath,
                    project,
                  });
                  this.emit(sender, job.slot, 'loudness', 0);
                  await this.normalizeLoudness(mixedPath, targetVideoPath);
                } catch {
                  await renderVideo(false, targetTempPath, 'nobgm');
                  this.emit(sender, job.slot, 'loudness', 0);
                  await this.normalizeLoudness(targetTempPath, targetVideoPath);
                }
                await this.normalizeLoudness(noBgmTempPath, noBgmPath);
                outputs.push(noBgmPath);
                this.emit(sender, job.slot, 'loudness', 1);
              } finally {
                await fs.rm(noBgmTempPath, { force: true });
                await fs.rm(mixedPath, { force: true });
                await fs.rm(gainPath, { force: true });
                await fs.rm(targetTempPath, { force: true });
              }
            } else {
              try {
                await renderVideo(false, targetTempPath, 'video');
                this.emit(sender, job.slot, 'loudness', 0);
                await this.normalizeLoudness(targetTempPath, targetVideoPath);
                this.emit(sender, job.slot, 'loudness', 1);
              } finally {
                await fs.rm(targetTempPath, { force: true });
              }
            }
            if (target.suffix) outputs.push(targetVideoPath);
          }
        }
        const exportedAt = new Date().toISOString();
        await fs.writeFile(
          metadataPath,
          JSON.stringify(
            {
              app: 'CV Creator Studio',
              appVersion: app.getVersion(),
              exportedAt,
              projectId: project.id,
              variantId: basename.match(/_v(\d+)$/)?.[1] ?? '1',
              lang: language,
              template: project.templateId,
              templateParams: project.templateParams,
              card45Layout: project.cardLayout === 'stack' ? 'b' : 'a',
              cardLayout:
                project.cardLayout === 'stack'
                  ? language === 'ja'
                    ? 'ja-b'
                    : 'en-b'
                  : language === 'ja'
                    ? 'ja-a'
                    : 'en-c',
              hookPattern: project.hookPattern,
              aimZoom: aimZoomMetadata(project),
              annotationStyle: project.annotationStyle ?? 'standard',
              experiment: project.experiment,
              hookText: project.captions.find((caption) => caption.id === 'hook')?.text[
                language
              ],
              lineup: {
                map: project.lineup.map,
                site: project.lineup.site,
                side: project.lineup.side,
                agent: project.lineup.agent,
                ability: project.lineup.ability,
              },
              durationSec: videoDurationSec,
              withBgm: job.video && Boolean(audioTrack),
              audio:
                job.video && audioTrack
                  ? [
                      {
                        kind: 'bgm',
                        trackId: audioTrack.id,
                        title: audioTrack.title,
                        artist: audioTrack.artist,
                        source: audioTrack.source,
                        sourceUrl: audioTrack.sourceUrl,
                        credit: audioTrack.creditRequired ? audioTrack.creditText : null,
                      },
                    ]
                  : [],
              credits:
                job.video && audioTrack?.creditRequired && audioTrack.creditText
                  ? [audioTrack.creditText]
                  : [],
              presets: job.presetIds,
              publishing: {
                ...project.publishing,
                links: {},
              },
              exported: {
                video: job.video,
                card: job.finishedCard,
                xCard: job.xCard,
                thumbnail: job.thumbnail,
              },
            },
            null,
            2,
          ),
          'utf8',
        );
        const credit =
          job.video && audioTrack?.creditRequired && audioTrack.creditText
            ? audioTrack.creditText
            : '';
        const copy = copyForJob(project, job, basename, credit);
        Object.assign(links, copy.links);
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as {
          publishing: { links: ExportResult['links'] };
        };
        metadata.publishing.links = copy.links;
        const tracking = Object.fromEntries(
          Object.entries(copy.links).flatMap(([preset, url]) => {
            if (!url) return [];
            const meta = trackingMetaFromUrl(url);
            return meta ? [[preset, meta]] : [];
          }),
        );
        await fs.writeFile(metadataPath, JSON.stringify({ ...metadata, tracking }, null, 2), 'utf8');
        await fs.writeFile(copyPath, copy.text, 'utf8');
        if (job.video && audioTrack) {
          this.libraryService.recordUsage(
            audioTrack.id,
            project.id,
            basename,
            exportedAt,
          );
        }
        if (job.xCard) outputs.push(card45Path);
        if (job.finishedCard) outputs.push(cardPath);
        if (job.thumbnail) outputs.push(thumbnailPath);
        if (job.video) outputs.push(videoPath);
        outputs.push(metadataPath, copyPath);
        this.emit(sender, job.slot, 'done', 1);
      }
      return { files: outputs, links };
    } finally {
      await mediaServer?.close().catch(() => undefined);
      this.running = false;
    }
  }

  private async prepareMediaAllowlist(
    workspace: string,
    project: Project,
    audioTracks: AudioTrack[],
    extraRelativePaths: string[] = [],
  ): Promise<string[]> {
    const required = new Set<string>();
    for (const stillId of Object.values(project.cardStills)) {
      if (!stillId) continue;
      const still = project.stills.find((item) => item.id === stillId);
      if (!still) throw new Error('カード用の静止画が見つかりません');
      required.add(still.path);
    }
    for (const scene of project.scenes) {
      const clip = project.clips.find((item) => item.id === scene.clipId);
      const asset = project.assets.find((item) => item.id === clip?.assetId);
      if (asset) required.add(asset.path);
    }
    for (const track of audioTracks) required.add(track.filePath);
    for (const relativePath of extraRelativePaths) required.add(relativePath);

    const candidates = new Set<string>(required);
    for (const still of project.stills) candidates.add(still.path);
    for (const asset of project.assets) {
      candidates.add(asset.path);
      if (asset.proxyPath) candidates.add(asset.proxyPath);
    }

    const rootReal = await fs.realpath(workspace);
    const allowed: string[] = [];
    const missing: string[] = [];
    for (const relativePath of candidates) {
      const normalized = workspaceRelativePath(workspace, relativePath);
      const absolute = normalized ? resolveWorkspaceFile(workspace, normalized) : null;
      if (!normalized || !absolute) {
        if (required.has(relativePath)) missing.push(relativePath);
        continue;
      }
      try {
        const real = await fs.realpath(absolute);
        if (!isInsideRoot(rootReal, real)) {
          throw new Error(`素材が保存先フォルダの外を指しています: ${relativePath}`);
        }
        const file = await fs.stat(real);
        if (!file.isFile()) {
          if (required.has(relativePath)) missing.push(relativePath);
          continue;
        }
        allowed.push(normalized);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('素材が保存先フォルダの外を指しています')) {
          throw error;
        }
        if (required.has(relativePath)) missing.push(relativePath);
      }
    }
    if (missing.length > 0) {
      throw new Error(`素材ファイルが見つかりません: ${missing.join(', ')}`);
    }
    return allowed;
  }

  private prepareCatalogAllowlist(project: Project): string[] {
    const paths: string[] = [];
    const agentIcon = getAgentCardIconPath(project.lineup.agent);
    if (agentIcon) paths.push(catalogMediaRelativePath(agentIcon));
    const abilityIcon = getAbilityCardIconPath(project.lineup.agent, project.lineup.ability);
    if (abilityIcon) paths.push(catalogMediaRelativePath(abilityIcon));
    return paths;
  }

  private async getBundle(): Promise<string> {
    if (this.serveUrl) return this.serveUrl;
    const entryPoint = app.isPackaged
      ? path.join(process.resourcesPath, 'remotion', 'index.ts')
      : path.join(app.getAppPath(), 'remotion', 'index.ts');
    this.serveUrl = await bundle({
      entryPoint,
      webpackOverride: (config) => config,
    });
    return this.serveUrl;
  }

  private validateAssets(
    project: ReturnType<typeof parseProject>,
    requireClips: boolean,
    languages: Array<'ja' | 'en'>,
  ): void {
    if (requireClips) {
      const required = project.templateId === 't-guide' ? ['hook', 'demo'] : ['hook', 'stand', 'aim', 'throw'];
      const missing = required.filter((sceneKey) => {
        const scene = project.scenes.find((item) => item.sceneKey === sceneKey);
        return !scene?.clipId || !project.clips.some((clip) => clip.id === scene.clipId);
      });
      if (missing.length > 0) {
        throw new Error(`必須クリップが未設定です: ${missing.join(', ')}`);
      }
    }
    const missingLanguages: string[] = [];
    for (const language of languages) {
      if (!project.lineup.standDescription[language].trim()) {
        missingLanguages.push(`立ち位置(${language})`);
      }
      if (!project.lineup.aimDescription[language].trim()) {
        missingLanguages.push(`狙い方(${language})`);
      }
      if (!project.lineup.throwType[language].trim()) {
        missingLanguages.push(`投げ方(${language})`);
      }
      for (const caption of project.captions) {
        if (caption.id === 'cta' || caption.styleId === 'cta') continue;
        if (caption.id === 'demo' && project.templateId !== 't-guide') {
          const demo = project.scenes.find((scene) => scene.sceneKey === 'demo');
          const included = Boolean(demo?.clipId && project.clips.some((clip) => clip.id === demo.clipId));
          if (!included) continue;
        }
        if (!caption.text[language].trim()) {
          missingLanguages.push(`${caption.id}テロップ(${language})`);
        }
      }
    }
    if (missingLanguages.length > 0) {
      throw new Error(`書き出す言語の文言を入力してください: ${missingLanguages.join(', ')}`);
    }
  }

  private validateAudio(
    project: ReturnType<typeof parseProject>,
    audioTrack: AudioTrack | null,
    targetPlatforms: Array<'youtube' | 'tiktok'>,
  ): void {
    if (!project.audio.bgm) return;
    if (!audioTrack) throw new Error('選択したBGMが音源ライブラリに見つかりません');
    if (
      audioTrack.licenseStatus !== 'confirmed' ||
      !audioTrack.sourceUrl.trim() ||
      (audioTrack.creditRequired && !audioTrack.creditText.trim())
    ) {
      throw new Error(`BGM「${audioTrack.title}」のライセンス情報が未確認です`);
    }
    const unavailable = (targetPlatforms ?? []).filter(
      (platform) => !audioTrack.allowedPlatforms.includes(platform),
    );
    if (unavailable.length > 0) {
      throw new Error(
        `BGM「${audioTrack.title}」は次の投稿先では利用できません: ${unavailable.join(', ')}`,
      );
    }
    const placement = project.audio.bgm;
    if (placement.offset >= audioTrack.durationSec) {
      throw new Error(`BGM「${audioTrack.title}」の開始位置が曲の長さを超えています`);
    }
  }

  private async normalizeLoudness(inputPath: string, outputPath: string): Promise<void> {
    // 従来の -30.5 LUFS から約 6 dB 下げ、知覚上ではなく振幅を約半分にする。
    // loudnorm の TP は [-9, 0] しか受け付けないため、天井は下限の -9 にする。
    const target = 'I=-36.5:TP=-9:LRA=11';
    const firstPass = await execFileAsync(
      getFfmpegPath(),
      [
        '-hide_banner',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-af',
        `loudnorm=${target}:print_format=json`,
        '-f',
        'null',
        '-',
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const reportMatch = /\{[\s\S]*"input_i"[\s\S]*\}/m.exec(firstPass.stderr);
    if (!reportMatch) throw new Error('ラウドネス解析結果を読み取れませんでした');
    const report = JSON.parse(reportMatch[0]) as Record<string, string>;
    const filter = [
      `loudnorm=${target}`,
      `measured_I=${report.input_i}`,
      `measured_TP=${report.input_tp}`,
      `measured_LRA=${report.input_lra}`,
      `measured_thresh=${report.input_thresh}`,
      `offset=${report.target_offset}`,
      'linear=true',
      'print_format=summary',
    ].join(':');
    await execFileAsync(
      getFfmpegPath(),
      [
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-af',
        filter,
        '-movflags',
        '+faststart',
        outputPath,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
  }

  private async nextBasename(
    outputDirectory: string,
    project: ReturnType<typeof parseProject>,
    slot: 'ja' | 'en' | 'x',
  ): Promise<string> {
    const date = (project.plannedPostDate ?? new Date().toISOString()).slice(0, 10).replaceAll('-', '');
    const base = `${date}_${project.lineup.map}_${project.lineup.agent}_std_${slot}`;
    for (let variant = 1; variant < 1000; variant += 1) {
      const candidate = `${base}_v${variant}`;
      const taken = await this.variantTaken(outputDirectory, candidate);
      if (!taken) return candidate;
    }
    throw new Error('バリアント番号の空きがありません');
  }

  private async variantTaken(outputDirectory: string, candidate: string): Promise<boolean> {
    const suffixes = ['.mp4', '_nobgm.mp4', '_card.png', '_card45.png', '.jpg', '.meta.json', '.txt'];
    for (const suffix of suffixes) {
      try {
        await fs.access(path.join(outputDirectory, `${candidate}${suffix}`));
        return true;
      } catch {
        // この接尾辞のファイルはまだない
      }
    }
    return false;
  }

  private emit(
    sender: WebContents,
    language: ExportProgress['language'],
    phase: ExportProgress['phase'],
    progress: number,
  ): void {
    const elapsedSec = (Date.now() - this.exportStartedAt) / 1000;
    const remainingSec =
      progress > 0.05 && progress < 1 ? Math.round((elapsedSec / progress) * (1 - progress)) : undefined;
    sender.send('export:progress', {
      language,
      phase,
      progress,
      remainingSec,
    } satisfies ExportProgress);
  }

  private requireWorkspace(): string {
    const workspace = this.getWorkspace();
    if (!workspace) throw new Error('保存先フォルダを先に選択してください');
    return workspace;
  }
}
