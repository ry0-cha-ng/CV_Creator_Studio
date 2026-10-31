import { Fragment, type CSSProperties, type ReactNode } from 'react';
import '@fontsource/zen-kaku-gothic-new/900.css';
import '@fontsource/montserrat/900.css';
import { AbsoluteFill, Img, OffthreadVideo, useVideoConfig } from 'remotion';
import type { LineupShortProps } from './LineupShortStandard';
import { resolveVariables } from './LineupShortStandard';
import { captionTextFor } from '../shared/schema/project';
import {
  THUMBNAIL,
  abilityAbbreviation,
  agentInitial,
  fitThumbnailHookFontSize,
  fitThumbnailLabel,
  hookFrameRequest,
  thumbnailHookLayout,
  thumbnailHookLines,
  thumbnailMapLabel,
} from '../shared/thumbnail';
import {
  THUMB_FOCUS,
  fitFocusHook,
  focusFrameSize,
  resolveFocusFrame,
  resolveThumbCrop,
  resolveThumbHookText,
  thumbnailFocusOf,
  thumbnailLayoutOf,
  thumbnailZoomOf,
  type ThumbHookRun,
} from '../shared/thumbnail-focus';
import {
  catalogMediaRelativePath,
  getAbilityCardIconPath,
  getAgentCardIconPath,
} from '../shared/valorant-catalog';

const assetUrl = (base: string, relativePath: string): string =>
  `${base.replace(/\/$/, '')}/${relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

const AccentText = ({ children, accent }: { children: string; accent: string }): ReactNode => {
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

const SIDE_CHIP = {
  attack: { label: 'ATK', background: '#F0474E', color: '#FFFFFF' },
  defense: { label: 'DEF', background: '#22C55E', color: '#052E16' },
} as const;

export const ThumbnailIdentityBadge = ({
  agent,
  ability,
  map,
  site,
  side,
  mediaBaseUrl,
  top = THUMBNAIL.badgeTop,
}: {
  agent: string;
  ability: string;
  map: string;
  site: string;
  side: 'attack' | 'defense';
  mediaBaseUrl: string;
  top?: number;
}): ReactNode => {
  const agentIcon = getAgentCardIconPath(agent);
  const abilityIcon = getAbilityCardIconPath(agent, ability);
  const agentSrc = agentIcon ? assetUrl(mediaBaseUrl, catalogMediaRelativePath(agentIcon)) : null;
  const abilitySrc = abilityIcon ? assetUrl(mediaBaseUrl, catalogMediaRelativePath(abilityIcon)) : null;
  const label = fitThumbnailLabel(thumbnailMapLabel(map, site));
  const abbrev = abilityAbbreviation(ability);
  const abbrevSize = abbrev.length <= 2 ? 48 : abbrev.length === 3 ? 36 : 28;
  const chip = SIDE_CHIP[side];

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: 0,
        width: THUMBNAIL.width,
        height: THUMBNAIL.badgeHeight,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        background: '#0D0E11',
      }}
    >
      <div
        style={{
          width: THUMBNAIL.agentWidth,
          height: '100%',
          flexShrink: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
        }}
      >
        {agentSrc ? (
          <Img
            src={agentSrc}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 42%' }}
          />
        ) : (
          <span
            style={{
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 900,
              fontSize: 84,
              lineHeight: 1,
              color: '#f2f4f6',
            }}
          >
            {agentInitial(agent)}
          </span>
        )}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: THUMBNAIL.infoGap,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: `12px ${THUMBNAIL.sidePadX}px 10px`,
            borderRadius: 12,
            background: chip.background,
            color: chip.color,
            fontFamily: 'Montserrat, sans-serif',
            fontWeight: 900,
            fontSize: THUMBNAIL.sideFontSize,
            lineHeight: 1,
            letterSpacing: `${THUMBNAIL.sideTracking}em`,
          }}
        >
          {chip.label}
        </div>
        <div
          style={{
            fontFamily: 'Montserrat, sans-serif',
            fontWeight: 900,
            fontSize: label.fontSize,
            lineHeight: 1,
            letterSpacing: `${THUMBNAIL.labelTracking}em`,
            color: '#FFFFFF',
            whiteSpace: 'nowrap',
          }}
        >
          {label.text}
        </div>
      </div>
      <div
        style={{
          width: THUMBNAIL.abilityWidth,
          height: '100%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {abilitySrc ? (
          <Img
            src={abilitySrc}
            style={{
              width: THUMBNAIL.abilitySize,
              height: THUMBNAIL.abilitySize,
              objectFit: 'contain',
              mixBlendMode: 'screen',
            }}
          />
        ) : (
          <span
            style={{
              fontFamily: 'Montserrat, sans-serif',
              fontWeight: 900,
              fontSize: abbrevSize,
              lineHeight: 1,
              color: '#f2f4f6',
            }}
          >
            {abbrev}
          </span>
        )}
      </div>
    </div>
  );
};

const BLUR_STYLE: CSSProperties = {
  position: 'absolute',
  left: -80,
  top: -80,
  width: THUMBNAIL.width + 160,
  height: THUMBNAIL.height + 160,
  objectFit: 'cover',
  filter: 'blur(60px) brightness(0.35)',
};

const FOOTAGE_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const LineupThumbnailClassic = ({
  project,
  language,
  mediaBaseUrl,
  useOriginalMedia,
  hookFrame,
}: LineupShortProps & { hookFrame?: string }): ReactNode => {
  const { fps } = useVideoConfig();
  const accent = project.templateParams.accent;
  const hook = project.captions.find((caption) => caption.id === 'hook');
  const hookRaw = hook && !hook.hidden ? captionTextFor(hook, language, 'thumb') : '';
  const hookText = hookRaw ? resolveVariables(hookRaw, project, language) : '';
  const hookFontSize = fitThumbnailHookFontSize(hookText);
  const hookLayout = thumbnailHookLayout(hookText, hookFontSize);
  const hookLines = thumbnailHookLines(hookText);
  const request = hookFrameRequest(project);
  const asset = request ? project.assets.find((item) => item.path === request.assetPath) : undefined;
  const mediaPath = (relativePath: string): string => {
    if (useOriginalMedia || !asset || asset.path !== relativePath) return relativePath;
    return asset.proxyPath ?? relativePath;
  };
  const extracted = hookFrame ? assetUrl(mediaBaseUrl, hookFrame) : null;
  const imageSrc =
    extracted ??
    (request?.kind === 'image' ? assetUrl(mediaBaseUrl, mediaPath(request.assetPath)) : null);
  const videoSrc =
    !imageSrc && request?.kind === 'video' ? assetUrl(mediaBaseUrl, mediaPath(request.assetPath)) : null;
  const startFrom =
    request?.kind === 'video' && videoSrc ? Math.max(0, Math.round(request.sourceTime * fps)) : 0;

  const layer = (style: CSSProperties): ReactNode => {
    if (imageSrc) return <Img src={imageSrc} style={style} />;
    if (videoSrc) {
      return (
        <OffthreadVideo
          src={videoSrc}
          startFrom={startFrom}
          endAt={startFrom + 1}
          volume={0}
          style={style}
        />
      );
    }
    return null;
  };

  return (
    <AbsoluteFill style={{ background: '#2B2522', overflow: 'hidden' }}>
      {layer(BLUR_STYLE)}
      {hookLines.some((line) => line.trim()) ? (
        <div
          style={{
            position: 'absolute',
            top: hookLayout.top,
            left: THUMBNAIL.hookSide,
            right: THUMBNAIL.hookSide,
            maxHeight: hookLayout.maxHeight,
            overflow: 'hidden',
            textAlign: 'center',
            fontFamily: 'Montserrat, "Zen Kaku Gothic New", sans-serif',
            fontWeight: 900,
            fontSize: hookFontSize,
            lineHeight: THUMBNAIL.hookLineHeight,
            textTransform: 'uppercase',
            color: '#FFFFFF',
            textShadow: '0 2px 18px rgba(0,0,0,0.65)',
          }}
        >
          {hookLines.map((line, index) => (
            <div
              key={`hook-${index}`}
              style={{
                wordBreak: 'keep-all',
                overflowWrap: 'anywhere',
                lineBreak: 'strict',
              }}
            >
              {line ? <AccentText accent={accent}>{line}</AccentText> : '\u00a0'}
            </div>
          ))}
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          top: THUMBNAIL.footageTop,
          left: 0,
          width: THUMBNAIL.width,
          height: THUMBNAIL.footageHeight,
          overflow: 'hidden',
          background: '#111418',
        }}
      >
        {layer(FOOTAGE_STYLE)}
      </div>
      <ThumbnailIdentityBadge
        agent={project.lineup.agent}
        ability={project.lineup.ability}
        map={project.lineup.map}
        site={project.lineup.site}
        side={project.lineup.side}
        mediaBaseUrl={mediaBaseUrl}
      />
    </AbsoluteFill>
  );
};

const FocusHook = ({
  lines,
  fontSize,
  lineHeight,
  family,
  accent,
}: {
  lines: ThumbHookRun[][];
  fontSize: number;
  lineHeight: number;
  family: string;
  accent: string;
}): ReactNode => {
  const lineBox = fontSize * lineHeight;
  return (
    <div
      style={{
        position: 'absolute',
        top: THUMB_FOCUS.hook.top,
        left: THUMB_FOCUS.hook.left,
        width: THUMB_FOCUS.hook.right - THUMB_FOCUS.hook.left,
        height: lineBox * lines.length,
        overflow: 'visible',
        textAlign: 'center',
        fontFamily: family,
        fontWeight: 900,
        fontSize,
        lineHeight,
        color: '#FFFFFF',
        WebkitTextStroke: `${THUMB_FOCUS.hook.stroke.outside * 2}px ${THUMB_FOCUS.hook.stroke.color}`,
        paintOrder: 'stroke fill',
        textShadow: THUMB_FOCUS.hook.shadow,
      }}
    >
      {lines.map((line, index) => (
        <div key={`hook-${index}`} style={{ height: lineBox, whiteSpace: 'nowrap' }}>
          {line.length === 0
            ? '\u00a0'
            : line.map((run, runIndex) =>
                run.accent ? (
                  <span key={`${index}-${runIndex}`} style={{ color: accent }}>
                    {run.text}
                  </span>
                ) : (
                  <Fragment key={`${index}-${runIndex}`}>{run.text}</Fragment>
                ),
              )}
        </div>
      ))}
    </div>
  );
};

const LineupThumbnailFocus = ({
  project,
  language,
  mediaBaseUrl,
  hookFrame,
}: LineupShortProps & { hookFrame?: string }): ReactNode => {
  const { fps } = useVideoConfig();
  const accent = project.templateParams.accent;
  const hookFit = fitFocusHook(resolveThumbHookText(project, language), language);
  const hookSpec = language === 'en' ? THUMB_FOCUS.hook.en : THUMB_FOCUS.hook.ja;
  const pick = resolveFocusFrame(project);
  const asset = pick ? project.assets.find((item) => item.id === pick.assetId) : undefined;
  const size = focusFrameSize(project);
  const crop = size ? resolveThumbCrop(size, thumbnailFocusOf(project), thumbnailZoomOf(project)) : null;
  const extracted = hookFrame ? assetUrl(mediaBaseUrl, hookFrame) : null;
  const originalPath = asset ? assetUrl(mediaBaseUrl, asset.path) : null;
  const imageSrc = extracted ?? (asset?.type === 'image' ? originalPath : null);
  const videoSrc = !imageSrc && asset?.type === 'video' ? originalPath : null;
  const startFrom = videoSrc && pick ? Math.max(0, Math.round(pick.timeSec * fps)) : 0;
  const placed = crop
    ? {
        width: (size!.w * THUMB_FOCUS.video.w) / crop.w,
        height: (size!.h * THUMB_FOCUS.video.h) / crop.h,
        left: (-crop.x * THUMB_FOCUS.video.w) / crop.w,
        top: (-crop.y * THUMB_FOCUS.video.h) / crop.h,
      }
    : null;
  const pictureStyle: CSSProperties = placed
    ? {
        position: 'absolute',
        width: placed.width,
        height: placed.height,
        left: placed.left,
        top: placed.top,
        filter: `contrast(${THUMB_FOCUS.grade.contrast}) saturate(${THUMB_FOCUS.grade.saturate})`,
      }
    : { ...FOOTAGE_STYLE, filter: `contrast(${THUMB_FOCUS.grade.contrast}) saturate(${THUMB_FOCUS.grade.saturate})` };
  const layer = (style: CSSProperties): ReactNode => {
    if (imageSrc) return <Img src={imageSrc} style={style} />;
    if (videoSrc) {
      return <OffthreadVideo src={videoSrc} startFrom={startFrom} endAt={startFrom + 1} volume={0} style={style} />;
    }
    return null;
  };
  const fade = THUMB_FOCUS.videoTopFade.to - THUMB_FOCUS.videoTopFade.from;
  const stops = THUMB_FOCUS.topGradient.stops
    .map(([offset, alpha]) => `rgba(15,25,35,${alpha}) ${offset}px`)
    .join(', ');

  return (
    <AbsoluteFill style={{ background: '#2B2522', overflow: 'hidden' }}>
      {layer(BLUR_STYLE)}
      <div
        style={{
          position: 'absolute',
          top: THUMB_FOCUS.video.y,
          left: THUMB_FOCUS.video.x,
          width: THUMB_FOCUS.video.w,
          height: THUMB_FOCUS.video.h,
          overflow: 'hidden',
          background: '#111418',
          WebkitMaskImage: `linear-gradient(to bottom, transparent 0px, #000 ${fade}px)`,
          maskImage: `linear-gradient(to bottom, transparent 0px, #000 ${fade}px)`,
        }}
      >
        {layer(pictureStyle)}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse ${THUMB_FOCUS.vignette.rx * 100}% ${THUMB_FOCUS.vignette.ry * 100}% at ${THUMB_FOCUS.vignette.cx * 100}% ${THUMB_FOCUS.vignette.cy * 100}%, transparent ${THUMB_FOCUS.vignette.inner * 100}%, rgba(15,25,35,${THUMB_FOCUS.vignette.alpha}) 100%)`,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: THUMB_FOCUS.canvas.w,
          height: THUMB_FOCUS.topGradient.stops[THUMB_FOCUS.topGradient.stops.length - 1]?.[0] ?? 730,
          background: `linear-gradient(to bottom, ${stops})`,
        }}
      />
      {hookFit.lines.length > 0 ? (
        <FocusHook
          lines={hookFit.lines.slice(0, THUMB_FOCUS.hook.maxLines)}
          fontSize={hookFit.fontSize}
          lineHeight={hookSpec.lineHeight}
          family={`${hookSpec.family}, sans-serif`}
          accent={accent}
        />
      ) : null}
      <ThumbnailIdentityBadge
        agent={project.lineup.agent}
        ability={project.lineup.ability}
        map={project.lineup.map}
        site={project.lineup.site}
        side={project.lineup.side}
        mediaBaseUrl={mediaBaseUrl}
        top={THUMB_FOCUS.infoBar.y}
      />
    </AbsoluteFill>
  );
};

export const LineupThumbnail = (props: LineupShortProps & { hookFrame?: string }): ReactNode =>
  thumbnailLayoutOf(props.project) === 'focus' ? (
    <LineupThumbnailFocus {...props} />
  ) : (
    <LineupThumbnailClassic {...props} />
  );
