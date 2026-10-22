import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { Player, Thumbnail, type PlayerRef } from '@remotion/player';
import {
  LineupCard,
  LineupCardX45,
  LineupShortStandard,
  resolveVariables,
} from '../../remotion/LineupShortStandard';
import { LineupThumbnail } from '../../remotion/LineupThumbnail';
import { ctaHostScene } from '../../shared/cta-design';
import { resolveCtaDesign, S4_CTA_HOLD_SEC } from '../../shared/s4-cta';
import { activeTimeline } from '../../shared/timeline';
import type { AudioTrack } from '../../shared/schema/audio';
import type { Language, Project } from '../../shared/schema/project';
import type { SceneKey } from '../../shared/schema/project-keys';
import { sceneGuideCopy, type GuideStepId } from '../../shared/guide';
import { publishingSafeText } from '../../shared/production';
import { stopBgmPreview } from './bgm-preview';
import { ShortsChrome } from './ShortsChrome';
import { TikTokChrome } from './TikTokChrome';
import type { CaptionPreviewId, CaptionPreviewTarget } from './steps';

const PREVIEW_MIN = 360;
const VIDEO_BASE = 270;
const CARD45_BASE = 240;
const CARD916_BASE = 190;

const inputProps = (
  project: Project,
  language: Language,
  audioTracks: AudioTrack[],
  showSafeZone: boolean,
) => ({
  project,
  language,
  mediaBaseUrl: 'studio-media://root',
  showSafeZone,
  audioTracks,
  audioTrack: audioTracks.find((track) => track.id === project.audio.bgm?.audioTrackId),
});

const clock = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
};

const captionPreviewLabel = (project: Project, id: CaptionPreviewId): string => {
  if (id === 'cta') return resolveCtaDesign(project) === 's4-block' ? 'S4 CTA' : 'S7 CTA';
  if (id === 'demo') return project.templateId === 't-guide' ? 'G4 実戦デモ' : 'S6 実戦デモ';
  if (project.templateId === 't-guide') {
    if (id === 'hook') return 'G1 タイトル';
    if (id === 'stand') return 'G2 手順';
    return 'G2 狙い（投げ方）';
  }
  if (id === 'hook') return 'S1 フック';
  if (id === 'stand') return 'S2 立ち位置';
  return 'S3 狙い（投げ方）';
};

const freezeAt = (project: Project, seconds: number): boolean =>
  activeTimeline(project).items.some((item) => {
    if (item.speed !== 1 || item.sourceOffset !== 0) return false;
    const freeze = project.scenes.find((scene) => scene.sceneKey === item.sceneKey)?.freeze;
    if (!freeze?.enabled || freeze.duration <= 0) return false;
    const start = item.start + freeze.at;
    return seconds >= start - 0.02 && seconds < start + freeze.duration - 0.02;
  });

const PreviewTransport = ({
  playerRef,
  fps,
  durationInFrames,
  origin,
  span,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  durationInFrames: number;
  origin: number;
  span: number;
}) => {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }): void => {
      setFrame(event.detail.frame);
    };
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    setFrame(player.getCurrentFrame());
    setPlaying(player.isPlaying());
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [playerRef, durationInFrames, origin]);

  const local = Math.min(Math.max(0, frame - origin), Math.max(0, span - 1));
  const max = Math.max(0, span - 1);
  const progress = max === 0 ? 0 : (local / max) * 100;

  return (
    <div className="gd-preview-controls">
      <input
        className="gd-preview-seek"
        type="range"
        min={0}
        max={max}
        step={1}
        value={local}
        aria-label="再生位置"
        aria-valuetext={`${clock(local / fps)} / ${clock(span / fps)}`}
        disabled={max === 0}
        style={{ '--seek': `${progress}%` } as CSSProperties}
        onChange={(event) => {
          const player = playerRef.current;
          if (!player) return;
          const next = Math.min(durationInFrames - 1, Math.max(0, origin + Number(event.target.value)));
          setFrame(next);
          player.seekTo(next);
        }}
      />
      <div className="gd-preview-transport">
        <button
          type="button"
          className="gd-preview-play"
          aria-label={playing ? '一時停止' : '再生'}
          onClick={() => {
            const player = playerRef.current;
            if (!player) return;
            if (player.isPlaying()) {
              player.pause();
              return;
            }
            stopBgmPreview();
            void player.play();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            {playing ? (
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
            ) : (
              <path d="M8 5l12 7-12 7z" fill="currentColor" />
            )}
          </svg>
        </button>
        <span className="gd-preview-time">
          {clock(local / fps)} / {clock(span / fps)}
        </span>
      </div>
    </div>
  );
};

const FreezeBadge = ({
  playerRef,
  project,
  fps,
}: {
  playerRef: RefObject<PlayerRef | null>;
  project: Project;
  fps: number;
}) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }): void => {
      setFrame(event.detail.frame);
    };
    player.addEventListener('frameupdate', onFrame);
    setFrame(player.getCurrentFrame());
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [playerRef, project, fps]);
  if (!freezeAt(project, frame / fps)) return null;
  return <span className="gd-freeze-badge">フリーズ中</span>;
};

export const GuidePreview = ({
  project,
  step,
  sceneKey,
  captionPreview,
  language,
  audioTracks,
  showSafeZone,
  onLanguage,
  playerRef,
  playbackFrameRef,
  exporting,
  collapsed,
  onToggle,
}: {
  project: Project;
  step: GuideStepId;
  sceneKey: SceneKey;
  captionPreview: CaptionPreviewTarget;
  language: Language;
  audioTracks: AudioTrack[];
  showSafeZone: boolean;
  onLanguage: (language: Language) => void;
  playerRef: RefObject<PlayerRef | null>;
  playbackFrameRef: RefObject<number>;
  exporting: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) => {
  const fps = project.templateParams.fps;
  const durationInFrames = Math.max(1, Math.round(activeTimeline(project).durationSec * fps));
  const captionThumb = step === 5 && captionPreview === 'thumb';
  const captionCard = step === 5 && (captionPreview === 'card' || captionPreview === 'x') ? captionPreview : null;
  const captionSceneKey =
    step === 5 && !captionCard
      ? captionPreview === 'cta'
        ? ctaHostScene(resolveCtaDesign(project))
        : (project.captions.find((caption) => caption.id === captionPreview)?.sceneKey ??
          (captionPreview === 'throw' ? 'aim' : captionPreview))
      : null;
  const loopKey = step === 5 ? captionSceneKey : step === 3 ? sceneKey : null;
  const item = loopKey
    ? activeTimeline(project).items.find((entry) => entry.sceneKey === loopKey)
    : undefined;
  const ctaLead =
    captionPreview === 'cta' && resolveCtaDesign(project) === 's4-block' && item
      ? Math.max(0, item.duration - S4_CTA_HOLD_SEC)
      : 0;
  const inFrame = item ? Math.round((item.start + ctaLead) * fps) : undefined;
  const outFrame = item
    ? Math.max((inFrame ?? 0) + 1, Math.round((item.start + item.duration) * fps) - 1)
    : undefined;
  const cards = step === 1 || step === 4 || step === 7;
  const video =
    !captionCard &&
    !captionThumb &&
    (step === 2 || step === 3 || step === 5 || step === 6 || step === 8 || step === 9 || step === 10);
  const showThumbnail = cards || step === 9;
  const props = useMemo(
    () => inputProps(project, language, audioTracks, showSafeZone),
    [project, language, audioTracks, showSafeZone],
  );
  const previewRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const [width, setWidth] = useState(PREVIEW_MIN);
  const [maxWidth, setMaxWidth] = useState(720);
  const [resizing, setResizing] = useState(false);
  const [videoWidth, setVideoWidth] = useState(VIDEO_BASE);
  const [cardWidth, setCardWidth] = useState(CARD45_BASE);
  const [postApp, setPostApp] = useState<'youtube' | 'tiktok'>('youtube');

  const clampWidth = (value: number): number => {
    const body = previewRef.current?.parentElement;
    const steps = body?.querySelector('.gd-steps')?.getBoundingClientRect().width ?? 240;
    const bodyWidth = body?.getBoundingClientRect().width ?? window.innerWidth;
    const max = Math.max(PREVIEW_MIN, Math.floor(bodyWidth - steps - 320));
    return Math.min(max, Math.max(PREVIEW_MIN, Math.round(value)));
  };

  useEffect(() => {
    const update = (): void => {
      const next = clampWidth(Number.POSITIVE_INFINITY);
      setMaxWidth(next);
      setWidth((current) => Math.min(current, next));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (captionCard || captionThumb) return;
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }): void => {
      playbackFrameRef.current = event.detail.frame;
    };
    player.addEventListener('frameupdate', onFrame);
    if (step === 5) {
      const next = Math.min(inFrame ?? 0, durationInFrames - 1);
      playbackFrameRef.current = next;
      player.seekTo(next);
    } else {
      const frame = playbackFrameRef.current;
      if (frame > 0) player.seekTo(Math.min(frame, durationInFrames - 1));
    }
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [playerRef, playbackFrameRef, project.id, step, sceneKey, captionPreview, captionCard, captionThumb, durationInFrames, inFrame]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || collapsed || exporting) return;
    const measure = (): void => {
      const style = getComputedStyle(body);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const availableW = Math.max(0, body.clientWidth - padX);
      const extra = Math.max(0, width - PREVIEW_MIN);
      if (video || captionCard || captionThumb) {
        const footH = footRef.current?.offsetHeight ?? 0;
        const availableH = Math.max(0, body.clientHeight - padY - footH - 12);
        const desired = VIDEO_BASE + extra;
        const aspect = captionCard === 'x' ? 4 / 5 : 9 / 16;
        const byHeight = availableH > 0 ? availableH * aspect : desired;
        const next = Math.max(160, Math.min(desired, availableW || desired, byHeight));
        setVideoWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
      }
      if (cards) {
        const desired = CARD45_BASE + extra;
        const scaleW = (availableW > 0 ? Math.min(desired, availableW) : desired) / CARD45_BASE;
        const labels = 16 + 5 + 12 + 16 + 5;
        const availableH = Math.max(0, body.clientHeight - padY - labels);
        const scaleH = availableH > 0 ? availableH / (338 + 300) : scaleW;
        const scale = Math.max(0.62, Math.min(scaleW, scaleH));
        const next = CARD45_BASE * scale;
        setCardWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [collapsed, exporting, video, cards, captionCard, captionThumb, width, step]);

  const onResizeDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, width };
    setResizing(true);
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(clampWidth(drag.width + (drag.x - event.clientX)));
  };
  const onResizeEnd = (): void => {
    dragRef.current = null;
    setResizing(false);
  };

  const layoutName = project.cardLayout === 'stack' ? 'B案' : 'A案';
  const posting = step === 8 || step === 9 || step === 10;
  const label = captionThumb
    ? 'サムネイル（9:16）'
    : captionCard === 'card'
    ? `完成カード（${layoutName} · 9:16）`
    : captionCard === 'x'
      ? 'X用カード（4:5）'
      : cards
        ? '完成カード・X用カード'
        : step === 5 && captionPreview !== 'card' && captionPreview !== 'x' && captionPreview !== 'thumb'
          ? item
            ? `${captionPreviewLabel(project, captionPreview)}（このテロップのシーン）`
            : captionPreviewLabel(project, captionPreview)
          : step === 3
            ? item
              ? `${sceneGuideCopy(project, sceneKey).title}（このシーンを繰り返し再生）`
              : `${sceneGuideCopy(project, sceneKey).title}（このシーンは入っていません）`
            : posting
              ? postApp === 'tiktok'
                ? 'TikTok での見え方'
                : 'YouTube Shorts での見え方'
              : '動画';
  const note = captionThumb
    ? 'このサムネイルの改行で表示しています'
    : captionCard
    ? 'このカードの改行で表示しています'
    : step === 5
      ? item
        ? 'このテロップが出るシーンを再生しています'
        : 'このテロップが出るシーンが動画にないため、全体を再生しています'
      : step === 3
        ? item
          ? 'シーン内の位置で再生しています'
          : 'このシーンは入っていないため、全体を再生しています'
        : posting
          ? postApp === 'tiktok'
            ? 'タイトルとハッシュタグの見え方の目安です。右側のボタンと下部のタブはTikTokの画面を模しています'
            : 'タイトルの見え方の目安です。チャンネル欄と右側のボタンはYouTube Shortsの画面を模しています'
          : '入力した内容がすぐに反映されます';
  const origin = inFrame ?? 0;
  const span = outFrame != null ? outFrame - origin + 1 : durationInFrames;
  const postTitle = publishingSafeText(
    resolveVariables(project.publishing.title[language], project, language),
  );
  const postTags = resolveVariables(project.publishing.hashtags[language], project, language)
    .replaceAll(/[[\]]/g, '')
    .trim();
  const shortsTitle = postTitle;
  const bgmTrack = audioTracks.find((track) => track.id === project.audio.bgm?.audioTrackId);
  const shortsSound = bgmTrack
    ? [bgmTrack.title, bgmTrack.artist].filter(Boolean).join(' · ')
    : 'オリジナルサウンド';
  const card45 = cardWidth;
  const card916 = card45 * (CARD916_BASE / CARD45_BASE);
  const thumbnailFrame = (width: number): ReactNode => (
    <div className="gd-preview-shot">
      <span>サムネイル（{language === 'ja' ? '日本語' : 'English'} · 9:16）</span>
      <div className="gd-phone is-card" style={{ width, height: width * (16 / 9) }}>
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
      </div>
    </div>
  );

  return (
    <aside
      ref={previewRef}
      className={`gd-preview ${collapsed ? 'is-collapsed' : ''} ${resizing ? 'is-resizing' : ''}`}
      style={collapsed ? undefined : { width }}
      aria-label="プレビュー"
    >
      {!collapsed && (
        <div
          className="gd-preview-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="プレビューの幅"
          aria-valuemin={PREVIEW_MIN}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          tabIndex={0}
          title="ドラッグで幅を変更"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onKeyDown={(event) => {
            const delta = event.shiftKey ? 48 : 16;
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setWidth((current) => clampWidth(current + delta));
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              setWidth((current) => clampWidth(current - delta));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setWidth(PREVIEW_MIN);
            }
          }}
        />
      )}
      <div className="gd-preview-bar">
        <strong>プレビュー</strong>
        <span className="gd-preview-sub">{label}</span>
        <span className="gd-spacer" />
        {collapsed ? (
          <button type="button" onClick={onToggle}>開く</button>
        ) : (
          <>
            {posting && (
              <div className="gd-lang" role="group" aria-label="投稿先のプレビュー">
                <button
                  type="button"
                  className={postApp === 'youtube' ? 'is-on' : ''}
                  aria-pressed={postApp === 'youtube'}
                  onClick={() => setPostApp('youtube')}
                >
                  YouTube
                </button>
                <button
                  type="button"
                  className={postApp === 'tiktok' ? 'is-on' : ''}
                  aria-pressed={postApp === 'tiktok'}
                  onClick={() => setPostApp('tiktok')}
                >
                  TikTok
                </button>
              </div>
            )}
            <div className="gd-lang" role="group" aria-label="言語">
              <button type="button" className={language === 'ja' ? 'is-on' : ''} onClick={() => onLanguage('ja')}>
                日本語
              </button>
              <button type="button" className={language === 'en' ? 'is-on' : ''} onClick={() => onLanguage('en')}>
                EN
              </button>
            </div>
            <button type="button" className="gd-hide" onClick={onToggle}>閉じる</button>
          </>
        )}
      </div>
      {!collapsed && (
        <div className="gd-preview-body" ref={bodyRef}>
          {exporting && <div className="preview-suspended">書き出し中</div>}
          {!exporting && cards && (
            <>
              <div className="gd-preview-shot">
                <span>完成カード（{layoutName} · 9:16）</span>
                <div className="gd-phone is-card" style={{ width: card916, height: card916 * (16 / 9) }}>
                  <Player
                    component={LineupCard}
                    inputProps={props}
                    durationInFrames={Math.max(1, Math.round(fps * 2.5))}
                    compositionWidth={1080}
                    compositionHeight={1920}
                    fps={fps}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>
              <div className="gd-preview-shot">
                <span>X用カード（4:5）</span>
                <div className="gd-phone is-card is-45" style={{ width: card45, height: card45 * (5 / 4) }}>
                  <Player
                    component={LineupCardX45}
                    inputProps={props}
                    durationInFrames={1}
                    compositionWidth={1080}
                    compositionHeight={1350}
                    fps={fps}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>
              {showThumbnail && thumbnailFrame(card916)}
            </>
          )}
          {!exporting && captionCard && (
            <>
              <div className="gd-preview-shot">
                <span>{captionCard === 'x' ? 'X用カード（4:5）' : `完成カード（${layoutName} · 9:16）`}</span>
                <div
                  className={`gd-phone is-card ${captionCard === 'x' ? 'is-45' : ''}`}
                  style={
                    captionCard === 'x'
                      ? { width: videoWidth, height: videoWidth * (5 / 4) }
                      : { width: videoWidth, height: videoWidth * (16 / 9) }
                  }
                >
                  <Player
                    component={captionCard === 'x' ? LineupCardX45 : LineupCard}
                    inputProps={props}
                    durationInFrames={captionCard === 'x' ? 1 : Math.max(1, Math.round(fps * 2.5))}
                    compositionWidth={1080}
                    compositionHeight={captionCard === 'x' ? 1350 : 1920}
                    fps={fps}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>
              <div className="gd-preview-foot" ref={footRef} style={{ width: videoWidth }}>
                <span className="gd-preview-note">{note}</span>
              </div>
            </>
          )}
          {!exporting && captionThumb && (
            <>
              {thumbnailFrame(videoWidth)}
              <div className="gd-preview-foot" ref={footRef} style={{ width: videoWidth }}>
                <span className="gd-preview-note">{note}</span>
              </div>
            </>
          )}
          {!exporting && video && (
            <>
              {step === 9 && thumbnailFrame(videoWidth)}
              <div
                className={`gd-phone ${step === 8 || step === 9 || step === 10 ? 'has-post' : ''}`}
                style={{ width: videoWidth, height: videoWidth * (16 / 9) }}
              >
                <Player
                  ref={playerRef}
                  component={LineupShortStandard}
                  inputProps={props}
                  durationInFrames={durationInFrames}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={fps}
                  loop
                  clickToPlay={false}
                  spaceKeyToPlayOrPause={false}
                  browserMediaControlsBehavior={{ mode: 'do-nothing' }}
                  inFrame={inFrame}
                  outFrame={outFrame}
                  initialFrame={playbackFrameRef.current}
                  style={{ width: '100%', height: '100%' }}
                />
                <FreezeBadge playerRef={playerRef} project={project} fps={fps} />
                {posting && postApp === 'youtube' && (
                  <ShortsChrome
                    title={shortsTitle}
                    sound={shortsSound}
                    playerRef={playerRef}
                    origin={origin}
                    span={span}
                  />
                )}
                {posting && postApp === 'tiktok' && (
                  <TikTokChrome
                    title={postTitle}
                    hashtags={postTags}
                    playerRef={playerRef}
                    origin={origin}
                    span={span}
                  />
                )}
              </div>
              <div className="gd-preview-foot" ref={footRef} style={{ width: videoWidth }}>
                <PreviewTransport
                  playerRef={playerRef}
                  fps={fps}
                  durationInFrames={durationInFrames}
                  origin={origin}
                  span={span}
                />
                <span className="gd-preview-note">{note}</span>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
