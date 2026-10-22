import { HOOK_PATTERN_LABELS } from './guide';
import type { HookPattern, Project } from './schema/project';
import type {
  AgeBucket,
  AnalyticsBundle,
  AnalyticsExperiment,
  AnalyticsPost,
  Decision,
  ExperimentArm,
  Insight,
  MetricSnapshot,
  NextAction,
  OpeningType,
  PrimaryMetric,
  PrimaryVariable,
  ReviewDraft,
} from './schema/analytics';
import { DELIVERY_PRESET_ORDER, DELIVERY_PRESETS, type DeliveryPresetId } from './delivery-presets';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const VARIABLE_LABELS: Record<PrimaryVariable, string> = {
  map: 'マップ',
  lang: '言語',
  hook: 'フック',
  opening: 'オープニング',
  length: '尺',
  cta: 'CTA',
  bgm: 'BGM',
  postTime: '投稿時刻',
  agent: 'エージェント',
  ability: 'アビリティ',
};

export const METRIC_LABELS: Record<PrimaryMetric, string> = {
  views: '視聴回数',
  averagePercentageViewed: '平均再生率',
  completionRate: '完全視聴率',
  appCtr: 'App CTR',
  lineupSaves: '定点の保存',
};

export const OPENING_LABELS: Record<OpeningType, string> = {
  'result-first': '結果先出し',
  'stand-first': '立ち位置先出し',
  'aim-first': '合わせ先出し',
  'highlight-first': 'ハイライト先出し',
  'question-first': '問いかけ先出し',
  other: 'その他',
};

export const NOTICE_LABELS = {
  hook: 'フックが良かった',
  length: '動画の尺が良かった',
  demand: '定点そのものの需要が高かった',
  postTime: '投稿時刻が影響したかも',
  cta: 'CTA・ClutchVaultへの導線に課題',
  unsure: '判断できない',
  other: 'その他（メモに書く）',
} as const;

export const ACTION_LABELS: Record<NextAction, string> = {
  adopt: '次の動画でも採用',
  continue: '次のN本でもう少し検証',
  reject: 'このパターンは使わない',
  'new-variable': '別の変数を検証',
  hold: '判断保留',
};

export const HYPOTHESIS_LABELS = {
  support: '仮説を支持',
  undecided: 'まだ判断しない',
  reject: '仮説を支持しない',
} as const;

type VariablePreset = {
  control: string;
  variant: string;
  metric: PrimaryMetric;
  hypothesis: string;
};

export const VARIABLE_PRESETS: Record<PrimaryVariable, VariablePreset> = {
  map: {
    control: '前回のマップ',
    variant: '別のマップ',
    metric: 'lineupSaves',
    hypothesis: 'マップを変えると、定点の保存が変わる',
  },
  lang: {
    control: 'English',
    variant: '日本語',
    metric: 'views',
    hypothesis: '言語を変えると、視聴回数が変わる',
  },
  hook: {
    control: '結果型',
    variant: '数字型',
    metric: 'averagePercentageViewed',
    hypothesis: 'フックの型を変えると、平均再生率が変わる',
  },
  opening: {
    control: '立ち位置先出し',
    variant: '結果先出し',
    metric: 'averagePercentageViewed',
    hypothesis: '結果を先に見せる方が、平均再生率が高い',
  },
  length: {
    control: '28秒',
    variant: '20秒',
    metric: 'averagePercentageViewed',
    hypothesis: '尺を変えると、平均再生率が変わる',
  },
  cta: {
    control: '最後の1秒だけ',
    variant: 'S7 全体（約2秒）',
    metric: 'appCtr',
    hypothesis: 'CTA を長く出すと、App CTR が上がる',
  },
  bgm: {
    control: 'あり',
    variant: 'なし',
    metric: 'averagePercentageViewed',
    hypothesis: 'BGM の有無で、平均再生率が変わる',
  },
  postTime: {
    control: '19:00',
    variant: '22:00',
    metric: 'views',
    hypothesis: '投稿時刻を変えると、視聴回数が変わる',
  },
  agent: {
    control: 'Phoenix',
    variant: '別のエージェント',
    metric: 'lineupSaves',
    hypothesis: 'エージェントを変えると、定点の保存が変わる',
  },
  ability: {
    control: '前回のアビリティ',
    variant: '別のアビリティ',
    metric: 'lineupSaves',
    hypothesis: 'アビリティを変えると、定点の保存が変わる',
  },
};

const SAFE_VARIABLES = new Set<PrimaryVariable>([
  'map',
  'lang',
  'hook',
  'postTime',
  'agent',
  'ability',
  'bgm',
]);

export const isSafeVariable = (variable: PrimaryVariable): boolean => SAFE_VARIABLES.has(variable);

export const divide = (numerator?: number, denominator?: number): number | null => {
  if (numerator === undefined || denominator === undefined) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
};

export const appCtr = (snapshot: MetricSnapshot | undefined): number | null =>
  divide(snapshot?.clutchVaultVisits, snapshot?.views);

export const saveRate = (snapshot: MetricSnapshot | undefined): number | null =>
  divide(snapshot?.lineupSaves, snapshot?.lineupViews);

export const savesPer1k = (snapshot: MetricSnapshot | undefined): number | null => {
  const ratio = divide(snapshot?.lineupSaves, snapshot?.views);
  return ratio === null ? null : ratio * 1000;
};

export const savesPerHour = (
  snapshot: MetricSnapshot | undefined,
  productionMinutes?: number,
): number | null => {
  if (productionMinutes === undefined || productionMinutes <= 0) return null;
  const ratio = divide(snapshot?.lineupSaves, productionMinutes / 60);
  return ratio;
};

export const metricOf = (
  snapshot: MetricSnapshot | undefined,
  metric: PrimaryMetric,
): number | null => {
  if (!snapshot) return null;
  if (metric === 'views') return snapshot.views ?? null;
  if (metric === 'averagePercentageViewed') return snapshot.averagePercentageViewed ?? null;
  if (metric === 'completionRate') return snapshot.completionRate ?? null;
  if (metric === 'lineupSaves') return snapshot.lineupSaves ?? null;
  return appCtr(snapshot);
};

export const latestSnapshot = (
  snapshots: MetricSnapshot[],
  postId: string,
  bucket: AgeBucket = '7d',
): MetricSnapshot | undefined =>
  snapshots
    .filter((item) => item.postId === postId && item.ageBucket === bucket)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];

export const dueAtFor7d = (postedAt: string): string => {
  const posted = new Date(postedAt);
  if (Number.isNaN(posted.getTime())) return new Date().toISOString();
  return new Date(posted.getTime() + 7 * DAY_MS).toISOString();
};

export const promoteTaskStatus = <T extends { status: string; dueAt: string }>(
  task: T,
  now = Date.now(),
): T => {
  if (task.status !== 'waiting') return task;
  const due = new Date(task.dueAt).getTime();
  if (Number.isNaN(due) || due > now) return task;
  return { ...task, status: 'ready' };
};

export type Cohort = {
  label: string;
  count: number;
  views: number | null;
  averagePercentageViewed: number | null;
  appCtr: number | null;
};

const mean = (values: Array<number | null>): number | null => {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
};

export const comparisonCohort = (
  bundle: AnalyticsBundle,
  post: AnalyticsPost,
  limit = 10,
): Cohort => {
  const series = post.content.series || 'phoenix-lineups';
  const peers = bundle.posts
    .filter(
      (item) =>
        item.id !== post.id &&
        item.content.series === series &&
        item.platform === post.platform &&
        item.lang === post.lang,
    )
    .map((item) => ({ item, snapshot: latestSnapshot(bundle.snapshots, item.id) }))
    .filter((item) => item.snapshot)
    .sort((a, b) => b.item.postedAt.localeCompare(a.item.postedAt))
    .slice(0, limit);
  const platform =
    post.platform === 'youtube' ? 'YouTube' : post.platform === 'tiktok' ? 'TikTok' : 'X';
  const lang = post.lang === 'en' ? 'English' : '日本語';
  return {
    label: `${series} · ${platform} ${lang} の直近${limit}本の平均（n=${peers.length}）`,
    count: peers.length,
    views: mean(peers.map((item) => item.snapshot?.views ?? null)),
    averagePercentageViewed: mean(
      peers.map((item) => item.snapshot?.averagePercentageViewed ?? item.snapshot?.completionRate ?? null),
    ),
    appCtr: mean(peers.map((item) => appCtr(item.snapshot))),
  };
};

export const percentDelta = (current: number | null, baseline: number | null): number | null => {
  if (current === null || baseline === null || baseline === 0) return null;
  return (current - baseline) / Math.abs(baseline);
};

export const pointDelta = (current: number | null, baseline: number | null): number | null => {
  if (current === null || baseline === null) return null;
  return current - baseline;
};

export const formatInt = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString('ja-JP');

export const formatPct = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`;

export const formatRatioPct = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(2)}%`;

export const formatSignedPct = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '—';
  const pct = Math.round(value * 100);
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`.replace('-', '−');
};

export const formatSignedPt = (value: number | null, digits = 0): string => {
  if (value === null || !Number.isFinite(value)) return '—';
  const text = `${value > 0 ? '+' : ''}${value.toFixed(digits)}pt`;
  return text.replace('-', '−');
};

export const isReferenceSample = (count: number): boolean => count < 3;

export type AttributeMap = Record<PrimaryVariable, string>;

export const ctaTypeLabel = (
  ctaType: AnalyticsPost['ctaType'],
  motion?: boolean,
): string => {
  if (ctaType === 'like-revisit') return motion === false ? '高評価（静止）' : '高評価して見返す';
  if (ctaType === 'clutchvault-save') return '保存導線';
  if (ctaType === 'none') return 'なし';
  return ctaType || '未設定';
};

export const attributesOf = (post: AnalyticsPost): AttributeMap => ({
  map: post.content.map,
  lang: post.lang === 'en' ? 'English' : '日本語',
  hook: HOOK_PATTERN_LABELS[post.hookPattern],
  opening: post.openingType ? OPENING_LABELS[post.openingType] : '未設定',
  length: post.durationSec ? `${Math.round(post.durationSec)}秒` : post.content.durationLabel || '未設定',
  cta: ctaTypeLabel(post.ctaType, post.content.ctaMotion),
  bgm: post.withBgm ? 'あり' : 'なし',
  postTime: post.postedAt.slice(11, 16) || '未設定',
  agent: post.content.agent,
  ability: post.content.ability,
});

export const differingVariables = (posts: AnalyticsPost[]): PrimaryVariable[] => {
  const keys = Object.keys(VARIABLE_LABELS) as PrimaryVariable[];
  return keys.filter((key) => new Set(posts.map((post) => attributesOf(post)[key])).size > 1);
};

export const armAverage = (
  bundle: AnalyticsBundle,
  experiment: AnalyticsExperiment,
  arm: ExperimentArm,
): { average: number | null; count: number } => {
  const posts = bundle.posts.filter(
    (post) => post.experimentId === experiment.id && post.experimentArm === arm,
  );
  const values = posts.map((post) => metricOf(latestSnapshot(bundle.snapshots, post.id), experiment.primaryMetric));
  return { average: mean(values), count: posts.length };
};

const hookFromLabel = (value: string): HookPattern | undefined => {
  const found = (Object.entries(HOOK_PATTERN_LABELS) as Array<[HookPattern, string]>).find(
    ([, label]) => label === value || value === label,
  );
  if (found) return found[0];
  if (value in HOOK_PATTERN_LABELS) return value as HookPattern;
  return undefined;
};

const presetForLanguage = (language: 'ja' | 'en'): DeliveryPresetId[] =>
  language === 'en' ? ['yt-global', 'x-jp'] : ['tt-jp', 'yt-ja', 'x-jp'];

/** 既存の制作欄だけを書き換える。シーン順とテロップ本文は変えない。 */
export const applySafeValue = (
  project: Project,
  variable: PrimaryVariable | undefined,
  value: string | undefined,
): Project => {
  if (!variable || !value) return project;
  const next: Project = {
    ...project,
    lineup: { ...project.lineup },
    guide: { ...project.guide, exportPresets: [...project.guide.exportPresets] },
    audio: { ...project.audio },
    analytics: { ...project.analytics },
  };
  if (variable === 'hook') {
    const pattern = hookFromLabel(value);
    if (pattern) next.hookPattern = pattern;
    return next;
  }
  if (variable === 'map') {
    next.lineup.map = value;
    return next;
  }
  if (variable === 'agent') {
    next.lineup.agent = value;
    return next;
  }
  if (variable === 'ability') {
    next.lineup.ability = value;
    return next;
  }
  if (variable === 'lang') {
    const language = value === '日本語' || value === 'ja' ? 'ja' : 'en';
    const wanted = presetForLanguage(language);
    next.guide.exportPresets = DELIVERY_PRESET_ORDER.filter((id) => wanted.includes(id));
    return next;
  }
  if (variable === 'postTime' && /^\d{2}:\d{2}$/.test(value)) {
    const base = next.plannedPostDate ? new Date(next.plannedPostDate) : new Date();
    if (!Number.isNaN(base.getTime())) {
      const [hour, minute] = value.split(':').map(Number);
      base.setHours(hour ?? 19, minute ?? 0, 0, 0);
      next.plannedPostDate = base.toISOString();
    }
    return next;
  }
  if (variable === 'bgm') {
    if (value === 'なし' || value === 'none') next.audio.bgm = null;
    return next;
  }
  if (variable === 'opening') {
    const opening = (Object.entries(OPENING_LABELS) as Array<[OpeningType, string]>).find(
      ([, label]) => label === value,
    );
    next.analytics.openingType = opening?.[0] ?? 'other';
    return next;
  }
  if (variable === 'cta') {
    next.analytics.ctaType = value === 'なし' ? 'none' : 'clutchvault-save';
    next.analytics.durationLabel = value;
    return next;
  }
  if (variable === 'length') {
    next.analytics.durationLabel = value;
  }
  return next;
};

export const applyAdoptedInsights = (project: Project, insights: Insight[]): Project => {
  const adopted = insights.filter((item) => item.status === 'adopted' && item.applyAsDefault);
  let next = project;
  for (const insight of adopted) {
    next = applySafeValue(next, insight.variable, insight.value);
  }
  return {
    ...next,
    appliedInsightIds: adopted.map((item) => item.id),
  };
};

export const decisionFromAction = (
  draft: ReviewDraft,
  experiment?: AnalyticsExperiment,
): Pick<Decision, 'conclusion' | 'summary' | 'applyToNextProjects' | 'remainingApplyCount' | 'variable' | 'value' | 'arm' | 'nextAction'> => {
  const action = draft.action ?? 'hold';
  const variable = experiment?.primaryVariable;
  const value = experiment?.variantLabels[0];
  if (action === 'adopt') {
    return {
      conclusion: 'adopt',
      summary: value ? `${value}を標準にする` : 'この条件を次の動画でも使う',
      applyToNextProjects: true,
      remainingApplyCount: 1,
      variable,
      value,
      arm: 'variant',
      nextAction: ACTION_LABELS.adopt,
    };
  }
  if (action === 'continue') {
    const count = draft.continueCount;
    return {
      conclusion: 'continue-test',
      summary: value ? `${value}を、あと${count}本で検証` : `あと${count}本で検証`,
      applyToNextProjects: draft.applyToNext,
      remainingApplyCount: count,
      variable,
      value,
      arm: 'variant',
      nextAction: ACTION_LABELS.continue,
    };
  }
  if (action === 'reject') {
    return {
      conclusion: 'reject',
      summary: 'このパターンは使わない',
      applyToNextProjects: false,
      variable,
      value,
      nextAction: ACTION_LABELS.reject,
    };
  }
  if (action === 'new-variable') {
    return {
      conclusion: 'hold',
      summary: '別の変数を検証する',
      applyToNextProjects: false,
      nextAction: ACTION_LABELS['new-variable'],
    };
  }
  return {
    conclusion: 'hold',
    summary: '判断を保留する',
    applyToNextProjects: false,
    nextAction: ACTION_LABELS.hold,
  };
};

export const readyTasks = (bundle: AnalyticsBundle, now = Date.now()) =>
  bundle.tasks
    .map((task) => promoteTaskStatus(task, now))
    .filter((task) => task.type === '7d-review' && (task.status === 'ready' || task.status === 'in-progress'))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

export const weekKey = (date = new Date()): string => {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
};

export const weekRangeLabel = (key: string): string => {
  const start = new Date(`${key}T00:00:00`);
  if (Number.isNaN(start.getTime())) return key;
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const stamp = (value: Date) =>
    `${String(value.getMonth() + 1).padStart(2, '0')}/${String(value.getDate()).padStart(2, '0')}`;
  return `${stamp(start)}〜${stamp(end)}`;
};

export type UnlinkedConclusion = {
  id: string;
  kind: 'decision' | 'experiment';
  label: string;
  at: string;
};

export const unlinkedConclusions = (bundle: AnalyticsBundle): UnlinkedConclusion[] => {
  const linkedDecisions = new Set(bundle.insights.flatMap((item) => item.linkedDecisionIds));
  const linkedExperiments = new Set(bundle.insights.flatMap((item) => item.linkedExperimentIds));
  const decisions = bundle.decisions
    .filter((item) => !item.insightId && !linkedDecisions.has(item.id))
    .map((item) => ({
      id: item.id,
      kind: 'decision' as const,
      label: item.summary || '振り返りの決定',
      at: item.createdAt,
    }));
  const experiments = bundle.experiments
    .filter((item) => item.conclusion && !linkedExperiments.has(item.id))
    .map((item) => ({
      id: item.id,
      kind: 'experiment' as const,
      label: `「${item.name}」の結論`,
      at: item.updatedAt,
    }));
  return [...experiments, ...decisions].sort((a, b) => b.at.localeCompare(a.at));
};

export const platformLabel = (platform: string): string => {
  if (platform === 'youtube') return 'YouTube Shorts';
  if (platform === 'tiktok') return 'TikTok';
  return 'X';
};

export const langLabel = (lang: string): string => (lang === 'en' ? 'English' : '日本語');

export const presetLanguageLabel = (preset: DeliveryPresetId): string => DELIVERY_PRESETS[preset].label;

export const decreasedFields = (
  current: MetricSnapshot,
  previous: MetricSnapshot | undefined,
): string[] => {
  if (!previous) return [];
  const fields: Array<[keyof MetricSnapshot, string]> = [
    ['views', '視聴回数'],
    ['likes', '高評価'],
    ['shares', '共有'],
    ['saves', '保存'],
    ['subscribersGained', '登録者の増加'],
    ['followersGained', 'フォロワーの増加'],
    ['clutchVaultVisits', '訪問'],
    ['lineupSaves', '定点の保存'],
    ['deckAdds', 'Deck追加'],
    ['signups', '登録'],
  ];
  return fields.flatMap(([key, label]) => {
    const next = current[key];
    const prev = previous[key];
    if (typeof next !== 'number' || typeof prev !== 'number') return [];
    if (next < prev) return [`${label}が前の時点の値（${prev}）より少なくなっています`];
    return [];
  });
};

export const fixedConditionsFromPost = (post: AnalyticsPost, variable: PrimaryVariable): Record<string, string> => {
  const attributes = attributesOf(post);
  const conditions: Record<string, string> = {};
  for (const key of Object.keys(attributes) as PrimaryVariable[]) {
    if (key === variable) continue;
    conditions[key] = attributes[key];
  }
  return conditions;
};

export const secondaryChanges = (
  post: AnalyticsPost,
  fixed: Record<string, string>,
): string[] => {
  const attributes = attributesOf(post);
  return Object.entries(fixed).flatMap(([key, expected]) => {
    const actual = attributes[key as PrimaryVariable];
    if (!expected || actual === expected) return [];
    return [VARIABLE_LABELS[key as PrimaryVariable] ?? key];
  });
};

export type OverviewFilters = {
  days: number | null;
  platform: string;
  lang: string;
  series: string;
  templateId: string;
};

export const filterPosts = (
  bundle: AnalyticsBundle,
  filters: OverviewFilters,
  now = Date.now(),
): AnalyticsPost[] =>
  bundle.posts.filter((post) => {
    if (filters.platform !== 'all' && post.platform !== filters.platform) return false;
    if (filters.lang !== 'all' && post.lang !== filters.lang) return false;
    if (filters.series !== 'all' && post.content.series !== filters.series) return false;
    if (filters.templateId !== 'all' && post.templateId !== filters.templateId) return false;
    if (filters.days !== null) {
      const posted = new Date(post.postedAt).getTime();
      if (Number.isNaN(posted) || now - posted > filters.days * DAY_MS) return false;
    }
    return true;
  });

export type GroupRow = { name: string; value: number | null; count: number };

export const groupMetric = (
  bundle: AnalyticsBundle,
  posts: AnalyticsPost[],
  key: 'map' | 'hook' | 'opening',
  metric: 'savesPer1k' | 'views' | 'appCtr',
): GroupRow[] => {
  const groups = new Map<string, AnalyticsPost[]>();
  for (const post of posts) {
    const name =
      key === 'map'
        ? post.content.map || '未設定'
        : key === 'hook'
          ? HOOK_PATTERN_LABELS[post.hookPattern]
          : post.openingType
            ? OPENING_LABELS[post.openingType]
            : '未設定';
    groups.set(name, [...(groups.get(name) ?? []), post]);
  }
  return [...groups.entries()]
    .map(([name, items]) => {
      const snapshots = items
        .map((item) => latestSnapshot(bundle.snapshots, item.id))
        .filter((item): item is MetricSnapshot => Boolean(item));
      const value =
        metric === 'views'
          ? mean(snapshots.map((item) => item.views ?? null))
          : metric === 'appCtr'
            ? mean(snapshots.map((item) => appCtr(item)))
            : mean(snapshots.map((item) => savesPer1k(item)));
      return { name, value, count: snapshots.length };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
};

export const analyticsCsv = (bundle: AnalyticsBundle): string => {
  const header = [
    'postId',
    'projectId',
    'preset',
    'platform',
    'lang',
    'postedAt',
    'url',
    'utm_content',
    'map',
    'agent',
    'ability',
    'hook',
    'opening',
    'views',
    'averagePercentageViewed',
    'clutchVaultVisits',
    'lineupSaves',
    'deckAdds',
    'signups',
    'appCtr',
    'experimentId',
    'experimentArm',
  ];
  const cell = (value: string | number | undefined | null): string => {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [header.join(',')];
  for (const post of bundle.posts) {
    const snapshot = latestSnapshot(bundle.snapshots, post.id);
    lines.push(
      [
        post.id,
        post.projectId,
        post.preset,
        post.platform,
        post.lang,
        post.postedAt,
        post.url,
        post.utmContent ?? '',
        post.content.map,
        post.content.agent,
        post.content.ability,
        post.hookPattern,
        post.openingType ?? '',
        snapshot?.views,
        snapshot?.averagePercentageViewed,
        snapshot?.clutchVaultVisits,
        snapshot?.lineupSaves,
        snapshot?.deckAdds,
        snapshot?.signups,
        appCtr(snapshot) ?? '',
        post.experimentId ?? '',
        post.experimentArm ?? '',
      ]
        .map(cell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
};

export const STEP_HINTS = [
  '必須は視聴回数と平均再生率だけ',
  'ここでは判断しません。見るだけ',
  '主KPIだけで見ます。本数が少ないうちは参考値です',
  '原因は1つに決めません',
  '次にすることを1つだけ決めます',
  '内容を確かめて保存します',
] as const;

export const STEP_TITLES = ['実績入力', '結果確認', '仮説評価', '気づき', '次アクション', '完了'] as const;

export const emptyDraft = (): ReviewDraft => ({
  notices: [],
  memo: '',
  continueCount: 1,
  applyToNext: true,
});
