import { z } from 'zod';
import { ctaDesignSchema, type CtaDesign } from './cta-design';
import { sceneKeySchema, type SceneKey } from './schema/project-keys';
import type { Project } from './schema/project';

export const DEFAULT_SCENE_ORDER: SceneKey[] = [
  'hook',
  'stand',
  'aim',
  'throw',
  'card',
  'demo',
  'loop',
];

export const sceneOrderSchema = z
  .array(sceneKeySchema)
  .min(1)
  .max(DEFAULT_SCENE_ORDER.length)
  .superRefine((sceneOrder, context) => {
    const seen = new Set<SceneKey>();
    sceneOrder.forEach((sceneKey, index) => {
      if (seen.has(sceneKey)) {
        context.addIssue({
          code: 'custom',
          message: '同じシーンは構成内に1回だけ指定できます',
          path: [index],
        });
      }
      seen.add(sceneKey);
    });
  });

export const videoStructureTemplateSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(60),
  sceneOrder: sceneOrderSchema,
  ctaDesign: ctaDesignSchema.default('s7-band'),
  builtIn: z.boolean().default(false),
});

export type VideoStructureTemplate = z.infer<typeof videoStructureTemplateSchema>;

export const BUILTIN_VIDEO_STRUCTURE_TEMPLATES: VideoStructureTemplate[] = [
  {
    id: 'structure-standard',
    name: '標準（S1→S2→S3→S4→S5→S6→S7）',
    sceneOrder: [...DEFAULT_SCENE_ORDER],
    ctaDesign: 's7-band',
    builtIn: true,
  },
  {
    id: 'structure-card-early',
    name: '分析テスト（S1→S5→S2→S3→S4+CTA）',
    sceneOrder: ['hook', 'card', 'stand', 'aim', 'throw'],
    ctaDesign: 's4-block',
    builtIn: true,
  },
];

export const normalizeVideoStructureTemplates = (value: unknown): VideoStructureTemplate[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const parsed = videoStructureTemplateSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.builtIn) return [];
    return [{ ...parsed.data, builtIn: false }];
  });
};

export const sceneOrderLabel = (sceneOrder: SceneKey[]): string =>
  sceneOrder
    .map((sceneKey) => {
      const index = DEFAULT_SCENE_ORDER.indexOf(sceneKey);
      return index >= 0 ? `S${index + 1}` : sceneKey;
    })
    .join('→');

/** 新しいCTAはシーンではなくS4の末尾に付くので、ラベルだけ +CTA を足す。 */
export const structureLabel = (sceneOrder: SceneKey[], ctaDesign?: CtaDesign): string => {
  const order = sceneOrderLabel(sceneOrder);
  return ctaDesign === 's4-block' ? `${order}+CTA` : order;
};

export const configuredSceneOrder = (project: Project): SceneKey[] => {
  if (project.templateId === 't-guide') return ['hook', 'stand', 'card', 'demo'];
  const source = project.templateParams.sceneOrder?.length
    ? project.templateParams.sceneOrder
    : DEFAULT_SCENE_ORDER;
  return source.filter((sceneKey, index) => source.indexOf(sceneKey) === index);
};
