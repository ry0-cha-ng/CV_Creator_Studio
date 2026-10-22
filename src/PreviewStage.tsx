import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Player, Thumbnail, type PlayerRef } from '@remotion/player';
import {
  LineupCard,
  LineupCardX45,
  LineupShortStandard,
} from '../remotion/LineupShortStandard';
import { LineupThumbnail } from '../remotion/LineupThumbnail';
import { durationWarnings } from '../shared/production';
import type { Language, Project } from '../shared/schema/project';
import type { AudioTrack } from '../shared/schema/audio';
import { ThumbnailFrameControls } from './ThumbnailFrameControls';

const TRIPLE_MIN = 820;
const PAIR_MIN = 580;

type PreviewLayout = 'triple' | 'pair' | 'single';
type PreviewPaneId = 'short' | 'card45' | 'card' | 'thumb';

type Props = {
  project: Project;
  language: Language;
  audioTracks: AudioTrack[];
  showSafeZone: boolean;
  playerRef: RefObject<PlayerRef | null>;
  durationInFrames: number;
  revealPane: PreviewPaneId | null;
  playbackSuspended?: boolean;
  onLanguage: (language: Language) => void;
  onShowSafeZone: (show: boolean) => void;
  onRevealHandled: () => void;
};

const layoutFromWidth = (width: number): PreviewLayout => {
  if (width >= TRIPLE_MIN) return 'triple';
  if (width >= PAIR_MIN) return 'pair';
  return 'single';
};

const cardLayoutLabel = (project: Project): string =>
  project.cardLayout === 'stack' ? 'B案' : 'A案';

const paneVisible = (
  id: PreviewPaneId,
  layout: PreviewLayout,
  solo: PreviewPaneId,
  cardOpen: boolean,
): boolean => {
  if (layout === 'triple') return true;
  if (layout === 'pair') return id !== 'card' || cardOpen;
  return solo === id;
};

export const PreviewStage = ({
  project,
  language,
  audioTracks,
  showSafeZone,
  playerRef,
  durationInFrames,
  revealPane,
  playbackSuspended = false,
  onLanguage,
  onShowSafeZone,
  onRevealHandled,
}: Props): ReactNode => {
  const panelRef = useRef<HTMLElement>(null);
  const [previewWidth, setPreviewWidth] = useState(1440);
  const [solo, setSolo] = useState<PreviewPaneId>('short');
  const [cardOpen, setCardOpen] = useState(false);
  const [xCardZoomed, setXCardZoomed] = useState(false);
  const [thumbOpen, setThumbOpen] = useState(false);
  const holdFrame = useRef<number | null>(null);
  const layout = layoutFromWidth(previewWidth);
  const warnings = durationWarnings(durationInFrames / project.templateParams.fps);
  const fps = project.templateParams.fps;
  const showShort = paneVisible('short', layout, solo, cardOpen);
  const showCard45 = paneVisible('card45', layout, solo, cardOpen);
  const showCard = paneVisible('card', layout, solo, cardOpen);
  const showThumb = layout === 'single' && solo === 'thumb';

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const apply = (width: number): void => setPreviewWidth(width);
    apply(panel.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') apply(width);
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [project.id]);

  useEffect(() => {
    if (layout !== 'pair') setCardOpen(false);
  }, [layout]);

  useEffect(() => {
    if (!xCardZoomed && !thumbOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setXCardZoomed(false);
        setThumbOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [xCardZoomed, thumbOpen]);

  useEffect(() => {
    const frame = holdFrame.current;
    if (frame == null) return;
    holdFrame.current = null;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => playerRef.current?.seekTo(frame));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [project.thumbnailFrame, playerRef]);

  useEffect(() => {
    if (!revealPane) return;
    if (layout === 'single') setSolo(revealPane);
    if (layout === 'pair' && revealPane === 'card') setCardOpen(true);
    onRevealHandled();
  }, [revealPane, layout, onRevealHandled]);

  const inputProps = {
    project,
    language,
    mediaBaseUrl: 'studio-media://root',
  };

  return (
    <section className="preview-panel" ref={panelRef}>
      <div className="preview-toolbar">
        <div className="language-tabs preview-language" role="tablist" aria-label="プレビューの言語">
          <button
            type="button"
            className={language === 'ja' ? 'active' : ''}
            onClick={() => onLanguage('ja')}
          >
            日本語
          </button>
          <button
            type="button"
            className={language === 'en' ? 'active' : ''}
            onClick={() => onLanguage('en')}
          >
            English
          </button>
        </div>
        <div className="preview-toolbar-actions">
          {layout === 'pair' && !cardOpen && (
            <button type="button" onClick={() => setCardOpen(true)}>
              完成カード（非表示）を開く
            </button>
          )}
          <button type="button" onClick={() => setThumbOpen(true)}>
            サムネイル
          </button>
          <label className="check-field">
            <input
              type="checkbox"
              checked={showSafeZone}
              onChange={(event) => onShowSafeZone(event.target.checked)}
            />
            セーフゾーン
          </label>
        </div>
      </div>
      {layout === 'single' && (
        <div className="preview-tabs" role="tablist" aria-label="プレビュー表示">
          {(
            [
              ['short', '動画'],
              ['thumb', 'サムネイル'],
              ['card45', 'X用'],
              ['card', '完成カード'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={solo === id}
              className={solo === id ? 'active' : ''}
              onClick={() => setSolo(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className={`preview-stage is-${layout}`}>
        <div className={`preview-pane ${showShort ? '' : 'is-parked'}`}>
          <div className="preview-pane-label">
            <strong>動画</strong>
            <span>9:16</span>
          </div>
          <div className="preview-frame-slot">
            <div className="preview-frame">
              {playbackSuspended ? (
                <div className="preview-suspended">書き出し中</div>
              ) : (
                <Player
                  ref={playerRef}
                  component={LineupShortStandard}
                  spaceKeyToPlayOrPause={false}
                  inputProps={{
                    ...inputProps,
                    showSafeZone,
                    audioTracks,
                    audioTrack: audioTracks.find((track) => track.id === project.audio.bgm?.audioTrackId),
                  }}
                  durationInFrames={durationInFrames}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={fps}
                  controls
                  loop
                  style={{ width: '100%', height: '100%' }}
                />
              )}
            </div>
          </div>
        </div>
        {showThumb && (
          <div className="preview-pane">
            <div className="preview-pane-label">
              <strong>サムネイル</strong>
              <span>9:16</span>
              <button type="button" className="preview-float-close" onClick={() => setThumbOpen(true)}>
                拡大
              </button>
            </div>
            <ThumbnailFrameControls
              project={project}
              frameAt={() => playerRef.current?.getCurrentFrame() ?? 0}
              onApplied={(frame) => {
                holdFrame.current = frame;
              }}
            />
            <div className="preview-frame-slot">
              <div className="preview-frame">
                {playbackSuspended ? (
                  <div className="preview-suspended">書き出し中</div>
                ) : (
                  <Thumbnail
                    component={LineupThumbnail}
                    inputProps={inputProps}
                    frameToDisplay={0}
                    durationInFrames={1}
                    compositionWidth={1080}
                    compositionHeight={1920}
                    fps={fps}
                    style={{ width: '100%', height: '100%' }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
        {showCard45 && (
          <div className="preview-pane">
            <div className="preview-pane-label">
              <strong>X用カード</strong>
              <span>4:5</span>
              <button type="button" className="preview-float-close" onClick={() => setXCardZoomed(true)}>
                拡大
              </button>
            </div>
            <div className="preview-frame-slot">
              <div className="preview-frame ratio-45">
                {playbackSuspended ? (
                  <div className="preview-suspended">書き出し中</div>
                ) : (
                  <Player
                    component={LineupCardX45}
                    inputProps={inputProps}
                    durationInFrames={1}
                    compositionWidth={1080}
                    compositionHeight={1350}
                    fps={fps}
                    style={{ width: '100%', height: '100%' }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
        {showCard && (
          <div className={`preview-pane ${layout === 'pair' && cardOpen ? 'is-float' : ''}`}>
            <div className="preview-pane-label">
              <strong>完成カード</strong>
              <span>9:16</span>
              <span>{cardLayoutLabel(project)}</span>
              {layout === 'pair' && cardOpen && (
                <button type="button" className="preview-float-close" onClick={() => setCardOpen(false)}>
                  閉じる
                </button>
              )}
            </div>
            <div className="preview-frame-slot">
              <div className="preview-frame">
                {playbackSuspended ? (
                  <div className="preview-suspended">書き出し中</div>
                ) : (
                  <Player
                    component={LineupCard}
                    inputProps={inputProps}
                    durationInFrames={Math.round(fps * 2.5)}
                    compositionWidth={1080}
                    compositionHeight={1920}
                    fps={fps}
                    style={{ width: '100%', height: '100%' }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
        {layout === 'pair' && cardOpen && (
          <button
            type="button"
            className="preview-float-backdrop"
            aria-label="完成カードを閉じる"
            onClick={() => setCardOpen(false)}
          />
        )}
      </div>
      {xCardZoomed &&
        createPortal(
          <div className="x-card-modal" role="dialog" aria-modal="true" aria-label="X用カード拡大">
            <button
              type="button"
              className="x-card-modal-backdrop"
              aria-label="X用カードの拡大を閉じる"
              onClick={() => setXCardZoomed(false)}
            />
            <div className="x-card-modal-dialog">
              <div className="preview-pane-label">
                <strong>X用カード</strong>
                <span>4:5</span>
                <button type="button" className="preview-float-close" onClick={() => setXCardZoomed(false)}>
                  閉じる
                </button>
              </div>
              <div className="x-card-modal-frame">
                {playbackSuspended ? (
                  <div className="preview-suspended">書き出し中</div>
                ) : (
                  <Player
                    component={LineupCardX45}
                    inputProps={inputProps}
                    durationInFrames={1}
                    compositionWidth={1080}
                    compositionHeight={1350}
                    fps={fps}
                    style={{ width: '100%', height: '100%' }}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      {thumbOpen &&
        createPortal(
          <div className="x-card-modal" role="dialog" aria-modal="true" aria-label="サムネイル拡大">
            <button
              type="button"
              className="x-card-modal-backdrop"
              aria-label="サムネイルの拡大を閉じる"
              onClick={() => setThumbOpen(false)}
            />
            <div className="x-card-modal-dialog is-thumb">
              <div className="preview-pane-label">
                <strong>サムネイル</strong>
                <span>9:16</span>
                <button type="button" className="preview-float-close" onClick={() => setThumbOpen(false)}>
                  閉じる
                </button>
              </div>
              <ThumbnailFrameControls
                project={project}
                frameAt={() => playerRef.current?.getCurrentFrame() ?? 0}
                onApplied={(frame) => {
                  holdFrame.current = frame;
                }}
              />
              <div className="x-card-modal-frame is-thumb">
                {playbackSuspended ? (
                  <div className="preview-suspended">書き出し中</div>
                ) : (
                  <Thumbnail
                    component={LineupThumbnail}
                    inputProps={inputProps}
                    frameToDisplay={0}
                    durationInFrames={1}
                    compositionWidth={1080}
                    compositionHeight={1920}
                    fps={fps}
                    style={{ width: '100%', height: '100%' }}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      <div className="preview-meta">
        <span>
          {(durationInFrames / fps).toFixed(1)}秒 · {fps}fps
          {warnings.map((warning) => (
            <span key={warning} className="field-warning">
              {' '}
              {warning}
            </span>
          ))}
        </span>
      </div>
    </section>
  );
};
