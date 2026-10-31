import { create } from 'zustand';
import type { LongExportProgress, LongProjectSummary } from '../../shared/long/ipc';
import type { LongLanguage, LongProject } from '../../shared/long/schema';
import { persistenceMismatchMessage, persistenceMismatches } from '../../shared/project-persistence';

/**
 * 横動画モード専用のストア。ショートのストアとは別に持ち、モードを移動しても互いに影響しない。
 * 編集は transact で1件の履歴として記録する。ドラッグは begin/endGesture の間を1件にまとめる。
 */

export type Selection =
  | { kind: 'none' }
  | { kind: 'chapter'; id: string }
  | { kind: 'scene'; id: string }
  | { kind: 'placement'; id: string }
  | { kind: 'caption'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'avatar'; id: string }
  | { kind: 'bgm'; id: string }
  | { kind: 'se'; id: string }
  | { kind: 'ducking'; id: string }
  | { kind: 'marker'; id: string };

export type FrameEditTarget = { placementId: string; mode: 'crop' | 'rect'; end?: boolean } | null;

type HistoryEntry = { label: string; project: LongProject };

const HISTORY_LIMIT = 100;

/** 履歴を戻しても、裏で作成済みのプレビュー用ファイル（プロキシ）は失わない */
const keepProxies = (restored: LongProject, current: LongProject): LongProject => ({
  ...restored,
  assets: restored.assets.map((asset) => {
    const now = current.assets.find((item) => item.id === asset.id);
    return now?.proxyPath && now.path === asset.path ? { ...asset, proxyPath: now.proxyPath } : asset;
  }),
});

type LongState = {
  summaries: LongProjectSummary[];
  project: LongProject | null;
  revision: number;
  savedRevision: number;
  saving: boolean;
  saveError: string | null;
  message: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  gesture: { label: string; before: LongProject } | null;
  selection: Selection;
  language: LongLanguage;
  frame: number;
  frameEdit: FrameEditTarget;
  missingAssets: string[];
  proxyProgress: Record<string, number>;
  exportProgress: LongExportProgress | null;
  setSummaries: (summaries: LongProjectSummary[]) => void;
  open: (project: LongProject | null) => void;
  transact: (label: string, fn: (project: LongProject) => LongProject) => void;
  beginGesture: (label: string) => void;
  /** ジェスチャー中の更新（履歴を積まない） */
  live: (fn: (project: LongProject) => LongProject) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (selection: Selection) => void;
  setLanguage: (language: LongLanguage) => void;
  setFrame: (frame: number) => void;
  setFrameEdit: (target: FrameEditTarget) => void;
  setMissingAssets: (ids: string[]) => void;
  setProxyProgress: (assetId: string, ratio: number | null) => void;
  setExportProgress: (progress: LongExportProgress | null) => void;
  setMessage: (message: string | null) => void;
  /** 保存結果を反映。保存中に編集されていれば画面の内容を優先する */
  acceptSaved: (revision: number, sent: LongProject, saved: LongProject) => 'saved' | 'stale' | 'rejected';
  setSaving: (saving: boolean, error?: string | null) => void;
};

export const useLongStore = create<LongState>((set, get) => ({
  summaries: [],
  project: null,
  revision: 0,
  savedRevision: 0,
  saving: false,
  saveError: null,
  message: null,
  past: [],
  future: [],
  gesture: null,
  selection: { kind: 'none' },
  language: 'ja',
  frame: 0,
  frameEdit: null,
  missingAssets: [],
  proxyProgress: {},
  exportProgress: null,
  setSummaries: (summaries) => set({ summaries }),
  open: (project) =>
    set((state) => ({
      project,
      revision: state.revision + 1,
      savedRevision: state.revision + 1,
      past: [],
      future: [],
      gesture: null,
      selection: { kind: 'none' },
      frame: project ? Math.round((project.editor.playhead / 120_000) * project.output.fps) : 0,
      frameEdit: null,
      language: project?.output.languages[0] ?? 'ja',
      saveError: null,
    })),
  transact: (label, fn) => {
    const { project, past } = get();
    if (!project) return;
    let next: LongProject;
    try {
      next = fn(project);
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (next === project) return;
    set((state) => ({
      project: next,
      revision: state.revision + 1,
      past: [...past, { label, project }].slice(-HISTORY_LIMIT),
      future: [],
    }));
  },
  beginGesture: (label) => {
    const { project, gesture } = get();
    if (!project || gesture) return;
    set({ gesture: { label, before: project } });
  },
  live: (fn) => {
    const { project } = get();
    if (!project) return;
    try {
      const next = fn(project);
      if (next !== project) set((state) => ({ project: next, revision: state.revision + 1 }));
    } catch (error) {
      set({ message: error instanceof Error ? error.message : String(error) });
    }
  },
  endGesture: () => {
    const { gesture, project, past } = get();
    if (!gesture) return;
    if (!project || project === gesture.before) {
      set({ gesture: null });
      return;
    }
    set({ gesture: null, past: [...past, { label: gesture.label, project: gesture.before }].slice(-HISTORY_LIMIT), future: [] });
  },
  undo: () => {
    const { past, project, future } = get();
    const entry = past[past.length - 1];
    if (!entry || !project) return;
    set((state) => ({
      project: keepProxies(entry.project, project),
      revision: state.revision + 1,
      past: past.slice(0, -1),
      future: [{ label: entry.label, project }, ...future],
      message: `元に戻しました：${entry.label}`,
    }));
  },
  redo: () => {
    const { past, project, future } = get();
    const entry = future[0];
    if (!entry || !project) return;
    set((state) => ({
      project: keepProxies(entry.project, project),
      revision: state.revision + 1,
      past: [...past, { label: entry.label, project }],
      future: future.slice(1),
      message: `やり直しました：${entry.label}`,
    }));
  },
  select: (selection) => set({ selection }),
  setLanguage: (language) => set({ language }),
  setFrame: (frame) => set({ frame }),
  setFrameEdit: (frameEdit) => set({ frameEdit }),
  setMissingAssets: (missingAssets) => set({ missingAssets }),
  setProxyProgress: (assetId, ratio) =>
    set((state) => {
      const next = { ...state.proxyProgress };
      if (ratio === null) delete next[assetId];
      else next[assetId] = ratio;
      return { proxyProgress: next };
    }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  setMessage: (message) => set({ message }),
  acceptSaved: (revision, sent, saved) => {
    const mismatches = persistenceMismatches(sent, saved);
    if (mismatches.length > 0) {
      set({ saveError: persistenceMismatchMessage(mismatches, true) });
      return 'rejected';
    }
    const state = get();
    if (state.revision !== revision || !state.project) {
      set({ savedRevision: revision });
      return 'stale';
    }
    // 保存側の updatedAt だけを取り込む（履歴は保持）
    set({ project: { ...state.project, updatedAt: saved.updatedAt }, savedRevision: state.revision, saveError: null });
    return 'saved';
  },
  setSaving: (saving, error = null) => set({ saving, saveError: error }),
}));

export const isDirty = (state: Pick<LongState, 'revision' | 'savedRevision'>): boolean => state.revision !== state.savedRevision;

/** 保存（モード移動前・自動保存で使う） */
export const saveLongNow = async (): Promise<boolean> => {
  const state = useLongStore.getState();
  const { project } = state;
  if (!project) return true;
  if (!isDirty(state)) return true;
  const revision = state.revision;
  state.setSaving(true);
  try {
    const saved = await window.studio.long.save(project);
    const result = useLongStore.getState().acceptSaved(revision, project, saved);
    useLongStore.getState().setSaving(false, result === 'rejected' ? useLongStore.getState().saveError : null);
    return result !== 'rejected';
  } catch (error) {
    useLongStore.getState().setSaving(false, `保存に失敗しました：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};
