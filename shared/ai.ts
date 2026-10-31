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
import {
  CAPTION_EN_MAX_WORDS,
  CAPTION_JA_MAX_CHARS,
  HOOK_CAPTION_MAX_LINES,
  HOOK_JA_MAX_CHARS,
  HOOK_PATTERN_LABELS,
  captionMetrics,
} from './guide';
import { publishingGlossary, publishingTranslationLanguages } from './production';
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
  'publish-translate',
  'wording',
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
  wording: {
    title: 'フック・タイトル・固定コメントの使い方',
    summary: '使うと何が判断でき、何が便利かを、フック・英語タイトルの前半・英語の固定コメントで5件ずつ出します。',
    steps: [
      '使う場面、相手の行動、スキルの効果、そのあと何がしやすくなるかを書きます。投げ方が空でも、特徴が十分なら案を出します。',
      '「案を出す」を押します。気に入らなければ「もう一度提案する」で入れ替えます。採用済みの文は残ります。',
      'フックを選ぶとテロップのフックへ、タイトルを選ぶと英語タイトルへ、固定コメントを選ぶとその欄へ入ります。',
      'タイトルの｜より後ろは、マップ・サイト・エージェント・Lineup #valorant のままです。',
    ],
    note: '動画ファイルは送りません。英語タイトルと固定コメントの下の日本語は意味の確認用で、選んでも投稿には入りません。フックは画面の文字数上限に収まる長さで、上限まで埋めなくてよいです。',
  },
  publishing: {
    title: '英語原稿の使い方',
    summary: '定点・テロップ・今の英語投稿文だけを送り、英語のタイトル・説明・タグの案を最大3つ出します。',
    steps: [
      '指示欄に希望を書くと、その内容で案を出します。空なら今までどおりです。',
      '「AIで案を作る」を押します。',
      '採用すると英語の欄だけが置き換わり、手修正扱いになります。',
      '日本語と韓国語は、下の翻訳ボタンで入れます。',
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
  publishing: '定点・テロップ・今の英語投稿文を送ります（動画は送りません）',
  'publish-translate': '英語のタイトルと説明文を送ります（動画は送りません）',
  wording: '定点の内容と、入力した特徴・雰囲気を送ります（動画は送りません）',
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

export type PublishingTranslation = {
  title?: { ja: string; ko?: string };
  description?: { ja: string; ko?: string };
};

export type WordingLine = {
  en: string;
  /** 製作者が意味を見るための訳。投稿文には使わない。 */
  ja: string;
};

export type WordingIdeas = {
  hooks: Array<{ ja: string; en: string }>;
  titles: WordingLine[];
  pinnedComments: WordingLine[];
};

export type AiPayload =
  | { type: 'captions'; candidates: CaptionCandidate[] }
  | { type: 'publishing'; candidates: PublishingCandidate[] }
  | ({ type: 'publish-translate' } & PublishingTranslation)
  | ({ type: 'wording' } & WordingIdeas)
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
  | { kind: 'publish-translate'; project: Project; fields: Array<'title' | 'description'> }
  | { kind: 'wording'; project: Project; brief?: string; tone?: string }
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
    hookMaxLines: HOOK_CAPTION_MAX_LINES,
    otherMaxLines: 2,
    jaMaxChars: CAPTION_JA_MAX_CHARS,
    hookJaMaxChars: HOOK_JA_MAX_CHARS,
    enMaxWords: CAPTION_EN_MAX_WORDS,
  },
  captions: {
    hook: textOf(project, 'hook'),
    stand: textOf(project, 'stand'),
    aim: textOf(project, 'throw'),
  },
  referencedPosts: 0,
  referencedExperiments: 0,
});

export const buildPublishTranslateContext = (
  project: Project,
  fields: Array<'title' | 'description'>,
) => {
  const glossary = publishingGlossary(project);
  const selected = fields.filter((field) => (project.publishing[field].en ?? '').trim());
  return {
    languages: publishingTranslationLanguages(project),
    map: glossary.map,
    agent: glossary.agent,
    site: glossary.site,
    credits: glossary.credits,
    fields: Object.fromEntries(selected.map((field) => [field, project.publishing[field].en ?? ''])),
    referencedPosts: 0,
    referencedExperiments: 0,
  };
};

export const buildWordingContext = (project: Project, brief = '', tone = '') => ({
  map: project.lineup.map,
  site: project.lineup.site,
  side: project.lineup.side,
  agent: project.lineup.agent,
  ability: project.lineup.ability,
  throwType: project.lineup.throwType,
  stand: project.lineup.standDescription,
  aim: project.lineup.aimDescription,
  brief: brief.trim().slice(0, 500),
  tone: tone.trim().slice(0, 200),
  hookJaMaxChars: HOOK_JA_MAX_CHARS,
  hookEnMaxWords: CAPTION_EN_MAX_WORDS,
  hookMaxLines: HOOK_CAPTION_MAX_LINES,
  englishCaptionPreset: project.englishCaptionPreset,
  titleSuffix: `${project.lineup.map} ${project.lineup.site} ${project.lineup.agent} Lineup #valorant`,
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
  | ReturnType<typeof buildPublishTranslateContext>
  | ReturnType<typeof buildWordingContext>
  | ReturnType<typeof buildSummaryContext>
  | ReturnType<typeof buildHypothesisContext>
  | ReturnType<typeof buildNoticesContext>
  | ReturnType<typeof buildNextActionContext>;

const SHAPE: Record<AiKind, string> = {
  captions:
    '{"candidates":[{"hook":{"ja":"","en":""},"stand":{"ja":"","en":""},"aim":{"ja":"","en":""},"rationale":""}]}',
  publishing:
    '{"candidates":[{"title":{"ja":"","en":"","ko":""},"description":{"ja":"","en":"","ko":""},"hashtags":{"ja":"","en":"","ko":""},"rationale":""}]}',
  'publish-translate': '{"title":{"ja":"","ko":""},"description":{"ja":"","ko":""}}',
  wording: '{"hooks":[{"ja":"","en":""}],"titles":[{"en":"","ja":""}],"pinnedComments":[{"en":"","ja":""}]}',
  summary: '{"good":["",""],"concerns":["",""],"insufficient":false,"rationale":""}',
  hypothesis: '{"judgement":"support|undecided|reject","insufficient":false,"rationale":""}',
  notices: '{"items":[{"notice":"hook|length|demand|postTime|cta|unsure|other","text":""}]}',
  'next-action':
    '{"action":"adopt|continue|reject|new-variable|hold","continueCount":1,"insufficient":false,"rationale":""}',
};

const buildWordingPrompt = (context: unknown, note: string): string =>
  [
    'あなたはVALORANTプレイヤー向けショート動画のコピーを作る編集者です。',
    '攻略記事や製品紹介ではなく、プレイヤーが仲間に「これ、次の試合でやってみよう」と共有するような、短く、自信があり、自然な口調で書いてください。',
    '定点やスキルの説明ではなく、それによって得られる情報・選択肢・有利な状況を主役にしてください。',
    '候補だけをJSONで返します。検討過程、注意書き、Markdownは出さないでください。',
    '優先順位は、1. 素材との整合、2. 視聴者のベネフィットと使いたくなる魅力、3. 自然な英語・日本語、4. 短さと読みやすさ、5. 候補ごとの発想の幅、です。',
    'briefを最優先に読んでください。いつどこで誰のために使うか、相手の何に対して使うか、直接の効果、そのあと何を判断・実行しやすくなるか、感情的な魅力を内部で整理します。足りない項目は推測で埋めず、整理内容は出力しません。',
    'map、site、side、agent、ability、throwType、stand、aimは正確さのための材料です。立ち位置や狙い方を、そのままコピーにしないでください。',
    'キャラ名やロールだけで用途を決めず、材料にある効果と使用条件から判断してください。索敵、罠、妨害、味方支援、設置や解除の阻止も、材料にあればその魅力で書いてください。',
    '動画を送っていないこと、throwType・stand・aimが空であることは、情報不足の理由にしません。briefが十分なら生成してください。',
    'standとaimが「ここに立つ」「STAND HERE」「印に合わせる」「AIM AT THE MARK」だけのとき、throwTypeが「通常投げ」「NORMAL THROW」だけのときは、未入力と同じです。それだけでは投擲スキルだと決めないでください。',
    'referencedPostsとreferencedExperimentsが0でも、生成を止めないでください。',
    '成立するコピーを作れないときだけ、hooks・titles・pinnedCommentsを空配列にしてください。説明文は返さないでください。',
    'ベネフィットは素材に合うものだけを使います。全動画に全分類を当てはめないでください。例は、情報獲得、確認負担の軽減、奇襲や意表、進路や空間の制御、有利な勝負の準備、設置・解除への干渉、味方支援、入力に根拠があるときの再現性です。',
    '「便利な索敵」「強い罠」と説明するだけでなく、使ったあとプレイヤーの判断や行動がどう変わるかを書いてください。キルに直結しない情報・支援・時間稼ぎにも価値があります。',
    '確定キル、確実な勝利、完全な安全は書かないでください。実際にないキル実績や投稿者の使用体験を作らないでください。入力にない用途・効果・射程・タイミングを足さないでください。',
    '使い方の提案、自分から仕掛ける呼びかけ、主導権を握る宣言、軽い挑発・皮肉・比喩的な決め台詞は、素材と一致するなら書いてください。「必ず3キル取れる」は不可です。「その逃げ場、燃やしておこう」は素材が炎や範囲妨害なら可です。',
    '検知、可視化、追跡、ダメージ、拘束、視界妨害を混同しないでください。索敵の無反応を敵がいない証明にしないでください。罠の条件や範囲を超えて断言しないでください。「見えにくい」を「絶対に見つからない」に、「察知できる」を「常に監視できる」に変えないでください。情報や妨害を確定キルや安全の保証に飛躍させないでください。入力にない性能を知識で補って断定しないでください。実戦キルの情報がない動画を、成功実績の映像として書かないでください。',
    'これらはコピー内の注意書きにしないでください。',
    '動作は素材に合わせて、使う、設置する、発動させる、察知する、投げる、から選んでください。「投げる」「燃やす」「モロトフ」に固定しないでください。',
    '軽い挑発、皮肉、意外性、問いかけ、遊び心は歓迎します。無理なスラング、難解な比喩、意味の薄い煽りは避けてください。すべての案をジョークにしなくてよいです。',
    '「便利な定点を紹介」「おすすめのセットアップ」より、使う場面や気持ちが想像できる表現を優先してください。',
    '材料のtoneは口調の指定です。briefと衝突しない範囲で守ってください。空なら、短く自信のある口調にしてください。',
    'フック、タイトル前半、固定コメントをそれぞれ5件返してください。',
    'フックは、タイトルを読んでいなくても映像と一緒に短時間で分かる言葉にしてください。',
    '切り口の目安は、困りごと、場所や使い方の意外性、スキルで主導権を握る宣言、相手への軽い挑発、増える手札です。主導権には、先に気づく、相手の行動を捉える、進路を制限する、味方の行動を助けることも含みます。',
    '素材に合わない切り口は別の案に置き換えてください。同じ意味の言い換えだけで5件を埋めないでください。索敵・罠・支援を、無理にキルの訴求に変えないでください。',
    '日本語フックは材料のhookJaMaxChars文字以内、英語フックはhookEnMaxWords語以内です。これはテロップ画面の上限で、目安まで埋めなくてよいです。自然ならより短くてよいです。上限を超える文は書かないでください。改行は2つまでです。',
    '日本語フックは英語の直訳にせず、同じ魅力とテンションの自然な日本語にしてください。',
    'タイトル前半は、フックと同じ文言にしなくてよいです。どんなプレイができるか、なぜ見たいかを補い、タイトルだけでも内容と魅力が伝わるようにしてください。実用性、意外性、挑発、ユーモアに幅を持たせてください。検索語を不自然に並べないでください。',
    'titleSuffix、URL、ハッシュタグ、{br}は書かないでください。| より前だけを書いてください。マップ名・サイト・エージェント名・Lineupは書かないでください。',
    'フックとタイトルは同じ魅力を別の角度から伝え、それぞれ単独でも成立させてください。',
    'タイトルのjaは、|より前の英語の意味を確認するための自然な日本語訳です。訳で新しい用途や効果を足さないでください。投稿文には使いません。',
    '固定コメントは英語の1〜2文で、問いは1つです。動画を試していない視聴者でも答えられる、その動画の場面・判断・感情に結びついた問いを優先してください。',
    '切り口は、プレイスタイルが分かれる二択、失敗やあるある、対処法や得意技、相手側の立場、動画の軽い挑発を会話につなぐ質問、です。用途に合う判断を選んでください。索敵なら情報を得てすぐ進むか味方を待つか、罠なら反応したら戻るか情報だけ使うか、妨害なら効果が切れるまで待つか別ルートか、支援なら自分で使うか味方に合わせるか、のような分かれです。成立しない選択肢は作らないでください。合わない切り口は別案に置き換えてください。',
    '投稿者の架空の体験や実績、初心者という設定は作らないでください。',
    'Would you use this?、Did you know this?、Let me know in the comments.、Which lineup should we cover next? のような汎用文で埋めないでください。',
    '固定コメントにURLは入れないでください。',
    '固定コメントのjaは英語全文の意味確認用の訳です。訳で用途や効果を足さないでください。投稿文には使いません。',
    '参考例です。文言を流用せず、発想と語り口だけを見てください。実在スキルの性能を定義する例ではありません。',
    '索敵。身体を出さず、サイト内の特定の死角にいる敵を確認する。フック: WHO\'S HIDING BACK THERE? タイトル: Check This Corner Before You Commit。魅力は、進入を決める前に判断材料を得ること。',
    '罠。敵が裏取りすると反応する、見落とされやすい位置の罠。反応してもキルは確定しない。フック: NICE FLANK. WRONG ROUTE. タイトル: A Little Surprise for Their Flanker。魅力は、裏取りを先回りして捉えること。',
    '支援。味方の進入に合わせて敵の視界を妨害し、勝負を仕掛けるきっかけをつくる。フック: GIVE YOUR DUO THE OPENING. タイトル: Set Your Duo Up for the First Fight。魅力は、味方が仕掛けやすい状況をつくること。',
    '攻撃的なセットアップ。守りで開幕プッシュし、先制キルを狙う。フック: DEFENSE? I\'M PUSHING. タイトル: Who Said Defenders Have to Wait? 魅力は、待つ守りから自分で仕掛ける守りへ変えること。',
    '目標への干渉。意外な場所から設置・解除を妨害する。フック: YES, EVEN FROM HERE. タイトル: They Think You Can\'t Stop Them From Here。魅力は、関与できないと思っていた位置からも手を出せること。',
    '固定コメントの参考: Lurkers: are you waiting out the molly or finding another route? 動画固有の状況に、答えやすい選択肢を出している点が参考です。mollyを他のスキルの単語として使わないでください。',
    '返す前に、視聴者のメリットが主役か、素材にない成果・用途・性能を足していないか、短時間で理解できるか、5案の発想に幅があるか、固定コメントがその動画の問いか、別のエージェントでも魅力が材料に沿うか、を確認してください。',
    ...(note ? ['追加の指示: ' + note, '追加の指示があっても、返す形と件数と文字数の上限は守ってください。'] : []),
    '種類: wording',
    `返す形: ${SHAPE.wording}`,
    `材料: ${JSON.stringify(context)}`,
  ].join('\n');

export const buildPrompt = (kind: AiKind, context: unknown, instruction = ''): string => {
  const note = clipAiInstruction(instruction);
  if (kind === 'wording') return buildWordingPrompt(context, note);
  return [
    'あなたは動画制作の補助です。方針は決めず、候補だけをJSONで返します。',
    '因果を断定しないでください。材料が足りなければ insufficient を true にし、rationale に「判断材料不足」と書いてください。',
    '動画・音声・ファイルパスには触れないでください。Markdownや説明は付けず、JSONオブジェクトだけを返してください。',
    ...(kind === 'publish-translate'
      ? [
          '英語の原稿を、材料の languages へ訳した1件だけを返してください。',
          '材料の fields にある項目だけを訳し、無い項目は空文字にしてください。',
          'URL、UTM、#で始まるハッシュタグは一文字も変えないでください。',
          '英語の開発者表記が材料の credits.en と一致するときは、その文を credits の訳文へ置き換えてください。',
          'マップ名とエージェント名は、材料の map と agent にある訳があればそれを使い、無ければ英語のままにしてください。サイト名はそのままにしてください。',
          'タイトルに | が含まれるときは、その前だけを訳してください。後ろはアプリが言語ごとの末尾に付け直します。',
        ]
      : ['候補は最大3件です。']),
    ...(kind === 'captions'
      ? ['フックの日本語は材料の hookJaMaxChars 文字以内、それ以外の日本語は jaMaxChars 文字以内、英語は enMaxWords 語以内です。']
      : []),
    ...(kind === 'publishing'
      ? [
          '英語のタイトル・説明文・ハッシュタグだけを書く。ja と ko は空文字にする。',
          'YouTubeのタイトルはフックを先頭にし、[ ] と {br} は使わない。',
          '説明文は概要の直後に ClutchVault の定点URLを置く。「保存できます」と断定せず、定点をチェックできることを書く。続けてツール説明、クローズドβテスター募集、事前登録URL https://t.co/fvdgfFPSXb、開発者表記を置く。開発者表記の次は空行にして #valorantshorts を置く。',
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

const clipTranslation = (value: unknown, max: number): { ja: string; ko?: string } | null => {
  const row = asRecord(value);
  if (!row) return null;
  const ja = typeof row.ja === 'string' ? row.ja.slice(0, max).trim() : '';
  const ko = typeof row.ko === 'string' ? row.ko.slice(0, max).trim() : '';
  if (!ja && !ko) return null;
  return { ja, ...(ko ? { ko } : {}) };
};

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
  if (kind === 'publish-translate') {
    const title = clipTranslation(record.title, 500);
    const description = clipTranslation(record.description, 4000);
    if (!title && !description) return { ok: false, code: 'invalid_output' };
    return {
      ok: true,
      payload: {
        type: 'publish-translate',
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      },
    };
  }
  if (kind === 'wording') {
    const clipLead = (value: unknown, max: number): string =>
      (typeof value === 'string' ? value : '')
        .split(/\s*[|｜]\s*/)[0]
        ?.replace(/#[^\s#]+/g, ' ')
        .replace(/\{br\}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max) ?? '';
    const hooks = listFrom(parsed, ['hooks'])
      .map((item) => {
        const row = asRecord(item);
        if (!row) return null;
        const ja = clipLead(row.ja, 80);
        const en = clipLead(row.en, 80);
        if (!ja && !en) return null;
        return { ja, en };
      })
      .filter((item): item is { ja: string; en: string } => item !== null)
      .slice(0, 5);
    const gloss = (value: unknown, max: number, lead: boolean): string => {
      const text = typeof value === 'string' ? value : '';
      if (!lead) return text.replace(/\s+/g, ' ').trim().slice(0, max);
      return clipLead(text, max);
    };
    const readLine = (item: unknown, max: number, lead: boolean): WordingLine | null => {
      if (typeof item === 'string') {
        const en = lead ? clipLead(item, max) : item.trim().slice(0, max);
        return en ? { en, ja: '' } : null;
      }
      const row = asRecord(item);
      if (!row) return null;
      const source = row.en ?? row.text ?? row.title ?? row.comment;
      const en = lead ? clipLead(source, max) : typeof source === 'string' ? source.trim().slice(0, max) : '';
      if (!en) return null;
      return { en, ja: gloss(row.ja, lead ? 160 : 400, lead) };
    };
    const titles = listFrom(parsed, ['titles'])
      .map((item) => readLine(item, 80, true))
      .filter((item): item is WordingLine => item !== null)
      .slice(0, 5);
    const pinnedComments = listFrom(parsed, ['pinnedComments', 'comments'])
      .map((item) => readLine(item, 280, false))
      .filter((item): item is WordingLine => item !== null)
      .slice(0, 5);
    if (hooks.length === 0 && titles.length === 0 && pinnedComments.length === 0) {
      return { ok: false, code: 'invalid_output' };
    }
    return { ok: true, payload: { type: 'wording', hooks, titles, pinnedComments } };
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
  kind === 'captions' || kind === 'publishing' || kind === 'publish-translate' || kind === 'wording'
    ? undefined
    : AI_DISCLAIMER;
