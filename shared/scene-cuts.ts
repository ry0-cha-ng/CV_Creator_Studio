import type { Clip, Project, Scene, SceneCut, SceneKey } from './schema/project';
import type { TimelineItem } from './schema/timeline';

/** カットを複数並べられるシーン。S5 カードは映像がなく、S6・S7 は対象外。 */
export const MULTI_CUT_SCENES: readonly SceneKey[] = ['hook', 'stand', 'aim', 'throw'];
/** 1シーンのカットの上限（カット1を含む）。暫定。 */
export const MAX_CUTS_PER_SCENE = 4;
/** カット1本の最短秒。タイムラインの最短（STRETCH_MIN）と同じ。 */
export const MIN_CUT_SEC = 0.3;
/** カットを足したときの長さ。暫定。 */
export const NEW_CUT_SEC = 1.5;
/** カット1の識別子。カット1は scene.clipId なので固有の id を持たない。 */
export const PRIMARY_CUT_ID = 'primary';

export type CutCrop = { cropCenterX: number; cropCenterY?: number; cropZoom?: number };

export type ResolvedCut = {
  /** カット1は PRIMARY_CUT_ID。 */
  cutId: string;
  index: number;
  clip: Clip;
  crop: CutCrop;
};

export const isMultiCutScene = (sceneKey: SceneKey): boolean => MULTI_CUT_SCENES.includes(sceneKey);

/** 対象外のシーンに残っていても無視する。 */
export const extraCutsOf = (scene: Pick<Scene, 'sceneKey' | 'extraCuts'> | undefined): SceneCut[] =>
  scene && isMultiCutScene(scene.sceneKey) ? (scene.extraCuts ?? []) : [];

export const sceneCrop = (scene: Pick<Scene, 'cropCenterX' | 'cropCenterY' | 'cropZoom'>): CutCrop => ({
  cropCenterX: scene.cropCenterX,
  ...(scene.cropCenterY !== undefined ? { cropCenterY: scene.cropCenterY } : {}),
  ...(scene.cropZoom !== undefined ? { cropZoom: scene.cropZoom } : {}),
});

/** カットのクロップ。未指定の値はシーンの値を使う。 */
export const cutCrop = (
  scene: Pick<Scene, 'cropCenterX' | 'cropCenterY' | 'cropZoom'>,
  cut: Pick<SceneCut, 'cropCenterX' | 'cropCenterY' | 'cropZoom'> | undefined,
): CutCrop => {
  const base = sceneCrop(scene);
  if (!cut) return base;
  const cropCenterY = cut.cropCenterY ?? base.cropCenterY;
  const cropZoom = cut.cropZoom ?? base.cropZoom;
  return {
    cropCenterX: cut.cropCenterX ?? base.cropCenterX,
    ...(cropCenterY !== undefined ? { cropCenterY } : {}),
    ...(cropZoom !== undefined ? { cropZoom } : {}),
  };
};

/** シーンのカットを並び順に。クリップが見つからないカットは除く。カット1がなければ空。 */
export const sceneCuts = (project: Pick<Project, 'scenes' | 'clips'>, sceneKey: SceneKey): ResolvedCut[] => {
  const scene = project.scenes.find((entry) => entry.sceneKey === sceneKey);
  const primary = project.clips.find((clip) => clip.id === scene?.clipId);
  if (!scene || !primary) return [];
  const cuts: ResolvedCut[] = [
    { cutId: PRIMARY_CUT_ID, index: 0, clip: primary, crop: sceneCrop(scene) },
  ];
  for (const cut of extraCutsOf(scene)) {
    const clip = project.clips.find((entry) => entry.id === cut.clipId);
    if (!clip) continue;
    cuts.push({ cutId: cut.id, index: cuts.length, clip, crop: cutCrop(scene, cut) });
  }
  return cuts;
};

/** カットが2本以上あるシーンか。 */
export const hasExtraCuts = (project: Pick<Project, 'scenes' | 'clips'>, sceneKey: SceneKey): boolean =>
  sceneCuts(project, sceneKey).length > 1;

export const cutLength = (clip: Pick<Clip, 'in' | 'out'>): number => Math.max(0, clip.out - clip.in);

/** タイムライン項目が指すカット2以降。カット1の項目なら undefined。 */
export const extraCutOfItem = (
  project: Pick<Project, 'scenes'>,
  item: Pick<TimelineItem, 'sceneKey' | 'clipId'>,
): SceneCut | undefined => {
  if (!item.clipId) return undefined;
  const scene = project.scenes.find((entry) => entry.sceneKey === item.sceneKey);
  return extraCutsOf(scene).find((cut) => cut.clipId === item.clipId);
};

/** カット2以降の項目のクリップ。カット1の項目・対象外のシーンは undefined。 */
export const extraCutClipOfItem = (
  project: Pick<Project, 'scenes' | 'clips'>,
  item: Pick<TimelineItem, 'sceneKey' | 'clipId'>,
): Clip | undefined => {
  const cut = extraCutOfItem(project, item);
  return cut ? project.clips.find((clip) => clip.id === cut.clipId) : undefined;
};

/** カット1の項目か（照準マーカー・ズーム・フリーズはカット1にだけ付く）。 */
export const isPrimaryItem = (
  project: Pick<Project, 'scenes' | 'clips'>,
  item: Pick<TimelineItem, 'sceneKey' | 'clipId'> | undefined,
): boolean => !item || !extraCutClipOfItem(project, item);

/** 項目のクロップ。カット1はシーンの値。 */
export const itemCrop = (
  project: Pick<Project, 'scenes'>,
  scene: Pick<Scene, 'cropCenterX' | 'cropCenterY' | 'cropZoom'>,
  item: Pick<TimelineItem, 'sceneKey' | 'clipId'> | undefined,
): CutCrop => cutCrop(scene, item ? extraCutOfItem(project, item) : undefined);

/** そのクリップをどこかのシーン（カット1・カット2以降）が使っているか。 */
export const clipInUse = (project: Pick<Project, 'scenes'>, clipId: string): boolean =>
  project.scenes.some(
    (scene) => scene.clipId === clipId || (scene.extraCuts ?? []).some((cut) => cut.clipId === clipId),
  );

/** そのクリップを使っているカットの数（カット1・カット2以降の合計）。 */
export const clipUsageCount = (project: Pick<Project, 'scenes'>, clipId: string): number =>
  project.scenes.reduce(
    (sum, scene) =>
      sum +
      (scene.clipId === clipId ? 1 : 0) +
      (scene.extraCuts ?? []).filter((cut) => cut.clipId === clipId).length,
    0,
  );

/** 書き出しなどで、カット2以降も含めてシーンが使うクリップ。 */
export const sceneClipsForExport = (project: Pick<Project, 'scenes' | 'clips'>): Clip[] => {
  const clips: Clip[] = [];
  for (const scene of project.scenes) {
    const ids = [scene.clipId, ...extraCutsOf(scene).map((cut) => cut.clipId)];
    for (const id of ids) {
      const clip = project.clips.find((entry) => entry.id === id);
      if (clip && !clips.includes(clip)) clips.push(clip);
    }
  }
  return clips;
};

/** 項目のカットの id。カット1（と、カットのないシーン）は PRIMARY_CUT_ID。 */
export const cutIdOfItem = (
  project: Pick<Project, 'scenes'>,
  item: Pick<TimelineItem, 'sceneKey' | 'clipId'>,
): string => extraCutOfItem(project, item)?.id ?? PRIMARY_CUT_ID;

/** カット2以降で、クリップか動画の素材が見つからないもの。cutNumber は画面の番号（2 始まり）。 */
export const missingExtraCuts = (
  project: Pick<Project, 'scenes' | 'clips' | 'assets'>,
): Array<{ sceneKey: SceneKey; cutNumber: number }> => {
  const missing: Array<{ sceneKey: SceneKey; cutNumber: number }> = [];
  for (const scene of project.scenes) {
    extraCutsOf(scene).forEach((cut, index) => {
      const clip = project.clips.find((entry) => entry.id === cut.clipId);
      const asset = project.assets.find((entry) => entry.id === clip?.assetId && entry.type === 'video');
      if (!clip || !asset) missing.push({ sceneKey: scene.sceneKey, cutNumber: index + 2 });
    });
  }
  return missing;
};
