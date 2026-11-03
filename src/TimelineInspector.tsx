import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { AudioRegistration, AudioTrack, Platform } from '../shared/schema/audio';
import type { AudioUsageRecord } from '../shared/ipc';
import {
  captionTextFor,
  defaultCtaCaption,
  defaultDemoCaption,
  type Caption,
  type CaptionSurface,
  type Language,
  type Project,
  type SceneKey,
} from '../shared/schema/project';
import { withAimMarker } from '../shared/aim-marker';
import { FOCUS_CROP_ZOOM, focusCropCenterYOf, focusCropZoomOf, roundFocusZoom } from '../shared/layout-focus';
import { annotationStyleOf, getAnnotationStyle, zoomChromeThickness } from '../shared/annotation-style';
import { clampVideoAimZoomOrigin, defaultSceneAimZoom, VIDEO_AIM_FRAME, VIDEO_AIM_ZOOM_RATIO } from '../shared/aim-zoom';
import { AnnotationWeightField } from './AnnotationWeightField';
import { MarkerAxisControl } from './MarkerAxisControl';
import type { Timeline, TimelineItem } from '../shared/schema/timeline';
import { applyCutLength, applySceneCutDuration, cutOnlyItem, DEMO_DURATION_MIN, SCENE_BAND, activeTimeline, defaultLoopRange, playbackSceneKey, sceneBgmLevel, setSceneAudioLevel, setVolumePoint, trimLimits } from '../shared/timeline';
import { PRIMARY_CUT_ID, cutCrop, cutIdOfItem, extraCutOfItem, extraCutsOf, hasExtraCuts, type CutCrop } from '../shared/scene-cuts';
import { assignClipToCut, setCutCrop, setCutRange } from '../shared/scene-cut-edit';
import { AudioPanel } from './AudioPanel';
import { LineupPage, PublishPage, BgmGainFields } from './ProjectInspector';
import { CLIP_DRAG_TYPE, type TimelineSelection } from './timeline-model';
import { CTA_DESIGN_OPTIONS, type CtaDesign } from '../shared/cta-design';
import {
  likeCtaFitWarning,
  resolveCtaDesign,
  resolveLikeCtaText,
  resolveS4CtaPurpose,
  S4_CTA_COPY,
  type S4CtaPurpose,
  type S4CtaText,
  type S4LikeCtaText,
} from '../shared/s4-cta';

type InspectorPage = 'selection' | 'lineup' | 'publish' | 'audio';

const ZoomStep = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}) => (
  <div className="gd-trim-time">
    <span className="gd-trim-time-label">{label}</span>
    <button
      type="button"
      className="gd-nudge"
      aria-label={`${label}を戻す`}
      disabled={value <= min + 1e-6}
      onClick={() => onChange(Number((value - step).toFixed(2)))}
    >
      ‹
    </button>
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={Number(value.toFixed(2))}
      aria-label={label}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
    <button
      type="button"
      className="gd-nudge"
      aria-label={`${label}を進める`}
      disabled={value >= max - 1e-6}
      onClick={() => onChange(Number((value + step).toFixed(2)))}
    >
      ›
    </button>
  </div>
);

type Props = {
  project: Project;
  tracks: AudioTrack[];
  timeline: Timeline;
  selection: TimelineSelection | null;
  playheadSec: number;
  language: Language;
  busy: boolean;
  audioUsage: AudioUsageRecord[];
  defaultPostPlatform: Platform;
  onChange: (updater: (project: Project) => Project) => void;
  onEditTimeline: (next: Timeline | ((current: Timeline) => Timeline)) => void;
  onImportVideo: (sceneKey?: SceneKey) => void;
  onEditRange: (sceneKey: SceneKey, cutId?: string) => void;
  defaultBgmTrackId: string | null;
  onRegisterAudio: (registration: AudioRegistration, sourcePath?: string) => void;
  onSetDefaultBgm: (trackId: string | null) => void;
};

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const s4TextOf = (project: Project): S4CtaText =>
  project.templateParams.s4Cta ?? {
    main: { ja: S4_CTA_COPY.ja.main, en: S4_CTA_COPY.en.main },
    sub: { ja: S4_CTA_COPY.ja.sub, en: S4_CTA_COPY.en.sub },
  };

const likeTextOf = (project: Project): S4LikeCtaText => resolveLikeCtaText(project);

const CaptionSurfaceFields = ({
  project,
  caption,
  onChange,
}: {
  project: Project;
  caption: Caption;
  onChange: (updater: (project: Project) => Project) => void;
}): ReactNode => {
  const ctaDesign = caption.id === 'cta' ? resolveCtaDesign(project) : 's7-band';
  const ctaPurpose = caption.id === 'cta' ? resolveS4CtaPurpose(project) : 'cv';
  const likeText = likeTextOf(project);
  const surfaces: { id: CaptionSurface; label: string }[] =
    caption.sceneKey === 'hook' || caption.id === 'hook'
      ? [
          { id: 'video', label: '動画' },
          { id: 'card', label: '完成カード' },
          { id: 'x', label: 'X用カード' },
          { id: 'thumb', label: 'サムネイル' },
        ]
      : [{ id: 'video', label: '動画' }];

  const patchText = (surface: CaptionSurface, language: Language, value: string): void => {
    onChange((current) => ({
      ...current,
      captions: (current.captions.some((item) => item.id === caption.id)
        ? current.captions
        : [...current.captions, { ...caption, text: { ...caption.text } }]
      ).map((item) => {
        if (item.id !== caption.id) return item;
        if (surface === 'video') {
          return { ...item, text: { ...item.text, [language]: value } };
        }
        const key = surface === 'card' ? 'cardText' : surface === 'x' ? 'xText' : 'thumbText';
        const overlay = item[key] ?? { ja: '', en: '' };
        const nextValue = value === item.text[language] ? '' : value;
        const next = { ...overlay, [language]: nextValue };
        return {
          ...item,
          [key]: next.ja || next.en ? next : undefined,
        };
      }),
    }));
  };

  return (
    <div className="inspector-fields">
      <p className="inspector-kicker">{caption.id === 'cta' ? 'CTA' : 'テロップ'}</p>
      {caption.id === 'cta' && (
        <>
          <label>
            CTAデザイン
            <select
              aria-label="CTAデザイン"
              value={ctaDesign}
              onChange={(event) => {
                const next = event.target.value as CtaDesign;
                onChange((current) => ({
                  ...current,
                  templateParams: { ...current.templateParams, ctaDesign: next },
                }));
              }}
            >
              {CTA_DESIGN_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="inspector-check">
            <input
              type="checkbox"
              checked={!caption.hidden}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  captions: (current.captions.some((item) => item.id === caption.id)
                    ? current.captions
                    : [...current.captions, { ...caption }]
                  ).map((item) =>
                    item.id === caption.id ? { ...item, hidden: !event.target.checked } : item,
                  ),
                }))
              }
            />
            {ctaDesign === 's4-block' ? 'S4 の末尾2秒に表示する' : 'S7 に表示する'}
          </label>
        </>
      )}
      {caption.id === 'cta' && ctaDesign === 's4-block' && (
        <>
          <label>
            CTAの目的
            <select
              aria-label="CTAの目的"
              value={ctaPurpose}
              onChange={(event) => {
                const purpose = event.target.value as S4CtaPurpose;
                onChange((current) => ({
                  ...current,
                  templateParams: { ...current.templateParams, s4CtaPurpose: purpose },
                }));
              }}
            >
              <option value="like">高評価して見返す</option>
              <option value="cv">ClutchVaultへ案内</option>
            </select>
          </label>
          {ctaPurpose === 'like' ? (
            <>
              {(['ja', 'en'] as const).map((language) => (
                <div key={language}>
                  <p className="inspector-kicker inspector-kicker-sub">
                    {language === 'ja' ? '日本語' : 'English'}
                  </p>
                  <label>
                    1行目
                    <input
                      type="text"
                      aria-label={`高評価CTA 1行目（${language === 'ja' ? '日本語' : '英語'}）`}
                      value={likeText.line1[language]}
                      onChange={(event) => {
                        const value = event.target.value;
                        onChange((current) => {
                          const text = likeTextOf(current);
                          return {
                            ...current,
                            templateParams: {
                              ...current.templateParams,
                              s4LikeCta: { ...text, line1: { ...text.line1, [language]: value } },
                            },
                          };
                        });
                      }}
                    />
                  </label>
                  <label>
                    2行目（👍の前）
                    <input
                      type="text"
                      aria-label={`高評価CTA 👍の前（${language === 'ja' ? '日本語' : '英語'}）`}
                      value={likeText.before[language]}
                      onChange={(event) => {
                        const value = event.target.value;
                        onChange((current) => {
                          const text = likeTextOf(current);
                          return {
                            ...current,
                            templateParams: {
                              ...current.templateParams,
                              s4LikeCta: { ...text, before: { ...text.before, [language]: value } },
                            },
                          };
                        });
                      }}
                    />
                  </label>
                  <p className="inspector-note">👍 は固定です。文字としては入れません。</p>
                  <label>
                    2行目（👍の後）
                    <input
                      type="text"
                      aria-label={`高評価CTA 👍の後（${language === 'ja' ? '日本語' : '英語'}）`}
                      value={likeText.after[language]}
                      onChange={(event) => {
                        const value = event.target.value;
                        onChange((current) => {
                          const text = likeTextOf(current);
                          return {
                            ...current,
                            templateParams: {
                              ...current.templateParams,
                              s4LikeCta: { ...text, after: { ...text.after, [language]: value } },
                            },
                          };
                        });
                      }}
                    />
                  </label>
                  {likeCtaFitWarning(language, likeText.before[language], likeText.after[language]) && (
                    <p className="inspector-note">
                      {likeCtaFitWarning(language, likeText.before[language], likeText.after[language])}
                    </p>
                  )}
                </div>
              ))}
              <label className="inspector-check">
                <input
                  type="checkbox"
                  checked={likeText.motion !== false}
                  onChange={(event) => {
                    const motion = event.target.checked;
                    onChange((current) => {
                      const text = likeTextOf(current);
                      return {
                        ...current,
                        templateParams: {
                          ...current.templateParams,
                          s4LikeCta: { ...text, motion },
                        },
                      };
                    });
                  }}
                />
                👍を軽く弾ませる
              </label>
              <p className="inspector-note">
                映像の上、中央に末尾2秒表示します。配置は固定です。TikTokへ書き出すときは、別に保存したClutchVault案内を使います。
              </p>
            </>
          ) : null}
          {ctaPurpose === 'cv' &&
          (
            [
              ['main', '主文'],
              ['sub', '補助行'],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <p className="inspector-kicker inspector-kicker-sub">{label}</p>
              {(['ja', 'en'] as const).map((language) => (
                <label key={language}>
                  {language === 'ja' ? '日本語' : 'English'}
                  <textarea
                    rows={2}
                    value={s4TextOf(project)[field][language]}
                    onChange={(event) => {
                      const value = event.target.value;
                      onChange((current) => {
                        const text = s4TextOf(current);
                        return {
                          ...current,
                          templateParams: {
                            ...current.templateParams,
                            s4Cta: {
                              ...text,
                              [field]: { ...text[field], [language]: value },
                            },
                          },
                        };
                      });
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
          {ctaPurpose === 'cv' && (
            <p className="inspector-note">
              S4の映像直下に、フェードなしで末尾2秒表示します。S7のCTA本文は変わりません。
            </p>
          )}
        </>
      )}
      {caption.id === 'cta' && ctaDesign === 's4-block'
        ? null
        : surfaces.map((surface) => (
            <div key={surface.id} className="inspector-surface">
              {surfaces.length > 1 && <p className="inspector-kicker inspector-kicker-sub">{surface.label}</p>}
              <label>
                日本語
                <textarea
                  rows={3}
                  value={captionTextFor(caption, 'ja', surface.id)}
                  onChange={(event) => patchText(surface.id, 'ja', event.target.value)}
                />
              </label>
              <label>
                English
                <textarea
                  rows={3}
                  value={captionTextFor(caption, 'en', surface.id)}
                  onChange={(event) => patchText(surface.id, 'en', event.target.value)}
                />
              </label>
            </div>
          ))}
      {caption.id === 'cta' && ctaDesign === 's4-block' ? null : (
        <p className="inspector-note">
          {caption.sceneKey === 'hook' || caption.id === 'hook'
            ? '改行したい位置で Enter を押すか、{br} を入れます。完成カード・X用・サムネイルは、動画と改行を変えたいときだけ編集してください。動画と同じ内容に戻すと再び追従します。サムネイルは3行まで表示されます。'
            : '改行したい位置で Enter を押すか、{br} を入れるとその位置で折り返します。'}
        </p>
      )}
    </div>
  );
};

const SOURCE_LABEL: Record<AudioTrack['source'], string> = {
  bgmer: 'BGMer',
  musmus: 'MusMus',
  opentracks: 'OpenTracks',
  ytal: 'YouTube Audio Library',
  other: 'その他',
};

const DemoDurationControl = ({
  clip,
  onChangeDuration,
}: {
  clip: TimelineItem;
  onChangeDuration: (seconds: number) => void;
}): ReactNode => {
  const trackSeconds = Math.max(clip.duration + 8, 20);
  const widthPercent = Math.min(100, Math.max(8, (clip.duration / trackSeconds) * 100));

  const startDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const originDuration = clip.duration;
    const move = (ev: PointerEvent): void => {
      const next = originDuration + (ev.clientX - originX) / 24;
      onChangeDuration(Math.max(DEMO_DURATION_MIN, next));
    };
    move(event.nativeEvent);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="demo-stretch">
      <span>デモ尺 {clip.duration.toFixed(1)}秒（最短 {DEMO_DURATION_MIN}秒）</span>
      <div
        className="demo-stretch-track"
        onPointerDown={startDrag}
        title="右端をドラッグして尺を伸ばす／縮める"
      >
        <div className="demo-stretch-clip" style={{ width: `${widthPercent}%` }}>
          <span>{clip.duration.toFixed(1)}s</span>
          <button
            type="button"
            className="demo-stretch-handle"
            aria-label="デモ尺をドラッグして調整"
            onPointerDown={startDrag}
          />
        </div>
      </div>
      <label>
        デモ尺（秒）
        <input
          type="number"
          min={DEMO_DURATION_MIN}
          step={0.1}
          value={Number(clip.duration.toFixed(2))}
          onChange={(event) => onChangeDuration(Number(event.target.value))}
        />
      </label>
    </div>
  );
};

export const TimelineInspector = ({
  project,
  tracks,
  timeline,
  selection,
  playheadSec,
  language,
  busy,
  audioUsage,
  defaultPostPlatform,
  onChange,
  onEditTimeline,
  onImportVideo,
  onEditRange,
  onRegisterAudio,
  defaultBgmTrackId,
  onSetDefaultBgm,
}: Props): ReactNode => {
  const [page, setPage] = useState<InspectorPage>('selection');
  const [clipQuery, setClipQuery] = useState('');
  useEffect(() => {
    if (selection) setPage('selection');
  }, [selection]);
  const resolved =
    selection ??
    ({
      kind: 'clip',
      id:
        timeline.items.find(
          (item) => playheadSec >= item.start && playheadSec < item.start + item.duration,
        )?.id ?? timeline.items[0]?.id,
    } as TimelineSelection);
  const clip = resolved.kind === 'clip' ? timeline.items.find((item) => item.id === resolved.id) : undefined;
  const effect = resolved.kind === 'effect' ? timeline.effects.find((item) => item.id === resolved.id) : undefined;
  const point = resolved.kind === 'volume' ? timeline.volumePoints.find((item) => item.id === resolved.id) : undefined;
  const caption =
    resolved.kind === 'caption'
      ? (project.captions.find((item) => item.id === resolved.id) ??
        (resolved.id === 'demo'
          ? defaultDemoCaption()
          : resolved.id === 'cta'
            ? defaultCtaCaption()
            : undefined))
      : undefined;
  const scene = clip ? project.scenes.find((item) => item.sceneKey === clip.sceneKey) : undefined;
  const sourceScene = clip
    ? project.scenes.find((item) => item.sceneKey === playbackSceneKey(project, clip.sceneKey))
    : undefined;
  /** カット2以降の項目なら、そのカット。カット1・カットのないシーンは undefined。 */
  const extraCut = clip ? extraCutOfItem(project, clip) : undefined;
  const cutId = clip ? cutIdOfItem(project, clip) : PRIMARY_CUT_ID;
  const multiCut = clip ? hasExtraCuts(project, clip.sceneKey) : false;
  const cutNumber = extraCut ? extraCutsOf(scene).indexOf(extraCut) + 2 : 1;
  const cutOnly = clip ? cutOnlyItem(project, timeline.items, timeline.items.indexOf(clip)) : false;
  const mediaClip = project.clips.find((item) => item.id === (extraCut ? extraCut.clipId : sourceScene?.clipId));
  const asset = project.assets.find((item) => item.id === mediaClip?.assetId);
  /** クロップの表示用。カット2以降はそのカットの値。 */
  const cropScene = scene && extraCut ? { ...scene, ...cutCrop(scene, extraCut) } : scene;
  /** 選んでいる項目のカットのクロップを変える。カット1・カットのないシーンはシーンの値。 */
  const setCrop = (sceneKey: SceneKey, patch: Partial<CutCrop>): void => {
    onChange((current) => setCutCrop(current, sceneKey, cutId, patch));
  };
  /** 選んでいる項目のカットの IN／OUT を変える。 */
  const setRange = (sceneKey: SceneKey, range: { in: number; out: number }): void => {
    onChange((current) => setCutRange(current, sceneKey, cutId, range));
  };
  const bgm = project.audio.bgm;
  const bgmTrack = tracks.find((track) => track.id === bgm?.audioTrackId);

  const patchItem = (itemId: string, patch: Partial<TimelineItem>): void => {
    onEditTimeline((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }));
  };

  const patchScene = (sceneKey: SceneKey, patch: Partial<Project['scenes'][number]>): void => {
    onChange((current) => ({
      ...current,
      scenes: current.scenes.map((item) => (item.sceneKey === sceneKey ? { ...item, ...patch } : item)),
    }));
  };

  /** 項目の尺を変える。カットが2本以上のシーンでは、その項目のカットの長さ（シーンの尺は合計）。 */
  const setClipDuration = (item: TimelineItem, seconds: number): void => {
    onChange((current) => {
      const edited = {
        ...current,
        timelineEdited: true,
        timeline: current.timeline ?? activeTimeline(current),
      };
      return applyCutLength(edited, item.sceneKey, cutIdOfItem(edited, item), seconds);
    });
  };

  const setSceneMix = (sceneKey: SceneKey, key: 'game' | 'bgm', value: number): void => {
    const next = Math.min(1, Math.max(0, value));
    onChange((current) => {
      const scenes = current.scenes.map((item) =>
        item.sceneKey === sceneKey
          ? key === 'game'
            ? { ...item, volume: next }
            : { ...item, bgmVolume: next }
          : item,
      );
      const withScenes = { ...current, scenes };
      if (!current.timeline && !current.timelineEdited) return withScenes;
      return {
        ...withScenes,
        timeline: setSceneAudioLevel(activeTimeline(withScenes), sceneKey, key, next),
      };
    });
  };

  const loopLead =
    clip?.sceneKey === 'loop' && !scene?.clipId ? defaultLoopRange(project) : null;
  const clipOptions = project.clips.filter((item) => {
    const itemAsset = project.assets.find((asset) => asset.id === item.assetId);
    const haystack = `${itemAsset?.path ?? ''} ${itemAsset?.tags.join(' ') ?? ''}`.toLowerCase();
    return haystack.includes(clipQuery.trim().toLowerCase());
  });

  return (
    <aside className="timeline-inspector" aria-label="インスペクター">
      <div className="inspector-tabs" role="tablist" aria-label="インスペクターのページ">
        {(
          [
            ['selection', '選択中'],
            ['lineup', '定点'],
            ['publish', '投稿'],
            ['audio', '音源'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={page === id}
            className={page === id ? 'active' : ''}
            onClick={() => setPage(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {page === 'lineup' && (
        <LineupPage
          project={project}
          language={language}
          busy={busy}
          onChange={onChange}
          onImportVideo={onImportVideo}
        />
      )}
      {page === 'publish' && (
        <PublishPage
          project={project}
          language={language}
          defaultPostPlatform={defaultPostPlatform}
          onChange={onChange}
        />
      )}
      {page === 'audio' && (
        <AudioPanel
          project={project}
          tracks={tracks}
          usage={audioUsage}
          busy={busy}
          defaultBgmTrackId={defaultBgmTrackId}
          onRegister={onRegisterAudio}
          onChange={onChange}
          onSetDefaultBgm={onSetDefaultBgm}
        />
      )}
      {page === 'selection' && (
        <>
      {!selection && (
        <p className="inspector-note">
          再生ヘッド位置のクリップを表示しています。編集中の言語は{language === 'ja' ? '日本語' : 'English'}です。
        </p>
      )}
      {clip && (
        <div className="inspector-fields">
          <p className="inspector-kicker">
            {multiCut ? `${SCENE_BAND[clip.sceneKey]} · カット${cutNumber}` : SCENE_BAND[clip.sceneKey]}
          </p>
          <label>
            ソース
            <input readOnly value={asset ? fileName(asset.path) : '素材なし'} />
          </label>
          {mediaClip && (
            <div className="inspector-pair">
              <label>
                IN
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={Number(mediaClip.in.toFixed(2))}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (extraCut) {
                      setRange(clip.sceneKey, { in: Math.min(next, mediaClip.out - 0.1), out: mediaClip.out });
                      return;
                    }
                    onChange((current) => {
                      const clips = current.clips.map((item) =>
                        item.id === mediaClip.id ? { ...item, in: Math.min(next, item.out - 0.1) } : item,
                      );
                      const updated = clips.find((item) => item.id === mediaClip.id);
                      if (!updated) return current;
                      return applySceneCutDuration({ ...current, clips }, clip.sceneKey, updated.out - updated.in);
                    });
                  }}
                />
              </label>
              <label>
                OUT
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={Number(mediaClip.out.toFixed(2))}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (extraCut) {
                      setRange(clip.sceneKey, { in: mediaClip.in, out: Math.max(next, mediaClip.in + 0.1) });
                      return;
                    }
                    onChange((current) => {
                      const clips = current.clips.map((item) =>
                        item.id === mediaClip.id ? { ...item, out: Math.max(next, item.in + 0.1) } : item,
                      );
                      const updated = clips.find((item) => item.id === mediaClip.id);
                      if (!updated) return current;
                      return applySceneCutDuration({ ...current, clips }, clip.sceneKey, updated.out - updated.in);
                    });
                  }}
                />
              </label>
            </div>
          )}
          <label>
            {multiCut ? '縦型変換（このシーン共通）' : '縦型変換'}
            <select
              value={clip.layout}
              onChange={(event) => {
                const layout = event.target.value as TimelineItem['layout'];
                if (multiCut) {
                  onEditTimeline((current) => ({
                    ...current,
                    items: current.items.map((item) => (item.sceneKey === clip.sceneKey ? { ...item, layout } : item)),
                  }));
                } else {
                  patchItem(clip.id, { layout });
                }
                onChange((current) => ({
                  ...current,
                  scenes: current.scenes.map((item) =>
                    item.sceneKey === clip.sceneKey
                      ? {
                          ...item,
                          layout916: layout,
                          ...(layout === 'center-crop' ? { cropCenterX: 0.5 } : {}),
                        }
                      : item,
                  ),
                }));
              }}
            >
              <option value="center-crop">中央切り抜き</option>
              <option value="blur-fit">ぼかし背景</option>
              <option value="focus">フォーカス</option>
              <option value="split">上下分割</option>
            </select>
          </label>
          {clip.layout === 'focus' && (
            <p className="inspector-note">映像 1080×1430・上部にグラデーション</p>
          )}
          {(clip.layout === 'center-crop' || clip.layout === 'focus') && cropScene && (
            <label>
              {clip.layout === 'focus' ? '切り抜きの横位置' : '切り抜き中心'}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={cropScene.cropCenterX}
                onChange={(event) => setCrop(cropScene.sceneKey, { cropCenterX: Number(event.target.value) })}
              />
            </label>
          )}
          {clip.layout === 'focus' && cropScene && (
            <label>
              切り抜きの縦位置
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                aria-label="切り抜きの縦位置"
                value={focusCropCenterYOf(cropScene)}
                onChange={(event) => setCrop(cropScene.sceneKey, { cropCenterY: Number(event.target.value) })}
              />
            </label>
          )}
          {clip.layout === 'focus' && cropScene && (
            <ZoomStep
              label="切り抜き拡大率"
              value={focusCropZoomOf(cropScene)}
              min={FOCUS_CROP_ZOOM.min}
              max={FOCUS_CROP_ZOOM.max}
              step={FOCUS_CROP_ZOOM.step}
              onChange={(next) => {
                setCrop(cropScene.sceneKey, { cropZoom: roundFocusZoom(next) });
              }}
            />
          )}
          <div className="inspector-pair">
            <label>
              速度
              <select value={clip.speed} onChange={(event) => patchItem(clip.id, { speed: Number(event.target.value) })}>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x</option>
              </select>
            </label>
            {!cutOnly && (
              <label>
                トランジション
                <select
                  value={clip.transition}
                  onChange={(event) =>
                    patchItem(clip.id, { transition: event.target.value as TimelineItem['transition'] })
                  }
                >
                  <option value="cut">カット</option>
                  <option value="fade">フェード</option>
                  <option value="slide">スライド</option>
                </select>
              </label>
            )}
          </div>
          {cutOnly && <p className="inspector-note">シーン内のカットは切り替えでつながります。</p>}
          <label className="inspector-check">
            <input
              type="checkbox"
              checked={Boolean(clip.arrow)}
              onChange={(event) =>
                patchItem(clip.id, {
                  arrow: event.target.checked ? { x1: 0.28, y1: 0.62, x2: 0.58, y2: 0.48 } : null,
                })
              }
            />
            矢印
          </label>
          {scene && (
            <>
              <label>
                このシーンのゲーム音
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={scene.volume}
                  onChange={(event) => setSceneMix(scene.sceneKey, 'game', Number(event.target.value))}
                />
              </label>
              <label>
                このシーンのBGM
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={scene.bgmVolume ?? sceneBgmLevel(project, scene.sceneKey)}
                  onChange={(event) => setSceneMix(scene.sceneKey, 'bgm', Number(event.target.value))}
                />
              </label>
              <p className="inspector-note">
                このシーンのBGMの実際の大きさは、個別の値 × BGM全体％ です。
              </p>
            </>
          )}
          {clip.sceneKey !== 'card' && (
            <>
              <label>
                素材を検索
                <input
                  value={clipQuery}
                  placeholder="素材名やタグ"
                  onChange={(event) => setClipQuery(event.target.value)}
                />
              </label>
              {clipOptions.length > 0 && (
                <div className="drag-chip-list" aria-label="タイムラインへドラッグできる素材">
                  {clipOptions.map((item) => {
                    const itemAsset = project.assets.find((asset) => asset.id === item.assetId);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="drag-chip"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(CLIP_DRAG_TYPE, item.id);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                      >
                        {fileName(itemAsset?.path ?? item.id)}
                      </button>
                    );
                  })}
                </div>
              )}
              <label>
                {multiCut ? 'このカットの素材' : 'このシーンの素材'}
                <select
                  value={multiCut ? (mediaClip?.id ?? '') : (scene?.clipId ?? '')}
                  onChange={(event) => {
                    const clipId = event.target.value || undefined;
                    if (multiCut) {
                      // カットごとに専用のクリップを持つので、選んだクリップの動画と範囲を写す
                      if (clipId) onChange((current) => assignClipToCut(current, clip.sceneKey, cutId, clipId));
                      return;
                    }
                    onChange((current) => ({
                      ...current,
                      scenes: current.scenes.map((item) =>
                        item.sceneKey === clip.sceneKey ? { ...item, clipId } : item,
                      ),
                    }));
                  }}
                >
                  {!multiCut && (
                    <option value="">{clip.sceneKey === 'loop' ? (loopLead ? 'S1 の直前' : 'S1 と同じ映像') : '未設定'}</option>
                  )}
                  {clipOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {fileName(project.assets.find((asset) => asset.id === item.assetId)?.path ?? item.id)} (
                      {item.in.toFixed(2)}–{item.out.toFixed(2)}s)
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {clip.sceneKey === 'loop' && !scene?.clipId && (
            <p className="inspector-note">
              {loopLead
                ? `未設定の間は S1 の直前を使います。終了は S1 の開始より 0.01 秒前（${loopLead.out.toFixed(2)}秒）です。S1 の開始を動かすと、S7 の終了も追従します。`
                : 'S1 の直前が取れないため、S1 と同じ映像を使います。別の映像を選ぶと S7 だけ差し替わります。'}
            </p>
          )}
          {clip.sceneKey !== 'card' && (
            <>
              <button type="button" onClick={() => onImportVideo(clip.sceneKey === 'demo' || clip.sceneKey === 'loop' ? clip.sceneKey : undefined)} disabled={busy}>
                {clip.sceneKey === 'demo' ? '＋ 実践動画' : '＋ 録画を取り込む'}
              </button>
              <button type="button" disabled={!mediaClip} onClick={() => onEditRange(playbackSceneKey(project, clip.sceneKey), extraCut ? cutId : undefined)}>
                範囲を映像で指定
              </button>
            </>
          )}
          {clip.sceneKey !== 'demo' && (
            <label>
              尺（秒）
              <input
                type="number"
                min={trimLimits(clip, timeline.items).min}
                step={0.1}
                value={Number(clip.duration.toFixed(2))}
                onChange={(event) => setClipDuration(clip, Number(event.target.value))}
              />
            </label>
          )}
          {clip.sceneKey === 'card' && (
            <p className="inspector-note">完成カードの表示秒数です。映像の切り抜きはありません。</p>
          )}
          {clip.sceneKey === 'demo' && (
            <DemoDurationControl
              clip={clip}
              onChangeDuration={(seconds) => setClipDuration(clip, seconds)}
            />
          )}
          {clip.sceneKey === 'card' && (
            <label>
              完成カード
              <select
                value={project.cardLayout ?? 'stack'}
                onChange={(event) =>
                  onChange((current) => {
                    current.cardLayout = event.target.value as Project['cardLayout'];
                    return current;
                  })
                }
              >
                <option value="aim">A案：AIM主役</option>
                <option value="stack">B案：縦3ステップ</option>
              </select>
            </label>
          )}
          {extraCut && (clip.sceneKey === 'stand' || clip.sceneKey === 'aim') && (
            <p className="inspector-note">ズーム・フリーズ・照準マーカーはカット1で設定します。</p>
          )}
          {(clip.sceneKey === 'stand' || clip.sceneKey === 'aim') && scene && !extraCut && (
            <>
              <label className="inspector-check">
                <input
                  type="checkbox"
                  checked={scene.zoom?.enabled ?? false}
                  onChange={(event) =>
                    patchScene(scene.sceneKey, {
                      zoom: {
                        enabled: event.target.checked,
                        from: scene.zoom?.from ?? 1,
                        to: scene.zoom?.to ?? 1.15,
                        x: scene.zoom?.x ?? 0.5,
                        y: scene.zoom?.y ?? 0.5,
                      },
                    })
                  }
                />
                ズーム
              </label>
              {scene.zoom?.enabled && (
                <>
                  <div className="inspector-pair">
                    <label>
                      開始倍率
                      <input
                        type="number"
                        min={1}
                        step={0.05}
                        value={scene.zoom.from}
                        onChange={(event) =>
                          patchScene(scene.sceneKey, {
                            zoom: { ...scene.zoom!, from: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      終了倍率
                      <input
                        type="number"
                        min={1}
                        step={0.05}
                        value={scene.zoom.to}
                        onChange={(event) =>
                          patchScene(scene.sceneKey, {
                            zoom: { ...scene.zoom!, to: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="inspector-pair">
                    <label>
                      ズーム X
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={scene.zoom.x}
                        onChange={(event) =>
                          patchScene(scene.sceneKey, {
                            zoom: { ...scene.zoom!, x: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                    <label>
                      ズーム Y
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={scene.zoom.y}
                        onChange={(event) =>
                          patchScene(scene.sceneKey, {
                            zoom: { ...scene.zoom!, y: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                  </div>
                </>
              )}
            </>
          )}
          {clip.sceneKey === 'aim' && scene && !extraCut && (
            <>
              <label className="inspector-check">
                <input
                  type="checkbox"
                  checked={scene.freeze?.enabled ?? false}
                  onChange={(event) =>
                    patchScene(scene.sceneKey, {
                      freeze: {
                        enabled: event.target.checked,
                        at: scene.freeze?.at ?? 2,
                        duration: scene.freeze?.duration ?? 1,
                      },
                    })
                  }
                />
                フリーズ
              </label>
              {scene.freeze?.enabled && (
                <div className="inspector-pair">
                  <label>
                    開始（秒）
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={scene.freeze.at}
                      onChange={(event) =>
                        patchScene(scene.sceneKey, {
                          freeze: { ...scene.freeze!, at: Number(event.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    長さ（秒）
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={scene.freeze.duration}
                      onChange={(event) =>
                        patchScene(scene.sceneKey, {
                          freeze: { ...scene.freeze!, duration: Number(event.target.value) },
                        })
                      }
                    />
                  </label>
                </div>
              )}
              <label className="inspector-check">
                <input
                  type="checkbox"
                  checked={scene.aimMarker?.enabled ?? false}
                  onChange={(event) =>
                    patchScene(scene.sceneKey, {
                      aimMarker: withAimMarker(scene.aimMarker, { enabled: event.target.checked }),
                    })
                  }
                />
                照準マーカー
              </label>
              {scene.aimMarker?.enabled && (
                <>
                  <MarkerAxisControl
                    axis="x"
                    value={scene.aimMarker?.x ?? 0.5}
                    onChange={(x) =>
                      patchScene(scene.sceneKey, {
                        aimMarker: withAimMarker(scene.aimMarker, { enabled: true, x }),
                      })
                    }
                  />
                  <MarkerAxisControl
                    axis="y"
                    value={scene.aimMarker?.y ?? 0.5}
                    onChange={(y) =>
                      patchScene(scene.sceneKey, {
                        aimMarker: withAimMarker(scene.aimMarker, { enabled: true, y }),
                      })
                    }
                  />
                  <p className="inspector-note">数値は動画フレームの左上から。Xは0〜1080、Yは0〜1920です。</p>
                  <label>
                    円の大きさ
                    <input
                      type="range"
                      min={0.3}
                      max={3}
                      step={0.05}
                      value={scene.aimMarker?.size ?? 1}
                      onChange={(event) =>
                        patchScene(scene.sceneKey, {
                          aimMarker: withAimMarker(scene.aimMarker, {
                            enabled: true,
                            size: Number(event.target.value),
                          }),
                        })
                      }
                    />
                  </label>
                  <p className="inspector-note">
                    {(scene.aimMarker?.size ?? 1).toFixed(2)}倍（基準 1.00）
                  </p>
                  <label>
                    出現（切り抜き開始から・秒）
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      aria-label="照準マーカーの出現"
                      value={scene.aimMarker?.at ?? 0}
                      onChange={(event) => {
                        const at = Number(event.target.value);
                        if (!Number.isFinite(at)) return;
                        patchScene(scene.sceneKey, {
                          aimMarker: withAimMarker(scene.aimMarker, {
                            enabled: true,
                            at: Math.max(0, at),
                          }),
                        });
                      }}
                    />
                  </label>
                  <p className="inspector-note">0秒なら切り抜きの最初から、シーンの終わりまで出ます。</p>
                  <AnnotationWeightField
                    style={project.annotationStyle}
                    onChange={(style) =>
                      onChange((current) => ({
                        ...current,
                        annotationStyle: style,
                      }))
                    }
                  />
                  <label className="inspector-check">
                    <input
                      type="checkbox"
                      checked={scene.aimZoom?.enabled ?? false}
                      onChange={(event) => {
                        if (event.target.checked) {
                          patchScene(scene.sceneKey, {
                            aimZoom: scene.aimZoom
                              ? { ...scene.aimZoom, enabled: true }
                              : defaultSceneAimZoom({
                                  x: scene.aimMarker?.x ?? 0.5,
                                  y: scene.aimMarker?.y ?? 0.5,
                                }),
                          });
                          return;
                        }
                        if (scene.aimZoom) patchScene(scene.sceneKey, { aimZoom: { ...scene.aimZoom, enabled: false } });
                      }}
                    />
                    ズーム枠
                  </label>
                  {scene.aimZoom?.enabled && (
                    <>
                      <label>
                        倍率
                        <select
                          aria-label="動画ズームの倍率"
                          value={scene.aimZoom.zoom}
                          onChange={(event) => {
                            const zoom = Number(event.target.value);
                            if (zoom !== 3 && zoom !== 4 && zoom !== 6) return;
                            patchScene(scene.sceneKey, { aimZoom: { ...scene.aimZoom!, zoom } });
                          }}
                        >
                          <option value={3}>×3</option>
                          <option value={4}>×4</option>
                          <option value={6}>×6</option>
                        </select>
                      </label>
                      <label>
                        大きさ
                        <select
                          aria-label="動画ズームの大きさ"
                          value={scene.aimZoom.size}
                          onChange={(event) => {
                            const size = event.target.value;
                            if ((size !== 's' && size !== 'm' && size !== 'l') || !scene.aimZoom) return;
                            const width = VIDEO_AIM_FRAME.width;
                            const height = VIDEO_AIM_FRAME.height;
                            const oldSide = width * VIDEO_AIM_ZOOM_RATIO[scene.aimZoom.size];
                            const newSide = width * VIDEO_AIM_ZOOM_RATIO[size];
                            const chrome = zoomChromeThickness(
                              getAnnotationStyle(annotationStyleOf(project.annotationStyle), width),
                            );
                            const next = clampVideoAimZoomOrigin(
                              {
                                x: scene.aimZoom.x * width + (oldSide - newSide) / 2,
                                y: scene.aimZoom.y * height + (oldSide - newSide) / 2,
                              },
                              size,
                              chrome,
                            );
                            patchScene(scene.sceneKey, { aimZoom: { ...scene.aimZoom, size, x: next.x, y: next.y } });
                          }}
                        >
                          <option value="s">小</option>
                          <option value="m">中</option>
                          <option value="l">大</option>
                        </select>
                      </label>
                      <label>
                        枠 X
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.001}
                          aria-label="ズーム枠 X"
                          value={scene.aimZoom.x}
                          onChange={(event) =>
                            patchScene(scene.sceneKey, { aimZoom: { ...scene.aimZoom!, x: Number(event.target.value) } })
                          }
                        />
                      </label>
                      <label>
                        枠 Y
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.001}
                          aria-label="ズーム枠 Y"
                          value={scene.aimZoom.y}
                          onChange={(event) =>
                            patchScene(scene.sceneKey, { aimZoom: { ...scene.aimZoom!, y: Number(event.target.value) } })
                          }
                        />
                      </label>
                      <p className="inspector-note">位置はガイドの切り抜き上でもドラッグと矢印キーで動かせます。</p>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
      {caption && <CaptionSurfaceFields project={project} caption={caption} onChange={onChange} />}
      {resolved.kind === 'bgm' && (
        <div className="inspector-fields">
          <p className="inspector-kicker">BGM</p>
          {bgmTrack ? (
            <>
              <p>{bgmTrack.title}</p>
              <p className="inspector-note">
                {SOURCE_LABEL[bgmTrack.source]} · {bgmTrack.licenseStatus === 'confirmed' ? 'ライセンス確認済み' : 'ライセンス未確認'}
              </p>
            </>
          ) : (
            <p className="inspector-note">曲が未設定です。音源一覧から A2 へドロップできます。</p>
          )}
          {bgm && (
            <>
              <BgmGainFields project={project} onChange={onChange} />
              <p className="inspector-note">BGMの尺は映像の長さに合わせて自動で伸び縮みします。</p>
              <label>
                動画内の開始位置
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={bgm.start}
                  onChange={(event) =>
                    onChange((current) =>
                      current.audio.bgm
                        ? {
                            ...current,
                            audio: {
                              ...current.audio,
                              bgm: { ...current.audio.bgm, start: Math.max(0, Number(event.target.value)) },
                            },
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                曲のどこから流すか
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={bgm.offset}
                  onChange={(event) =>
                    onChange((current) =>
                      current.audio.bgm
                        ? {
                            ...current,
                            audio: {
                              ...current.audio,
                              bgm: { ...current.audio.bgm, offset: Math.max(0, Number(event.target.value)) },
                            },
                          }
                        : current,
                    )
                  }
                />
              </label>
              <div className="inspector-pair">
                <label>
                  フェードイン
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={bgm.fadeIn}
                    onChange={(event) =>
                      onChange((current) =>
                        current.audio.bgm
                          ? {
                              ...current,
                              audio: {
                                ...current.audio,
                                bgm: { ...current.audio.bgm, fadeIn: Math.max(0, Number(event.target.value)) },
                              },
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <label>
                  フェードアウト
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={bgm.fadeOut}
                    onChange={(event) =>
                      onChange((current) =>
                        current.audio.bgm
                          ? {
                              ...current,
                              audio: {
                                ...current.audio,
                                bgm: { ...current.audio.bgm, fadeOut: Math.max(0, Number(event.target.value)) },
                              },
                            }
                          : current,
                      )
                    }
                  />
                </label>
              </div>
              <label className="inspector-check">
                <input
                  type="checkbox"
                  checked={bgm.ducking}
                  onChange={(event) =>
                    onChange((current) =>
                      current.audio.bgm
                        ? {
                            ...current,
                            audio: {
                              ...current.audio,
                              bgm: { ...current.audio.bgm, ducking: event.target.checked },
                            },
                          }
                        : current,
                    )
                  }
                />
                シーンごとの既定音量でダッキング
              </label>
            </>
          )}
        </div>
      )}
      {effect && (
        <div className="inspector-fields">
          <p className="inspector-kicker">{effect.label}</p>
          <label>
            音源
            <select
              value={effect.audioTrackId ?? ''}
              onChange={(event) =>
                onEditTimeline((current) => ({
                  ...current,
                  effects: current.effects.map((item) =>
                    item.id === effect.id ? { ...item, audioTrackId: event.target.value || null } : item,
                  ),
                }))
              }
            >
              <option value="">未設定</option>
              {tracks
                .filter((track) => track.kind === 'se')
                .map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="inspector-pair">
            <label>
              位置（秒）
              <input
                type="number"
                min={0}
                step={0.1}
                value={effect.start}
                onChange={(event) =>
                  onEditTimeline((current) => ({
                    ...current,
                    effects: current.effects.map((item) =>
                      item.id === effect.id ? { ...item, start: Math.max(0, Number(event.target.value)) } : item,
                    ),
                  }))
                }
              />
            </label>
            <label>
              音量
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={effect.volume}
                onChange={(event) =>
                  onEditTimeline((current) => ({
                    ...current,
                    effects: current.effects.map((item) =>
                      item.id === effect.id ? { ...item, volume: Number(event.target.value) } : item,
                    ),
                  }))
                }
              />
            </label>
          </div>
          <p className="inspector-note">Delete で削除します。</p>
        </div>
      )}
      {point && resolved.kind === 'volume' && (
        <div className="inspector-fields">
          <p className="inspector-kicker">{resolved.channel === 'game' ? 'ゲーム音の点' : 'BGMの点'}</p>
          {resolved.channel === 'bgm' && <BgmGainFields project={project} onChange={onChange} />}
          <label>
            時刻（秒）
            <input readOnly value={point.time.toFixed(2)} />
          </label>
          <label>
            {resolved.channel === 'game' ? 'この点のゲーム音' : 'この点のBGM（個別）'}
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={resolved.channel === 'game' ? point.game : point.bgm}
              onChange={(event) => {
                const channel = resolved.kind === 'volume' ? resolved.channel : 'game';
                const value = Number(event.target.value);
                onEditTimeline(setVolumePoint(activeTimeline(project), point.id, channel, value));
              }}
            />
          </label>
          {resolved.channel === 'bgm' && (
            <p className="inspector-note">
              実際のBGMは 個別 {point.bgm.toFixed(2)} × 全体{Math.round((project.audio.bgm?.gain ?? 0.02) * 100)}%
              ＝ {(point.bgm * (project.audio.bgm?.gain ?? 0.02)).toFixed(2)} です。
            </p>
          )}
          <p className="inspector-note">Delete で削除します。</p>
        </div>
      )}
        </>
      )}
    </aside>
  );
};
