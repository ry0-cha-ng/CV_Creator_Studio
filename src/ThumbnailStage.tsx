import { useState, type CSSProperties, type ReactNode } from 'react';
import { Thumbnail } from '@remotion/player';
import { LineupThumbnail } from '../remotion/LineupThumbnail';
import { resolveVariables } from '../remotion/LineupShortStandard';
import { captionTextFor, type Language, type Project } from '../shared/schema/project';
import { THUMB_SURFACES, thumbnailLayoutOf } from '../shared/thumbnail-focus';
import { useStudioStore } from './store';

export type ThumbSurface = 'full' | 'yt' | 'tt';

const SURFACES: Array<{ id: ThumbSurface; label: string }> = [
  { id: 'full', label: '全体（9:16）' },
  { id: 'yt', label: 'YouTube棚' },
  { id: 'tt', label: 'TikTok一覧（目安）' },
];

const shelfTitle = (project: Project, language: Language): string => {
  const posted = project.publishing.title[language]?.trim() ?? '';
  const hook = project.captions.find((caption) => caption.id === 'hook');
  const hookRaw = hook && !hook.hidden ? captionTextFor(hook, language, 'thumb') : '';
  return resolveVariables(posted || hookRaw, project, language)
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replaceAll('\n', ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const zoneStyle = (x0: number, y0: number, x1: number, y1: number): CSSProperties => ({
  position: 'absolute',
  left: `${(x0 / 1080) * 100}%`,
  top: `${(y0 / 1920) * 100}%`,
  width: `${((x1 - x0) / 1080) * 100}%`,
  height: `${((y1 - y0) / 1920) * 100}%`,
  border: '1px solid rgba(255, 255, 255, 0.8)',
  boxSizing: 'border-box',
  pointerEvents: 'none',
});

export const ThumbnailLayoutSwitch = ({ project }: { project: Project }): ReactNode => {
  const layout = thumbnailLayoutOf(project);
  const choose = (next: 'classic' | 'focus'): void => {
    useStudioStore.getState().updateProject((current) => {
      current.thumbnail = { ...current.thumbnail, layout: next };
      return current;
    });
  };
  return (
    <div className="thumb-layout-switch" role="group" aria-label="サムネイルの配置">
      <button type="button" className={layout === 'focus' ? 'is-on' : ''} onClick={() => choose('focus')}>
        フォーカス
      </button>
      <button type="button" className={layout === 'classic' ? 'is-on' : ''} onClick={() => choose('classic')}>
        従来
      </button>
    </div>
  );
};

export const ThumbnailSurfaceControls = ({
  surface,
  onSurface,
  actualSize,
  onActualSize,
}: {
  surface: ThumbSurface;
  onSurface: (surface: ThumbSurface) => void;
  actualSize: boolean;
  onActualSize: (value: boolean) => void;
}): ReactNode => (
  <div className="thumb-stage-controls">
    {SURFACES.map((item) => (
      <button
        key={item.id}
        type="button"
        className={surface === item.id ? 'is-on' : ''}
        onClick={() => onSurface(item.id)}
      >
        {item.label}
      </button>
    ))}
    {surface !== 'full' ? (
      <button type="button" className={actualSize ? 'is-on' : ''} onClick={() => onActualSize(!actualSize)}>
        実寸 180px
      </button>
    ) : null}
  </div>
);

export const ThumbnailStage = ({
  project,
  language,
  surface,
  onSurface,
  showSafeZone = false,
  actualSize = false,
  onActualSize,
  showControls = false,
  fps,
}: {
  project: Project;
  language: Language;
  surface: ThumbSurface;
  onSurface?: (surface: ThumbSurface) => void;
  showSafeZone?: boolean;
  actualSize?: boolean;
  onActualSize?: (value: boolean) => void;
  showControls?: boolean;
  fps: number;
}): ReactNode => {
  const [menu] = THUMB_SURFACES.ytShelf.menu.x;
  const visible =
    surface === 'yt'
      ? THUMB_SURFACES.ytShelf.visibleY
      : surface === 'tt'
        ? THUMB_SURFACES.ttGrid.visibleY
        : [0, 1920];
  const [top, bottom] = visible;
  const span = bottom - top;
  const title = shelfTitle(project, language);
  return (
    <div className={`thumb-stage ${actualSize ? 'is-actual' : ''}`}>
      {showControls && onSurface && onActualSize ? (
        <ThumbnailSurfaceControls
          surface={surface}
          onSurface={onSurface}
          actualSize={actualSize}
          onActualSize={onActualSize}
        />
      ) : null}
      <div
        className={`thumb-stage-clip ${surface === 'yt' ? 'is-shelf' : ''}`}
        style={{ aspectRatio: `${1080} / ${span}`, ...(actualSize ? { width: 180 } : undefined) }}
      >
        <div
          className="thumb-stage-canvas"
          style={{
            height: `${(1920 / span) * 100}%`,
            top: `${(-top / span) * 100}%`,
          }}
        >
          <Thumbnail
            component={LineupThumbnail}
            inputProps={{ project, language, mediaBaseUrl: 'studio-media://root' }}
            frameToDisplay={0}
            durationInFrames={1}
            compositionWidth={1080}
            compositionHeight={1920}
            fps={fps}
            style={{ width: '100%', height: '100%' }}
          />
          {showSafeZone ? (
            <>
              <div style={zoneStyle(THUMB_SURFACES.importantArea.x[0], THUMB_SURFACES.importantArea.y[0], THUMB_SURFACES.importantArea.x[1], THUMB_SURFACES.importantArea.y[1])} />
              <div style={zoneStyle(THUMB_SURFACES.ytShelf.menu.x[0], THUMB_SURFACES.ytShelf.menu.y[0], THUMB_SURFACES.ytShelf.menu.x[1], THUMB_SURFACES.ytShelf.menu.y[1])} />
              <div style={zoneStyle(0, THUMB_SURFACES.ytShelf.titleBand[0], 1080, THUMB_SURFACES.ytShelf.titleBand[1])} />
            </>
          ) : null}
        </div>
        {surface === 'yt' ? (
          <>
            <div className="thumb-stage-menu" style={{ left: `${(menu / 1080) * 100}%` }} aria-hidden="true">
              <i /><i /><i />
            </div>
            <div className="thumb-stage-title">
              <p>{title}</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export const useThumbSurface = (): [ThumbSurface, (surface: ThumbSurface) => void, boolean, (value: boolean) => void] => {
  const [surface, setSurface] = useState<ThumbSurface>('full');
  const [actualSize, setActualSize] = useState(false);
  return [surface, setSurface, actualSize, setActualSize];
};
