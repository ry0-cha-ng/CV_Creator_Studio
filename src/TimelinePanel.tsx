import { useEffect, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { PlayerRef } from '@remotion/player';
import type { AudioRegistration, AudioTrack, Platform } from '../shared/schema/audio';
import type { AudioUsageRecord } from '../shared/ipc';
import type { Language, Project, SceneKey } from '../shared/schema/project';
import type { Timeline, TimelineItem } from '../shared/schema/timeline';
import { durationWarnings } from '../shared/production';
import {
  SCENE_BAND,
  activeTimeline,
  addVolumePoint,
  applySceneOrder,
  bgmDurationForProject,
  curveValue,
  cutOnlyItem,
  moveEffect,
  removeEffect,
  removeVolumePoint,
  reorderTimelineItem,
  setVolumePoint,
  splitTimelineItemAt,
  defaultLoopRange,
  itemClip,
  syncTimelineDurationsToScenes,
  trimTimelineItem,
  withDemoDuration,
} from '../shared/timeline';
import { CTA_DESIGN_OPTIONS, ctaHostScene, type CtaDesign } from '../shared/cta-design';
import { resolveCtaDesign } from '../shared/s4-cta';
import { cutIdOfItem, extraCutOfItem, extraCutsOf, hasExtraCuts, isPrimaryItem } from '../shared/scene-cuts';
import { assignClipToCut } from '../shared/scene-cut-edit';
import {
  BUILTIN_VIDEO_STRUCTURE_TEMPLATES,
  structureLabel,
  type VideoStructureTemplate,
} from '../shared/video-structure';
import { TimelineInspector } from './TimelineInspector';
import {
  AUDIO_DRAG_TYPE,
  CLIP_DRAG_TYPE,
  decodeAudioDrag,
  mixKeyForTrack,
  type TimelineSelection,
  type TimelineTrackId,
} from './timeline-model';

type Props = {
  project: Project;
  tracks: AudioTrack[];
  playerRef: RefObject<PlayerRef | null>;
  previewLinked: boolean;
  language: Language;
  busy: boolean;
  audioUsage: AudioUsageRecord[];
  defaultPostPlatform: Platform;
  onChange: (updater: (project: Project) => Project) => void;
  onSave: () => void;
  onImportVideo: (sceneKey?: SceneKey) => void;
  onEditRange: (sceneKey: SceneKey, cutId?: string) => void;
  defaultBgmTrackId: string | null;
  onRegisterAudio: (registration: AudioRegistration, sourcePath?: string) => void;
  onSetDefaultBgm: (trackId: string | null) => void;
  focusSceneKey?: SceneKey;
  onFocusScene?: (sceneKey: SceneKey) => void;
};

type Tool = 'select' | 'split';
type TrackId = TimelineTrackId;
type Selection = TimelineSelection;

type HistoryEntry = {
  timeline: Timeline | null;
  timelineEdited: boolean;
  templateId: Project['templateId'];
  demoDuration: number;
  bgmStart: number | null;
  bgmGain: number | null;
  scenes: Project['scenes'];
  sceneOrder: SceneKey[];
  structureTemplateId?: string;
  ctaDesign?: CtaDesign;
};

const PAD = 12;
const MIN_HEIGHT = 240;
const DEFAULT_HEIGHT = 336;
const SOURCE_LABEL: Record<AudioTrack['source'], string> = {
  bgmer: 'BGMer',
  musmus: 'MusMus',
  opentracks: 'OpenTracks',
  ytal: 'YouTube Audio Library',
  other: 'その他',
};
const CAPTIONS: { id: string; sceneKey: SceneKey; label: string }[] = [
  { id: 'hook', sceneKey: 'hook', label: 'HOOK テロップ' },
  { id: 'stand', sceneKey: 'stand', label: 'STAND テロップ' },
  { id: 'aim', sceneKey: 'aim', label: 'AIM テロップ（投げ方）' },
  { id: 'demo', sceneKey: 'demo', label: '実戦テロップ' },
  { id: 'cta', sceneKey: 'loop', label: 'CTA' },
];
const ALL_SCENES = Object.keys(SCENE_BAND) as SceneKey[];

const formatTimecode = (seconds: number): string => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const centi = Math.floor((safe % 1) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(centi).padStart(2, '0')}`;
};

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
};

const samplePath = (samples: number[], x: number, width: number, mid: number, amplitude: number): string => {
  if (samples.length === 0 || width < 3) return '';
  const bars = Math.max(1, Math.floor(width / 3));
  const commands: string[] = [];
  for (let index = 0; index < bars; index += 1) {
    const sampleIndex = Math.min(samples.length - 1, Math.floor((index / bars) * samples.length));
    const half = Math.max(1, (samples[sampleIndex] ?? 0) * amplitude);
    commands.push(`M${Math.round(x + index * 3)} ${(mid - half).toFixed(1)}V${(mid + half).toFixed(1)}`);
  }
  return commands.join('');
};

const mediaSrc = (path: string): string =>
  `studio-media://root/${path.split(/[\\/]/).map((part) => encodeURIComponent(part)).join('/')}`;

const envelopePath = (
  levels: Array<{ time: number; level: number }>,
  start: number,
  duration: number,
  x: number,
  width: number,
): string => {
  if (!levels.length || width < 3) return '';
  const bars = Math.max(1, Math.floor(width / 3));
  const commands: string[] = [];
  for (let index = 0; index < bars; index += 1) {
    const time = start + (index / bars) * duration;
    let level = levels[0]?.level ?? 0;
    for (const point of levels) {
      if (point.time <= time) level = point.level;
      else break;
    }
    const half = Math.max(1, level * 18);
    commands.push(`M${Math.round(x + index * 3)} ${(26 - half).toFixed(1)}V${(26 + half).toFixed(1)}`);
  }
  return commands.join('');
};

const waveformPath = (seed: string, x: number, width: number, top: number, height: number): string => {
  if (width < 3) return '';
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  const commands: string[] = [];
  const mid = top + height / 2;
  for (let px = 0; px < width; px += 3) {
    state = Math.imul(state, 1664525) + 1013904223;
    const amp = 0.22 + ((state >>> 0) % 1000) / 1000 * 0.78;
    const half = height * 0.42 * amp;
    const barX = Math.round(x + px);
    commands.push(`M${barX} ${(mid - half).toFixed(1)}V${(mid + half).toFixed(1)}`);
  }
  return commands.join('');
};

const Icon = ({ name }: { name: 'select' | 'split' | 'snap' | 'eye' | 'speaker' | 'lock' }): ReactNode => {
  if (name === 'select') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 3l14 8-6 2-2 6z" />
      </svg>
    );
  }
  if (name === 'split') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
      </svg>
    );
  }
  if (name === 'snap') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 3v8a6 6 0 0 0 12 0V3" />
        <path d="M6 7h4M14 7h4" />
      </svg>
    );
  }
  if (name === 'eye') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (name === 'speaker') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
};

export const TimelinePanel = ({
  project,
  tracks,
  playerRef,
  previewLinked,
  language,
  busy,
  audioUsage,
  defaultPostPlatform,
  onChange,
  onSave,
  onImportVideo,
  onEditRange,
  onRegisterAudio,
  defaultBgmTrackId,
  onSetDefaultBgm,
  focusSceneKey,
  onFocusScene,
}: Props): ReactNode => {
  const timeline = activeTimeline(project);
  const fps = project.templateParams.fps;
  const durationInFrames = Math.max(1, Math.round(timeline.durationSec * fps));
  const [tool, setTool] = useState<Tool>('select');
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(4);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [inspectSec, setInspectSec] = useState(0);
  useEffect(() => {
    if (!focusSceneKey) return;
    const items = activeTimeline(project).items;
    const item = items.find((entry) => entry.sceneKey === focusSceneKey);
    if (!item) return;
    // そのシーンの項目（カット2以降・分割した項目）をクリックして来たときは、その選択を残す
    setSelection((current) =>
      current?.kind === 'clip' && items.some((entry) => entry.id === current.id && entry.sceneKey === focusSceneKey)
        ? current
        : { kind: 'clip', id: item.id },
    );
  }, [focusSceneKey, project.id]);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [showStructureEditor, setShowStructureEditor] = useState(false);
  const [structureTemplates, setStructureTemplates] = useState<VideoStructureTemplate[]>(
    BUILTIN_VIDEO_STRUCTURE_TEMPLATES,
  );
  const [selectedStructureId, setSelectedStructureId] = useState(
    project.structureTemplateId ?? '',
  );
  const [structureName, setStructureName] = useState('');
  const [draftSceneOrder, setDraftSceneOrder] = useState<SceneKey[]>([
    ...(project.templateParams.sceneOrder ?? activeTimeline(project).items.map((item) => item.sceneKey)),
  ]);
  const [draftCtaDesign, setDraftCtaDesign] = useState<CtaDesign>(resolveCtaDesign(project));
  const [sceneToAdd, setSceneToAdd] = useState<SceneKey>('hook');
  const [structureError, setStructureError] = useState<string | null>(null);
  const [lockedTracks, setLockedTracks] = useState<Record<TrackId, boolean>>({
    v2: false,
    v1: false,
    a1: false,
    a2: false,
    a3: false,
  });
  const [inspectorSlot, setInspectorSlot] = useState<HTMLElement | null>(null);
  const mixOff = (track: TrackId): boolean => Boolean(project.timelineMix?.[mixKeyForTrack[track]]);
  const pxPerSec = zoom * 10;
  const canvasWidth = PAD + timeline.durationSec * pxPerSec + 48;
  const warnings = durationWarnings(timeline.durationSec);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const playheadSec = useRef(0);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const historyArmed = useRef(false);
  const metrics = useRef({ pxPerSec, duration: timeline.durationSec, fps, durationInFrames, snap });
  metrics.current = { pxPerSec, duration: timeline.durationSec, fps, durationInFrames, snap };

  useEffect(() => {
    let active = true;
    void window.studio
      .listVideoStructureTemplates()
      .then((templates) => {
        if (active) setStructureTemplates(templates);
      })
      .catch((error: unknown) => {
        if (active) setStructureError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const paintPlayhead = (seconds: number): void => {
    const next = Math.min(metrics.current.duration, Math.max(0, seconds));
    playheadSec.current = next;
    const left = PAD + next * metrics.current.pxPerSec;
    if (playheadRef.current) playheadRef.current.style.left = `${left}px`;
    if (timeRef.current) timeRef.current.textContent = formatTimecode(next);
  };

  const seek = (seconds: number, follow = false): void => {
    const { duration, fps: rate, pxPerSec: scale, durationInFrames: frames } = metrics.current;
    const next = Math.min(duration, Math.max(0, seconds));
    paintPlayhead(next);
    setInspectSec(next);
    const frame = Math.min(frames - 1, Math.max(0, Math.round(next * rate)));
    playerRef.current?.seekTo(frame);
    const scroller = scrollRef.current;
    if (follow && scroller) {
      const left = PAD + next * scale;
      const viewStart = scroller.scrollLeft;
      const viewEnd = viewStart + scroller.clientWidth;
      if (left < viewStart + 24 || left > viewEnd - 24) {
        scroller.scrollLeft = Math.max(0, left - scroller.clientWidth * 0.35);
      }
    }
  };

  const snapshot = (): HistoryEntry => ({
    timeline: project.timeline ? structuredClone(project.timeline) : null,
    timelineEdited: project.timelineEdited,
    templateId: project.templateId,
    demoDuration: project.templateParams.demoDuration,
    bgmStart: project.audio.bgm?.start ?? null,
    bgmGain: project.audio.bgm?.gain ?? null,
    scenes: structuredClone(project.scenes),
    sceneOrder: [...project.templateParams.sceneOrder],
    structureTemplateId: project.structureTemplateId,
    ctaDesign: project.templateParams.ctaDesign,
  });

  const pushUndo = (): void => {
    if (historyArmed.current) return;
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 40) undoStack.current.shift();
    redoStack.current = [];
    historyArmed.current = true;
  };

  const restore = (entry: HistoryEntry): void => {
    onChange((current) => ({
      ...current,
      timeline: entry.timeline,
      timelineEdited: entry.timelineEdited,
      templateId: entry.templateId,
      structureTemplateId: entry.structureTemplateId,
      scenes: entry.scenes,
      templateParams: {
        ...current.templateParams,
        demoDuration: entry.demoDuration,
        sceneOrder: entry.sceneOrder,
        ctaDesign: entry.ctaDesign,
      },
      audio: {
        ...current.audio,
        bgm:
          current.audio.bgm && entry.bgmStart !== null
            ? {
                ...current.audio.bgm,
                start: entry.bgmStart,
                ...(entry.bgmGain !== null ? { gain: entry.bgmGain } : {}),
              }
            : current.audio.bgm,
      },
    }));
  };

  const undo = (): void => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(snapshot());
    restore(entry);
  };

  const redo = (): void => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(snapshot());
    restore(entry);
  };

  const editTimeline = (next: Timeline | ((current: Timeline) => Timeline), record: boolean): void => {
    if (record) pushUndo();
    onChange((current) => {
      const base = activeTimeline(current);
      const timelineNext = typeof next === 'function' ? next(base) : next;
      return withDemoDuration(
        syncTimelineDurationsToScenes(
          {
            ...current,
            structureTemplateId: undefined,
            timelineEdited: true,
          },
          timelineNext,
        ),
        timelineNext,
      );
    });
  };

  const timeAt = (clientX: number): number => {
    const canvas = scrollRef.current?.querySelector('.tl-canvas');
    const bounds = canvas?.getBoundingClientRect();
    if (!bounds) return 0;
    const seconds = (clientX - bounds.left - PAD) / metrics.current.pxPerSec;
    return Math.min(metrics.current.duration, Math.max(0, seconds));
  };

  const snapTargets = (): number[] => {
    const targets = [0, timeline.durationSec, playheadSec.current];
    for (const item of timeline.items) {
      targets.push(item.start, item.start + item.duration);
    }
    for (const point of timeline.volumePoints) targets.push(point.time);
    for (const effect of timeline.effects) targets.push(effect.start);
    return targets;
  };

  const snapTime = (seconds: number): number => {
    if (!metrics.current.snap) return seconds;
    const threshold = 8 / metrics.current.pxPerSec;
    let best = seconds;
    let bestDist = threshold;
    for (const target of snapTargets()) {
      const dist = Math.abs(target - seconds);
      if (dist <= bestDist) {
        best = target;
        bestDist = dist;
      }
    }
    return best;
  };

  const clipAt = (seconds: number): TimelineItem | undefined =>
    timeline.items.find((item) => seconds >= item.start && seconds < item.start + item.duration);

  const locked = (track: TrackId): boolean => lockedTracks[track];

  useEffect(() => {
    setInspectorSlot(document.getElementById('timeline-inspector-root'));
  }, [project.id]);

  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    setSelection(null);
    paintPlayhead(0);
    playerRef.current?.seekTo(0);
  }, [project.id]);

  useLayoutEffect(() => {
    paintPlayhead(playheadSec.current);
  });

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !previewLinked) return;
    const sync = (event: { detail: { frame: number } }): void => {
      paintPlayhead(event.detail.frame / metrics.current.fps);
    };
    player.addEventListener('frameupdate', sync);
    player.addEventListener('seeked', sync);
    return () => {
      player.removeEventListener('frameupdate', sync);
      player.removeEventListener('seeked', sync);
    };
  }, [playerRef, previewLinked, project.id]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => Math.min(10, Math.max(1, current + (event.deltaY < 0 ? 1 : -1))));
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing || isTypingTarget(event.target) || confirmRebuild || showStructureEditor) return;
      const key = event.key.toLowerCase();
      const meta = event.ctrlKey || event.metaKey;
      if (meta && key === 's') {
        event.preventDefault();
        onSave();
        return;
      }
      if (meta && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        const player = playerRef.current;
        if (!player || !previewLinked) return;
        if (player.isPlaying()) player.pause();
        else void player.play();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        playerRef.current?.pause();
        const step = event.shiftKey ? 1 : 1 / metrics.current.fps;
        seek(playheadSec.current + (event.key === 'ArrowRight' ? step : -step), true);
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        playerRef.current?.pause();
        seek(event.key === 'Home' ? 0 : metrics.current.duration, true);
        return;
      }
      if (!meta && key === 'v') setTool('select');
      if (!meta && key === 'c') setTool('split');
      if (!meta && key === 's') {
        if (locked('v1')) return;
        const item = clipAt(playheadSec.current);
        if (!item) return;
        historyArmed.current = false;
        editTimeline(splitTimelineItemAt(activeTimeline(project), item.id, playheadSec.current), true);
        historyArmed.current = false;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selection) return;
        event.preventDefault();
        historyArmed.current = false;
        if (selection.kind === 'volume' && !locked('a1') && !locked('a2')) {
          editTimeline(removeVolumePoint(activeTimeline(project), selection.id), true);
          setSelection(null);
        } else if (selection.kind === 'effect' && !locked('a3')) {
          editTimeline(removeEffect(activeTimeline(project), selection.id), true);
          setSelection(null);
        } else if (selection.kind === 'clip' && !locked('v1')) {
          const item = timeline.items.find((entry) => entry.id === selection.id);
          if (!item) return;
          pushUndo();
          onChange((current) => ({
            ...current,
            scenes: current.scenes.map((scene) =>
              scene.sceneKey === item.sceneKey ? { ...scene, clipId: undefined } : scene,
            ),
          }));
          historyArmed.current = false;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const originY = event.clientY;
    const origin = height;
    const move = (ev: PointerEvent): void => {
      const max = window.innerHeight * 0.6;
      setHeight(Math.min(max, Math.max(MIN_HEIGHT, origin + (originY - ev.clientY))));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const beginSeek = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    playerRef.current?.pause();
    const move = (ev: PointerEvent): void => seek(snapTime(timeAt(ev.clientX)));
    move(event.nativeEvent);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const trimClip = (item: TimelineItem, edge: 'start' | 'end', event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (locked('v1') || tool !== 'select') return;
    setSelection({ kind: 'clip', id: item.id });
    if (item.sceneKey) onFocusScene?.(item.sceneKey);
    playerRef.current?.pause();
    historyArmed.current = false;
    pushUndo();
    const originX = event.clientX;
    const initial = item.duration;
    const start = item.start;
    const move = (ev: PointerEvent): void => {
      const delta = (ev.clientX - originX) / metrics.current.pxPerSec;
      const raw = edge === 'end' ? initial + delta : initial - delta;
      const end = start + raw;
      const duration = snapTime(end) - start;
      editTimeline(
        (current) => trimTimelineItem(current, item.id, edge, duration),
        false,
      );
    };
    const up = (): void => {
      historyArmed.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragClip = (item: TimelineItem, index: number, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (tool === 'split') {
      if (locked('v1')) return;
      historyArmed.current = false;
      editTimeline(splitTimelineItemAt(timeline, item.id, snapTime(timeAt(event.clientX))), true);
      historyArmed.current = false;
      setSelection({ kind: 'clip', id: item.id });
      if (item.sceneKey) onFocusScene?.(item.sceneKey);
      return;
    }
    setSelection({ kind: 'clip', id: item.id });
    if (item.sceneKey) onFocusScene?.(item.sceneKey);
    if (locked('v1')) return;
    const originX = event.clientX;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      if (Math.abs(ev.clientX - originX) > 4) moved = true;
    };
    const up = (ev: PointerEvent): void => {
      if (moved) {
        const seconds = snapTime(timeAt(ev.clientX));
        const target = timeline.items.findIndex((entry) => seconds < entry.start + entry.duration);
        const to = target < 0 ? timeline.items.length - 1 : target;
        if (to !== index) {
          historyArmed.current = false;
          editTimeline(reorderTimelineItem(timeline, index, to), true);
          historyArmed.current = false;
        }
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragEffect = (id: string, start: number, event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (locked('a3') || tool !== 'select') return;
    setSelection({ kind: 'effect', id });
    historyArmed.current = false;
    pushUndo();
    const originX = event.clientX;
    const move = (ev: PointerEvent): void => {
      const delta = (ev.clientX - originX) / metrics.current.pxPerSec;
      editTimeline(moveEffect(activeTimeline(project), id, snapTime(start + delta)), false);
    };
    const up = (): void => {
      historyArmed.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragBgm = (start: number, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (!project.audio.bgm || locked('a2') || tool !== 'select') return;
    setSelection({ kind: 'bgm' });
    historyArmed.current = false;
    pushUndo();
    const originX = event.clientX;
    const move = (ev: PointerEvent): void => {
      const delta = (ev.clientX - originX) / metrics.current.pxPerSec;
      const next = Math.max(0, snapTime(start + delta));
      onChange((current) =>
        current.audio.bgm
          ? { ...current, audio: { ...current.audio, bgm: { ...current.audio.bgm, start: next } } }
          : current,
      );
    };
    const up = (): void => {
      historyArmed.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragVolume = (
    pointId: string,
    channel: 'game' | 'bgm',
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    event.stopPropagation();
    const track = channel === 'game' ? 'a1' : 'a2';
    if (locked(track)) return;
    setSelection({ kind: 'volume', id: pointId, channel });
    historyArmed.current = false;
    pushUndo();
    const bounds = (event.currentTarget.closest('.tl-lane') as HTMLElement | null)?.getBoundingClientRect();
    const levelAt = (clientY: number): number => {
      if (!bounds) return 1;
      return Math.min(1, Math.max(0, 1 - (clientY - bounds.top - 4) / 44));
    };
    const move = (ev: PointerEvent): void => {
      editTimeline(setVolumePoint(activeTimeline(project), pointId, channel, levelAt(ev.clientY)), false);
    };
    const up = (): void => {
      historyArmed.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const clickVolumeLane = (channel: 'game' | 'bgm', event: ReactPointerEvent<HTMLDivElement>): void => {
    const track = channel === 'game' ? 'a1' : 'a2';
    const bounds = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - bounds.top;
    const seconds = timeAt(event.clientX);
    const lineY = 4 + (1 - curveValue(timeline.volumePoints, seconds, channel)) * 44;
    if (!locked(track) && tool === 'select' && Math.abs(y - lineY) <= 10) {
      const value = Math.min(1, Math.max(0, 1 - (y - 4) / 44));
      historyArmed.current = false;
      editTimeline(addVolumePoint(timeline, snapTime(seconds), channel, value), true);
      historyArmed.current = false;
      return;
    }
    beginSeek(event);
  };

  const allowDrop = (event: ReactDragEvent<HTMLElement>): void => {
    const types = event.dataTransfer.types;
    if (types.includes(CLIP_DRAG_TYPE) || types.includes(AUDIO_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  /** 項目へ素材をドロップしたとき。カットが2本以上のシーンでは、その項目のカットの動画を差し替える。 */
  const assignClip = (item: TimelineItem, clipId: string): void => {
    if (!project.clips.some((clip) => clip.id === clipId)) return;
    const { sceneKey } = item;
    const cutId = cutIdOfItem(project, item);
    historyArmed.current = false;
    pushUndo();
    onChange((current) =>
      hasExtraCuts(current, sceneKey)
        ? assignClipToCut(current, sceneKey, cutId, clipId)
        : {
            ...current,
            scenes: current.scenes.map((scene) =>
              scene.sceneKey === sceneKey ? { ...scene, clipId } : scene,
            ),
          },
    );
    historyArmed.current = false;
  };

  const assignAudio = (raw: string, target: 'bgm' | 'effect', effectId?: string): void => {
    const decoded = decodeAudioDrag(raw);
    const track = tracks.find((item) => item.id === decoded?.id && item.kind === decoded.kind);
    if (!decoded || !track) return;
    historyArmed.current = false;
    pushUndo();
    if (target === 'bgm' && track.kind === 'bgm') {
      onChange((current) => ({
        ...current,
        audio: {
          ...current.audio,
          bgm: {
            audioTrackId: track.id,
            start: current.audio.bgm?.start ?? 0,
            duration: Math.max(0.1, activeTimeline(current).durationSec - (current.audio.bgm?.start ?? 0)),
            offset: current.audio.bgm?.offset ?? 0,
            fadeIn: current.audio.bgm?.fadeIn ?? 0.5,
            fadeOut: current.audio.bgm?.fadeOut ?? 0.5,
            ducking: current.audio.bgm?.ducking ?? true,
            gain: current.audio.bgm?.gain ?? 0.02,
          },
        },
      }));
    }
    if (target === 'effect' && track.kind === 'se' && effectId) {
      editTimeline(
        (current) => ({
          ...current,
          effects: current.effects.map((effect) =>
            effect.id === effectId ? { ...effect, audioTrackId: track.id } : effect,
          ),
        }),
        false,
      );
    }
    historyArmed.current = false;
  };

  const bgm = project.audio.bgm;
  const bgmTrack = tracks.find((track) => track.id === bgm?.audioTrackId);
  const bgmDuration = bgm ? bgmDurationForProject(project) : 0;
  const templateLabel = 'T-STD 標準ショート';

  const volumeLine = (channel: 'game' | 'bgm'): string => {
    const times = [0, ...timeline.volumePoints.map((point) => point.time), timeline.durationSec];
    return [...new Set(times.map((time) => time.toFixed(3)))]
      .map((time) => {
        const seconds = Number(time);
        const value = curveValue(timeline.volumePoints, seconds, channel);
        return `${PAD + seconds * pxPerSec},${(4 + (1 - value) * 44).toFixed(1)}`;
      })
      .join(' ');
  };

  const clipLabel = (item: TimelineItem): string => {
    if (item.sceneKey === 'card') return `完成カード ${project.cardLayout === 'stack' ? 'B案' : 'A案'}`;
    const scene = project.scenes.find((entry) => entry.sceneKey === item.sceneKey);
    if (item.sceneKey === 'loop' && !scene?.clipId) {
      return defaultLoopRange(project) ? 'S1 の直前' : 'S1 と同じ映像';
    }
    const extra = extraCutOfItem(project, item);
    const clip = project.clips.find((entry) => entry.id === (extra ? extra.clipId : scene?.clipId));
    const asset = project.assets.find((entry) => entry.id === clip?.assetId);
    const cutName = extra ? `${SCENE_BAND[item.sceneKey]} · カット${extraCutsOf(scene).indexOf(extra) + 2}` : '';
    if (!asset) return cutName ? `${cutName}  素材なし` : '素材なし';
    const seconds = asset.meta.duration ?? item.duration;
    const source = `${fileName(asset.path)}  ${seconds.toFixed(1)}s`;
    return cutName ? `${cutName}  ${source}` : source;
  };

  /** 同じシーンの中で、別のカットが始まる項目（境目に細い区切りを出す）。 */
  const startsNewCut = (index: number): boolean => {
    const item = timeline.items[index];
    const prev = timeline.items[index - 1];
    if (!item || !prev || prev.sceneKey !== item.sceneKey) return false;
    return cutIdOfItem(project, prev) !== cutIdOfItem(project, item);
  };

  /** シーンの帯。同じシーンが続く項目（カット・分割）は1本にまとめる。 */
  const sceneBands = timeline.items.reduce<Array<{ id: string; sceneKey: SceneKey; start: number; end: number }>>(
    (bands, item) => {
      const last = bands[bands.length - 1];
      if (last && last.sceneKey === item.sceneKey) last.end = item.start + item.duration;
      else bands.push({ id: item.id, sceneKey: item.sceneKey, start: item.start, end: item.start + item.duration });
      return bands;
    },
    [],
  );

  const sameSceneOrder = (left: SceneKey[], right: SceneKey[]): boolean =>
    left.length === right.length && left.every((sceneKey, index) => sceneKey === right[index]);

  const openStructureEditor = (): void => {
    const currentOrder = project.timelineEdited
      ? timeline.items.map((item) => item.sceneKey)
      : [...project.templateParams.sceneOrder];
    const matched =
      structureTemplates.find((template) => template.id === project.structureTemplateId) ??
      structureTemplates.find((template) => sameSceneOrder(template.sceneOrder, currentOrder));
    setDraftSceneOrder(currentOrder);
    setDraftCtaDesign(resolveCtaDesign(project));
    setSelectedStructureId(matched?.id ?? '');
    setStructureName(matched?.name ?? '新しい構成');
    setStructureError(null);
    setShowStructureEditor(true);
  };

  const selectStructure = (id: string): void => {
    setSelectedStructureId(id);
    const template = structureTemplates.find((item) => item.id === id);
    if (!template) return;
    setDraftSceneOrder([...template.sceneOrder]);
    setDraftCtaDesign(template.ctaDesign);
    setStructureName(template.name);
    setStructureError(null);
  };

  const moveDraftScene = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= draftSceneOrder.length) return;
    setDraftSceneOrder((current) => {
      const next = [...current];
      const [sceneKey] = next.splice(index, 1);
      if (!sceneKey) return current;
      next.splice(target, 0, sceneKey);
      return next;
    });
  };

  const saveStructure = async (): Promise<void> => {
    const name = structureName.trim();
    if (!name || draftSceneOrder.length === 0) {
      setStructureError('名前と1つ以上のシーンを指定してください');
      return;
    }
    const selected = structureTemplates.find((item) => item.id === selectedStructureId);
    const id =
      selected && !selected.builtIn
        ? selected.id
        : `structure-${crypto.randomUUID()}`;
    try {
      const templates = await window.studio.saveVideoStructureTemplate({
        id,
        name,
        sceneOrder: draftSceneOrder,
        ctaDesign: draftCtaDesign,
        builtIn: false,
      });
      setStructureTemplates(templates);
      setSelectedStructureId(id);
      setStructureError(null);
    } catch (error) {
      setStructureError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteStructure = async (): Promise<void> => {
    const selected = structureTemplates.find((item) => item.id === selectedStructureId);
    if (!selected || selected.builtIn) return;
    try {
      const templates = await window.studio.deleteVideoStructureTemplate(selected.id);
      setStructureTemplates(templates);
      setSelectedStructureId('');
      setStructureName('新しい構成');
      setStructureError(null);
    } catch (error) {
      setStructureError(error instanceof Error ? error.message : String(error));
    }
  };

  const applyDraftStructure = (): void => {
    if (draftSceneOrder.length === 0) {
      setStructureError('1つ以上のシーンを指定してください');
      return;
    }
    historyArmed.current = false;
    pushUndo();
    const selected = structureTemplates.find((item) => item.id === selectedStructureId);
    onChange((current) =>
      applySceneOrder(
        current,
        draftSceneOrder,
        selected && sameSceneOrder(selected.sceneOrder, draftSceneOrder) ? selected.id : undefined,
        draftCtaDesign,
      ),
    );
    historyArmed.current = false;
    setSelection(null);
    setShowStructureEditor(false);
  };

  return (
    <>
    {inspectorSlot &&
      createPortal(
        <TimelineInspector
          project={project}
          tracks={tracks}
          timeline={timeline}
          selection={selection}
          playheadSec={inspectSec}
          language={language}
          busy={busy}
          audioUsage={audioUsage}
          defaultPostPlatform={defaultPostPlatform}
          onChange={onChange}
          onEditTimeline={(next) => editTimeline(next, true)}
          onImportVideo={onImportVideo}
          onEditRange={onEditRange}
          onRegisterAudio={onRegisterAudio}
          defaultBgmTrackId={defaultBgmTrackId}
          onSetDefaultBgm={onSetDefaultBgm}
        />,
        inspectorSlot,
      )}
    <section className="timeline-dock" style={{ height }} aria-label="タイムライン">
      <div className="tl-resizer" onPointerDown={startResize} />
      <div className="tl-toolbar">
        <span className="tl-title">タイムライン</span>
        <button type="button" onClick={openStructureEditor}>
          構成パターン · {structureLabel(
            project.timelineEdited
              ? timeline.items.map((item) => item.sceneKey)
              : project.templateParams.sceneOrder,
            resolveCtaDesign(project),
          )}
        </button>
        <span className="tl-divider" />
        <div className="tl-tools">
          <button className={tool === 'select' ? 'is-on' : ''} aria-label="選択ツール" onClick={() => setTool('select')}>
            <Icon name="select" />
          </button>
          <button className={tool === 'split' ? 'is-on' : ''} aria-label="分割ツール" onClick={() => setTool('split')}>
            <Icon name="split" />
          </button>
        </div>
        <button className={snap ? 'tl-snap is-on' : 'tl-snap'} onClick={() => setSnap((current) => !current)}>
          <Icon name="snap" />
          スナップ
        </button>
        <span className="tl-spacer" />
        <span className="tl-time" ref={timeRef} />
        <span className={`tl-duration ${warnings.length ? 'is-warn' : ''}`}>
          / {formatTimecode(timeline.durationSec)} · {fps}fps
          {warnings[0] ? ` · ${warnings[0]}` : ''}
        </span>
        <span className="tl-spacer" />
        <label className="tl-zoom">
          ズーム
          <input
            type="range"
            min={1}
            max={10}
            value={zoom}
            aria-label="時間軸のズーム"
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <button onClick={() => setConfirmRebuild(true)}>テンプレートから組み直す</button>
      </div>
      <div className="tl-body">
        <div className="tl-headers">
          <div className="tl-header-spacer">シーン</div>
          {(
            [
              ['v2', 'V2', 'テロップ', 'eye'],
              ['v1', 'V1', '映像', 'eye'],
              ['a1', 'A1', 'ゲーム音', 'speaker'],
              ['a2', 'A2', 'BGM', 'speaker'],
              ['a3', 'A3', '効果音', 'speaker'],
            ] as const
          ).map(([id, code, label, icon]) => (
            <div className={`tl-header tl-h-${id}`} key={id}>
              <span className="tl-code">{code}</span>
              <span className="tl-name">{label}</span>
              <button
                className={mixOff(id) ? 'is-on' : ''}
                aria-label={icon === 'eye' ? `${code} を非表示` : `${code} をミュート`}
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    timelineMix: {
                      hideCaptions: current.timelineMix?.hideCaptions ?? false,
                      hideVideo: current.timelineMix?.hideVideo ?? false,
                      muteGame: current.timelineMix?.muteGame ?? false,
                      muteBgm: current.timelineMix?.muteBgm ?? false,
                      muteEffects: current.timelineMix?.muteEffects ?? false,
                      [mixKeyForTrack[id]]: !current.timelineMix?.[mixKeyForTrack[id]],
                    },
                  }))
                }
              >
                <Icon name={icon} />
              </button>
              <button
                className={lockedTracks[id] ? 'is-on' : ''}
                aria-label={`${code} をロック`}
                onClick={() => setLockedTracks((current) => ({ ...current, [id]: !current[id] }))}
              >
                <Icon name="lock" />
              </button>
            </div>
          ))}
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-canvas" style={{ width: canvasWidth }}>
            <div className="tl-ruler" onPointerDown={beginSeek}>
              {Array.from({ length: Math.ceil(timeline.durationSec) + 1 }, (_, second) => (
                <div key={second} className="tl-tick" style={{ left: PAD + second * pxPerSec }}>
                  <span>{second % 2 === 0 ? `${second}s` : ''}</span>
                  <i className={second % 2 === 0 ? 'major' : ''} />
                </div>
              ))}
            </div>
            <div className="tl-scenes" onPointerDown={beginSeek}>
              {sceneBands.map((band) => (
                <div
                  className="tl-scene"
                  key={band.id}
                  style={{ left: PAD + band.start * pxPerSec, width: Math.max(24, (band.end - band.start) * pxPerSec - 2) }}
                >
                  {SCENE_BAND[band.sceneKey]}
                </div>
              ))}
            </div>
            <div className={`tl-lane tl-v2 ${mixOff('v2') ? 'is-dim' : ''}`} onPointerDown={beginSeek}>
              {CAPTIONS.map((caption) => {
                const host =
                  caption.id === 'cta' ? ctaHostScene(resolveCtaDesign(project)) : caption.sceneKey;
                const matching = timeline.items.filter((item) => item.sceneKey === host);
                if (!matching.length) return null;
                const start = Math.min(...matching.map((item) => item.start));
                const end = Math.max(...matching.map((item) => item.start + item.duration));
                return (
                  <button
                    key={caption.id}
                    className={`tl-caption ${selection?.kind === 'caption' && selection.id === caption.id ? 'is-selected' : ''}`}
                    style={{ left: PAD + start * pxPerSec, width: Math.max(28, (end - start) * pxPerSec - 2) }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setSelection({ kind: 'caption', id: caption.id })}
                  >
                    {caption.label}
                  </button>
                );
              })}
            </div>
            <div
              className={`tl-lane tl-v1 ${mixOff('v1') ? 'is-dim' : ''} ${tool === 'split' ? 'is-split' : ''}`}
              onPointerDown={beginSeek}
            >
              {timeline.items.map((item, index) => {
                const scene = project.scenes.find((entry) => entry.sceneKey === item.sceneKey);
                const mediaClip = itemClip(project, item);
                const mediaAsset = project.assets.find((entry) => entry.id === mediaClip?.assetId);
                const selected = selection?.kind === 'clip' && selection.id === item.id;
                const primary = isPrimaryItem(project, item);
                return (
                  <div
                    key={item.id}
                    className={`tl-clip ${item.sceneKey === 'card' ? 'is-card' : ''} ${selected ? 'is-selected' : ''} ${startsNewCut(index) ? 'is-cut-start' : ''}`}
                    style={{ left: PAD + item.start * pxPerSec, width: Math.max(12, item.duration * pxPerSec - 2) }}
                    onPointerDown={(event) => dragClip(item, index, event)}
                    onDragOver={allowDrop}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const clipId = event.dataTransfer.getData(CLIP_DRAG_TYPE);
                      if (clipId && !locked('v1')) assignClip(item, clipId);
                    }}
                  >
                    <div className="tl-clip-label">{clipLabel(item)}</div>
                    <div className="tl-film">
                      {mediaAsset && item.sceneKey !== 'card' && (
                        <video
                          className="tl-thumb"
                          src={mediaSrc(mediaAsset.path)}
                          muted
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(event) => {
                            event.currentTarget.currentTime = mediaClip?.in ?? 0;
                          }}
                        />
                      )}
                    </div>
                    {primary && scene?.zoom?.enabled && <span className="tl-badge">Z</span>}
                    {item.speed !== 1 && <span className="tl-badge tl-badge-speed">{item.speed}x</span>}
                    {item.transition !== 'cut' && !cutOnlyItem(project, timeline.items, index) && (
                      <span className="tl-badge tl-badge-trans">{item.transition === 'fade' ? 'F' : 'S'}</span>
                    )}
                    {item.arrow && <span className="tl-badge tl-badge-arrow">→</span>}
                    {primary && scene?.freeze?.enabled && scene.freeze.duration > 0 && (
                      <div
                        className="tl-freeze"
                        style={{
                          left: Math.max(0, scene.freeze.at) * pxPerSec,
                          width: Math.max(18, scene.freeze.duration * pxPerSec),
                        }}
                      >
                        FREEZE
                      </div>
                    )}
                    {tool === 'select' && !lockedTracks.v1 && (
                      <>
                        <div className="tl-handle left" onPointerDown={(event) => trimClip(item, 'start', event)} />
                        <div className="tl-handle right" onPointerDown={(event) => trimClip(item, 'end', event)} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div
              className={`tl-lane tl-a1 ${mixOff('a1') ? 'is-dim' : ''}`}
              onPointerDown={(event) => clickVolumeLane('game', event)}
            >
              <svg className="tl-wave" width={canvasWidth} height="52" aria-hidden="true">
                {timeline.items
                  .filter((item) => item.sceneKey !== 'card')
                  .map((item) => {
                    const mediaClip = itemClip(project, item);
                    const mediaAsset = project.assets.find((entry) => entry.id === mediaClip?.assetId);
                    const envelope = mediaAsset?.loudnessEnvelope ?? [];
                    const x = PAD + item.start * pxPerSec;
                    const width = item.duration * pxPerSec;
                    return (
                      <path
                        key={item.id}
                        d={
                          envelope.length
                            ? envelopePath(envelope, mediaClip?.in ?? 0, item.duration, x, width)
                            : waveformPath(item.id, x, width, 8, 36)
                        }
                        stroke="#4E9C95"
                        strokeWidth="2"
                        fill="none"
                        opacity="0.8"
                      />
                    );
                  })}
                <polyline points={volumeLine('game')} fill="none" stroke="#E8C547" strokeWidth="1.5" />
              </svg>
              {timeline.volumePoints.map((point) => (
                <div
                  key={`game-${point.id}`}
                  className={`tl-point ${selection?.kind === 'volume' && selection.id === point.id && selection.channel === 'game' ? 'is-selected' : ''}`}
                  style={{ left: PAD + point.time * pxPerSec - 3.5, top: 4 + (1 - point.game) * 44 - 3.5 }}
                  onPointerDown={(event) => dragVolume(point.id, 'game', event)}
                />
              ))}
            </div>
            <div
              className={`tl-lane tl-a2 ${mixOff('a2') ? 'is-dim' : ''}`}
              onPointerDown={(event) => clickVolumeLane('bgm', event)}
              onDragOver={allowDrop}
              onDrop={(event) => {
                event.preventDefault();
                const audio = event.dataTransfer.getData(AUDIO_DRAG_TYPE);
                if (audio && !locked('a2')) assignAudio(audio, 'bgm');
              }}
            >
              {bgm && (
                <div
                  className={`tl-bgm ${selection?.kind === 'bgm' ? 'is-selected' : ''}`}
                  style={{ left: PAD + bgm.start * pxPerSec, width: Math.max(48, bgmDuration * pxPerSec) }}
                  onPointerDown={(event) => dragBgm(bgm.start, event)}
                >
                  {bgmTrack ? `${bgmTrack.title} · ${SOURCE_LABEL[bgmTrack.source]}` : 'BGM'}
                </div>
              )}
              <svg className="tl-wave" width={canvasWidth} height="52" aria-hidden="true">
                {bgm && (
                  <path
                    d={
                      bgmTrack && bgmTrack.waveform.length > 0
                        ? samplePath(bgmTrack.waveform, PAD + bgm.start * pxPerSec, bgmDuration * pxPerSec, 26, 16)
                        : waveformPath(bgm.audioTrackId, PAD + bgm.start * pxPerSec, bgmDuration * pxPerSec, 16, 20)
                    }
                    stroke="#7CC49A"
                    strokeWidth="2"
                    fill="none"
                    opacity="0.45"
                  />
                )}
                <polyline points={volumeLine('bgm')} fill="none" stroke="#E8C547" strokeWidth="1.5" />
              </svg>
              {timeline.volumePoints.map((point) => (
                <div
                  key={`bgm-${point.id}`}
                  className={`tl-point ${selection?.kind === 'volume' && selection.id === point.id && selection.channel === 'bgm' ? 'is-selected' : ''}`}
                  style={{ left: PAD + point.time * pxPerSec - 3.5, top: 4 + (1 - point.bgm) * 44 - 3.5 }}
                  onPointerDown={(event) => dragVolume(point.id, 'bgm', event)}
                />
              ))}
            </div>
            <div className={`tl-lane tl-a3 ${mixOff('a3') ? 'is-dim' : ''}`} onPointerDown={beginSeek}>
              {timeline.effects.map((effect) => (
                <button
                  key={effect.id}
                  className={`tl-effect ${selection?.kind === 'effect' && selection.id === effect.id ? 'is-selected' : ''}`}
                  style={{ left: PAD + effect.start * pxPerSec }}
                  onPointerDown={(event) => dragEffect(effect.id, effect.start, event)}
                  onDragOver={allowDrop}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const audio = event.dataTransfer.getData(AUDIO_DRAG_TYPE);
                    if (audio && !locked('a3')) assignAudio(audio, 'effect', effect.id);
                  }}
                >
                  {effect.label}
                </button>
              ))}
            </div>
            <div className="tl-playhead" ref={playheadRef}>
              <div className="tl-playhead-head" onPointerDown={beginSeek} />
            </div>
          </div>
        </div>
      </div>
      {showStructureEditor && (
        <div className="confirm-backdrop" onClick={() => setShowStructureEditor(false)}>
          <div
            className="confirm-dialog structure-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="structure-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">VIDEO STRUCTURE</span>
            <h2 id="structure-dialog-title">動画の構成パターン</h2>
            <p>シーンの順序と採用するシーンを編集し、別の動画でも使えるテンプレートとして保存できます。</p>
            <label className="structure-field">
              保存済みテンプレート
              <select
                value={selectedStructureId}
                onChange={(event) => selectStructure(event.target.value)}
              >
                <option value="">現在の構成を編集</option>
                {structureTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="structure-order" aria-label="シーン順序">
              {draftSceneOrder.map((sceneKey, index) => (
                <div className="structure-scene" key={`${sceneKey}-${index}`}>
                  <span className="structure-index">{index + 1}</span>
                  <strong>{SCENE_BAND[sceneKey]}</strong>
                  <span className="structure-actions">
                    <button
                      type="button"
                      aria-label={`${SCENE_BAND[sceneKey]}を前へ`}
                      disabled={index === 0}
                      onClick={() => moveDraftScene(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`${SCENE_BAND[sceneKey]}を後ろへ`}
                      disabled={index === draftSceneOrder.length - 1}
                      onClick={() => moveDraftScene(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`${SCENE_BAND[sceneKey]}を外す`}
                      disabled={draftSceneOrder.length === 1}
                      onClick={() =>
                        setDraftSceneOrder((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index),
                        )
                      }
                    >
                      外す
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="structure-add">
              <select
                aria-label="追加するシーン"
                value={sceneToAdd}
                onChange={(event) => setSceneToAdd(event.target.value as SceneKey)}
              >
                {ALL_SCENES.map((sceneKey) => (
                  <option key={sceneKey} value={sceneKey}>
                    {SCENE_BAND[sceneKey]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={
                  draftSceneOrder.length >= ALL_SCENES.length ||
                  draftSceneOrder.includes(sceneToAdd)
                }
                onClick={() => setDraftSceneOrder((current) => [...current, sceneToAdd])}
              >
                ＋ 追加
              </button>
            </div>
            <label className="structure-field">
              テンプレート名
              <input
                maxLength={60}
                value={structureName}
                onChange={(event) => setStructureName(event.target.value)}
              />
            </label>
            <label className="structure-field">
              CTAデザイン
              <select
                aria-label="CTAデザイン"
                value={draftCtaDesign}
                onChange={(event) => setDraftCtaDesign(event.target.value as CtaDesign)}
              >
                {CTA_DESIGN_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="structure-summary">{structureLabel(draftSceneOrder, draftCtaDesign)}</p>
            <p className="gd-muted" style={{ marginTop: 8 }}>
              {CTA_DESIGN_OPTIONS.find((option) => option.id === draftCtaDesign)?.detail}
            </p>
            {structureError && <p className="structure-error">{structureError}</p>}
            <div className="structure-save-actions">
              <button type="button" onClick={() => void saveStructure()}>
                {structureTemplates.some(
                  (item) => item.id === selectedStructureId && !item.builtIn,
                )
                  ? 'テンプレートを更新'
                  : '新規テンプレートとして保存'}
              </button>
              {structureTemplates.some(
                (item) => item.id === selectedStructureId && !item.builtIn,
              ) && (
                <button type="button" onClick={() => void deleteStructure()}>
                  テンプレートを削除
                </button>
              )}
            </div>
            <div className="confirm-actions">
              <button type="button" onClick={() => setShowStructureEditor(false)}>
                キャンセル
              </button>
              <button type="button" className="primary" onClick={applyDraftStructure}>
                この構成を適用
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmRebuild && (
        <div className="confirm-backdrop" onClick={() => setConfirmRebuild(false)}>
          <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
            <span className="eyebrow">TIMELINE</span>
            <h2>テンプレートから組み直しますか？</h2>
            <p>タイムライン上の手編集を破棄し、{templateLabel}の初期状態に戻します。</p>
            <div className="confirm-actions">
              <button onClick={() => setConfirmRebuild(false)}>キャンセル</button>
              <button
                className="primary"
                onClick={() => {
                  historyArmed.current = false;
                  pushUndo();
                  onChange((current) => ({ ...current, timelineEdited: false, timeline: null }));
                  historyArmed.current = false;
                  setConfirmRebuild(false);
                  setSelection(null);
                }}
              >
                組み直す
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
    </>
  );
};
