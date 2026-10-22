import {
  ANNOTATION_FRAME_WIDTH,
  annotationStyleOf,
  connectorSegments,
  getAnnotationStyle,
  zoomChromeThickness,
  type AnnotationSegment,
} from './annotation-style';
import type { CardAimZoom, Language, Project, SceneAimZoom } from './schema/project';

export const AIM_ZOOM_SIZE_RATIO = { s: 0.47, m: 0.59, l: 0.7 } as const;

/** 動画フレームの幅に対する拡大画像の一辺。中はワイヤーフレームの 360/1080。 */
export const VIDEO_AIM_ZOOM_RATIO = { s: 0.26, m: 0.333, l: 0.42 } as const;

export const VIDEO_AIM_FRAME = { width: 1080, height: 1920 } as const;

export type AimZoomSurface = 'card-stack' | 'x-stack' | 'card-aim' | 'x-aim';

export type AimZoomBox = {
  width: number;
  height: number;
  /** 「02 合わせ位置」ラベルの高さ。0 ならラベルなし */
  labelHeight: number;
  /** フレーム内座標。チップとメモはこの x より左に収める */
  safeRight: number;
};

const X_STACK_META = 20;
const X_STACK_TITLE_GAP = 8;
const X_STACK_FOOTER = 32;
const X_STACK_ARROW = 28;
const X_STACK_GAP = 28;
const X_STACK_PAD_Y = 32;

/** X用B案の合わせ位置フレーム。ヘッダー（アイコン 158px）・矢印・フッターを固定した残りの高さ */
export const xStackFrameHeight = (language: Language): number => {
  const titleMax = language === 'ja' ? 42 : 36;
  const titleH = Math.ceil(titleMax * 1.15 * 2);
  const header = Math.max(X_STACK_META + X_STACK_TITLE_GAP + titleH, 158);
  const inner = 1350 - X_STACK_PAD_Y * 2;
  const steps = inner - header - X_STACK_FOOTER - X_STACK_GAP * 2;
  return (steps - X_STACK_ARROW * 2) / 3;
};

/**
 * 合わせ位置フレームの内容ボックス（枠線の内側）。
 * 完成カードB案は高さ290・幅は 1080-144 から左右2pxの枠線を引いた値。
 */
export const aimZoomBox = (surface: AimZoomSurface, language: Language): AimZoomBox => {
  if (surface === 'card-stack') {
    return { width: 932, height: 290, labelHeight: 60, safeRight: 838 };
  }
  if (surface === 'x-stack') {
    return { width: 996, height: xStackFrameHeight(language), labelHeight: 52, safeRight: 870 };
  }
  if (surface === 'card-aim') {
    return { width: 840, height: 520, labelHeight: 0, safeRight: 787 };
  }
  return { width: 1000, height: 678, labelHeight: 0, safeRight: 867 };
};

export const aimZoomSurface = (
  layout: Project['cardLayout'],
  kind: 'card' | 'x',
): AimZoomSurface => {
  if (layout === 'stack') return kind === 'x' ? 'x-stack' : 'card-stack';
  return kind === 'x' ? 'x-aim' : 'card-aim';
};

export type AimZoomCorner = 'tl' | 'tr' | 'bl' | 'br';

export type ResolvedAimZoom = {
  style: 'corner' | 'loupe' | 'split';
  position: AimZoomCorner | 'left' | 'right';
  zoom: 3 | 4 | 6;
  size: 's' | 'm' | 'l';
  guide: boolean;
  center: { x: number; y: number };
  window: { x: number; y: number; size: number };
  source: { x: number; y: number; size: number };
  /** 切り抜き範囲とズーム枠の赤の外周を結ぶ線。重なるときは空。 */
  connectors: AnnotationSegment[];
  /** 接続線の1本目。無いときは null。 */
  guideLine: { x1: number; y1: number; x2: number; y2: number } | null;
  overlapsCenter: boolean;
  split: { imageLeft: number; imageWidth: number; panelLeft: number; panelSize: number; crop: number } | null;
};

/**
 * カードに描く照準の丸。カード用の位置がなければ、以前のズーム中心、それもなければ動画の合わせ位置。
 * 動画のマーカーとは別なので、カード上で動かしても動画側は変わらない。
 */
export const cardAimPoint = (
  project: Project,
): { x: number; y: number; size: number } | null => {
  const video = project.scenes.find((scene) => scene.sceneKey === 'aim')?.aimMarker;
  const explicit = project.cardAimMarker ?? project.cardAimZoom?.center;
  if (!explicit && !video?.enabled) return null;
  const point = explicit ?? { x: video?.x ?? 0.5, y: video?.y ?? 0.5 };
  return { x: point.x, y: point.y, size: video?.size ?? 1 };
};

export const aimZoomCenter = (project: Project): { x: number; y: number } => {
  const point = cardAimPoint(project);
  if (point) return { x: point.x, y: point.y };
  return { x: 0.5, y: 0.5 };
};

export const resolveAimZoomSize = (
  zoom: Pick<CardAimZoom, 'size'>,
  surface: AimZoomSurface,
): 's' | 'm' | 'l' => {
  if (zoom.size) return zoom.size;
  return surface === 'card-stack' ? 'l' : 'm';
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** カード枠の1px単位で合わせ位置を動かす。stepPx は枠のピクセル。 */
export const nudgeCardAimPoint = (
  point: { x: number; y: number },
  direction: { x: number; y: number },
  box: { width: number; height: number },
  stepPx: number,
): { x: number; y: number } => ({
  x: clamp(point.x + (direction.x * stepPx) / box.width, 0, 1),
  y: clamp(point.y + (direction.y * stepPx) / box.height, 0, 1),
});

/** 拡大画像の左上を、赤の外周がフレーム内に収まる位置へ収める。戻り値は 0〜1。 */
export const clampVideoAimZoomOrigin = (
  originPx: { x: number; y: number },
  size: SceneAimZoom['size'],
  chrome: number,
  frameWidth: number = VIDEO_AIM_FRAME.width,
  frameHeight: number = VIDEO_AIM_FRAME.height,
): { x: number; y: number } => {
  const side = frameWidth * VIDEO_AIM_ZOOM_RATIO[size];
  return {
    x: clamp(originPx.x, chrome, Math.max(chrome, frameWidth - side - chrome)) / frameWidth,
    y: clamp(originPx.y, chrome, Math.max(chrome, frameHeight - side - chrome)) / frameHeight,
  };
};

/** 初めてオンにしたときの位置。合わせ位置から最も遠い角に置く。 */
export const defaultSceneAimZoom = (center: { x: number; y: number }): SceneAimZoom => {
  const { width, height } = VIDEO_AIM_FRAME;
  const side = width * VIDEO_AIM_ZOOM_RATIO.m;
  const margin = 72;
  const slots = [
    { x: margin, y: margin },
    { x: width - side - margin, y: margin },
    { x: margin, y: height - side - margin },
    { x: width - side - margin, y: height - side - margin },
  ];
  const cx = center.x * width;
  const cy = center.y * height;
  let best = slots[1];
  let bestDistance = -1;
  for (const slot of slots) {
    const distance = (slot.x + side / 2 - cx) ** 2 + (slot.y + side / 2 - cy) ** 2;
    if (distance > bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }
  return { enabled: true, zoom: 4, size: 'm', x: best.x / width, y: best.y / height, guide: true };
};

/** 動画フレーム上の拡大枠。x・y は拡大画像の左上。 */
export const resolveVideoAimZoom = (
  zoom: SceneAimZoom,
  center: { x: number; y: number },
  chrome: number,
  frameWidth: number = VIDEO_AIM_FRAME.width,
  frameHeight: number = VIDEO_AIM_FRAME.height,
): ResolvedAimZoom => {
  const side = frameWidth * VIDEO_AIM_ZOOM_RATIO[zoom.size];
  const origin = clampVideoAimZoomOrigin(
    { x: zoom.x * frameWidth, y: zoom.y * frameHeight },
    zoom.size,
    chrome,
    frameWidth,
    frameHeight,
  );
  const imageX = origin.x * frameWidth;
  const imageY = origin.y * frameHeight;
  const outer = { x: imageX - chrome, y: imageY - chrome, size: side + chrome * 2 };
  const cx = clamp(center.x, 0, 1) * frameWidth;
  const cy = clamp(center.y, 0, 1) * frameHeight;
  const sourceSize = side / zoom.zoom;
  const source = { x: cx - sourceSize / 2, y: cy - sourceSize / 2, size: sourceSize };
  const guideOn = zoom.guide !== false;
  const connectors = guideOn ? connectorSegments(source, outer) : [];
  const overlapsCenter =
    cx >= outer.x && cx <= outer.x + outer.size && cy >= outer.y && cy <= outer.y + outer.size;
  return {
    style: 'corner',
    position: 'tr',
    zoom: zoom.zoom,
    size: zoom.size,
    guide: guideOn,
    center,
    window: { x: imageX, y: imageY, size: side },
    source,
    connectors,
    guideLine: connectors[0] ?? null,
    overlapsCenter,
    split: null,
  };
};

export const resolveAimZoom = (
  box: AimZoomBox,
  zoom: CardAimZoom,
  center: { x: number; y: number },
  surface: AimZoomSurface,
  chrome = 0,
): ResolvedAimZoom => {
  const cx = clamp(center.x, 0, 1) * box.width;
  const cy = clamp(center.y, 0, 1) * box.height;
  const wide = box.width >= box.height * 2.5;
  const drawSplit = zoom.style === 'split' && wide;
  const zoomLevel = zoom.zoom;
  const guideOn = zoom.guide !== false;

  if (drawSplit) {
    const position =
      zoom.position === 'left' || zoom.position === 'tl' || zoom.position === 'bl' ? 'left' : 'right';
    const panel = box.height;
    const imageWidth = box.width - panel;
    const crop = (box.width - imageWidth) / 2;
    const imageLeft = position === 'left' ? panel : 0;
    const panelLeft = position === 'left' ? 0 : imageWidth;
    const sourceSize = panel / zoomLevel;
    return {
      style: 'split',
      position,
      zoom: zoomLevel,
      size: resolveAimZoomSize(zoom, surface),
      guide: false,
      center,
      window: { x: panelLeft, y: 0, size: panel },
      source: { x: imageLeft + cx - crop - sourceSize / 2, y: cy - sourceSize / 2, size: sourceSize },
      connectors: [],
      guideLine: null,
      overlapsCenter: false,
      split: { imageLeft, imageWidth, panelLeft, panelSize: panel, crop },
    };
  }

  const sizeName = resolveAimZoomSize(zoom, surface);
  const margin = Math.max(8, box.height * 0.047);
  const ratio = AIM_ZOOM_SIZE_RATIO[sizeName];
  const maxSide = Math.max(32, Math.min(box.width - margin * 2, box.height - margin));
  const side = Math.min(box.height * ratio, maxSide);
  const topLeftY = box.labelHeight > 0 ? Math.max(margin, box.labelHeight) : margin;
  const slots: Record<AimZoomCorner, { x: number; y: number }> = {
    tl: { x: margin, y: topLeftY },
    tr: { x: box.width - side - margin, y: margin },
    bl: { x: margin, y: box.height - side - margin },
    br: { x: box.width - side - margin, y: box.height - side - margin },
  };
  for (const key of Object.keys(slots) as AimZoomCorner[]) {
    const slot = slots[key];
    slot.x = clamp(slot.x, 0, Math.max(0, box.width - side));
    slot.y = clamp(slot.y, 0, Math.max(0, box.height - side));
  }
  let position: AimZoomCorner;
  const manual = zoom.position;
  if (manual === 'tl' || manual === 'tr' || manual === 'bl' || manual === 'br') {
    position = manual;
  } else {
    let best: AimZoomCorner = 'br';
    let bestDistance = -1;
    for (const key of Object.keys(slots) as AimZoomCorner[]) {
      const slot = slots[key];
      const dx = slot.x + side / 2 - cx;
      const dy = slot.y + side / 2 - cy;
      const distance = dx * dx + dy * dy;
      if (distance > bestDistance) {
        bestDistance = distance;
        best = key;
      }
    }
    position = best;
  }
  const slot = slots[position];
  const sourceSize = side / zoomLevel;
  const loupe = zoom.style === 'loupe';
  const inward =
    position === 'tl'
      ? { x: chrome, y: chrome }
      : position === 'tr'
        ? { x: -chrome, y: chrome }
        : position === 'bl'
          ? { x: chrome, y: -chrome }
          : { x: -chrome, y: -chrome };
  const imageX = clamp(slot.x + inward.x, chrome, Math.max(chrome, box.width - side - chrome));
  const imageY = clamp(slot.y + inward.y, chrome, Math.max(chrome, box.height - side - chrome));
  const outer = { x: imageX - chrome, y: imageY - chrome, size: side + chrome * 2 };
  const source = { x: cx - sourceSize / 2, y: cy - sourceSize / 2, size: sourceSize };
  const connectors = guideOn ? connectorSegments(source, outer) : [];
  const outerCenterX = outer.x + outer.size / 2;
  const outerCenterY = outer.y + outer.size / 2;
  const overlapsCenter = loupe
    ? (cx - outerCenterX) ** 2 + (cy - outerCenterY) ** 2 <= (outer.size / 2) ** 2
    : cx >= outer.x && cx <= outer.x + outer.size && cy >= outer.y && cy <= outer.y + outer.size;
  return {
    style: loupe ? 'loupe' : 'corner',
    position,
    zoom: zoomLevel,
    size: sizeName,
    guide: guideOn,
    center,
    window: { x: imageX, y: imageY, size: side },
    source,
    connectors,
    guideLine: connectors[0] ?? null,
    overlapsCenter,
    split: null,
  };
};

export const aimZoomChromeFor = (project: Project): number =>
  zoomChromeThickness(getAnnotationStyle(annotationStyleOf(project.annotationStyle), ANNOTATION_FRAME_WIDTH));

export const resolveAimZoomFor = (
  project: Project,
  surface: AimZoomSurface,
  language: Language,
): ResolvedAimZoom | null => {
  const zoom = project.cardAimZoom;
  if (!zoom?.enabled) return null;
  return resolveAimZoom(
    aimZoomBox(surface, language),
    zoom,
    aimZoomCenter(project),
    surface,
    aimZoomChromeFor(project),
  );
};

export const aimZoomOverlapWarning = (project: Project): string | null => {
  const zoom = project.cardAimZoom;
  if (!zoom?.enabled || zoom.position === 'auto') return null;
  const surfaces: AimZoomSurface[] =
    project.cardLayout === 'stack' ? ['card-stack', 'x-stack'] : ['card-aim', 'x-aim'];
  const names: string[] = [];
  for (const surface of surfaces) {
    const hit = (['ja', 'en'] as const).some((language) => {
      const layout = resolveAimZoom(
        aimZoomBox(surface, language),
        zoom,
        aimZoomCenter(project),
        surface,
        aimZoomChromeFor(project),
      );
      return layout.style !== 'split' && layout.overlapsCenter;
    });
    if (hit) names.push(surface.startsWith('x-') ? 'X用カード' : '完成カード');
  }
  if (names.length === 0) return null;
  return `${names.join('・')}で、ズーム枠が拡大の中心に重なっています`;
};

export const aimZoomLabelLeft = (layout: ResolvedAimZoom, box: AimZoomBox): string | number =>
  layout.split ? `${(layout.split.imageLeft / box.width) * 100}%` : 0;

export const aimZoomBadgeEdge = (
  layout: ResolvedAimZoom,
  box: AimZoomBox,
): { left: number | string; right: number | string } => {
  if (layout.position === 'br') return { left: 0, right: 'auto' };
  if (layout.split?.panelLeft) {
    return { left: 'auto', right: `${(layout.split.panelSize / box.width) * 100}%` };
  }
  return { left: 'auto', right: 0 };
};

export const aimZoomMetadata = (
  project: Project,
): { enabled: false } | { enabled: true; style: ResolvedAimZoom['style']; position: ResolvedAimZoom['position']; zoom: 3 | 4 | 6; size: 's' | 'm' | 'l' } => {
  const zoom = project.cardAimZoom;
  if (!zoom?.enabled) return { enabled: false };
  const surface = aimZoomSurface(project.cardLayout, 'card');
  const layout = resolveAimZoom(aimZoomBox(surface, 'ja'), zoom, aimZoomCenter(project), surface);
  return {
    enabled: true,
    style: layout.style,
    position: layout.position,
    zoom: layout.zoom,
    size: layout.size,
  };
};
