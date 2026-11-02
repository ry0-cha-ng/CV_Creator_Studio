import type { BgmPlacement } from './schema/audio';
import type { Project, SceneKey } from './schema/project';
import type { Timeline, TimelineItem, VolumePoint } from './schema/timeline';
import type { CtaDesign } from './cta-design';
import { resolveCtaDesign } from './s4-cta';
import { BUILTIN_VIDEO_STRUCTURE_TEMPLATES, DEFAULT_SCENE_ORDER } from './video-structure';
import {
  PRIMARY_CUT_ID,
  MIN_CUT_SEC,
  cutLength,
  extraCutClipOfItem,
  extraCutsOf,
  sceneCuts,
  type ResolvedCut,
} from './scene-cuts';

export const SCENE_BAND: Record<SceneKey, string> = {
  hook: 'S1 フック',
  stand: 'S2 立ち位置',
  aim: 'S3 合わせ位置',
  throw: 'S4 発動イメージ',
  card: 'S5 カード',
  demo: 'S6 デモ',
  loop: 'S7 ループ',
};

export const DEMO_DURATION_MIN = 6;
const STRETCH_MIN = 0.3;
const STRETCH_MAX = 300;

const BASE_DURATIONS: Record<SceneKey, number> = {
  hook: 4,
  stand: 3,
  aim: 4,
  throw: 3,
  card: 2.5,
  demo: 11.5,
  loop: 2,
};

export const BASE_SCENE_DURATIONS = BASE_DURATIONS;

/** 秒数を指定できるシーン。カードは映像切り抜きなしで尺だけ変える。 */
export const TRIM_DURATION_SCENES: SceneKey[] = ['hook', 'stand', 'aim', 'throw', 'card', 'demo', 'loop'];

export const sceneDurationLimits = (sceneKey: SceneKey): { min: number; max: number } =>
  sceneKey === 'demo'
    ? { min: DEMO_DURATION_MIN, max: STRETCH_MAX }
    : { min: STRETCH_MIN, max: STRETCH_MAX };

export const clampSceneDuration = (sceneKey: SceneKey, seconds: number): number => {
  const limits = sceneDurationLimits(sceneKey);
  if (!Number.isFinite(seconds)) return BASE_DURATIONS[sceneKey];
  return Math.min(limits.max, Math.max(limits.min, seconds));
};

export const builtinSceneDuration = (sceneKey: SceneKey): number => BASE_DURATIONS[sceneKey];

export const normalizeSceneDurationDefaults = (
  raw: unknown,
): Partial<Record<SceneKey, number>> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const next: Partial<Record<SceneKey, number>> = {};
  for (const key of TRIM_DURATION_SCENES) {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    next[key] = clampSceneDuration(key, value);
  }
  return next;
};

const BGM_LEVEL: Record<SceneKey, number> = {
  hook: 0.4,
  stand: 0.4,
  aim: 0.4,
  throw: 0.4,
  card: 0.4,
  demo: 0.4,
  loop: 0.4,
};

export const defaultBgmLevel = (sceneKey: SceneKey): number => BGM_LEVEL[sceneKey] ?? 0.4;

export const sceneBgmLevel = (project: Project, sceneKey: SceneKey): number =>
  project.scenes.find((scene) => scene.sceneKey === sceneKey)?.bgmVolume ?? defaultBgmLevel(sceneKey);

/** S7 は自分のクリップがあればそれを使い、未設定のときだけ S1 のシーン設定に戻す。 */
export const playbackSceneKey = (project: Project, sceneKey: SceneKey): SceneKey => {
  if (sceneKey !== 'loop') return sceneKey;
  const loop = project.scenes.find((scene) => scene.sceneKey === 'loop');
  return loop?.clipId ? 'loop' : 'hook';
};

/** S7 の初期区間は S1 の開始と重ねない。S1 の in が 30.5 なら S7 の out は 30.49。 */
export const LOOP_BEFORE_HOOK_GAP = 0.01;

export const sceneDurations = (project: Project): Record<SceneKey, number> => {
  const saved = project.templateParams.sceneDurations ?? {};
  const durations = { ...BASE_DURATIONS };
  for (const key of TRIM_DURATION_SCENES) {
    if (key === 'demo') continue;
    const value = saved[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      durations[key] = clampSceneDuration(key, value);
    }
  }
  durations.demo = Math.max(DEMO_DURATION_MIN, project.templateParams.demoDuration);
  return durations;
};

const roundCentisecond = (value: number): number => Math.round(value * 100) / 100;

const loopPlaybackDuration = (project: Project): number => {
  if (project.timelineEdited && project.timeline) {
    const item = project.timeline.items.find((entry) => entry.sceneKey === 'loop');
    if (item && item.duration > 0) return item.duration;
  }
  return sceneDurations(project).loop;
};

/**
 * S1 の開始直前のソース区間。専用クリップの有無は見ない。
 * out は S1 の in より 0.01 秒前。長さは S7 の尺で、映像の頭で止まる。
 */
export const loopRangeBeforeHook = (
  project: Project,
  durationSec?: number,
): { assetId: string; in: number; out: number } | null => {
  const hookScene = project.scenes.find((scene) => scene.sceneKey === 'hook');
  const hookClip = project.clips.find((clip) => clip.id === hookScene?.clipId);
  if (!hookClip) return null;
  const asset = project.assets.find((item) => item.id === hookClip.assetId);
  if (!asset || asset.type !== 'video') return null;
  const out = roundCentisecond(hookClip.in - LOOP_BEFORE_HOOK_GAP);
  if (!(out > 0.1)) return null;
  const span = Math.min(Math.max(0.1, durationSec ?? loopPlaybackDuration(project)), out);
  const start = roundCentisecond(Math.max(0, out - span));
  if (!(out > start)) return null;
  return { assetId: hookClip.assetId, in: start, out };
};

/** S7 に専用クリップがないときの再生区間。あるときは null。 */
export const defaultLoopRange = (
  project: Project,
): { assetId: string; in: number; out: number } | null => {
  const loop = project.scenes.find((scene) => scene.sceneKey === 'loop');
  if (loop?.clipId && project.clips.some((clip) => clip.id === loop.clipId)) return null;
  return loopRangeBeforeHook(project);
};

export type PlaybackClip = { id: string; assetId: string; in: number; out: number };

/** そのシーンが実際に再生するクリップ。S7 未設定なら S1 の直前。 */
export const playbackClip = (project: Project, sceneKey: SceneKey): PlaybackClip | undefined => {
  if (sceneKey === 'loop') {
    const loop = project.scenes.find((scene) => scene.sceneKey === 'loop');
    const own = project.clips.find((clip) => clip.id === loop?.clipId);
    if (own) return own;
    const lead = loopRangeBeforeHook(project);
    if (lead) return { id: 'loop-before-hook', ...lead };
  }
  const key = playbackSceneKey(project, sceneKey);
  const scene = project.scenes.find((item) => item.sceneKey === key);
  return project.clips.find((clip) => clip.id === scene?.clipId);
};

/** タイムライン項目が実際に再生するクリップ。カット2以降の項目はそのカットのクリップ。 */
export const itemClip = (
  project: Project,
  item: Pick<TimelineItem, 'sceneKey' | 'clipId'>,
): PlaybackClip | undefined => extraCutClipOfItem(project, item) ?? playbackClip(project, item.sceneKey);

/**
 * 同じシーンの項目が連続している区間。テロップ・CTA などはこの区間の時間で動かす。
 * offset はその区間の先頭から、この項目の先頭までの秒。
 */
export const sceneSpanOf = (
  items: TimelineItem[],
  index: number,
): { start: number; duration: number; offset: number } => {
  const item = items[index];
  if (!item) return { start: 0, duration: 0, offset: 0 };
  let first = index;
  while (first > 0 && items[first - 1]?.sceneKey === item.sceneKey) first -= 1;
  let last = index;
  while (last < items.length - 1 && items[last + 1]?.sceneKey === item.sceneKey) last += 1;
  const head = items[first] ?? item;
  const tail = items[last] ?? item;
  return {
    start: head.start,
    duration: Math.max(0, tail.start + tail.duration - head.start),
    offset: Math.max(0, item.start - head.start),
  };
};

/** カットが2本以上あるシーンのカット。1本なら null。 */
const multiCuts = (project: Project, sceneKey: SceneKey): ResolvedCut[] | null => {
  const cuts = sceneCuts(project, sceneKey);
  return cuts.length > 1 ? cuts : null;
};

const cutItemDuration = (cut: ResolvedCut): number => Math.max(MIN_CUT_SEC, cutLength(cut.clip));

const itemFromScene = (
  project: Project,
  sceneKey: SceneKey,
  start: number,
  duration: number,
  presentation: TimelineItem['presentation'] = 'standard',
): TimelineItem => {
  const scene = project.scenes.find((entry) => entry.sceneKey === sceneKey);
  return {
    id: `${presentation}-${sceneKey}-${start}`,
    sceneKey,
    presentation,
    start,
    duration,
    sourceOffset: 0,
    speed: 1,
    layout: scene?.layout916 ?? 'blur-fit',
    transition: 'cut',
    volume: scene?.volume ?? 0.1,
    arrow: null,
  };
};

/** カットが2本以上のシーンを、カットごとの項目へ展開する。同じシーンのカットの間は切り替えだけ。 */
const cutItemsFromScene = (
  project: Project,
  sceneKey: SceneKey,
  start: number,
  cuts: ResolvedCut[],
  baseId?: string,
): TimelineItem[] => {
  let cursor = start;
  const built = itemFromScene(project, sceneKey, start, cutItemDuration(cuts[0] as ResolvedCut));
  const head = baseId ? { ...built, id: baseId } : built;
  const items = cuts.map((cut, index) => {
    const duration = cutItemDuration(cut);
    const item: TimelineItem =
      index === 0
        ? { ...head, duration }
        : {
            ...head,
            id: `${head.id}-${cut.cutId}`,
            clipId: cut.clip.id,
            start: cursor,
            duration,
            transition: 'cut',
          };
    cursor += duration;
    return item;
  });
  return items;
};

const reflow = (timeline: Timeline): Timeline => {
  let start = 0;
  const items = timeline.items.map((item) => {
    const next = { ...item, start };
    start += item.duration;
    return next;
  });
  return { ...timeline, items, durationSec: Math.max(0.1, start) };
};

const withSavedEffectAssignments = (project: Project, timeline: Timeline): Timeline => {
  const saved = project.timeline?.effects;
  if (!saved?.length) return timeline;
  return {
    ...timeline,
    effects: timeline.effects.map((effect) => {
      const previous = saved.find((item) => item.id === effect.id);
      if (!previous?.audioTrackId) return effect;
      return { ...effect, audioTrackId: previous.audioTrackId };
    }),
  };
};

const buildTimelineBody = (project: Project): Timeline => {
  const durations = sceneDurations(project);
  const demoScene = project.scenes.find((scene) => scene.sceneKey === 'demo');
  const includeDemo = Boolean(
    demoScene?.clipId && project.clips.some((clip) => clip.id === demoScene.clipId),
  );
  let start = 0;
  const sceneOrder =
    project.templateParams.sceneOrder?.length > 0
      ? project.templateParams.sceneOrder
      : DEFAULT_SCENE_ORDER;
  const items = sceneOrder
    .filter((sceneKey) => sceneKey !== 'demo' || includeDemo)
    .flatMap((sceneKey) => {
      const cuts = multiCuts(project, sceneKey);
      if (cuts) {
        const cutItems = cutItemsFromScene(project, sceneKey, start, cuts);
        const last = cutItems[cutItems.length - 1];
        if (last) start = last.start + last.duration;
        return cutItems;
      }
      const item = itemFromScene(project, sceneKey, start, durations[sceneKey]);
      start += durations[sceneKey];
      return [item];
    });
  const sceneHeads = items.filter((item, index) => items[index - 1]?.sceneKey !== item.sceneKey);
  const first = items[0];
  const stand = items.find((item) => item.sceneKey === 'stand');
  const aim = items.find((item) => item.sceneKey === 'aim');
  const card = items.find((item) => item.sceneKey === 'card');
  const effects = [
    first
      ? { id: 'impact', label: 'インパクト', audioTrackId: null, start: first.start + 0.15, volume: 0.9 }
      : null,
    stand
      ? { id: 'click-stand', label: 'クリック', audioTrackId: null, start: stand.start, volume: 0.7 }
      : null,
    aim
      ? { id: 'click-aim', label: 'クリック', audioTrackId: null, start: aim.start, volume: 0.7 }
      : null,
    aim
      ? {
          id: 'shutter',
          label: 'シャッター',
          audioTrackId: null,
          start: Math.min(aim.start + 2, aim.start + aim.duration),
          volume: 0.75,
        }
      : null,
    card
      ? { id: 'pop', label: 'ポップ', audioTrackId: null, start: card.start, volume: 0.8 }
      : null,
  ].filter((effect): effect is NonNullable<typeof effect> => effect !== null);
  return {
    durationSec: start,
    items,
    volumePoints: sceneHeads.map((item) => ({
      id: `volume-${item.id}`,
      time: item.start,
      game: item.volume,
      bgm: sceneBgmLevel(project, item.sceneKey),
    })),
    effects,
  };
};

export const buildTimeline = (project: Project): Timeline =>
  withSavedEffectAssignments(project, buildTimelineBody(project));

export const applySceneOrder = (
  project: Project,
  sceneOrder: SceneKey[],
  structureTemplateId?: string,
  ctaDesign?: CtaDesign,
): Project => {
  const unique = sceneOrder.filter(
    (sceneKey, index) => sceneOrder.indexOf(sceneKey) === index,
  );
  const design =
    ctaDesign ??
    BUILTIN_VIDEO_STRUCTURE_TEMPLATES.find((item) => item.id === structureTemplateId)?.ctaDesign ??
    project.templateParams.ctaDesign;
  const enteringShort =
    design === 's4-block' &&
    resolveCtaDesign(project) !== 's4-block' &&
    project.templateParams.s4CtaPurpose === undefined;
  return {
    ...project,
    structureTemplateId,
    timelineEdited: false,
    timeline: null,
    templateParams: {
      ...project.templateParams,
      sceneOrder: unique.length > 0 ? unique : [...DEFAULT_SCENE_ORDER],
      ...(design ? { ctaDesign: design } : {}),
      ...(enteringShort ? { s4CtaPurpose: 'like' as const } : {}),
    },
  };
};

const mediaDurationOf = (project: Project, clip: { assetId: string; out: number }): number =>
  Math.max(0.1, project.assets.find((asset) => asset.id === clip.assetId)?.meta.duration ?? clip.out);

const storedTimeline = (project: Project): Timeline | null =>
  project.timeline ?? (project.timelineEdited ? buildTimeline(project) : null);

/** シーンのクリップ範囲を、タイムラインと手順の尺へ同時に写す。 */
export const rewriteSceneRange = (project: Project, sceneKey: SceneKey): Project => {
  const scene = project.scenes.find((item) => item.sceneKey === sceneKey);
  const clip = project.clips.find((item) => item.id === scene?.clipId);
  if (!scene || !clip) return project;
  return applySceneCutDuration(project, sceneKey, clip.out - clip.in);
};

export const activeTimeline = (project: Project): Timeline =>
  project.timelineEdited && project.timeline ? project.timeline : buildTimeline(project);

/** シーンの最初の項目の尺。カットが複数あるシーンではカット1の尺。 */
export const sceneItemDuration = (project: Project, sceneKey: SceneKey): number => {
  const item = activeTimeline(project).items.find((entry) => entry.sceneKey === sceneKey);
  return item?.duration ?? sceneDurations(project)[sceneKey];
};

/** シーンの項目の尺の合計（カット・分割をすべて含む）。 */
export const sceneTotalDuration = (project: Project, sceneKey: SceneKey): number => {
  const items = activeTimeline(project).items.filter((entry) => entry.sceneKey === sceneKey);
  if (items.length === 0) return sceneDurations(project)[sceneKey];
  return items.reduce((sum, item) => sum + item.duration, 0);
};

/** クリップ全体ではなく、そのシーンが実際に再生する元動画の区間。 */
export const playedSourceWindow = (
  clip: { in: number; out: number },
  placement?: { sourceOffset: number; duration: number; speed: number },
): { in: number; out: number } | null => {
  const start = clip.in + (placement?.sourceOffset ?? 0);
  const speed = placement?.speed && placement.speed > 0 ? placement.speed : 1;
  const played = (placement?.duration ?? Math.max(0, clip.out - clip.in)) * speed;
  const end = Math.min(clip.out, start + played);
  if (!(end > start)) return null;
  return { in: start, out: end };
};

export const rangeForSceneDuration = (
  start: number,
  sceneDuration: number,
  mediaDuration: number,
): { in: number; out: number } => {
  const span = Math.min(Math.max(0.1, sceneDuration), Math.max(0.1, mediaDuration));
  if (mediaDuration <= span) return { in: 0, out: mediaDuration };
  const nextIn = Math.min(Math.max(0, start), mediaDuration - span);
  return { in: nextIn, out: nextIn + span };
};

/** 終了位置を基準に、指定した尺の切り抜き範囲を返す。 */
export const rangeForSceneDurationFromOut = (
  end: number,
  sceneDuration: number,
  mediaDuration: number,
): { in: number; out: number } => {
  const span = Math.min(Math.max(0.1, sceneDuration), Math.max(0.1, mediaDuration));
  if (mediaDuration <= span) return { in: 0, out: mediaDuration };
  const nextOut = Math.min(Math.max(span, end), mediaDuration);
  return { in: nextOut - span, out: nextOut };
};

export const curveValue = (
  points: Timeline['volumePoints'],
  time: number,
  key: 'game' | 'bgm',
): number => {
  const sorted = [...points].sort((left, right) => left.time - right.time);
  const first = sorted[0];
  if (!first) return key === 'game' ? 0.1 : 1;
  if (time <= first.time) return first[key];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current || time > current.time) continue;
    const span = current.time - previous.time;
    const ratio = span === 0 ? 0 : (time - previous.time) / span;
    return previous[key] + (current[key] - previous[key]) * ratio;
  }
  return sorted[sorted.length - 1]?.[key] ?? (key === 'game' ? 0.1 : 1);
};

const nextId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const trimLimits = (
  item: TimelineItem,
  items: TimelineItem[],
): { min: number; max: number } => {
  const siblings = items.filter((entry) => entry.sceneKey === item.sceneKey).length;
  if (item.sceneKey === 'demo') {
    return {
      min: siblings === 1 ? DEMO_DURATION_MIN : 0.2,
      max: STRETCH_MAX,
    };
  }
  return { min: STRETCH_MIN, max: STRETCH_MAX };
};

export const trimTimelineItem = (
  timeline: Timeline,
  itemId: string,
  edge: 'start' | 'end',
  nextDuration: number,
): Timeline => {
  const items = timeline.items.map((item) => {
    if (item.id !== itemId) return item;
    const limits = trimLimits(item, timeline.items);
    let duration = clamp(nextDuration, limits.min, limits.max);
    if (edge === 'end') return { ...item, duration };
    const nextOffset = item.sourceOffset + (item.duration - duration) * item.speed;
    if (nextOffset < 0) {
      duration = clamp(item.duration + item.sourceOffset / item.speed, limits.min, limits.max);
    }
    return {
      ...item,
      duration,
      sourceOffset: Math.max(0, item.sourceOffset + (item.duration - duration) * item.speed),
    };
  });
  return reflow({ ...timeline, items });
};

export const demoDurationFromTimeline = (timeline: Timeline, fallback: number): number => {
  const demos = timeline.items.filter((item) => item.sceneKey === 'demo');
  if (demos.length === 0) return fallback;
  const total = demos.reduce((sum, item) => sum + item.duration, 0);
  return Math.max(DEMO_DURATION_MIN, total);
};

export const withDemoDuration = <T extends Project>(project: T, timeline: Timeline): T => {
  const demoDuration = demoDurationFromTimeline(timeline, project.templateParams.demoDuration);
  if (demoDuration === project.templateParams.demoDuration) return project;
  return {
    ...project,
    templateParams: {
      ...project.templateParams,
      demoDuration,
      sceneDurations: {
        ...project.templateParams.sceneDurations,
        demo: demoDuration,
      },
    },
  };
};

/** そのカットの項目（分割していれば複数）。カット1はカット2以降のクリップを指さない項目。 */
export const cutItemsOf = (
  project: Project,
  timeline: Timeline,
  sceneKey: SceneKey,
  cutId: string,
): TimelineItem[] => {
  const scene = project.scenes.find((entry) => entry.sceneKey === sceneKey);
  const extras = extraCutsOf(scene);
  const cut = cutId === PRIMARY_CUT_ID ? undefined : extras.find((entry) => entry.id === cutId);
  if (cutId !== PRIMARY_CUT_ID && !cut) return [];
  return timeline.items.filter(
    (item) =>
      item.sceneKey === sceneKey &&
      (cut ? item.clipId === cut.clipId : !extras.some((entry) => entry.clipId === item.clipId)),
  );
};

/** カットの長さの合計を、シーンの尺（sceneDurations）へ書く。 */
const withSceneTotalFromCuts = (project: Project, sceneKey: SceneKey): Project => {
  const cuts = sceneCuts(project, sceneKey);
  if (cuts.length === 0) return project;
  const total = clampSceneDuration(
    sceneKey,
    cuts.reduce((sum, cut) => sum + cutItemDuration(cut), 0),
  );
  return {
    ...project,
    templateParams: {
      ...project.templateParams,
      sceneDurations: { ...project.templateParams.sceneDurations, [sceneKey]: total },
    },
  };
};

/**
 * 1本のカットの長さを変え、シーンの尺（合計）とタイムラインへ写す。
 * タイムラインはそのカットの項目が1つのときだけ合わせる（分割済みなら触らない）。
 */
export const applyCutLength = (
  project: Project,
  sceneKey: SceneKey,
  cutId: string,
  seconds: number,
): Project => {
  if (!multiCuts(project, sceneKey)) {
    return cutId === PRIMARY_CUT_ID ? applySceneCutDuration(project, sceneKey, seconds) : project;
  }
  const cut = sceneCuts(project, sceneKey).find((entry) => entry.cutId === cutId);
  if (!cut || !Number.isFinite(seconds)) return project;
  const length = clamp(seconds, MIN_CUT_SEC, STRETCH_MAX);
  const range = rangeForSceneDuration(cut.clip.in, length, mediaDurationOf(project, cut.clip));
  const next = withSceneTotalFromCuts(
    {
      ...project,
      clips: project.clips.map((entry) =>
        entry.id === cut.clip.id ? { ...entry, in: range.in, out: range.out } : entry,
      ),
    },
    sceneKey,
  );
  const timeline = storedTimeline(next);
  if (!timeline) return next;
  const own = cutItemsOf(next, timeline, sceneKey, cutId);
  const item = own[0];
  if (own.length !== 1 || !item) return next.timeline ? next : { ...next, timeline };
  const trimmed = trimTimelineItem(timeline, item.id, 'end', Math.max(MIN_CUT_SEC, range.out - range.in));
  return {
    ...next,
    timeline: {
      ...trimmed,
      items: trimmed.items.map((entry) => (entry.id === item.id ? { ...entry, sourceOffset: 0 } : entry)),
    },
  };
};

/**
 * カットの追加・削除・並べ替え・動画の差し替えのあと、そのシーンの項目だけを作り直す。
 * そのシーンの分割・速度は失われる。ほかのシーンの項目・音量の点・効果音は時刻をずらして残す。
 */
export const rebuildSceneItems = (project: Project, sceneKey: SceneKey): Project => {
  const next = withSceneTotalFromCuts(project, sceneKey);
  const timeline = next.timeline;
  if (!timeline) return next;
  const oldItems = timeline.items;
  const oldScene = oldItems.filter((item) => item.sceneKey === sceneKey);
  const template = oldScene[0];
  if (!template) return next;
  const cuts = multiCuts(next, sceneKey);
  const built = cuts
    ? cutItemsFromScene(next, sceneKey, 0, cuts, template.id)
    : [{ ...itemFromScene(next, sceneKey, 0, sceneDurations(next)[sceneKey]), id: template.id }];
  const fresh = built.map((item, index) => ({
    ...item,
    layout: template.layout,
    volume: template.volume,
    transition: index === 0 ? template.transition : ('cut' as const),
    arrow: index === 0 ? template.arrow : null,
  }));
  const merged: TimelineItem[] = [];
  for (const item of oldItems) {
    if (item.sceneKey !== sceneKey) merged.push(item);
    else if (item === template) merged.push(...fresh);
  }
  const reflowed = reflow({ ...timeline, items: merged });
  const newStart = new Map(reflowed.items.map((item) => [item.id, item.start]));
  const oldTotal = oldScene.reduce((sum, item) => sum + item.duration, 0);
  const newTotal = fresh.reduce((sum, item) => sum + item.duration, 0);
  const sceneStart = newStart.get(template.id) ?? 0;
  const mapTime = (time: number): number => {
    let before = 0;
    for (const item of oldItems) {
      const inside = time >= item.start - 0.0001 && time < item.start + item.duration - 0.0001;
      if (item.sceneKey === sceneKey) {
        if (inside) {
          const ratio = oldTotal > 0 ? (before + time - item.start) / oldTotal : 0;
          return sceneStart + ratio * newTotal;
        }
        before += item.duration;
      } else if (inside) {
        return (newStart.get(item.id) ?? item.start) + (time - item.start);
      }
    }
    return Math.max(0, time + reflowed.durationSec - timeline.durationSec);
  };
  return {
    ...next,
    timeline: {
      ...reflowed,
      volumePoints: timeline.volumePoints.map((point) => ({ ...point, time: mapTime(point.time) })),
      effects: timeline.effects.map((effect) => ({ ...effect, start: mapTime(effect.start) })),
    },
  };
};

/** シーンの再生尺を、手順・クリップ範囲・タイムラインへ同時に保存する。 */
export const applySceneCutDuration = (
  project: Project,
  sceneKey: SceneKey,
  seconds: number,
): Project => {
  if (!TRIM_DURATION_SCENES.includes(sceneKey)) return project;
  // カットが複数あるシーンでは、手順3などの「シーンの尺」はカット1の長さとして扱う
  if (multiCuts(project, sceneKey)) return applyCutLength(project, sceneKey, PRIMARY_CUT_ID, seconds);
  const duration = clampSceneDuration(sceneKey, seconds);
  let next: Project = {
    ...project,
    templateParams: {
      ...project.templateParams,
      sceneDurations: {
        ...project.templateParams.sceneDurations,
        [sceneKey]: duration,
      },
      ...(sceneKey === 'demo' ? { demoDuration: duration } : {}),
    },
  };
  const scene = next.scenes.find((entry) => entry.sceneKey === sceneKey);
  const clip = next.clips.find((entry) => entry.id === scene?.clipId);
  if (clip) {
    const range = rangeForSceneDuration(clip.in, duration, mediaDurationOf(next, clip));
    next = {
      ...next,
      clips: next.clips.map((entry) =>
        entry.id === clip.id ? { ...entry, in: range.in, out: range.out } : entry,
      ),
    };
  }
  const timeline = storedTimeline(next);
  if (!timeline) return next;
  const matches = timeline.items.filter((entry) => entry.sceneKey === sceneKey);
  if (matches.length !== 1) {
    return next.timeline ? next : { ...next, timeline };
  }
  const item = matches[0];
  const trimmed = trimTimelineItem(timeline, item.id, 'end', duration);
  const items = trimmed.items.map((entry) =>
    entry.id === item.id
      ? { ...entry, layout: scene?.layout916 ?? entry.layout, sourceOffset: 0 }
      : entry,
  );
  const nextTimeline = { ...trimmed, items };
  const withTimeline = { ...next, timeline: nextTimeline };
  return sceneKey === 'demo' ? withDemoDuration(withTimeline, nextTimeline) : withTimeline;
};

/** タイムライン上の尺を、手順の sceneDurations とクリップ範囲へ写す。 */
export const syncTimelineDurationsToScenes = (project: Project, timeline: Timeline): Project => {
  const sceneDurationsNext = { ...project.templateParams.sceneDurations };
  let clips = project.clips;
  let demoDuration = project.templateParams.demoDuration;
  for (const sceneKey of TRIM_DURATION_SCENES) {
    const items = timeline.items.filter((item) => item.sceneKey === sceneKey);
    if (items.length === 0) continue;
    const duration = clampSceneDuration(
      sceneKey,
      items.reduce((sum, item) => sum + item.duration, 0),
    );
    sceneDurationsNext[sceneKey] = duration;
    if (sceneKey === 'demo') demoDuration = Math.max(DEMO_DURATION_MIN, duration);
    const cuts = multiCuts({ ...project, clips }, sceneKey);
    if (cuts) {
      // カットごとに、項目が1つで等速・オフセットなしのときだけクリップの範囲を合わせる
      for (const cut of cuts) {
        const own = cutItemsOf(project, timeline, sceneKey, cut.cutId);
        const only = own[0];
        if (own.length !== 1 || !only || only.sourceOffset !== 0 || only.speed !== 1) continue;
        const range = rangeForSceneDuration(cut.clip.in, only.duration, mediaDurationOf(project, cut.clip));
        if (range.in === cut.clip.in && range.out === cut.clip.out) continue;
        clips = clips.map((entry) =>
          entry.id === cut.clip.id ? { ...entry, in: range.in, out: range.out } : entry,
        );
      }
      continue;
    }
    if (items.length !== 1) continue;
    const item = items[0];
    if (item.sourceOffset !== 0 || item.speed !== 1) continue;
    const scene = project.scenes.find((entry) => entry.sceneKey === sceneKey);
    const clip = clips.find((entry) => entry.id === scene?.clipId);
    if (!clip) continue;
    const range = rangeForSceneDuration(clip.in, duration, mediaDurationOf(project, clip));
    if (range.in === clip.in && range.out === clip.out) continue;
    clips = clips.map((entry) =>
      entry.id === clip.id ? { ...entry, in: range.in, out: range.out } : entry,
    );
  }
  return {
    ...project,
    clips,
    timeline,
    templateParams: {
      ...project.templateParams,
      sceneDurations: sceneDurationsNext,
      demoDuration,
    },
  };
};

export const applySceneDurationDefaults = (
  project: Project,
  defaults: Partial<Record<SceneKey, number>>,
): Project => {
  let next = project;
  for (const key of TRIM_DURATION_SCENES) {
    const value = defaults[key];
    if (typeof value !== 'number') continue;
    next = applySceneCutDuration(next, key, value);
  }
  return next;
};

export const applyDemoDurationToProject = (project: Project, seconds: number): Project => {
  const duration = Math.max(DEMO_DURATION_MIN, seconds);
  const withParam: Project = {
    ...project,
    templateParams: {
      ...project.templateParams,
      demoDuration: duration,
    },
  };
  const timeline = storedTimeline(withParam);
  if (!timeline) return withParam;
  const demo = timeline.items.find((item) => item.sceneKey === 'demo');
  if (!demo) return withParam;
  const timelineNext = trimTimelineItem(timeline, demo.id, 'end', duration);
  return withDemoDuration({ ...withParam, timeline: timelineNext }, timelineNext);
};

const removedDurationBefore = (removed: TimelineItem[], time: number): number =>
  removed.reduce(
    (sum, item) => (item.start + item.duration <= time + 0.0001 ? sum + item.duration : sum),
    0,
  );

const insideRemoved = (removed: TimelineItem[], time: number): boolean =>
  removed.some((item) => time >= item.start - 0.0001 && time < item.start + item.duration - 0.0001);

/** シーンをタイムラインから外し、後ろの開始時刻を詰める。 */
export const removeSceneItems = (timeline: Timeline, sceneKey: SceneKey): Timeline => {
  const removed = timeline.items.filter((item) => item.sceneKey === sceneKey);
  if (removed.length === 0) return timeline;
  const items = timeline.items.filter((item) => item.sceneKey !== sceneKey);
  const reflowed = reflow({ ...timeline, items });
  const volumePoints = timeline.volumePoints
    .filter((point) => !insideRemoved(removed, point.time))
    .map((point) => {
      const shift = removedDurationBefore(removed, point.time);
      return shift > 0 ? { ...point, time: point.time - shift } : point;
    });
  const effects = timeline.effects.map((effect) => {
    if (insideRemoved(removed, effect.start)) {
      const host = removed.find(
        (item) => effect.start >= item.start - 0.0001 && effect.start < item.start + item.duration - 0.0001,
      );
      const anchor = host?.start ?? effect.start;
      return { ...effect, start: Math.max(0, anchor - removedDurationBefore(removed, anchor)) };
    }
    const shift = removedDurationBefore(removed, effect.start);
    return shift > 0 ? { ...effect, start: effect.start - shift } : effect;
  });
  return { ...reflowed, volumePoints, effects };
};

/** 指定シーンの直後にシーンを足す。同じシーンが既にあれば何もしない。 */
export const insertSceneItem = (
  project: Project,
  timeline: Timeline,
  sceneKey: SceneKey,
  duration: number,
  afterSceneKey: SceneKey,
): Timeline => {
  if (timeline.items.some((item) => item.sceneKey === sceneKey)) return timeline;
  let afterIndex = -1;
  for (let index = timeline.items.length - 1; index >= 0; index -= 1) {
    if (timeline.items[index]?.sceneKey === afterSceneKey) {
      afterIndex = index;
      break;
    }
  }
  const after = afterIndex >= 0 ? timeline.items[afterIndex] : undefined;
  const at = after ? after.start + after.duration : 0;
  const item = itemFromScene(project, sceneKey, at, duration);
  const items = [...timeline.items];
  items.splice(after ? afterIndex + 1 : 0, 0, item);
  const reflowed = reflow({ ...timeline, items });
  const volumePoints = [
    ...timeline.volumePoints.map((point) =>
      point.time >= at - 0.0001 ? { ...point, time: point.time + duration } : point,
    ),
    {
      id: `volume-${item.id}`,
      time: at,
      game: item.volume,
      bgm: sceneBgmLevel(project, sceneKey),
    },
  ];
  const effects = timeline.effects.map((effect) =>
    effect.start >= at - 0.0001 ? { ...effect, start: effect.start + duration } : effect,
  );
  return { ...reflowed, volumePoints, effects };
};

export const reorderTimelineItem = (timeline: Timeline, from: number, to: number): Timeline => {
  if (from === to || from < 0 || to < 0 || from >= timeline.items.length || to >= timeline.items.length) {
    return timeline;
  }
  const items = [...timeline.items];
  const [item] = items.splice(from, 1);
  if (!item) return timeline;
  items.splice(to, 0, item);
  return reflow({ ...timeline, items });
};

export const splitTimelineItemAt = (timeline: Timeline, itemId: string, time: number): Timeline => {
  const items = timeline.items.flatMap((item) => {
    if (item.id !== itemId) return [item];
    const local = time - item.start;
    if (local < 0.1 || item.duration - local < 0.1) return [item];
    return [
      { ...item, duration: local },
      {
        ...item,
        id: nextId(`${item.id}-split`),
        duration: item.duration - local,
        sourceOffset: item.sourceOffset + local * item.speed,
        transition: 'cut' as const,
      },
    ];
  });
  return reflow({ ...timeline, items });
};

export const setVolumePoint = (
  timeline: Timeline,
  pointId: string,
  key: 'game' | 'bgm',
  value: number,
): Timeline => ({
  ...timeline,
  volumePoints: timeline.volumePoints.map((point) =>
    point.id === pointId ? { ...point, [key]: clamp(value, 0, 1) } : point,
  ),
});

export const setSceneAudioLevel = (
  timeline: Timeline,
  sceneKey: SceneKey,
  key: 'game' | 'bgm',
  value: number,
): Timeline => {
  const next = clamp(value, 0, 1);
  const ranges = timeline.items.filter((item) => item.sceneKey === sceneKey);
  return {
    ...timeline,
    items:
      key === 'game'
        ? timeline.items.map((item) => (item.sceneKey === sceneKey ? { ...item, volume: next } : item))
        : timeline.items,
    volumePoints: timeline.volumePoints.map((point) => {
      const hit = ranges.some(
        (item) =>
          Math.abs(point.time - item.start) < 0.05 ||
          (point.time >= item.start && point.time < item.start + item.duration),
      );
      return hit ? { ...point, [key]: next } : point;
    }),
  };
};

export const addVolumePoint = (
  timeline: Timeline,
  time: number,
  key: 'game' | 'bgm',
  value: number,
): Timeline => {
  const at = Math.max(0, time);
  const existing = timeline.volumePoints.find((point) => Math.abs(point.time - at) < 0.05);
  if (existing) return setVolumePoint(timeline, existing.id, key, value);
  const point: VolumePoint = {
    id: nextId('volume'),
    time: at,
    game: key === 'game' ? clamp(value, 0, 1) : curveValue(timeline.volumePoints, at, 'game'),
    bgm: key === 'bgm' ? clamp(value, 0, 1) : curveValue(timeline.volumePoints, at, 'bgm'),
  };
  return { ...timeline, volumePoints: [...timeline.volumePoints, point] };
};

export const removeVolumePoint = (timeline: Timeline, pointId: string): Timeline => ({
  ...timeline,
  volumePoints: timeline.volumePoints.filter((point) => point.id !== pointId),
});

export const moveEffect = (timeline: Timeline, effectId: string, start: number): Timeline => ({
  ...timeline,
  effects: timeline.effects.map((effect) =>
    effect.id === effectId
      ? { ...effect, start: clamp(start, 0, Math.max(0, timeline.durationSec)) }
      : effect,
  ),
});

export const removeEffect = (timeline: Timeline, effectId: string): Timeline => ({
  ...timeline,
  effects: timeline.effects.filter((effect) => effect.id !== effectId),
});

export const moveTimelineItem = (timeline: Timeline, index: number, direction: -1 | 1): Timeline => {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= timeline.items.length) return timeline;
  const items = [...timeline.items];
  const [item] = items.splice(index, 1);
  if (!item) return timeline;
  items.splice(nextIndex, 0, item);
  return reflow({ ...timeline, items });
};

/** 新規プロジェクトへ入れるときのBGM配置。開始は動画の頭、フェードとダッキングは初期値。 */
export const defaultBgmPlacement = (project: Project, audioTrackId: string): BgmPlacement => ({
  audioTrackId,
  start: 0,
  duration: Math.max(0.1, activeTimeline(project).durationSec),
  offset: 0,
  fadeIn: 0.5,
  fadeOut: 0.5,
  ducking: true,
  gain: 0.02,
});

export const bgmDurationForProject = (project: Project): number => {
  const start = project.audio.bgm?.start ?? 0;
  return Math.max(0.1, activeTimeline(project).durationSec - start);
};

/** ゲーム音の大きさに合わせて BGM を下げる。書き出しの音声合成も同じ式を使う。 */
export const bgmDuckingGain = (seconds: number, project: Project): number => {
  if (!project.audio.bgm?.ducking) return 1;
  for (const item of activeTimeline(project).items) {
    if (seconds >= item.start && seconds < item.start + item.duration) {
      const clip = itemClip(project, item);
      const asset = project.assets.find((item) => item.id === clip?.assetId);
      if (!clip || !asset?.loudnessEnvelope.length) return 1;
      const sourceTime =
        clip.in + item.sourceOffset + Math.max(0, seconds - item.start) * item.speed;
      const pointIndex = Math.min(
        asset.loudnessEnvelope.length - 1,
        Math.max(0, Math.round(sourceTime * 20)),
      );
      const level = asset.loudnessEnvelope[pointIndex]?.level ?? 0;
      const activity = Math.min(1, Math.max(0, (level - 0.08) / 0.35));
      return 1 - activity * 0.6;
    }
  }
  return 1;
};

/** BGM 配置の先頭からの秒数に対する線形ゲイン。フェード、音量曲線、ダッキングを含む。 */
export const bgmPlaybackGain = (project: Project, localSeconds: number): number => {
  const placement = project.audio.bgm;
  if (!placement) return 0;
  const durationSec = bgmDurationForProject(project);
  const globalSeconds = placement.start + localSeconds;
  const fadeIn = placement.fadeIn > 0 ? Math.min(1, localSeconds / placement.fadeIn) : 1;
  const remaining = durationSec - localSeconds;
  const fadeOut = placement.fadeOut > 0 ? Math.min(1, remaining / placement.fadeOut) : 1;
  return (
    (placement.gain ?? 0.02) *
    curveValue(activeTimeline(project).volumePoints, globalSeconds, 'bgm') *
    bgmDuckingGain(globalSeconds, project) *
    Math.max(0, fadeIn) *
    Math.max(0, fadeOut)
  );
};

export const syncBgmToVideo = <T extends Project>(project: T): T => {
  const bgm = project.audio.bgm;
  if (!bgm) return project;
  const video = activeTimeline(project).durationSec;
  const start = Math.min(Math.max(0, bgm.start), Math.max(0, video - 0.1));
  const duration = Math.max(0.1, video - start);
  if (Math.abs(bgm.start - start) < 0.0005 && Math.abs(bgm.duration - duration) < 0.0005) {
    return project;
  }
  return {
    ...project,
    audio: {
      ...project.audio,
      bgm: { ...bgm, start, duration },
    },
  };
};

export const splitTimelineItem = (timeline: Timeline, itemId: string): Timeline => {
  const items = timeline.items.flatMap((item) => {
    if (item.id !== itemId || item.duration < 0.4) return [item];
    const half = item.duration / 2;
    return [
      { ...item, duration: half },
      {
        ...item,
        id: `${item.id}-split`,
        start: item.start + half,
        duration: item.duration - half,
        sourceOffset: item.sourceOffset + half * item.speed,
        transition: 'cut' as const,
      },
    ];
  });
  return reflow({ ...timeline, items });
};
