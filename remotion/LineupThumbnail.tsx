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
  thumbnailMapLabel,
} from '../shared/thumbnail';
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
}: {
  agent: string;
  ability: string;
  map: string;
  site: string;
  side: 'attack' | 'defense';
  mediaBaseUrl: string;
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
        top: THUMBNAIL.badgeTop,
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

export const LineupThumbnail = ({
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
  const hookLayout = thumbnailHookLayout(hookText);
  const hookFontSize = fitThumbnailHookFontSize(hookText);
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
      {hookText ? (
        <div
          style={{
            position: 'absolute',
            top: hookLayout.top,
            left: THUMBNAIL.hookSide,
            right: THUMBNAIL.hookSide,
            maxHeight: hookLayout.maxHeight,
            textAlign: 'center',
            fontFamily: 'Montserrat, "Zen Kaku Gothic New", sans-serif',
            fontWeight: 900,
            fontSize: hookFontSize,
            lineHeight: THUMBNAIL.hookLineHeight,
            textTransform: 'uppercase',
            color: '#FFFFFF',
            whiteSpace: 'pre-line',
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
            lineBreak: 'strict',
            display: '-webkit-box',
            WebkitLineClamp: hookLayout.maxLines,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textShadow: '0 2px 18px rgba(0,0,0,0.65)',
          }}
        >
          <AccentText accent={accent}>{hookText}</AccentText>
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
