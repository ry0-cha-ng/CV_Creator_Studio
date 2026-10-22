import type { CSSProperties, ReactNode } from 'react';
import { Img } from 'remotion';
import {
  ANNOTATION_FRAME_WIDTH,
  ANNOTATION_LINE,
  ANNOTATION_NAVY,
  getAnnotationStyle,
  navyBlur,
} from '../shared/annotation-style';
import type { AnnotationStyle, Language } from '../shared/schema/project';
import type { AimZoomBox, ResolvedAimZoom } from '../shared/aim-zoom';
import { CropBrackets, HudRing } from './AnnotationMarks';

const pct = (value: number, total: number): string => `${(value / total) * 100}%`;

/**
 * 合わせ位置ズームの小窓。拡大絵はカード用スチルの該当範囲だけを表示する。
 * マットと赤の線は窓の外側に足す。窓の大きさ・中心の式は変えない。
 */
export const AimZoomChrome = ({
  layout,
  box,
  accent,
  stillUrl,
  media,
  note,
  language,
  nativeImage = false,
  objectPosition = '50% 50%',
  style,
  frameWidth = ANNOTATION_FRAME_WIDTH,
}: {
  layout: ResolvedAimZoom;
  box: AimZoomBox;
  accent: string;
  stillUrl?: string;
  /** 静止画の代わりに、拡大枠いっぱいに広げる映像。 */
  media?: ReactNode;
  note?: string;
  language: Language;
  nativeImage?: boolean;
  objectPosition?: string;
  style?: AnnotationStyle;
  frameWidth?: number;
}): ReactNode => {
  const metrics = getAnnotationStyle(style, frameWidth);
  const loupe = layout.style === 'loupe';
  const split = layout.split;
  const centerX = layout.center.x * box.width;
  const centerY = layout.center.y * box.height;
  const win = layout.window.size;
  const framePicture = stillUrl || media ? (
    <div
      style={{
        position: 'absolute',
        width: pct(box.width * layout.zoom, win),
        height: pct(box.height * layout.zoom, win),
        left: pct(win / 2 - centerX * layout.zoom, win),
        top: pct(win / 2 - centerY * layout.zoom, win),
      }}
    >
      {media ??
        (nativeImage ? (
          <img src={stillUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition }} />
        ) : (
          <Img src={stillUrl ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition }} />
        ))}
    </div>
  ) : null;
  const ring = (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 2,
        pointerEvents: 'none',
      }}
    >
      <HudRing diameter={win * metrics.zoomRingRatio} accent={accent} metrics={metrics} ticks={false} />
    </div>
  );
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <ConnectorLines layout={layout} box={box} metrics={metrics} />
      <CropBrackets source={layout.source} box={box} accent={accent} metrics={metrics} />
      {split ? (
        <SplitZoom
          layout={layout}
          box={box}
          accent={accent}
          metrics={metrics}
          picture={framePicture}
          ring={ring}
          note={note}
          language={language}
        />
      ) : (
        <ZoomFrame
          layout={layout}
          box={box}
          accent={accent}
          metrics={metrics}
          loupe={loupe}
          picture={framePicture}
          ring={ring}
        />
      )}
    </div>
  );
};

const ConnectorLines = ({
  layout,
  box,
  metrics,
}: {
  layout: ResolvedAimZoom;
  box: AimZoomBox;
  metrics: ReturnType<typeof getAnnotationStyle>;
}): ReactNode => {
  const segments = layout.connectors;
  if (segments.length === 0) return null;
  const pad = metrics.line + metrics.lineEdge * 2 + metrics.blur * 2 + 2;
  const xs = segments.flatMap((segment) => [segment.x1, segment.x2]);
  const ys = segments.flatMap((segment) => [segment.y1, segment.y2]);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const height = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const navyWidth = metrics.line + metrics.lineEdge * 2;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`${minX} ${minY} ${width} ${height}`}
      style={{
        position: 'absolute',
        left: pct(minX, box.width),
        top: pct(minY, box.height),
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 1,
        filter: navyBlur(metrics),
      }}
    >
      {segments.map((segment, index) => (
        <g key={index}>
          <line
            x1={segment.x1}
            y1={segment.y1}
            x2={segment.x2}
            y2={segment.y2}
            stroke={ANNOTATION_NAVY}
            strokeOpacity={0.9}
            strokeWidth={navyWidth}
            strokeLinecap="square"
          />
          <line
            x1={segment.x1}
            y1={segment.y1}
            x2={segment.x2}
            y2={segment.y2}
            stroke={ANNOTATION_LINE}
            strokeOpacity={0.9}
            strokeWidth={metrics.line}
            strokeLinecap="square"
          />
        </g>
      ))}
    </svg>
  );
};

const ZoomFrame = ({
  layout,
  box,
  accent,
  metrics,
  loupe,
  picture,
  ring,
}: {
  layout: ResolvedAimZoom;
  box: AimZoomBox;
  accent: string;
  metrics: ReturnType<typeof getAnnotationStyle>;
  loupe: boolean;
  picture: ReactNode;
  ring: ReactNode;
}): ReactNode => {
  const chrome = metrics.red + metrics.mat;
  const outerLeft = layout.window.x - chrome;
  const outerTop = layout.window.y - chrome;
  const outerSize = layout.window.size + chrome * 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: pct(outerLeft, box.width),
        top: pct(outerTop, box.height),
        width: pct(outerSize, box.width),
        height: pct(outerSize, box.height),
        boxSizing: 'border-box',
        border: `${metrics.red}px solid ${accent}`,
        padding: metrics.mat,
        background: ANNOTATION_NAVY,
        borderRadius: loupe ? '50%' : 0,
        boxShadow: `0 ${metrics.shadowY}px ${metrics.shadowBlur}px rgba(0,0,0,${metrics.shadowAlpha})`,
        filter: navyBlur(metrics),
        zIndex: 2,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          borderRadius: loupe ? '50%' : 0,
        }}
      >
        {picture}
        {ring}
      </div>
      <ZoomTab
        text={`×${layout.zoom}`}
        accent={accent}
        metrics={metrics}
        outerLeft={outerLeft}
        outerTop={outerTop}
        labelHeight={box.labelHeight}
        safeRight={box.safeRight}
      />
    </div>
  );
};

const SplitZoom = ({
  layout,
  box,
  accent,
  metrics,
  picture,
  ring,
  note,
  language,
}: {
  layout: ResolvedAimZoom;
  box: AimZoomBox;
  accent: string;
  metrics: ReturnType<typeof getAnnotationStyle>;
  picture: ReactNode;
  ring: ReactNode;
  note?: string;
  language: Language;
}): ReactNode => {
  const split = layout.split;
  if (!split) return null;
  const panelOnRight = split.panelLeft > 0;
  const seamWidth = metrics.red + metrics.mat;
  const seamLeft = panelOnRight ? split.panelLeft - seamWidth : split.panelLeft + split.panelSize;
  const win = layout.window.size;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: pct(seamLeft, box.width),
          top: 0,
          width: seamWidth,
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          zIndex: 2,
          pointerEvents: 'none',
          filter: navyBlur(metrics),
        }}
      >
        {panelOnRight ? (
          <>
            <div style={{ width: metrics.red, background: accent }} />
            <div style={{ width: metrics.mat, background: ANNOTATION_NAVY }} />
          </>
        ) : (
          <>
            <div style={{ width: metrics.mat, background: ANNOTATION_NAVY }} />
            <div style={{ width: metrics.red, background: accent }} />
          </>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          left: pct(layout.window.x, box.width),
          top: pct(layout.window.y, box.height),
          width: pct(layout.window.size, box.width),
          height: pct(layout.window.size, box.height),
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: ANNOTATION_NAVY }}>
          {picture}
          {ring}
          {note?.trim() && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                bottom: 0,
                width: Math.max(0, Math.min(win, box.safeRight - layout.window.x)),
                boxSizing: 'border-box',
                padding: '6px 10px',
                background: 'rgba(15,25,35,.88)',
                color: '#fff',
                fontFamily:
                  language === 'ja' ? '"Zen Kaku Gothic New", sans-serif' : 'Chakra Petch, sans-serif',
                fontWeight: 700,
                fontSize: Math.max(12, Math.round(box.height * (12 / 256))),
                lineHeight: 1.4,
                zIndex: 3,
              }}
            >
              {note.trim()}
            </div>
          )}
        </div>
        <ZoomTab
          text={`×${layout.zoom}`}
          accent={accent}
          metrics={metrics}
          outerLeft={layout.window.x}
          outerTop={layout.window.y}
          labelHeight={box.labelHeight}
          safeRight={box.safeRight}
        />
      </div>
    </>
  );
};

const ZoomTab = ({
  text,
  accent,
  metrics,
  outerLeft,
  outerTop,
  labelHeight,
  safeRight,
}: {
  text: string;
  accent: string;
  metrics: ReturnType<typeof getAnnotationStyle>;
  outerLeft: number;
  outerTop: number;
  labelHeight: number;
  safeRight: number;
}): ReactNode => {
  const fontSize = metrics.tabSize;
  const tabWidth = text.length * fontSize * 0.62 + metrics.tabPadX * 2;
  const tabHeight = fontSize * 1.2 + 8;
  const inside = outerTop < tabHeight || outerTop - tabHeight < labelHeight;
  let shift = 0;
  if (outerLeft + tabWidth > safeRight) shift = outerLeft + tabWidth - safeRight;
  if (outerLeft - shift < 0) shift = outerLeft;
  const style: CSSProperties = {
    position: 'absolute',
    left: -shift,
    top: 0,
    transform: inside ? undefined : 'translateY(-100%)',
    padding: `4px ${metrics.tabPadX}px`,
    background: accent,
    color: '#FFFFFF',
    fontFamily: 'Chakra Petch, sans-serif',
    fontWeight: 700,
    fontSize,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    zIndex: 3,
  };
  return <div style={style}>{text}</div>;
};

export const zoomStillUrl = (
  assetUrl: (base: string, relativePath: string) => string,
  mediaBaseUrl: string,
  stillPath: string | undefined,
  frozenUrl: string | undefined,
): string | undefined => {
  if (stillPath) return assetUrl(mediaBaseUrl, stillPath);
  return frozenUrl;
};
