import { Fragment, type CSSProperties, type ReactNode } from 'react';
import '@fontsource/zen-kaku-gothic-new/700.css';
import '@fontsource/zen-kaku-gothic-new/900.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  Series,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { CardFrameSlot } from '../shared/export-media';
import { activeTimeline, bgmDurationForProject, bgmPlaybackGain, curveValue, playbackClip, playbackSceneKey, sceneDurations } from '../shared/timeline';
import type { TimelineItem } from '../shared/schema/timeline';
import type { AudioTrack } from '../shared/schema/audio';
import type { Language, Project, Scene, SceneKey } from '../shared/schema/project';
import { captionTextFor, defaultDemoCaption } from '../shared/schema/project';
import { MAP_NAMES_JA } from '../src/data/valorant-ja';
import {
  catalogMediaRelativePath,
  getAbilityCardIconPath,
  getAgentCardIconPath,
} from '../shared/valorant-catalog';
import cvLogoUrl from '../resources/brand/cv-logo.png';
import cvTitleUrl from '../resources/brand/cv-title.png';
import h1IconUrl from '../resources/brand/h1-icon.png';
import { aimMarkerVisibleAt, sceneSourceTime } from '../shared/aim-marker';
import {
  LIKE_CTA,
  LIKE_CTA_TYPE,
  likeCtaActive,
  likeCtaRect,
  likeThumbMotion,
  likeWatermarkTop,
  resolveLikeCtaText,
  resolveCtaDesign,
  S4_CTA,
  S4_CTA_COPY,
  s4CtaHoldFrames,
  s4CtaRect,
  s4CtaVisibleAtFrame,
  s4WatermarkTop,
  splitS4Subline,
  type CtaDeliveryPlatform,
} from '../shared/s4-cta';
import { S7_FRAME } from '../shared/s7-cta';
import { cardTitleBox, fitCardTitleFontSize, type CardTitleLatin } from './card-title-fit';
import { AimZoomChrome } from './AimZoomChrome';
import { AimMarker, AnnotationDim } from './AnnotationMarks';
import { annotationStyleOf, getAnnotationStyle, zoomChromeThickness } from '../shared/annotation-style';
import {
  aimZoomBadgeEdge,
  aimZoomBox,
  aimZoomLabelLeft,
  aimZoomSurface,
  cardAimPoint,
  resolveAimZoomFor,
  resolveVideoAimZoom,
} from '../shared/aim-zoom';
import { stillObjectPosition } from '../shared/still-focus';

export type LineupShortProps = {
  project: Project;
  language: Language;
  mediaBaseUrl: string;
  useOriginalMedia?: boolean;
  audioTrack?: AudioTrack;
  audioTracks?: AudioTrack[];
  withoutBgm?: boolean;
  showSafeZone?: boolean;
  frozenFrames?: Partial<Record<CardFrameSlot, string>>;
  /** 未指定は編集プレビュー（YouTube向けの高評価CTAを見せる）。 */
  deliveryPlatform?: CtaDeliveryPlatform;
};

const COLORS = {
  background: '#0F1923',
  panel: '#16232E',
  line: '#3A4A57',
  text: '#ECE8E1',
  secondary: '#9AA5AD',
  h1: '#FF7A2F',
};

const LABELS: Partial<Record<SceneKey, Record<Language, string>>> = {
  stand: { ja: '01 立ち位置', en: '01 STAND' },
  aim: { ja: '02 合わせ位置', en: '02 AIM' },
  throw: { ja: '03 発動イメージ', en: '03 RESULT' },
};

const stepBadgeText = (
  sceneKey: 'stand' | 'aim' | 'throw',
  language: Language,
): { number: string; label: string } => {
  const raw = LABELS[sceneKey]?.[language] ?? '';
  const space = raw.indexOf(' ');
  if (space === -1) return { number: raw, label: '' };
  return { number: raw.slice(0, space), label: raw.slice(space + 1) };
};

export const getSceneDurations = (project: Project): Record<SceneKey, number> => sceneDurations(project);

export const getDurationInFrames = (project: Project): number =>
  Math.max(1, Math.round(activeTimeline(project).durationSec * project.templateParams.fps));

const localizedJa = (table: Record<string, string>, id: string): string | undefined => {
  if (table[id]) return table[id];
  const match = Object.entries(table).find(([key]) => key.toLowerCase() === id.toLowerCase());
  return match?.[1];
};

export const resolveVariables = (text: string, project: Project, language: Language): string => {
  const lineup = project.lineup;
  const mapJa = localizedJa(MAP_NAMES_JA, lineup.map);
  const values: Record<string, string> = {
    map: language === 'ja' ? (mapJa ?? lineup.map) : lineup.map.toUpperCase(),
    site: language === 'ja' ? `${lineup.site}サイト` : `${lineup.site} SITE`,
    side:
      language === 'ja'
        ? lineup.side === 'attack'
          ? '攻め'
          : '守り'
        : lineup.side.toUpperCase(),
    agent: lineup.agent.toUpperCase(),
    ability: lineup.ability.replaceAll('-', ' ').toUpperCase(),
    throwType: lineup.throwType[language],
    charge: language === 'ja' ? `チャージ ${lineup.charge ?? 0}` : `CHARGE ${lineup.charge ?? 0}`,
    bounce:
      language === 'ja' ? `バウンス ${lineup.bounce ?? 0}` : `BOUNCE ${lineup.bounce ?? 0}`,
    standDescription: lineup.standDescription[language],
    aimDescription: lineup.aimDescription[language],
    br: '\n',
  };
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? `{${key}}`);
};

const AccentText = ({
  children,
  accent,
}: {
  children: string;
  accent: string;
}): ReactNode => {
  const lines = children.replaceAll('\r\n', '\n').split('\n');
  return lines.map((line, lineIndex) => (
    <Fragment key={`line-${lineIndex}`}>
      {lineIndex > 0 ? <br /> : null}
      {line.split(/(\[[^\]]+\])/g).map((part, index) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <span key={`${lineIndex}-${index}`} style={{ color: accent }}>
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
    </Fragment>
  ));
};

const GridBackground = (): ReactNode => (
  <AbsoluteFill
    style={{
      backgroundColor: COLORS.background,
      backgroundImage:
        'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)',
      backgroundSize: '40px 40px',
    }}
  />
);

const assetUrl = (base: string, relativePath: string): string =>
  `${base.replace(/\/$/, '')}/${relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

const aimBadgeShift = (
  project: Project,
  kind: 'card' | 'x',
  language: Language,
): { left?: number | string; right?: number | string } => {
  const surface = aimZoomSurface(project.cardLayout, kind);
  const layout = resolveAimZoomFor(project, surface, language);
  if (!layout) return { right: 0 };
  return aimZoomBadgeEdge(layout, aimZoomBox(surface, language));
};

const AimZoomOnFrame = ({
  project,
  kind,
  language,
  accent,
  stillId,
  mediaBaseUrl,
  frozenUrl,
}: {
  project: Project;
  kind: 'card' | 'x';
  language: Language;
  accent: string;
  stillId?: string;
  mediaBaseUrl: string;
  frozenUrl?: string;
}): ReactNode => {
  const { width } = useVideoConfig();
  const surface = aimZoomSurface(project.cardLayout, kind);
  const layout = resolveAimZoomFor(project, surface, language);
  if (!layout) return null;
  const still = project.stills.find((item) => item.id === stillId);
  return (
    <AimZoomChrome
      layout={layout}
      box={aimZoomBox(surface, language)}
      accent={accent}
      language={language}
      style={annotationStyleOf(project.annotationStyle)}
      frameWidth={width}
      note={project.cardAimZoom?.note?.[language]}
      stillUrl={still ? assetUrl(mediaBaseUrl, still.path) : frozenUrl}
      objectPosition={stillObjectPosition(still)}
    />
  );
};

const agentInitial = (agentValue: string): string => {
  const trimmed = agentValue.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toLocaleUpperCase();
};

type AgentAbilityBadgeProps = {
  project: Project;
  mediaBaseUrl: string;
  size: 'card' | 'x';
  style?: CSSProperties;
};

const AgentAbilityBadge = ({
  project,
  mediaBaseUrl,
  size,
  style,
}: AgentAbilityBadgeProps): ReactNode => {
  const agentSize = size === 'card' ? 220 : 150;
  const agentBorder = size === 'card' ? 8 : 6;
  const skillSize = size === 'card' ? 84 : 58;
  const skillRadius = size === 'card' ? 12 : 10;
  const skillBorder = size === 'card' ? 5 : 4;
  const skillOutset = size === 'card' ? 12 : 8;
  const agentIcon = getAgentCardIconPath(project.lineup.agent);
  const abilityIcon = getAbilityCardIconPath(project.lineup.agent, project.lineup.ability);
  const agentSrc = agentIcon
    ? assetUrl(mediaBaseUrl, catalogMediaRelativePath(agentIcon))
    : null;
  const abilitySrc = abilityIcon
    ? assetUrl(mediaBaseUrl, catalogMediaRelativePath(abilityIcon))
    : null;

  return (
    <div
      style={{
        position: 'relative',
        width: agentSize + skillOutset,
        height: agentSize + skillOutset,
        flexShrink: 0,
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: agentSize,
          height: agentSize,
          boxSizing: 'border-box',
          borderRadius: '50%',
          border: `${agentBorder}px solid #FF4655`,
          background: '#1E2A36',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {agentSrc ? (
          <Img
            src={agentSrc}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span
            style={{
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 800,
              fontSize: size === 'card' ? 84 : 56,
              color: COLORS.secondary,
              lineHeight: 1,
            }}
          >
            {agentInitial(project.lineup.agent)}
          </span>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          left: agentSize - skillSize + skillOutset,
          top: agentSize - skillSize + skillOutset,
          width: skillSize,
          height: skillSize,
          boxSizing: 'border-box',
          borderRadius: skillRadius,
          border: `${skillBorder}px solid ${COLORS.text}`,
          background: COLORS.background,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {abilitySrc ? (
          <Img
            src={abilitySrc}
            style={{ width: '78%', height: '78%', objectFit: 'contain' }}
          />
        ) : null}
      </div>
    </div>
  );
};

const BgmAudio = ({
  project,
  audioTrack,
  mediaBaseUrl,
  withoutBgm,
}: Pick<
  LineupShortProps,
  'project' | 'audioTrack' | 'mediaBaseUrl' | 'withoutBgm'
>): ReactNode => {
  const { fps } = useVideoConfig();
  const placement = project.audio.bgm;
  if (!placement || !audioTrack || withoutBgm || project.timelineMix?.muteBgm) return null;
  const durationSec = bgmDurationForProject(project);
  const startFrame = Math.round(placement.start * fps);
  const durationInFrames = Math.max(1, Math.round(durationSec * fps));
  const sourceOffsetFrames = Math.round(placement.offset * fps);
  const sourceFrames = Math.max(1, Math.round(audioTrack.durationSec * fps));
  const remainingSourceFrames = Math.max(1, sourceFrames - sourceOffsetFrames);
  const loop = durationInFrames > remainingSourceFrames + 1;
  return (
    <Sequence from={startFrame} durationInFrames={durationInFrames}>
      <Audio
        src={assetUrl(mediaBaseUrl, audioTrack.filePath)}
        startFrom={sourceOffsetFrames}
        endAt={loop ? undefined : sourceOffsetFrames + remainingSourceFrames}
        loop={loop}
        volume={(localFrame) => bgmPlaybackGain(project, localFrame / fps)}
      />
    </Sequence>
  );
};

const StillSlot = ({
  project,
  stillId,
  mediaBaseUrl,
  label,
}: {
  project: Project;
  stillId?: string;
  mediaBaseUrl: string;
  label: string;
}): ReactNode => {
  const still = project.stills.find((item) => item.id === stillId);
  return still ? (
    <Img
      src={assetUrl(mediaBaseUrl, still.path)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: stillObjectPosition(still) }}
    />
  ) : (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        color: COLORS.secondary,
        fontSize: 25,
      }}
    >
      {label}
    </div>
  );
};

const SceneMedia = ({
  project,
  scene,
  mediaBaseUrl,
  useOriginalMedia,
  item,
  frozenFrameUrl,
}: {
  project: Project;
  scene: Scene;
  mediaBaseUrl: string;
  useOriginalMedia?: boolean;
  item?: TimelineItem;
  frozenFrameUrl?: string;
}): ReactNode => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const speed = item?.speed ?? 1;
  const sourceOffset = item?.sourceOffset ?? 0;
  const layout = item?.layout ?? scene.layout916;
  const clip = (() => {
    if (item?.sceneKey === 'loop') {
      const resolved = playbackClip(project, 'loop');
      if (resolved) return resolved;
    }
    return project.clips.find((entry) => entry.id === scene.clipId);
  })();
  const leadIn = clip?.id === 'loop-before-hook';
  const asset = project.assets.find((entry) => entry.id === clip?.assetId);
  if (!clip || !asset) {
    return (
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          color: COLORS.secondary,
          fontFamily: 'Montserrat, sans-serif',
          fontSize: 32,
          letterSpacing: 4,
        }}
      >
        {scene.sceneKey.toUpperCase()} CLIP
      </AbsoluteFill>
    );
  }

  const src = assetUrl(
    mediaBaseUrl,
    useOriginalMedia ? asset.path : (asset.proxyPath ?? asset.path),
  );
  const zoom = scene.zoom?.enabled
    ? interpolate(frame, [0, Math.round(0.4 * fps)], [scene.zoom.from, scene.zoom.to], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const videoStyle: CSSProperties =
    layout === 'center-crop' || layout === 'split'
      ? {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: `${scene.cropCenterX * 100}% 50%`,
          transform: `scale(${zoom})`,
          transformOrigin: `${(scene.zoom?.x ?? 0.5) * 100}% ${(scene.zoom?.y ?? 0.5) * 100}%`,
        }
      : {
          width: S7_FRAME.width,
          height: S7_FRAME.footageHeight,
          objectFit: 'cover',
          position: 'absolute',
          top: S7_FRAME.footageTop,
          left: 0,
        };

  const origin = Math.round((clip.in + sourceOffset) * fps);
  const playedFrames = Math.max(
    1,
    Math.round((item?.duration ?? clip.out - clip.in) * fps * speed),
  );
  const video = (startFrom = origin, audible = true, style: CSSProperties = videoStyle): ReactNode =>
    frozenFrameUrl ? (
      <Img src={frozenFrameUrl} style={style} />
    ) : (
      <OffthreadVideo
        src={src}
        startFrom={startFrom}
        endAt={Math.min(Math.round(clip.out * fps), startFrom + playedFrames)}
        playbackRate={speed}
        volume={
          audible && !project.timelineMix?.muteGame
            ? curveValue(activeTimeline(project).volumePoints, (item?.start ?? 0) + frame / fps, 'game')
            : 0
        }
        style={style}
      />
    );

  if (layout === 'split') {
    return (
      <>
        <div style={{ position: 'absolute', top: 180, left: 0, width: 1080, height: 800, overflow: 'hidden' }}>
          {video()}
        </div>
        <div
          style={{
            position: 'absolute',
            top: 1020,
            left: 72,
            width: 936,
            height: 620,
            overflow: 'hidden',
            border: `4px solid ${project.templateParams.accent}`,
          }}
        >
          {video(origin, false, { width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.65)' })}
        </div>
      </>
    );
  }

  const foreground = !frozenFrameUrl && !leadIn && scene.freeze?.enabled && speed === 1 && sourceOffset === 0 ? (
    <Series>
      <Series.Sequence durationInFrames={Math.round(scene.freeze.at * fps)}>
        {video()}
      </Series.Sequence>
      <Series.Sequence durationInFrames={Math.round(scene.freeze.duration * fps)}>
        <Freeze frame={0}>{video(Math.round((clip.in + scene.freeze.at) * fps))}</Freeze>
      </Series.Sequence>
      <Series.Sequence durationInFrames={1_000_000}>
        {video(Math.round((clip.in + scene.freeze.at) * fps))}
      </Series.Sequence>
    </Series>
  ) : (
    video()
  );

  if (layout === 'center-crop') return foreground;
  return (
    <>
      {video(Math.round(clip.in * fps), false, {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        filter: 'blur(36px) brightness(.38)',
        transform: 'scale(1.1)',
      })}
      {foreground}
    </>
  );
};

const Caption = ({
  text,
  accent,
  kind,
}: {
  text: string;
  accent: string;
  kind: 'hook' | 'step' | 'throw';
}): ReactNode => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale =
    kind === 'hook'
      ? interpolate(frame, [0, 0.2 * fps], [0.82, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  const styles: Record<typeof kind, CSSProperties> = {
    hook: { top: 230, fontSize: 88, lineHeight: 1.4, textAlign: 'center' },
    step: { top: 1240, fontSize: 60, lineHeight: 1.12, textAlign: 'left' },
    throw: {
      top: 1260,
      fontSize: 40,
      lineHeight: 1.1,
      textAlign: 'center',
      background: 'rgba(15,25,35,.92)',
      padding: '22px 32px',
    },
  };
  const floating = kind !== 'throw';
  // HOOK はセーフゾーン幅に縛らず、画面（1080）中央に置く
  const box = kind === 'hook' ? { left: 0, width: 1080 } : { left: 72, width: 840 };
  return (
    <div
      style={{
        position: 'absolute',
        ...box,
        color: COLORS.text,
        fontFamily: 'Montserrat, "Zen Kaku Gothic New", sans-serif',
        fontWeight: 900,
        whiteSpace: 'pre-line',
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
        lineBreak: 'strict',
        transform: `scale(${scale})`,
        zIndex: 4,
        ...styles[kind],
      }}
    >
      {floating && (
        <>
          {/* 字の形に沿った黒い影。明るい映像の上でも輪郭が残る。 */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              color: '#000',
              filter: 'blur(0.22em)',
              opacity: 0.9,
              transform: 'translateY(0.1em)',
              pointerEvents: 'none',
            }}
          >
            <AccentText accent="#000">{text}</AccentText>
          </div>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              color: '#000',
              filter: 'blur(0.08em)',
              opacity: 1,
              transform: 'translateY(0.045em)',
              pointerEvents: 'none',
            }}
          >
            <AccentText accent="#000">{text}</AccentText>
          </div>
        </>
      )}
      <div style={{ position: 'relative', textShadow: floating ? 'none' : '0 2px 10px rgba(0,0,0,0.55)' }}>
        <AccentText accent={accent}>{text}</AccentText>
      </div>
    </div>
  );
};

const STACK_COPY: Record<
  Language,
  {
    standEmpty: string;
    resultEmpty: string;
    footer: string;
  }
> = {
  ja: {
    standEmpty: '[立ち位置のスクショ]',
    resultEmpty: '[着弾・発動のスクショ]',
    footer: '定点はアプリに保存 →',
  },
  en: {
    standEmpty: '[Stand spot]',
    resultEmpty: '[Reveal / impact]',
    footer: 'Save this lineup →',
  },
};

/** 帯の中で字面を上下中央に揃える。Chakra Petch の大文字は em ボックス内で上に寄る。 */
const badgeGlyph = (edge: 'cap alphabetic' | 'ideographic'): CSSProperties =>
  ({
    lineHeight: 1,
    textBoxTrim: 'trim-both',
    textBoxEdge: edge,
  }) as CSSProperties;

/**
 * 日本語のステップ帯で、数字をラベルの字面中央へ下ろす。
 * line-height:1 で揃えると Chakra Petch の数字が Zen Kaku Gothic New より上に見える。
 * text-box-trim の ideographic は字面より大きい枠なので、数字と日本語の中心は揃わない。
 * Chrome 149 で字面の重心を測った補正。ヒンティングのため 24px と 28px で比率が違う。
 */
const jaNumberShift = (compact: boolean): string =>
  compact ? 'translateY(0.075em)' : 'translateY(0.105em)';

const StepArrow = ({ accent, compact = false }: { accent: string; compact?: boolean }): ReactNode => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      flexShrink: 0,
      boxSizing: 'border-box',
      height: compact ? 28 : undefined,
    }}
  >
    <svg
      width={compact ? 36 : 48}
      height={compact ? 12 : 24}
      viewBox="0 0 48 24"
      fill="none"
      stroke={accent}
      strokeWidth="4"
    >
      <polyline points="4,4 24,20 44,4" />
    </svg>
  </div>
);

const Crosshair = ({ accent }: { accent: string }): ReactNode => (
  <svg width="110" height="110" viewBox="0 0 120 120" fill="none" stroke={accent} strokeWidth="3">
    <circle cx="60" cy="60" r="34" />
    <line x1="60" y1="6" x2="60" y2="36" />
    <line x1="60" y1="84" x2="60" y2="114" />
    <line x1="6" y1="60" x2="36" y2="60" />
    <line x1="84" y1="60" x2="114" y2="60" />
  </svg>
);

const CardStepMedia = ({
  project,
  sceneKey,
  stillId,
  mediaBaseUrl,
  useOriginalMedia,
  frozenFrameUrl,
  emptyLabel,
  accent,
  showCrosshair,
}: {
  project: Project;
  sceneKey: SceneKey;
  stillId?: string;
  mediaBaseUrl: string;
  useOriginalMedia?: boolean;
  frozenFrameUrl?: string;
  emptyLabel?: string;
  accent: string;
  showCrosshair?: boolean;
}): ReactNode => {
  const { fps } = useVideoConfig();
  const still = project.stills.find((item) => item.id === stillId);
  const scene = project.scenes.find((item) => item.sceneKey === sceneKey);
  const clip = project.clips.find((item) => item.id === scene?.clipId);
  const asset = project.assets.find((item) => item.id === clip?.assetId);
  const hasMedia = Boolean(still || frozenFrameUrl || (clip && asset));
  return (
    <>
      {still ? (
        <Img
          src={assetUrl(mediaBaseUrl, still.path)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: stillObjectPosition(still) }}
        />
      ) : frozenFrameUrl ? (
        <Img src={frozenFrameUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : clip && asset ? (
        <OffthreadVideo
          src={assetUrl(
            mediaBaseUrl,
            useOriginalMedia ? asset.path : (asset.proxyPath ?? asset.path),
          )}
          startFrom={Math.round(clip.in * fps)}
          endAt={Math.round(clip.out * fps)}
          volume={0}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: COLORS.secondary,
            fontSize: 24,
          }}
        >
          {showCrosshair ? <Crosshair accent={accent} /> : emptyLabel}
        </div>
      )}
      {showCrosshair && hasMedia && <CardAimRing project={project} accent={accent} />}
    </>
  );
};

const CARD_TITLE_LINES = 2;
const CARD_TITLE_LINE_HEIGHT = 1.15;

const fittedTitleSize = (
  text: string,
  language: Language,
  box: { width: number; maxJa: number; maxEn: number; min: number; latin: CardTitleLatin },
): number =>
  fitCardTitleFontSize(text, {
    maxWidth: box.width,
    maxLines: CARD_TITLE_LINES,
    maxSize: language === 'ja' ? box.maxJa : box.maxEn,
    minSize: box.min,
    latin: box.latin,
  });

const LineupCardStack = ({
  project,
  language,
  mediaBaseUrl,
  useOriginalMedia,
  frozenFrames,
  compact = false,
}: LineupShortProps & { compact?: boolean }): ReactNode => {
  const { width } = useVideoConfig();
  const accent = project.templateParams.accent;
  const copy = STACK_COPY[language];
  const hook = project.captions.find((caption) => caption.id === 'hook');
  const title = resolveVariables(
    captionTextFor(hook, language, compact ? 'x' : 'card'),
    project,
    language,
  );
  const titleBox = compact ? cardTitleBox.stackX : cardTitleBox.stack;
  const titleMax = language === 'ja' ? titleBox.maxJa : titleBox.maxEn;
  const titleSize = fittedTitleSize(title, language, titleBox);
  const titleTwoLineHeight = Math.ceil(titleMax * CARD_TITLE_LINE_HEIGHT * CARD_TITLE_LINES);
  const steps = (
    [
      {
        key: 'stand' as const,
        sceneKey: 'stand' as const,
        stillId: project.cardStills.stand,
        empty: copy.standEmpty,
        active: false,
      },
      {
        key: 'aim' as const,
        sceneKey: 'aim' as const,
        stillId: project.cardStills.aim,
        empty: undefined,
        active: true,
      },
      {
        key: 'result' as const,
        sceneKey: 'throw' as const,
        stillId: project.cardStills.result,
        empty: copy.resultEmpty,
        active: false,
      },
    ] as const
  ).map((step) => ({ ...step, ...stepBadgeText(step.sceneKey, language) }));
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        color: COLORS.text,
        fontFamily: '"Zen Kaku Gothic New", Montserrat, sans-serif',
      }}
    >
      <GridBackground />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          boxSizing: 'border-box',
          padding: compact ? '32px 40px 32px' : '200px 72px 0 72px',
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 28 : 32,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 24,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10, minWidth: 0, maxWidth: compact ? 750 : 625 }}>
            <span
              style={{
                display: 'block',
                fontFamily: 'Chakra Petch, sans-serif',
                fontSize: compact ? 16 : 26,
                fontWeight: 600,
                letterSpacing: 4,
                lineHeight: compact ? '20px' : undefined,
                height: compact ? 20 : undefined,
                color: accent,
              }}
            >
              {project.lineup.map.toUpperCase()} / {project.lineup.site} SITE
            </span>
            <div
              style={{
                fontSize: titleSize,
                lineHeight: CARD_TITLE_LINE_HEIGHT,
                fontWeight: 900,
                height: compact ? titleTwoLineHeight : undefined,
                minHeight: compact || titleSize < titleMax ? titleTwoLineHeight : undefined,
                display: '-webkit-box',
                WebkitLineClamp: CARD_TITLE_LINES,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                whiteSpace: 'pre-line',
                wordBreak: 'keep-all',
                overflowWrap: 'anywhere',
                lineBreak: 'strict',
              }}
            >
              <AccentText accent={accent}>{title}</AccentText>
            </div>
          </div>
          <AgentAbilityBadge
            project={project}
            mediaBaseUrl={mediaBaseUrl}
            size={compact ? 'x' : 'card'}
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: compact ? 1 : undefined,
            minHeight: compact ? 0 : undefined,
            gap: compact ? 0 : 14,
          }}
        >
          {steps.map((step, index) => (
            <Fragment key={step.key}>
              {index > 0 && <StepArrow accent={accent} compact={compact} />}
              <div
                style={{
                  height: compact ? undefined : 290,
                  flex: compact ? 1 : undefined,
                  minHeight: compact ? 0 : undefined,
                  border: `2px solid ${step.active ? accent : COLORS.line}`,
                  position: 'relative',
                  overflow: 'hidden',
                  background: COLORS.panel,
                }}
              >
                {(() => {
                  const frozenUrl = (() => {
                    const framePath = frozenFrames?.[step.key];
                    return framePath ? assetUrl(mediaBaseUrl, framePath) : undefined;
                  })();
                  const surface = aimZoomSurface(project.cardLayout, compact ? 'x' : 'card');
                  const aimLayout = step.active ? resolveAimZoomFor(project, surface, language) : null;
                  const aimBox = aimLayout ? aimZoomBox(surface, language) : null;
                  const still = project.stills.find((item) => item.id === step.stillId);
                  const media = (
                    <CardStepMedia
                      project={project}
                      sceneKey={step.sceneKey}
                      stillId={step.stillId}
                      mediaBaseUrl={mediaBaseUrl}
                      useOriginalMedia={useOriginalMedia}
                      frozenFrameUrl={frozenUrl}
                      emptyLabel={step.empty}
                      accent={accent}
                      showCrosshair={step.active}
                    />
                  );
                  return (
                    <>
                      {aimLayout?.split ? (
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            height: '100%',
                            width: '100%',
                            left: `${((aimLayout.split.imageLeft - aimLayout.split.crop) / aimBox!.width) * 100}%`,
                          }}
                        >
                          {media}
                        </div>
                      ) : (
                        media
                      )}
                      {step.active && (
                        <CardFrameDim project={project} kind={compact ? 'x' : 'card'} language={language} />
                      )}
                      {aimLayout && aimBox && (
                        <AimZoomChrome
                          layout={aimLayout}
                          box={aimBox}
                          accent={accent}
                          language={language}
                          style={annotationStyleOf(project.annotationStyle)}
                          frameWidth={width}
                          note={project.cardAimZoom?.note?.[language]}
                          stillUrl={still ? assetUrl(mediaBaseUrl, still.path) : frozenUrl}
                          objectPosition={stillObjectPosition(still)}
                        />
                      )}
                    </>
                  );
                })()}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: (() => {
                      if (!step.active) return 0;
                      const surface = aimZoomSurface(project.cardLayout, compact ? 'x' : 'card');
                      const aimLayout = resolveAimZoomFor(project, surface, language);
                      return aimLayout ? aimZoomLabelLeft(aimLayout, aimZoomBox(surface, language)) : 0;
                    })(),
                    zIndex: 3,
                    display: 'flex',
                    alignItems: 'center',
                    boxSizing: 'border-box',
                    height: compact ? 52 : 60,
                    gap: 12,
                    padding: compact ? '14px 16px' : '16px 20px',
                    background: step.active ? accent : COLORS.background,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'Chakra Petch, sans-serif',
                      fontSize: compact ? 24 : 28,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: step.active ? COLORS.background : accent,
                      transform: language === 'ja' ? jaNumberShift(compact) : undefined,
                      ...(language === 'ja' ? {} : badgeGlyph('cap alphabetic')),
                    }}
                  >
                    {step.number}
                  </span>
                  <span
                    style={{
                      fontFamily:
                        language === 'ja'
                          ? '"Zen Kaku Gothic New", sans-serif'
                          : 'Chakra Petch, sans-serif',
                      fontSize: compact ? 24 : 28,
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: language === 'ja' ? 0 : 3,
                      color: step.active ? COLORS.background : COLORS.text,
                      ...(language === 'ja' ? {} : badgeGlyph('cap alphabetic')),
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                {step.active && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      zIndex: 3,
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: compact ? '10px 16px' : '12px 22px',
                      background: COLORS.background,
                      display: 'flex',
                      alignItems: 'center',
                      ...(() => {
                        const surface = aimZoomSurface(project.cardLayout, compact ? 'x' : 'card');
                        const aimLayout = resolveAimZoomFor(project, surface, language);
                        return aimLayout
                          ? aimZoomBadgeEdge(aimLayout, aimZoomBox(surface, language))
                          : { right: 0 };
                      })(),
                    }}
                  >
                    <span style={{ fontSize: compact ? 26 : 30, fontWeight: 900 }}>
                      {project.lineup.throwType[language]}
                    </span>
                  </div>
                )}
              </div>
            </Fragment>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: compact ? 12 : 18,
            flexShrink: 0,
            height: compact ? 32 : undefined,
          }}
        >
          <Img
            src={cvTitleUrl}
            style={{
              height: compact ? 32 : 48,
              width: compact ? 206 : 310,
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              marginLeft: 'auto',
              fontSize: compact ? 18 : 24,
              fontWeight: 700,
              color: COLORS.secondary,
            }}
          >
            {copy.footer}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const LineupCard = (props: LineupShortProps): ReactNode =>
  (props.project.cardLayout ?? 'stack') === 'stack' ? (
    <LineupCardStack {...props} />
  ) : (
    <LineupCardAim {...props} />
  );

export const LineupCardX45 = (props: LineupShortProps): ReactNode =>
  (props.project.cardLayout ?? 'stack') === 'stack' ? (
    <LineupCardStack {...props} compact />
  ) : (
    <LineupCardX45Aim {...props} />
  );

const LineupCardX45Aim = ({
  project,
  language,
  mediaBaseUrl,
  useOriginalMedia,
  frozenFrames,
}: LineupShortProps): ReactNode => {
  const accent = project.templateParams.accent;
  const hook = project.captions.find((caption) => caption.id === 'hook');
  const title = resolveVariables(captionTextFor(hook, language, 'x'), project, language);
  const titleSize = fittedTitleSize(title, language, cardTitleBox.aimX);
  const cardScene = project.scenes.find((scene) => scene.sceneKey === 'aim');
  const throwSummary = project.lineup.throwType[language];
  const padX = 40;
  const padY = 32;
  const gap = 28;
  const frameW = 1080 - padX * 2;
  const titleH = 104;
  const footerH = 44;
  const aimH = 678;
  const subH = 354;
  const subGap = 28;
  const subW = (frameW - subGap) / 2;
  const metaTop = padY;
  const titleTop = metaTop + 22;
  const agentTop = metaTop;
  const agentLeft = 1080 - padX - 150;
  const aimTop = titleTop + titleH + gap;
  const subTop = aimTop + aimH + gap;
  const footerTop = 1350 - padY - footerH;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background, color: COLORS.text }}>
      <GridBackground />
      <div style={{ position: 'absolute', left: padX, top: metaTop, color: accent, fontSize: 18, fontWeight: 700 }}>
        {project.lineup.map.toUpperCase()} / {project.lineup.site} SITE / {project.lineup.side.toUpperCase()}
      </div>
      <AgentAbilityBadge
        project={project}
        mediaBaseUrl={mediaBaseUrl}
        size="x"
        style={{ position: 'absolute', left: agentLeft, top: agentTop }}
      />
      <div
        style={{
          position: 'absolute',
          left: padX,
          top: titleTop,
          width: 750,
          height: 104,
          fontFamily: 'Montserrat, "Zen Kaku Gothic New", sans-serif',
          fontSize: titleSize,
          fontWeight: 900,
          lineHeight: CARD_TITLE_LINE_HEIGHT,
          display: '-webkit-box',
          WebkitLineClamp: CARD_TITLE_LINES,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          whiteSpace: 'pre-line',
          wordBreak: 'keep-all',
          overflowWrap: 'anywhere',
          lineBreak: 'strict',
        }}
      >
        <AccentText accent={accent}>{title}</AccentText>
      </div>
      <div
        style={{
          position: 'absolute',
          left: padX,
          top: aimTop,
          width: frameW,
          height: aimH,
          border: `5px solid ${accent}`,
          overflow: 'hidden',
          background: COLORS.panel,
        }}
      >
        {project.cardStills.aim ? (
          <StillSlot project={project} stillId={project.cardStills.aim} mediaBaseUrl={mediaBaseUrl} label="AIM" />
        ) : cardScene ? (
          <SceneMedia
            project={project}
            scene={cardScene}
            mediaBaseUrl={mediaBaseUrl}
            useOriginalMedia={useOriginalMedia}
            frozenFrameUrl={frozenFrames?.aim ? assetUrl(mediaBaseUrl, frozenFrames.aim) : undefined}
          />
        ) : null}
        <CardFrameDim project={project} kind="x" language={language} />
        <CardAimRing project={project} accent={accent} />
        <AimZoomOnFrame
          project={project}
          kind="x"
          language={language}
          accent={accent}
          stillId={project.cardStills.aim}
          mediaBaseUrl={mediaBaseUrl}
          frozenUrl={frozenFrames?.aim ? assetUrl(mediaBaseUrl, frozenFrames.aim) : undefined}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            zIndex: 3,
            maxWidth: '78%',
            padding: '14px 20px',
            background: 'rgba(15,25,35,.92)',
            fontSize: 28,
            fontWeight: 900,
            ...aimBadgeShift(project, 'x', language),
          }}
        >
          {throwSummary}
        </div>
      </div>
      <div style={{ position: 'absolute', left: padX, top: subTop, width: frameW, display: 'flex', gap: subGap }}>
        {(['STAND', 'RESULT'] as const).map((label) => (
          <div
            key={label}
            style={{
              width: subW,
              height: subH,
              border: `2px solid ${COLORS.line}`,
              background: COLORS.panel,
              overflow: 'hidden',
            }}
          >
            <StillSlot
              project={project}
              stillId={label === 'STAND' ? project.cardStills.stand : project.cardStills.result}
              mediaBaseUrl={mediaBaseUrl}
              label={label}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: padX,
          top: footerTop,
          width: frameW,
          height: footerH,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          borderTop: `2px solid ${COLORS.line}`,
          color: COLORS.secondary,
          fontSize: 18,
        }}
      >
        <Img src={cvTitleUrl} style={{ height: 32, width: 206 }} />
        <span>{language === 'ja' ? 'ラウンド間でも、これ1枚。' : 'Save it. Check it between rounds.'}</span>
      </div>
    </AbsoluteFill>
  );
};

const LineupCardAim = ({
  project,
  language,
  mediaBaseUrl,
  useOriginalMedia,
  frozenFrames,
}: LineupShortProps): ReactNode => {
  const accent = project.templateParams.accent;
  const hook = project.captions.find((caption) => caption.id === 'hook');
  const title = resolveVariables(captionTextFor(hook, language, 'card'), project, language);
  const titleSize = fittedTitleSize(title, language, cardTitleBox.aim);
  const cardScene = project.scenes.find((scene) => scene.sceneKey === 'aim');
  const throwSummary = project.lineup.throwType[language];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background, color: COLORS.text }}>
      <GridBackground />
      <div style={{ position: 'absolute', left: 72, top: 210, color: accent, fontSize: 28 }}>
        {project.lineup.map.toUpperCase()} / {project.lineup.site} SITE /{' '}
        {project.lineup.side.toUpperCase()}
      </div>
      <AgentAbilityBadge
        project={project}
        mediaBaseUrl={mediaBaseUrl}
        size="card"
        style={{ position: 'absolute', left: 1080 - 72 - 220, top: 210 }}
      />
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 268,
          width: 625,
          fontFamily: 'Montserrat, "Zen Kaku Gothic New", sans-serif',
          fontSize: titleSize,
          fontWeight: 900,
          lineHeight: 1.12,
          display: '-webkit-box',
          WebkitLineClamp: CARD_TITLE_LINES,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          whiteSpace: 'pre-line',
          wordBreak: 'keep-all',
          overflowWrap: 'anywhere',
          lineBreak: 'strict',
        }}
      >
        <AccentText accent={accent}>{title}</AccentText>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 428,
          width: 840,
          height: 520,
          border: `5px solid ${accent}`,
          overflow: 'hidden',
          background: COLORS.panel,
        }}
      >
        {project.cardStills.aim ? (
          <StillSlot
            project={project}
            stillId={project.cardStills.aim}
            mediaBaseUrl={mediaBaseUrl}
            label="AIM"
          />
        ) : cardScene ? (
          <SceneMedia
            project={project}
            scene={cardScene}
            mediaBaseUrl={mediaBaseUrl}
            useOriginalMedia={useOriginalMedia}
            frozenFrameUrl={frozenFrames?.aim ? assetUrl(mediaBaseUrl, frozenFrames.aim) : undefined}
          />
        ) : null}
        <CardFrameDim project={project} kind="card" language={language} />
        <CardAimRing project={project} accent={accent} />
        <AimZoomOnFrame
          project={project}
          kind="card"
          language={language}
          accent={accent}
          stillId={project.cardStills.aim}
          mediaBaseUrl={mediaBaseUrl}
          frozenUrl={frozenFrames?.aim ? assetUrl(mediaBaseUrl, frozenFrames.aim) : undefined}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 984,
          width: 840,
          display: 'flex',
          gap: 16,
        }}
      >
        {(['STAND', 'RESULT'] as const).map((label) => (
          <div
            key={label}
            style={{
              width: 412,
              height: 232,
              border: `2px solid ${COLORS.line}`,
              background: COLORS.panel,
              overflow: 'hidden',
            }}
          >
            <StillSlot
              project={project}
              stillId={
                label === 'STAND' ? project.cardStills.stand : project.cardStills.result
              }
              mediaBaseUrl={mediaBaseUrl}
              label={label}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 1296,
          width: 840,
          padding: '28px 34px',
          boxSizing: 'border-box',
          background: COLORS.panel,
          fontSize: 35,
          fontWeight: 800,
        }}
      >
        {throwSummary}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 1426,
          width: 840,
          height: 90,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          borderTop: `2px solid ${COLORS.line}`,
          color: COLORS.secondary,
          fontSize: 22,
        }}
      >
        <Img src={cvTitleUrl} style={{ height: 48, width: 310 }} />
        <span>
          {language === 'ja' ? 'ラウンド間でも、これ1枚。' : 'Save it. Check it between rounds.'}
        </span>
      </div>
    </AbsoluteFill>
  );
};

const CardFrameDim = ({
  project,
  kind,
  language,
}: {
  project: Project;
  kind: 'card' | 'x';
  language: Language;
}): ReactNode => {
  const { width } = useVideoConfig();
  const surface = aimZoomSurface(project.cardLayout, kind);
  const box = aimZoomBox(surface, language);
  const layout = resolveAimZoomFor(project, surface, language);
  const point = cardAimPoint(project);
  const center = layout?.center ?? (point ? { x: point.x, y: point.y } : null);
  if (!center) return null;
  return (
    <AnnotationDim
      style={annotationStyleOf(project.annotationStyle)}
      frameWidth={width}
      center={center}
      shortSide={Math.min(box.width, box.height)}
      zoom={Boolean(layout)}
      cropSize={layout?.source.size}
    />
  );
};

const CardAimRing = ({ project, accent }: { project: Project; accent: string }): ReactNode => {
  const { width } = useVideoConfig();
  const point = cardAimPoint(project);
  if (!point || project.cardAimZoom?.enabled) return null;
  return (
    <AimMarker
      x={point.x}
      y={point.y}
      accent={accent}
      size={point.size}
      style={annotationStyleOf(project.annotationStyle)}
      frameWidth={width}
      zIndex={2}
    />
  );
};

const S7Close = ({
  text,
  accent,
  durationSec,
  language,
}: {
  text: string;
  accent: string;
  durationSec: number;
  language: Language;
}): ReactNode => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = Math.max(1, Math.round(0.2 * fps));
  const total = Math.max(fadeIn + 2, Math.round(durationSec * fps));
  const fadeOut = Math.max(fadeIn + 1, total - Math.round(0.15 * fps));
  const opacity = interpolate(frame, [0, fadeIn, fadeOut, total], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: 'none', zIndex: 4 }}>
      {text ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: S7_FRAME.plateTop,
            width: S7_FRAME.width,
            height: S7_FRAME.plateHeight,
            background: S7_FRAME.plateBackground,
          }}
        />
      ) : null}
      {text ? (
        <div
          style={{
            position: 'absolute',
            left: 72,
            width: 936,
            top: S7_FRAME.ctaTop,
            color: '#FFFFFF',
            fontFamily:
              language === 'ja'
                ? '"Zen Kaku Gothic New", Montserrat, sans-serif'
                : 'Montserrat, "Zen Kaku Gothic New", sans-serif',
            fontWeight: 900,
            fontSize: S7_FRAME.ctaFontSize,
            lineHeight: S7_FRAME.ctaLineHeight,
            textAlign: 'center',
            whiteSpace: 'pre-line',
            wordBreak: 'keep-all',
            textShadow: '0 4px 0 #000',
          }}
        >
          <AccentText accent={accent}>{text}</AccentText>
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 0,
          width: S7_FRAME.width,
          top: S7_FRAME.lockupTop,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            height: S7_FRAME.lockupHeight,
            width: S7_FRAME.lockupWidth,
            padding: '4px 12px',
            borderRadius: 8,
            background: '#07090C',
            display: 'flex',
            alignItems: 'center',
            boxSizing: 'border-box',
          }}
        >
          <Img
            src={cvTitleUrl}
            style={{ height: S7_FRAME.lockupHeight - 8, width: S7_FRAME.lockupWidth - 24 }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const LikeThumb = ({ size }: { size: number }): ReactNode => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
    <path
      fill={LIKE_CTA.thumbFill}
      stroke="none"
      style={{ fill: LIKE_CTA.thumbFill, stroke: 'none' }}
      d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"
    />
  </svg>
);

const S4LikeCtaBlock = ({
  project,
  language,
  durationSec,
}: {
  project: Project;
  language: Language;
  durationSec: number;
}): ReactNode => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const caption = project.captions.find((item) => item.id === 'cta');
  if (caption?.hidden) return null;
  if (!s4CtaVisibleAtFrame(frame, fps, durationSec)) return null;
  const stored = resolveLikeCtaText(project);
  const line1 = resolveVariables(stored.line1[language], project, language).trim();
  const before = resolveVariables(stored.before[language], project, language);
  const after = resolveVariables(stored.after[language], project, language);
  if (!line1 && !before.trim() && !after.trim()) return null;
  const type = LIKE_CTA_TYPE[language];
  const hold = s4CtaHoldFrames(fps, durationSec);
  const total = Math.max(1, Math.round(Math.max(0, durationSec) * fps));
  const elapsed = (frame - (total - hold)) / fps;
  const motion = likeThumbMotion(elapsed, stored.motion !== false, hold / fps);
  const rect = likeCtaRect();
  const font =
    language === 'ja'
      ? '"Zen Kaku Gothic New", sans-serif'
      : 'Montserrat, "Zen Kaku Gothic New", sans-serif';
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        boxSizing: 'border-box',
        padding: `${LIKE_CTA.paddingY}px ${LIKE_CTA.paddingX}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: LIKE_CTA.rowGap,
        background: LIKE_CTA.background,
        border: LIKE_CTA.border,
        borderRadius: LIKE_CTA.radius,
        overflow: 'visible',
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontFamily: font,
          fontWeight: 700,
          fontSize: type.line1,
          lineHeight: `${type.line1Height}px`,
          color: LIKE_CTA.line1Color,
          whiteSpace: 'nowrap',
          textAlign: 'center',
        }}
      >
        {line1}
      </div>
      <div
        style={{
          fontFamily: font,
          fontWeight: 900,
          fontSize: type.line2,
          lineHeight: `${type.line2Height}px`,
          color: LIKE_CTA.line2Color,
          whiteSpace: 'nowrap',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span>{before}</span>
        <span
          style={{
            display: 'inline-flex',
            width: type.slot,
            height: type.line2Height,
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              transform: `translateY(${motion.dy}px) scale(${motion.scale})`,
              transformOrigin: '50% 50%',
            }}
          >
            <LikeThumb size={type.line2} />
          </span>
        </span>
        <span>{after}</span>
      </div>
    </div>
  );
};

const S4CtaBlock = ({
  project,
  language,
  durationSec,
}: {
  project: Project;
  language: Language;
  durationSec: number;
}): ReactNode => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const caption = project.captions.find((item) => item.id === 'cta');
  if (caption?.hidden) return null;
  if (!s4CtaVisibleAtFrame(frame, fps, durationSec)) return null;
  const stored = project.templateParams.s4Cta;
  const mainRaw = stored ? stored.main[language] : S4_CTA_COPY[language].main;
  const subRaw = stored ? stored.sub[language] : S4_CTA_COPY[language].sub;
  const main = resolveVariables(mainRaw, project, language).trim();
  if (!main) return null;
  const sub = resolveVariables(subRaw, project, language).trim();
  const subParts = splitS4Subline(sub);
  const rect = s4CtaRect();
  const tone = language === 'en' ? '#FFFFFF' : '#ECE8E1';
  const font =
    language === 'ja'
      ? '"Zen Kaku Gothic New", sans-serif'
      : 'Montserrat, "Zen Kaku Gothic New", sans-serif';
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        boxSizing: 'border-box',
        padding: `0 ${S4_CTA.paddingRight}px 0 ${S4_CTA.paddingLeft}px`,
        display: 'flex',
        alignItems: 'center',
        gap: S4_CTA.gap,
        background: S4_CTA.background,
        borderRadius: S4_CTA.radius,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <Img
        src={cvLogoUrl}
        style={{
          width: S4_CTA.iconSize,
          height: S4_CTA.iconSize,
          flexShrink: 0,
          borderRadius: 12,
          objectFit: 'cover',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div
          style={{
            fontFamily: font,
            fontWeight: 900,
            fontSize: S4_CTA.mainFontSize,
            lineHeight: 1.15,
            color: tone,
            whiteSpace: 'nowrap',
            textShadow: '0 3px 0 #000',
          }}
        >
          <AccentText accent={project.templateParams.accent}>{main}</AccentText>
        </div>
        {sub ? (
          <div
            style={{
              fontFamily: font,
              fontWeight: language === 'en' ? 800 : 700,
              fontSize: S4_CTA.subFontSize,
              lineHeight: 1.2,
              color: '#B7C0C6',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: tone }}>{subParts.brand}</span>
            {subParts.rest}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const Watermark = ({ top = 1420, compact = false }: { top?: number; compact?: boolean }): ReactNode => {
  const height = compact ? LIKE_CTA.watermarkHeight : 48;
  return (
    <div
      style={{
        position: 'absolute',
        left: 72,
        top,
        height,
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 8 : 12,
        color: COLORS.text,
        opacity: 0.85,
        fontFamily: 'Montserrat, sans-serif',
        fontWeight: 800,
        fontSize: compact ? 20 : 24,
        zIndex: 4,
      }}
    >
      <Img src={h1IconUrl} style={{ height, width: Math.round(height * (41 / 48)) }} />
      H1gher
    </div>
  );
};

const ArrowOverlay = ({ item }: { item: TimelineItem }): ReactNode =>
  item.arrow ? (
    <svg
      style={{ position: 'absolute', inset: 0, width: 1080, height: 1920, zIndex: 2 }}
      viewBox="0 0 1080 1920"
    >
      <defs>
        <marker id={`arrow-${item.id}`} markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
          <path d="M0,0 L12,6 L0,12 Z" fill="#FF4655" />
        </marker>
      </defs>
      <line
        x1={item.arrow.x1 * 1080}
        y1={item.arrow.y1 * 1920}
        x2={item.arrow.x2 * 1080}
        y2={item.arrow.y2 * 1920}
        stroke="#FF4655"
        strokeWidth="10"
        markerEnd={`url(#arrow-${item.id})`}
      />
    </svg>
  ) : null;

const AimZoomFootage = ({
  project,
  scene,
  item,
  mediaBaseUrl,
  useOriginalMedia,
}: {
  project: Project;
  scene: Scene;
  item?: TimelineItem;
  mediaBaseUrl: string;
  useOriginalMedia?: boolean;
}): ReactNode => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const clip = project.clips.find((entry) => entry.id === scene.clipId);
  const asset = project.assets.find((entry) => entry.id === clip?.assetId);
  if (!clip || !asset) return null;
  const src = assetUrl(mediaBaseUrl, useOriginalMedia ? asset.path : (asset.proxyPath ?? asset.path));
  const speed = item?.speed ?? 1;
  const sourceOffset = item?.sourceOffset ?? 0;
  const origin = Math.round((clip.in + sourceOffset) * fps);
  const playedFrames = Math.max(1, Math.round((item?.duration ?? clip.out - clip.in) * fps * speed));
  const ken = scene.zoom?.enabled
    ? interpolate(frame, [0, Math.round(0.4 * fps)], [scene.zoom.from, scene.zoom.to], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const style: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: `${scene.cropCenterX * 100}% 50%`,
    transform: `scale(${ken})`,
    transformOrigin: `${(scene.zoom?.x ?? 0.5) * 100}% ${(scene.zoom?.y ?? 0.5) * 100}%`,
  };
  const video = (startFrom: number): ReactNode => (
    <OffthreadVideo
      src={src}
      startFrom={startFrom}
      endAt={Math.min(Math.round(clip.out * fps), startFrom + playedFrames)}
      playbackRate={speed}
      volume={0}
      style={style}
    />
  );
  const freeze = scene.freeze;
  if (!freeze?.enabled || speed !== 1 || sourceOffset !== 0) return video(origin);
  return (
    <Series>
      <Series.Sequence durationInFrames={Math.round(freeze.at * fps)}>{video(origin)}</Series.Sequence>
      <Series.Sequence durationInFrames={Math.round(freeze.duration * fps)}>
        <Freeze frame={0}>{video(Math.round((clip.in + freeze.at) * fps))}</Freeze>
      </Series.Sequence>
      <Series.Sequence durationInFrames={1_000_000}>
        {video(Math.round((clip.in + freeze.at) * fps))}
      </Series.Sequence>
    </Series>
  );
};

const SceneContent = ({
  project,
  language,
  sceneKey,
  mediaBaseUrl,
  useOriginalMedia,
  item,
  deliveryPlatform,
}: LineupShortProps & { sceneKey: SceneKey; item?: TimelineItem }): ReactNode => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const accent = project.templateParams.accent;
  const ctaDesign = resolveCtaDesign(project);
  const ctaCaption = project.captions.find((item) => item.id === 'cta');
  const like =
    sceneKey === 'throw' &&
    !project.timelineMix?.hideCaptions &&
    ctaCaption?.hidden !== true &&
    likeCtaActive(project, deliveryPlatform);
  if (sceneKey === 'card' || item?.presentation === 'guide-card') {
    if (project.timelineMix?.hideVideo) return <AbsoluteFill style={{ backgroundColor: COLORS.background }} />;
    return <LineupCard project={project} language={language} mediaBaseUrl={mediaBaseUrl} />;
  }
  const scene =
    project.scenes.find((item) => item.sceneKey === sceneKey) ??
    project.scenes.find((item) => item.sceneKey === 'hook');
  if (!scene) return null;
  const sourceScene =
    project.scenes.find((item) => item.sceneKey === playbackSceneKey(project, sceneKey)) ?? scene;
  const caption =
    project.captions.find(
      (item) => item.sceneKey === sceneKey && item.id !== 'cta' && item.styleId !== 'cta',
    ) ?? (sceneKey === 'demo' ? defaultDemoCaption() : undefined);
  const captionText = caption
    ? resolveVariables(captionTextFor(caption, language, 'video'), project, language)
    : '';
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background }}>
      <GridBackground />
      {!project.timelineMix?.hideVideo && (
        <SceneMedia
          project={project}
          scene={sourceScene}
          mediaBaseUrl={mediaBaseUrl}
          useOriginalMedia={useOriginalMedia}
          item={item}
        />
      )}
      {item && <ArrowOverlay item={item} />}
      {aimMarkerVisibleAt(scene.aimMarker, sceneSourceTime(frame, fps, sourceScene, item)) &&
        scene.aimMarker &&
        (() => {
          const aimZoom = scene.aimZoom?.enabled ? scene.aimZoom : null;
          const chrome = zoomChromeThickness(getAnnotationStyle(annotationStyleOf(project.annotationStyle)));
          const videoZoom = aimZoom
            ? resolveVideoAimZoom(aimZoom, { x: scene.aimMarker.x, y: scene.aimMarker.y }, chrome, width, height)
            : null;
          return (
            <>
              <AnnotationDim
                style={annotationStyleOf(project.annotationStyle)}
                frameWidth={width}
                center={{ x: scene.aimMarker.x, y: scene.aimMarker.y }}
                shortSide={Math.min(width, height)}
                zoom={Boolean(videoZoom)}
                cropSize={videoZoom?.source.size}
              />
              {videoZoom ? (
                <AimZoomChrome
                  layout={videoZoom}
                  box={{ width, height, labelHeight: 0, safeRight: width - width * (72 / 1080) }}
                  accent={accent}
                  language={language}
                  style={annotationStyleOf(project.annotationStyle)}
                  frameWidth={width}
                  media={
                    <AimZoomFootage
                      project={project}
                      scene={sourceScene}
                      item={item}
                      mediaBaseUrl={mediaBaseUrl}
                      useOriginalMedia={useOriginalMedia}
                    />
                  }
                />
              ) : (
                <AimMarker
                  x={scene.aimMarker.x}
                  y={scene.aimMarker.y}
                  accent={accent}
                  size={scene.aimMarker.size ?? 1}
                  style={annotationStyleOf(project.annotationStyle)}
                  frameWidth={width}
                  zIndex={2}
                />
              )}
            </>
          );
        })()}
      {LABELS[sceneKey] && (
        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 1110,
            padding: '12px 20px',
            background: COLORS.background,
            color: COLORS.text,
            fontFamily: 'Chakra Petch, monospace',
            fontWeight: 700,
            fontSize: 29,
            letterSpacing: 3,
            borderLeft: `8px solid ${accent}`,
            zIndex: 4,
          }}
        >
          {LABELS[sceneKey]?.[language]}
        </div>
      )}
      {captionText && !project.timelineMix?.hideCaptions && (
        <Caption
          text={captionText}
          accent={accent}
          kind={
            caption?.styleId === 'cap.hook'
              ? 'hook'
              : caption?.styleId === 'cap.throw'
                ? 'throw'
                : 'step'
          }
        />
      )}
      {item?.presentation === 'guide-title' && (
        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 780,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '18px 24px',
            background: 'rgba(15,25,35,.92)',
            zIndex: 4,
          }}
        >
          <div
            style={{
              width: 92,
              height: 92,
              borderRadius: '50%',
              border: `4px solid ${accent}`,
              display: 'grid',
              placeItems: 'center',
              fontSize: 42,
              fontWeight: 900,
            }}
          >
            {project.lineup.agent.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 42, fontWeight: 900 }}>
              {project.lineup.map.toUpperCase()} — {project.lineup.site}
            </div>
            <div style={{ color: accent, fontSize: 28, fontWeight: 800 }}>NEW</div>
          </div>
        </div>
      )}
      {item?.presentation === 'guide-steps' && (
        <div style={{ position: 'absolute', left: 72, top: 180, width: 840, zIndex: 4 }}>
          <div style={{ color: accent, fontSize: 34, fontWeight: 800 }}>STEP 1/3</div>
          <div style={{ fontSize: 64, fontWeight: 900 }}>{project.lineup.throwType.en}</div>
        </div>
      )}
      {(sceneKey === 'demo' || item?.presentation === 'guide-demo') && (
        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 1340,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 18px',
            borderRadius: 8,
            background: 'rgba(6,9,13,.82)',
            color: COLORS.text,
            fontFamily:
              language === 'ja'
                ? '"Zen Kaku Gothic New", sans-serif'
                : 'Montserrat, sans-serif',
            fontSize: 23,
            fontWeight: language === 'ja' ? 700 : 800,
            zIndex: 4,
          }}
        >
          <Img src={cvTitleUrl} style={{ height: 28, width: 181 }} />
          <span>· {language === 'ja' ? '定点を保存' : 'SAVE THIS LINEUP'}</span>
        </div>
      )}
      {like && (
        <S4LikeCtaBlock project={project} language={language} durationSec={item?.duration ?? 0} />
      )}
      {sceneKey === 'throw' && ctaDesign === 's4-block' && !like && !project.timelineMix?.hideCaptions && (
        <S4CtaBlock project={project} language={language} durationSec={item?.duration ?? 0} />
      )}
      {sceneKey === 'loop' && ctaDesign === 's7-band' && !project.timelineMix?.hideCaptions &&
        (() => {
          const cta = project.captions.find((caption) => caption.id === 'cta');
          const raw = cta && !cta.hidden ? cta.text[language].trim() : '';
          const text = raw ? resolveVariables(raw, project, language).trim() : '';
          return (
            <S7Close
              text={text}
              accent={accent}
              language={language}
              durationSec={item?.duration ?? 2}
            />
          );
        })()}
      {sceneKey !== 'hook' && (
        <Watermark
          compact={like}
          top={
            like
              ? likeWatermarkTop()
              : sceneKey === 'throw' && ctaDesign === 's4-block'
                ? s4WatermarkTop()
                : undefined
          }
        />
      )}
    </AbsoluteFill>
  );
};

const SafeZoneGuide = (): ReactNode => (
  <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 8 }}>
    <div
      style={{
        position: 'absolute',
        left: 72,
        top: 200,
        width: 840,
        height: 1300,
        border: '4px solid rgba(77,199,139,.95)',
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: 924,
        top: 760,
        width: 156,
        height: 740,
        background: 'rgba(255,70,85,.28)',
      }}
    />
    <div style={{ position: 'absolute', left: 49, top: 0, width: 982, height: 373, border: '3px dashed rgba(255,107,102,.9)' }} />
    <div style={{ position: 'absolute', left: 880, top: 1010, width: 151, height: 730, border: '3px dashed rgba(255,107,102,.9)' }} />
    <div style={{ position: 'absolute', left: 49, top: 1440, width: 982, height: 480, border: '3px dashed rgba(255,107,102,.9)' }} />
    <div style={{ position: 'absolute', left: 0, top: 0, width: 49, height: 1920, background: 'rgba(0,0,0,.45)' }} />
    <div style={{ position: 'absolute', left: 1031, top: 0, width: 49, height: 1920, background: 'rgba(0,0,0,.45)' }} />
    <div
      style={{
        position: 'absolute',
        left: 72,
        top: 16,
        padding: '4px 10px',
        background: '#C9302C',
        color: '#fff',
        fontSize: 22,
        fontWeight: 700,
      }}
    >
      YouTube UIは推定（書き出しには入りません）
    </div>
  </AbsoluteFill>
);

const ClipTransition = ({
  item,
  children,
}: {
  item: TimelineItem;
  children: ReactNode;
}): ReactNode => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (item.transition === 'fade') {
    const opacity = interpolate(frame, [0, 0.25 * fps], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
  }
  if (item.transition === 'slide') {
    const x = interpolate(frame, [0, 0.25 * fps], [140, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return <AbsoluteFill style={{ transform: `translateX(${x}px)` }}>{children}</AbsoluteFill>;
  }
  return children;
};

const SoundEffects = ({
  project,
  mediaBaseUrl,
  tracks,
}: {
  project: Project;
  mediaBaseUrl: string;
  tracks: AudioTrack[];
}): ReactNode => {
  const { fps } = useVideoConfig();
  if (project.timelineMix?.muteEffects) return null;
  return activeTimeline(project).effects.map((effect) => {
    const track = tracks.find((item) => item.id === effect.audioTrackId);
    if (!track) return null;
    const durationInFrames = Math.max(1, Math.round(Math.min(track.durationSec, 1.5) * fps));
    return (
      <Sequence
        key={effect.id}
        from={Math.round(effect.start * fps)}
        durationInFrames={durationInFrames}
      >
        <Audio src={assetUrl(mediaBaseUrl, track.filePath)} volume={effect.volume} />
      </Sequence>
    );
  });
};

export const LineupShortStandard = (props: LineupShortProps): ReactNode => {
  const { project } = props;
  const { fps } = useVideoConfig();
  const tracks = props.audioTracks ?? (props.audioTrack ? [props.audioTrack] : []);
  return (
    <AbsoluteFill>
      {activeTimeline(project).items.map((item) => (
        <Sequence
          key={item.id}
          from={Math.round(item.start * fps)}
          durationInFrames={Math.max(1, Math.round(item.duration * fps))}
        >
          <ClipTransition item={item}>
            <SceneContent {...props} sceneKey={item.sceneKey} item={item} />
          </ClipTransition>
        </Sequence>
      ))}
      <BgmAudio
        project={project}
        audioTrack={props.audioTrack ?? tracks.find((track) => track.kind === 'bgm')}
        mediaBaseUrl={props.mediaBaseUrl}
        withoutBgm={props.withoutBgm}
      />
      <SoundEffects project={project} mediaBaseUrl={props.mediaBaseUrl} tracks={tracks} />
      {props.showSafeZone && <SafeZoneGuide />}
    </AbsoluteFill>
  );
};
