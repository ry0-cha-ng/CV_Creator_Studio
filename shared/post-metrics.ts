import { EXPERIMENT_VARIABLE_LABELS, type DeliveryPresetId } from './delivery-presets';
import { HOOK_PATTERN_LABELS } from './guide';
import { guessBasename } from './export-copy';
import type { Project } from './schema/project';

const DAY_MS = 7 * 24 * 60 * 60 * 1000;

export const metricsAreDue = (postedAt: string, now = Date.now()): boolean => {
  const posted = new Date(postedAt).getTime();
  if (Number.isNaN(posted)) return false;
  return now - posted >= DAY_MS;
};

export const defaultCapturedAt = (postedAt: string): string => {
  const posted = new Date(postedAt);
  if (Number.isNaN(posted.getTime())) return new Date().toISOString();
  posted.setDate(posted.getDate() + 7);
  return posted.toISOString();
};

export const pendingMetricsCount = (project: Pick<Project, 'posts'>): number =>
  project.posts.filter((post) => post.url.trim() && !post.metrics).length;

const csvCell = (value: string | number | undefined): string => {
  const text = value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
};

const METRIC_KEYS = [
  'views',
  'avgViewPct',
  'retention3s',
  'likes',
  'saves',
  'shares',
  'bookmarks',
  'profileVisits',
  'linkClicks',
  'subscribersGained',
  'cvSaves',
] as const;

export const postsToCsv = (projects: Project[], now = new Date()): string => {
  const header = [
    'ベース名',
    'プリセット',
    '投稿先',
    '言語',
    '投稿日時',
    'マップ',
    'エージェント',
    'スキル',
    'フックの型',
    'フェーズ',
    '動かした変数',
    '仮説',
    '取得日',
    ...METRIC_KEYS,
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const project of projects) {
    for (const post of project.posts) {
      const preset = post.preset as DeliveryPresetId;
      const cells = [
        guessBasename(project, preset, now),
        post.preset,
        post.platform,
        post.lang,
        post.postedAt,
        project.lineup.map,
        project.lineup.agent,
        project.lineup.ability,
        HOOK_PATTERN_LABELS[project.hookPattern],
        project.experiment.phase,
        project.experiment.testVariables.map((item) => EXPERIMENT_VARIABLE_LABELS[item]).join('|'),
        project.experiment.hypothesis ?? '',
        post.metrics?.capturedAt ?? '',
        ...METRIC_KEYS.map((key) => post.metrics?.[key]),
      ];
      lines.push(cells.map(csvCell).join(','));
    }
  }
  return `\uFEFF${lines.join('\r\n')}`;
};
