import type { Interval, Ticks } from './time';
import type { LongProject, SyncGroup } from './schema';

/**
 * 2視点の同期。
 *
 * 各素材で「同じ出来事」が起きる素材時刻（syncAt）を持ち、同期点を 0 とする共通時刻 groupTime で対応させる。
 *   groupTime = mainSource - mainSyncAt
 *   secondarySource = secondarySyncAt + groupTime
 * 例：A=12.0秒、B=7.5秒。groupTime=+1.0 のとき A=13.0、B=8.5。
 * 主配置の速度・フリーズは主の素材時刻を通じて副にもそのまま適用される（副だけ再生し直さない）。
 */

export type SyncPair = { mainAt: Ticks; secondaryAt: Ticks };

export const groupTimeOf = (mainSource: Ticks, pair: SyncPair): Ticks => mainSource - pair.mainAt;

export const secondarySourceAt = (mainSource: Ticks, pair: SyncPair): Ticks =>
  pair.secondaryAt + (mainSource - pair.mainAt);

export const mainSourceAt = (secondarySource: Ticks, pair: SyncPair): Ticks =>
  pair.mainAt + (secondarySource - pair.secondaryAt);

/** 副素材が存在する主の素材時刻の範囲 [start, end) */
export const validMainSourceRange = (pair: SyncPair, secondaryDuration: Ticks): Interval => ({
  start: pair.mainAt - pair.secondaryAt,
  end: pair.mainAt - pair.secondaryAt + secondaryDuration,
});

export const syncPairFor = (
  group: SyncGroup,
  mainPlacementId: string,
  secondaryPlacementId: string,
): SyncPair | null => {
  const main = group.members.find((member) => member.placementId === mainPlacementId);
  const secondary = group.members.find((member) => member.placementId === secondaryPlacementId);
  if (!main || !secondary) return null;
  return { mainAt: main.syncAt, secondaryAt: secondary.syncAt };
};

export const syncGroupById = (project: LongProject, groupId: string): SyncGroup | undefined =>
  project.syncGroups.find((group) => group.id === groupId);

/** 「B を何秒動かすか」の表記用。正なら B を後ろへずらす。 */
export const describeOffset = (pair: SyncPair): Ticks => pair.mainAt - pair.secondaryAt;
