import { Player, type PlayerRef } from '@remotion/player';
import { useContext, useEffect, useMemo, useState } from 'react';
import { LongVideo } from '../../remotion/long/LongVideo';
import type { RenderPlan } from '../../shared/long/render-plan';
import { FrameEditor } from './FrameEditor';
import { LongPlayerContext, useLongPlayer } from './player';
import { useLongStore } from './store';
import { STUDIO_MEDIA, formatClock } from './util';

const HUD_GUIDES = [
  { label: 'マップ', rect: { x: 0.01, y: 0.02, w: 0.16, h: 0.29 } },
  { label: 'キルログ', rect: { x: 0.76, y: 0.02, w: 0.23, h: 0.11 } },
  { label: '照準', rect: { x: 0.46, y: 0.43, w: 0.08, h: 0.14 } },
];

export type PreviewRange = 'scene' | 'chapter' | 'all';

/** 中央の16:9プレビュー。再生範囲（シーン／章／全体）、言語、ガイド、元素材の表示を切り替える */
export const PreviewPane = ({ plan, compact = false }: { plan: RenderPlan; compact?: boolean }) => {
  const playerRef = useContext(LongPlayerContext);
  const player = useLongPlayer();
  const project = useLongStore((state) => state.project)!;
  const language = useLongStore((state) => state.language);
  const frame = useLongStore((state) => state.frame);
  const selection = useLongStore((state) => state.selection);
  const frameEdit = useLongStore((state) => state.frameEdit);
  const [textSafe, setTextSafe] = useState(true);
  const [hud, setHud] = useState(false);
  const [playing, setPlaying] = useState(false);
  const range = project.editor.previewRange;

  const bounds = useMemo((): { from: number; to: number } => {
    const at = Math.min(frame, plan.durationInFrames - 1);
    if (range === 'scene') {
      const scene = plan.scenes.find((item) => at >= item.from && at < item.to);
      if (scene) return { from: scene.from, to: scene.to - 1 };
    }
    if (range === 'chapter') {
      const chapterId = project.editor.chapterId;
      const chapter = plan.chapters.find((item) => item.id === chapterId) ?? plan.chapters.find((item) => at >= item.from && at < item.to);
      if (chapter && chapter.to > chapter.from) return { from: chapter.from, to: chapter.to - 1 };
    }
    return { from: 0, to: Math.max(0, plan.durationInFrames - 1) };
  }, [range, plan, frame, project.editor.chapterId]);

  useEffect(() => {
    const instance = playerRef?.current;
    if (!instance) return;
    let last = 0;
    const onFrame = (event: { detail: { frame: number } }): void => {
      const now = performance.now();
      if (now - last < 60) return;
      last = now;
      useLongStore.getState().setFrame(event.detail.frame);
    };
    const onSeek = (event: { detail: { frame: number } }): void => useLongStore.getState().setFrame(event.detail.frame);
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => {
      setPlaying(false);
      useLongStore.getState().setFrame(instance.getCurrentFrame());
    };
    instance.addEventListener('frameupdate', onFrame);
    instance.addEventListener('seeked', onSeek);
    instance.addEventListener('play', onPlay);
    instance.addEventListener('pause', onPause);
    return () => {
      instance.removeEventListener('frameupdate', onFrame);
      instance.removeEventListener('seeked', onSeek);
      instance.removeEventListener('play', onPlay);
      instance.removeEventListener('pause', onPause);
    };
  }, [playerRef, plan.durationInFrames]);

  // 再生位置を Player へ反映（タイムライン操作など）
  useEffect(() => {
    const instance = playerRef?.current;
    if (!instance || playing) return;
    if (instance.getCurrentFrame() !== frame) instance.seekTo(Math.min(frame, plan.durationInFrames - 1));
  }, [frame]);

  const setRange = (next: PreviewRange): void =>
    useLongStore.getState().live((current) => ({ ...current, editor: { ...current.editor, previewRange: next } }));

  const highlightId = selection.kind === 'placement' ? selection.id : undefined;
  const scene = plan.scenes.find((item) => frame >= item.from && frame < item.to);
  const chapter = plan.chapters.find((item) => frame >= item.from && frame < item.to);
  const highlight = useMemo(() => {
    // 選択中のマーカー、なければ現在の章の最初の見せ場
    const markers = project.markers.filter((marker) => marker.kind === 'highlight');
    const pick = selection.kind === 'marker' ? markers.find((marker) => marker.id === selection.id) : undefined;
    const overlay = plan.overlays.find((item) => item.kind === 'cutin' && (!chapter || (item.from >= chapter.from && item.from < chapter.to)));
    if (pick || overlay) return overlay ?? null;
    return null;
  }, [project.markers, selection, plan.overlays, chapter]);

  return (
    <>
      {!compact ? (
        <div className="lv-pbar">
          <span className="muted">再生範囲</span>
          <span className="seg">
            {(
              [
                ['scene', 'シーン'],
                ['chapter', '章'],
                ['all', '動画全体'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>
                {label}
              </button>
            ))}
          </span>
          <span className="sp" />
          <span className="seg">
            {project.output.languages.map((item) => (
              <button key={item} type="button" aria-pressed={language === item} onClick={() => useLongStore.getState().setLanguage(item)}>
                {item === 'ja' ? '日本語' : item.toUpperCase()}
              </button>
            ))}
          </span>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={textSafe} onChange={(event) => setTextSafe(event.target.checked)} />
            文字の目安 5%
          </label>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={hud} onChange={(event) => setHud(event.target.checked)} />
            HUDガイド
          </label>
        </div>
      ) : null}
      <div className="lv-stage">
        <div className="frame">
          {plan.totalTicks <= 0 ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sub)', textAlign: 'center', padding: 20 }}>
              有効なシーンがありません。ストーリーボードの「＋」で章を追加し、候補区間を割り当てます。
            </div>
          ) : (
          <Player
            ref={playerRef as React.RefObject<PlayerRef>}
            component={LongVideo}
            inputProps={{
              plan,
              mediaBaseUrl: STUDIO_MEDIA,
              useProxy: true,
              guides: compact ? undefined : { textSafe, hud: hud ? HUD_GUIDES : [] },
              highlightId,
            }}
            durationInFrames={Math.max(1, plan.durationInFrames)}
            compositionWidth={plan.width}
            compositionHeight={plan.height}
            fps={plan.fps}
            // Player は outFrame > inFrame（かつ > 0）が必要。1フレームしかない範囲では範囲指定しない
            inFrame={bounds.to > bounds.from ? bounds.from : undefined}
            outFrame={bounds.to > bounds.from ? bounds.to : undefined}
            style={{ width: '100%', height: '100%' }}
            clickToPlay={!frameEdit}
            spaceKeyToPlayOrPause={false}
          />
          )}
          {frameEdit && plan.totalTicks > 0 ? <FrameEditor plan={plan} /> : null}
        </div>
      </div>
      <div className="lv-transport">
        <button type="button" className="sm" title="範囲の先頭" onClick={() => player.seek(bounds.from)}>
          ⏮
        </button>
        <button type="button" className="sm" title="1フレーム戻る" onClick={() => player.seek(frame - 1)}>
          ◀▮
        </button>
        <button type="button" className="sm pri" onClick={() => player.toggle()}>
          {playing ? '⏸' : '▶'}
        </button>
        <button type="button" className="sm" title="1フレーム進む" onClick={() => player.seek(frame + 1)}>
          ▮▶
        </button>
        <span className="mono">
          {formatClock(frame, plan.fps)} <span className="dim">/ {formatClock(plan.durationInFrames, plan.fps)} · {plan.fps}fps</span>
        </span>
        {scene ? (
          <span className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {chapter?.title ? `${chapter.title} › ` : ''}
            {scene.label || 'シーン'}
          </span>
        ) : null}
        <span className="sp" />
        {highlight ? (
          <button
            type="button"
            className="sm"
            title="カットインと見せ場の前後を続けて再生します"
            onClick={() => player.playRange(Math.max(0, highlight.from - 2 * plan.fps), Math.min(plan.durationInFrames - 1, highlight.from + highlight.duration + 3 * plan.fps))}
          >
            見せ場の前後を確認
          </button>
        ) : null}
      </div>
    </>
  );
};
