import type { Diagnostic } from './diagnostics';
import type { LongTemplateParams } from './templates';
import type { LongAsset, LongLanguage, LongProject } from './schema';

/** 横動画モードの IPC。window.studio.long に入る。 */

export type LongProjectSummary = {
  id: string;
  title: string;
  status: LongProject['status'];
  updatedAt: string;
  chapters: number;
  disabledChapters: number;
  durationTicks: number;
  languages: LongLanguage[];
  guideStep: number;
  unassigned: number;
};

export type LongCreateOptions = {
  title: string;
  slug?: string;
  fps: 30 | 60;
  languages: LongLanguage[];
  template: LongTemplateParams | null;
  inheritFromId?: string;
  inherit?: Array<'audio' | 'avatars' | 'cutins'>;
  reuse?: ShortReuseRequest;
};

export type ShortReuseSource = {
  id: string;
  title: string;
  updatedAt: string;
  map: string;
  agent: string;
  ability: string;
  clips: Array<{ id: string; label: string; assetName: string; in: number; out: number }>;
  stills: Array<{ id: string; label: string }>;
  captions: number;
};

export type ShortReuseRequest = {
  projectId: string;
  clipIds: string[];
  stillIds: string[];
  lineup: boolean;
  captions: boolean;
};

export type LongMediaKind = 'video' | 'image';

/** 取り込める拡張子（小文字・ドットなし）。ファイル選択とドラッグ＆ドロップで共通 */
export const LONG_VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi'];
export const LONG_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

/** ファイル名から取り込み種別を判定する。対応外は null */
export const longMediaKindOf = (fileName: string): LongMediaKind | null => {
  const extension = /\.([^.\\/]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (LONG_VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (LONG_IMAGE_EXTENSIONS.includes(extension)) return 'image';
  return null;
};

export type LongMediaProgress = {
  projectId: string;
  assetId: string;
  stage: 'proxy' | 'audio' | 'done' | 'error';
  ratio: number;
  message?: string;
  proxyPath?: string;
};

export type LongImportResult = { assets: LongAsset[] };

export type LongImageImport = {
  /** 保存先からの相対パス */
  paths: string[];
  names: string[];
};

export type RelinkResult = {
  asset: LongAsset;
  sameMedia: boolean;
  changes: string[];
};

export type LongExportRequest = {
  project: LongProject;
  languages: LongLanguage[];
  fps: 30 | 60;
  /** 部分書き出し [from, to)（出力フレーム） */
  range?: { from: number; to: number };
  captionMode: 'burn' | 'srt';
  withoutBgm: boolean;
  thumbnail?: { kind: 'frame'; frame: number } | { kind: 'image'; path: string };
  /** 前回失敗した書き出しを、完了した段階の成果物を使って続きから再開する（内容・設定が同じときだけ） */
  resume?: boolean;
};

export type LongExportPhase = 'prepare' | 'bundle' | 'render' | 'audio' | 'nobgm' | 'finalize' | 'outputs' | 'thumbnail' | 'done' | 'cancelled' | 'error';

export const LONG_EXPORT_PHASE_LABEL: Record<LongExportPhase, string> = {
  prepare: '準備',
  bundle: '描画の準備',
  render: '映像と音声の描画',
  audio: '音声の描画',
  nobgm: 'BGMなし版の作成',
  finalize: '音量の調整と合成',
  outputs: 'SRT・投稿文・meta の出力',
  thumbnail: 'サムネイルの作成',
  done: '完了',
  cancelled: 'キャンセル',
  error: 'エラー',
};

export type LongExportProgress = {
  language: LongLanguage;
  phase: LongExportPhase;
  ratio: number;
  remainingSec?: number;
  message?: string;
};

export type LongExportJobResult = {
  language: LongLanguage;
  exportId: string;
  basename: string;
  files: string[];
  outputDir: string;
  durationTicks: number;
  partial: boolean;
  /** 前回の書き出しで完了済み（再開時に再利用した。記録は前回済み） */
  reused?: boolean;
};

export type LongExportFailure = {
  language: LongLanguage;
  phase: LongExportPhase;
  message: string;
  /** 完了した段階・言語があり、続きから再開できる */
  resumable: boolean;
  /** 完了済みの段階（表示用） */
  completed: LongExportPhase[];
};

export type LongExportResult = {
  jobs: LongExportJobResult[];
  diagnostics: Diagnostic[];
  /** 途中で失敗した（キャンセルは例外で返す） */
  failure?: LongExportFailure;
  /** 再開を指定したが内容・設定が変わっていたため、最初から書き出した */
  restarted?: boolean;
  /** 再開して、前回の成果物を使った段階 */
  reusedPhases?: LongExportPhase[];
};

export type CreateModeState = {
  createMode: 'short' | 'long';
  lastLongProjectId?: string;
};

export type ProjectFormatResult = { format: 'short' | 'long' | null; id: string };

export interface LongStudioApi {
  list(): Promise<LongProjectSummary[]>;
  load(id: string): Promise<LongProject>;
  save(project: LongProject): Promise<LongProject>;
  create(options: LongCreateOptions): Promise<LongProject>;
  duplicate(id: string): Promise<LongProject>;
  remove(id: string): Promise<void>;
  shortSources(): Promise<ShortReuseSource[]>;
  importMedia(projectId: string, kind: LongMediaKind, paths?: string[]): Promise<LongImportResult | null>;
  importImages(projectId: string, purpose: 'avatar' | 'cutin' | 'still', paths?: string[]): Promise<LongImageImport | null>;
  importImageFolder(projectId: string): Promise<LongImageImport | null>;
  extractAudio(projectId: string, asset: LongAsset): Promise<LongAsset>;
  /** 保存先フォルダ内の音声ファイルの、from から duration（ticks）の区間の波形（0〜1 を buckets 個） */
  waveform(relativePath: string, from: number, duration: number, buckets: number): Promise<number[]>;
  relink(projectId: string, asset: LongAsset): Promise<RelinkResult | null>;
  checkAssets(project: LongProject): Promise<string[]>;
  onMediaProgress(callback: (progress: LongMediaProgress) => void): () => void;
  exportVideo(request: LongExportRequest): Promise<LongExportResult>;
  cancelExport(): Promise<void>;
  onExportProgress(callback: (progress: LongExportProgress) => void): () => void;
  getCreateState(): Promise<CreateModeState>;
  setCreateState(state: Partial<CreateModeState>): Promise<CreateModeState>;
  /** ファイル（project.json / long-project.json）を選んで、制作形式と ID を返す */
  openProjectFile(): Promise<ProjectFormatResult | null>;
  projectFormat(id: string): Promise<ProjectFormatResult>;
}
