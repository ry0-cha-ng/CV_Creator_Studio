import { z } from 'zod';
import { PROFILE_THEME_KEYS, type CommonCandidate, type FeatureIdeaInput, type ProfileTheme } from '../competitor-observation';
import type { CompetitorListItem, CompetitorSyncView, CompetitorVideo } from './competitor';

const text = (max: number) => z.string().trim().max(max);
const id = z.string().min(1).max(80);

export const profileThemeSchema = z.enum(PROFILE_THEME_KEYS);

export const jotSaveSchema = z.object({
  id: id.optional(),
  clientRequestId: z.string().uuid(),
  channelId: id.nullable().default(null),
  videoId: id.nullable().default(null),
  body: text(4000).min(1),
  atSeconds: z.number().int().min(0).max(86_400).nullable().default(null),
});

export const jotListSchema = z.object({
  channelId: id.optional(),
  videoId: id.optional(),
  status: z.enum(['open', 'handed_off', 'all']).default('open'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});

export const jotIdsSchema = z.object({ ids: z.array(id).min(1).max(100) });

export const profileSaveSchema = z.object({
  subject: id,
  theme: profileThemeSchema,
  labels: z.array(text(30).min(1)).max(12),
  note: text(1000).default(''),
  sourceUrl: text(500).default(''),
  /** true なら確認日を今にする。ラベルだけ直すときは false。 */
  confirmed: z.boolean().default(true),
});

export const profileOptionSchema = z.object({ theme: profileThemeSchema, label: text(30).min(1) });

export const profileMatrixSchema = z.object({ subjects: z.array(id).max(9) });

export const tagSaveSchema = z.object({
  id: id.optional(),
  name: text(40).min(1),
  group: text(20).min(1),
  criteria: text(300).default(''),
});

export const tagAssignSchema = z.object({
  videoIds: z.array(id).min(1).max(100),
  tagId: id,
  origin: z.enum(['manual', 'ai_adopted']).default('manual'),
});

export const tagUnassignSchema = z.object({ videoId: id, tagId: id });

export const focusAddSchema = z.object({
  channelId: id,
  urls: z.string().max(20_000),
  reason: text(300).default(''),
});

export const focusSetSchema = z.object({
  channelId: id,
  videoId: id,
  focus: z.boolean(),
  reason: text(300).optional(),
});

export const videoQuerySchema = z.object({
  /** 指定なしは全チャンネル。 */
  channelIds: z.array(id).max(50).optional(),
  focusOnly: z.boolean().default(false),
  sort: z.enum(['new', 'views']).default('new'),
  format: z.enum(['all', 'shorts', 'standard', 'live', 'unconfirmed']).default('all'),
  jotsOnly: z.boolean().default(false),
  untaggedOnly: z.boolean().default(false),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(96).default(48),
});

export const featureIdeaRequestSchema = z.object({
  focusVideoIds: z.array(id).min(1).max(15),
  compareVideoIds: z.array(id).max(15).default([]),
});

export type CompetitorJot = {
  id: string;
  channelId: string | null;
  channelLabel: string | null;
  videoId: string | null;
  body: string;
  atSeconds: number | null;
  status: 'open' | 'handed_off' | 'archived';
  handedOffAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JotPage = { items: CompetitorJot[]; total: number };

export type ProfileEntry = {
  subject: string;
  theme: ProfileTheme;
  labels: string[];
  note: string;
  sourceUrl: string;
  confirmedAt: string | null;
  updatedAt: string;
  stale: boolean;
};

export type ProfileOptions = Record<ProfileTheme, string[]>;

export type ProfileSubject = {
  id: string;
  label: string;
  self: boolean;
  /** vidIQ のチャンネルページ。自分やハンドル不明なら null。 */
  vidiqUrl: string | null;
};

export type ProfileMatrix = {
  subjects: ProfileSubject[];
  entries: ProfileEntry[];
  commons: CommonCandidate[];
  /** プロフィールを1テーマ以上記入した subject の数。 */
  filled: number;
};

export type FeatureTag = {
  id: string;
  name: string;
  group: string;
  criteria: string;
  focusCount: number;
  allCount: number;
};

export type ObservedVideo = CompetitorVideo & {
  channelId: string;
  channelLabel: string;
  focusAt: string | null;
  focusReason: string;
  tagIds: string[];
  jotCount: number;
  /** vidIQ のこの動画のページ。チャンネルのハンドルが分からなければ null。 */
  vidiqUrl: string | null;
};

export type VideoPage = { items: ObservedVideo[]; total: number; focusTotal: number };

export type ObservationSummary = {
  openJots: number;
  profileFilled: number;
  profileSubjects: number;
  commons: CommonCandidate[];
};

/** 一覧画面を1回の呼び出しで描くためのまとめ。 */
export type CompetitorOverview = {
  channels: CompetitorListItem[];
  sync: CompetitorSyncView;
  observation: ObservationSummary;
};

export type FeatureIdea = {
  name: string;
  group: string;
  fact: string;
  hypothesis: string;
  counter: string;
  videoIds: string[];
  focusHits: number;
  compareHits: number;
};

export type FeatureIdeaResult = {
  sent: FeatureIdeaInput;
  ideas: FeatureIdea[];
};
