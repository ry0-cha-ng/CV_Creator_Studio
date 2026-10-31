import { useMemo } from 'react';
import { buildRenderPlan, resolveTimeline, type AudioTrackRef, type RenderPlan, type ResolvedTimeline } from '../../shared/long/render-plan';
import type { LongProject } from '../../shared/long/schema';
import { frameToTicks, ticksToFrame, type Ticks } from '../../shared/long/time';
import type { AudioTrack } from '../../shared/schema/audio';
import { useStudioStore } from '../store';
import { useLongStore } from './store';

export const STUDIO_MEDIA = 'studio-media://root';

export const studioUrl = (relativePath: string): string =>
  `${STUDIO_MEDIA}/${relativePath.split(/[\\/]/).map(encodeURIComponent).join('/')}`;

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const tracksMap = (tracks: AudioTrack[]): Record<string, AudioTrackRef> =>
  Object.fromEntries(tracks.map((track) => [track.id, { filePath: track.filePath, durationSec: track.durationSec }]));

/** 現在の Project と言語から描画計画を作る（プレビューと書き出しで同じ関数） */
export const useLongPlan = (): { plan: RenderPlan | null; timeline: ResolvedTimeline | null } => {
  const project = useLongStore((state) => state.project);
  const language = useLongStore((state) => state.language);
  const audioTracks = useStudioStore((state) => state.audioTracks);
  const tracks = useMemo(() => tracksMap(audioTracks), [audioTracks]);
  return useMemo(() => {
    if (!project) return { plan: null, timeline: null };
    return {
      // SRTのみの設定では焼き込まないため、プレビューも出力と同じく字幕を出さない
      plan: buildRenderPlan(project, { language, tracks, captionsOff: project.output.captionMode === 'srt' }),
      timeline: resolveTimeline(project),
    };
  }, [project, language, tracks]);
};

export const fpsOf = (project: LongProject): number => project.output.fps;
export const toFrame = (project: LongProject, ticks: Ticks): number => ticksToFrame(ticks, project.output.fps);
export const toTicks = (project: LongProject, frame: number): Ticks => frameToTicks(frame, project.output.fps);

export const formatMinSec = (ticks: Ticks): string => {
  const total = Math.max(0, Math.round(ticks / 120_000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const formatClock = (frame: number, fps: number): string => {
  const ms = Math.round((frame / fps) * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
};

export const TAG_CLASS: Record<string, string> = { 成功: 's', 失敗: 'f', 想定外: 'u', ハイライト: 'h', 応用: '', 反応: 'u', 副視点: '' };
