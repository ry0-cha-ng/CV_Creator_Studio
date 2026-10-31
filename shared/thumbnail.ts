import { sceneSourceTime } from './aim-marker';
import { S7_FRAME } from './s7-cta';
import type { Project } from './schema/project';
import type { SceneKey } from './schema/project-keys';
import { activeTimeline, playbackClip, playbackSceneKey, playedSourceWindow, SCENE_BAND } from './timeline';
import { getAbilityCardIconPath, getAgentCardIconPath } from './valorant-catalog';

/**
 * 1080×1920 サムネイル（A案）。
 * 映像窓は 16:9 で下部帯に接する。背景はプレイ画面のぼかし。
 */
export const THUMBNAIL = {
  width: S7_FRAME.width,
  height: S7_FRAME.height,
  hookTop: 300,
  hookSide: 36,
  hookFontSize: 80,
  hookLineHeight: 1.2,
  /** 3行まで。映像窓に掛かるときだけ上へ寄せる。 */
  hookMaxLines: 3,
  hookClearance: 32,
  footageTop: 668,
  footageHeight: S7_FRAME.footageHeight,
  badgeTop: 1276,
  badgeHeight: 240,
  agentWidth: 224,
  abilityWidth: 160,
  abilitySize: 148,
  infoGap: 24,
  sideFontSize: 48,
  sidePadX: 24,
  sideTracking: 0.04,
  labelMax: 64,
  labelMin: 40,
  labelTracking: 0.02,
} as const;

const SIDE_CHAR_EM = 0.72;
const sideChipWidth =
  3 * SIDE_CHAR_EM * THUMBNAIL.sideFontSize +
  THUMBNAIL.sideTracking * THUMBNAIL.sideFontSize * 2 +
  THUMBNAIL.sidePadX * 2;

/** 攻守バッジとスキルアイコンを除いた、マップ名に使える幅。 */
export const THUMBNAIL_LABEL_MAX_WIDTH =
  THUMBNAIL.width - THUMBNAIL.agentWidth - THUMBNAIL.abilityWidth - THUMBNAIL.infoGap - sideChipWidth;

const LABEL_CHAR_EM = 0.8;
const LABEL_SPACE_EM = 0.34;

export const thumbnailLabelWidth = (text: string, fontSize: number): number => {
  let width = 0;
  for (const char of text) {
    width += (char === ' ' ? LABEL_SPACE_EM : LABEL_CHAR_EM) * fontSize;
  }
  if (text.length > 1) width += THUMBNAIL.labelTracking * fontSize * (text.length - 1);
  return width;
};

export const fitThumbnailLabel = (label: string): { fontSize: number; text: string } => {
  const trimmed = label.trim();
  if (!trimmed) return { fontSize: THUMBNAIL.labelMax, text: '' };
  for (let fontSize = THUMBNAIL.labelMax; fontSize >= THUMBNAIL.labelMin; fontSize -= 1) {
    if (thumbnailLabelWidth(trimmed, fontSize) <= THUMBNAIL_LABEL_MAX_WIDTH) {
      return { fontSize, text: trimmed };
    }
  }
  let text = trimmed;
  while (text.length > 0 && thumbnailLabelWidth(`${text}…`, THUMBNAIL.labelMin) > THUMBNAIL_LABEL_MAX_WIDTH) {
    text = text.slice(0, -1).trimEnd();
  }
  return {
    fontSize: THUMBNAIL.labelMin,
    text: text.length < trimmed.length ? `${text}…` : text,
  };
};

export const thumbnailMapLabel = (map: string, site: string): string =>
  `${map} ${site}`.trim().toLocaleUpperCase();

const HOOK_FIT_LIMIT = 1.18;

const hookUnit = (char: string): number => {
  if (char === ' ' || char === '\u3000') return 0.33;
  if (/^[A-Z0-9]$/.test(char)) return 0.72;
  if (/^[a-z]$/.test(char)) return 0.56;
  if (/^[=+\-.,!?:;'"/]$/.test(char)) return 0.42;
  return 1;
};

const hookLineUnits = (line: string): number => {
  let units = 0;
  for (const char of line) units += hookUnit(char);
  return units;
};

/**
 * 見出しの文字サイズ。A案の80pxを基本にし、
 * 少しはみ出す行だけ縮めて、著者の改行を守る。大きく超える行は80pxのまま折り返す。
 */
export const fitThumbnailHookFontSize = (text: string): number => {
  const available = THUMBNAIL.width - THUMBNAIL.hookSide * 2;
  const lines = text.replaceAll('\r\n', '\n').replaceAll(/[[\]]/g, '').toLocaleUpperCase().split('\n');
  const units = Math.max(0, ...lines.map(hookLineUnits));
  if (units <= 0) return THUMBNAIL.hookFontSize;
  const natural = units * THUMBNAIL.hookFontSize;
  if (natural <= available || natural / available > HOOK_FIT_LIMIT) return THUMBNAIL.hookFontSize;
  return Math.max(48, Math.floor((available / units) * 0.96));
};

/** サムネイルの見出し。著者の改行を最大3行まで残す。書き出しでも line-clamp に頼らない。 */
export const thumbnailHookLines = (text: string): string[] =>
  text.replaceAll('\r\n', '\n').split('\n').slice(0, THUMBNAIL.hookMaxLines);

/** サムネイルの見出し。A案の位置に置き、3行でも映像窓の手前で止める。 */
export const thumbnailHookLayout = (
  text: string,
  fontSize: number = THUMBNAIL.hookFontSize,
): { top: number; maxLines: number; maxHeight: number } => {
  const lines = Math.min(THUMBNAIL.hookMaxLines, Math.max(1, thumbnailHookLines(text).length));
  const lineBox = fontSize * THUMBNAIL.hookLineHeight;
  const maxHeight = Math.ceil(lineBox * THUMBNAIL.hookMaxLines);
  const blockHeight = lines >= THUMBNAIL.hookMaxLines ? maxHeight : lineBox * lines;
  return {
    top: Math.min(THUMBNAIL.hookTop, THUMBNAIL.footageTop - THUMBNAIL.hookClearance - blockHeight),
    maxLines: THUMBNAIL.hookMaxLines,
    maxHeight,
  };
};

/** 複数語は各語の頭文字。1語は先頭2文字。 */
export const abilityAbbreviation = (ability: string): string => {
  const words = ability
    .trim()
    .split(/[\s\-_/]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toLocaleUpperCase();
  return words.map((word) => word.slice(0, 1).toLocaleUpperCase()).join('');
};

export const agentInitial = (agent: string): string => {
  const trimmed = agent.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toLocaleUpperCase();
};

export type HookFrameRequest =
  | { kind: 'image'; assetPath: string }
  | { kind: 'video'; assetPath: string; sourceTime: number };

const clock = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
};

const sceneBand = (sceneKey: SceneKey): string => SCENE_BAND[sceneKey];

const hookStartRequest = (project: Project): HookFrameRequest | null => {
  const scene = project.scenes.find((item) => item.sceneKey === 'hook');
  const clip = project.clips.find((item) => item.id === scene?.clipId);
  const asset = project.assets.find((item) => item.id === clip?.assetId);
  if (!clip || !asset) return null;
  if (asset.type === 'image') return { kind: 'image', assetPath: asset.path };
  if (asset.type !== 'video') return null;
  const item = activeTimeline(project).items.find((entry) => entry.sceneKey === 'hook');
  const offset = item?.sourceOffset ?? 0;
  const start = Math.max(0, clip.in + offset);
  const end = Math.max(clip.in, clip.out - 0.001);
  return {
    kind: 'video',
    assetPath: asset.path,
    sourceTime: Math.min(start, end),
  };
};

const customFrameRequest = (project: Project): HookFrameRequest | null => {
  const frame = project.thumbnailFrame;
  if (!frame) return null;
  const asset = project.assets.find((item) => item.id === frame.assetId);
  if (!asset) return null;
  if (asset.type === 'image') return { kind: 'image', assetPath: asset.path };
  if (asset.type !== 'video') return null;
  return { kind: 'video', assetPath: asset.path, sourceTime: frame.sourceTime };
};

/** 指定があればその位置、なければフックの先頭。 */
export const hookFrameRequest = (project: Project): HookFrameRequest | null =>
  customFrameRequest(project) ?? hookStartRequest(project);

export type ThumbnailSource = {
  assetId: string;
  sourceTime: number;
  sceneKey: SceneKey;
};

/** 完成動画の再生位置を、サムネイルに使える元映像の時刻へ戻す。カードは元映像がない。 */
export const thumbnailSourceAt = (project: Project, seconds: number): ThumbnailSource | null => {
  if (!Number.isFinite(seconds)) return null;
  const timeline = activeTimeline(project);
  const item = timeline.items.find((entry) => seconds >= entry.start && seconds < entry.start + entry.duration);
  if (!item || item.sceneKey === 'card') return null;
  const sceneKey = playbackSceneKey(project, item.sceneKey);
  const scene = project.scenes.find((entry) => entry.sceneKey === sceneKey);
  const clip = playbackClip(project, item.sceneKey);
  const asset = clip ? project.assets.find((entry) => entry.id === clip.assetId) : undefined;
  if (!scene || !clip || !asset) return null;
  if (asset.type === 'image') return { assetId: asset.id, sourceTime: 0, sceneKey: item.sceneKey };
  if (asset.type !== 'video') return null;
  const fps = project.templateParams.fps;
  const localFrame = Math.max(0, Math.round((seconds - item.start) * fps));
  const fromClipStart = sceneSourceTime(
    localFrame,
    fps,
    clip.id === 'loop-before-hook' ? { freeze: undefined } : scene,
    item,
  );
  const sourceTime = Math.min(
    Math.max(0, clip.in + fromClipStart),
    Math.max(clip.in, clip.out - 0.001),
  );
  return {
    assetId: asset.id,
    sourceTime: Math.round(sourceTime * 1000) / 1000,
    sceneKey: item.sceneKey,
  };
};

const sceneForThumbnail = (project: Project): string | null => {
  const frame = project.thumbnailFrame;
  if (!frame) return null;
  const timeline = activeTimeline(project);
  for (const item of timeline.items) {
    if (item.sceneKey === 'card') continue;
    const clip = playbackClip(project, item.sceneKey);
    if (!clip || clip.assetId !== frame.assetId) continue;
    if (project.assets.find((entry) => entry.id === clip.assetId)?.type === 'image') {
      return sceneBand(item.sceneKey);
    }
    const window = playedSourceWindow(clip, item);
    if (!window) continue;
    if (frame.sourceTime + 1e-3 >= window.in && frame.sourceTime <= window.out + 1e-3) {
      return sceneBand(item.sceneKey);
    }
  }
  return null;
};

/** サムネイル映像がフック先頭か、指定位置か。 */
export const thumbnailFrameStatus = (project: Project): string => {
  const frame = project.thumbnailFrame;
  if (!frame) return '映像はフックの先頭です。再生を止めた位置に差し替えられます';
  const asset = project.assets.find((item) => item.id === frame.assetId);
  if (!asset || (asset.type !== 'video' && asset.type !== 'image')) {
    return '指定した映像がないため、フックの先頭を使います';
  }
  if (asset.type === 'image') {
    const scene = sceneForThumbnail(project);
    return scene ? `映像は${scene}の画像です` : '映像は指定した画像です';
  }
  const scene = sceneForThumbnail(project);
  const where = scene ? `${scene} ${clock(frame.sourceTime)}` : clock(frame.sourceTime);
  return `映像は指定した位置（${where}）です`;
};

/** 画像が無いときは警告。書き出しは文字で続ける。 */
export const thumbnailIconWarning = (project: Project): string | null => {
  const missing: string[] = [];
  if (!getAgentCardIconPath(project.lineup.agent)) missing.push('エージェント');
  if (!getAbilityCardIconPath(project.lineup.agent, project.lineup.ability)) missing.push('スキル');
  if (missing.length === 0) return null;
  return `${missing.join('と')}の画像がないため、サムネイルは文字で代替します`;
};
