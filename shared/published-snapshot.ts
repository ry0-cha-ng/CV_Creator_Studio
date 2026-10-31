import type { Project, SceneKey } from './schema/project';
import {
  publishedSnapshotSchema,
  type PublishedScene,
  type PublishedSnapshot,
  type SceneMeaning,
} from './schema/published';
import { likeCtaActive, resolveCtaDesign, resolveLikeCtaText, S4_CTA_HOLD_SEC } from './s4-cta';
import { activeTimeline } from './timeline';

const MEANING: Record<SceneKey, { meaning: SceneMeaning; label: string }> = {
  hook: { meaning: 'hook', label: 'フック' },
  stand: { meaning: 'stand', label: '立ち位置' },
  aim: { meaning: 'aim', label: '狙う場所' },
  throw: { meaning: 'throw', label: '投げ方' },
  card: { meaning: 'card', label: '完成カード' },
  demo: { meaning: 'success', label: '成功場面' },
  loop: { meaning: 'loop', label: 'ループ' },
};

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export type PublishedExportRecord = {
  exportId: string;
  project: Project;
  basename: string;
  renderedDurationSec: number;
  language: 'ja' | 'en';
  frozenAt: string;
};

/** 0 <= start < end <= duration を満たすシーンだけ残す。 */
export const acceptedScenes = (scenes: PublishedScene[], durationSec: number): PublishedScene[] =>
  scenes.flatMap((scene, index) => {
    const startSec = round3(Math.max(0, scene.startSec));
    const endSec = round3(Math.min(scene.endSec, durationSec));
    if (!(startSec < endSec)) return [];
    return [{ ...scene, order: index, startSec, endSec }];
  });

export const snapshotFromProject = (input: {
  exportId: string;
  project: Project;
  source: 'export' | 'estimate';
  frozenAt: string;
  lang?: 'ja' | 'en';
  basename?: string;
  postId?: string;
  renderedDurationSec?: number;
}): PublishedSnapshot => {
  const project = input.project;
  const timeline = activeTimeline(project);
  const durationSec = round3(timeline.durationSec);
  const lang = input.lang ?? 'en';
  const hidden = Boolean(project.timelineMix?.hideCaptions) || Boolean(project.captions.find((caption) => caption.id === 'cta')?.hidden);
  const design = resolveCtaDesign(project);
  const like = !hidden && likeCtaActive(project, 'youtube');
  const scenes: PublishedScene[] = [];
  for (const item of timeline.items) {
    const meta = MEANING[item.sceneKey];
    const startSec = round3(item.start);
    const endSec = round3(Math.min(item.start + item.duration, durationSec));
    if (!(startSec >= 0 && startSec < endSec)) continue;
    scenes.push({
      id: `${input.exportId}:${item.sceneKey}`,
      meaning: meta.meaning,
      label: meta.label,
      order: scenes.length,
      startSec,
      endSec,
      source: input.source,
    });
  }
  let ctaMode = 'none';
  let ctaText: string | undefined;
  let ctaMotion: boolean | undefined;
  if (!hidden && design === 's4-block') {
    const throwScene = scenes.find((scene) => scene.meaning === 'throw');
    if (throwScene) {
      const hold = Math.min(S4_CTA_HOLD_SEC, throwScene.endSec - throwScene.startSec);
      const startSec = round3(throwScene.endSec - hold);
      if (startSec < throwScene.endSec) {
        scenes.push({
          id: `${input.exportId}:cta`,
          meaning: 'cta',
          label: like ? '高評価CTA' : 'CTA',
          order: scenes.length,
          startSec,
          endSec: throwScene.endSec,
          source: input.source,
        });
      }
    }
    ctaMode = like ? 'like' : 's4-block';
    if (like) {
      const text = resolveLikeCtaText(project);
      ctaText = text.line1[lang];
      ctaMotion = text.motion !== false;
    } else {
      ctaText = project.templateParams.s4Cta?.main[lang];
    }
  } else if (!hidden && design === 's7-band') {
    const loop = scenes.find((scene) => scene.meaning === 'loop');
    if (loop) {
      scenes.push({
        id: `${input.exportId}:cta`,
        meaning: 'cta',
        label: 'CTA',
        order: scenes.length,
        startSec: loop.startSec,
        endSec: loop.endSec,
        source: input.source,
      });
    }
    ctaMode = 's7-band';
    ctaText = project.captions.find((caption) => caption.id === 'cta')?.text[lang];
  }
  const notes: string[] = [];
  if (input.source === 'estimate') {
    notes.push('現在のプロジェクトから推定しました。投稿後に編集していると、当時の構成と違うことがあります。');
  }
  if (input.renderedDurationSec !== undefined && Math.abs(input.renderedDurationSec - durationSec) > 0.25) {
    notes.push('書き出した動画の尺と、シーン時刻の基準にした構成の尺が違います。');
  }
  const hook = project.captions.find((caption) => caption.id === 'hook');
  return publishedSnapshotSchema.parse({
    exportId: input.exportId,
    postId: input.postId,
    projectId: project.id,
    basename: input.basename,
    lang: input.lang,
    source: input.source,
    needsReview: input.source === 'estimate',
    frozenAt: input.frozenAt,
    durationSec,
    renderedDurationSec: input.renderedDurationSec,
    templateId: project.templateId,
    templateVersion: project.structureTemplateId ?? project.templateId,
    hookPattern: project.hookPattern,
    hookText: hook?.text[lang],
    openingType: project.analytics.openingType,
    ctaMode,
    ctaText,
    ctaMotion,
    map: project.lineup.map,
    agent: project.lineup.agent,
    note: notes.join(' ') || undefined,
    scenes: acceptedScenes(scenes, durationSec),
  });
};

export const emptyEstimate = (input: {
  postId: string;
  projectId?: string;
  frozenAt: string;
  durationSec?: number;
  templateId?: string;
  hookPattern?: string;
}): PublishedSnapshot =>
  publishedSnapshotSchema.parse({
    exportId: `estimate:${input.postId}`,
    postId: input.postId,
    projectId: input.projectId,
    source: 'estimate',
    needsReview: true,
    frozenAt: input.frozenAt,
    durationSec: input.durationSec ?? 0,
    templateId: input.templateId ?? '',
    templateVersion: input.templateId ?? '',
    hookPattern: input.hookPattern ?? '',
    note: '制作時のシーン時刻が残っていないため、シーンは空です。',
    scenes: [],
  });

export const BIND_WINDOW_MS = 48 * 60 * 60 * 1000;

/** 投稿日時に一番近い、まだどの投稿にも付いていない書き出し版。48時間より離れていたら付けない。 */
export const nearestExport = (
  snapshots: PublishedSnapshot[],
  post: { postedAt: string; lang?: 'ja' | 'en' },
): PublishedSnapshot | undefined => {
  const posted = new Date(post.postedAt).getTime();
  if (Number.isNaN(posted)) return undefined;
  let best: { snapshot: PublishedSnapshot; delta: number } | undefined;
  for (const snapshot of snapshots) {
    if (snapshot.source !== 'export' || snapshot.postId) continue;
    if (snapshot.lang && post.lang && snapshot.lang !== post.lang) continue;
    const frozen = new Date(snapshot.frozenAt).getTime();
    if (Number.isNaN(frozen)) continue;
    const delta = Math.abs(frozen - posted);
    if (delta > BIND_WINDOW_MS) continue;
    if (!best || delta < best.delta) best = { snapshot, delta };
  }
  return best?.snapshot;
};
