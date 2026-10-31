import { diagnostic, dedupeDiagnostics, type Diagnostic } from './diagnostics';
import { CORNER_SIZE, cornerRect, rectProblem, splitRects, type Size } from './geometry';
import {
  FULL_RECT,
  assetById,
  localizedText,
  type Anchor,
  type AvatarSet,
  type Easing,
  type ExpressionMedia,
  type FrameStyle,
  type Fit,
  type LongAsset,
  type LongLanguage,
  type LongProject,
  type MainPlacement,
  type NormRect,
  type Placement,
  type Scene,
  type SecondaryPlacement,
  type ZoomPlacement,
  type CaptionKind,
  type CaptionStyle,
  type MotionKind,
  type OverlayKind,
  type Localized,
} from './schema';
import { mainSourceAt, secondarySourceAt, syncPairFor, validMainSourceRange, type SyncPair } from './sync';
import {
  buildTimeSegments,
  frameToTicks,
  localTimeOfSource,
  segmentsDuration,
  ticksToFrame,
  ticksToSec,
  TICKS_PER_SECOND,
  type Interval,
  type Ticks,
  type TimeSegment,
} from './time';

// ===========================================================================
// 1. タイムラインの解決（章・シーン・主配置の全体時刻）

export type ResolvedScene = {
  id: string;
  chapterId: string;
  start: Ticks;
  end: Ticks;
  content: Scene['content']['kind'];
  placementId?: string;
};

export type ResolvedChapter = {
  id: string;
  start: Ticks;
  end: Ticks;
  sceneIds: string[];
};

export type ResolvedMain = {
  placementId: string;
  sceneId: string;
  start: Ticks;
  end: Ticks;
  segments: TimeSegment[];
};

export type ResolvedTimeline = {
  total: Ticks;
  chapters: ResolvedChapter[];
  scenes: ResolvedScene[];
  sceneIndex: Record<string, ResolvedScene>;
  chapterIndex: Record<string, ResolvedChapter>;
  mains: Record<string, ResolvedMain>;
  diagnostics: Diagnostic[];
};

const mainOf = (project: LongProject, scene: Scene): MainPlacement | null => {
  if (scene.content.kind !== 'placement') return null;
  const { placementId } = scene.content;
  const placement = project.placements.find((item) => item.id === placementId);
  return placement?.role === 'main' ? placement : null;
};

export const mainSegments = (placement: MainPlacement): TimeSegment[] =>
  buildTimeSegments({
    sourceIn: placement.sourceIn,
    sourceOut: placement.sourceOut,
    speed: placement.speed,
    freezes: placement.freezes,
  });

/** シーンの尺（有効・無効に関係なく）。 */
export const sceneDuration = (project: LongProject, scene: Scene): Ticks => {
  if (scene.content.kind === 'still') return scene.content.duration;
  if (scene.content.kind === 'empty') return scene.content.plannedDuration;
  const placement = mainOf(project, scene);
  return placement ? segmentsDuration(mainSegments(placement)) : 0;
};

/** 章の尺（有効なシーンのみ）。章自体が無効でも計算する。 */
export const chapterDuration = (project: LongProject, chapterId: string): Ticks => {
  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (!chapter) return 0;
  let total = 0;
  for (const sceneId of chapter.sceneIds) {
    const scene = project.scenes.find((item) => item.id === sceneId);
    if (scene?.enabled) total += sceneDuration(project, scene);
  }
  return total;
};

export const orderedChapters = (project: LongProject): LongProject['chapters'] => {
  const byId = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  const ordered = project.chapterOrder
    .map((chapterId) => byId.get(chapterId))
    .filter((chapter): chapter is LongProject['chapters'][number] => Boolean(chapter));
  const listed = new Set(ordered.map((chapter) => chapter.id));
  return [...ordered, ...project.chapters.filter((chapter) => !listed.has(chapter.id))];
};

export const resolveTimeline = (project: LongProject): ResolvedTimeline => {
  const diagnostics: Diagnostic[] = [];
  const chapters: ResolvedChapter[] = [];
  const scenes: ResolvedScene[] = [];
  const mains: Record<string, ResolvedMain> = {};
  const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]));
  let cursor: Ticks = 0;
  for (const chapter of orderedChapters(project)) {
    if (!chapter.enabled) continue;
    const chapterStart = cursor;
    const sceneIds: string[] = [];
    for (const sceneId of chapter.sceneIds) {
      const scene = sceneById.get(sceneId);
      if (!scene) {
        diagnostics.push(
          diagnostic('BROKEN_REFERENCE', 'error', { kind: 'chapter', id: chapter.id }, `章が存在しないシーン（${sceneId}）を参照しています`, {
            suggestedAction: 'シーンを作り直すか、参照を削除してください',
          }),
        );
        continue;
      }
      if (!scene.enabled) continue;
      const duration = sceneDuration(project, scene);
      if (duration <= 0) {
        diagnostics.push(
          diagnostic('ZERO_LENGTH', 'warning', { kind: 'scene', id: scene.id }, 'シーンの長さが0です', {
            suggestedAction: 'IN/OUTを見直すか、シーンを除外してください',
          }),
        );
        continue;
      }
      const resolved: ResolvedScene = {
        id: scene.id,
        chapterId: chapter.id,
        start: cursor,
        end: cursor + duration,
        content: scene.content.kind,
      };
      const placement = mainOf(project, scene);
      if (scene.content.kind === 'placement') {
        if (!placement) {
          diagnostics.push(
            diagnostic('BROKEN_REFERENCE', 'error', { kind: 'scene', id: scene.id }, 'シーンの主映像が見つかりません', {
              suggestedAction: '素材を割り当て直してください',
            }),
          );
        } else {
          resolved.placementId = placement.id;
          mains[placement.id] = {
            placementId: placement.id,
            sceneId: scene.id,
            start: cursor,
            end: cursor + duration,
            segments: mainSegments(placement),
          };
        }
      }
      scenes.push(resolved);
      sceneIds.push(scene.id);
      cursor += duration;
    }
    chapters.push({ id: chapter.id, start: chapterStart, end: cursor, sceneIds });
  }
  return {
    total: cursor,
    chapters,
    scenes,
    sceneIndex: Object.fromEntries(scenes.map((scene) => [scene.id, scene])),
    chapterIndex: Object.fromEntries(chapters.map((chapter) => [chapter.id, chapter])),
    mains,
    diagnostics,
  };
};

// ===========================================================================
// 2. アンカーの解決

export type AnchorResult =
  | { ok: true; ticks: Ticks }
  | { ok: false; reason: 'missing' | 'disabled' | 'out-of-range' };

const placementIndex = (project: LongProject): Map<string, Placement> =>
  new Map(project.placements.map((placement) => [placement.id, placement]));

/** 派生配置（副・拡大）の素材時刻を、主配置の素材時刻へ写す */
const toMainSource = (
  project: LongProject,
  placement: Placement,
  source: Ticks,
): { mainId: string; source: Ticks } | null => {
  if (placement.role === 'main') return { mainId: placement.id, source };
  if (placement.role === 'zoom') return { mainId: placement.parentId, source };
  const group = project.syncGroups.find((item) => item.id === placement.syncGroupId);
  const pair = group ? syncPairFor(group, placement.parentId, placement.id) : null;
  if (!pair) return null;
  return { mainId: placement.parentId, source: mainSourceAt(source, pair) };
};

export const resolveAnchor = (
  project: LongProject,
  timeline: ResolvedTimeline,
  anchor: Anchor,
  placements: Map<string, Placement> = placementIndex(project),
): AnchorResult => {
  switch (anchor.kind) {
    case 'project':
      return { ok: true, ticks: anchor.ticks };
    case 'scene': {
      const scene = timeline.sceneIndex[anchor.sceneId];
      if (scene) return { ok: true, ticks: scene.start + anchor.offset };
      return project.scenes.some((item) => item.id === anchor.sceneId)
        ? { ok: false, reason: 'disabled' }
        : { ok: false, reason: 'missing' };
    }
    case 'chapter': {
      const chapter = timeline.chapterIndex[anchor.chapterId];
      if (chapter) return { ok: true, ticks: chapter.start + anchor.offset };
      return project.chapters.some((item) => item.id === anchor.chapterId)
        ? { ok: false, reason: 'disabled' }
        : { ok: false, reason: 'missing' };
    }
    case 'source': {
      const placement = placements.get(anchor.placementId);
      if (!placement) return { ok: false, reason: 'missing' };
      const mapped = toMainSource(project, placement, anchor.ticks);
      if (!mapped) return { ok: false, reason: 'missing' };
      const main = timeline.mains[mapped.mainId];
      if (!main) return { ok: false, reason: placements.has(mapped.mainId) ? 'disabled' : 'missing' };
      const local = localTimeOfSource(main.segments, mapped.source);
      if (local === null) return { ok: false, reason: 'out-of-range' };
      return { ok: true, ticks: main.start + local };
    }
    case 'event': {
      const marker = project.markers.find((item) => item.id === anchor.markerId);
      if (!marker) return { ok: false, reason: 'missing' };
      const base = resolveAnchor(
        project,
        timeline,
        { kind: 'source', placementId: marker.placementId, ticks: marker.at },
        placements,
      );
      return base.ok ? { ok: true, ticks: base.ticks + anchor.offset } : base;
    }
  }
};

// ===========================================================================
// 3. 描画計画

export type PlanVideoPiece = {
  from: number;
  duration: number;
  kind: 'play' | 'freeze';
  /** 素材のフレーム（出力fps換算）。play は開始、freeze は静止位置 */
  trimBefore: number;
  speed: number;
  rect: NormRect;
  rectTo?: NormRect;
  crop: NormRect;
  cropTo?: NormRect;
  /** 補間の窓（絶対フレーム）。任意のフレームから同じ値を再計算する */
  motionFrom: number;
  motionTo: number;
  easing: Easing;
};

export type PlanVideoLayer = {
  id: string;
  placementId: string;
  role: Placement['role'];
  src: string;
  proxySrc?: string;
  sourceSize: Size;
  fit: Fit;
  style: FrameStyle;
  z: number;
  label?: string;
  pieces: PlanVideoPiece[];
};

export type PlanStill = {
  id: string;
  sceneId: string;
  from: number;
  duration: number;
  src?: string;
  color: string;
  placeholder: boolean;
  label: string;
};

export type PlanAudioPiece = {
  id: string;
  placementId: string;
  src: string;
  from: number;
  duration: number;
  trimBefore: number;
  speed: number;
  gain: number;
  /** フェードの窓（絶対フレーム） */
  windowFrom: number;
  windowTo: number;
  fadeIn: number;
  fadeOut: number;
};

export type PlanDuck = { from: number; to: number; attack: number; release: number; gain: number };

export type PlanBgm = {
  id: string;
  src: string;
  from: number;
  duration: number;
  offset: number;
  loop: boolean;
  trackFrames: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  ducks: PlanDuck[];
};

export type PlanSe = { id: string; src: string; from: number; duration: number; gain: number };

export type PlanCaption = {
  id: string;
  kind: CaptionKind;
  from: number;
  duration: number;
  text: string;
  style: CaptionStyle;
};

export type PlanOverlay = {
  id: string;
  kind: OverlayKind;
  from: number;
  duration: number;
  target: string;
  rect: NormRect;
  color: string;
  strokeWidth: number;
  src?: string;
  text: string;
  motion: MotionKind;
};

export type PlanAvatarPiece = {
  id: string;
  from: number;
  duration: number;
  media: ExpressionMedia;
  set: Pick<AvatarSet, 'width' | 'height' | 'originX' | 'originY'>;
  offset: { dx: number; dy: number };
  x: number;
  y: number;
  height: number;
  motion: MotionKind;
  /** 動きの基準フレーム（イベント開始） */
  motionFrom: number;
};

export type PlanChapter = {
  id: string;
  title: string;
  from: number;
  to: number;
  inChapters: boolean;
};

export type PlanScene = { id: string; chapterId: string; from: number; to: number; label: string };

export type RenderPlan = {
  revision: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  totalTicks: Ticks;
  language: LongLanguage;
  layers: PlanVideoLayer[];
  stills: PlanStill[];
  audio: PlanAudioPiece[];
  bgm: PlanBgm[];
  se: PlanSe[];
  captions: PlanCaption[];
  overlays: PlanOverlay[];
  avatars: PlanAvatarPiece[];
  chapters: PlanChapter[];
  scenes: PlanScene[];
  diagnostics: Diagnostic[];
};

export type AudioTrackRef = { filePath: string; durationSec: number };

export type PlanOptions = {
  language: LongLanguage;
  fps?: 30 | 60;
  tracks?: Record<string, AudioTrackRef>;
  revision?: string;
  /** 字幕を焼き込まない（SRTのみ） */
  captionsOff?: boolean;
  withoutBgm?: boolean;
};

export const dbToGain = (db: number): number => (db <= -60 ? 0 : Math.pow(10, db / 20));

const SE_MAX_SEC = 4;

type Ctx = {
  project: LongProject;
  timeline: ResolvedTimeline;
  fps: number;
  placements: Map<string, Placement>;
  diagnostics: Diagnostic[];
  frame: (ticks: Ticks) => number;
};

const sizeOf = (asset: LongAsset | undefined): Size => ({
  w: asset?.probe?.width || 1920,
  h: asset?.probe?.height || 1080,
});

/** 区間リスト同士の差・交差 */
const intersectIntervals = (a: Interval[], b: Interval[]): Interval[] => {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((p, q) => p.start - q.start);
};

const subtractIntervals = (a: Interval[], b: Interval[]): Interval[] => {
  let result = a.slice();
  for (const cut of b) {
    const next: Interval[] = [];
    for (const item of result) {
      if (cut.end <= item.start || cut.start >= item.end) {
        next.push(item);
        continue;
      }
      if (cut.start > item.start) next.push({ start: item.start, end: cut.start });
      if (cut.end < item.end) next.push({ start: cut.end, end: item.end });
    }
    result = next;
  }
  return result;
};

/** 主配置の出力時刻のうち、副素材が存在する区間 */
const validLocalIntervals = (segments: TimeSegment[], range: Interval): Interval[] => {
  const out: Interval[] = [];
  for (const segment of segments) {
    if (segment.kind === 'freeze') {
      if (segment.sourceAt >= range.start && segment.sourceAt < range.end) {
        out.push({ start: segment.start, end: segment.end });
      }
      continue;
    }
    const lo = Math.max(segment.sourceStart, range.start);
    const hi = Math.min(segment.sourceEnd, range.end);
    if (hi <= lo) continue;
    const start = segment.start + Math.round((lo - segment.sourceStart) / segment.speed);
    const end =
      hi >= segment.sourceEnd
        ? segment.end
        : segment.start + Math.round((hi - segment.sourceStart) / segment.speed);
    if (end > start) out.push({ start, end });
  }
  // 隣接区間をまとめる
  const merged: Interval[] = [];
  for (const item of out) {
    const last = merged[merged.length - 1];
    if (last && last.end >= item.start) last.end = Math.max(last.end, item.end);
    else merged.push({ ...item });
  }
  return merged;
};

/** 主配置の出力時刻 local の素材時刻 */
const sourceAtLocal = (segment: TimeSegment, local: Ticks): Ticks =>
  segment.kind === 'freeze'
    ? segment.sourceAt
    : Math.min(segment.sourceEnd, segment.sourceStart + Math.round((Math.max(local, segment.start) - segment.start) * segment.speed));

type PieceSpec = {
  /** 主配置内の出力区間 */
  local: Interval;
  rect: NormRect;
  rectTo?: NormRect;
  crop: NormRect;
  cropTo?: NormRect;
  motion?: Interval;
  easing: Easing;
  /** 素材時刻の写像（主の素材時刻 → この層の素材時刻） */
  mapSource: (mainSource: Ticks) => Ticks;
  /** 固定フレーム（hold-last） */
  holdAt?: Ticks;
};

/** 主配置の区分ごとにピースを作る（境界は全体時刻から1回だけ丸める） */
const piecesFor = (ctx: Ctx, main: ResolvedMain, spec: PieceSpec): PlanVideoPiece[] => {
  const pieces: PlanVideoPiece[] = [];
  const motionFrom = ctx.frame(main.start + (spec.motion?.start ?? spec.local.start));
  const motionTo = ctx.frame(main.start + (spec.motion?.end ?? spec.local.end));
  for (const segment of main.segments) {
    const start = Math.max(segment.start, spec.local.start);
    const end = Math.min(segment.end, spec.local.end);
    if (end <= start) continue;
    const from = ctx.frame(main.start + start);
    const to = ctx.frame(main.start + end);
    if (to <= from) continue;
    // 開始フレームの実時刻で素材位置を求める（丸めで区間の手前になる場合は区間の先頭）
    const frameLocal = Math.max(start, frameToTicks(from, ctx.fps) - main.start);
    const frozen = spec.holdAt !== undefined || segment.kind === 'freeze';
    const source =
      spec.holdAt !== undefined ? spec.holdAt : spec.mapSource(sourceAtLocal(segment, frameLocal));
    pieces.push({
      from,
      duration: to - from,
      kind: frozen ? 'freeze' : 'play',
      trimBefore: Math.max(0, Math.round(ticksToSec(source) * ctx.fps)),
      speed: segment.kind === 'play' ? segment.speed : 1,
      rect: spec.rect,
      rectTo: spec.rectTo,
      crop: spec.crop,
      cropTo: spec.cropTo,
      motionFrom,
      motionTo,
      easing: spec.easing,
    });
  }
  return pieces;
};

const placementLabel = (placement: Placement, language: LongLanguage): string | undefined =>
  placement.showLabel ? localizedText(placement.label, language) || undefined : undefined;

const checkRect = (ctx: Ctx, placement: Placement, rect: NormRect, field: string): void => {
  const problem = rectProblem(rect);
  if (problem) {
    ctx.diagnostics.push(
      diagnostic('INVALID_RECT', 'error', { kind: 'placement', id: placement.id }, `${field}：${problem}`, {
        field,
        suggestedAction: '範囲・比率・サイズを修正してください',
      }),
    );
  }
};

const buildPlacementLayers = (ctx: Ctx, scene: Scene, main: ResolvedMain, placement: MainPlacement, language: LongLanguage): {
  layers: PlanVideoLayer[];
  audio: PlanAudioPiece[];
} => {
  const { project } = ctx;
  const layers: PlanVideoLayer[] = [];
  const audio: PlanAudioPiece[] = [];
  const asset = assetById(project, placement.assetId);
  const duration = main.end - main.start;
  if (!asset || asset.missing) {
    ctx.diagnostics.push(
      diagnostic('MAIN_MEDIA_MISSING', 'error', { kind: 'scene', id: scene.id }, '主映像の素材ファイルが見つかりません', {
        suggestedAction: '素材を再リンクするか、シーンを除外してください',
      }),
    );
    return { layers, audio };
  }
  const assetDuration = asset.probe?.durationTicks;
  if (assetDuration !== undefined && assetDuration > 0 && placement.sourceOut > assetDuration + TICKS_PER_SECOND / 1000) {
    ctx.diagnostics.push(
      diagnostic('INVALID_RANGE', 'error', { kind: 'placement', id: placement.id }, 'OUT が素材の長さを超えています', {
        field: 'sourceOut',
        suggestedAction: 'OUT を素材の範囲内にしてください',
      }),
    );
  }
  checkRect(ctx, placement, placement.crop, '切り抜き範囲');
  checkRect(ctx, placement, placement.rect, '表示枠');

  const derived = scene.layerIds
    .map((layerId) => ctx.placements.get(layerId))
    .filter((item): item is Placement => Boolean(item) && item!.role !== 'main');
  const secondary = derived.find(
    (item): item is SecondaryPlacement => item.role === 'secondary' && item.parentId === placement.id,
  );

  // 副視点の表示・欠落区間
  let shown: Interval[] = [];
  let gaps: Interval[] = [];
  let pair: SyncPair | null = null;
  const whole: Interval = { start: 0, end: duration };
  if (secondary) {
    const group = project.syncGroups.find((item) => item.id === secondary.syncGroupId);
    pair = group ? syncPairFor(group, placement.id, secondary.id) : null;
    const secondaryAsset = assetById(project, secondary.assetId);
    if (!pair) {
      ctx.diagnostics.push(
        diagnostic('BROKEN_REFERENCE', 'error', { kind: 'placement', id: secondary.id }, '副視点の同期点が設定されていません', {
          suggestedAction: '同期点を設定してください',
        }),
      );
    } else if (!secondaryAsset || secondaryAsset.missing) {
      ctx.diagnostics.push(
        diagnostic('ASSET_MISSING', 'warning', { kind: 'placement', id: secondary.id }, '副視点の素材が見つかりません。主映像だけで書き出します', {
          suggestedAction: '素材を再リンクするか、副視点を外してください',
        }),
      );
      pair = null;
    } else {
      const visible = secondary.visible.length > 0 ? intersectIntervals(secondary.visible, [whole]) : [whole];
      const durationB = secondaryAsset.probe?.durationTicks ?? Number.MAX_SAFE_INTEGER;
      const valid = validLocalIntervals(main.segments, validMainSourceRange(pair, durationB));
      shown = intersectIntervals(visible, valid);
      gaps = subtractIntervals(visible, valid);
      if (gaps.length > 0) {
        const total = gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0);
        ctx.diagnostics.push(
          diagnostic(
            'SECONDARY_RANGE_GAP',
            'warning',
            { kind: 'placement', id: secondary.id },
            `副視点の素材が範囲外の区間があります（計 ${ticksToSec(total).toFixed(2)} 秒）。${
              secondary.gapPolicy === 'hold-last' ? '直前のフレームを保持します' : 'その区間は副視点を表示しません'
            }`,
            { suggestedAction: '表示区間・同期点を見直すか、保持方法を選んでください' },
          ),
        );
      }
    }
  }

  // 主・副の枠
  const layoutRects = (): { main: NormRect; secondary: NormRect } => {
    if (!secondary) return { main: placement.rect, secondary: FULL_RECT };
    if (secondary.layout === 'split-h' || secondary.layout === 'split-v') {
      return splitRects(secondary.layout, secondary.splitRatio);
    }
    if (secondary.layout === 'corner') {
      const secondaryAsset = assetById(project, secondary.assetId);
      const source = sizeOf(secondaryAsset);
      const ratio = (secondary.crop.w * source.w) / (secondary.crop.h * source.h);
      const width = secondary.rect.w < 1 ? secondary.rect.w : CORNER_SIZE;
      return { main: placement.rect, secondary: cornerRect(secondary.corner, width, ratio) };
    }
    return { main: placement.rect, secondary: secondary.rect };
  };
  const rects = layoutRects();
  const swapped = Boolean(secondary?.swapped);
  const mainLayoutRect = swapped ? rects.secondary : rects.main;
  const secondaryLayoutRect = swapped ? rects.main : rects.secondary;

  // 主のピース：表示状態ごとに枠を変える
  const keepLayoutGaps =
    secondary && (secondary.gapPolicy === 'hide-keep-layout' || secondary.gapPolicy === 'hold-last') ? gaps : [];
  const layoutActive = [...shown, ...keepLayoutGaps].sort((a, b) => a.start - b.start);
  const plain = subtractIntervals([whole], layoutActive);
  const mainPieces: PlanVideoPiece[] = [];
  const identity = (source: Ticks): Ticks => source;
  for (const interval of plain) {
    mainPieces.push(
      ...piecesFor(ctx, main, {
        local: interval,
        rect: placement.rect,
        rectTo: placement.motion?.to,
        crop: placement.crop,
        cropTo: placement.motion?.cropTo,
        motion: whole,
        easing: placement.motion?.easing ?? 'ease',
        mapSource: identity,
      }),
    );
  }
  for (const interval of layoutActive) {
    mainPieces.push(
      ...piecesFor(ctx, main, {
        local: interval,
        rect: mainLayoutRect,
        crop: placement.crop,
        easing: 'step',
        mapSource: identity,
      }),
    );
  }
  mainPieces.sort((a, b) => a.from - b.from);
  const mainZ = placement.z + (swapped && secondary && (secondary.layout === 'corner' || secondary.layout === 'free') ? 15 : 0);
  layers.push({
    id: `layer-${placement.id}`,
    placementId: placement.id,
    role: 'main',
    src: asset.path,
    proxySrc: asset.proxyPath,
    sourceSize: sizeOf(asset),
    fit: placement.fit,
    style: placement.style,
    z: mainZ,
    label: placementLabel(placement, language),
    pieces: mainPieces,
  });

  // 主の音声
  for (const use of placement.audio) {
    if (use.muted) continue;
    const stream = asset.probe?.audioStreams.find((item) => item.audioIndex === use.audioIndex);
    if (!stream?.extractedPath) continue;
    audio.push(
      ...audioPieces(ctx, main, {
        id: `audio-${placement.id}-${use.audioIndex}`,
        placementId: placement.id,
        src: stream.extractedPath,
        gain: dbToGain(use.gainDb),
        startOffset: stream.startOffset,
        local: [whole],
        mapSource: identity,
        muteSlow: placement.muteDuringSlow,
        fadeIn: placement.fadeIn,
        fadeOut: placement.fadeOut,
      }),
    );
  }
  const roles = new Set(
    placement.audio
      .filter((use) => !use.muted)
      .map((use) => asset.probe?.audioStreams.find((item) => item.audioIndex === use.audioIndex)?.role)
      .filter(Boolean),
  );
  if (roles.has('mixed') && (roles.has('game') || roles.has('voice'))) {
    ctx.diagnostics.push(
      diagnostic('AUDIO_DUPLICATE_RISK', 'warning', { kind: 'placement', id: placement.id }, '混合トラックと、その構成要素（ゲーム音・声）を同時に使っています。音が二重になる可能性があります', {
        suggestedAction: '試聴して、どちらかのストリームを外してください',
      }),
    );
  }

  // 副視点
  if (secondary && pair) {
    const secondaryAsset = assetById(project, secondary.assetId)!;
    const syncPair = pair;
    const mapSecondary = (source: Ticks): Ticks => secondarySourceAt(source, syncPair);
    const pieces: PlanVideoPiece[] = [];
    for (const interval of shown) {
      pieces.push(
        ...piecesFor(ctx, main, {
          local: interval,
          rect: secondaryLayoutRect,
          crop: secondary.crop,
          easing: 'step',
          mapSource: mapSecondary,
        }),
      );
    }
    if (secondary.gapPolicy === 'hold-last') {
      const durationB = secondaryAsset.probe?.durationTicks ?? 0;
      for (const gap of gaps) {
        // 先頭より前で保持できるフレームがない場合は表示しない
        const before = shown.filter((item) => item.end <= gap.start);
        if (before.length === 0) continue;
        const last = before[before.length - 1]!;
        const segment = main.segments.find((item) => last.end > item.start && last.end <= item.end);
        if (!segment) continue;
        const held = Math.min(
          Math.max(0, durationB - Math.ceil(TICKS_PER_SECOND / ctx.fps)),
          mapSecondary(sourceAtLocal(segment, last.end)),
        );
        pieces.push(
          ...piecesFor(ctx, main, {
            local: gap,
            rect: secondaryLayoutRect,
            crop: secondary.crop,
            easing: 'step',
            mapSource: mapSecondary,
            holdAt: held,
          }),
        );
      }
    }
    pieces.sort((a, b) => a.from - b.from);
    layers.push({
      id: `layer-${secondary.id}`,
      placementId: secondary.id,
      role: 'secondary',
      src: secondaryAsset.path,
      proxySrc: secondaryAsset.proxyPath,
      sourceSize: sizeOf(secondaryAsset),
      fit: secondary.fit,
      style: secondary.style,
      z: secondary.z === 0 ? 10 : secondary.z,
      label: placementLabel(secondary, language),
      pieces,
    });
    for (const use of secondary.audio) {
      if (use.muted) continue;
      const stream = secondaryAsset.probe?.audioStreams.find((item) => item.audioIndex === use.audioIndex);
      if (!stream?.extractedPath) continue;
      audio.push(
        ...audioPieces(ctx, main, {
          id: `audio-${secondary.id}-${use.audioIndex}`,
          placementId: secondary.id,
          src: stream.extractedPath,
          gain: dbToGain(use.gainDb),
          startOffset: stream.startOffset,
          local: shown,
          mapSource: mapSecondary,
          muteSlow: placement.muteDuringSlow,
          fadeIn: 0,
          fadeOut: 0,
        }),
      );
    }
    if (secondary.audio.some((use) => !use.muted) && placement.audio.some((use) => !use.muted)) {
      ctx.diagnostics.push(
        diagnostic('AUDIO_DUPLICATE_RISK', 'info', { kind: 'placement', id: secondary.id }, '主・副の両方の音声を出しています。同じ爆発音・声が重なっていないか試聴してください'),
      );
    }
  }

  // 拡大小窓（同じ素材・同じ時刻。音声は持たない）
  for (const zoom of derived.filter((item): item is ZoomPlacement => item.role === 'zoom' && item.parentId === placement.id)) {
    checkRect(ctx, zoom, zoom.crop, '拡大の切り抜き範囲');
    checkRect(ctx, zoom, zoom.rect, '拡大の表示枠');
    if (zoom.end <= zoom.start) {
      ctx.diagnostics.push(
        diagnostic('INVALID_RANGE', 'error', { kind: 'placement', id: zoom.id }, '拡大の表示区間が不正です', { field: 'end' }),
      );
      continue;
    }
    const local = intersectIntervals([{ start: zoom.start, end: zoom.end }], [whole]);
    if (local.length === 0) {
      ctx.diagnostics.push(
        diagnostic('EVENT_OUT_OF_RANGE', 'warning', { kind: 'placement', id: zoom.id }, '拡大の表示区間がシーンの外にあります。出力しません', {
          suggestedAction: '表示区間を修正してください',
        }),
      );
      continue;
    }
    const interval = { start: zoom.start, end: zoom.end };
    const rect = zoom.mode === 'fullscreen' ? FULL_RECT : zoom.rect;
    const pieces = local.flatMap((item) =>
      piecesFor(ctx, main, {
        local: item,
        rect,
        rectTo: zoom.mode === 'fullscreen' ? undefined : zoom.motion?.to,
        crop: zoom.crop,
        cropTo: zoom.motion?.cropTo,
        motion: interval,
        easing: zoom.motion?.easing ?? 'ease',
        mapSource: identity,
      }),
    );
    layers.push({
      id: `layer-${zoom.id}`,
      placementId: zoom.id,
      role: 'zoom',
      src: asset.path,
      proxySrc: asset.proxyPath,
      sourceSize: sizeOf(asset),
      fit: zoom.fit,
      style: zoom.style,
      z: zoom.z === 0 ? (zoom.mode === 'fullscreen' ? 25 : 20) : zoom.z,
      label: placementLabel(zoom, language),
      pieces,
    });
  }
  return { layers, audio };
};

type AudioSpec = {
  id: string;
  placementId: string;
  src: string;
  gain: number;
  startOffset: Ticks;
  local: Interval[];
  mapSource: (mainSource: Ticks) => Ticks;
  muteSlow: boolean;
  fadeIn: Ticks;
  fadeOut: Ticks;
};

const audioPieces = (ctx: Ctx, main: ResolvedMain, spec: AudioSpec): PlanAudioPiece[] => {
  const out: PlanAudioPiece[] = [];
  const windowFrom = ctx.frame(main.start);
  const windowTo = ctx.frame(main.end);
  const fadeIn = Math.round(ticksToSec(spec.fadeIn) * ctx.fps);
  const fadeOut = Math.round(ticksToSec(spec.fadeOut) * ctx.fps);
  let index = 0;
  for (const interval of spec.local) {
    for (const segment of main.segments) {
      // フリーズ中は原音を繰り返さない
      if (segment.kind === 'freeze') continue;
      if (spec.muteSlow && segment.speed < 1) continue;
      const start = Math.max(segment.start, interval.start);
      const end = Math.min(segment.end, interval.end);
      if (end <= start) continue;
      let from = ctx.frame(main.start + start);
      const to = ctx.frame(main.start + end);
      if (to <= from) continue;
      const frameLocal = Math.max(start, frameToTicks(from, ctx.fps) - main.start);
      // 抽出した音声ファイル上の時刻 = 素材時刻 − 音声の開始ずれ
      const fileTime = spec.mapSource(sourceAtLocal(segment, frameLocal)) - spec.startOffset;
      let trimBefore = Math.round(ticksToSec(fileTime) * ctx.fps);
      if (trimBefore < 0) {
        from += Math.ceil(-trimBefore / segment.speed);
        trimBefore = 0;
      }
      if (to <= from) continue;
      out.push({
        id: `${spec.id}-${index}`,
        placementId: spec.placementId,
        src: spec.src,
        from,
        duration: to - from,
        trimBefore,
        speed: segment.speed,
        gain: spec.gain,
        windowFrom,
        windowTo,
        fadeIn,
        fadeOut,
      });
      index += 1;
    }
  }
  return out;
};

/** 音声ピースの音量（フェード込み）。Remotion とテストで共有する */
export const audioPieceVolume = (piece: PlanAudioPiece, absoluteFrame: number): number => {
  let gain = piece.gain;
  if (piece.fadeIn > 0) gain *= Math.min(1, Math.max(0, (absoluteFrame - piece.windowFrom) / piece.fadeIn));
  if (piece.fadeOut > 0) gain *= Math.min(1, Math.max(0, (piece.windowTo - absoluteFrame) / piece.fadeOut));
  return gain;
};

/** BGMの音量（フェード・手動ダッキング込み） */
export const bgmVolume = (bgm: PlanBgm, absoluteFrame: number): number => {
  let gain = bgm.gain;
  const local = absoluteFrame - bgm.from;
  if (bgm.fadeIn > 0) gain *= Math.min(1, Math.max(0, local / bgm.fadeIn));
  if (bgm.fadeOut > 0) gain *= Math.min(1, Math.max(0, (bgm.duration - local) / bgm.fadeOut));
  for (const duck of bgm.ducks) {
    let amount = 0;
    if (absoluteFrame >= duck.from - duck.attack && absoluteFrame < duck.from) {
      amount = duck.attack > 0 ? (absoluteFrame - (duck.from - duck.attack)) / duck.attack : 1;
    } else if (absoluteFrame >= duck.from && absoluteFrame < duck.to) {
      amount = 1;
    } else if (absoluteFrame >= duck.to && absoluteFrame < duck.to + duck.release) {
      amount = duck.release > 0 ? 1 - (absoluteFrame - duck.to) / duck.release : 0;
    }
    gain *= 1 - amount * (1 - duck.gain);
  }
  return gain;
};

type Timed = { start: Ticks; end: Ticks };

const placeTimed = (
  ctx: Ctx,
  entity: Diagnostic['entity'],
  anchor: Anchor,
  duration: Ticks,
  ownerSceneId: string | undefined,
  label: string,
): Timed | null => {
  if (ownerSceneId && !ctx.timeline.sceneIndex[ownerSceneId]) {
    // 所有シーンが無効なら、一緒に除外する
    if (ctx.project.scenes.some((scene) => scene.id === ownerSceneId)) return null;
  }
  const result = resolveAnchor(ctx.project, ctx.timeline, anchor, ctx.placements);
  if (!result.ok) {
    if (result.reason === 'disabled') return null;
    ctx.diagnostics.push(
      diagnostic(
        result.reason === 'missing' ? 'BROKEN_REFERENCE' : 'EVENT_OUT_OF_RANGE',
        'warning',
        entity,
        result.reason === 'missing'
          ? `${label}の基準（アンカー）が見つかりません。出力しません`
          : `${label}の基準がトリム範囲の外にあります。出力しません`,
        { suggestedAction: '基準となる素材・マーカーを確認してください' },
      ),
    );
    return null;
  }
  const start = result.ticks;
  const end = start + duration;
  if (start < 0) {
    ctx.diagnostics.push(
      diagnostic('NEGATIVE_START', 'warning', entity, `${label}の開始が動画の先頭より前になります（${ticksToSec(start).toFixed(2)} 秒）。出力しません`, {
        suggestedAction: '開始のずらし量を小さくするか、見せ場の位置を後ろにしてください',
      }),
    );
    return null;
  }
  if (start >= ctx.timeline.total) {
    ctx.diagnostics.push(
      diagnostic('EVENT_OUT_OF_RANGE', 'warning', entity, `${label}が動画の終わりより後にあります。出力しません`),
    );
    return null;
  }
  return { start, end: Math.min(end, ctx.timeline.total) };
};

const trackSrc = (
  ctx: Ctx,
  tracks: Record<string, AudioTrackRef>,
  trackId: string,
  entity: Diagnostic['entity'],
): AudioTrackRef | null => {
  const track = tracks[trackId];
  if (!track) {
    ctx.diagnostics.push(
      diagnostic('AUDIO_TRACK_MISSING', 'warning', entity, '音源ライブラリに見つからない音源があります。出力しません', {
        suggestedAction: '音源を登録し直すか、選び直してください',
      }),
    );
    return null;
  }
  return track;
};

const text = (value: Localized, language: LongLanguage): string => localizedText(value, language);

export const buildRenderPlan = (project: LongProject, options: PlanOptions): RenderPlan => {
  const fps = options.fps ?? project.output.fps;
  const timeline = resolveTimeline(project);
  const diagnostics: Diagnostic[] = [...timeline.diagnostics];
  const ctx: Ctx = {
    project,
    timeline,
    fps,
    placements: placementIndex(project),
    diagnostics,
    frame: (value) => ticksToFrame(value, fps),
  };
  const { language } = options;
  const tracks = options.tracks ?? {};
  const layers: PlanVideoLayer[] = [];
  const stills: PlanStill[] = [];
  const audio: PlanAudioPiece[] = [];
  const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]));

  for (const resolved of timeline.scenes) {
    const scene = sceneById.get(resolved.id)!;
    if (scene.content.kind === 'placement') {
      const main = resolved.placementId ? timeline.mains[resolved.placementId] : undefined;
      const placement = main ? ctx.placements.get(main.placementId) : undefined;
      if (main && placement?.role === 'main') {
        const built = buildPlacementLayers(ctx, scene, main, placement, language);
        layers.push(...built.layers);
        audio.push(...built.audio);
      }
      continue;
    }
    const from = ctx.frame(resolved.start);
    const to = ctx.frame(resolved.end);
    if (scene.content.kind === 'empty') {
      diagnostics.push(
        diagnostic('MAIN_MEDIA_MISSING', 'error', { kind: 'scene', id: scene.id }, `「${scene.label || 'シーン'}」に素材が割り当てられていません`, {
          suggestedAction: '素材を割り当てるか、シーンを除外してください',
        }),
      );
    }
    const asset = scene.content.kind === 'still' && scene.content.assetId ? assetById(project, scene.content.assetId) : undefined;
    stills.push({
      id: `still-${scene.id}`,
      sceneId: scene.id,
      from,
      duration: Math.max(0, to - from),
      src: asset?.path,
      color: scene.content.kind === 'still' ? scene.content.color : '#1E242C',
      placeholder: scene.content.kind === 'empty',
      label: scene.label,
    });
  }

  // 字幕
  const captions: PlanCaption[] = [];
  if (!options.captionsOff) {
    for (const caption of project.captions) {
      if (caption.excluded.includes(language)) continue;
      const body = text(caption.text, language);
      if (!body) {
        if (caption.sceneId && !timeline.sceneIndex[caption.sceneId]) continue;
        diagnostics.push(
          diagnostic(
            'CAPTION_MISSING_TRANSLATION',
            'error',
            { kind: 'caption', id: caption.id },
            `字幕に${language === 'ja' ? '日本語' : language === 'en' ? '英語' : '韓国語'}の本文がありません`,
            { language, suggestedAction: '本文を入力するか、この言語では出さない設定にしてください' },
          ),
        );
        continue;
      }
      const timed = placeTimed(ctx, { kind: 'caption', id: caption.id }, caption.anchor, caption.duration, caption.sceneId, '字幕');
      if (!timed) continue;
      const from = ctx.frame(timed.start);
      const to = ctx.frame(timed.end);
      if (to <= from) continue;
      captions.push({ id: caption.id, kind: caption.kind, from, duration: to - from, text: body, style: caption.style });
    }
  } else {
    for (const caption of project.captions) {
      if (caption.excluded.includes(language)) continue;
      if (!text(caption.text, language)) {
        if (caption.sceneId && !timeline.sceneIndex[caption.sceneId]) continue;
        diagnostics.push(
          diagnostic('CAPTION_MISSING_TRANSLATION', 'error', { kind: 'caption', id: caption.id }, '字幕の本文がありません', {
            language,
          }),
        );
      }
    }
  }

  // 図形・カットイン
  const overlays: PlanOverlay[] = [];
  const se: PlanSe[] = [];
  const pushSe = (id: string, trackId: string | undefined, startTicks: Ticks, gainDb: number, entity: Diagnostic['entity']): void => {
    if (!trackId) return;
    const track = trackSrc(ctx, tracks, trackId, entity);
    if (!track) return;
    const from = ctx.frame(startTicks);
    const remaining = ctx.frame(timeline.total) - from;
    const duration = Math.min(remaining, Math.ceil(Math.min(SE_MAX_SEC, track.durationSec || SE_MAX_SEC) * fps));
    if (duration <= 0) return;
    se.push({ id, src: track.filePath, from, duration, gain: dbToGain(gainDb) });
  };
  for (const overlay of project.overlays) {
    const timed = placeTimed(ctx, { kind: 'overlay', id: overlay.id }, overlay.anchor, overlay.duration, overlay.sceneId, overlay.kind === 'cutin' ? 'カットイン' : '図形');
    if (!timed) continue;
    const from = ctx.frame(timed.start);
    const to = ctx.frame(timed.end);
    if (to <= from) continue;
    if (overlay.target !== 'screen' && !ctx.placements.has(overlay.target)) {
      diagnostics.push(
        diagnostic('BROKEN_REFERENCE', 'warning', { kind: 'overlay', id: overlay.id }, '図形の対象映像が見つかりません。画面固定として描きます'),
      );
    }
    const asset = overlay.assetId ? assetById(project, overlay.assetId) : undefined;
    overlays.push({
      id: overlay.id,
      kind: overlay.kind,
      from,
      duration: to - from,
      target: ctx.placements.has(overlay.target) ? overlay.target : 'screen',
      rect: overlay.rect,
      color: overlay.color,
      strokeWidth: overlay.strokeWidth,
      src: asset?.path,
      text: text(overlay.text, language),
      motion: overlay.motion,
    });
    pushSe(`se-${overlay.id}`, overlay.seTrackId, timed.start, overlay.seGainDb, { kind: 'overlay', id: overlay.id });
  }

  // アバター（表情に添える短い文字はリアクション字幕として出す）
  const avatarBuilt = buildAvatarPieces(ctx, language, pushSe, Boolean(options.captionsOff));
  const avatars = avatarBuilt.pieces;
  captions.push(...avatarBuilt.captions);

  // 効果音
  for (const item of project.se) {
    const timed = placeTimed(ctx, { kind: 'audio', id: item.id }, item.anchor, 1, item.sceneId, '効果音');
    if (!timed) continue;
    pushSe(item.id, item.audioTrackId, timed.start, item.gainDb, { kind: 'audio', id: item.id });
  }

  // BGM
  const bgm: PlanBgm[] = [];
  if (!options.withoutBgm) {
    const ducks: PlanDuck[] = [];
    for (const duck of project.ducking) {
      const timed = placeTimed(ctx, { kind: 'audio', id: duck.id }, duck.anchor, duck.duration, duck.sceneId, 'BGMの下げ');
      if (!timed) continue;
      ducks.push({
        from: ctx.frame(timed.start),
        to: ctx.frame(timed.end),
        attack: Math.round(ticksToSec(duck.attack) * fps),
        release: Math.round(ticksToSec(duck.release) * fps),
        gain: dbToGain(duck.depthDb),
      });
    }
    for (const item of project.bgm) {
      if (item.chapterId && !timeline.chapterIndex[item.chapterId]) continue;
      const track = trackSrc(ctx, tracks, item.audioTrackId, { kind: 'audio', id: item.id });
      if (!track) continue;
      const timed = placeTimed(ctx, { kind: 'audio', id: item.id }, item.anchor, item.duration, undefined, 'BGM');
      if (!timed) continue;
      const from = ctx.frame(timed.start);
      const to = ctx.frame(timed.end);
      if (to <= from) continue;
      bgm.push({
        id: item.id,
        src: track.filePath,
        from,
        duration: to - from,
        offset: Math.round(ticksToSec(item.offset) * fps),
        loop: item.loop,
        trackFrames: Math.max(1, Math.floor(track.durationSec * fps)),
        gain: dbToGain(item.gainDb),
        fadeIn: Math.round(ticksToSec(item.fadeIn) * fps),
        fadeOut: Math.round(ticksToSec(item.fadeOut) * fps),
        ducks,
      });
    }
  }

  const chapters: PlanChapter[] = timeline.chapters.map((chapter) => {
    const source = project.chapters.find((item) => item.id === chapter.id)!;
    return {
      id: chapter.id,
      title: text(source.title, language),
      from: ctx.frame(chapter.start),
      to: ctx.frame(chapter.end),
      inChapters: source.inChapters,
    };
  });
  const scenes: PlanScene[] = timeline.scenes.map((scene) => ({
    id: scene.id,
    chapterId: scene.chapterId,
    from: ctx.frame(scene.start),
    to: ctx.frame(scene.end),
    label: sceneById.get(scene.id)?.label ?? '',
  }));
  if (timeline.total <= 0) {
    diagnostics.push(
      diagnostic('NO_CONTENT', 'error', { kind: 'project', id: project.id }, '有効なシーンがありません', {
        suggestedAction: '章とシーンを追加してください',
      }),
    );
  }

  layers.sort((a, b) => a.z - b.z);
  return {
    revision: options.revision ?? project.updatedAt,
    width: project.output.width,
    height: project.output.height,
    fps,
    durationInFrames: Math.max(1, ctx.frame(timeline.total)),
    totalTicks: timeline.total,
    language,
    layers,
    stills,
    audio,
    bgm,
    se,
    captions,
    overlays,
    avatars,
    chapters,
    scenes,
    diagnostics: dedupeDiagnostics(diagnostics),
  };
};

// ===========================================================================
// アバター

const buildAvatarPieces = (
  ctx: Ctx,
  language: LongLanguage,
  pushSe: (id: string, trackId: string | undefined, start: Ticks, gainDb: number, entity: Diagnostic['entity']) => void,
  captionsOff: boolean,
): { pieces: PlanAvatarPiece[]; captions: PlanCaption[] } => {
  const captions: PlanCaption[] = [];
  const { project } = ctx;
  const base = project.avatarBase;
  const defaultSetId = base.setId ?? project.avatarSets[0]?.id;
  const pieces: PlanAvatarPiece[] = [];
  type State = { setId?: string; expressionId: string; x: number; y: number; height: number } | null;
  const baseState: State = base.enabled && defaultSetId
    ? { setId: defaultSetId, expressionId: base.expressionId, x: base.x, y: base.y, height: base.height }
    : null;

  const events = project.avatarEvents
    .map((event) => {
      const timed = placeTimed(ctx, { kind: 'avatar', id: event.id }, event.anchor, event.duration, event.sceneId, 'アバターの表情');
      return timed ? { event, ...timed } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.start - b.start || a.event.id.localeCompare(b.event.id));

  const mediaFor = (
    state: NonNullable<State>,
    entityId: string,
  ): { media: ExpressionMedia; set: AvatarSet } | null => {
    const set = project.avatarSets.find((item) => item.id === state.setId) ?? project.avatarSets[0];
    if (!set) return null;
    const media = set.expressions[state.expressionId];
    if (media) return { media, set };
    ctx.diagnostics.push(
      diagnostic(
        'AVATAR_EXPRESSION_MISSING',
        'warning',
        { kind: 'avatar', id: entityId },
        `「${set.name}」に表情 ${state.expressionId} が登録されていません。${base.missing === 'hidden' ? '非表示にします' : '通常の表情で代用します'}`,
        { suggestedAction: '表情を登録するか、代わりの扱いを選んでください' },
      ),
    );
    if (base.missing === 'hidden') return null;
    const fallback = set.expressions[base.expressionId] ?? set.expressions.E01;
    return fallback ? { media: fallback, set } : null;
  };

  const emit = (state: State, start: Ticks, end: Ticks, motion: MotionKind, motionStart: Ticks, id: string): void => {
    if (!state || end <= start) return;
    const resolved = mediaFor(state, id);
    if (!resolved) return;
    const from = ctx.frame(start);
    const to = ctx.frame(end);
    if (to <= from) return;
    pieces.push({
      id: `${id}-${from}`,
      from,
      duration: to - from,
      media: resolved.media,
      set: {
        width: resolved.set.width,
        height: resolved.set.height,
        originX: resolved.set.originX,
        originY: resolved.set.originY,
      },
      offset: resolved.set.offsets[state.expressionId] ?? { dx: 0, dy: 0 },
      x: state.x,
      y: state.y,
      height: state.height,
      motion,
      motionFrom: ctx.frame(motionStart),
    });
  };

  let current: State = baseState;
  let cursor: Ticks = 0;
  let lastEnd: Ticks = -1;
  for (const item of events) {
    const start = item.start;
    if (start < lastEnd) {
      ctx.diagnostics.push(
        diagnostic('AVATAR_OVERLAP', 'warning', { kind: 'avatar', id: item.event.id }, '同じアバターの表情区間が重なっています。後の区間を優先します', {
          suggestedAction: '区間を上書きまたは分割してください',
        }),
      );
      // 直前のピースを切り詰める
      const previous = pieces[pieces.length - 1];
      const cut = ctx.frame(start);
      if (previous && previous.from + previous.duration > cut) previous.duration = Math.max(0, cut - previous.from);
    } else {
      emit(current, cursor, start, 'none', cursor, 'avatar-base');
    }
    const before = current;
    const state: NonNullable<State> = {
      setId: item.event.setId ?? before?.setId ?? defaultSetId,
      expressionId: item.event.expressionId,
      x: item.event.x ?? before?.x ?? base.x,
      y: item.event.y ?? before?.y ?? base.y,
      height: item.event.height ?? before?.height ?? base.height,
    };
    emit(state, start, item.end, item.event.motion, start, item.event.id);
    pushSe(`se-${item.event.id}`, item.event.seTrackId, start, item.event.seGainDb, { kind: 'avatar', id: item.event.id });
    const label = text(item.event.text, language);
    if (label && !captionsOff) {
      const from = ctx.frame(start);
      const to = ctx.frame(item.end);
      if (to > from) {
        captions.push({
          id: `avatar-text-${item.event.id}`,
          kind: 'reaction',
          from,
          duration: to - from,
          text: label,
          style: {
            preset: 'reaction',
            x: Math.min(0.9, state.x + 0.1),
            y: Math.max(0.1, state.y - state.height - 0.04),
            width: 0.3,
            size: 56,
            align: 'center',
            color: '#FFFFFF',
            accent: '#FF4655',
            background: false,
          },
        });
      }
    }
    current = item.event.after === 'hidden' ? null : item.event.after === 'previous' ? before : baseState;
    cursor = item.end;
    lastEnd = item.end;
  }
  emit(current, cursor, ctx.timeline.total, 'none', cursor, 'avatar-base');
  return { pieces: pieces.filter((piece) => piece.duration > 0), captions };
};
