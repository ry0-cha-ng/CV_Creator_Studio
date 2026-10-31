import { randomId, type IdFactory } from './ids';
import {
  DEFAULT_EXPRESSIONS,
  LONG_SCHEMA_VERSION,
  longProjectSchema,
  type Chapter,
  type ChapterRole,
  type ContentKind,
  type LongLanguage,
  type LongProject,
  type Scene,
  type ScenePurpose,
  type ShowOrder,
} from './schema';
import { secToTicks } from './time';

/**
 * T-LONG とセットテンプレート。生成するのは編集できる実体で、
 * 後のテンプレート更新で再生成・上書きしない（template に生成時の版とパラメータを残す）。
 */

export const T_LONG_ID = 't-long';
export const T_LONG_VERSION = 1;

export type SlotDef = { purpose: ScenePurpose; label: string; hint: string; seconds: number };

export const SHOW_ORDER_LABEL: Record<ShowOrder, string> = {
  'success-first': '成功先出し',
  'explain-first': '解説先行',
  'success-fail-retry': '成功・失敗・再挑戦',
};

export const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  single: '単一定点',
  combo: '複数スキル',
};

export const CHAPTER_ROLE_LABEL: Record<ChapterRole, string> = {
  hook: 'フック',
  set: 'セット',
  closing: '締め',
  ending: 'エンディング',
  custom: '自由',
};

export const SCENE_PURPOSE_LABEL: Record<ScenePurpose, string> = {
  hook: 'フック',
  action: '実戦',
  explain: '解説',
  condition: '使用条件',
  fail: '失敗',
  unexpected: '想定外',
  reaction: '反応',
  replay: 'リプレイ',
  summary: '要点',
  card: 'カード',
  pause: '間',
  highlight: 'ハイライト',
  ending: 'エンディング',
  custom: '自由',
};

export const SET_SLOTS: Record<ShowOrder, SlotDef[]> = {
  'success-first': [
    { purpose: 'action', label: '実戦①', hint: '状況を一言添え、まず成功を見せる', seconds: 20 },
    { purpose: 'explain', label: '種明かし', hint: '立ち位置・狙う場所・狙っている効果を短く示す', seconds: 15 },
    { purpose: 'action', label: '実戦②', hint: '異なる状況でも使えることを見せる', seconds: 20 },
    { purpose: 'condition', label: '使用条件', hint: '何を合図に使うか／使わない方がよい状況', seconds: 10 },
    { purpose: 'action', label: '実戦③', hint: '解説を減らし、キル音や本人の反応を活かす', seconds: 20 },
    { purpose: 'replay', label: 'リプレイ・まとめ', hint: '必要部分だけを再生し、要点を一つ伝えて次の章へ', seconds: 15 },
  ],
  'explain-first': [
    { purpose: 'explain', label: '課題', hint: 'この定点で何を解決するか', seconds: 10 },
    { purpose: 'explain', label: '仕組み・立ち位置', hint: '立ち位置・狙う場所・効果', seconds: 20 },
    { purpose: 'action', label: '実戦①', hint: '解説どおりに決まる場面', seconds: 25 },
    { purpose: 'action', label: '実戦②', hint: '別の状況での成功', seconds: 25 },
    { purpose: 'summary', label: '要点', hint: '要点を一つ伝えて次の章へ', seconds: 15 },
  ],
  'success-fail-retry': [
    { purpose: 'action', label: '成功', hint: 'まず決まった場面を見せる', seconds: 20 },
    { purpose: 'explain', label: '狙い', hint: '何を狙っていたか', seconds: 15 },
    { purpose: 'fail', label: '失敗／想定外', hint: 'うまくいかなかった場面', seconds: 15 },
    { purpose: 'reaction', label: '反応', hint: '本人の反応を活かす', seconds: 10 },
    { purpose: 'action', label: '再挑戦・注意点', hint: '再挑戦または注意点', seconds: 25 },
    { purpose: 'summary', label: '要点', hint: '要点を一つ伝えて次の章へ', seconds: 10 },
  ],
};

export const HOOK_SLOTS: SlotDef[] = [
  { purpose: 'highlight', label: '冒頭の見せ場', hint: '成功・意外性のある場面を先出しし、今回何が見られるかを短く伝える', seconds: 15 },
];

export const CLOSING_SLOTS: SlotDef[] = [
  { purpose: 'highlight', label: 'ハイライト①', hint: '説明を減らし、キル音・反応を活かす', seconds: 15 },
  { purpose: 'highlight', label: 'ハイライト②', hint: '', seconds: 15 },
  { purpose: 'highlight', label: 'ハイライト③', hint: '', seconds: 15 },
];

export const ENDING_SLOTS: SlotDef[] = [
  { purpose: 'ending', label: 'エンディング', hint: '要点・次回への期待・任意のチャンネル登録やClutchVault案内', seconds: 15 },
];

export type SetConfig = { contentKind: ContentKind; showOrder: ShowOrder; title?: string };

export type LongTemplateParams = {
  hook: boolean;
  sets: SetConfig[];
  closing: boolean;
  ending: boolean;
};

export const DEFAULT_SETS: SetConfig[] = [
  { contentKind: 'single', showOrder: 'success-first' },
  { contentKind: 'single', showOrder: 'success-first' },
  { contentKind: 'single', showOrder: 'success-first' },
  { contentKind: 'combo', showOrder: 'success-fail-retry' },
];

export const DEFAULT_TEMPLATE_PARAMS: LongTemplateParams = {
  hook: true,
  sets: DEFAULT_SETS,
  closing: true,
  ending: true,
};

export const slotsFor = (role: ChapterRole, showOrder: ShowOrder | null): SlotDef[] => {
  if (role === 'hook') return HOOK_SLOTS;
  if (role === 'closing') return CLOSING_SLOTS;
  if (role === 'ending') return ENDING_SLOTS;
  if (role === 'set') return SET_SLOTS[showOrder ?? 'success-first'];
  return [{ purpose: 'custom', label: 'シーン', hint: '', seconds: 10 }];
};

export const sceneFromSlot = (slot: SlotDef, chapterId: string, ids: IdFactory): Scene => ({
  id: ids('scene'),
  chapterId,
  purpose: slot.purpose,
  label: slot.label,
  hint: slot.hint,
  enabled: true,
  content:
    slot.purpose === 'ending'
      ? { kind: 'still', color: '#0F1216', duration: secToTicks(slot.seconds) }
      : { kind: 'empty', plannedDuration: secToTicks(slot.seconds) },
  layerIds: [],
});

export const buildChapter = (
  role: ChapterRole,
  options: { contentKind?: ContentKind; showOrder?: ShowOrder; title?: string; index?: number },
  ids: IdFactory,
): { chapter: Chapter; scenes: Scene[] } => {
  const id = ids('chapter');
  const showOrder = role === 'set' ? (options.showOrder ?? 'success-first') : null;
  const scenes = slotsFor(role, showOrder).map((slot) => sceneFromSlot(slot, id, ids));
  const defaultTitle =
    role === 'set' ? `セット${options.index ?? ''}` : role === 'hook' ? '冒頭の見せ場' : role === 'closing' ? 'ハイライト' : role === 'ending' ? 'エンディング' : '章';
  return {
    chapter: {
      id,
      role,
      title: { ja: options.title?.trim() || defaultTitle },
      contentKind: role === 'set' ? (options.contentKind ?? 'single') : null,
      showOrder,
      lineups: [],
      sceneIds: scenes.map((scene) => scene.id),
      enabled: true,
      inChapters: true,
      note: '',
    },
    scenes,
  };
};

export const slugify = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export type CreateLongOptions = {
  id: string;
  title: string;
  slug?: string;
  now?: string;
  fps?: 30 | 60;
  languages?: LongLanguage[];
  template?: LongTemplateParams | null;
  ids?: IdFactory;
};

export const createLongProject = (options: CreateLongOptions): LongProject => {
  const ids = options.ids ?? randomId;
  const now = options.now ?? new Date().toISOString();
  const params = options.template === undefined ? DEFAULT_TEMPLATE_PARAMS : options.template;
  const chapters: Chapter[] = [];
  const scenes: Scene[] = [];
  const push = (built: { chapter: Chapter; scenes: Scene[] }): void => {
    chapters.push(built.chapter);
    scenes.push(...built.scenes);
  };
  if (params) {
    if (params.hook) push(buildChapter('hook', {}, ids));
    params.sets.forEach((set, index) =>
      push(buildChapter('set', { ...set, index: index + 1 }, ids)),
    );
    if (params.closing) push(buildChapter('closing', {}, ids));
    if (params.ending) push(buildChapter('ending', {}, ids));
  }
  return longProjectSchema.parse({
    format: 'long',
    longSchemaVersion: LONG_SCHEMA_VERSION,
    id: options.id,
    title: options.title.trim() || '新しい横動画',
    slug: options.slug ?? slugify(options.title),
    createdAt: now,
    updatedAt: now,
    status: 'editing',
    output: {
      width: 1920,
      height: 1080,
      fps: options.fps ?? 60,
      languages: options.languages?.length ? options.languages : ['ja'],
      captionMode: 'burn',
      withoutBgm: false,
    },
    template: {
      templateId: params ? T_LONG_ID : 'empty',
      version: T_LONG_VERSION,
      createdAt: now,
      params: params ? { ...params } : {},
    },
    chapterOrder: chapters.map((chapter) => chapter.id),
    chapters,
    scenes,
    expressions: DEFAULT_EXPRESSIONS,
  });
};

/** 尺の目安（秒）。テンプレートの初期値から計算する。 */
export const estimateTemplateSeconds = (params: LongTemplateParams): number => {
  const sum = (slots: SlotDef[]): number => slots.reduce((total, slot) => total + slot.seconds, 0);
  return (
    (params.hook ? sum(HOOK_SLOTS) : 0) +
    params.sets.reduce((total, set) => total + sum(SET_SLOTS[set.showOrder]), 0) +
    (params.closing ? sum(CLOSING_SLOTS) : 0) +
    (params.ending ? sum(ENDING_SLOTS) : 0)
  );
};

export const LONG_DURATION_GUIDE = { minSec: 8 * 60, maxSec: 12 * 60 };
