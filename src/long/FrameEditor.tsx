import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { updatePlacement } from '../../shared/long/commands';
import { aspectRatio, clampRect, OUTPUT_SIZE, rectProblem, type Size } from '../../shared/long/geometry';
import type { RenderPlan } from '../../shared/long/render-plan';
import { assetById, type NormRect, type Placement } from '../../shared/long/schema';
import { useLongStore } from './store';
import { studioUrl } from './util';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const sourceSizeOf = (placementAsset: { probe?: { width: number; height: number } } | undefined): Size => ({
  w: placementAsset?.probe?.width || 1920,
  h: placementAsset?.probe?.height || 1080,
});

/**
 * W3：切り抜き範囲（元素材上）と表示枠（完成画面上）を、モードを分けて編集する。
 * 2種類のハンドルを同時には出さない。数値の入力はインスペクターで行う。
 */
export const FrameEditor = ({ plan }: { plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const target = useLongStore((state) => state.frameEdit)!;
  const frame = useLongStore((state) => state.frame);
  const container = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [box, setBox] = useState({ w: 1, h: 1 });
  const placement = project.placements.find((item) => item.id === target.placementId);
  const sourcePlacement: Placement | undefined =
    placement && placement.role === 'zoom' ? project.placements.find((item) => item.id === placement.parentId) : placement;
  const asset = sourcePlacement && 'assetId' in sourcePlacement ? assetById(project, sourcePlacement.assetId) : undefined;
  const source = sourceSizeOf(asset);
  const isCrop = target.mode === 'crop';
  const frameSize = isCrop ? source : OUTPUT_SIZE;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setBox({ w: element.clientWidth, h: element.clientHeight }));
    observer.observe(element);
    setBox({ w: element.clientWidth, h: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  // 元素材の表示位置（16:9 の枠に contain）
  const view = useMemo(() => {
    if (!isCrop) return { x: 0, y: 0, w: box.w, h: box.h };
    const scale = Math.min(box.w / source.w, box.h / source.h);
    const w = source.w * scale;
    const h = source.h * scale;
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  }, [isCrop, box, source.w, source.h]);

  // 元素材の現在フレーム（主配置の時間変換に従う）
  const layer = plan.layers.find((item) => item.placementId === (sourcePlacement?.id ?? ''));
  const piece = layer?.pieces.find((item) => frame >= item.from && frame < item.from + item.duration) ?? layer?.pieces[0];
  const sourceSec = piece ? (piece.kind === 'freeze' ? piece.trimBefore : piece.trimBefore + (Math.max(piece.from, frame) - piece.from) * piece.speed) / plan.fps : 0;
  useEffect(() => {
    if (videoRef.current && Number.isFinite(sourceSec)) videoRef.current.currentTime = sourceSec;
  }, [sourceSec]);

  if (!placement) return null;
  const current: NormRect = isCrop
    ? target.end && placement.motion?.cropTo
      ? placement.motion.cropTo
      : placement.crop
    : target.end && placement.motion?.to
      ? placement.motion.to
      : placement.rect;
  const locked = isCrop ? placement.cropLocked : placement.rectLocked;
  const ratio = locked ? aspectRatio(isCrop ? placement.cropAspect : placement.rectAspect, isCrop ? source : sourceSizeOf(asset)) : null;
  const rectPx = { x: view.x + current.x * view.w, y: view.y + current.y * view.h, w: current.w * view.w, h: current.h * view.h };

  const apply = (next: NormRect): void => {
    const fixed = clampRect(next);
    if (rectProblem(fixed)) return;
    useLongStore.getState().live((projectNow) => {
      const now = projectNow.placements.find((item) => item.id === placement.id);
      if (!now) return projectNow;
      const patch: Partial<Placement> = {};
      if (isCrop) {
        if (target.end) patch.motion = { ...(now.motion ?? { easing: 'ease' }), cropTo: fixed };
        else patch.crop = fixed;
      } else if (target.end) {
        patch.motion = { ...(now.motion ?? { easing: 'ease' }), to: fixed };
      } else {
        patch.rect = fixed;
        // 四隅PiPをドラッグしたら自由配置にする
        if (now.role === 'secondary' && now.layout === 'corner') (patch as Partial<Placement> & { layout: 'free' }).layout = 'free';
      }
      return updatePlacement(projectNow, placement.id, patch);
    });
  };

  const start = (handle: Handle) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY };
    const initial = { ...current };
    useLongStore.getState().beginGesture(isCrop ? '切り抜き範囲の変更' : '表示枠の変更');
    const move = (moveEvent: PointerEvent): void => {
      const dx = (moveEvent.clientX - origin.x) / view.w;
      const dy = (moveEvent.clientY - origin.y) / view.h;
      if (handle === 'move') {
        apply({ ...initial, x: initial.x + dx, y: initial.y + dy });
        return;
      }
      let { x, y, w, h } = initial;
      const right = x + w;
      const bottom = y + h;
      if (handle.includes('e')) w = Math.max(0.01, initial.w + dx);
      if (handle.includes('w')) w = Math.max(0.01, initial.w - dx);
      if (handle.includes('s')) h = Math.max(0.01, initial.h + dy);
      if (handle.includes('n')) h = Math.max(0.01, initial.h - dy);
      if (ratio) h = (w * frameSize.w) / ratio / frameSize.h;
      if (handle.includes('w')) x = right - w;
      if (handle.includes('n')) y = bottom - h;
      apply({ x, y, w, h });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useLongStore.getState().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const handles: Handle[] = ['nw', 'ne', 'sw', 'se'];
  const label = isCrop
    ? `編集中：切り抜き範囲${target.end ? '（終了）' : ''} · ${Math.round(current.w * source.w)}×${Math.round(current.h * source.h)}px`
    : `編集中：表示枠${target.end ? '（終了）' : ''} · ${Math.round(current.w * 1920)}×${Math.round(current.h * 1080)}px`;
  return (
    <div className="lv-fe" ref={container} style={{ background: isCrop ? '#000' : 'transparent' }}>
      {isCrop && asset ? (
        <video
          ref={videoRef}
          src={studioUrl(asset.proxyPath ?? asset.path)}
          muted
          preload="auto"
          style={{ position: 'absolute', left: view.x, top: view.y, width: view.w, height: view.h }}
        />
      ) : null}
      {isCrop ? (
        <div
          className="shade"
          style={{
            clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rectPx.x}px ${rectPx.y}px, ${rectPx.x}px ${rectPx.y + rectPx.h}px, ${rectPx.x + rectPx.w}px ${rectPx.y + rectPx.h}px, ${rectPx.x + rectPx.w}px ${rectPx.y}px, ${rectPx.x}px ${rectPx.y}px)`,
          }}
        />
      ) : null}
      <div className={`box ${isCrop ? '' : 'rect'}`} style={{ left: rectPx.x, top: rectPx.y, width: rectPx.w, height: rectPx.h }} onPointerDown={start('move')}>
        {handles.map((handle) => (
          <div
            key={handle}
            className="h"
            onPointerDown={start(handle)}
            style={{
              left: handle.includes('w') ? -6 : undefined,
              right: handle.includes('e') ? -6 : undefined,
              top: handle.includes('n') ? -6 : undefined,
              bottom: handle.includes('s') ? -6 : undefined,
              cursor: handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize',
            }}
          />
        ))}
      </div>
      <div className="tag">
        {label}
        {ratio ? ' · 比率ロック' : ''}
        <button type="button" className="sm" style={{ marginLeft: 8 }} onClick={() => useLongStore.getState().setFrameEdit(null)}>
          完了
        </button>
      </div>
    </div>
  );
};
