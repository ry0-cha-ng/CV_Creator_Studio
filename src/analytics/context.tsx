import { createContext, useContext } from 'react';
import type { AnalyticsBundle, PrimaryVariable } from '../../shared/schema/analytics';

export type DetailTab = 'overview' | 'posts' | 'experiments' | 'insights';
export type AnalyticsPage = 'home' | 'guide' | 'weekly' | 'experiment-new';

export type AnalyticsContextValue = {
  bundle: AnalyticsBundle | null;
  reload: () => Promise<void>;
  pausedToday: boolean;
  setPausedToday: (value: boolean) => void;
  openReview: (taskId?: string) => void;
  openDetail: (tab: DetailTab) => void;
  openWeekly: () => void;
  openExperimentNew: (variable?: PrimaryVariable) => void;
  openProject: (projectId: string) => void;
};

export const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

export const useAnalytics = (): AnalyticsContextValue => {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error('分析の状態がありません');
  return value;
};

export const useAnalyticsOptional = (): AnalyticsContextValue | null => useContext(AnalyticsContext);
