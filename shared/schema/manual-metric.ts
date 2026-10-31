import { z } from 'zod';

export const manualMetricKeySchema = z.enum([
  'views',
  'engagedViews',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'likes',
  'comments',
  'shares',
]);
export type ManualMetricKey = z.infer<typeof manualMetricKeySchema>;

export const MANUAL_METRIC_LABELS: Record<ManualMetricKey, string> = {
  views: '再生',
  engagedViews: 'エンゲージビュー',
  estimatedMinutesWatched: '総視聴時間（分）',
  averageViewDuration: '平均視聴時間（秒）',
  averageViewPercentage: '平均視聴率（%）',
  subscribersGained: '登録者獲得',
  likes: '高評価',
  comments: 'コメント',
  shares: '共有',
};

export const manualMetricSchema = z.object({
  id: z.string(),
  postId: z.string(),
  windowKind: z.enum(['publish-calendar-7d', 'publish-calendar-28d']),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  metric: manualMetricKeySchema,
  value: z.number().finite(),
  note: z.string().default(''),
  enteredAt: z.string(),
});
export type ManualMetric = z.infer<typeof manualMetricSchema>;
