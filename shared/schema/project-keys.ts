import { z } from 'zod';

export const sceneKeySchema = z.enum([
  'hook',
  'stand',
  'aim',
  'throw',
  'card',
  'demo',
  'loop',
]);

export type SceneKey = z.infer<typeof sceneKeySchema>;
