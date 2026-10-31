import { MONT_LATIN, ZEN_LATIN } from './card-title-latin-widths';
import { MAP_NAMES_JA } from './valorant-labels';
import { captionTextFor, type Language, type Project } from './schema/project';
import { hookFrameRequest } from './thumbnail';

/** 1080×1920 のフォーカス配置（案B）。classic の数値は shared/thumbnail.ts が正。 */
export const THUMB_FOCUS = {
  canvas: { w: 1080, h: 1920 },
  video: { x: 0, y: 150, w: 1080, h: 1130 },
  videoTopFade: { from: 150, to: 290 },
  topGradient: {
    color: '#0F1923',
    stops: [
      [0, 0.9],
      [250, 0.84],
      [430, 0.7],
      [580, 0.32],
      [730, 0],
    ],
  },
  vignette: { cx: 0.5, cy: 0.62, rx: 0.7, ry: 0.6, inner: 0.45, color: '#0F1923', alpha: 0.38 },
  grade: { contrast: 1.08, saturate: 1.15 },
  hook: {
    top: 318,
    left: 90,
    right: 990,
    maxLines: 3,
    align: 'center',
    en: { family: 'Montserrat', weight: 900, size: 96, min: 76, lineHeight: 1.08, uppercase: true },
    ja: { family: 'Zen Kaku Gothic New', weight: 900, size: 84, min: 68, lineHeight: 1.15 },
    shrinkStep: 2,
    stroke: { color: 'rgba(15,25,35,0.95)', outside: 7 },
    shadow: '0 6px 18px rgba(0,0,0,0.65)',
  },
  infoBar: { y: 1280, h: 240 },
  zoom: { min: 1, max: 1.5, step: 0.01, warnUpscale: 1.6 },
} as const;

export const THUMB_SURFACES = {
  ytShelf: {
    aspect: 2 / 3,
    visibleY: [150, 1770],
    titleBand: [1520, 1770],
    menu: { x: [900, 1080], y: [230, 310] },
  },
  ttGrid: { aspect: 3 / 4, visibleY: [240, 1680] },
  importantArea: { x: [72, 1008], y: [318, 1520] },
} as const;

export type ThumbLayout = 'classic' | 'focus';

export type ThumbCrop = { x: number; y: number; w: number; h: number; upscale: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 元フレームから、サムネイル映像矩形へ入れる範囲。小数のまま返す。 */
export const resolveThumbCrop = (
  frame: { w: number; h: number },
  focus: { x: number; y: number },
  zoom: number,
): ThumbCrop => {
  const ratio = THUMB_FOCUS.video.w / THUMB_FOCUS.video.h;
  const z = clamp(zoom, THUMB_FOCUS.zoom.min, THUMB_FOCUS.zoom.max);
  let ch = frame.h / z;
  let cw = ch * ratio;
  if (cw > frame.w) {
    cw = frame.w;
    ch = cw / ratio;
  }
  const x = clamp(focus.x * frame.w - cw / 2, 0, Math.max(0, frame.w - cw));
  const y = clamp(focus.y * frame.h - ch / 2, 0, Math.max(0, frame.h - ch));
  return { x, y, w: cw, h: ch, upscale: THUMB_FOCUS.video.h / ch };
};

export const thumbnailLayoutOf = (project: Project): ThumbLayout =>
  project.thumbnail?.layout === 'focus' ? 'focus' : 'classic';

export const thumbnailFocusOf = (project: Project): { x: number; y: number } =>
  project.thumbnail?.focus ?? { x: 0.5, y: 0.5 };

export const thumbnailZoomOf = (project: Project): number =>
  project.thumbnail?.zoom ?? THUMB_FOCUS.zoom.min;

export type ThumbFrameSource = 'result' | 'custom' | 'legacy';

export type ThumbFramePick = {
  assetId: string;
  timeSec: number;
  source: ThumbFrameSource;
};

const usableAsset = (project: Project, assetId: string) => {
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset || (asset.type !== 'video' && asset.type !== 'image')) return undefined;
  return asset;
};

/**
 * focus の映像。手で選んだフレーム、なければ 03 発動イメージ、それもなければ従来の選び方。
 */
export const resolveFocusFrame = (project: Project): ThumbFramePick | null => {
  const custom = project.thumbnail?.frame;
  if (custom && usableAsset(project, custom.assetId)) {
    return { assetId: custom.assetId, timeSec: custom.timeSec, source: 'custom' };
  }
  const resultId = project.cardStills.result;
  const still = resultId ? project.stills.find((item) => item.id === resultId) : undefined;
  if (still && usableAsset(project, still.assetId)) {
    return { assetId: still.assetId, timeSec: still.frame, source: 'result' };
  }
  const legacy = hookFrameRequest(project);
  if (!legacy) return null;
  const asset = project.assets.find((item) => item.path === legacy.assetPath);
  if (!asset || (asset.type !== 'video' && asset.type !== 'image')) return null;
  return {
    assetId: asset.id,
    timeSec: legacy.kind === 'video' ? legacy.sourceTime : 0,
    source: 'legacy',
  };
};

export const focusFrameSize = (project: Project): { w: number; h: number } | null => {
  const pick = resolveFocusFrame(project);
  if (!pick) return null;
  const asset = project.assets.find((item) => item.id === pick.assetId);
  const w = asset?.meta.width;
  const h = asset?.meta.height;
  if (!w || !h) return null;
  return { w, h };
};

export const focusUpscale = (project: Project): number | null => {
  if (thumbnailLayoutOf(project) !== 'focus') return null;
  const size = focusFrameSize(project);
  if (!size) return null;
  return resolveThumbCrop(size, thumbnailFocusOf(project), thumbnailZoomOf(project)).upscale;
};

const localizedJa = (table: Record<string, string>, id: string): string | undefined => {
  if (table[id]) return table[id];
  const match = Object.entries(table).find(([key]) => key.toLowerCase() === id.toLowerCase());
  return match?.[1];
};

/** サムネイルに描くフック。動画用の resolveVariables と同じ置換。 */
export const resolveThumbHookText = (project: Project, language: Language): string => {
  const hook = project.captions.find((caption) => caption.id === 'hook');
  const raw = hook && !hook.hidden ? captionTextFor(hook, language, 'thumb') : '';
  if (!raw) return '';
  const lineup = project.lineup;
  const mapJa = localizedJa(MAP_NAMES_JA, lineup.map);
  const values: Record<string, string> = {
    map: language === 'ja' ? (mapJa ?? lineup.map) : lineup.map.toUpperCase(),
    site: language === 'ja' ? `${lineup.site}サイト` : `${lineup.site} SITE`,
    side:
      language === 'ja'
        ? lineup.side === 'attack'
          ? '攻め'
          : '守り'
        : lineup.side.toUpperCase(),
    agent: lineup.agent.toUpperCase(),
    ability: lineup.ability.replaceAll('-', ' ').toUpperCase(),
    throwType: lineup.throwType[language],
    charge: language === 'ja' ? `チャージ ${lineup.charge ?? 0}` : `CHARGE ${lineup.charge ?? 0}`,
    bounce: language === 'ja' ? `バウンス ${lineup.bounce ?? 0}` : `BOUNCE ${lineup.bounce ?? 0}`,
    standDescription: lineup.standDescription[language],
    aimDescription: lineup.aimDescription[language],
    br: '\n',
  };
  return raw.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? `{${key}}`);
};

export type ThumbHookRun = { text: string; accent: boolean };
export type ThumbHookFit = { fontSize: number; lines: ThumbHookRun[][]; warning: boolean };

type Glyph = { ch: string; accent: boolean };

const NO_START = new Set(
  Array.from('、。，．・：；？！ヽヾゝゞ々ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ）」』】〕〉》］｝〗〙〛'),
);
const NO_END = new Set(Array.from('「『【〔〈《［｛〖〘〚（'));
const isLatinWordChar = (ch: string): boolean => /[A-Za-z0-9]/.test(ch);

const canBreakBefore = (previous: string, ch: string): boolean => {
  if (NO_START.has(ch) || NO_END.has(previous)) return false;
  if (isLatinWordChar(previous) && isLatinWordChar(ch)) return false;
  return true;
};

const glyphsOf = (paragraph: string, uppercase: boolean): Glyph[] => {
  const glyphs: Glyph[] = [];
  for (const part of paragraph.split(/(\[[^\]]+\])/g)) {
    if (!part) continue;
    const accent = part.startsWith('[') && part.endsWith(']');
    const body = accent ? part.slice(1, -1) : part;
    const shown = uppercase ? body.toLocaleUpperCase() : body;
    for (const ch of shown) glyphs.push({ ch, accent });
  }
  return glyphs;
};

const wrapGlyphs = (
  glyphs: Glyph[],
  fontSize: number,
  limit: number,
  table: Record<string, number>,
): Glyph[][] => {
  if (glyphs.length === 0) return [[]];
  const widthOf = (index: number): number => (table[glyphs[index]?.ch ?? ''] ?? 1) * fontSize;
  const lines: Glyph[][] = [];
  let start = 0;
  let used = 0;
  for (let index = 0; index < glyphs.length; index += 1) {
    const width = widthOf(index);
    if (used > 0 && used + width > limit) {
      let breakAt = index;
      const previous = glyphs[index - 1]?.ch ?? '';
      const here = glyphs[index]?.ch ?? '';
      if (!canBreakBefore(previous, here)) {
        for (let cursor = index; cursor > start; cursor -= 1) {
          const left = glyphs[cursor - 1]?.ch ?? '';
          const right = glyphs[cursor]?.ch ?? '';
          if (canBreakBefore(left, right)) {
            breakAt = cursor;
            break;
          }
        }
      }
      if (breakAt <= start) breakAt = index;
      while (breakAt < glyphs.length && (glyphs[breakAt]?.ch === ' ' || glyphs[breakAt]?.ch === '\u3000')) {
        breakAt += 1;
      }
      const row = trimEdgeSpaces(glyphs.slice(start, breakAt));
      if (row.length > 0) lines.push(row);
      if (breakAt >= glyphs.length) return lines;
      start = breakAt;
      used = 0;
      index = breakAt - 1;
      continue;
    }
    used += width;
  }
  const tail = trimEdgeSpaces(glyphs.slice(start));
  if (tail.length > 0 || lines.length === 0) lines.push(tail);
  return lines;
};

const trimEdgeSpaces = (glyphs: Glyph[]): Glyph[] => {
  let start = 0;
  let end = glyphs.length;
  while (start < end && (glyphs[start]?.ch === ' ' || glyphs[start]?.ch === '\u3000')) start += 1;
  while (end > start && (glyphs[end - 1]?.ch === ' ' || glyphs[end - 1]?.ch === '\u3000')) end -= 1;
  return glyphs.slice(start, end);
};

const runsOf = (glyphs: Glyph[]): ThumbHookRun[] => {
  const runs: ThumbHookRun[] = [];
  for (const glyph of glyphs) {
    const last = runs[runs.length - 1];
    if (last && last.accent === glyph.accent) last.text += glyph.ch;
    else runs.push({ text: glyph.ch, accent: glyph.accent });
  }
  return runs;
};

const layoutHook = (text: string, language: Language, fontSize: number): ThumbHookRun[][] => {
  const spec = language === 'en' ? THUMB_FOCUS.hook.en : THUMB_FOCUS.hook.ja;
  const table = language === 'en' ? MONT_LATIN : ZEN_LATIN;
  const uppercase = 'uppercase' in spec && spec.uppercase === true;
  const paragraphs = text.replaceAll('\r\n', '\n').split('\n');
  const lines: ThumbHookRun[][] = [];
  for (const paragraph of paragraphs) {
    for (const row of wrapGlyphs(glyphsOf(paragraph, uppercase), fontSize, THUMB_FOCUS.hook.right - THUMB_FOCUS.hook.left, table)) {
      lines.push(runsOf(row));
    }
  }
  return lines;
};

/** 3行に収まるまで縮める。最小でも収まらなければ3行で切り、warning を返す。 */
export const fitFocusHook = (text: string, language: Language): ThumbHookFit => {
  const spec = language === 'en' ? THUMB_FOCUS.hook.en : THUMB_FOCUS.hook.ja;
  const trimmed = text.replaceAll('\r\n', '\n');
  if (!trimmed.trim()) return { fontSize: spec.size, lines: [], warning: false };
  for (let fontSize = spec.size; fontSize >= spec.min; fontSize -= THUMB_FOCUS.hook.shrinkStep) {
    const lines = layoutHook(trimmed, language, fontSize);
    if (lines.length <= THUMB_FOCUS.hook.maxLines) return { fontSize, lines, warning: false };
  }
  const lines = layoutHook(trimmed, language, spec.min);
  return {
    fontSize: spec.min,
    lines: lines.slice(0, THUMB_FOCUS.hook.maxLines),
    warning: lines.length > THUMB_FOCUS.hook.maxLines,
  };
};

export const focusHookWarning = (project: Project, language: Language): boolean => {
  if (thumbnailLayoutOf(project) !== 'focus') return false;
  return fitFocusHook(resolveThumbHookText(project, language), language).warning;
};

const roundCrop = (value: number): number => Math.round(value);

/** meta.json の thumbnail。classic は layout だけ。 */
export const thumbnailExportMeta = (
  project: Project,
  language: Language,
): Record<string, unknown> => {
  if (thumbnailLayoutOf(project) !== 'focus') return { layout: 'classic' };
  const pick = resolveFocusFrame(project);
  const size = focusFrameSize(project);
  const focus = thumbnailFocusOf(project);
  const zoom = thumbnailZoomOf(project);
  const fit = fitFocusHook(resolveThumbHookText(project, language), language);
  const body: Record<string, unknown> = {
    layout: 'focus',
    focus: { x: focus.x, y: focus.y },
    zoom,
    hookFontPx: fit.fontSize,
  };
  if (pick) {
    body.frame = {
      assetId: pick.assetId,
      timeSec: Math.round(pick.timeSec * 1000) / 1000,
      source: pick.source,
    };
  }
  if (size) {
    const crop = resolveThumbCrop(size, focus, zoom);
    body.crop = { x: roundCrop(crop.x), y: roundCrop(crop.y), w: roundCrop(crop.w), h: roundCrop(crop.h) };
  }
  return body;
};

export const thumbnailLayoutLabel = (layout: ThumbLayout | undefined): string =>
  layout === 'focus' ? 'フォーカス' : '従来';
