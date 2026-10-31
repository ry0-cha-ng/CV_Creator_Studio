import { create } from 'zustand';
import type { ExportProgress, ProjectSummary } from '../shared/ipc';
import {
  persistenceMismatchMessage,
  persistenceMismatches,
} from '../shared/project-persistence';
import type { Language, Project } from '../shared/schema/project';
import type { AudioTrack } from '../shared/schema/audio';
import { followPublishing, lineupTitle } from '../shared/guide';
import { syncBgmToVideo } from '../shared/timeline';

export type SaveCommit = 'saved' | 'stale' | 'rejected';

type StudioState = {
  workspace: string | null;
  projects: ProjectSummary[];
  project: Project | null;
  audioTracks: AudioTrack[];
  language: Language;
  busy: boolean;
  dirty: boolean;
  projectRevision: number;
  error: string | null;
  exportProgress: ExportProgress | null;
  setWorkspace: (workspace: string | null) => void;
  setProjects: (projects: ProjectSummary[]) => void;
  setProject: (project: Project | null, dirty?: boolean) => void;
  setAudioTracks: (audioTracks: AudioTrack[]) => void;
  updateProject: (updater: (project: Project) => Project) => void;
  setLanguage: (language: Language) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setExportProgress: (progress: ExportProgress | null) => void;
  acceptSavedProject: (revision: number, sent: Project, saved: Project) => SaveCommit;
};

const persistenceErrorPrefix = '保存結果に編集が反映されていません';

const createStudioStore = () =>
  create<StudioState>((set, get) => ({
  workspace: null,
  projects: [],
  project: null,
  audioTracks: [],
  language: 'ja',
  busy: false,
  dirty: false,
  projectRevision: 0,
  error: null,
  exportProgress: null,
  setWorkspace: (workspace) => set({ workspace }),
  setProjects: (projects) => set({ projects }),
  setProject: (project, dirty = false) =>
    set((state) => ({
      project: project ? followPublishing(syncBgmToVideo(project)) : null,
      dirty,
      projectRevision: state.projectRevision + 1,
    })),
  setAudioTracks: (audioTracks) => set({ audioTracks }),
  updateProject: (updater) =>
    set((state) => {
      if (!state.project) return state;
      const previous = state.project;
      let next = updater(structuredClone(previous));
      const identity = (project: Project): string =>
        [project.lineup.map, project.lineup.site, project.lineup.side, project.lineup.agent].join('|');
      if (
        identity(previous) !== identity(next) &&
        next.lineup.map.trim() &&
        next.lineup.agent.trim()
      ) {
        next = { ...next, title: lineupTitle(next) };
      }
      return {
        project: followPublishing(syncBgmToVideo(next)),
        dirty: true,
        projectRevision: state.projectRevision + 1,
      };
    }),
  setLanguage: (language) => set({ language }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  acceptSavedProject: (revision, sent, saved) => {
    const state = get();
    if (state.projectRevision !== revision || state.project?.id !== sent.id) return 'stale';
    const paths = persistenceMismatches(sent, saved);
    if (paths.length > 0) {
      set({ error: persistenceMismatchMessage(paths, true), dirty: true });
      return 'rejected';
    }
    set({
      project: syncBgmToVideo(saved),
      dirty: false,
      error: state.error?.startsWith(persistenceErrorPrefix) ? null : state.error,
    });
    return 'saved';
  },
}));

const storeKey = '__cvCreatorStudioStore';
const storeHolder = globalThis as typeof globalThis & {
  [storeKey]?: ReturnType<typeof createStudioStore>;
};
/** ホットリロードでモジュールが再評価されても、開いているプロジェクトを別の空ストアへ取り違えない。 */
const studioStore = storeHolder[storeKey] ?? createStudioStore();
storeHolder[storeKey] = studioStore;
export const useStudioStore = studioStore;
