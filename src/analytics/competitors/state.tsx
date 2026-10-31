import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import type { ObservedVideo } from '../../../shared/schema/competitor-observation';

export type CompetitorView = 'channels' | 'compare' | 'focus' | 'inbox';

/** ドロワーで開いている動画と、前後に移れる並び。 */
export type DrawerState = { list: ObservedVideo[]; index: number };

type State = {
  view: CompetitorView;
  channelId: string | null;
  drawer: DrawerState | null;
  /** 横断比較で選んだ subject。null なら全部。 */
  compareSubjects: string[] | null;
  message: { text: string; tone: 'error' | 'info' } | null;
};

type Action =
  | { type: 'view'; view: CompetitorView }
  | { type: 'channel'; id: string | null }
  | { type: 'drawer'; drawer: DrawerState | null }
  | { type: 'drawer-step'; delta: number }
  | { type: 'drawer-update'; video: ObservedVideo }
  | { type: 'compare-subjects'; subjects: string[] | null }
  | { type: 'message'; text: string; tone?: 'error' | 'info' }
  | { type: 'clear-message' };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'view':
      return { ...state, view: action.view, channelId: action.view === 'channels' ? state.channelId : null, message: null };
    case 'channel':
      return { ...state, view: 'channels', channelId: action.id, message: null };
    case 'drawer':
      return { ...state, drawer: action.drawer };
    case 'drawer-step': {
      if (!state.drawer) return state;
      const index = Math.min(state.drawer.list.length - 1, Math.max(0, state.drawer.index + action.delta));
      return { ...state, drawer: { ...state.drawer, index } };
    }
    case 'drawer-update': {
      if (!state.drawer) return state;
      const list = state.drawer.list.map((item) => (item.videoId === action.video.videoId ? action.video : item));
      return { ...state, drawer: { ...state.drawer, list } };
    }
    case 'compare-subjects':
      return { ...state, compareSubjects: action.subjects };
    case 'message':
      return { ...state, message: action.text ? { text: action.text, tone: action.tone ?? 'error' } : null };
    case 'clear-message':
      return { ...state, message: null };
    default:
      return state;
  }
};

const initial: State = { view: 'channels', channelId: null, drawer: null, compareSubjects: null, message: null };

type Context = {
  state: State;
  go: (view: CompetitorView) => void;
  openChannel: (id: string | null) => void;
  openVideo: (list: ObservedVideo[], videoId: string) => void;
  closeVideo: () => void;
  stepVideo: (delta: number) => void;
  updateVideo: (video: ObservedVideo) => void;
  setCompareSubjects: (subjects: string[] | null) => void;
  say: (text: string, tone?: 'error' | 'info') => void;
};

const CompetitorContext = createContext<Context | null>(null);

export const CompetitorStateProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initial);
  const value = useMemo<Context>(
    () => ({
      state,
      go: (view) => dispatch({ type: 'view', view }),
      openChannel: (id) => dispatch({ type: 'channel', id }),
      openVideo: (list, videoId) => {
        const index = list.findIndex((item) => item.videoId === videoId);
        dispatch({ type: 'drawer', drawer: { list, index: Math.max(0, index) } });
      },
      closeVideo: () => dispatch({ type: 'drawer', drawer: null }),
      stepVideo: (delta) => dispatch({ type: 'drawer-step', delta }),
      updateVideo: (video) => dispatch({ type: 'drawer-update', video }),
      setCompareSubjects: (subjects) => dispatch({ type: 'compare-subjects', subjects }),
      say: (text, tone) => dispatch({ type: 'message', text, tone }),
    }),
    [state],
  );
  return <CompetitorContext.Provider value={value}>{children}</CompetitorContext.Provider>;
};

export const useCompetitors = (): Context => {
  const context = useContext(CompetitorContext);
  if (!context) throw new Error('CompetitorStateProvider の外で使われています');
  return context;
};
