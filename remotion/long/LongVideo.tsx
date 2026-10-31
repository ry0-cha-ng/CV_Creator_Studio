import '@fontsource/zen-kaku-gothic-new/700.css';
import '@fontsource/zen-kaku-gothic-new/900.css';
import '@fontsource/montserrat/800.css';
import type { CSSProperties, ReactNode } from 'react';
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
} from 'remotion';
import { ease, fitLayout, lerpRect, type FitLayout } from '../../shared/long/geometry';
import {
  audioPieceVolume,
  bgmVolume,
  type PlanAvatarPiece,
  type PlanCaption,
  type PlanOverlay,
  type PlanVideoLayer,
  type PlanVideoPiece,
  type RenderPlan,
} from '../../shared/long/render-plan';
import { motionAt, motionTransform } from './motion';

export type LongVideoProps = {
  plan: RenderPlan;
  mediaBaseUrl: string;
  /** プレビューではプロキシを使う。書き出しでは原本 */
  useProxy?: boolean;
  /** 編集用のガイド（書き出さない） */
  guides?: { textSafe?: boolean; hud?: Array<{ label: string; rect: { x: number; y: number; w: number; h: number } }> };
  /** プレビュー：選択中の要素を強調 */
  highlightId?: string;
};

export const LONG_FONT = '"Zen Kaku Gothic New", "Malgun Gothic", "Apple SD Gothic Neo", Montserrat, sans-serif';

export const mediaUrl = (base: string, relativePath: string): string =>
  /^[a-z]+:/i.test(relativePath)
    ? relativePath
    : `${base.replace(/\/$/, '')}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;

const pieceRects = (piece: PlanVideoPiece, absolute: number) => {
  const span = piece.motionTo - piece.motionFrom;
  const progress = span > 0 ? ease((absolute - piece.motionFrom) / span, piece.easing) : 0;
  return {
    rect: piece.rectTo ? lerpRect(piece.rect, piece.rectTo, progress) : piece.rect,
    crop: piece.cropTo ? lerpRect(piece.crop, piece.cropTo, progress) : piece.crop,
  };
};

export const layerLayoutAt = (
  layer: PlanVideoLayer,
  absolute: number,
  output: { w: number; h: number },
): FitLayout | null => {
  const piece = layer.pieces.find((item) => absolute >= item.from && absolute < item.from + item.duration);
  if (!piece) return null;
  const { rect, crop } = pieceRects(piece, absolute);
  return fitLayout(crop, rect, layer.fit, layer.sourceSize, output);
};

const VideoPiece = ({
  layer,
  piece,
  src,
  output,
  highlighted,
}: {
  layer: PlanVideoLayer;
  piece: PlanVideoPiece;
  src: string;
  output: { w: number; h: number };
  highlighted: boolean;
}): ReactNode => {
  const frame = useCurrentFrame();
  const absolute = piece.from + frame;
  const { rect, crop } = pieceRects(piece, absolute);
  const layout = fitLayout(crop, rect, layer.fit, layer.sourceSize, output);
  const { dest, content } = layout;
  const style = layer.style;
  const media: CSSProperties = {
    position: 'absolute',
    left: layout.frame.x - content.x,
    top: layout.frame.y - content.y,
    width: layout.frame.w,
    height: layout.frame.h,
    maxWidth: 'none',
  };
  const video =
    piece.kind === 'freeze' ? (
      <Freeze frame={0}>
        <OffthreadVideo src={src} trimBefore={piece.trimBefore} muted style={media} pauseWhenBuffering />
      </Freeze>
    ) : (
      <OffthreadVideo
        src={src}
        trimBefore={piece.trimBefore}
        playbackRate={piece.speed}
        muted
        style={media}
        pauseWhenBuffering
      />
    );
  return (
    <div
      style={{
        position: 'absolute',
        left: dest.x,
        top: dest.y,
        width: dest.w,
        height: dest.h,
        overflow: 'hidden',
        background: style.background ?? 'transparent',
        opacity: style.opacity,
        borderRadius: style.radius,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: content.x - dest.x,
          top: content.y - dest.y,
          width: content.w,
          height: content.h,
          overflow: 'hidden',
        }}
      >
        {video}
      </div>
      {style.borderWidth > 0 || highlighted ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: style.radius,
            boxShadow: `inset 0 0 0 ${Math.max(style.borderWidth, highlighted ? 4 : 0)}px ${highlighted ? '#FF4655' : style.borderColor}`,
          }}
        />
      ) : null}
      {layer.label ? (
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: 10,
            padding: '4px 12px',
            background: 'rgba(15,18,22,.78)',
            color: '#fff',
            fontFamily: LONG_FONT,
            fontWeight: 700,
            fontSize: Math.max(18, Math.round(dest.h * 0.07)),
            borderRadius: 4,
          }}
        >
          {layer.label}
        </div>
      ) : null}
    </div>
  );
};

const CaptionView = ({ caption, output, fps }: { caption: PlanCaption; output: { w: number; h: number }; fps: number }): ReactNode => {
  const frame = useCurrentFrame();
  const { style } = caption;
  const motion =
    caption.kind === 'reaction' ? motionAt('pop', frame, caption.duration, fps, 100) : motionAt('fade', frame, caption.duration, fps);
  const width = style.width * output.w;
  const anchorX = style.align === 'left' ? 0 : style.align === 'right' ? -width : -width / 2;
  const isExplain = style.preset === 'explain';
  return (
    <div
      style={{
        position: 'absolute',
        left: style.x * output.w + anchorX,
        top: style.y * output.h,
        width,
        transform: `translateY(-50%) ${motionTransform(motion)}`,
        opacity: motion.opacity,
        textAlign: style.align,
        fontFamily: LONG_FONT,
        fontWeight: caption.kind === 'reaction' ? 900 : 700,
        fontSize: style.size,
        lineHeight: 1.3,
        color: style.color,
        whiteSpace: 'pre-wrap',
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: style.background ? '6px 18px' : 0,
          background: style.background ? 'rgba(15,25,35,.84)' : 'transparent',
          borderLeft: isExplain && style.background ? `6px solid ${style.accent}` : undefined,
          textShadow: style.background
            ? undefined
            : '0 0 6px rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.9), 2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000',
          WebkitTextStroke: caption.kind === 'reaction' ? '2px #000' : undefined,
        }}
      >
        {caption.text}
      </span>
    </div>
  );
};

const OverlayView = ({
  overlay,
  plan,
  mediaBaseUrl,
}: {
  overlay: PlanOverlay;
  plan: RenderPlan;
  mediaBaseUrl: string;
}): ReactNode => {
  const frame = useCurrentFrame();
  const absolute = overlay.from + frame;
  const output = { w: plan.width, h: plan.height };
  const motion = motionAt(overlay.motion, frame, overlay.duration, plan.fps, 120);
  let toPx = (x: number, y: number): { x: number; y: number } => ({ x: x * output.w, y: y * output.h });
  let clip: { x: number; y: number; w: number; h: number } | null = null;
  if (overlay.target !== 'screen') {
    const layer = plan.layers.find((item) => item.placementId === overlay.target);
    const layout = layer ? layerLayoutAt(layer, absolute, output) : null;
    if (!layout) return null;
    toPx = (x, y) => ({ x: layout.frame.x + x * layout.frame.w, y: layout.frame.y + y * layout.frame.h });
    clip = layout.visible;
  }
  const a = toPx(overlay.rect.x, overlay.rect.y);
  const b = toPx(overlay.rect.x + overlay.rect.w, overlay.rect.y + overlay.rect.h);
  const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  const clipId = `clip-${overlay.id}`;
  const stroke = overlay.strokeWidth;
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const transform = `translate(${center.x}px, ${center.y}px) ${motionTransform(motion)} translate(${-center.x}px, ${-center.y}px)`;
  if (overlay.kind === 'image' || overlay.kind === 'cutin' || overlay.kind === 'card') {
    if (!overlay.src) return null;
    return (
      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          opacity: motion.opacity,
          transform: motionTransform(overlay.kind === 'cutin' ? { ...motion, dx: motion.dx + (1 - Math.min(1, frame / 5)) * -output.w * 0.25 } : motion),
          clipPath: clip ? undefined : undefined,
        }}
      >
        <Img src={mediaUrl(mediaBaseUrl, overlay.src)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        {overlay.text ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontFamily: LONG_FONT,
              fontWeight: 900,
              fontSize: Math.round(box.h * 0.18),
              textShadow: '0 2px 6px rgba(0,0,0,.8)',
            }}
          >
            {overlay.text}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <svg width={output.w} height={output.h} style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity: motion.opacity }}>
      {clip ? (
        <defs>
          <clipPath id={clipId}>
            <rect x={clip.x} y={clip.y} width={clip.w} height={clip.h} />
          </clipPath>
        </defs>
      ) : null}
      <g clipPath={clip ? `url(#${clipId})` : undefined}>
        <g style={{ transform, transformBox: 'view-box' }}>
          {overlay.kind === 'rect' ? (
            <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke={overlay.color} strokeWidth={stroke} rx={6} />
          ) : null}
          {overlay.kind === 'circle' ? (
            <ellipse cx={center.x} cy={center.y} rx={box.w / 2} ry={box.h / 2} fill="none" stroke={overlay.color} strokeWidth={stroke} />
          ) : null}
          {overlay.kind === 'marker' ? (
            <g>
              <circle cx={center.x} cy={center.y} r={Math.max(box.w, box.h) / 2} fill="none" stroke={overlay.color} strokeWidth={stroke} />
              <circle cx={center.x} cy={center.y} r={stroke} fill={overlay.color} />
            </g>
          ) : null}
          {overlay.kind === 'arrow' ? <Arrow from={a} to={b} color={overlay.color} width={stroke} /> : null}
        </g>
      </g>
      {overlay.text ? (
        <text
          x={overlay.kind === 'arrow' ? a.x : box.x}
          y={(overlay.kind === 'arrow' ? a.y : box.y) - 14}
          fill="#fff"
          stroke="#000"
          strokeWidth={6}
          paintOrder="stroke"
          fontFamily={LONG_FONT}
          fontWeight={900}
          fontSize={40}
        >
          {overlay.text}
        </text>
      ) : null}
    </svg>
  );
};

const Arrow = ({
  from,
  to,
  color,
  width,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  width: number;
}): ReactNode => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = width * 3.2;
  const left = { x: to.x - head * Math.cos(angle - 0.45), y: to.y - head * Math.sin(angle - 0.45) };
  const right = { x: to.x - head * Math.cos(angle + 0.45), y: to.y - head * Math.sin(angle + 0.45) };
  const shaftEnd = { x: to.x - head * 0.7 * Math.cos(angle), y: to.y - head * 0.7 * Math.sin(angle) };
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={shaftEnd.x} y2={shaftEnd.y} stroke="#000" strokeWidth={width + 6} strokeLinecap="round" opacity={0.5} />
      <line x1={from.x} y1={from.y} x2={shaftEnd.x} y2={shaftEnd.y} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${to.x},${to.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} stroke="#000" strokeOpacity={0.5} strokeWidth={2} />
    </g>
  );
};

const AvatarView = ({
  piece,
  plan,
  mediaBaseUrl,
}: {
  piece: PlanAvatarPiece;
  plan: RenderPlan;
  mediaBaseUrl: string;
}): ReactNode => {
  const frame = useCurrentFrame();
  const absolute = piece.from + frame;
  const elapsed = absolute - piece.motionFrom;
  const boxH = piece.height * plan.height;
  const boxW = (boxH * piece.set.width) / piece.set.height;
  const left = piece.x * plan.width - piece.set.originX * boxW + piece.offset.dx * boxW;
  const top = piece.y * plan.height - piece.set.originY * boxH + piece.offset.dy * boxH;
  const motion = motionAt(piece.motion, elapsed, piece.duration + (piece.from - piece.motionFrom), plan.fps, boxH);
  let src: string;
  if (piece.media.kind === 'still') {
    src = piece.media.path;
  } else {
    const frames = piece.media.frames;
    const index = Math.floor((Math.max(0, elapsed) / plan.fps) * piece.media.fps);
    src = frames[piece.media.loop ? index % frames.length : Math.min(frames.length - 1, index)]!;
  }
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: boxW,
        height: boxH,
        transformOrigin: `${piece.set.originX * 100}% ${piece.set.originY * 100}%`,
        transform: motionTransform(motion),
        opacity: piece.motion === 'fade' ? motion.opacity : 1,
      }}
    >
      {/* 透明余白は切り取らず、セット共通の枠に等方で収める（縦横に伸ばさない） */}
      <Img src={mediaUrl(mediaBaseUrl, src)} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: `${piece.set.originX * 100}% ${piece.set.originY * 100}%` }} />
    </div>
  );
};

const Guides = ({ plan, guides }: { plan: RenderPlan; guides: NonNullable<LongVideoProps['guides']> }): ReactNode => (
  <>
    {guides.textSafe ? (
      <div
        style={{
          position: 'absolute',
          left: plan.width * 0.05,
          top: plan.height * 0.05,
          width: plan.width * 0.9,
          height: plan.height * 0.9,
          border: '2px dashed rgba(62,199,255,.7)',
          pointerEvents: 'none',
        }}
      />
    ) : null}
    {(guides.hud ?? []).map((hud) => (
      <div
        key={hud.label}
        style={{
          position: 'absolute',
          left: hud.rect.x * plan.width,
          top: hud.rect.y * plan.height,
          width: hud.rect.w * plan.width,
          height: hud.rect.h * plan.height,
          border: '2px dashed #E26BFF',
          color: '#E26BFF',
          fontSize: 22,
          fontFamily: LONG_FONT,
          pointerEvents: 'none',
        }}
      >
        <span style={{ position: 'absolute', top: -30, left: 0 }}>{hud.label}</span>
      </div>
    ))}
  </>
);

export const LongVideo = ({ plan, mediaBaseUrl, useProxy, guides, highlightId }: LongVideoProps): ReactNode => {
  const output = { w: plan.width, h: plan.height };
  const lowerCaptions = plan.captions.filter((caption) => caption.kind !== 'reaction');
  const upperCaptions = plan.captions.filter((caption) => caption.kind === 'reaction');
  const cutins = plan.overlays.filter((overlay) => overlay.kind === 'cutin');
  const shapes = plan.overlays.filter((overlay) => overlay.kind !== 'cutin');
  return (
    <AbsoluteFill style={{ background: '#000', fontFamily: LONG_FONT }}>
      {plan.stills.map((still) => (
        <Sequence key={still.id} from={still.from} durationInFrames={Math.max(1, still.duration)} layout="none">
          <AbsoluteFill style={{ background: still.color }}>
            {still.src ? <Img src={mediaUrl(mediaBaseUrl, still.src)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
            {still.placeholder ? (
              <AbsoluteFill
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#F2C38B',
                  fontSize: 64,
                  fontWeight: 700,
                  border: '6px dashed #F2C38B',
                  background: 'repeating-linear-gradient(45deg,#1E242C 0 24px,#171B21 24px 48px)',
                }}
              >
                <div>未割当：{still.label || 'シーン'}</div>
              </AbsoluteFill>
            ) : null}
          </AbsoluteFill>
        </Sequence>
      ))}
      {plan.layers.map((layer) => {
        const src = mediaUrl(mediaBaseUrl, useProxy && layer.proxySrc ? layer.proxySrc : layer.src);
        return layer.pieces.map((piece, index) => (
          <Sequence key={`${layer.id}-${index}`} from={piece.from} durationInFrames={piece.duration} layout="none">
            <VideoPiece layer={layer} piece={piece} src={src} output={output} highlighted={highlightId === layer.placementId} />
          </Sequence>
        ));
      })}
      {shapes.map((overlay) => (
        <Sequence key={overlay.id} from={overlay.from} durationInFrames={overlay.duration} layout="none">
          <OverlayView overlay={overlay} plan={plan} mediaBaseUrl={mediaBaseUrl} />
        </Sequence>
      ))}
      {plan.avatars.map((piece) => (
        <Sequence key={piece.id} from={piece.from} durationInFrames={piece.duration} layout="none">
          <AvatarView piece={piece} plan={plan} mediaBaseUrl={mediaBaseUrl} />
        </Sequence>
      ))}
      {lowerCaptions.map((caption) => (
        <Sequence key={caption.id} from={caption.from} durationInFrames={caption.duration} layout="none">
          <CaptionView caption={caption} output={output} fps={plan.fps} />
        </Sequence>
      ))}
      {cutins.map((overlay) => (
        <Sequence key={overlay.id} from={overlay.from} durationInFrames={overlay.duration} layout="none">
          <OverlayView overlay={overlay} plan={plan} mediaBaseUrl={mediaBaseUrl} />
        </Sequence>
      ))}
      {upperCaptions.map((caption) => (
        <Sequence key={caption.id} from={caption.from} durationInFrames={caption.duration} layout="none">
          <CaptionView caption={caption} output={output} fps={plan.fps} />
        </Sequence>
      ))}
      {plan.audio.map((piece) => (
        <Sequence key={piece.id} from={piece.from} durationInFrames={piece.duration} layout="none">
          <Audio
            src={mediaUrl(mediaBaseUrl, piece.src)}
            trimBefore={piece.trimBefore}
            playbackRate={piece.speed}
            volume={(frame) => audioPieceVolume(piece, piece.from + frame)}
            pauseWhenBuffering
          />
        </Sequence>
      ))}
      {plan.bgm.map((bgm) => (
        <Sequence key={bgm.id} from={bgm.from} durationInFrames={bgm.duration} layout="none">
          <Audio
            src={mediaUrl(mediaBaseUrl, bgm.src)}
            trimBefore={bgm.offset}
            loop={bgm.loop}
            volume={(frame) => bgmVolume(bgm, bgm.from + frame)}
            pauseWhenBuffering
          />
        </Sequence>
      ))}
      {plan.se.map((se) => (
        <Sequence key={se.id} from={se.from} durationInFrames={se.duration} layout="none">
          <Audio src={mediaUrl(mediaBaseUrl, se.src)} volume={se.gain} />
        </Sequence>
      ))}
      {guides ? <Guides plan={plan} guides={guides} /> : null}
    </AbsoluteFill>
  );
};

export const longDurationInFrames = (plan: RenderPlan): number => Math.max(1, plan.durationInFrames);
