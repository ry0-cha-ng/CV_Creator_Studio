import { retargetSceneVideo } from './guide';
import {
  MAX_CUTS_PER_SCENE,
  NEW_CUT_SEC,
  PRIMARY_CUT_ID,
  clipUsageCount,
  cutCrop,
  extraCutsOf,
  isMultiCutScene,
  sceneCrop,
  sceneCuts,
  type CutCrop,
} from './scene-cuts';
import type { Project, Scene, SceneCut, SceneKey } from './schema/project';
import { applyCutLength, rangeForSceneDuration, rebuildSceneItems } from './timeline';

/**
 * シーン内のカットの操作。どれも Project を受け取って新しい Project を返す。
 * 構造が変わる操作（追加・削除・並べ替え・動画の差し替え）は、最後にそのシーンの項目を作り直す。
 */

const randomId = (): string => globalThis.crypto.randomUUID();

const mediaDuration = (project: Project, assetId: string, fallback: number): number =>
  Math.max(0.1, project.assets.find((asset) => asset.id === assetId)?.meta.duration ?? fallback);

/** シーンだけを差し替えた Project。 */
const withScene = (project: Project, sceneKey: SceneKey, patch: (scene: Scene) => Scene): Project => ({
  ...project,
  scenes: project.scenes.map((scene) => (scene.sceneKey === sceneKey ? patch(scene) : scene)),
});

/** どのカットも使っていないクリップを消す。 */
const dropUnusedClips = (project: Project, clipIds: string[]): Project => {
  const unused = new Set(clipIds.filter((id) => clipUsageCount(project, id) === 0));
  if (unused.size === 0) return project;
  return { ...project, clips: project.clips.filter((clip) => !unused.has(clip.id)) };
};

const cropFields = (crop: CutCrop): Pick<SceneCut, 'cropCenterX' | 'cropCenterY' | 'cropZoom'> => ({
  cropCenterX: crop.cropCenterX,
  ...(crop.cropCenterY !== undefined ? { cropCenterY: crop.cropCenterY } : {}),
  ...(crop.cropZoom !== undefined ? { cropZoom: crop.cropZoom } : {}),
});

/** カット1のクリップとクロップをシーンへ置く。 */
const asPrimary = (scene: Scene, clipId: string, crop: CutCrop): Scene => {
  const { cropCenterY: _y, cropZoom: _z, ...rest } = scene;
  return { ...rest, clipId, ...cropFields(crop) };
};

const withExtras = (scene: Scene, extras: SceneCut[]): Scene => {
  if (extras.length > 0) return { ...scene, extraCuts: extras };
  const { extraCuts: _extra, ...rest } = scene;
  return rest;
};

export const canAddCut = (project: Project, sceneKey: SceneKey): boolean => {
  if (!isMultiCutScene(sceneKey)) return false;
  const count = sceneCuts(project, sceneKey).length;
  return count > 0 && count < MAX_CUTS_PER_SCENE;
};

/**
 * afterIndex 番目のカットの後ろにカットを足す。
 * 動画が2本以上あれば、そのカットと別の最初の動画を 0 秒から。1本なら同じ動画を、そのカットの OUT から。
 * ids を渡すと、新しいカットとクリップにその id を使う（画面で新しいカットを選ぶため）。
 */
export const addCut = (
  project: Project,
  sceneKey: SceneKey,
  afterIndex: number,
  ids: { cutId: string; clipId: string } = { cutId: randomId(), clipId: randomId() },
): Project => {
  if (!canAddCut(project, sceneKey)) return project;
  const cuts = sceneCuts(project, sceneKey);
  const reference = cuts[Math.min(Math.max(0, afterIndex), cuts.length - 1)];
  if (!reference) return project;
  const videos = project.assets.filter((asset) => asset.type === 'video');
  const other = videos.find((asset) => asset.id !== reference.clip.assetId);
  const assetId = other?.id ?? reference.clip.assetId;
  const media = mediaDuration(project, assetId, reference.clip.out);
  const range = rangeForSceneDuration(other ? 0 : reference.clip.out, NEW_CUT_SEC, media);
  const cut: SceneCut = { id: ids.cutId, clipId: ids.clipId };
  const next = withScene(
    { ...project, clips: [...project.clips, { id: ids.clipId, assetId, in: range.in, out: range.out }] },
    sceneKey,
    (scene) => {
      const extras = [...extraCutsOf(scene)];
      extras.splice(reference.index, 0, cut);
      return withExtras(scene, extras);
    },
  );
  return rebuildSceneItems(next, sceneKey);
};

/** カットを消す。カット1を消すときはカット2を繰り上げる。カットが1本なら何もしない。 */
export const removeCut = (project: Project, sceneKey: SceneKey, cutId: string): Project => {
  const scene = project.scenes.find((entry) => entry.sceneKey === sceneKey);
  const extras = extraCutsOf(scene);
  if (!scene || extras.length === 0) return project;
  let removedClipId: string | undefined;
  let next: Project;
  if (cutId === PRIMARY_CUT_ID) {
    const [promoted, ...rest] = extras;
    if (!promoted) return project;
    removedClipId = scene.clipId;
    next = withScene(project, sceneKey, (current) =>
      withExtras(asPrimary(current, promoted.clipId, cutCrop(current, promoted)), rest),
    );
  } else {
    const target = extras.find((cut) => cut.id === cutId);
    if (!target) return project;
    removedClipId = target.clipId;
    next = withScene(project, sceneKey, (current) =>
      withExtras(
        current,
        extraCutsOf(current).filter((cut) => cut.id !== cutId),
      ),
    );
  }
  next = removedClipId ? dropUnusedClips(next, [removedClipId]) : next;
  return rebuildSceneItems(next, sceneKey);
};

/**
 * カットを1つ前（-1）か後ろ（1）へ動かす。カット1と入れ替えるときは、クリップとクロップを
 * シーンとカット2の間で入れ替える（照準マーカーなどは新しいカット1に付く）。
 */
export const moveCut = (project: Project, sceneKey: SceneKey, cutId: string, direction: -1 | 1): Project => {
  const scene = project.scenes.find((entry) => entry.sceneKey === sceneKey);
  const extras = extraCutsOf(scene);
  if (!scene?.clipId || extras.length === 0) return project;
  const order = [PRIMARY_CUT_ID, ...extras.map((cut) => cut.id)];
  const from = order.indexOf(cutId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return project;
  let next: Project;
  if (from === 0 || to === 0) {
    const second = extras[0];
    if (!second) return project;
    const demoted: SceneCut = { id: second.id, clipId: scene.clipId, ...cropFields(sceneCrop(scene)) };
    next = withScene(project, sceneKey, (current) =>
      withExtras(asPrimary(current, second.clipId, cutCrop(current, second)), [demoted, ...extras.slice(1)]),
    );
  } else {
    const swapped = [...extras];
    const a = swapped[from - 1];
    const b = swapped[to - 1];
    if (!a || !b) return project;
    swapped[from - 1] = b;
    swapped[to - 1] = a;
    next = withScene(project, sceneKey, (current) => withExtras(current, swapped));
  }
  return rebuildSceneItems(next, sceneKey);
};

/** カットの動画を差し替える。長さはなるべく保ち、素材の長さに収める。 */
export const retargetCutVideo = (
  project: Project,
  sceneKey: SceneKey,
  cutId: string,
  assetId: string,
): Project => {
  if (cutId === PRIMARY_CUT_ID) {
    const next = retargetSceneVideo(project, sceneKey, assetId);
    return next === project ? project : rebuildSceneItems(next, sceneKey);
  }
  const asset = project.assets.find((entry) => entry.id === assetId && entry.type === 'video');
  const cut = sceneCuts(project, sceneKey).find((entry) => entry.cutId === cutId);
  if (!asset || !cut || cut.clip.assetId === assetId) return project;
  const media = mediaDuration(project, assetId, cut.clip.out);
  const range = rangeForSceneDuration(cut.clip.in, Math.max(0.1, cut.clip.out - cut.clip.in), media);
  let next: Project;
  if (clipUsageCount(project, cut.clip.id) > 1) {
    const clipId = randomId();
    next = withScene(
      { ...project, clips: [...project.clips, { id: clipId, assetId, in: range.in, out: range.out }] },
      sceneKey,
      (scene) =>
        withExtras(
          scene,
          extraCutsOf(scene).map((entry) => (entry.id === cutId ? { ...entry, clipId } : entry)),
        ),
    );
  } else {
    next = {
      ...project,
      clips: project.clips.map((clip) =>
        clip.id === cut.clip.id ? { ...clip, assetId, in: range.in, out: range.out } : clip,
      ),
    };
  }
  return rebuildSceneItems(next, sceneKey);
};

/** カットの IN／OUT を変える。素材の範囲に収め、シーンの尺とタイムラインへ写す。 */
export const setCutRange = (
  project: Project,
  sceneKey: SceneKey,
  cutId: string,
  range: { in: number; out: number },
): Project => {
  const cut = sceneCuts(project, sceneKey).find((entry) => entry.cutId === cutId);
  if (!cut || !Number.isFinite(range.in) || !Number.isFinite(range.out)) return project;
  const media = mediaDuration(project, cut.clip.assetId, cut.clip.out);
  const start = Math.min(Math.max(0, range.in), media);
  const end = Math.min(Math.max(0, range.out), media);
  if (!(end > start)) return project;
  const next: Project = {
    ...project,
    clips: project.clips.map((clip) => (clip.id === cut.clip.id ? { ...clip, in: start, out: end } : clip)),
  };
  return applyCutLength(next, sceneKey, cutId, end - start);
};

/** カットのクロップを変える。カット1はシーンの値を変える。 */
export const setCutCrop = (
  project: Project,
  sceneKey: SceneKey,
  cutId: string,
  crop: Partial<CutCrop>,
): Project =>
  withScene(project, sceneKey, (scene) => {
    if (cutId === PRIMARY_CUT_ID) return { ...scene, ...crop };
    return withExtras(
      scene,
      extraCutsOf(scene).map((cut) => (cut.id === cutId ? { ...cut, ...crop } : cut)),
    );
  });
