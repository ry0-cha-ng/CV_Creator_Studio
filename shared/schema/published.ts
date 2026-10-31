import { z } from 'zod';

export const sceneMeaningSchema = z.enum([
  'hook',
  'success',
  'stand',
  'aim',
  'throw',
  'card',
  'cta',
  'loop',
  'other',
]);
export type SceneMeaning = z.infer<typeof sceneMeaningSchema>;

export const publishedSceneSourceSchema = z.enum(['export', 'estimate', 'manual']);

export const publishedSceneSchema = z.object({
  id: z.string(),
  meaning: sceneMeaningSchema,
  label: z.string(),
  order: z.number().int(),
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  source: publishedSceneSourceSchema,
});
export type PublishedScene = z.infer<typeof publishedSceneSchema>;

export const publishedSnapshotSchema = z.object({
  exportId: z.string(),
  postId: z.string().optional(),
  projectId: z.string().optional(),
  basename: z.string().optional(),
  lang: z.enum(['ja', 'en']).optional(),
  source: z.enum(['export', 'estimate']),
  /** 推定は画面で「推定・要確認」。書き出し時の固定と混ぜない。 */
  needsReview: z.boolean().default(false),
  frozenAt: z.string(),
  /** シーン時刻の基準にした構成の尺。 */
  durationSec: z.number().nonnegative(),
  renderedDurationSec: z.number().nonnegative().optional(),
  templateId: z.string().default(''),
  templateVersion: z.string().default(''),
  hookPattern: z.string().default(''),
  hookText: z.string().optional(),
  openingType: z.string().optional(),
  ctaMode: z.string().optional(),
  ctaText: z.string().optional(),
  ctaMotion: z.boolean().optional(),
  map: z.string().optional(),
  agent: z.string().optional(),
  note: z.string().optional(),
  scenes: z.array(publishedSceneSchema).default([]),
});
export type PublishedSnapshot = z.infer<typeof publishedSnapshotSchema>;

export const snapshotSourceLabel = (source: PublishedSnapshot['source']): string =>
  source === 'export' ? '書き出し時に固定' : '推定・要確認';
