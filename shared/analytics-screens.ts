export type AnalyticsScreenId =
  | 'review-home'
  | 'step-1'
  | 'step-2'
  | 'step-3'
  | 'step-4'
  | 'step-5'
  | 'step-6'
  | 'weekly'
  | 'overview'
  | 'posts'
  | 'experiments'
  | 'experiment-new'
  | 'insights';

export type AnalyticsScreenCopy = {
  id: AnalyticsScreenId;
  name: string;
  stage: '振り返り' | '決定' | '実験' | 'Insight';
  role: string;
  purpose: string;
  does: string;
  doesNot: string;
};

export const ANALYTICS_SCREENS: Record<AnalyticsScreenId, AnalyticsScreenCopy> = {
  'review-home': {
    id: 'review-home',
    name: '振り返るホーム',
    stage: '振り返り',
    role: '次に振り返る1件を示す入口',
    purpose: '分析を溜めずに、1件ずつ終わらせる',
    does: '振り返りを始めるか、今日はここまでにするかを選ぶ',
    doesNot: '投稿の一覧や数字の比較（詳細分析で行う）',
  },
  'step-1': {
    id: 'step-1',
    name: '1 実績入力',
    stage: '振り返り',
    role: '投稿7日後の数字を記録する',
    purpose: '同じ時点の数字で、投稿どうしを比べられるようにする',
    does: '必須の2項目と ClutchVault の成果を写す',
    doesNot: '良かったか悪かったかの判断',
  },
  'step-2': {
    id: 'step-2',
    name: '2 結果確認',
    stage: '振り返り',
    role: '今回の結果をシリーズ平均と並べて見る',
    purpose: '良し悪しを、最小限の数字でつかむ',
    does: '平均との差を見る',
    doesNot: '仮説の判断や、原因を決めること',
  },
  'step-3': {
    id: 'step-3',
    name: '3 仮説評価',
    stage: '振り返り',
    role: '実験の仮説に今回の結果を当てる',
    purpose: '主KPIだけで判断し、ほかの数字に引っぱられないようにする',
    does: '支持する・まだ判断しない・支持しないから1つ選ぶ',
    doesNot: '本数が足りないうちに結論を出すこと',
  },
  'step-4': {
    id: 'step-4',
    name: '4 気づき',
    stage: '振り返り',
    role: '結果の理由として思い当たることを残す',
    purpose: '次に試すことの種を集める',
    does: '当てはまる気づきを選び、必要ならメモする',
    doesNot: '原因を1つに決めること',
  },
  'step-5': {
    id: 'step-5',
    name: '5 次アクション',
    stage: '決定',
    role: '次の制作で何をするかを1つ決める',
    purpose: '振り返りを必ず次の行動につなげる',
    does: '採用・継続検証・不採用・別の変数・保留から1つ選ぶ',
    doesNot: '複数の改善を同時に始めること',
  },
  'step-6': {
    id: 'step-6',
    name: '6 完了',
    stage: '決定',
    role: '今回の判断を「決定」として保存する',
    purpose: '決定を残し、次のプロジェクトへ引き継ぐ',
    does: '内容を確かめて保存し、次の1件へ進むか今日は終える',
    doesNot: 'Insights の更新（複数の結論を Insights でまとめる）',
  },
  weekly: {
    id: 'weekly',
    name: '週次レビュー',
    stage: '振り返り',
    role: '1週間分をまとめて見て、来週の実験を1つ決める',
    purpose: '1件ずつの振り返りでは見えない傾向を拾う',
    does: '今週の数字と学びの候補を見て、来週の1つを選ぶ',
    doesNot: '実験を2つ以上始めること',
  },
  overview: {
    id: 'overview',
    name: 'Overview',
    stage: '振り返り',
    role: '期間・媒体ごとの集計と、属性別の比較',
    purpose: '全体の傾向を確かめ、実験のテーマを探す',
    does: '絞り込みを変えて、マップ・フック・オープニングなどを比べる',
    doesNot: '少ない本数の差で結論を出すこと（n<3 は参考値）',
  },
  posts: {
    id: 'posts',
    name: 'Posts',
    stage: '振り返り',
    role: '投稿の一覧と、2〜4件の比較',
    purpose: '数字の未入力や振り返り漏れを見つけ、個別の差を確かめる',
    does: '絞り込み、チェックした投稿を並べて比べる',
    doesNot: '条件が2つ以上違う比較から原因を決めること',
  },
  experiments: {
    id: 'experiments',
    name: 'Experiments',
    stage: '実験',
    role: '実験の計画・進み具合・結論を管理する',
    purpose: '1つの変数の効果を、条件をそろえて確かめる',
    does: '進み具合を見て、本数がそろったら結論を記録する',
    doesNot: '実施中の実験を並行して増やすこと',
  },
  'experiment-new': {
    id: 'experiment-new',
    name: '新しい実験',
    stage: '実験',
    role: '新しい実験を作る',
    purpose: '動かす変数を1つに絞り、ほかの条件をそろえる',
    does: '変数・Control と Variant・主KPI・本数を決める',
    doesNot: '複数の変数を同時に動かすこと',
  },
  insights: {
    id: 'insights',
    name: 'Insights',
    stage: 'Insight',
    role: 'これまでの学びを「採用・検証中・非採用」に整理する知識ベース',
    purpose: 'いまの制作方針と次に試すことを確かめ、新しいプロジェクトの初期値に使う',
    does: '結論をまとめ、状態を見直し、制作への反映を決める',
    doesNot: '新しい集計や分析（Overview・Posts で行う）',
  },
};

export const screenForStep = (step: number): AnalyticsScreenId =>
  (`step-${step}` as AnalyticsScreenId);
