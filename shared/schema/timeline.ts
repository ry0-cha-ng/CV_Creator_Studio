import { z } from 'zod';
import { sceneKeySchema } from './project-keys';

export const timelineItemSchema = z.object({
  id: z.string(),
  sceneKey: sceneKeySchema,
  presentation: z
    .enum(['standard', 'guide-title', 'guide-steps', 'guide-card', 'guide-demo'])
    .default('standard')
    .transform((): 'standard' => 'standard'),
  /** 未指定はシーンのカット1（scene.clipId）。カット2以降の項目だけに入る。 */
  clipId: z.string().optional(),
  start: z.number().min(0),
  duration: z.number().positive(),
  sourceOffset: z.number().min(0).default(0),
  speed: z.number().min(0.25).max(4).default(1),
  layout: z.enum(['center-crop', 'blur-fit', 'focus', 'split']).default('blur-fit'),
  transition: z.enum(['cut', 'fade', 'slide']).default('cut'),
  volume: z.number().min(0).max(1).default(0.1),
  arrow: z
    .object({
      x1: z.number().min(0).max(1),
      y1: z.number().min(0).max(1),
      x2: z.number().min(0).max(1),
      y2: z.number().min(0).max(1),
    })
    .nullable()
    .default(null),
});

export const volumePointSchema = z.object({
  id: z.string(),
  time: z.number().min(0),
  game: z.number().min(0).max(1),
  bgm: z.number().min(0).max(1),
});

export const soundEffectSchema = z.object({
  id: z.string(),
  label: z.string(),
  audioTrackId: z.string().nullable(),
  start: z.number().min(0),
  volume: z.number().min(0).max(1).default(0.8),
});

export const timelineSchema = z.object({
  durationSec: z.number().positive(),
  items: z.array(timelineItemSchema).min(1),
  volumePoints: z.array(volumePointSchema).default([]),
  effects: z.array(soundEffectSchema).default([]),
});

export type Timeline = z.infer<typeof timelineSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type VolumePoint = z.infer<typeof volumePointSchema>;
export type SoundEffectPlacement = z.infer<typeof soundEffectSchema>;
