import { randomId, remapIds, type IdFactory } from './ids';
import { cornerRect, zoomPresets, type Size } from './geometry';
import { mainSegments, sceneDuration } from './render-plan';
import {
  FULL_RECT,
  defaultFrameStyle,
  type Anchor,
  type AvatarEvent,
  type Candidate,
  type Caption,
  type Chapter,
  type ChapterRole,
  type ContentKind,
  type LongProject,
  type MainPlacement,
  type Overlay,
  type Placement,
  type Scene,
  type ScenePurpose,
  type SecondaryPlacement,
  type ShowOrder,
  type ZoomPlacement,
} from './schema';
import { buildChapter, sceneFromSlot, slotsFor, type SlotDef } from './templates';
import { mainSourceAt, syncPairFor } from './sync';
import { localTimeOfSource, sourceTimeAt, type Ticks } from './time';

/**
 * 横動画の編集コマンド。すべて純粋関数で、新しい Project を返す。
 * 1回の操作で複数のモデルが変わっても、呼び出し側は1件の履歴として記録する。
 */

type Draft = LongProject;

export const mutate = (project: LongProject, fn: (draft: Draft) => void): LongProject => {
  const draft = structuredClone(project);
  fn(draft);
  return draft;
};

const findScene = (draft: Draft, sceneId: string): Scene => {
  const scene = draft.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error('シーンが見つかりません');
  return scene;
};

const findChapter = (draft: Draft, chapterId: string): Chapter => {
  const chapter = draft.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error('章が見つかりません');
  return chapter;
};

const findMain = (draft: Draft, placementId: string): MainPlacement => {
  const placement = draft.placements.find((item) => item.id === placementId);
  if (!placement || placement.role !== 'main') throw new Error('主映像が見つかりません');
  return placement;
};

/** シーンに属する配置ID（主＋派生） */
export const scenePlacementIds = (project: LongProject, scene: Scene): string[] => {
  const ids = [...scene.layerIds];
  if (scene.content.kind === 'placement') ids.unshift(scene.content.placementId);
  return ids.filter((placementId) => project.placements.some((item) => item.id === placementId));
};

const anchorPlacementId = (anchor: Anchor): string | null =>
  anchor.kind === 'source' ? anchor.placementId : null;

/** シーンが所有する要素の一覧（削除・複製の対象） */
const ownedBy = (project: LongProject, scene: Scene) => {
  const placementIds = new Set(scenePlacementIds(project, scene));
  const markers = project.markers.filter((marker) => placementIds.has(marker.placementId));
  const markerIds = new Set(markers.map((marker) => marker.id));
  const owns = (item: { sceneId?: string; anchor: Anchor }): boolean => {
    if (item.sceneId === scene.id) return true;
    if (item.sceneId) return false;
    const placementId = anchorPlacementId(item.anchor);
    if (placementId && placementIds.has(placementId)) return true;
    if (item.anchor.kind === 'scene' && item.anchor.sceneId === scene.id) return true;
    if (item.anchor.kind === 'event' && markerIds.has(item.anchor.markerId)) return true;
    return false;
  };
  return {
    placementIds,
    markers,
    syncGroups: project.syncGroups.filter((group) => group.members.some((member) => placementIds.has(member.placementId))),
    captions: project.captions.filter(owns),
    overlays: project.overlays.filter(owns),
    avatarEvents: project.avatarEvents.filter(owns),
    se: project.se.filter(owns),
    ducking: project.ducking.filter(owns),
  };
};

const removeOwned = (draft: Draft, scene: Scene): void => {
  const owned = ownedBy(draft, scene);
  const drop = <T extends { id: string }>(items: T[], removed: { id: string }[]): T[] => {
    const ids = new Set(removed.map((item) => item.id));
    return items.filter((item) => !ids.has(item.id));
  };
  draft.placements = draft.placements.filter((placement) => !owned.placementIds.has(placement.id));
  draft.markers = drop(draft.markers, owned.markers);
  draft.syncGroups = drop(draft.syncGroups, owned.syncGroups);
  draft.captions = drop(draft.captions, owned.captions);
  draft.overlays = drop(draft.overlays, owned.overlays);
  draft.avatarEvents = drop(draft.avatarEvents, owned.avatarEvents);
  draft.se = drop(draft.se, owned.se);
  draft.ducking = drop(draft.ducking, owned.ducking);
};

/** シーンと所有要素を新IDで複製し、内部参照を付け替える */
const cloneSceneGraph = (
  project: LongProject,
  scene: Scene,
  chapterId: string,
  ids: IdFactory,
): {
  scene: Scene;
  placements: Placement[];
  owned: ReturnType<typeof ownedBy>;
  map: Map<string, string>;
} => {
  const owned = ownedBy(project, scene);
  const map = new Map<string, string>();
  map.set(scene.id, ids('scene'));
  for (const placementId of owned.placementIds) map.set(placementId, ids('pl'));
  for (const item of owned.markers) map.set(item.id, ids('mk'));
  for (const item of owned.syncGroups) map.set(item.id, ids('sg'));
  for (const item of owned.captions) map.set(item.id, ids('cap'));
  for (const item of owned.overlays) map.set(item.id, ids('ov'));
  for (const item of owned.avatarEvents) map.set(item.id, ids('av'));
  for (const item of owned.se) map.set(item.id, ids('se'));
  for (const item of owned.ducking) map.set(item.id, ids('dk'));
  const placements = project.placements.filter((placement) => owned.placementIds.has(placement.id));
  // フリーズのIDも新しくする
  const freezeMap = new Map<string, string>();
  for (const placement of placements) {
    if (placement.role === 'main') for (const freeze of placement.freezes) freezeMap.set(freeze.id, ids('fz'));
  }
  const full = new Map([...map, ...freezeMap]);
  const copiedScene = { ...remapIds(scene, full), chapterId };
  return {
    scene: copiedScene,
    placements: remapIds(placements, full),
    owned: remapIds(owned, full) as ReturnType<typeof ownedBy>,
    map: full,
  };
};

const appendOwned = (draft: Draft, owned: ReturnType<typeof ownedBy>): void => {
  draft.markers.push(...owned.markers);
  draft.syncGroups.push(...owned.syncGroups);
  draft.captions.push(...owned.captions);
  draft.overlays.push(...owned.overlays);
  draft.avatarEvents.push(...owned.avatarEvents);
  draft.se.push(...owned.se);
  draft.ducking.push(...owned.ducking);
};

// ---------------------------------------------------------------------------
// 章

export const addChapter = (
  project: LongProject,
  role: ChapterRole,
  options: { contentKind?: ContentKind; showOrder?: ShowOrder; title?: string; at?: number } = {},
  ids: IdFactory = randomId,
): { project: LongProject; chapterId: string } => {
  const setCount = project.chapters.filter((chapter) => chapter.role === 'set').length;
  const built = buildChapter(role, { ...options, index: setCount + 1 }, ids);
  const next = mutate(project, (draft) => {
    draft.chapters.push(built.chapter);
    draft.scenes.push(...built.scenes);
    const at = options.at ?? draft.chapterOrder.length;
    draft.chapterOrder.splice(Math.min(Math.max(0, at), draft.chapterOrder.length), 0, built.chapter.id);
  });
  return { project: next, chapterId: built.chapter.id };
};

export const moveChapter = (project: LongProject, chapterId: string, to: number): LongProject =>
  mutate(project, (draft) => {
    const from = draft.chapterOrder.indexOf(chapterId);
    if (from < 0) return;
    draft.chapterOrder.splice(from, 1);
    draft.chapterOrder.splice(Math.min(Math.max(0, to), draft.chapterOrder.length), 0, chapterId);
  });

export const setChapterEnabled = (project: LongProject, chapterId: string, enabled: boolean): LongProject =>
  mutate(project, (draft) => {
    findChapter(draft, chapterId).enabled = enabled;
  });

export const updateChapter = (
  project: LongProject,
  chapterId: string,
  patch: Partial<Omit<Chapter, 'id' | 'sceneIds'>>,
): LongProject =>
  mutate(project, (draft) => {
    Object.assign(findChapter(draft, chapterId), patch);
  });

export const deleteChapter = (project: LongProject, chapterId: string): LongProject =>
  mutate(project, (draft) => {
    const chapter = findChapter(draft, chapterId);
    for (const sceneId of chapter.sceneIds) {
      const scene = draft.scenes.find((item) => item.id === sceneId);
      if (scene) removeOwned(draft, scene);
    }
    draft.scenes = draft.scenes.filter((scene) => scene.chapterId !== chapterId);
    draft.chapters = draft.chapters.filter((item) => item.id !== chapterId);
    draft.chapterOrder = draft.chapterOrder.filter((item) => item !== chapterId);
    draft.bgm = draft.bgm.filter((item) => item.chapterId !== chapterId);
  });

export const duplicateChapter = (
  project: LongProject,
  chapterId: string,
  ids: IdFactory = randomId,
): { project: LongProject; chapterId: string } => {
  const source = project.chapters.find((item) => item.id === chapterId);
  if (!source) throw new Error('章が見つかりません');
  const newChapterId = ids('chapter');
  const next = mutate(project, (draft) => {
    const sceneIds: string[] = [];
    for (const sceneId of source.sceneIds) {
      const scene = project.scenes.find((item) => item.id === sceneId);
      if (!scene) continue;
      const cloned = cloneSceneGraph(project, scene, newChapterId, ids);
      draft.scenes.push(cloned.scene);
      draft.placements.push(...cloned.placements);
      appendOwned(draft, cloned.owned);
      sceneIds.push(cloned.scene.id);
    }
    draft.chapters.push({
      ...structuredClone(source),
      id: newChapterId,
      title: Object.fromEntries(
        Object.entries(source.title).map(([key, value]) => [key, value ? `${value}（コピー）` : value]),
      ),
      sceneIds,
    });
    const at = draft.chapterOrder.indexOf(chapterId);
    draft.chapterOrder.splice(at < 0 ? draft.chapterOrder.length : at + 1, 0, newChapterId);
  });
  return { project: next, chapterId: newChapterId };
};

export type RebuildDiff = {
  kept: Array<{ sceneId: string; label: string }>;
  added: Array<{ label: string }>;
  removed: Array<{ sceneId: string; label: string; assigned: boolean }>;
};

/**
 * 見せる順番に合わせて章を組み直す。割り当て済みのシーンは役割の順に引き継ぎ、
 * 余ったシーンは削除候補として diff に出す（呼び出し側で確認してから適用）。
 */
export const rebuildChapter = (
  project: LongProject,
  chapterId: string,
  showOrder: ShowOrder,
  ids: IdFactory = randomId,
): { project: LongProject; diff: RebuildDiff } => {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error('章が見つかりません');
  const slots: SlotDef[] = slotsFor(chapter.role, chapter.role === 'set' ? showOrder : null);
  const existing = chapter.sceneIds
    .map((sceneId) => project.scenes.find((scene) => scene.id === sceneId))
    .filter((scene): scene is Scene => Boolean(scene));
  const pool = existing.slice();
  const diff: RebuildDiff = { kept: [], added: [], removed: [] };
  const take = (purpose: ScenePurpose): Scene | undefined => {
    const index = pool.findIndex((scene) => scene.purpose === purpose && scene.content.kind !== 'empty');
    const fallback = index < 0 ? pool.findIndex((scene) => scene.purpose === purpose) : index;
    if (fallback < 0) return undefined;
    return pool.splice(fallback, 1)[0];
  };
  const next = mutate(project, (draft) => {
    const draftChapter = findChapter(draft, chapterId);
    const newIds: string[] = [];
    for (const slot of slots) {
      const reused = take(slot.purpose);
      if (reused) {
        const scene = findScene(draft, reused.id);
        scene.label = slot.label;
        scene.hint = slot.hint;
        newIds.push(scene.id);
        diff.kept.push({ sceneId: scene.id, label: slot.label });
        continue;
      }
      const scene = sceneFromSlot(slot, chapterId, ids);
      draft.scenes.push(scene);
      newIds.push(scene.id);
      diff.added.push({ label: slot.label });
    }
    for (const scene of pool) {
      diff.removed.push({ sceneId: scene.id, label: scene.label, assigned: scene.content.kind !== 'empty' });
      removeOwned(draft, findScene(draft, scene.id));
      draft.scenes = draft.scenes.filter((item) => item.id !== scene.id);
    }
    draftChapter.sceneIds = newIds;
    draftChapter.showOrder = chapter.role === 'set' ? showOrder : draftChapter.showOrder;
  });
  return { project: next, diff };
};

// ---------------------------------------------------------------------------
// シーン

export const addScene = (
  project: LongProject,
  chapterId: string,
  purpose: ScenePurpose,
  options: { label?: string; at?: number; seconds?: number } = {},
  ids: IdFactory = randomId,
): { project: LongProject; sceneId: string } => {
  const scene = sceneFromSlot(
    { purpose, label: options.label ?? '', hint: '', seconds: options.seconds ?? 10 },
    chapterId,
    ids,
  );
  const next = mutate(project, (draft) => {
    const chapter = findChapter(draft, chapterId);
    draft.scenes.push(scene);
    const at = options.at ?? chapter.sceneIds.length;
    chapter.sceneIds.splice(Math.min(Math.max(0, at), chapter.sceneIds.length), 0, scene.id);
  });
  return { project: next, sceneId: scene.id };
};

export const setSceneEnabled = (project: LongProject, sceneId: string, enabled: boolean): LongProject =>
  mutate(project, (draft) => {
    findScene(draft, sceneId).enabled = enabled;
  });

export const updateScene = (
  project: LongProject,
  sceneId: string,
  patch: Partial<Pick<Scene, 'label' | 'purpose' | 'hint' | 'content'>>,
): LongProject =>
  mutate(project, (draft) => {
    Object.assign(findScene(draft, sceneId), patch);
  });

export const moveScene = (project: LongProject, sceneId: string, toChapterId: string, at: number): LongProject =>
  mutate(project, (draft) => {
    const scene = findScene(draft, sceneId);
    const from = findChapter(draft, scene.chapterId);
    from.sceneIds = from.sceneIds.filter((item) => item !== sceneId);
    const to = findChapter(draft, toChapterId);
    to.sceneIds.splice(Math.min(Math.max(0, at), to.sceneIds.length), 0, sceneId);
    scene.chapterId = toChapterId;
  });

export const deleteScene = (project: LongProject, sceneId: string): LongProject =>
  mutate(project, (draft) => {
    const scene = findScene(draft, sceneId);
    removeOwned(draft, scene);
    draft.scenes = draft.scenes.filter((item) => item.id !== sceneId);
    for (const chapter of draft.chapters) chapter.sceneIds = chapter.sceneIds.filter((item) => item !== sceneId);
  });

export const duplicateScene = (
  project: LongProject,
  sceneId: string,
  ids: IdFactory = randomId,
): { project: LongProject; sceneId: string } => {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error('シーンが見つかりません');
  const cloned = cloneSceneGraph(project, scene, scene.chapterId, ids);
  const next = mutate(project, (draft) => {
    draft.scenes.push(cloned.scene);
    draft.placements.push(...cloned.placements);
    appendOwned(draft, cloned.owned);
    const chapter = findChapter(draft, scene.chapterId);
    const at = chapter.sceneIds.indexOf(sceneId);
    chapter.sceneIds.splice(at + 1, 0, cloned.scene.id);
  });
  return { project: next, sceneId: cloned.scene.id };
};

// ---------------------------------------------------------------------------
// 素材の割り当て・差し替え・範囲

export const assignCandidate = (
  project: LongProject,
  sceneId: string,
  candidate: Candidate,
  ids: IdFactory = randomId,
): LongProject =>
  assignRange(project, sceneId, { assetId: candidate.assetId, sourceIn: candidate.in, sourceOut: candidate.out, candidateId: candidate.id, markers: candidate.markers }, ids);

export const assignRange = (
  project: LongProject,
  sceneId: string,
  range: {
    assetId: string;
    sourceIn: Ticks;
    sourceOut: Ticks;
    candidateId?: string;
    markers?: Candidate['markers'];
  },
  ids: IdFactory = randomId,
): LongProject =>
  mutate(project, (draft) => {
    const scene = findScene(draft, sceneId);
    const asset = draft.assets.find((item) => item.id === range.assetId);
    if (!asset) throw new Error('素材が見つかりません');
    if (!(range.sourceOut > range.sourceIn)) throw new Error('OUT は IN より後にしてください');
    const defaultAudio = (asset.probe?.audioStreams ?? [])
      .filter((stream) => stream.role !== 'unused' && stream.role !== 'secondary')
      .filter((stream, index, all) => {
        // 役割が未設定なら先頭のストリームだけを既定にする
        if (all.some((item) => item.role)) return stream.role !== 'mixed' || !all.some((item) => item.role === 'game' || item.role === 'voice');
        return index === 0;
      })
      .map((stream) => ({ audioIndex: stream.audioIndex, gainDb: 0, muted: false }));
    if (scene.content.kind === 'placement') {
      // 差し替え：素材時刻に結び付いたマーカーは再確認対象にし、推測で付け替えない
      const { placementId } = scene.content;
      const placement = findMain(draft, placementId);
      const replaced = placement.assetId !== range.assetId || placement.sourceIn !== range.sourceIn;
      placement.assetId = range.assetId;
      placement.candidateId = range.candidateId;
      placement.sourceIn = range.sourceIn;
      placement.sourceOut = range.sourceOut;
      placement.freezes = placement.freezes.filter((freeze) => freeze.at >= range.sourceIn && freeze.at <= range.sourceOut);
      if (replaced) {
        placement.audio = defaultAudio;
        for (const marker of draft.markers) if (marker.placementId === placementId) marker.needsReview = true;
      }
      return;
    }
    const placementId = ids('pl');
    const placement: MainPlacement = {
      id: placementId,
      sceneId,
      role: 'main',
      assetId: range.assetId,
      candidateId: range.candidateId,
      sourceIn: range.sourceIn,
      sourceOut: range.sourceOut,
      speed: 1,
      freezes: [],
      audio: defaultAudio,
      muteDuringSlow: false,
      fadeIn: 0,
      fadeOut: 0,
      crop: FULL_RECT,
      cropAspect: 'source',
      cropLocked: true,
      rect: FULL_RECT,
      rectAspect: 'free',
      rectLocked: false,
      fit: 'contain',
      style: defaultFrameStyle(),
      z: 0,
      label: {},
      showLabel: false,
    };
    draft.placements.push(placement);
    scene.content = { kind: 'placement', placementId };
    for (const marker of range.markers ?? []) {
      if (marker.ticks < range.sourceIn || marker.ticks > range.sourceOut) continue;
      draft.markers.push({ id: ids('mk'), kind: marker.kind, placementId, at: marker.ticks, label: marker.label, needsReview: false });
    }
  });

/** 割り当てを外して未割当の枠に戻す（所有要素は残し、参照切れは診断で示す） */
export const unassignScene = (project: LongProject, sceneId: string): LongProject =>
  mutate(project, (draft) => {
    const scene = findScene(draft, sceneId);
    if (scene.content.kind !== 'placement') return;
    const duration = sceneDuration(project, project.scenes.find((item) => item.id === sceneId)!);
    const placementIds = new Set([scene.content.placementId, ...scene.layerIds]);
    draft.placements = draft.placements.filter((placement) => !placementIds.has(placement.id));
    draft.syncGroups = draft.syncGroups.filter((group) => !group.members.some((member) => placementIds.has(member.placementId)));
    scene.layerIds = [];
    scene.content = { kind: 'empty', plannedDuration: Math.max(1, duration) };
  });

/** トリム。範囲外になったアンカーは移動せず、診断で知らせる。 */
export const setPlacementRange = (
  project: LongProject,
  placementId: string,
  sourceIn: Ticks,
  sourceOut: Ticks,
): LongProject =>
  mutate(project, (draft) => {
    if (!(sourceOut > sourceIn) || sourceIn < 0) throw new Error('範囲が不正です');
    const placement = findMain(draft, placementId);
    const asset = draft.assets.find((item) => item.id === placement.assetId);
    const max = asset?.probe?.durationTicks;
    placement.sourceIn = sourceIn;
    placement.sourceOut = max ? Math.min(sourceOut, max) : sourceOut;
  });

export const setSpeed = (project: LongProject, placementId: string, speed: number): LongProject =>
  mutate(project, (draft) => {
    if (!(speed >= 0.25 && speed <= 4)) throw new Error('速度は 0.25〜4 倍です');
    findMain(draft, placementId).speed = speed;
  });

export const addFreeze = (
  project: LongProject,
  placementId: string,
  at: Ticks,
  duration: Ticks,
  ids: IdFactory = randomId,
): LongProject =>
  mutate(project, (draft) => {
    const placement = findMain(draft, placementId);
    if (at < placement.sourceIn || at > placement.sourceOut) throw new Error('フリーズの位置が範囲外です');
    if (duration <= 0) throw new Error('フリーズの長さが不正です');
    placement.freezes.push({ id: ids('fz'), at, duration });
  });

export const removeFreeze = (project: LongProject, placementId: string, freezeId: string): LongProject =>
  mutate(project, (draft) => {
    const placement = findMain(draft, placementId);
    placement.freezes = placement.freezes.filter((freeze) => freeze.id !== freezeId);
  });

export const updatePlacement = (
  project: LongProject,
  placementId: string,
  patch: Partial<Placement>,
): LongProject =>
  mutate(project, (draft) => {
    const placement = draft.placements.find((item) => item.id === placementId);
    if (!placement) throw new Error('配置が見つかりません');
    Object.assign(placement, patch, { id: placement.id, role: placement.role, sceneId: placement.sceneId });
  });

// ---------------------------------------------------------------------------
// 分割

/**
 * シーンを主配置の出力時刻 at で分割する。
 * 境界上の単発イベント（マーカー）は後半に所属させ、二重発火させない。
 */
export const splitScene = (
  project: LongProject,
  sceneId: string,
  at: Ticks,
  ids: IdFactory = randomId,
): { project: LongProject; sceneId: string } => {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene || scene.content.kind !== 'placement') throw new Error('分割できるのは素材を割り当てたシーンだけです');
  const { placementId } = scene.content;
  const main = project.placements.find((item): item is MainPlacement => item.id === placementId && item.role === 'main');
  if (!main) throw new Error('主映像が見つかりません');
  const segments = mainSegments(main);
  const total = segments.length ? segments[segments.length - 1]!.end : 0;
  if (at <= 0 || at >= total) throw new Error('分割位置が範囲外です');
  const splitSource = sourceTimeAt(segments, at);
  if (splitSource === null) throw new Error('分割位置が範囲外です');
  const inFreeze = segments.find((segment) => segment.kind === 'freeze' && at > segment.start && at < segment.end);
  if (inFreeze) throw new Error('フリーズの途中では分割できません。フリーズの前後で分割してください');

  const newSceneId = ids('scene');
  const newMainId = ids('pl');
  const next = mutate(project, (draft) => {
    const left = findMain(draft, placementId);
    const right: MainPlacement = {
      ...structuredClone(left),
      id: newMainId,
      sceneId: newSceneId,
      sourceIn: splitSource,
      freezes: left.freezes.filter((freeze) => freeze.at >= splitSource).map((freeze) => ({ ...freeze, id: ids('fz') })),
    };
    left.sourceOut = splitSource;
    left.freezes = left.freezes.filter((freeze) => freeze.at < splitSource);
    draft.placements.push(right);

    const sourceScene = findScene(draft, sceneId);
    const map = new Map<string, string>([[placementId, newMainId]]);
    const rightLayers: string[] = [];
    for (const layerId of sourceScene.layerIds) {
      const layer = draft.placements.find((item) => item.id === layerId);
      if (!layer) continue;
      if (layer.role === 'zoom') {
        // 表示区間を左右へ分配
        if (layer.end <= at) continue;
        if (layer.start >= at) {
          const moved = { ...structuredClone(layer), id: ids('pl'), sceneId: newSceneId, parentId: newMainId, start: layer.start - at, end: layer.end - at };
          draft.placements.push(moved);
          rightLayers.push(moved.id);
          draft.placements = draft.placements.filter((item) => item.id !== layer.id);
          sourceScene.layerIds = sourceScene.layerIds.filter((item) => item !== layer.id);
          continue;
        }
        const copy = { ...structuredClone(layer), id: ids('pl'), sceneId: newSceneId, parentId: newMainId, start: 0, end: layer.end - at };
        layer.end = at;
        draft.placements.push(copy);
        rightLayers.push(copy.id);
        continue;
      }
      if (layer.role === 'secondary') {
        const groupId = ids('sg');
        const copy: SecondaryPlacement = {
          ...structuredClone(layer),
          id: ids('pl'),
          sceneId: newSceneId,
          parentId: newMainId,
          syncGroupId: groupId,
          visible: layer.visible
            .filter((range) => range.end > at)
            .map((range) => ({ start: Math.max(0, range.start - at), end: range.end - at })),
        };
        layer.visible = layer.visible
          .filter((range) => range.start < at)
          .map((range) => ({ start: range.start, end: Math.min(at, range.end) }));
        const group = draft.syncGroups.find((item) => item.id === layer.syncGroupId);
        if (group) {
          draft.syncGroups.push({
            ...structuredClone(group),
            id: groupId,
            members: group.members.map((member) => ({
              placementId: member.placementId === placementId ? newMainId : member.placementId === layer.id ? copy.id : member.placementId,
              syncAt: member.syncAt,
            })),
            checks: [],
          });
        }
        map.set(layer.id, copy.id);
        draft.placements.push(copy);
        rightLayers.push(copy.id);
      }
    }

    // マーカー：分割位置以降（境界を含む）は後半へ
    for (const marker of draft.markers) {
      if (marker.placementId === placementId && marker.at >= splitSource) marker.placementId = newMainId;
    }
    const leftDuration = at;
    const moveAnchor = (item: { anchor: Anchor; sceneId?: string }): void => {
      const { anchor } = item;
      if (anchor.kind === 'source' && map.has(anchor.placementId)) {
        let mainSource: Ticks | null = anchor.placementId === placementId ? anchor.ticks : null;
        if (mainSource === null) {
          // 副視点の素材時刻は同期点を通して主の素材時刻へ写す
          const layer = project.placements.find((item) => item.id === anchor.placementId);
          const group = layer?.role === 'secondary' ? project.syncGroups.find((item) => item.id === layer.syncGroupId) : undefined;
          const pair = group ? syncPairFor(group, placementId, anchor.placementId) : null;
          mainSource = pair ? mainSourceAt(anchor.ticks, pair) : null;
        }
        const local = mainSource === null ? null : localTimeOfSource(segments, mainSource);
        const goesRight = mainSource !== null && (mainSource >= splitSource || (local !== null && local >= at));
        if (goesRight) {
          anchor.placementId = map.get(anchor.placementId)!;
          if (item.sceneId === sceneId) item.sceneId = newSceneId;
        }
      } else if (anchor.kind === 'scene' && anchor.sceneId === sceneId && anchor.offset >= leftDuration) {
        anchor.sceneId = newSceneId;
        anchor.offset -= leftDuration;
        if (item.sceneId === sceneId) item.sceneId = newSceneId;
      }
    };
    for (const list of [draft.captions, draft.overlays, draft.avatarEvents, draft.se, draft.ducking] as Array<Array<{ anchor: Anchor; sceneId?: string }>>) {
      for (const item of list) moveAnchor(item);
    }

    const newScene: Scene = {
      ...structuredClone(sourceScene),
      id: newSceneId,
      label: sourceScene.label ? `${sourceScene.label}（後半）` : '',
      content: { kind: 'placement', placementId: newMainId },
      layerIds: rightLayers,
    };
    draft.scenes.push(newScene);
    const chapter = findChapter(draft, sourceScene.chapterId);
    chapter.sceneIds.splice(chapter.sceneIds.indexOf(sceneId) + 1, 0, newSceneId);
  });
  return { project: next, sceneId: newSceneId };
};

// ---------------------------------------------------------------------------
// リプレイ

export type ReplayOptions = {
  speed?: number;
  sourceIn?: Ticks;
  sourceOut?: Ticks;
  copy?: { captions?: boolean; se?: boolean; avatar?: boolean; cutin?: boolean };
};

/** 元素材から独立した配置としてリプレイを作る。既定は字幕・SE等をコピーせず、原音はミュート */
export const createReplay = (
  project: LongProject,
  sceneId: string,
  options: ReplayOptions = {},
  ids: IdFactory = randomId,
): { project: LongProject; sceneId: string } => {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene || scene.content.kind !== 'placement') throw new Error('リプレイは素材を割り当てたシーンから作れます');
  const { placementId } = scene.content;
  const source = project.placements.find((item): item is MainPlacement => item.id === placementId && item.role === 'main');
  if (!source) throw new Error('主映像が見つかりません');
  const newSceneId = ids('scene');
  const newPlacementId = ids('pl');
  const sourceIn = options.sourceIn ?? source.sourceIn;
  const sourceOut = options.sourceOut ?? source.sourceOut;
  const next = mutate(project, (draft) => {
    const placement: MainPlacement = {
      ...structuredClone(source),
      id: newPlacementId,
      sceneId: newSceneId,
      sourceIn,
      sourceOut,
      speed: options.speed ?? 0.5,
      freezes: [],
      audio: source.audio.map((use) => ({ ...use, muted: true })),
      muteDuringSlow: true,
    };
    draft.placements.push(placement);
    const copy = options.copy ?? {};
    const markerMap = new Map<string, string>();
    for (const marker of project.markers.filter((item) => item.placementId === placementId)) {
      if (marker.at < sourceIn || marker.at > sourceOut) continue;
      const id = ids('mk');
      markerMap.set(marker.id, id);
      draft.markers.push({ ...marker, id, placementId: newPlacementId });
    }
    const retarget = <T extends { id: string; anchor: Anchor; sceneId?: string }>(item: T, prefix: string): T | null => {
      const anchor = item.anchor;
      let nextAnchor: Anchor | null = null;
      if (anchor.kind === 'source' && anchor.placementId === placementId) nextAnchor = { ...anchor, placementId: newPlacementId };
      else if (anchor.kind === 'event' && markerMap.has(anchor.markerId)) nextAnchor = { ...anchor, markerId: markerMap.get(anchor.markerId)! };
      if (!nextAnchor) return null;
      return { ...structuredClone(item), id: ids(prefix), anchor: nextAnchor, sceneId: newSceneId };
    };
    if (copy.captions) {
      for (const caption of project.captions) {
        const copied = retarget(caption, 'cap');
        if (copied) draft.captions.push(copied);
      }
    }
    if (copy.se) {
      for (const item of project.se) {
        const copied = retarget(item, 'se');
        if (copied) draft.se.push(copied);
      }
    }
    if (copy.avatar) {
      for (const item of project.avatarEvents) {
        const copied = retarget(item, 'av');
        if (copied) draft.avatarEvents.push(copied);
      }
    }
    if (copy.cutin) {
      for (const item of project.overlays.filter((overlay) => overlay.kind === 'cutin')) {
        const copied = retarget(item, 'ov');
        if (copied) draft.overlays.push(copied);
      }
    }
    const newScene: Scene = {
      id: newSceneId,
      chapterId: scene.chapterId,
      purpose: 'replay',
      label: `リプレイ：${scene.label || 'シーン'}`,
      hint: '',
      enabled: true,
      content: { kind: 'placement', placementId: newPlacementId },
      layerIds: [],
      replayOf: sceneId,
    };
    draft.scenes.push(newScene);
    const chapter = findChapter(draft, scene.chapterId);
    chapter.sceneIds.splice(chapter.sceneIds.indexOf(sceneId) + 1, 0, newSceneId);
  });
  return { project: next, sceneId: newSceneId };
};

// ---------------------------------------------------------------------------
// 副視点・拡大小窓

export const addSecondary = (
  project: LongProject,
  mainPlacementId: string,
  assetId: string,
  sync: { mainAt: Ticks; secondaryAt: Ticks },
  ids: IdFactory = randomId,
): { project: LongProject; placementId: string } => {
  const placementId = ids('pl');
  const groupId = ids('sg');
  const next = mutate(project, (draft) => {
    const main = findMain(draft, mainPlacementId);
    const scene = findScene(draft, main.sceneId);
    if (scene.layerIds.some((layerId) => draft.placements.find((item) => item.id === layerId)?.role === 'secondary')) {
      throw new Error('副視点は1シーンに1つまでです（H1）');
    }
    const asset = draft.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error('素材が見つかりません');
    const secondary: SecondaryPlacement = {
      id: placementId,
      sceneId: scene.id,
      role: 'secondary',
      assetId,
      parentId: mainPlacementId,
      syncGroupId: groupId,
      layout: 'corner',
      corner: 'tr',
      splitRatio: 0.5,
      visible: [],
      gapPolicy: 'hide-main-full',
      swapped: false,
      audio: (asset.probe?.audioStreams ?? []).slice(0, 1).map((stream) => ({ audioIndex: stream.audioIndex, gainDb: 0, muted: true })),
      crop: FULL_RECT,
      cropAspect: 'source',
      cropLocked: true,
      rect: cornerRect('tr'),
      rectAspect: 'source',
      rectLocked: true,
      fit: 'contain',
      style: { ...defaultFrameStyle(), borderWidth: 4 },
      z: 10,
      label: { ja: '受ける側', en: 'Enemy view' },
      showLabel: true,
    };
    draft.placements.push(secondary);
    scene.layerIds.push(placementId);
    draft.syncGroups.push({
      id: groupId,
      members: [
        { placementId: mainPlacementId, syncAt: sync.mainAt },
        { placementId, syncAt: sync.secondaryAt },
      ],
      linked: true,
      reference: false,
      checks: [],
    });
  });
  return { project: next, placementId };
};

export const setSyncPoints = (
  project: LongProject,
  groupId: string,
  points: Array<{ placementId: string; syncAt: Ticks }>,
): LongProject =>
  mutate(project, (draft) => {
    const group = draft.syncGroups.find((item) => item.id === groupId);
    if (!group) throw new Error('同期グループが見つかりません');
    for (const point of points) {
      const member = group.members.find((item) => item.placementId === point.placementId);
      if (!member) throw new Error('同期グループの対象ではありません');
      if (point.syncAt < 0) throw new Error('同期点が不正です');
      member.syncAt = point.syncAt;
    }
  });

/**
 * 同期リンクの解除・再リンク。同期点は残す。
 * 解除中の副視点は、主の速度・フリーズ・トリムに追従せず、シーン先頭の同期位置から等速で再生する。
 */
export const setSyncLinked = (project: LongProject, groupId: string, linked: boolean): LongProject =>
  mutate(project, (draft) => {
    const group = draft.syncGroups.find((item) => item.id === groupId);
    if (!group) throw new Error('同期グループが見つかりません');
    group.linked = linked;
  });

/** 主配置にリンク中の副視点があるか（片側だけの変更がグループ全体に及ぶことを示すため） */
export const linkedSecondaryOf = (project: LongProject, mainPlacementId: string): string | undefined => {
  for (const placement of project.placements) {
    if (placement.role !== 'secondary' || placement.parentId !== mainPlacementId) continue;
    const group = project.syncGroups.find((item) => item.id === placement.syncGroupId);
    if (group?.linked) return placement.id;
  }
  return undefined;
};

/** 主副の交換：表示枠の役割だけを交換する（素材・同期点・切り抜き・音声は変えない） */
export const swapSecondary = (project: LongProject, secondaryId: string): LongProject =>
  mutate(project, (draft) => {
    const placement = draft.placements.find((item) => item.id === secondaryId);
    if (!placement || placement.role !== 'secondary') throw new Error('副視点が見つかりません');
    placement.swapped = !placement.swapped;
  });

export const addZoom = (
  project: LongProject,
  mainPlacementId: string,
  presetId: string,
  range: { start: Ticks; end: Ticks },
  ids: IdFactory = randomId,
): { project: LongProject; placementId: string } => {
  const placementId = ids('pl');
  const next = mutate(project, (draft) => {
    const main = findMain(draft, mainPlacementId);
    const scene = findScene(draft, main.sceneId);
    const asset = draft.assets.find((item) => item.id === main.assetId);
    const size: Size = { w: asset?.probe?.width || 1920, h: asset?.probe?.height || 1080 };
    const preset = zoomPresets(size).find((item) => item.id === presetId) ?? zoomPresets(size)[0]!;
    const zoom: ZoomPlacement = {
      id: placementId,
      sceneId: scene.id,
      role: 'zoom',
      parentId: mainPlacementId,
      mode: 'window',
      start: range.start,
      end: range.end,
      preset: preset.id,
      crop: preset.crop,
      cropAspect: preset.cropAspect,
      cropLocked: true,
      rect: preset.rect,
      rectAspect: preset.cropAspect,
      rectLocked: true,
      fit: 'contain',
      style: { ...defaultFrameStyle(), borderWidth: 4, borderColor: '#E8C547' },
      z: 20,
      label: {},
      showLabel: false,
    };
    draft.placements.push(zoom);
    scene.layerIds.push(placementId);
  });
  return { project: next, placementId };
};

export const removeLayer = (project: LongProject, placementId: string): LongProject =>
  mutate(project, (draft) => {
    const placement = draft.placements.find((item) => item.id === placementId);
    if (!placement || placement.role === 'main') return;
    draft.placements = draft.placements.filter((item) => item.id !== placementId);
    for (const scene of draft.scenes) scene.layerIds = scene.layerIds.filter((item) => item !== placementId);
    if (placement.role === 'secondary') draft.syncGroups = draft.syncGroups.filter((group) => group.id !== placement.syncGroupId);
    draft.markers = draft.markers.filter((marker) => marker.placementId !== placementId);
  });

// ---------------------------------------------------------------------------
// 字幕・図形・アバター

export const upsert = <K extends 'captions' | 'overlays' | 'avatarEvents' | 'se' | 'ducking' | 'bgm' | 'markers'>(
  project: LongProject,
  key: K,
  item: LongProject[K][number],
): LongProject =>
  mutate(project, (draft) => {
    const list = draft[key] as Array<{ id: string }>;
    const index = list.findIndex((entry) => entry.id === item.id);
    if (index < 0) list.push(structuredClone(item));
    else list[index] = structuredClone(item);
  });

export const removeItem = (
  project: LongProject,
  key: 'captions' | 'overlays' | 'avatarEvents' | 'se' | 'ducking' | 'bgm' | 'markers' | 'candidates' | 'lineups',
  id: string,
): LongProject =>
  mutate(project, (draft) => {
    (draft[key] as Array<{ id: string }>) = (draft[key] as Array<{ id: string }>).filter((entry) => entry.id !== id);
  });

/**
 * 表情イベントを置く。同じ区間に既存の表情があれば、上書き（既存を切る・分割する）で解決する。
 * 時刻はシーン相対アンカーの場合だけ自動解決できる。それ以外は重なりを診断に任せる。
 */
export const placeAvatarEvent = (project: LongProject, event: AvatarEvent, ids: IdFactory = randomId): LongProject =>
  mutate(project, (draft) => {
    const others: AvatarEvent[] = [];
    if (event.anchor.kind === 'scene') {
      const { sceneId, offset } = event.anchor;
      const start = offset;
      const end = offset + event.duration;
      for (const item of draft.avatarEvents) {
        if (item.id === event.id) continue;
        if (item.anchor.kind !== 'scene' || item.anchor.sceneId !== sceneId) {
          others.push(item);
          continue;
        }
        const s = item.anchor.offset;
        const e = s + item.duration;
        if (e <= start || s >= end) {
          others.push(item);
          continue;
        }
        if (s < start) others.push({ ...item, duration: start - s });
        if (e > end) others.push({ ...item, id: s < start ? ids('av') : item.id, anchor: { kind: 'scene', sceneId, offset: end }, duration: e - end });
      }
      draft.avatarEvents = others;
    } else {
      draft.avatarEvents = draft.avatarEvents.filter((item) => item.id !== event.id);
    }
    draft.avatarEvents.push(structuredClone(event));
  });

/** 見せ場マーカーに対する予告カットイン（初期例：1.2秒前に開始・0.7秒表示） */
export const addCutIn = (
  project: LongProject,
  markerId: string,
  assetId: string,
  options: { lead?: Ticks; duration?: Ticks; seTrackId?: string } = {},
  ids: IdFactory = randomId,
): { project: LongProject; overlayId: string } => {
  const overlayId = ids('ov');
  const marker = project.markers.find((item) => item.id === markerId);
  if (!marker) throw new Error('見せ場マーカーが見つかりません');
  const placement = project.placements.find((item) => item.id === marker.placementId);
  const overlay: Overlay = {
    id: overlayId,
    kind: 'cutin',
    anchor: { kind: 'event', markerId, offset: -(options.lead ?? 144_000) },
    duration: options.duration ?? 84_000,
    target: 'screen',
    rect: { x: -0.02, y: 0.3, w: 1.04, h: 0.4 },
    color: '#FF4655',
    strokeWidth: 8,
    assetId,
    text: {},
    motion: 'pop',
    seTrackId: options.seTrackId,
    seGainDb: 0,
    sceneId: placement?.sceneId,
  };
  return { project: upsert(project, 'overlays', overlay), overlayId };
};

/** 見せ場の前後プレビュー区間（全体時刻）：開始の3秒前〜2秒後 */
export const HIGHLIGHT_PREVIEW = { before: 360_000, after: 240_000 };

export const captionDraft = (
  ids: IdFactory,
  kind: Caption['kind'],
  anchor: Anchor,
  duration: Ticks,
  sceneId?: string,
): Caption => ({
  id: ids('cap'),
  kind,
  anchor,
  duration,
  text: {},
  excluded: [],
  style:
    kind === 'speech'
      ? { preset: 'subtitle', x: 0.5, y: 0.88, width: 0.8, size: 46, align: 'center', color: '#FFFFFF', accent: '#FF4655', background: false }
      : kind === 'explain'
        ? { preset: 'explain', x: 0.3, y: 0.12, width: 0.5, size: 44, align: 'left', color: '#FFFFFF', accent: '#FF4655', background: true }
        : { preset: 'reaction', x: 0.5, y: 0.45, width: 0.5, size: 72, align: 'center', color: '#FFE08A', accent: '#FF4655', background: false },
  sceneId,
});

/**
 * 要素を時間方向に動かす。アンカーの種類は変えず、オフセット（素材基準なら素材時刻）だけを変える。
 * 素材基準のアンカーは配置の速度で素材時刻へ換算する。
 */
export const shiftAnchor = (project: LongProject, anchor: Anchor, deltaTicks: Ticks): Anchor => {
  switch (anchor.kind) {
    case 'project':
      return { ...anchor, ticks: Math.max(0, anchor.ticks + deltaTicks) };
    case 'scene':
    case 'chapter':
    case 'event':
      return { ...anchor, offset: anchor.offset + deltaTicks };
    case 'source': {
      const placement = project.placements.find((item) => item.id === anchor.placementId);
      const main =
        placement?.role === 'main'
          ? placement
          : placement
            ? project.placements.find((item): item is MainPlacement => item.role === 'main' && item.id === placement.parentId)
            : undefined;
      const speed = main?.speed ?? 1;
      return { ...anchor, ticks: Math.max(0, anchor.ticks + Math.round(deltaTicks * speed)) };
    }
  }
};

export type TimedKey = 'captions' | 'overlays' | 'avatarEvents' | 'se' | 'ducking' | 'bgm';

export const moveTimed = (project: LongProject, key: TimedKey, id: string, deltaTicks: Ticks): LongProject =>
  mutate(project, (draft) => {
    const list = draft[key] as Array<{ id: string; anchor: Anchor }>;
    const item = list.find((entry) => entry.id === id);
    if (item) item.anchor = shiftAnchor(project, item.anchor, deltaTicks);
  });

export const resizeTimed = (project: LongProject, key: Exclude<TimedKey, 'se'>, id: string, duration: Ticks): LongProject =>
  mutate(project, (draft) => {
    const list = draft[key] as Array<{ id: string; duration: Ticks }>;
    const item = list.find((entry) => entry.id === id);
    if (item) item.duration = Math.max(12_000, duration);
  });
