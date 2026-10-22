import { z } from 'zod';

export const audioKindSchema = z.enum(['bgm', 'se']);
export const audioSourceSchema = z.enum([
  'bgmer',
  'musmus',
  'opentracks',
  'ytal',
  'other',
]);
export const platformSchema = z.enum(['youtube', 'tiktok', 'x']);
export const licenseStatusSchema = z.enum(['confirmed', 'unconfirmed']);

export const audioTrackSchema = z.object({
  id: z.string(),
  kind: audioKindSchema,
  filePath: z.string(),
  fileHash: z.string(),
  title: z.string().min(1),
  artist: z.string().default(''),
  source: audioSourceSchema,
  sourceUrl: z.string().default(''),
  downloadedAt: z.string(),
  termsCheckedAt: z.string(),
  creditRequired: z.boolean(),
  creditText: z.string().default(''),
  allowedPlatforms: z.array(platformSchema),
  authorTermsNote: z.string().default(''),
  licenseStatus: licenseStatusSchema,
  durationSec: z.number().positive(),
  lufs: z.number().nullable().default(null),
  waveform: z.array(z.number().min(0).max(1)).default([]),
  moods: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const audioRegistrationSchema = audioTrackSchema.pick({
  kind: true,
  title: true,
  artist: true,
  source: true,
  sourceUrl: true,
  downloadedAt: true,
  termsCheckedAt: true,
  creditRequired: true,
  creditText: true,
  allowedPlatforms: true,
  authorTermsNote: true,
  licenseStatus: true,
  moods: true,
  tags: true,
});

export const bgmPlacementSchema = z.object({
  audioTrackId: z.string(),
  start: z.number().min(0).default(0),
  duration: z.number().positive(),
  offset: z.number().min(0).default(0),
  fadeIn: z.number().min(0).default(0.5),
  fadeOut: z.number().min(0).default(0.5),
  ducking: z.boolean().default(true),
  gain: z.number().min(0).max(1).default(0.02),
});

export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type AudioRegistration = z.infer<typeof audioRegistrationSchema>;
export type AudioSource = z.infer<typeof audioSourceSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type BgmPlacement = z.infer<typeof bgmPlacementSchema>;

export const AUDIO_SOURCE_DEFAULTS: Record<
  AudioSource,
  Pick<
    AudioRegistration,
    'creditRequired' | 'creditText' | 'allowedPlatforms' | 'licenseStatus'
  >
> = {
  bgmer: {
    creditRequired: false,
    creditText: '音楽：BGMer https://bgmer.net',
    allowedPlatforms: ['youtube', 'tiktok', 'x'],
    licenseStatus: 'unconfirmed',
  },
  musmus: {
    creditRequired: true,
    creditText: 'BGM:MusMus',
    allowedPlatforms: ['youtube', 'tiktok', 'x'],
    licenseStatus: 'unconfirmed',
  },
  opentracks: {
    creditRequired: false,
    creditText: '',
    allowedPlatforms: ['youtube', 'tiktok', 'x'],
    licenseStatus: 'unconfirmed',
  },
  ytal: {
    creditRequired: false,
    creditText: '',
    allowedPlatforms: ['youtube'],
    licenseStatus: 'unconfirmed',
  },
  other: {
    creditRequired: false,
    creditText: '',
    allowedPlatforms: [],
    licenseStatus: 'unconfirmed',
  },
};
