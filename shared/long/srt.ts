import { captionDraft } from './commands';
import type { IdFactory } from './ids';
import { resolveAnchor, resolveTimeline } from './render-plan';
import type { Anchor, Caption, CaptionKind, LongLanguage, LongProject, MainPlacement } from './schema';
import { parseSrtTime, type Ticks } from './time';

/**
 * SRT の取り込み。
 * BOM・CRLF・番号の欠落・「,」「.」どちらのミリ秒にも対応し、読めないブロックは理由を付けて返す。
 */

export type SrtCue = { index: number; start: Ticks; end: Ticks; text: string };
export type SrtProblem = { block: number; line: number; message: string };
export type SrtParseResult = { cues: SrtCue[]; problems: SrtProblem[] };

const TIMING = /^\s*([0-9:.,]+)\s*-->\s*([0-9:.,]+)/;

export const parseSrt = (input: string): SrtParseResult => {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const cues: SrtCue[] = [];
  const problems: SrtProblem[] = [];
  let block = 0;
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && lines[index]!.trim() === '') index += 1;
    if (index >= lines.length) break;
    block += 1;
    const blockStart = index;
    const blockLines: string[] = [];
    while (index < lines.length && lines[index]!.trim() !== '') {
      blockLines.push(lines[index]!);
      index += 1;
    }
    let cursor = 0;
    let number = cues.length + 1;
    if (/^\s*\d+\s*$/.test(blockLines[0]!) && blockLines.length > 1 && TIMING.test(blockLines[1]!)) {
      number = Number(blockLines[0]!.trim());
      cursor = 1;
    }
    const timing = TIMING.exec(blockLines[cursor] ?? '');
    if (!timing) {
      problems.push({ block, line: blockStart + cursor + 1, message: '時刻の行（00:00:01,000 --> 00:00:02,000）がありません' });
      continue;
    }
    const start = parseSrtTime(timing[1]!);
    const end = parseSrtTime(timing[2]!);
    if (start === null || end === null) {
      problems.push({ block, line: blockStart + cursor + 1, message: `時刻を読めません：${blockLines[cursor]!.trim()}` });
      continue;
    }
    if (end <= start) {
      problems.push({ block, line: blockStart + cursor + 1, message: '終了が開始より前か同じです' });
      continue;
    }
    const body = blockLines
      .slice(cursor + 1)
      .map((line) => line.replace(/<\/?[ibu]>/gi, '').replace(/<font[^>]*>|<\/font>/gi, '').replace(/\{\\[^}]*\}/g, '').trimEnd())
      .join('\n')
      .trim();
    if (!body) {
      problems.push({ block, line: blockStart + cursor + 2, message: '字幕の文字がありません' });
      continue;
    }
    cues.push({ index: number, start, end, text: body });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return { cues, problems };
};

/**
 * 取り込みの基準。
 * project・chapter・scene は、その先頭を 0 とする完成動画の時刻。
 * asset は録画の素材時刻。同じ録画を使う配置へ、素材時刻で振り分ける（配置の移動・速度変更に追従する）。
 */
export type SrtBase =
  | { kind: 'project' }
  | { kind: 'chapter'; chapterId: string }
  | { kind: 'scene'; sceneId: string }
  | { kind: 'asset'; assetId: string };

export type SrtImportOptions = {
  base: SrtBase;
  /** 全体をずらす量（負も可） */
  shift: Ticks;
  language: LongLanguage;
  kind: Extract<CaptionKind, 'speech' | 'explain'>;
  /** new：新しい字幕として追加／translate：開始が近い既存の字幕に訳として入れる */
  mode: 'new' | 'translate';
  /** translate のときの許容差 */
  tolerance?: Ticks;
};

export const SRT_TRANSLATE_TOLERANCE: Ticks = 60_000; // 0.5秒

export type SrtPlanItem =
  | { cue: SrtCue; action: 'add'; anchor: Anchor; at: Ticks; duration: Ticks; sceneId?: string; note?: string }
  | { cue: SrtCue; action: 'translate'; at: Ticks; captionId: string }
  | { cue: SrtCue; action: 'skip'; reason: string };

const REASON: Record<string, string> = {
  missing: '基準の章・シーンが見つかりません',
  disabled: '基準の章・シーンが無効です',
  'out-of-range': '配置の範囲外です',
};

/** 取り込みの計画（プレビューに出し、確定したら applySrtImport で反映する） */
export const planSrtImport = (project: LongProject, cues: SrtCue[], options: SrtImportOptions): SrtPlanItem[] => {
  const timeline = resolveTimeline(project);
  const tolerance = options.tolerance ?? SRT_TRANSLATE_TOLERANCE;
  // 素材基準：その録画を使う主配置（完成動画の順）
  const mains =
    options.base.kind === 'asset'
      ? timeline.scenes
          .map((scene) => Object.values(timeline.mains).find((main) => main.sceneId === scene.id))
          .filter((main): main is NonNullable<typeof main> => Boolean(main))
          .map((main) => project.placements.find((item): item is MainPlacement => item.id === main.placementId && item.role === 'main'))
          .filter((placement): placement is MainPlacement => Boolean(placement) && placement!.assetId === (options.base as { assetId: string }).assetId)
      : [];
  // 訳の照合先：同じ種類の既存字幕の、完成動画での開始時刻
  const targets =
    options.mode === 'translate'
      ? project.captions
          .filter((caption) => caption.kind === options.kind)
          .map((caption) => {
            const resolved = resolveAnchor(project, timeline, caption.anchor);
            return resolved.ok ? { id: caption.id, at: resolved.ticks } : null;
          })
          .filter((item): item is { id: string; at: Ticks } => item !== null)
      : [];
  const used = new Set<string>();
  const end = (() => {
    if (options.base.kind === 'scene') return timeline.sceneIndex[options.base.sceneId]?.end;
    if (options.base.kind === 'chapter') return timeline.chapterIndex[options.base.chapterId]?.end;
    return timeline.total;
  })();

  return cues.map((cue): SrtPlanItem => {
    const offset = cue.start + options.shift;
    if (offset < 0) return { cue, action: 'skip', reason: '基準より前になります' };
    let anchor: Anchor;
    let sceneId: string | undefined;
    let duration = cue.end - cue.start;
    if (options.base.kind === 'asset') {
      const placement = mains.find((item) => offset >= item.sourceIn && offset < item.sourceOut);
      if (!placement) return { cue, action: 'skip', reason: 'この録画を使っている区間の外です' };
      anchor = { kind: 'source', placementId: placement.id, ticks: offset };
      sceneId = placement.sceneId;
      duration = Math.max(1, Math.round(duration / placement.speed));
    } else if (options.base.kind === 'chapter') {
      anchor = { kind: 'chapter', chapterId: options.base.chapterId, offset };
    } else if (options.base.kind === 'scene') {
      anchor = { kind: 'scene', sceneId: options.base.sceneId, offset };
      sceneId = options.base.sceneId;
    } else {
      anchor = { kind: 'project', ticks: offset };
    }
    const resolved = resolveAnchor(project, timeline, anchor);
    if (!resolved.ok) return { cue, action: 'skip', reason: REASON[resolved.reason] ?? '位置を決められません' };
    if (options.mode === 'translate') {
      let best: { id: string; distance: number } | null = null;
      for (const target of targets) {
        if (used.has(target.id)) continue;
        const distance = Math.abs(target.at - resolved.ticks);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { id: target.id, distance };
      }
      if (!best) return { cue, action: 'skip', reason: '開始が近い字幕がありません（±0.5秒）' };
      used.add(best.id);
      return { cue, action: 'translate', at: resolved.ticks, captionId: best.id };
    }
    const note = end !== undefined && resolved.ticks >= end ? '基準の章・シーンより後ろです（そのまま追加します）' : undefined;
    return { cue, action: 'add', anchor, at: resolved.ticks, duration, sceneId, note };
  });
};

/** 計画を Project に反映する（1回の編集として呼ぶ） */
export const applySrtImport = (
  project: LongProject,
  items: SrtPlanItem[],
  options: SrtImportOptions,
  ids: IdFactory,
): { project: LongProject; added: number; translated: number } => {
  const added: Caption[] = [];
  const translations = new Map<string, string>();
  for (const item of items) {
    if (item.action === 'add') {
      const caption = captionDraft(ids, options.kind, item.anchor, item.duration, item.sceneId);
      caption.text = { [options.language]: item.cue.text };
      added.push(caption);
    } else if (item.action === 'translate') {
      translations.set(item.captionId, item.cue.text);
    }
  }
  return {
    project: {
      ...project,
      captions: [
        ...project.captions.map((caption) =>
          translations.has(caption.id) ? { ...caption, text: { ...caption.text, [options.language]: translations.get(caption.id)! } } : caption,
        ),
        ...added,
      ],
    },
    added: added.length,
    translated: translations.size,
  };
};
