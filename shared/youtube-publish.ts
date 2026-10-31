import { DELIVERY_PRESETS, type DeliveryPresetId } from './delivery-presets';
import type { Project } from './schema/project';
import {
  DEFAULT_CATEGORY_ID,
  DEFAULT_PUBLISH_TIMEZONE,
  DESCRIPTION_MAX_BYTES,
  GAME_TITLE_MEMO,
  SCHEDULE_LEAD_MS,
  TAGS_MAX_CHARS,
  TITLE_MAX_CHARS,
  studioChecklistItemSchema,
  youtubePublishMetadataSchema,
  type FileFingerprint,
  type OperationState,
  type PublicationAction,
  type PublicationState,
  type RemoteVideoState,
  type StudioChecklistItem,
  type YoutubePublishJob,
  type YoutubePublishMetadata,
} from './schema/youtube-publish';

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const stripInternalMarkup = (text: string): string =>
  text.replaceAll('{br}', ' ').replaceAll('[', '').replaceAll(']', '').replace(/\s+/g, ' ').trim();

export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** スペースを含むタグは公式どおり引用符込みで数える。カンマも算入する。 */
export const tagsCharCount = (tags: string[]): number => {
  const cleaned = tags.map((tag) => tag.trim()).filter(Boolean);
  if (cleaned.length === 0) return 0;
  return cleaned.map((tag) => (/\s/.test(tag) ? `"${tag}"` : tag)).join(',').length;
};

const splitTagList = (raw: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const char of raw) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ',' || char === '\n' || char === '\r') {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
};

const normalizeYoutubeTag = (value: string): string =>
  value.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim();

/** カンマ区切りを正とする。半角スペースはタグの一部。#だけの列だけ空白で分ける。 */
export const tagsFromHashtags = (raw: string): string[] => {
  const input = raw.trim();
  if (!input) return [];
  const tokens = input.split(/\s+/).filter(Boolean);
  const hashOnly =
    !input.includes(',') &&
    !/[\n\r]/.test(input) &&
    !/["']/.test(input) &&
    tokens.length > 0 &&
    tokens.every((token) => token.startsWith('#'));
  const parts = hashOnly ? tokens : splitTagList(input);
  return parts.map(normalizeYoutubeTag).filter(Boolean);
};

export type MetadataIssue = { field: string; message: string };

export const validatePublishMetadata = (metadata: YoutubePublishMetadata): MetadataIssue[] => {
  const issues: MetadataIssue[] = [];
  const title = stripInternalMarkup(metadata.title);
  if (!title) issues.push({ field: 'title', message: 'タイトルが空です' });
  if (title.length > TITLE_MAX_CHARS) {
    issues.push({ field: 'title', message: `タイトルは${TITLE_MAX_CHARS}文字以内です（${title.length}文字）` });
  }
  const descriptionBytes = utf8Bytes(metadata.description);
  if (descriptionBytes > DESCRIPTION_MAX_BYTES) {
    issues.push({
      field: 'description',
      message: `説明は UTF-8 で ${DESCRIPTION_MAX_BYTES} バイト以内です（${descriptionBytes} バイト）`,
    });
  }
  const tagChars = tagsCharCount(metadata.tags);
  if (tagChars > TAGS_MAX_CHARS) {
    issues.push({ field: 'tags', message: `タグの合計は${TAGS_MAX_CHARS}文字以内です（カンマ込み ${tagChars} 文字）` });
  }
  if (!metadata.categoryId.trim()) issues.push({ field: 'categoryId', message: 'カテゴリを選んでください' });
  if (metadata.hasPaidProductPlacement) {
    issues.push({
      field: 'hasPaidProductPlacement',
      message: '有料プロモーションあり。Studioで設定と表示を確認してください',
    });
  }
  if (metadata.relatedVideosMode === 'set' && metadata.relatedVideoRefs.length === 0) {
    issues.push({ field: 'relatedVideoRefs', message: '関連動画を使う場合は候補URLまたはIDを入れてください' });
  }
  return issues;
};

const zoneParts = (instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

/** タイムゾーン付きの壁時計時刻をUTC ISOへ。PCの現在TZへ暗黙変換しない。 */
export const zonedLocalToUtc = (local: string, timeZone: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!match) throw new Error('日時の形式が不正です');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (timeZone === 'Asia/Tokyo') {
    const utc = Date.UTC(year, month - 1, day, hour - 9, minute, second);
    const date = new Date(utc);
    if (Number.isNaN(date.getTime())) throw new Error('日時を読めません');
    return date.toISOString();
  }
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const seen = zoneParts(new Date(utcGuess), timeZone);
  const asIf = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  const instant = new Date(utcGuess - (asIf - utcGuess));
  const roundTrip = zoneParts(instant, timeZone);
  if (
    roundTrip.year !== year ||
    roundTrip.month !== month ||
    roundTrip.day !== day ||
    roundTrip.hour !== hour ||
    roundTrip.minute !== minute
  ) {
    throw new Error('このタイムゾーンではその時刻は夏時間の欠落または重複のため保存できません');
  }
  return instant.toISOString();
};

export const utcToZonedLocal = (iso: string, timeZone: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = zoneParts(date, timeZone);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
};

export type ScheduleTimeCheck = { ok: true; utc: string } | { ok: false; reason: string };

export const checkScheduleTime = (
  utcIso: string,
  now: Date,
  leadMs = SCHEDULE_LEAD_MS,
): ScheduleTimeCheck => {
  const at = new Date(utcIso);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: '予約日時を読めません' };
  if (at.getTime() <= now.getTime()) return { ok: false, reason: '過去の日時は予約できません' };
  if (at.getTime() < now.getTime() + leadMs) {
    return { ok: false, reason: `予約は現在時刻から${Math.round(leadMs / 60000)}分以上先にしてください` };
  }
  return { ok: true, utc: at.toISOString() };
};

export const remoteFingerprint = (state: Pick<RemoteVideoState, 'privacyStatus' | 'publishAt' | 'title' | 'description' | 'tags' | 'categoryId'>): string =>
  JSON.stringify({
    privacyStatus: state.privacyStatus ?? '',
    publishAt: state.publishAt ?? '',
    title: state.title ?? '',
    description: state.description ?? '',
    tags: state.tags ?? [],
    categoryId: state.categoryId ?? '',
  });

export const derivePublicationState = (remote: Pick<RemoteVideoState, 'privacyStatus' | 'publishAt'>, now: Date): PublicationState => {
  const privacy = remote.privacyStatus;
  if (!privacy) return 'unknown';
  if (privacy === 'public') return 'public';
  if (privacy === 'unlisted') return 'unlisted';
  if (privacy === 'private' && remote.publishAt) {
    const at = new Date(remote.publishAt);
    if (!Number.isNaN(at.getTime()) && at.getTime() > now.getTime()) return 'scheduled';
    return 'private';
  }
  if (privacy === 'private') return 'private';
  return 'unknown';
};

export const writableStatusFromRemote = (
  remote: RemoteVideoState | undefined,
  patch: { privacyStatus: 'private' | 'unlisted' | 'public'; publishAt?: string },
): Record<string, unknown> => {
  const status: Record<string, unknown> = {};
  if (remote?.embeddable !== undefined) status.embeddable = remote.embeddable;
  if (remote?.license) status.license = remote.license;
  if (remote?.publicStatsViewable !== undefined) status.publicStatsViewable = remote.publicStatsViewable;
  if (remote?.selfDeclaredMadeForKids !== undefined) status.selfDeclaredMadeForKids = remote.selfDeclaredMadeForKids;
  if (remote?.containsSyntheticMedia !== undefined) status.containsSyntheticMedia = remote.containsSyntheticMedia;
  status.privacyStatus = patch.privacyStatus;
  if (patch.publishAt) status.publishAt = patch.publishAt;
  return status;
};

export const writableSnippetFromRemote = (
  remote: RemoteVideoState | undefined,
  patch: Partial<Pick<RemoteVideoState, 'title' | 'description' | 'tags' | 'categoryId' | 'defaultLanguage'>>,
): Record<string, unknown> => {
  const snippet: Record<string, unknown> = {
    title: patch.title ?? remote?.title ?? '',
    description: patch.description ?? remote?.description ?? '',
    tags: patch.tags ?? remote?.tags ?? [],
    categoryId: patch.categoryId ?? remote?.categoryId ?? DEFAULT_CATEGORY_ID,
  };
  const language = patch.defaultLanguage ?? remote?.defaultLanguage;
  if (language) {
    snippet.defaultLanguage = language;
    snippet.defaultAudioLanguage = language;
  }
  return snippet;
};

/** Studioの「動画の言語」は defaultAudioLanguage。タイトル言語と両方入れる。 */
export const snippetFromMetadata = (metadata: YoutubePublishMetadata): Record<string, unknown> => {
  const language = metadata.defaultLanguage?.trim();
  const snippet: Record<string, unknown> = {
    title: stripInternalMarkup(metadata.title),
    description: metadata.description,
    tags: metadata.tags.map((tag) => tag.trim()).filter(Boolean),
    categoryId: metadata.categoryId || DEFAULT_CATEGORY_ID,
  };
  if (language) {
    snippet.defaultLanguage = language;
    snippet.defaultAudioLanguage = language;
  }
  return snippet;
};

export const buildInsertResource = (metadata: YoutubePublishMetadata): { snippet: Record<string, unknown>; status: Record<string, unknown> } => ({
  snippet: snippetFromMetadata(metadata),
  status: {
    privacyStatus: 'private',
    selfDeclaredMadeForKids: metadata.selfDeclaredMadeForKids,
    containsSyntheticMedia: metadata.containsSyntheticMedia,
  },
});

/** 画面に項目がない説明・タグ・言語が空なら、投稿文の値で埋める。入力済みのタイトルと再生リストは残す。 */
export const healPublishMetadata = (
  metadata: YoutubePublishMetadata,
  fromProject: YoutubePublishMetadata,
): YoutubePublishMetadata => {
  const title = metadata.title.trim() ? metadata.title : fromProject.title;
  const description = metadata.description.trim() ? metadata.description : fromProject.description;
  const tags = fromProject.tags.some((tag) => tag.trim()) ? fromProject.tags : metadata.tags;
  return {
    ...fromProject,
    ...metadata,
    title,
    description,
    tags,
    defaultLanguage: metadata.defaultLanguage?.trim() || fromProject.defaultLanguage,
    categoryId: metadata.categoryId.trim() || fromProject.categoryId,
    thumbnailPath: metadata.thumbnailPath?.trim() || fromProject.thumbnailPath,
  };
};

export const studioEditUrl = (videoId: string): string => {
  if (!YOUTUBE_VIDEO_ID.test(videoId)) throw new Error('動画IDの形式が不正です');
  return `https://studio.youtube.com/video/${videoId}/edit`;
};

export const youtubePublicUrl = (videoId: string, kind: 'shorts' | 'video' | 'unknown' = 'unknown'): string => {
  if (!YOUTUBE_VIDEO_ID.test(videoId)) throw new Error('動画IDの形式が不正です');
  if (kind === 'shorts') return `https://youtube.com/shorts/${videoId}`;
  return `https://www.youtube.com/watch?v=${videoId}`;
};

export const isYoutubeVideoId = (value: string): boolean => YOUTUBE_VIDEO_ID.test(value.trim());

export const redactSecrets = (text: string): string =>
  text
    .replace(/ya29\.[A-Za-z0-9._~-]+/g, '[token]')
    .replace(/1\/\/[A-Za-z0-9_-]+/g, '[refresh]')
    .replace(/https?:\/\/[^\s"'\\]*googleapis\.com\/upload[^\s"'\\]*/gi, '[session-url]')
    .replace(/https?:\/\/[^\s"'\\]*upload\.googleapis\.com[^\s"'\\]*/gi, '[session-url]');

export const retryDelayMs = (attempt: number, jitter: number, retryAfterMs?: number): number => {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, 60_000);
  const base = Math.min(60_000, 1000 * 2 ** Math.max(0, attempt));
  return base + Math.round(jitter * 250);
};

export const defaultStudioChecks = (metadata: YoutubePublishMetadata): StudioChecklistItem[] => {
  const relatedRequired = metadata.relatedVideosMode === 'set';
  const paidRequired = metadata.hasPaidProductPlacement;
  const brandRequired = Boolean(metadata.brandPartnerNote?.trim());
  const coverRequired = metadata.contentKind === 'shorts';
  return [
    studioChecklistItemSchema.parse({
      key: 'game-title',
      label: `ゲームタイトル（${metadata.gameTitleMemo || GAME_TITLE_MEMO}）`,
      required: true,
    }),
    studioChecklistItemSchema.parse({
      key: 'related-videos',
      label: relatedRequired ? 'Shortsの関連動画をStudioで設定' : 'Shortsの関連動画は使わない',
      required: relatedRequired,
      status: relatedRequired ? 'unchecked' : 'not_applicable',
      reason: relatedRequired ? undefined : '使わないを選択',
    }),
    studioChecklistItemSchema.parse({
      key: 'shorts-cover',
      label: 'ShortsカバーをStudioで確認',
      required: coverRequired,
      status: coverRequired ? 'unchecked' : 'not_applicable',
      reason: coverRequired ? undefined : '通常動画のためAPIサムネイルを使う',
    }),
    studioChecklistItemSchema.parse({
      key: 'paid-promotion',
      label: '有料プロモーション',
      required: paidRequired,
      status: paidRequired ? 'unchecked' : 'not_applicable',
      reason: paidRequired ? 'あり。Studioで表示を確認' : 'なし',
    }),
    studioChecklistItemSchema.parse({
      key: 'brand-partner',
      label: 'ブランド連携',
      required: brandRequired,
      status: brandRequired ? 'unchecked' : 'not_applicable',
      reason: brandRequired ? metadata.brandPartnerNote : 'なし',
    }),
    studioChecklistItemSchema.parse({
      key: 'rights',
      label: '権利・公開制限をStudioで確認',
      required: true,
    }),
    studioChecklistItemSchema.parse({
      key: 'translations',
      label: '翻訳欄（任意）',
      required: false,
    }),
  ];
};

export const requiredStudioPending = (job: YoutubePublishJob): StudioChecklistItem[] =>
  job.studioChecks.filter((item) => item.required && item.status === 'unchecked');

export const processingSucceeded = (remote: RemoteVideoState | undefined): boolean => {
  if (!remote) return false;
  if (remote.uploadStatus && remote.uploadStatus !== 'processed' && remote.uploadStatus !== 'uploaded') return false;
  if (remote.processingStatus && remote.processingStatus !== 'succeeded' && remote.processingStatus !== 'processing') {
    return false;
  }
  return remote.processingStatus === 'succeeded' || remote.uploadStatus === 'processed' || (!remote.processingStatus && Boolean(remote.videoId));
};

export const canApplySchedule = (job: YoutubePublishJob, now: Date): { ok: true } | { ok: false; reason: string } => {
  if (!job.youtubeVideoId) return { ok: false, reason: '動画IDがまだありません' };
  if (job.everPublished) return { ok: false, reason: '一度公開された動画の再予約は対象外です' };
  if (job.publicationState === 'public') return { ok: false, reason: 'すでに公開されています' };
  if (job.operationState === 'outcome_unknown') return { ok: false, reason: 'アップロード結果が不明です。先に動画を確認してください' };
  if (job.operationState === 'uploading' || job.operationState === 'paused') {
    return { ok: false, reason: '転送が終わってから予約できます' };
  }
  const pending = requiredStudioPending(job);
  if (pending.length > 0) {
    return { ok: false, reason: `Studio確認が残っています（${pending.map((item) => item.label).join('、')}）` };
  }
  if (job.metadata.hasPaidProductPlacement) {
    const paid = job.studioChecks.find((item) => item.key === 'paid-promotion');
    if (paid?.status !== 'done') return { ok: false, reason: '有料プロモーションあり。Studio確認が必要です' };
  }
  if (!job.desiredPublishAt) return { ok: false, reason: '予約日時が未設定です' };
  const time = checkScheduleTime(job.desiredPublishAt, now);
  if (!time.ok) return time;
  return { ok: true };
};

export const threeWayConflict = (
  baseline: RemoteVideoState | undefined,
  remote: RemoteVideoState | undefined,
  local: { title?: string; description?: string; tags?: string[]; desiredPublishAt?: string },
): { field: string; baseline?: string; remote?: string; local?: string }[] => {
  if (!baseline || !remote) return [];
  const diffs: { field: string; baseline?: string; remote?: string; local?: string }[] = [];
  const compare = (field: string, left?: string, right?: string, mine?: string): void => {
    if ((left ?? '') === (right ?? '')) return;
    diffs.push({ field, baseline: left, remote: right, local: mine });
  };
  compare('title', baseline.title, remote.title, local.title);
  compare('description', baseline.description, remote.description, local.description);
  compare('tags', (baseline.tags ?? []).join(','), (remote.tags ?? []).join(','), (local.tags ?? []).join(','));
  compare('privacyStatus', baseline.privacyStatus, remote.privacyStatus);
  compare('publishAt', baseline.publishAt, remote.publishAt, local.desiredPublishAt);
  return diffs;
};

/** クライアントが実際に送ったキーだけを残す。スキーマの default で空タイトルなどを混ぜない。 */
export const providedMetadataPatch = (
  raw: unknown,
  parsed: Partial<YoutubePublishMetadata> | undefined,
): Partial<YoutubePublishMetadata> | undefined => {
  if (!parsed || !raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const patch: Partial<YoutubePublishMetadata> = {};
  for (const key of Object.keys(parsed) as Array<keyof YoutubePublishMetadata>) {
    if (Object.prototype.hasOwnProperty.call(source, key)) patch[key] = parsed[key] as never;
  }
  return patch;
};

export const rawMetadataOf = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || !('metadata' in input)) return undefined;
  return (input as { metadata?: unknown }).metadata;
};

export const metadataFromProject = (
  project: Project,
  preset: DeliveryPresetId,
  extras?: Partial<YoutubePublishMetadata>,
): YoutubePublishMetadata => {
  const spec = DELIVERY_PRESETS[preset];
  const language = spec.videoLanguage === 'en' || spec.copyLanguages[0] === 'en' ? 'en' : 'ja';
  const title = stripInternalMarkup(project.publishing.title[language] ?? '');
  const description = project.publishing.description[language] ?? '';
  const tags = tagsFromHashtags(project.publishing.hashtags[language] ?? '');
  return youtubePublishMetadataSchema.parse({
    title,
    description,
    tags,
    categoryId: DEFAULT_CATEGORY_ID,
    defaultLanguage: language,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: false,
    hasPaidProductPlacement: false,
    playlistIds: [],
    gameTitleMemo: GAME_TITLE_MEMO,
    relatedVideosMode: 'unused',
    relatedVideoRefs: [],
    translationJa: project.publishing.title.ja,
    translationKo: project.publishing.title.ko ?? project.publishing.description.ko,
    contentKind: 'shorts',
    ...extras,
  });
};

export const fingerprintsMatch = (expected: FileFingerprint, actual: FileFingerprint): boolean =>
  expected.size === actual.size && expected.mtimeMs === actual.mtimeMs && expected.sha256 === actual.sha256;

export const nextOperationAfterUpload = (job: YoutubePublishJob): OperationState => {
  if (job.steps.some((step) => step.step === 'thumbnail' && step.status === 'failed')) return 'action_required';
  if (job.steps.some((step) => step.step === 'playlist' && step.status === 'failed')) return 'action_required';
  if (requiredStudioPending(job).length > 0) return 'awaiting_studio';
  return 'ready_to_publish';
};

export const shouldCreateReviewTask = (input: {
  publicationState?: PublicationState;
  actualPublishedAt?: string;
  postedAt?: string;
  url?: string;
}): boolean => {
  if (input.publicationState === 'scheduled' || input.publicationState === 'private' || input.publicationState === 'unlisted') {
    return false;
  }
  if (input.publicationState === 'public') return Boolean(input.actualPublishedAt);
  return Boolean(input.url?.trim() && input.postedAt);
};

export const reviewStartAt = (input: { actualPublishedAt?: string; postedAt?: string }): string | undefined =>
  input.actualPublishedAt || input.postedAt || undefined;
