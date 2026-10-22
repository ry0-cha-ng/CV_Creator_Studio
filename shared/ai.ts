import { z } from 'zod';
import {
  ACTION_LABELS,
  HYPOTHESIS_LABELS,
  NOTICE_LABELS,
  appCtr,
  armAverage,
  attributesOf,
  comparisonCohort,
  latestSnapshot,
} from './analytics';
import { HOOK_PATTERN_LABELS, captionMetrics } from './guide';
import type { AnalyticsBundle, AnalyticsPost, Notice, ReviewDraft } from './schema/analytics';
import type { Project } from './schema/project';

export const aiProviderChoiceSchema = z.enum([
  'auto',
  'claude-local-agent',
  'claude-code-cli',
  'claude-code-handoff',
  'disabled',
]);
export type AiProviderChoice = z.infer<typeof aiProviderChoiceSchema>;

export const aiRuntimeProviderSchema = z.enum([
  'claude-local-agent',
  'claude-code-cli',
  'claude-code-handoff',
]);
export type AiRuntimeProvider = z.infer<typeof aiRuntimeProviderSchema>;

export const aiKindSchema = z.enum([
  'captions',
  'publishing',
  'summary',
  'hypothesis',
  'notices',
  'next-action',
]);
export type AiKind = z.infer<typeof aiKindSchema>;

export const aiErrorCodeSchema = z.enum([
  'disabled',
  'unauthenticated',
  'rate_limited',
  'timeout',
  'cancelled',
  'invalid_output',
  'unavailable',
  'busy',
]);
export type AiErrorCode = z.infer<typeof aiErrorCodeSchema>;

export const AUTO_PROVIDERS = [
  'claude-local-agent',
  'claude-code-cli',
  'claude-code-handoff',
] as const satisfies readonly AiRuntimeProvider[];

export const AI_PROVIDER_LABELS: Record<AiProviderChoice, string> = {
  auto: 'Auto（サブスクの順）',
  'claude-local-agent': 'Claude Agent SDK',
  'claude-code-cli': 'Claude Code CLI（claude -p）',
  'claude-code-handoff': 'Claude Code に手動で渡す',
  disabled: '無効',
};

export const AI_ERROR_MESSAGE: Record<AiErrorCode, string> = {
  disabled: 'AIはオフです。手入力のまま進められます。',
  unauthenticated:
    'Claudeにログインしていません。Claude Code でログインするか、下の文を手動で渡してください。従量課金のAPIには切り替えません。',
  rate_limited:
    'Claudeの利用上限に達しました。課金APIには切り替えません。手入力で続けるか、上限が戻ってからもう一度押してください。',
  timeout: 'Claudeからの応答が時間内に返りませんでした。手入力で続けるか、しばらくしてからもう一度押してください。',
  cancelled: '生成を中止しました。入力内容はそのままです。',
  invalid_output:
    'AIの返答を候補として読めませんでした。手入力で続けるか、返ってきたJSONを貼り戻してください。',
  unavailable:
    'Claudeを自動で呼び出せません。下の文を Claude Code に貼り、返ってきたJSONを貼り戻してください。',
  busy: '別の生成が進行中です。終わるか、中止してからもう一度押してください。',
};

export const AI_DISCLAIMER = '相関の話で、原因は断定していません';

export const AI_HELP = {
  settings: {
    title: 'AIの使い方',
    summary: 'AIは候補を出すだけです。採用するまで保存しません。動画と音源は送りません。',
    steps: [
      '右上の歯車で経路を選びます。既定の Auto は、Claude Agent SDK、次に claude コマンド、どちらも無理なら貼り付け用の文、の順です。',
      '各画面の「AIで案を作る」か「AIに要約してもらう」を押したときだけ動きます。勝手には呼びません。',
      '気に入った案だけ「採用」します。無視すれば、今までどおり手入力で完結します。',
      '利用上限に達したら止まります。従量課金のAPIへは切り替えません。',
    ],
    note: 'このPCに Claude Code が入っていないときは「手動のみ」になります。出た文を Claude に貼り、返ったJSONを同じ枠に戻してください。',
  },
  captions: {
    title: 'テロップ案の使い方',
    summary: '定点のテキストと文字数の上限だけを送り、最大3案を出します。動画は送りません。',
    steps: [
      '指示欄に希望を書くと、その内容で案を出します。空なら今までどおりです。',
      '「AIで案を作る」を押します。送る内容がボタンの上に出ます。',
      '1案ずつ見て、「採用」か「編集して採用」を選びます。「次の案」で残りを見ます。',
      '採用後も、行数や文字数のはみ出しは今までどおり欄の下に出ます。',
    ],
    note: '生成中は「中止」できます。失敗しても、入っているテロップは消えません。',
  },
  publishing: {
    title: '投稿文案の使い方',
    summary: '定点・テロップ・今の投稿文だけを送り、タイトル・説明・タグの案を最大3つ出します。',
    steps: [
      '指示欄に希望を書くと、その内容で案を出します。空なら今までどおりです。',
      '「AIで案を作る」を押します。',
      '採用すると、その欄は手修正扱いになり、あとから雛形で上書きされません。',
      '韓国語欄は、YouTube（海外）を書き出し先に含めているときだけ対象です。',
    ],
    note: '動画ファイルは送りません。使わない案は無視して、雛形のまま進められます。',
  },
  summary: {
    title: '結果要約の使い方',
    summary: 'この投稿の数字・作り方と、比較した投稿の平均だけを送ります。動画は送りません。',
    steps: [
      '「AIに要約してもらう」を押します。',
      '「良かった点」「気になる点」が各最大2件出ます。',
      'ここでは判断しません。次の手順で仮説を見ます。',
    ],
    note: '参照した件数を表示します。相関であり、原因の断定ではありません。',
  },
  hypothesis: {
    title: '仮説候補の使い方',
    summary: '実験の仮説と、Control / Variant の主KPIだけを送り、判断候補を1つ出します。',
    steps: [
      '「AIに候補を出してもらう」を押します。',
      '「この候補を選ぶ」は、上の3つのボタンを選ぶだけです。振り返りの保存は別です。',
      '本数が少ないときは「判断材料不足」になり得ます。そのときは「まだ判断しない」が妥当です。',
    ],
    note: '自動では選ばれません。',
  },
  notices: {
    title: '気づき候補の使い方',
    summary: '今回の数字と作り方から、メモに足す文を最大3件出します。',
    steps: [
      '「AIに候補を出してもらう」を押します。',
      '「メモに追加」を押した行だけ、下のメモに足します。',
      'チェックの選択は変わりません。必要なものだけ自分で押してください。',
    ],
    note: '原因を1つに決める画面ではありません。',
  },
  nextAction: {
    title: '次アクション候補の使い方',
    summary: 'ここまでの下書きと数字から、次の1手の候補を1つ出します。',
    steps: [
      '「AIに候補を出してもらう」を押します。',
      '「この候補を選ぶ」は、上のラジオを選ぶだけです。',
      '本数や「次のプロジェクトに出す」は、選んだあと自分で調整します。',
    ],
    note: '完了の保存は、最後の手順で自分で押します。',
  },
} as const;

export type AiHelpId = keyof typeof AI_HELP;

export const AI_SENT: Record<AiKind, string> = {
  captions: '定点のテキストと文字数の上限を送ります（動画は送りません）',
  publishing: '定点・テロップ・今の投稿文を送ります（動画は送りません）',
  summary: 'この投稿の数字・作り方と、比較した平均を送ります（動画は送りません）',
  hypothesis: '実験の仮説と、Control / Variant の主KPIを送ります（動画は送りません）',
  notices: '今回の数字と作り方を送ります（動画は送りません）',
  'next-action': 'ここまでの下書きと数字の要約を送ります（動画は送りません）',
};

const localizedSchema = z.object({
  ja: z.string().max(400).default(''),
  en: z.string().max(400).default(''),
});

const publishingTextSchema = localizedSchema.extend({
  ko: z.string().max(400).optional(),
});

const longPublishingTextSchema = z.object({
  ja: z.string().max(2000).default(''),
  en: z.string().max(2000).default(''),
  ko: z.string().max(2000).optional(),
});

export type CaptionCandidate = {
  hook: { ja: string; en: string };
  stand: { ja: string; en: string };
  aim: { ja: string; en: string };
  demo?: { ja: string; en: string };
  rationale?: string;
};

export type PublishingCandidate = {
  title: { ja: string; en: string; ko?: string };
  description: { ja: string; en: string; ko?: string };
  hashtags: { ja: string; en: string; ko?: string };
  rationale?: string;
};

export type AiPayload =
  | { type: 'captions'; candidates: CaptionCandidate[] }
  | { type: 'publishing'; candidates: PublishingCandidate[] }
  | { type: 'summary'; good: string[]; concerns: string[]; insufficient: boolean }
  | {
      type: 'hypothesis';
      judgement: 'support' | 'undecided' | 'reject';
      insufficient: boolean;
    }
  | { type: 'notices'; items: Array<{ notice: Notice; text: string }> }
  | {
      type: 'next-action';
      action: 'adopt' | 'continue' | 'reject' | 'new-variable' | 'hold';
      continueCount?: 1 | 2 | 3;
      insufficient: boolean;
    };

export type AiSourceCounts = { posts: number; experiments: number };

export type AiSuggestion = {
  id: string;
  kind: AiKind;
  provider: AiRuntimeProvider;
  createdAt: string;
  sourceRefs: string[];
  rationale?: string;
  status: 'proposed';
  sourceCounts: AiSourceCounts;
  disclaimer?: string;
  payload: AiPayload;
};

export type AiHandoff = {
  kind: AiKind;
  prompt: string;
  filePath: string;
  sourceCounts: AiSourceCounts;
  sourceRefs: string[];
};

export type AiGenerateSuccess = {
  ok: true;
  provider: AiRuntimeProvider;
  suggestions: AiSuggestion[];
  sentSummary: string;
  handoff?: AiHandoff;
};

export type AiGenerateFailure = {
  ok: false;
  code: AiErrorCode;
  message: string;
  handoff?: AiHandoff;
};

export type AiGenerateResult = AiGenerateSuccess | AiGenerateFailure;

export const clipAiInstruction = (value: unknown): string =>
  (typeof value === 'string' ? value.trim() : '').slice(0, 400);

export type AiGenerateRequest =
  | { kind: 'captions' | 'publishing'; project: Project; instruction?: string }
  | {
      kind: 'summary' | 'hypothesis' | 'notices' | 'next-action';
      bundle: AnalyticsBundle;
      postId: string;
      draft?: ReviewDraft;
    };

export type AiHandoffParseRequest = {
  kind: AiKind;
  text: string;
  sourceCounts: AiSourceCounts;
  sourceRefs: string[];
};

export type AiStatus = {
  provider: AiProviderChoice;
  phase: 'ready' | 'disabled' | 'manual' | 'limited';
  label: string;
  detail: string;
  cliFound: boolean;
};

export type AiUsageWindow = {
  label: string;
  remainingPercent: number;
  resetsAt: string | null;
};

export type AiPlanUsage = {
  windows: AiUsageWindow[];
  headline: string;
  low: boolean;
};

const usageWindow = (label: string, value: unknown): AiUsageWindow | null => {
  if (!value || typeof value !== 'object') return null;
  const utilization = (value as { utilization?: unknown }).utilization;
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null;
  const remainingPercent = Math.max(0, Math.min(100, Math.round(100 - utilization)));
  const resetsAt = (value as { resets_at?: unknown }).resets_at;
  return {
    label,
    remainingPercent,
    resetsAt: typeof resetsAt === 'string' ? resetsAt : null,
  };
};

/** Claudeの5時間・7日の利用枠。utilization は使用済み%、返し値は残り%。 */
export const planUsageFromRateLimits = (rateLimits: unknown): AiPlanUsage | null => {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  const record = rateLimits as { five_hour?: unknown; seven_day?: unknown };
  const windows = [usageWindow('5時間', record.five_hour), usageWindow('7日', record.seven_day)].filter(
    (item): item is AiUsageWindow => item !== null,
  );
  if (windows.length === 0) return null;
  return {
    windows,
    headline: windows.map((item) => `${item.label} 残${item.remainingPercent}%`).join(' · '),
    low: windows.some((item) => item.remainingPercent <= 20),
  };
};

export const providersFor = (choice: AiProviderChoice): readonly AiRuntimeProvider[] => {
  if (choice === 'disabled') return [];
  if (choice === 'auto') return AUTO_PROVIDERS;
  return [choice];
};

export const shouldContinue = (choice: AiProviderChoice, code: AiErrorCode): boolean =>
  choice === 'auto' && (code === 'unavailable' || code === 'unauthenticated');

export const offerHandoff = (code: AiErrorCode): boolean =>
  code === 'unavailable' || code === 'unauthenticated' || code === 'invalid_output';

export const omitApiCredentials = (
  source: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  const env = { ...source };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
};

const MEDIA_PATH =
  /(?:^|["\\/:])[^"\s]+\.(?:mp4|mov|webm|wav|mp3|m4a|ogg|png|jpe?g)(?:"|$)/i;

export const findUnsafeContext = (value: unknown): string | null => {
  const text = JSON.stringify(value);
  if (MEDIA_PATH.test(text)) return 'media';
  if (/ANTHROPIC_API_KEY|sk-ant-/i.test(text)) return 'secret';
  return null;
};

const textOf = (project: Project, id: string): { ja: string; en: string } => {
  const caption = project.captions.find((item) => item.id === id);
  return { ja: caption?.text.ja ?? '', en: caption?.text.en ?? '' };
};

export const buildCaptionContext = (project: Project) => ({
  lineup: {
    map: project.lineup.map,
    site: project.lineup.site,
    side: project.lineup.side,
    agent: project.lineup.agent,
    ability: project.lineup.ability,
    throwType: project.lineup.throwType,
    charge: project.lineup.charge ?? null,
    bounce: project.lineup.bounce ?? null,
    crouch: project.lineup.crouch,
    standDescription: project.lineup.standDescription,
    aimDescription: project.lineup.aimDescription,
  },
  hookPattern: HOOK_PATTERN_LABELS[project.hookPattern],
  limits: {
    hookMaxLines: 3,
    otherMaxLines: 2,
    jaMaxChars: 15,
    enMaxWords: project.englishCaptionPreset === 'en-concise' ? 4 : 5,
  },
  captions: {
    hook: textOf(project, 'hook'),
    stand: textOf(project, 'stand'),
    aim: textOf(project, 'throw'),
    demo: textOf(project, 'demo'),
  },
  referencedPosts: 0,
  referencedExperiments: 0,
});

export const buildPublishingContext = (project: Project) => {
  const includeKorean = project.guide.exportPresets.includes('yt-global');
  const field = (name: 'title' | 'description' | 'hashtags') => ({
    ja: project.publishing[name].ja,
    en: project.publishing[name].en,
    ...(includeKorean ? { ko: project.publishing[name].ko ?? '' } : {}),
  });
  return {
    ...buildCaptionContext(project),
    includeKorean,
    publishing: {
      title: field('title'),
      description: field('description'),
      hashtags: field('hashtags'),
    },
  };
};

export const buildSummaryContext = (bundle: AnalyticsBundle, post: AnalyticsPost) => {
  const snapshot = latestSnapshot(bundle.snapshots, post.id);
  const cohort = comparisonCohort(bundle, post);
  const attrs = attributesOf(post);
  return {
    post: {
      platform: post.platform,
      lang: post.lang,
      map: attrs.map,
      site: post.content.site,
      side: post.content.side,
      agent: attrs.agent,
      ability: attrs.ability,
      hook: attrs.hook,
      opening: attrs.opening,
      length: attrs.length,
      cta: attrs.cta,
      bgm: attrs.bgm,
    },
    current: {
      views: snapshot?.views ?? null,
      averagePercentageViewed: snapshot?.averagePercentageViewed ?? snapshot?.completionRate ?? null,
      appCtr: appCtr(snapshot),
    },
    cohort: {
      label: cohort.label,
      count: cohort.count,
      views: cohort.views,
      averagePercentageViewed: cohort.averagePercentageViewed,
      appCtr: cohort.appCtr,
    },
    referencedPosts: cohort.count + 1,
    referencedExperiments: post.experimentId ? 1 : 0,
  };
};

export const buildHypothesisContext = (bundle: AnalyticsBundle, post: AnalyticsPost) => {
  const summary = buildSummaryContext(bundle, post);
  const experiment = post.experimentId
    ? bundle.experiments.find((item) => item.id === post.experimentId)
    : undefined;
  if (!experiment) return { ...summary, experiment: null };
  const control = armAverage(bundle, experiment, 'control');
  const variant = armAverage(bundle, experiment, 'variant');
  return {
    ...summary,
    referencedExperiments: 1,
    experiment: {
      name: experiment.name,
      hypothesis: experiment.hypothesis,
      primaryVariable: experiment.primaryVariable,
      primaryMetric: experiment.primaryMetric,
      controlLabel: experiment.controlLabel,
      variantLabel: experiment.variantLabels[0] ?? '',
      control,
      variant,
      plannedCountPerArm: experiment.plannedCountPerArm,
      smallSample: control.count < 3 || variant.count < 3,
    },
  };
};

export const buildNoticesContext = (
  bundle: AnalyticsBundle,
  post: AnalyticsPost,
  draft?: ReviewDraft,
) => ({
  ...buildSummaryContext(bundle, post),
  draft: {
    hypothesis: draft?.hypothesis ? HYPOTHESIS_LABELS[draft.hypothesis] : '',
    notices: (draft?.notices ?? []).map((item) => NOTICE_LABELS[item]),
    memo: draft?.memo ?? '',
  },
});

export const buildNextActionContext = (
  bundle: AnalyticsBundle,
  post: AnalyticsPost,
  draft?: ReviewDraft,
) => ({
  ...buildNoticesContext(bundle, post, draft),
  currentAction: draft?.action ? ACTION_LABELS[draft.action] : '',
});

export type AiContext =
  | ReturnType<typeof buildCaptionContext>
  | ReturnType<typeof buildPublishingContext>
  | ReturnType<typeof buildSummaryContext>
  | ReturnType<typeof buildHypothesisContext>
  | ReturnType<typeof buildNoticesContext>
  | ReturnType<typeof buildNextActionContext>;

const SHAPE: Record<AiKind, string> = {
  captions:
    '{"candidates":[{"hook":{"ja":"","en":""},"stand":{"ja":"","en":""},"aim":{"ja":"","en":""},"demo":{"ja":"","en":""},"rationale":""}]}',
  publishing:
    '{"candidates":[{"title":{"ja":"","en":"","ko":""},"description":{"ja":"","en":"","ko":""},"hashtags":{"ja":"","en":"","ko":""},"rationale":""}]}',
  summary: '{"good":["",""],"concerns":["",""],"insufficient":false,"rationale":""}',
  hypothesis: '{"judgement":"support|undecided|reject","insufficient":false,"rationale":""}',
  notices: '{"items":[{"notice":"hook|length|demand|postTime|cta|unsure|other","text":""}]}',
  'next-action':
    '{"action":"adopt|continue|reject|new-variable|hold","continueCount":1,"insufficient":false,"rationale":""}',
};

export const buildPrompt = (kind: AiKind, context: unknown, instruction = ''): string => {
  const note = clipAiInstruction(instruction);
  return [
    'あなたは動画制作の補助です。方針は決めず、候補だけをJSONで返します。',
    '因果を断定しないでください。材料が足りなければ insufficient を true にし、rationale に「判断材料不足」と書いてください。',
    '動画・音声・ファイルパスには触れないでください。Markdownや説明は付けず、JSONオブジェクトだけを返してください。',
    '候補は最大3件です。',
    ...(kind === 'publishing'
      ? [
          'YouTubeのタイトルはフックを先頭にし、ハッシュタグを入れない。[ ] と {br} は使わない。',
          '説明文は概要の直後に ClutchVault の定点URLを置く。「保存できます」と断定せず、定点をチェックできることを書く。続けてツール説明、クローズドβテスター募集、事前登録URL https://t.co/fvdgfFPSXb、開発者表記を置く。',
        ]
      : []),
    ...(note
      ? ['追加の指示: ' + note, '追加の指示があっても、返す形と件数は守ってください。']
      : []),
    `種類: ${kind}`,
    `返す形: ${SHAPE[kind]}`,
    `材料: ${JSON.stringify(context)}`,
  ].join('\n');
};

export const classifyClaudeText = (text: string): AiErrorCode | null => {
  const lower = text.toLowerCase();
  if (
    /rate limit|usage limit|too many requests|\b429\b|hit your limit|hit your usage|you've hit|quota exceeded/.test(
      lower,
    )
  ) {
    return 'rate_limited';
  }
  if (
    /not logged in|please run \/login|authentication_failed|please login|unauthorized|claude auth login/.test(
      lower,
    )
  ) {
    return 'unauthenticated';
  }
  return null;
};

export const unwrapModelText = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.result === 'string') return parsed.result;
  } catch {
    return trimmed;
  }
  return trimmed;
};

const parseJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('json');
  }
};

const hasText = (value: { ja: string; en: string }): boolean =>
  Boolean(value.ja.trim() || value.en.trim());

const clipLocalized = (value: unknown, max: number): unknown => {
  const row = asRecord(value);
  if (!row) return value;
  return {
    ja: typeof row.ja === 'string' ? row.ja.slice(0, max) : '',
    en: typeof row.en === 'string' ? row.en.slice(0, max) : '',
    ...(typeof row.ko === 'string' ? { ko: row.ko.slice(0, max) } : {}),
  };
};

const judgementSchema = z
  .string()
  .transform((value) => {
    const key = value.trim();
    const mapped: Record<string, 'support' | 'undecided' | 'reject'> = {
      support: 'support',
      支持: 'support',
      仮説を支持: 'support',
      undecided: 'undecided',
      判断不能: 'undecided',
      まだ判断しない: 'undecided',
      reject: 'reject',
      仮説を支持しない: 'reject',
      非支持: 'reject',
    };
    return mapped[key] ?? mapped[key.toLowerCase()];
  })
  .pipe(z.enum(['support', 'undecided', 'reject']));

const actionSchema = z
  .string()
  .transform((value) => {
    const key = value.trim();
    const table: Record<string, 'adopt' | 'continue' | 'reject' | 'new-variable' | 'hold'> = {
      adopt: 'adopt',
      次の動画でも採用: 'adopt',
      continue: 'continue',
      継続: 'continue',
      reject: 'reject',
      このパターンは使わない: 'reject',
      'new-variable': 'new-variable',
      別の変数を検証: 'new-variable',
      hold: 'hold',
      判断保留: 'hold',
    };
    return table[key] ?? table[key.toLowerCase()];
  })
  .pipe(z.enum(['adopt', 'continue', 'reject', 'new-variable', 'hold']));

const noticeValueSchema = z
  .string()
  .transform((value) => {
    const key = value.trim();
    const table: Record<string, Notice> = {
      hook: 'hook',
      length: 'length',
      demand: 'demand',
      postTime: 'postTime',
      cta: 'cta',
      unsure: 'unsure',
      other: 'other',
      フックが良かった: 'hook',
      動画の尺が良かった: 'length',
      定点そのものの需要が高かった: 'demand',
      投稿時刻が影響したかも: 'postTime',
      'CTA・ClutchVaultへの導線に課題': 'cta',
      判断できない: 'unsure',
      その他: 'other',
    };
    return table[key] ?? table[key.toLowerCase()];
  })
  .pipe(z.enum(['hook', 'length', 'demand', 'postTime', 'cta', 'unsure', 'other']));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const listFrom = (value: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [value];
};

const clip = (values: unknown, limit: number): string[] =>
  (Array.isArray(values) ? values : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => item.slice(0, 200));

export type Interpreted =
  | { ok: true; payload: AiPayload; rationale?: string }
  | { ok: false; code: AiErrorCode };

export const interpretModelOutput = (kind: AiKind, raw: string): Interpreted => {
  const text = unwrapModelText(raw);
  if (!text.trim()) return { ok: false, code: 'invalid_output' };
  let parsed: unknown;
  try {
    parsed = parseJsonObject(text);
  } catch {
    const classified = classifyClaudeText(text);
    return { ok: false, code: classified ?? 'invalid_output' };
  }
  const record = asRecord(parsed) ?? {};
  if (kind === 'captions') {
    const candidates = listFrom(parsed, ['candidates'])
      .map((item) => {
        const row = asRecord(item);
        if (!row) return null;
        const hook = localizedSchema.safeParse(row.hook);
        const stand = localizedSchema.safeParse(row.stand);
        const aim = localizedSchema.safeParse(row.aim);
        const demo = localizedSchema.safeParse(row.demo);
        if (!hook.success || !stand.success || !aim.success) return null;
        if (!hasText(hook.data) && !hasText(stand.data) && !hasText(aim.data)) return null;
        const candidate: CaptionCandidate = {
          hook: hook.data,
          stand: stand.data,
          aim: aim.data,
          ...(demo.success && hasText(demo.data) ? { demo: demo.data } : {}),
          ...(typeof row.rationale === 'string' ? { rationale: row.rationale.slice(0, 400) } : {}),
        };
        return candidate;
      })
      .filter((item): item is CaptionCandidate => item !== null)
      .slice(0, 3);
    if (candidates.length === 0) return { ok: false, code: 'invalid_output' };
    return { ok: true, payload: { type: 'captions', candidates } };
  }
  if (kind === 'publishing') {
    const candidates = listFrom(parsed, ['candidates'])
      .map((item) => {
        const row = asRecord(item);
        if (!row) return null;
        const title = publishingTextSchema.safeParse(clipLocalized(row.title, 400));
        const description = longPublishingTextSchema.safeParse(clipLocalized(row.description, 2000));
        const hashtags = publishingTextSchema.safeParse(clipLocalized(row.hashtags, 400));
        if (!title.success || !description.success || !hashtags.success) return null;
        if (!hasText(title.data) && !hasText(description.data)) return null;
        const candidate: PublishingCandidate = {
          title: title.data,
          description: description.data,
          hashtags: hashtags.data,
          ...(typeof row.rationale === 'string' ? { rationale: row.rationale.slice(0, 400) } : {}),
        };
        return candidate;
      })
      .filter((item): item is PublishingCandidate => item !== null)
      .slice(0, 3);
    if (candidates.length === 0) return { ok: false, code: 'invalid_output' };
    return { ok: true, payload: { type: 'publishing', candidates } };
  }
  if (kind === 'summary') {
    const good = clip(record.good, 2);
    const concerns = clip(record.concerns, 2);
    if (good.length === 0 && concerns.length === 0 && record.insufficient !== true) {
      return { ok: false, code: 'invalid_output' };
    }
    return {
      ok: true,
      payload: { type: 'summary', good, concerns, insufficient: record.insufficient === true },
      rationale: typeof record.rationale === 'string' ? record.rationale.slice(0, 400) : undefined,
    };
  }
  if (kind === 'hypothesis') {
    const judgement = judgementSchema.safeParse(record.judgement);
    if (!judgement.success) return { ok: false, code: 'invalid_output' };
    return {
      ok: true,
      payload: {
        type: 'hypothesis',
        judgement: judgement.data,
        insufficient: record.insufficient === true,
      },
      rationale: typeof record.rationale === 'string' ? record.rationale.slice(0, 400) : undefined,
    };
  }
  if (kind === 'notices') {
    const items = listFrom(parsed, ['items', 'candidates'])
      .map((item) => {
        const row = asRecord(item);
        if (!row || typeof row.text !== 'string') return null;
        const notice = noticeValueSchema.safeParse(row.notice);
        if (!notice.success || !row.text.trim()) return null;
        return { notice: notice.data, text: row.text.trim().slice(0, 200) };
      })
      .filter((item): item is { notice: Notice; text: string } => item !== null)
      .slice(0, 3);
    if (items.length === 0) return { ok: false, code: 'invalid_output' };
    return { ok: true, payload: { type: 'notices', items } };
  }
  const action = actionSchema.safeParse(record.action);
  if (!action.success) return { ok: false, code: 'invalid_output' };
  const count = record.continueCount;
  const continueCount = count === 1 || count === 2 || count === 3 ? count : undefined;
  return {
    ok: true,
    payload: {
      type: 'next-action',
      action: action.data,
      ...(action.data === 'continue' ? { continueCount: continueCount ?? 1 } : {}),
      insufficient: record.insufficient === true,
    },
    rationale: typeof record.rationale === 'string' ? record.rationale.slice(0, 400) : undefined,
  };
};

export const captionOverflowNotes = (project: Project, candidate: CaptionCandidate): string[] => {
  const rows = [
    ['hook', 'HOOK', candidate.hook],
    ['stand', 'STAND', candidate.stand],
    ['throw', 'AIM', candidate.aim],
    ['demo', '実戦', candidate.demo],
  ] as const;
  const notes: string[] = [];
  for (const [id, label, text] of rows) {
    if (!text) continue;
    for (const language of ['ja', 'en'] as const) {
      if (captionMetrics(text[language], project, language, id).overflow) {
        notes.push(`${label}（${language === 'ja' ? '日本語' : '英語'}）が文字数か行数を超えています`);
      }
    }
  }
  return notes;
};

export const analysisDisclaimer = (kind: AiKind): string | undefined =>
  kind === 'captions' || kind === 'publishing' ? undefined : AI_DISCLAIMER;
