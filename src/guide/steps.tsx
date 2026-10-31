import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { LineupShortStandard } from '../../remotion/LineupShortStandard';
import { withAimMarker } from '../../shared/aim-marker';
import { ANNOTATION_FRAME_WIDTH, annotationStyleOf, getAnnotationStyle, zoomChromeThickness } from '../../shared/annotation-style';
import { AnnotationWeightField } from '../AnnotationWeightField';
import { MarkerAxisControl } from '../MarkerAxisControl';
import { AimMarker, AnnotationDim } from '../../remotion/AnnotationMarks';
import { thumbnailIconWarning } from '../../shared/thumbnail';
import {
  FOCUS_CROP_ZOOM,
  focusCropCenterYOf,
  focusCropZoomOf,
  focusFrameOf,
  focusOutsideDetail,
  resolveFocusCrop,
  roundFocusZoom,
  sceneFocusEffects,
} from '../../shared/layout-focus';
import {
  THUMB_FOCUS,
  focusFrameSize,
  focusUpscale,
  resolveFocusFrame,
  resolveThumbCrop,
  thumbnailFocusOf,
  thumbnailLayoutOf,
  thumbnailZoomOf,
} from '../../shared/thumbnail-focus';
import { ThumbnailLayoutSwitch, ThumbnailStage, type ThumbSurface } from '../ThumbnailStage';
import { ThumbnailFrameControls } from '../ThumbnailFrameControls';
import { bounceChargeLabel, bounceChargeOptions } from '../../shared/bounce-charge';
import {
  applyDefaultVolumes,
  captionMetrics,
  assetFileName,
  cardCandidates,
  compositionBlocks,
  omitDemoScene,
  removeVideoAsset,
  retargetSceneVideo,
  defaultPostDate,
  exportContentStamp,
  fromDateTimeLocal,
  guessLineupFromFileName,
  licenseSummary,
  applyPublishingMemo,
  markPublishingEdited,
  guideStepAfter,
  guideStepNumber,
  reviewItems,
  sceneGuideCopy,
  sceneHasRange,
  toDateTimeLocal,
  trimScenes,
  videosOf,
  type GuideStepId,
} from '../../shared/guide';
import {
  CTA_TEXT,
  DELIVERY_PRESET_ORDER,
  DELIVERY_PRESETS,
  hasClutchVaultUrl,
  isClutchVaultUrl,
  platformsFor,
  videoLanguagesFor,
  type DeliveryPresetId,
} from '../../shared/delivery-presets';
import { presetOutputs } from '../../shared/guide';
import { HandoffPanel } from '../analytics/HandoffPanel';
import { copyForJob, guessBasename, jobsForPresets, trackingFor } from '../../shared/export-copy';
import { prepareXPost } from '../../shared/x-post';
import { AI_ERROR_MESSAGE, type AiHandoff, type PublishingTranslation } from '../../shared/ai';
import {
  HOOK_PATTERNS,
  applyPublishingTranslation,
  koreanTitleUsesEnglishHook,
  publishingTranslationHandEdited,
  publishingTranslationLanguages,
  publishingTranslationStale,
  titleIssues,
  type PublishingTranslationField,
} from '../../shared/production';
import type { AudioTrack } from '../../shared/schema/audio';
import type { AudioUsageRecord } from '../../shared/ipc';
import { defaultCardAimZoom, defaultCtaCaption, type AnnotationStyle, type Caption, type CardAimZoom, type Language, type Project, type Scene } from '../../shared/schema/project';
import { aimZoomBox, aimZoomSurface, cardAimPoint, clampVideoAimZoomOrigin, defaultSceneAimZoom, nudgeCardAimPoint, resolveAimZoomFor, resolveVideoAimZoom, VIDEO_AIM_FRAME, VIDEO_AIM_ZOOM_RATIO } from '../../shared/aim-zoom';
import {
  normalizedStillFocus,
  panStillFocus,
  stillFocusAxes,
  stillFocusOf,
  stillObjectPosition,
  stillPreviewFrame,
  type CardStillRole,
  type StillFocus,
} from '../../shared/still-focus';
import { AimZoomChrome } from '../../remotion/AimZoomChrome';
import { WordingIdeas } from './WordingIdeas';
import type { SceneKey } from '../../shared/schema/project-keys';
import {
  activeTimeline,
  applySceneOrder,
  applySceneCutDuration,
  builtinSceneDuration,
  clampSceneDuration,
  defaultBgmPlacement,
  defaultLoopRange,
  playedSourceWindow,
  rangeForSceneDuration,
  rangeForSceneDurationFromOut,
  sceneDurationLimits,
  sceneItemDuration,
} from '../../shared/timeline';
import { CTA_DESIGN_OPTIONS, type CtaDesign } from '../../shared/cta-design';
import {
  likeCtaActive,
  likeCtaFitWarning,
  resolveCtaDesign,
  resolveLikeCtaText,
  resolveS4CtaPurpose,
  LIKE_CTA_COPY,
  S4_CTA_COPY,
  type S4CtaPurpose,
  type S4CtaText,
  type S4LikeCtaText,
} from '../../shared/s4-cta';
import {
  BUILTIN_VIDEO_STRUCTURE_TEMPLATES,
  type VideoStructureTemplate,
} from '../../shared/video-structure';
import { useStudioStore } from '../store';
import {
  THROW_TYPE_ENCODING,
  THROW_TYPE_LABELS,
  getAbilityOptionLabel,
  getAgentOptionLabel,
  getCanonicalAbilityId,
  getCanonicalAgentId,
  getLineupAbilities,
  getMapOptionLabel,
  getMapSites,
  getThrowTypeOptions,
  isSovaChargeAbility,
  valorantMaster,
  type ThrowTypeId,
} from '../valorantMaster';
import {
  getBgmPreviewTrackId,
  getBgmPreviewVolume,
  playBgmPreview,
  setBgmPreviewVolume,
  stopBgmPreview,
  subscribeBgmPreview,
} from './bgm-preview';
import { mediaUrl } from './media';
import { subscribeSourcePreviewStop } from './source-preview';

export type TrimHandles = {
  setIn: () => void;
  setOut: () => void;
  confirm: () => void;
  nudgeCrop: ((axis: 'x' | 'y', delta: number) => void) | null;
};

const SCENE_NAME: Record<SceneKey, string> = {
  hook: 'S1 フック',
  stand: 'S2 立ち位置',
  aim: 'S3 狙い',
  throw: 'S4 発動',
  card: 'S5 カード',
  demo: 'S6 デモ',
  loop: 'S7 ループ',
};

const update = (recipe: (project: Project) => Project): void => {
  useStudioStore.getState().updateProject(recipe);
};

const StepHead = ({ step, title, text }: { step: GuideStepId; title: string; text: string }) => (
  <header className="gd-step-head">
    <span className="gd-kicker">STEP {guideStepNumber(step)} / 10</span>
    <h1>{title}</h1>
    <p>{text}</p>
  </header>
);

const Checklist = ({ items }: { items: string[] }) => (
  <ul className="gd-checks-done">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

const monthDay = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
};

export const LineupStep = ({ project }: { project: Project }) => {
  const projects = useStudioStore((state) => state.projects);
  const source = projects.find((item) => item.id === project.inheritedFrom?.projectId);
  const inherited = new Set(project.inheritedFrom?.items ?? []);
  const agentId = getCanonicalAgentId(project.lineup.agent);
  const abilityId = getCanonicalAbilityId(agentId, project.lineup.ability);
  const charge = isSovaChargeAbility(agentId, abilityId);
  const sites = getMapSites(project.lineup.map);
  const abilities = getLineupAbilities(agentId);
  const label = bounceChargeLabel(project.lineup.bounce ?? 0, project.lineup.charge ?? 0, project.lineup.crouch);
  const throwOptions = getThrowTypeOptions(agentId, abilityId);
  const selectedThrow =
    throwOptions.find((item) => THROW_TYPE_LABELS[item].ja === project.lineup.throwType.ja) ??
    throwOptions[0] ??
    'normal';

  const intro = source
    ? `テロップの変数・カードの見出し・ファイル名に使います。${source.title}（${monthDay(source.updatedAt)}）から引き継いだ項目は入力済みです`
    : 'テロップの変数・カードの見出し・ファイル名に使います。';
  const throwHint = charge
    ? `エージェントとアビリティに合わせて入力欄が変わります（${getAgentOptionLabel(agentId)}のチャージ系）`
    : 'エージェントとアビリティに合わせて入力欄が変わります';
  const required = [
    ['マップ', Boolean(project.lineup.map.trim())],
    ['サイト', Boolean(project.lineup.site)],
    ['攻守', Boolean(project.lineup.side)],
    ['エージェント', Boolean(project.lineup.agent.trim())],
    ['アビリティ', Boolean(project.lineup.ability.trim())],
  ] as const;
  const englishReady = Boolean(
    project.lineup.standDescription.en.trim() && project.lineup.aimDescription.en.trim(),
  );

  return (
    <div className="gd-step gd-lineup">
      <StepHead step={1} title="定点情報" text={intro} />
      <div className="gd-grid-3">
        <label className="gd-field">
          マップ
          <select
            value={getCanonicalMap(project.lineup.map)}
            onChange={(event) =>
              update((current) => {
                current.lineup.map = event.target.value;
                const nextSites = getMapSites(event.target.value);
                if (!nextSites.includes(current.lineup.site)) current.lineup.site = nextSites[0] ?? 'A';
                return current;
              })
            }
          >
            {valorantMaster.maps.map((map) => (
              <option key={map.id} value={map.id}>
                {getMapOptionLabel(map.id)}
              </option>
            ))}
          </select>
        </label>
        <div className="gd-field">
          サイト
          <div className="gd-seg is-grid4" role="group" aria-label="サイト">
            {(['A', 'B', 'C', 'Mid'] as const).map((site) => (
              <button
                key={site}
                type="button"
                disabled={!sites.includes(site)}
                className={project.lineup.site === site ? 'is-on' : ''}
                onClick={() =>
                  update((current) => {
                    current.lineup.site = site;
                    return current;
                  })
                }
              >
                {site}
              </button>
            ))}
          </div>
        </div>
        <div className="gd-field">
          攻守
          <div className="gd-seg is-grid2" role="group" aria-label="攻守">
            {(
              [
                ['attack', '攻め'],
                ['defense', '守り'],
              ] as const
            ).map(([side, text]) => (
              <button
                key={side}
                type="button"
                className={project.lineup.side === side ? 'is-on' : ''}
                onClick={() =>
                  update((current) => {
                    current.lineup.side = side;
                    return current;
                  })
                }
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        <label className="gd-field">
          <span>エージェント {inherited.has('agent') && <em>（引き継ぎ）</em>}</span>
          <select
            value={agentId}
            onChange={(event) =>
              update((current) => {
                current.lineup.agent = event.target.value;
                const nextAbility = getLineupAbilities(event.target.value)[0];
                current.lineup.ability = nextAbility?.id ?? '';
                return current;
              })
            }
          >
            {valorantMaster.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {getAgentOptionLabel(agent.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="gd-field">
          <span>アビリティ {inherited.has('agent') && <em>（引き継ぎ）</em>}</span>
          <select
            value={abilityId}
            onChange={(event) =>
              update((current) => {
                current.lineup.ability = event.target.value;
                return current;
              })
            }
          >
            {abilities.map((ability) => (
              <option key={ability.id} value={ability.id}>
                {getAbilityOptionLabel(agentId, ability.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <section className="gd-panel">
        <div className="gd-panel-title">
          <strong>投げ方</strong>
          <span className="gd-muted">{throwHint}</span>
        </div>
        {charge ? (
          <div className="gd-throw">
            <div className="gd-field">
              バウンス
              <div className="gd-seg is-count" role="group" aria-label="バウンス">
                {[0, 1, 2].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={(project.lineup.bounce ?? 0) === value ? 'is-on' : ''}
                    onClick={() =>
                      update((current) => {
                        current.lineup.bounce = value;
                        current.lineup.throwType = bounceChargeLabel(value, current.lineup.charge ?? 0, current.lineup.crouch);
                        return current;
                      })
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div className="gd-field">
              チャージ
              <div className="gd-seg is-count" role="group" aria-label="チャージ">
                {[0, 1, 2, 3].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={(project.lineup.charge ?? 0) === value ? 'is-on' : ''}
                    onClick={() =>
                      update((current) => {
                        current.lineup.charge = value;
                        current.lineup.throwType = bounceChargeLabel(current.lineup.bounce ?? 0, value, current.lineup.crouch);
                        return current;
                      })
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <label className="gd-crouch">
              <input
                type="checkbox"
                checked={project.lineup.crouch}
                onChange={(event) =>
                  update((current) => {
                    current.lineup.crouch = event.target.checked;
                    current.lineup.throwType = bounceChargeLabel(
                      current.lineup.bounce ?? 0,
                      current.lineup.charge ?? 0,
                      event.target.checked,
                    );
                    return current;
                  })
                }
              />
              しゃがみ
            </label>
            <span className="gd-throw-readout">
              表示：<strong>{label.ja}</strong>
            </span>
          </div>
        ) : (
          <div className="gd-seg">
            {throwOptions.map((item) => (
              <button
                key={item}
                type="button"
                className={selectedThrow === item ? 'is-on' : ''}
                onClick={() =>
                  update((current) => {
                    current.lineup.throwType = THROW_TYPE_LABELS[item];
                    if (item !== 'leftClick') {
                      current.lineup.charge = THROW_TYPE_ENCODING[item].charge;
                      current.lineup.bounce = THROW_TYPE_ENCODING[item].bounce;
                    }
                    return current;
                  })
                }
              >
                {THROW_TYPE_LABELS[item].ja}
              </button>
            ))}
          </div>
        )}
        {charge && <span className="gd-sr">{bounceChargeOptions(project.lineup.crouch).length}</span>}
      </section>
      <div className="gd-bilingual">
        <span />
        <span className="gd-bilingual-head">日本語</span>
        <span className="gd-bilingual-head">English</span>
        <span className="gd-bilingual-label">立ち位置の説明</span>
        <textarea
          aria-label="立ち位置の説明（日本語）"
          value={project.lineup.standDescription.ja}
          onChange={(event) =>
            update((current) => {
              current.lineup.standDescription.ja = event.target.value;
              return current;
            })
          }
        />
        <div>
          <textarea
            aria-label="立ち位置の説明（英語）"
            placeholder="英語の説明"
            className={project.lineup.standDescription.en.trim() ? '' : 'is-warn'}
            value={project.lineup.standDescription.en}
            onChange={(event) =>
              update((current) => {
                current.lineup.standDescription.en = event.target.value;
                return current;
              })
            }
          />
          {!project.lineup.standDescription.en.trim() && (
            <span className="gd-warn">英語が未入力です（英語版のテロップに使います）</span>
          )}
        </div>
        <span className="gd-bilingual-label">合わせ方の説明</span>
        <textarea
          aria-label="合わせ方の説明（日本語）"
          value={project.lineup.aimDescription.ja}
          onChange={(event) =>
            update((current) => {
              current.lineup.aimDescription.ja = event.target.value;
              return current;
            })
          }
        />
        <div>
          <textarea
            aria-label="合わせ方の説明（英語）"
            placeholder="英語の説明"
            className={project.lineup.aimDescription.en.trim() ? '' : 'is-warn'}
            value={project.lineup.aimDescription.en}
            onChange={(event) =>
              update((current) => {
                current.lineup.aimDescription.en = event.target.value;
                return current;
              })
            }
          />
          {!project.lineup.aimDescription.en.trim() && (
            <span className="gd-warn">英語が未入力です（英語版のテロップに使います）</span>
          )}
        </div>
      </div>
      <HandoffPanel project={project} />
      <section className="gd-done" aria-label="このステップの完了条件">
        <strong>完了条件</strong>
        {required.map(([name, ok]) => (
          <span key={name} className={ok ? 'is-ok' : 'is-idle'}>
            {ok ? `✓ ${name}` : name}
          </span>
        ))}
        <span className={englishReady ? 'is-ok' : 'is-warn'}>
          {englishReady ? '✓ 英語の説明' : '! 英語の説明（任意・推奨）'}
        </span>
      </section>
    </div>
  );
};

const getCanonicalMap = (value: string): string =>
  valorantMaster.maps.find((map) => map.id.toLowerCase() === value.toLowerCase())?.id ?? value;

export const VideoStep = ({
  project,
  onImport,
  onPreview,
}: {
  project: Project;
  onImport: () => void;
  onPreview?: () => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [structureTemplates, setStructureTemplates] = useState<VideoStructureTemplate[]>(
    BUILTIN_VIDEO_STRUCTURE_TEMPLATES,
  );
  const videos = videosOf(project);
  const pendingDelete = videos.find((asset) => asset.id === pendingDeleteId) ?? null;
  const base = videos[0];
  const guess = base ? guessLineupFromFileName(assetFileName(base)) : null;
  const matches =
    guess &&
    (!guess.map || guess.map.toLowerCase() === project.lineup.map.toLowerCase()) &&
    (!guess.site || guess.site === project.lineup.site) &&
    (!guess.side || guess.side === project.lineup.side);
  const differs = guess && !matches;
  const selectedStructureId =
    structureTemplates.find((template) => template.id === project.structureTemplateId)?.id ??
    structureTemplates.find(
      (template) =>
        template.sceneOrder.length === project.templateParams.sceneOrder.length &&
        template.sceneOrder.every(
          (sceneKey, index) => sceneKey === project.templateParams.sceneOrder[index],
        ),
    )?.id ??
    '';
  const sceneName = (sceneKey: SceneKey): string => SCENE_NAME[sceneKey];
  const sceneVideoName = (sceneKey: SceneKey): string | null => {
    const clip = project.clips.find(
      (item) => item.id === project.scenes.find((scene) => scene.sceneKey === sceneKey)?.clipId,
    );
    const asset = project.assets.find((item) => item.id === clip?.assetId);
    return asset ? assetFileName(asset) : null;
  };
  const assignment = (sceneKey: SceneKey, auto: boolean): { source: string; state: string; auto: boolean } => {
    if (sceneKey === 'card') return { source: '完成カード（手順4で作る）', state: '自動', auto: true };
    if (sceneKey === 'loop') {
      const name = sceneVideoName(sceneKey);
      return {
        source: name ?? 'S1 の直前',
        state: name ? '切り抜き済み' : auto ? '自動（S1の直前）' : '要切り抜き',
        auto: !name && auto,
      };
    }
    if (sceneKey === 'demo' && !sceneHasRange(project, sceneKey)) {
      return { source: '入れない', state: '任意', auto: true };
    }
    return {
      source: sceneVideoName(sceneKey) ?? (base ? assetFileName(base) : '未登録'),
      state: sceneHasRange(project, sceneKey) ? '切り抜き済み' : '要切り抜き',
      auto: false,
    };
  };
  const active = videos.find((asset) => asset.id === activeId) ?? null;

  const stopPreview = (): void => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setPlaying(false);
    setTime(0);
  };

  const startPreview = (id: string): void => {
    setPreviewError(null);
    stopBgmPreview();
    onPreview?.();
    if (activeId !== id) setTime(0);
    setActiveId(id);
    setPlaying(true);
  };

  const confirmDelete = (): void => {
    if (!pendingDelete) return;
    if (activeId === pendingDelete.id) {
      stopPreview();
      setActiveId(null);
    }
    update((current) => removeVideoAsset(current, pendingDelete.id));
    setPendingDeleteId(null);
  };

  useEffect(() => {
    if (activeId && !videosOf(project).some((asset) => asset.id === activeId)) {
      setActiveId(null);
      setPlaying(false);
      setTime(0);
    }
  }, [activeId, project]);

  useEffect(() => {
    let active = true;
    void window.studio
      .listVideoStructureTemplates()
      .then((templates) => {
        if (active) setStructureTemplates(templates);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onStop = (): void => {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
      setPlaying(false);
      setTime(0);
    };
    const unsubscribe = subscribeSourcePreviewStop(onStop);
    return () => {
      unsubscribe();
      videoRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playing) return;
    let cancelled = false;
    const start = (): void => {
      if (cancelled) return;
      void video.play().catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setPlaying(false);
        setPreviewError('この録画を再生できませんでした');
      });
    };
    if (video.readyState >= 2) start();
    else video.addEventListener('canplay', start, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener('canplay', start);
      video.pause();
    };
  }, [playing, activeId]);

  return (
    <div className="gd-step gd-videos-step">
      <StepHead
        step={2}
        title="動画選択"
        text="録画を1〜3本登録します。最初の1本を各シーンの基準にします。別の録画を使うシーンは、「切り抜き」で切り替えられます"
      />
      {active && (
        <div className="gd-video-stage">
          <div className="gd-video-stage-frame">
            <video
              ref={videoRef}
              key={active.id}
              src={mediaUrl(active.proxyPath ?? active.path)}
              playsInline
              preload="auto"
              onClick={() => (playing ? stopPreview() : startPreview(active.id))}
              onError={() => {
                setPlaying(false);
                setPreviewError('この録画を再生できませんでした');
              }}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onEnded={(event) => {
                event.currentTarget.currentTime = 0;
                setPlaying(false);
                setTime(0);
              }}
            />
          </div>
          <div className="gd-video-transport">
            <button
              type="button"
              className={playing ? 'gd-shot-play is-playing' : 'gd-shot-play'}
              aria-label={playing ? `${assetFileName(active)} を停止` : `${assetFileName(active)} を再生`}
              onClick={() => (playing ? stopPreview() : startPreview(active.id))}
            >
              {playing ? '停止' : '再生'}
            </button>
            <span className="gd-video-stage-name">{assetFileName(active)}</span>
            <span className="gd-mono">
              {formatClock(time)} / {formatClock(active.meta.duration ?? 0)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(active.meta.duration ?? 0, 0.1)}
            step={0.1}
            value={Math.min(time, active.meta.duration ?? 0)}
            aria-label="再生位置"
            onChange={(event) => {
              const next = Number(event.target.value);
              if (videoRef.current) videoRef.current.currentTime = next;
              setTime(next);
            }}
          />
          {previewError && <span className="gd-warn">{previewError}</span>}
        </div>
      )}
      <div className="gd-videos">
        {videos.map((asset, index) => {
          const previewing = active?.id === asset.id;
          return (
          <article key={asset.id} className={previewing ? 'gd-video-card is-preview' : 'gd-video-card'}>
            <div className="gd-video-shot">
              <video
                src={mediaUrl(asset.proxyPath ?? asset.path)}
                muted
                playsInline
                preload="metadata"
                onClick={() => (previewing && playing ? stopPreview() : startPreview(asset.id))}
              />
              <button
                type="button"
                className={previewing && playing ? 'gd-shot-play is-playing' : 'gd-shot-play'}
                aria-label={previewing && playing ? `${assetFileName(asset)} を停止` : `${assetFileName(asset)} を再生`}
                onClick={() => (previewing && playing ? stopPreview() : startPreview(asset.id))}
              >
                {previewing && playing ? '停止' : '再生'}
              </button>
              <span>{badgeClock(asset.meta.duration ?? 0)}</span>
            </div>
            {index === 0 && <span className="gd-video-base">基準の動画</span>}
            <div className="gd-video-card-head">
              <span className="gd-video-name" title={assetFileName(asset)}>{assetFileName(asset)}</span>
              <button
                type="button"
                className="gd-video-delete"
                aria-label={`${assetFileName(asset)} を削除`}
                onClick={() => setPendingDeleteId(asset.id)}
              >
                削除
              </button>
            </div>
            <span className="gd-muted">{mediaSpec(asset.meta)}</span>
          </article>
          );
        })}
        {videos.length < 3 && (
          <button type="button" className="gd-drop" onClick={onImport}>
            <strong>＋ 録画を追加</strong>
            <span>
              {videos.length === 0
                ? 'この動画を各シーンの基準にします'
                : '追加した動画は、切り抜き画面でシーンごとに切り替えられます'}
            </span>
            <span>ドロップまたはクリックで選択</span>
          </button>
        )}
      </div>
      {guess && base && (
        <div className={`gd-banner ${differs ? 'is-warn' : 'is-ok'}`}>
          <span>
            ファイル名 <span className="gd-mono">{assetFileName(base)}</span> から「{guess.label}」と読み取りました。
            {matches ? '定点情報と一致しています' : '定点情報と違います。'}
          </span>
          {differs && (
            <button
              type="button"
              className="gd-mini"
              onClick={() =>
                update((current) => {
                  if (guess.map) current.lineup.map = guess.map;
                  if (guess.site) current.lineup.site = guess.site;
                  if (guess.side) current.lineup.side = guess.side;
                  return current;
                })
              }
            >
              定点情報に反映する
            </button>
          )}
        </div>
      )}
      <section className="gd-assign-block">
        <strong>動画の構成パターン</strong>
        <label className="gd-field">
          使用するテンプレート
          <select
            value={selectedStructureId}
            onChange={(event) => {
              const template = structureTemplates.find(
                (item) => item.id === event.target.value,
              );
              if (!template) return;
              update((current) =>
                applySceneOrder(current, template.sceneOrder, template.id, template.ctaDesign),
              );
            }}
          >
            <option value="">現在のカスタム構成</option>
            {structureTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gd-field">
          CTAデザイン
          <select
            aria-label="CTAデザイン"
            value={resolveCtaDesign(project)}
            onChange={(event) => {
              const ctaDesign = event.target.value as CtaDesign;
              update((current) => ({
                ...current,
                templateParams: { ...current.templateParams, ctaDesign },
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
        <p className="gd-muted">
          {CTA_DESIGN_OPTIONS.find((option) => option.id === resolveCtaDesign(project))?.detail}
          。構成を変えると、そのテンプレートのCTAに切り替わります。シーンの追加・並べ替えは「詳細編集」の構成パターンから行えます。
        </p>
      </section>
      <section className="gd-assign-block">
        <strong>シーンで使う動画</strong>
        <div className="gd-assign-table">
          {compositionBlocks(project).map((block, index) => {
            const row = assignment(block.sceneKey, block.auto);
            return (
              <div key={`${block.sceneKey}-${index}`}>
                <span className="is-name">{sceneName(block.sceneKey)}</span>
                <span className="is-src">{row.source}</span>
                <span className={row.auto || row.state === '切り抜き済み' ? 'is-state is-ok' : 'is-state'}>
                  {row.state}
                </span>
              </div>
            );
          })}
        </div>
        <p className="gd-muted">別の動画へ変えるシーンは、切り抜き画面で切り替えられます。</p>
      </section>
      <section className="gd-done" aria-label="このステップの完了条件">
        <strong>完了条件</strong>
        <span className={videos.length > 0 ? 'is-ok' : 'is-idle'}>
          {videos.length > 0 ? '✓ 動画が1本以上' : '動画が1本以上'}
        </span>
        <span className={sceneHasRange(project, 'demo') ? 'is-ok' : 'is-warn'}>
          {sceneHasRange(project, 'demo')
            ? '✓ 実戦デモ'
            : '! 実戦デモ（任意。ない場合は S6 を入れません）'}
        </span>
      </section>
      {pendingDelete && (
        <div className="confirm-backdrop" onClick={() => setPendingDeleteId(null)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-video-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">DELETE VIDEO</span>
            <h2 id="delete-video-title">この動画を削除しますか？</h2>
            <p>
              「{assetFileName(pendingDelete)}」をプロジェクトから削除します。この動画を使った切り抜きとカード用画像の登録も解除されます。選択元の動画ファイルは削除されません。
            </p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setPendingDeleteId(null)}>キャンセル</button>
              <button type="button" className="primary" onClick={confirmDelete}>削除する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const badgeClock = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.min(59, Math.round(safe - minutes * 60));
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

const mediaSpec = (meta: { width?: number; height?: number; fps?: number; codec?: string }): string => {
  const size = meta.width && meta.height ? `${meta.width}×${meta.height}` : '—';
  const fps = meta.fps ? `${Math.round(meta.fps)}fps` : '—fps';
  const codec = meta.codec?.toLowerCase() ?? '';
  const codecLabel = codec.includes('265') || codec.includes('hevc')
    ? 'H.265'
    : codec.includes('264') || codec.includes('avc')
      ? 'H.264'
      : meta.codec?.toUpperCase();
  return codecLabel ? `${size} · ${fps} · ${codecLabel}` : `${size} · ${fps}`;
};

const formatClock = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
};

const movedTrimRange = (
  drag: { kind: 'move' | 'in' | 'out'; startIn: number; startOut: number; startPlayhead: number },
  delta: number,
  duration: number,
): { in: number; out: number; playhead: number } => {
  const span = drag.startOut - drag.startIn;
  if (drag.kind === 'in') {
    const next = rangeForSceneDuration(drag.startIn + delta, span, duration);
    return { ...next, playhead: next.in };
  }
  if (drag.kind === 'out') {
    const next = rangeForSceneDurationFromOut(drag.startOut + delta, span, duration);
    return { ...next, playhead: next.out };
  }
  let nextIn = drag.startIn + delta;
  let nextOut = drag.startOut + delta;
  if (nextIn < 0) {
    nextIn = 0;
    nextOut = Math.min(duration, span);
  } else if (nextOut > duration) {
    nextOut = duration;
    nextIn = Math.max(0, duration - span);
  }
  const shift = nextIn - drag.startIn;
  const playhead = Math.min(nextOut, Math.max(nextIn, drag.startPlayhead + shift));
  return { in: nextIn, out: nextOut, playhead };
};

const roundTrimTime = (value: number): number => Math.round(value * 100) / 100;

const TrimTimeField = ({
  label,
  kbd,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
  onCommitFromPlayhead,
}: {
  label: string;
  kbd?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (next: number) => void;
  onCommitFromPlayhead?: () => void;
}) => (
  <div className="gd-trim-time">
    {kbd && onCommitFromPlayhead ? (
      <button type="button" className="gd-io" disabled={disabled} onClick={onCommitFromPlayhead}>
        <kbd>{kbd}</kbd>
        {label}
      </button>
    ) : (
      <span className="gd-trim-time-label">{label}</span>
    )}
    <button
      type="button"
      className="gd-nudge"
      aria-label={`${label}を戻す`}
      disabled={disabled || value <= min + 1e-6}
      onClick={() => onChange(roundTrimTime(value - step))}
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
      disabled={disabled}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
    <button
      type="button"
      className="gd-nudge"
      aria-label={`${label}を進める`}
      disabled={disabled || value >= max - 1e-6}
      onClick={() => onChange(roundTrimTime(value + step))}
    >
      ›
    </button>
  </div>
);

const clampAimAppear = (project: Project, sceneKey: SceneKey, span: number): void => {
  const marker = project.scenes.find((item) => item.sceneKey === sceneKey)?.aimMarker;
  if (!marker || marker.at <= span) return;
  marker.at = Math.max(0, span);
};

const PREVIEW_BASE_WIDTH = 640;

const VideoAimZoomLayer = ({
  project,
  scene,
  cropLeft,
  cropW,
  previewWidth,
  videoRef,
  waiting,
  sourceUrl,
}: {
  project: Project;
  scene: Scene;
  cropLeft: number;
  cropW: number;
  previewWidth: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  waiting: boolean;
  sourceUrl: string;
}) => {
  const zoomVideoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);
  const zoom = scene.aimZoom;
  const marker = scene.aimMarker;
  useEffect(() => {
    const main = videoRef.current;
    const magnified = zoomVideoRef.current;
    if (!main || !magnified || !zoom?.enabled) return;
    const sync = (): void => {
      if (Math.abs(magnified.currentTime - main.currentTime) > 0.08) magnified.currentTime = main.currentTime;
      if (main.paused) magnified.pause();
      else void magnified.play().catch(() => undefined);
    };
    sync();
    main.addEventListener('timeupdate', sync);
    main.addEventListener('seeking', sync);
    main.addEventListener('seeked', sync);
    main.addEventListener('play', sync);
    main.addEventListener('pause', sync);
    return () => {
      main.removeEventListener('timeupdate', sync);
      main.removeEventListener('seeking', sync);
      main.removeEventListener('seeked', sync);
      main.removeEventListener('play', sync);
      main.removeEventListener('pause', sync);
    };
  }, [videoRef, zoom?.enabled, sourceUrl]);
  if (!zoom?.enabled || !marker) return null;
  const chrome = zoomChromeThickness(getAnnotationStyle(annotationStyleOf(project.annotationStyle), VIDEO_AIM_FRAME.width));
  const layout = resolveVideoAimZoom(zoom, { x: marker.x, y: marker.y }, chrome);
  const box = { width: VIDEO_AIM_FRAME.width, height: VIDEO_AIM_FRAME.height, labelHeight: 0, safeRight: VIDEO_AIM_FRAME.width - 72 };
  const scale = (previewWidth * cropW) / VIDEO_AIM_FRAME.width;
  const moveTo = (imageX: number, imageY: number): void => {
    update((current) => {
      const target = current.scenes.find((item) => item.sceneKey === scene.sceneKey);
      if (!target?.aimZoom?.enabled) return current;
      const next = clampVideoAimZoomOrigin({ x: imageX, y: imageY }, target.aimZoom.size, chrome);
      target.aimZoom.x = next.x;
      target.aimZoom.y = next.y;
      return current;
    });
  };
  return (
    <div
      style={{
        position: 'absolute',
        left: `${cropLeft * 100}%`,
        top: 0,
        width: `${cropW * 100}%`,
        height: '100%',
        zIndex: 4,
        pointerEvents: 'none',
        opacity: waiting ? 0.45 : 1,
      }}
    >
      <div style={{ width: box.width, height: box.height, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'relative' }}>
        <AimZoomChrome
          layout={layout}
          box={box}
          accent={project.templateParams.accent}
          language="ja"
          nativeImage
          style={annotationStyleOf(project.annotationStyle)}
          media={
            <video
              ref={zoomVideoRef}
              src={sourceUrl}
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${scene.cropCenterX * 100}% 50%` }}
            />
          }
        />
        <div
          className="gd-video-zoom-handle"
          tabIndex={0}
          role="slider"
          aria-label="ズーム枠。ドラッグで移動し、矢印キーで1ピクセル、Shiftで10ピクセル動かせます"
          aria-valuetext={`左 ${Math.round(layout.window.x)}、上 ${Math.round(layout.window.y)}`}
          style={{
            position: 'absolute',
            left: layout.window.x,
            top: layout.window.y,
            width: layout.window.size,
            height: layout.window.size,
            zIndex: 5,
            pointerEvents: 'auto',
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              pointerX: event.clientX,
              pointerY: event.clientY,
              originX: layout.window.x,
              originY: layout.window.y,
            };
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            if (!state || !event.currentTarget.hasPointerCapture(event.pointerId) || scale <= 0) return;
            moveTo(
              state.originX + (event.clientX - state.pointerX) / scale,
              state.originY + (event.clientY - state.pointerY) / scale,
            );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const axis =
              event.key === 'ArrowLeft' ? { x: -1, y: 0 }
              : event.key === 'ArrowRight' ? { x: 1, y: 0 }
              : event.key === 'ArrowUp' ? { x: 0, y: -1 }
              : event.key === 'ArrowDown' ? { x: 0, y: 1 }
              : null;
            if (!axis) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 10 : 1;
            update((current) => {
              const target = current.scenes.find((item) => item.sceneKey === scene.sceneKey);
              if (!target?.aimZoom?.enabled) return current;
              const next = clampVideoAimZoomOrigin(
                {
                  x: target.aimZoom.x * VIDEO_AIM_FRAME.width + axis.x * step,
                  y: target.aimZoom.y * VIDEO_AIM_FRAME.height + axis.y * step,
                },
                target.aimZoom.size,
                chrome,
              );
              target.aimZoom.x = next.x;
              target.aimZoom.y = next.y;
              return current;
            });
          }}
        />
      </div>
    </div>
  );
};

const nextPreviewScale = (current: number, delta: number): number =>
  Math.min(2.5, Math.max(0.75, Math.round((current + delta) * 4) / 4));

export const TrimStep = ({
  project,
  sceneKey,
  onSceneKey,
  handlesRef,
  onEditRange,
}: {
  project: Project;
  sceneKey: SceneKey;
  onSceneKey: (sceneKey: SceneKey) => void;
  handlesRef: RefObject<TrimHandles | null>;
  onEditRange: (sceneKey: SceneKey) => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playhead, setPlayhead] = useState(0);
  const [showFrameGuides, setShowFrameGuides] = useState(false);
  const [previewScale, setPreviewScale] = useState(1.5);
  const [savedDefaults, setSavedDefaults] = useState<Partial<Record<SceneKey, number>>>({});
  const [secondsDraft, setSecondsDraft] = useState('');
  const [emptyPick, setEmptyPick] = useState('');
  const secondsFocus = useRef(false);
  const tabs = trimScenes(project);
  const videos = videosOf(project);
  const emptyAsset = videos.find((item) => item.id === emptyPick) ?? videos[0];
  const scene = project.scenes.find((item) => item.sceneKey === sceneKey);
  const storedClip = project.clips.find((item) => item.id === scene?.clipId);
  const loopLead = sceneKey === 'loop' && !storedClip ? defaultLoopRange(project) : null;
  const clip =
    storedClip ??
    (loopLead
      ? { id: 'loop-before-hook', assetId: loopLead.assetId, in: loopLead.in, out: loopLead.out }
      : undefined);
  const asset = project.assets.find((item) => item.id === clip?.assetId);
  const copy = sceneGuideCopy(project, sceneKey);
  const duration = asset?.meta.duration ?? 0;
  const frame = 1 / project.templateParams.fps;
  const length = clip ? clip.out - clip.in : 0;
  const sceneLength = sceneKey === 'card' ? sceneItemDuration(project, sceneKey) : length;
  const lengthWarn = clip ? length < copy.min || length > copy.max : false;

  const seek = (seconds: number): void => {
    const next = Math.min(duration, Math.max(0, seconds));
    setPlayhead(next);
    if (videoRef.current) videoRef.current.currentTime = next;
  };

  const beginRangeDrag = (
    kind: 'move' | 'in' | 'out',
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (!clip || duration <= 0 || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    rangeDrag.current = {
      kind,
      pointer: event.clientX,
      startIn: clip.in,
      startOut: clip.out,
      startPlayhead: playhead,
    };
  };

  const moveRangeDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = rangeDrag.current;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!drag || !bounds || bounds.width <= 0 || event.buttons !== 1) return;
    const delta = ((event.clientX - drag.pointer) / bounds.width) * duration;
    const next = movedTrimRange(drag, delta, duration);
    setRange({ in: next.in, out: next.out });
    seek(next.playhead);
  };

  const endRangeDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    rangeDrag.current = null;
  };

  const revertLoopToHook = (): void => {
    update((current) => {
      const loop = current.scenes.find((item) => item.sceneKey === 'loop');
      if (!loop?.clipId) return current;
      const clipId = loop.clipId;
      loop.clipId = undefined;
      if (!current.scenes.some((item) => item.clipId === clipId)) {
        current.clips = current.clips.filter((item) => item.id !== clipId);
      }
      if (current.timeline) {
        current.timeline.items = current.timeline.items.map((item) =>
          item.sceneKey === 'loop' ? { ...item, sourceOffset: 0 } : item,
        );
      }
      return current;
    });
  };

  const setRange = (range: { in: number; out: number }): void => {
    if (loopLead) {
      update((current) => {
        const loop = current.scenes.find((item) => item.sceneKey === 'loop');
        if (!loop || !(range.out > range.in)) return current;
        const id = crypto.randomUUID();
        current.clips.push({
          id,
          assetId: loopLead.assetId,
          in: range.in,
          out: range.out,
        });
        loop.clipId = id;
        clampAimAppear(current, sceneKey, range.out - range.in);
        return applySceneCutDuration(current, sceneKey, range.out - range.in);
      });
      return;
    }
    if (!clip) return;
    update((current) => {
      const target = current.clips.find((item) => item.id === clip.id);
      if (!target) return current;
      target.in = range.in;
      target.out = range.out;
      clampAimAppear(current, sceneKey, target.out - target.in);
      return applySceneCutDuration(current, sceneKey, target.out - target.in);
    });
  };

  const cutToSeconds = (raw: number): void => {
    if (!Number.isFinite(raw)) return;
    if (sceneKey === 'card' || loopLead) {
      update((current) => applySceneCutDuration(current, sceneKey, raw));
      return;
    }
    if (!clip) return;
    const media = Math.max(0.1, asset?.meta.duration ?? clip.out);
    const span = Math.min(clampSceneDuration(sceneKey, raw), media);
    const range = rangeForSceneDuration(clip.in, span, media);
    update((current) => {
      const target = current.clips.find((item) => item.id === clip.id);
      if (!target) return current;
      target.in = range.in;
      target.out = range.out;
      clampAimAppear(current, sceneKey, target.out - target.in);
      return applySceneCutDuration(current, sceneKey, target.out - target.in);
    });
  };

  const applyWindow = (range: { in: number; out: number }, playAt: number): void => {
    setRange(range);
    seek(playAt);
  };

  const slideIn = (nextIn: number): void => {
    if (!clip || !Number.isFinite(nextIn)) return;
    const media = Math.max(0.1, duration);
    const range = rangeForSceneDuration(nextIn, clip.out - clip.in, media);
    applyWindow(range, range.in);
  };

  const slideOut = (nextOut: number): void => {
    if (!clip || !Number.isFinite(nextOut)) return;
    const media = Math.max(0.1, duration);
    const range = rangeForSceneDurationFromOut(nextOut, clip.out - clip.in, media);
    applyWindow(range, range.out);
  };

  const savedDefault = savedDefaults[sceneKey] ?? builtinSceneDuration(sceneKey);
  const durationLimits = sceneDurationLimits(sceneKey);

  const goNextScene = (): void => {
    const index = tabs.indexOf(sceneKey as (typeof tabs)[number]);
    if (index < 0) return;
    const next = tabs[index + 1];
    if (next) onSceneKey(next);
  };

  const confirm = (): void => {
    goNextScene();
  };

  useEffect(() => {
    handlesRef.current = {
      setIn: () => {
        if (!clip) return;
        slideIn(playhead);
      },
      setOut: () => {
        if (!clip) return;
        slideOut(playhead);
      },
      confirm,
      nudgeCrop:
        scene?.layout916 === 'focus'
          ? (axis, delta) => {
              update((current) => {
                const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                if (!target) return current;
                if (axis === 'y') {
                  target.cropCenterY = Math.min(1, Math.max(0, focusCropCenterYOf(target) + delta));
                } else {
                  target.cropCenterX = Math.min(1, Math.max(0, target.cropCenterX + delta));
                }
                return current;
              });
            }
          : null,
    };
    return () => {
      handlesRef.current = null;
    };
  });

  useEffect(() => {
    if (clip) seek(clip.in);
  }, [clip?.id, clip?.assetId, loopLead?.in, loopLead?.out]);

  useEffect(() => {
    void window.studio.getSceneDurationDefaults().then(setSavedDefaults).catch(() => setSavedDefaults({}));
  }, []);

  useEffect(() => {
    if (secondsFocus.current) return;
    setSecondsDraft(
      sceneKey === 'card' || length > 0 ? sceneLength.toFixed(1) : savedDefault.toFixed(1),
    );
  }, [sceneKey, clip?.id, sceneLength, length, savedDefault]);

  const cropW = (9 / 16) / (16 / 9);
  const cropLeft = Math.min(1 - cropW, Math.max(0, (scene?.cropCenterX ?? 0.5) - cropW / 2));
  const sourceSize = focusFrameOf(asset?.meta.width, asset?.meta.height);
  const focusWindow = scene?.layout916 === 'focus' ? resolveFocusCrop(sourceSize, scene.cropCenterX, scene.cropZoom, scene.cropCenterY) : null;
  const shownCropLeft = focusWindow ? focusWindow.x / sourceSize.w : cropLeft;
  const shownCropW = focusWindow ? focusWindow.w / sourceSize.w : cropW;
  const shownCropTop = focusWindow ? focusWindow.y / sourceSize.h : 0;
  const shownCropH = focusWindow ? focusWindow.h / sourceSize.h : 1;
  const showCrop = scene?.layout916 === 'center-crop' || scene?.layout916 === 'focus';
  const previewWidth = PREVIEW_BASE_WIDTH * previewScale;
  const frameSpan = scene?.layout916 === 'center-crop' ? previewWidth * cropW : previewWidth;
  const ringScale = frameSpan / ANNOTATION_FRAME_WIDTH;
  const cropDrag = useRef<{ pointerX: number; pointerY: number; centerX: number; centerY: number; moved: boolean } | null>(null);
  const rangeDrag = useRef<{
    kind: 'move' | 'in' | 'out';
    pointer: number;
    startIn: number;
    startOut: number;
    startPlayhead: number;
  } | null>(null);
  const nextKey = tabs[tabs.indexOf(sceneKey as (typeof tabs)[number]) + 1];
  const nextCode = nextKey ? sceneGuideCopy(project, nextKey).title.split(' ')[0] : '';
  const timelineItems = activeTimeline(project).items;
  const focusWarning =
    scene?.layout916 === 'focus'
      ? focusOutsideDetail(
          sourceSize,
          scene.cropCenterX,
          sceneFocusEffects(
            scene,
            timelineItems.find((item) => item.sceneKey === sceneKey)?.arrow ?? null,
          ),
          scene.cropZoom,
          scene.cropCenterY,
        )
      : null;

  const placeMarker = (bounds: DOMRect, clientX: number, clientY: number): void => {
    if (!scene?.aimMarker?.enabled || bounds.width <= 0 || bounds.height <= 0) return;
    const x = (clientX - bounds.left) / bounds.width;
    const y = (clientY - bounds.top) / bounds.height;
    const markerX =
      scene.layout916 === 'center-crop'
        ? Math.min(1, Math.max(0, (x - cropLeft) / cropW))
        : Math.min(1, Math.max(0, x));
    const markerY = Math.min(1, Math.max(0, y));
    update((current) => {
      const target = current.scenes.find((item) => item.sceneKey === sceneKey);
      if (!target?.aimMarker?.enabled) return current;
      target.aimMarker.x = markerX;
      target.aimMarker.y = markerY;
      return current;
    });
  };

  const setMarkerAxis = (axis: 'x' | 'y', value: number): void => {
    update((current) => {
      const target = current.scenes.find((item) => item.sceneKey === sceneKey);
      if (!target?.aimMarker?.enabled) return current;
      target.aimMarker[axis] = value;
      return current;
    });
  };

  const setAppearAt = (seconds: number): void => {
    if (!Number.isFinite(seconds)) return;
    const at = Math.min(Math.max(0, length), Math.max(0, seconds));
    update((current) => {
      const target = current.scenes.find((item) => item.sceneKey === sceneKey);
      if (!target?.aimMarker?.enabled) return current;
      target.aimMarker.at = at;
      return current;
    });
  };

  const appearAtPlayhead = (): void => {
    const raw = Math.max(0, playhead - (clip?.in ?? 0));
    setAppearAt(Math.round(raw * 100) / 100);
  };

  const markerAt = scene?.aimMarker?.at ?? 0;
  const markerWaiting = Boolean(clip && scene?.aimMarker?.enabled && playhead + 1e-4 < clip.in + markerAt);
  const hookClip = project.clips.find(
    (item) => item.id === project.scenes.find((entry) => entry.sceneKey === 'hook')?.clipId,
  );
  const loopEmptyCopy = !videos.length
    ? 'このシーンの元動画がありません。手順2で録画を追加してください。'
    : hookClip
      ? 'S1 の開始が早すぎて直前を取れないため、書き出しでは S1 と同じ映像を使います。'
      : 'S7 は S1 の開始直前を使います。先に S1 の範囲を決めてください。';

  const tabState = (key: SceneKey): { tone: string; status: string } => {
    if (key === 'card') {
      const seconds = sceneItemDuration(project, 'card');
      return key === sceneKey
        ? { tone: 'is-on', status: '編集中' }
        : { tone: 'is-set', status: `${seconds.toFixed(1)}s` };
    }
    if (key === sceneKey) return { tone: 'is-on', status: '編集中' };
    if (key === 'loop' && !sceneHasRange(project, 'loop')) {
      return defaultLoopRange(project)
        ? { tone: 'is-auto', status: 'S1の直前' }
        : { tone: 'is-empty', status: 'S1と同じ' };
    }
    if (key === 'demo' && !sceneHasRange(project, 'demo')) {
      return { tone: 'is-auto', status: '任意' };
    }
    if (sceneHasRange(project, key)) {
      const seconds = activeTimeline(project).items.find((item) => item.sceneKey === key)?.duration;
      return { tone: 'is-set', status: `✓ ${seconds?.toFixed(1) ?? '0.0'}s` };
    }
    return { tone: 'is-empty', status: '未設定' };
  };

  const videoChoice = (value: string, onChange: (assetId: string) => void) =>
    videos.length > 1 ? (
      <label className="gd-trim-video-pick">
        使用する動画
        <select
          value={value}
          aria-label={`${copy.title}で使う動画`}
          onChange={(event) => onChange(event.target.value)}
        >
          {videos.map((item, index) => (
            <option key={item.id} value={item.id}>
              {index === 0 ? `最初の動画 · ${assetFileName(item)}` : assetFileName(item)}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <div className="gd-step gd-trim">
      <header className="gd-trim-head">
        <div>
          <span className="gd-kicker">STEP 3 / 10</span>
          <h1>切り抜き</h1>
        </div>
        <p>シーンごとに範囲を決めます。尺を変えると長さが変わり、IN／OUT は同じ尺のまま動きます。I／O か数値のクリックでも動かせます。Enter で確定して次のシーンへ</p>
      </header>
      <div className="gd-scene-tabs" role="tablist" aria-label="シーン">
        {trimScenes(project).map((key) => {
          const info = sceneGuideCopy(project, key);
          const state = tabState(key);
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === sceneKey}
              className={state.tone}
              onClick={() => onSceneKey(key)}
            >
              {info.title}
              <span>{state.status}</span>
            </button>
          );
        })}
      </div>
      {sceneKey === 'card' ? (
        <>
          <div className="gd-trim-info">
            <span className="gd-trim-badge">{copy.title}</span>
            <p>
              {copy.body}。目安 <strong>{copy.target.toFixed(1)}秒</strong>（{copy.min}〜{copy.max}秒）
            </p>
          </div>
          <div className="gd-trim-seconds-row">
            <label className="gd-trim-seconds">
              表示秒数
              <input
                type="number"
                min={durationLimits.min}
                max={durationLimits.max}
                step={0.1}
                value={secondsDraft}
                aria-label={`${copy.title}の表示秒数`}
                onFocus={() => {
                  secondsFocus.current = true;
                }}
                onChange={(event) => setSecondsDraft(event.target.value)}
                onBlur={() => {
                  secondsFocus.current = false;
                  const next = Number(secondsDraft);
                  if (!Number.isFinite(next)) {
                    setSecondsDraft(sceneLength.toFixed(1));
                    return;
                  }
                  cutToSeconds(next);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  event.currentTarget.blur();
                }}
              />
            </label>
            <button type="button" className="gd-trim-default" onClick={() => cutToSeconds(savedDefault)}>
              デフォルト {savedDefault.toFixed(1)}秒にする
            </button>
            <button
              type="button"
              className="gd-trim-default"
              onClick={() => {
                const next = Number(secondsDraft);
                if (!Number.isFinite(next)) return;
                const seconds = clampSceneDuration(sceneKey, next);
                cutToSeconds(seconds);
                void window.studio
                  .setSceneDurationDefault(sceneKey, seconds)
                  .then(setSavedDefaults)
                  .catch((error: unknown) => {
                    useStudioStore.getState().setError(error instanceof Error ? error.message : String(error));
                  });
              }}
            >
              この秒数をデフォルトにする
            </button>
            <span className="gd-trim-src">保存済み {savedDefault.toFixed(1)}秒</span>
          </div>
          <div className="gd-trim-controls">
            <button type="button" className="gd-confirm-scene" onClick={confirm}>
              {nextCode ? `確定して ${nextCode} へ（Enter）` : '確定（Enter）'}
            </button>
          </div>
        </>
      ) : !clip || !asset || !scene ? (
        <div
          className={sceneKey === 'demo' ? 'gd-banner is-ok' : 'gd-banner is-warn'}
        >
          <span>
            {sceneKey === 'loop'
              ? loopEmptyCopy
              : sceneKey === 'demo'
                ? 'S6 は任意です。実戦の映像がなければ、このシーンを入れずに進められます。'
                : 'このシーンの元動画がありません。手順2で録画を追加してください。'}
          </span>
          {(sceneKey === 'loop' || sceneKey === 'demo') && emptyAsset && (
            <>
              {videoChoice(emptyAsset.id, setEmptyPick)}
              <button
                type="button"
                onClick={() => update((current) => retargetSceneVideo(current, sceneKey, emptyAsset.id))}
              >
                {sceneKey === 'loop' ? 'この動画で切る' : 'この動画から切り出す'}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="gd-trim-info">
            <span className="gd-trim-badge">{copy.title}</span>
            <p>
              {copy.body}。目安 <strong>{copy.target.toFixed(1)}秒</strong>（{copy.min}〜{copy.max}秒）
            </p>
            {videos.length > 1 ? (
              videoChoice(asset.id, (assetId) => {
                if (assetId !== asset.id) update((current) => retargetSceneVideo(current, sceneKey, assetId));
              })
            ) : (
              <span className="gd-trim-src">
                元の動画：<span className="gd-mono">{assetFileName(asset)}</span>
              </span>
            )}
            {sceneKey === 'loop' && storedClip && (
              <button type="button" className="gd-loop-revert" onClick={revertLoopToHook}>
                S1の直前に戻す
              </button>
            )}
            {sceneKey === 'loop' && loopLead && (
              <span className="gd-trim-src">
                終了 {loopLead.out.toFixed(2)}秒。S1 の開始より 0.01 秒前です
              </span>
            )}
            {sceneKey === 'demo' && (
              <button type="button" className="gd-loop-revert" onClick={() => update(omitDemoScene)}>
                S6 を入れない
              </button>
            )}
          </div>
          <div className="gd-trim-seconds-row">
            <label className="gd-trim-seconds">
              切り抜き秒数
              <input
                type="number"
                min={durationLimits.min}
                max={durationLimits.max}
                step={0.1}
                value={secondsDraft}
                aria-label={`${copy.title}の切り抜き秒数`}
                onFocus={() => {
                  secondsFocus.current = true;
                }}
                onChange={(event) => setSecondsDraft(event.target.value)}
                onBlur={() => {
                  secondsFocus.current = false;
                  const next = Number(secondsDraft);
                  if (!Number.isFinite(next)) {
                    setSecondsDraft(sceneLength > 0 ? sceneLength.toFixed(1) : savedDefault.toFixed(1));
                    return;
                  }
                  cutToSeconds(next);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  event.currentTarget.blur();
                }}
              />
            </label>
            <button type="button" className="gd-trim-default" onClick={() => cutToSeconds(savedDefault)}>
              デフォルト {savedDefault.toFixed(1)}秒で切る
            </button>
            <button
              type="button"
              className="gd-trim-default"
              onClick={() => {
                const next = Number(secondsDraft);
                if (!Number.isFinite(next)) return;
                const seconds = clampSceneDuration(sceneKey, next);
                cutToSeconds(seconds);
                void window.studio
                  .setSceneDurationDefault(sceneKey, seconds)
                  .then(setSavedDefaults)
                  .catch((error: unknown) => {
                    useStudioStore.getState().setError(error instanceof Error ? error.message : String(error));
                  });
              }}
            >
              この秒数をデフォルトにする
            </button>
            <span className="gd-trim-src">保存済み {savedDefault.toFixed(1)}秒</span>
          </div>
          <div className="gd-trim-zoom" role="group" aria-label="元動画の表示サイズ">
            <span>表示サイズ</span>
            <button
              type="button"
              aria-label="縮小"
              disabled={previewScale <= 0.75}
              onClick={() => setPreviewScale((current) => nextPreviewScale(current, -0.25))}
            >
              −
            </button>
            <span className="gd-trim-zoom-read">{Math.round(previewScale * 100)}%</span>
            <button
              type="button"
              aria-label="拡大"
              disabled={previewScale >= 2.5}
              onClick={() => setPreviewScale((current) => nextPreviewScale(current, 0.25))}
            >
              +
            </button>
          </div>
          <div className="gd-trim-stage">
            <div
              className="gd-source gd-trim-video"
              style={{ width: `${Math.round(PREVIEW_BASE_WIDTH * previewScale)}px` }}
              onPointerUp={(event) => {
                if (event.target !== event.currentTarget && !(event.target instanceof HTMLVideoElement)) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                if (scene.layout916 === 'focus') {
                  if (bounds.width <= 0 || bounds.height <= 0) return;
                  const nextX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
                  const nextY = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
                  update((current) => {
                    const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                    if (!target) return current;
                    target.cropCenterX = nextX;
                    target.cropCenterY = nextY;
                    return current;
                  });
                  return;
                }
                placeMarker(bounds, event.clientX, event.clientY);
              }}
            >
              <video
                key={asset.id}
                ref={videoRef}
                src={mediaUrl(asset.proxyPath ?? asset.path)}
                onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
              />
              {showCrop && (
                <>
                  <div className="gd-crop-shade" style={{ left: 0, width: `${shownCropLeft * 100}%` }} />
                  <div className="gd-crop-shade" style={{ left: `${(shownCropLeft + shownCropW) * 100}%`, right: 0 }} />
                  {focusWindow && shownCropTop > 0.001 && (
                    <div
                      className="gd-crop-shade"
                      style={{
                        left: `${shownCropLeft * 100}%`,
                        width: `${shownCropW * 100}%`,
                        top: 0,
                        height: `${shownCropTop * 100}%`,
                        bottom: 'auto',
                      }}
                    />
                  )}
                  {focusWindow && shownCropTop + shownCropH < 0.999 && (
                    <div
                      className="gd-crop-shade"
                      style={{
                        left: `${shownCropLeft * 100}%`,
                        width: `${shownCropW * 100}%`,
                        top: `${(shownCropTop + shownCropH) * 100}%`,
                        bottom: 0,
                      }}
                    />
                  )}
                  <div
                    className="gd-crop"
                    style={{
                      left: `${shownCropLeft * 100}%`,
                      width: `${shownCropW * 100}%`,
                      ...(focusWindow
                        ? {
                            top: `${shownCropTop * 100}%`,
                            height: `${shownCropH * 100}%`,
                            bottom: 'auto',
                            cursor: 'move',
                          }
                        : {}),
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      cropDrag.current = {
                        pointerX: event.clientX,
                        pointerY: event.clientY,
                        centerX: scene.cropCenterX,
                        centerY: focusCropCenterYOf(scene),
                        moved: false,
                      };
                    }}
                    onPointerMove={(event) => {
                      const drag = cropDrag.current;
                      const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                      if (!drag || !bounds || bounds.width <= 0 || bounds.height <= 0) return;
                      if (Math.hypot(event.clientX - drag.pointerX, event.clientY - drag.pointerY) > 3) drag.moved = true;
                      if (!drag.moved) return;
                      const nextX = Math.min(1, Math.max(0, drag.centerX + (event.clientX - drag.pointerX) / bounds.width));
                      const nextY = Math.min(1, Math.max(0, drag.centerY + (event.clientY - drag.pointerY) / bounds.height));
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (!target) return current;
                        target.cropCenterX = nextX;
                        if (target.layout916 === 'focus') target.cropCenterY = nextY;
                        return current;
                      });
                    }}
                    onPointerUp={(event) => {
                      const drag = cropDrag.current;
                      cropDrag.current = null;
                      event.stopPropagation();
                      const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                      if (drag && !drag.moved && bounds) {
                        if (scene.layout916 === 'focus') {
                          const nextX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
                          const nextY = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
                          update((current) => {
                            const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                            if (!target) return current;
                            target.cropCenterX = nextX;
                            target.cropCenterY = nextY;
                            return current;
                          });
                        } else {
                          placeMarker(bounds, event.clientX, event.clientY);
                        }
                      }
                    }}
                  >
                    <span>{scene.layout916 === 'focus' ? '切り抜く範囲（1080:1430）' : '縦型に切り抜く範囲（9:16）'}</span>
                    {scene.layout916 === 'focus' && (
                      <i className="gd-crop-axis" style={{ background: project.templateParams.accent }} />
                    )}
                  </div>
                </>
              )}
              {showFrameGuides && (
                <div className="gd-frame-guides" aria-hidden="true">
                  <span className="is-h" />
                  <span className="is-v" />
                  <span className="is-tag is-top">上</span>
                  <span className="is-tag is-bottom">下</span>
                  <span className="is-tag is-left">左</span>
                  <span className="is-tag is-right">右</span>
                  <span className="is-tag is-center">中央</span>
                </div>
              )}
              {scene.aimMarker?.enabled && !scene.aimZoom?.enabled && (
                <span
                  className={markerWaiting ? 'gd-aim-handle is-movable is-waiting' : 'gd-aim-handle is-movable'}
                  style={{
                    left: `${((scene.layout916 === 'center-crop' ? cropLeft + scene.aimMarker.x * cropW : scene.aimMarker.x) * 100)}%`,
                    top: `${scene.aimMarker.y * 100}%`,
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                    if (bounds) placeMarker(bounds, event.clientX, event.clientY);
                  }}
                  onPointerUp={(event) => event.stopPropagation()}
                >
                  <span
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      transform: `scale(${ringScale})`,
                      transformOrigin: '0 0',
                    }}
                  >
                    <AimMarker
                      x={0}
                      y={0}
                      accent={project.templateParams.accent}
                      size={scene.aimMarker.size ?? 1}
                      style={annotationStyleOf(project.annotationStyle)}
                    />
                  </span>
                </span>
              )}
              {scene.layout916 === 'center-crop' && scene.aimMarker?.enabled && scene.aimZoom?.enabled && asset && (
                <VideoAimZoomLayer
                  project={project}
                  scene={scene}
                  cropLeft={cropLeft}
                  cropW={cropW}
                  previewWidth={previewWidth}
                  videoRef={videoRef}
                  waiting={markerWaiting}
                  sourceUrl={mediaUrl(asset.proxyPath ?? asset.path)}
                />
              )}
              <button
                type="button"
                className={showFrameGuides ? 'gd-guide-toggle is-on' : 'gd-guide-toggle'}
                aria-pressed={showFrameGuides}
                onClick={() => setShowFrameGuides((on) => !on)}
                onPointerUp={(event) => event.stopPropagation()}
              >
                補助線
              </button>
              <span className="gd-source-label">元の録画（16:9）</span>
              <span className="gd-source-time">
                {frameStamp(playhead)} / {frameStamp(duration)}
              </span>
            </div>
          </div>
          {focusWarning && <p className="gd-banner is-warn">{focusWarning}（警告。止めない）</p>}
          <div className="gd-trim-ruler">
            <div className="gd-trim-range" aria-label="範囲の指定">
              {sceneKey === 'hook' && duration > 0 && asset && (() => {
                const lead = defaultLoopRange(project);
                if (!lead || lead.assetId !== asset.id) return null;
                return (
                  <span
                    key="loop-before-hook"
                    className="is-other"
                    style={{
                      left: `${(lead.in / duration) * 100}%`,
                      width: `${((lead.out - lead.in) / duration) * 100}%`,
                    }}
                  />
                );
              })()}
              {duration > 0 &&
                project.scenes.flatMap((other) => {
                  if (other.sceneKey === sceneKey || !other.clipId) return [];
                  const source = project.clips.find((item) => item.id === other.clipId);
                  if (!source || source.assetId !== asset.id) return [];
                  const placement = timelineItems.find((item) => item.sceneKey === other.sceneKey);
                  const sourceWindow = playedSourceWindow(source, placement);
                  if (!sourceWindow) return [];
                  return [
                    <span
                      key={other.sceneKey}
                      className="is-other"
                      style={{
                        left: `${(sourceWindow.in / duration) * 100}%`,
                        width: `${((sourceWindow.out - sourceWindow.in) / duration) * 100}%`,
                      }}
                    />,
                  ];
                })}
              {duration > 0 && (
                <button
                  type="button"
                  className="is-mine"
                  aria-label="このシーンの範囲。ドラッグで移動"
                  style={{
                    left: `${(clip.in / duration) * 100}%`,
                    width: `${((clip.out - clip.in) / duration) * 100}%`,
                  }}
                  onPointerDown={(event) => beginRangeDrag('move', event)}
                  onPointerMove={moveRangeDrag}
                  onPointerUp={endRangeDrag}
                  onPointerCancel={endRangeDrag}
                />
              )}
              {duration > 0 && (
                <>
                  <button
                    type="button"
                    className="is-handle"
                    aria-label="開始位置。ドラッグで尺を保ったまま移動"
                    style={{ left: `${(clip.in / duration) * 100}%` }}
                    onPointerDown={(event) => beginRangeDrag('in', event)}
                    onPointerMove={moveRangeDrag}
                    onPointerUp={endRangeDrag}
                    onPointerCancel={endRangeDrag}
                  />
                  <button
                    type="button"
                    className="is-handle"
                    aria-label="終了位置。ドラッグで尺を保ったまま移動"
                    style={{ left: `${(clip.out / duration) * 100}%` }}
                    onPointerDown={(event) => beginRangeDrag('out', event)}
                    onPointerMove={moveRangeDrag}
                    onPointerUp={endRangeDrag}
                    onPointerCancel={endRangeDrag}
                  />
                  <span className="is-head" style={{ left: `${(playhead / duration) * 100}%` }} />
                  {scene.aimMarker?.enabled && (
                    <span
                      className="is-marker"
                      title={`照準マーカー ${markerAt.toFixed(2)}秒`}
                      style={{ left: `${((clip.in + markerAt) / duration) * 100}%` }}
                    />
                  )}
                </>
              )}
            </div>
            <div className="gd-trim-scale">
              <span>{badgeClock(0)}</span>
              <span>青：ほかのシーンで使った範囲　赤：このシーン</span>
              <span>{badgeClock(duration)}</span>
            </div>
          </div>
          <div className="gd-trim-controls">
            <TrimTimeField
              label="IN"
              kbd="I"
              value={clip.in}
              min={0}
              max={Math.max(0, duration - length)}
              step={0.1}
              onChange={slideIn}
              onCommitFromPlayhead={() => slideIn(playhead)}
            />
            <TrimTimeField
              label="OUT"
              kbd="O"
              value={clip.out}
              min={length}
              max={duration}
              step={0.1}
              onChange={slideOut}
              onCommitFromPlayhead={() => slideOut(playhead)}
            />
            <div className={lengthWarn ? 'gd-trim-length is-warn' : 'gd-trim-length'}>
              <TrimTimeField
                label="長さ（秒）"
                value={length}
                min={durationLimits.min}
                max={Math.min(durationLimits.max, duration)}
                step={0.1}
                onChange={cutToSeconds}
              />
              {length < copy.min
                ? '目安より短い'
                : length > copy.max
                  ? '目安より長い'
                  : null}
            </div>
            <span className="gd-spacer" />
            <button type="button" className="gd-nudge" aria-label="1フレーム戻る" onClick={() => seek(Math.max(0, playhead - frame))}>
              ‹
            </button>
            <button type="button" className="gd-nudge" aria-label="1フレーム進む" onClick={() => seek(Math.min(duration, playhead + frame))}>
              ›
            </button>
            <button type="button" className="gd-confirm-scene" onClick={confirm}>
              {nextCode ? `確定して ${nextCode} へ（Enter）` : '確定（Enter）'}
            </button>
          </div>
          <section className="gd-trim-fx" aria-label="このシーンの演出">
            <strong>
              このシーンの演出 <em>（{copy.title.split(' ')[0]} の初期値が入っています）</em>
            </strong>
            <div className="gd-trim-fx-row">
              <div className="gd-seg" role="group" aria-label="縦型変換">
                {(
                  [
                    ['center-crop', '中央切り抜き'],
                    ['blur-fit', 'ぼかし背景'],
                    ['focus', 'フォーカス'],
                    ['split', '上下分割'],
                  ] as const
                ).map(([layout, text]) => (
                  <button
                    key={layout}
                    type="button"
                    className={scene.layout916 === layout ? 'is-on' : ''}
                    onClick={() =>
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (!target) return current;
                        target.layout916 = layout;
                        if (layout === 'center-crop') target.cropCenterX = 0.5;
                        if (current.timeline) {
                          current.timeline.items = current.timeline.items.map((item) =>
                            item.sceneKey === sceneKey ? { ...item, layout } : item,
                          );
                        }
                        return current;
                      })
                    }
                  >
                    {text}
                  </button>
                ))}
              </div>
              {scene.layout916 === 'focus' && (
                <label className="gd-focus-center">
                  切り抜きの横位置
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    aria-label="切り抜きの横位置"
                    value={scene.cropCenterX}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (target) target.cropCenterX = next;
                        return current;
                      });
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    aria-label="切り抜きの横位置の数値"
                    value={Number(scene.cropCenterX.toFixed(2))}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (target) target.cropCenterX = Math.min(1, Math.max(0, next));
                        return current;
                      });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (target) target.cropCenterX = 0.5;
                        return current;
                      })
                    }
                  >
                    中央に戻す
                  </button>
                </label>
              )}
              {scene.layout916 === 'focus' && (
                <label className="gd-focus-center">
                  切り抜きの縦位置
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    aria-label="切り抜きの縦位置"
                    value={focusCropCenterYOf(scene)}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (target) target.cropCenterY = next;
                        return current;
                      });
                    }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    aria-label="切り抜きの縦位置の数値"
                    value={Number(focusCropCenterYOf(scene).toFixed(2))}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (target) target.cropCenterY = Math.min(1, Math.max(0, next));
                        return current;
                      });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (target) target.cropCenterY = 0.5;
                        return current;
                      })
                    }
                  >
                    中央に戻す
                  </button>
                </label>
              )}
              {scene.layout916 === 'focus' && (
                <TrimTimeField
                  label="拡大率"
                  value={focusCropZoomOf(scene)}
                  min={FOCUS_CROP_ZOOM.min}
                  max={FOCUS_CROP_ZOOM.max}
                  step={FOCUS_CROP_ZOOM.step}
                  onChange={(next) => {
                    const cropZoom = roundFocusZoom(next);
                    update((current) => {
                      const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                      if (target) target.cropZoom = cropZoom;
                      return current;
                    });
                  }}
                />
              )}
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(scene.zoom?.enabled)}
                  onChange={(event) =>
                    update((current) => {
                      const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                      if (!target) return current;
                      target.zoom = {
                        enabled: event.target.checked,
                        from: target.zoom?.from ?? 1,
                        to: target.zoom?.to ?? 1.15,
                        x: target.zoom?.x ?? 0.5,
                        y: target.zoom?.y ?? 0.5,
                      };
                      return current;
                    })
                  }
                />
                ズーム
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(scene.freeze?.enabled)}
                  onChange={(event) =>
                    update((current) => {
                      const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                      if (!target) return current;
                      target.freeze = {
                        enabled: event.target.checked,
                        at: target.freeze?.at ?? 1,
                        duration: target.freeze?.duration ?? 1,
                      };
                      return current;
                    })
                  }
                />
                フリーズ
              </label>
              {scene.freeze?.enabled && (
                <span className="gd-freeze-read">
                  +
                  <input
                    type="number"
                    step={0.1}
                    aria-label="フリーズ開始"
                    value={scene.freeze.at}
                    onChange={(event) =>
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (target?.freeze) target.freeze.at = Number(event.target.value);
                        return current;
                      })
                    }
                  />
                  s から
                  <input
                    type="number"
                    step={0.1}
                    aria-label="フリーズの長さ"
                    value={scene.freeze.duration}
                    onChange={(event) =>
                      update((current) => {
                        const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                        if (target?.freeze) target.freeze.duration = Number(event.target.value);
                        return current;
                      })
                    }
                  />
                  s
                </span>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(scene.aimMarker?.enabled)}
                  onChange={(event) =>
                    update((current) => {
                      const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                      if (!target) return current;
                      target.aimMarker = withAimMarker(target.aimMarker, {
                        enabled: event.target.checked,
                      });
                      return current;
                    })
                  }
                />
                照準マーカー
              </label>
            </div>
            {scene.aimMarker?.enabled && (
              <div className="gd-marker-controls">
                <div className="gd-marker-axes">
                  <MarkerAxisControl axis="x" value={scene.aimMarker.x} onChange={(value) => setMarkerAxis('x', value)} />
                  <MarkerAxisControl axis="y" value={scene.aimMarker.y} onChange={(value) => setMarkerAxis('y', value)} />
                </div>
                <label className="is-when">
                  出現
                  <span className="gd-freeze-read">
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, length)}
                      step={0.1}
                      aria-label="照準マーカーの出現"
                      value={markerAt}
                      onChange={(event) => setAppearAt(Number(event.target.value))}
                    />
                    秒から
                    <button type="button" onClick={appearAtPlayhead}>
                      今の位置
                    </button>
                  </span>
                </label>
                <AnnotationWeightField
                  style={project.annotationStyle}
                  onChange={(style: AnnotationStyle) =>
                    update((current) => {
                      current.annotationStyle = style;
                      return current;
                    })
                  }
                />
                <ZoomChoice
                  label="ズーム枠"
                  value={scene.aimZoom?.enabled ? 'on' : 'off'}
                  options={[
                    { id: 'on', label: 'オン' },
                    { id: 'off', label: 'オフ' },
                  ]}
                  onPick={(id) =>
                    update((current) => {
                      const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                      if (!target) return current;
                      if (id === 'on') {
                        target.aimZoom = target.aimZoom
                          ? { ...target.aimZoom, enabled: true }
                          : defaultSceneAimZoom({
                              x: target.aimMarker?.x ?? 0.5,
                              y: target.aimMarker?.y ?? 0.5,
                            });
                      } else if (target.aimZoom) {
                        target.aimZoom.enabled = false;
                      }
                      return current;
                    })
                  }
                />
                {scene.aimZoom?.enabled && (
                  <>
                    <ZoomChoice
                      label="倍率"
                      value={String(scene.aimZoom.zoom)}
                      options={[
                        { id: '3', label: '×3' },
                        { id: '4', label: '×4' },
                        { id: '6', label: '×6' },
                      ]}
                      onPick={(id) =>
                        update((current) => {
                          const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                          if (target?.aimZoom && (id === '3' || id === '4' || id === '6')) {
                            target.aimZoom.zoom = Number(id) as 3 | 4 | 6;
                          }
                          return current;
                        })
                      }
                    />
                    <ZoomChoice
                      label="大きさ"
                      value={scene.aimZoom.size}
                      options={[
                        { id: 's', label: '小' },
                        { id: 'm', label: '中' },
                        { id: 'l', label: '大' },
                      ]}
                      onPick={(id) =>
                        update((current) => {
                          const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                          if (!target?.aimZoom || (id !== 's' && id !== 'm' && id !== 'l') || id === target.aimZoom.size) {
                            return current;
                          }
                          const width = VIDEO_AIM_FRAME.width;
                          const height = VIDEO_AIM_FRAME.height;
                          const oldSide = width * VIDEO_AIM_ZOOM_RATIO[target.aimZoom.size];
                          const newSide = width * VIDEO_AIM_ZOOM_RATIO[id];
                          const chrome = zoomChromeThickness(
                            getAnnotationStyle(annotationStyleOf(current.annotationStyle), width),
                          );
                          const next = clampVideoAimZoomOrigin(
                            {
                              x: target.aimZoom.x * width + (oldSide - newSide) / 2,
                              y: target.aimZoom.y * height + (oldSide - newSide) / 2,
                            },
                            id,
                            chrome,
                          );
                          target.aimZoom.size = id;
                          target.aimZoom.x = next.x;
                          target.aimZoom.y = next.y;
                          return current;
                        })
                      }
                    />
                    <ZoomChoice
                      label="接続線"
                      value={scene.aimZoom.guide ? 'on' : 'off'}
                      options={[
                        { id: 'on', label: 'オン' },
                        { id: 'off', label: 'オフ' },
                      ]}
                      onPick={(id) =>
                        update((current) => {
                          const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                          if (target?.aimZoom) target.aimZoom.guide = id === 'on';
                          return current;
                        })
                      }
                    />
                    {scene.layout916 !== 'center-crop' && (
                      <>
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
                              update((current) => {
                                const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                                if (target?.aimZoom) target.aimZoom.x = Number(event.target.value);
                                return current;
                              })
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
                              update((current) => {
                                const target = current.scenes.find((item) => item.sceneKey === sceneKey);
                                if (target?.aimZoom) target.aimZoom.y = Number(event.target.value);
                                return current;
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                    <span className="gd-muted">
                      縦型の切り抜き上で枠をドラッグできます。枠をクリックしてから矢印キーで1ピクセル、Shiftと一緒で10ピクセル動きます。合わせ位置は切り抜きのクリックとスライダーのままです
                    </span>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

const CARD_COPY = {
  stand: { index: '01', title: '立ち位置', note: '立っている位置と周りの目印が分かる画' },
  aim: { index: '02', title: '合わせ位置', note: 'カード上の丸はクリックで動かします。この画像を選んだ状態で矢印キーを押すと1pxずつ、Shiftと一緒だと10px動きます。ズームの中心も同じ位置に付いてきます。動画の合わせ位置とは別です。切り抜きはドラッグです' },
  result: { index: '03', title: '発動イメージ', note: 'スキルが発動した瞬間が分かる画' },
} as const;

const CANDIDATE_LABEL: Record<'stand' | 'aim' | 'result', Record<string, { button: string; hero: string }>> = {
  stand: {
    終わり: { button: 'S2 終わり', hero: 'S2 の終わり' },
    中央: { button: 'S2 中央', hero: 'S2 の中央' },
    始まり: { button: 'S2 始まり', hero: 'S2 の始まり' },
  },
  aim: {
    フリーズ: { button: 'フリーズ位置', hero: 'S3 フリーズ位置' },
    終わり: { button: 'S3 終わり', hero: 'S3 の終わり' },
    中央: { button: 'S3 中央', hero: 'S3 の中央' },
  },
  result: {
    終わり近く: { button: '着弾付近', hero: 'S4 着弾付近' },
    終わり: { button: 'S4 終わり', hero: 'S4 の終わり' },
    デモの中央: { button: 'S6 から', hero: 'S6 から' },
  },
};

const frameStamp = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
};

const zoomDraft = (project: Project): CardAimZoom =>
  project.cardAimZoom ?? { enabled: false, style: 'corner', position: 'auto', zoom: 4, guide: true };

const patchZoom = (recipe: (zoom: CardAimZoom) => void): void => {
  update((current) => {
    const zoom: CardAimZoom = current.cardAimZoom
      ? {
          ...current.cardAimZoom,
          center: current.cardAimZoom.center ? { ...current.cardAimZoom.center } : undefined,
          note: current.cardAimZoom.note ? { ...current.cardAimZoom.note } : undefined,
        }
      : { enabled: false, style: 'corner', position: 'auto', zoom: 4, guide: true };
    recipe(zoom);
    current.cardAimZoom = zoom;
    return current;
  });
};

const ZoomChoice = ({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string;
  onPick: (id: string) => void;
}) => (
  <div className="gd-zoom-row">
    <span>{label}</span>
    <div className="gd-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.id === value ? 'is-on' : ''}
          aria-pressed={option.id === value}
          onClick={() => onPick(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

const AimZoomControls = ({ project }: { project: Project }) => {
  const zoom = zoomDraft(project);
  const split = zoom.style === 'split';
  const position = split
    ? zoom.position === 'left' || zoom.position === 'tl' || zoom.position === 'bl'
      ? 'left'
      : 'right'
    : zoom.position === 'left' || zoom.position === 'right'
      ? 'auto'
      : zoom.position;
  return (
    <div className="gd-zoom">
      <AnnotationWeightField
        style={project.annotationStyle}
        onChange={(style) =>
          update((current) => {
            current.annotationStyle = style;
            return current;
          })
        }
      />
      <ZoomChoice
        label="ズーム"
        value={zoom.enabled ? 'on' : 'off'}
        options={[
          { id: 'on', label: 'オン' },
          { id: 'off', label: 'オフ' },
        ]}
        onPick={(id) => {
          if (id === 'on' && !project.cardAimZoom) {
            update((current) => {
              current.cardAimZoom = defaultCardAimZoom();
              return current;
            });
            return;
          }
          patchZoom((next) => {
            next.enabled = id === 'on';
          });
        }}
      />
      <ZoomChoice
        label="表示"
        value={zoom.style}
        options={[
          { id: 'corner', label: '角型' },
          { id: 'loupe', label: 'ルーペ' },
          { id: 'split', label: '分割' },
        ]}
        onPick={(id) =>
          patchZoom((next) => {
            const style = id as CardAimZoom['style'];
            if (style === 'split' && next.style !== 'split') {
              const left = next.position === 'tl' || next.position === 'bl' || next.position === 'left';
              next.position = left ? 'left' : 'right';
            } else if (style !== 'split' && next.style === 'split') {
              next.position = 'auto';
            }
            next.style = style;
          })
        }
      />
      <ZoomChoice
        label="配置"
        value={position}
        options={
          split
            ? [
                { id: 'left', label: '左' },
                { id: 'right', label: '右' },
              ]
            : [
                { id: 'auto', label: '自動' },
                { id: 'tl', label: '左上' },
                { id: 'tr', label: '右上' },
                { id: 'bl', label: '左下' },
                { id: 'br', label: '右下' },
              ]
        }
        onPick={(id) => patchZoom((next) => {
          next.position = id as CardAimZoom['position'];
        })}
      />
      <ZoomChoice
        label="拡大率"
        value={String(zoom.zoom)}
        options={[
          { id: '3', label: '×3' },
          { id: '4', label: '×4' },
          { id: '6', label: '×6' },
        ]}
        onPick={(id) => patchZoom((next) => {
          next.zoom = Number(id) as CardAimZoom['zoom'];
        })}
      />
      {!split && (
        <>
          <ZoomChoice
            label="枠サイズ"
            value={zoom.size ?? ''}
            options={[
              { id: 's', label: '小' },
              { id: 'm', label: '中' },
              { id: 'l', label: '大' },
            ]}
            onPick={(id) => patchZoom((next) => {
              next.size = id as NonNullable<CardAimZoom['size']>;
            })}
          />
          {!zoom.size && (
            <span className="gd-zoom-hint">未指定のときは 9:16 のB案だけ大、X用カードとA案は中</span>
          )}
          <ZoomChoice
            label="ガイド線"
            value={zoom.guide ? 'on' : 'off'}
            options={[
              { id: 'on', label: '表示' },
              { id: 'off', label: '非表示' },
            ]}
            onPick={(id) => patchZoom((next) => {
              next.guide = id === 'on';
            })}
          />
        </>
      )}
      {split && (
        <div className="gd-zoom-notes">
          {(['ja', 'en'] as const).map((language) => (
            <label key={language}>
              <span>{language === 'ja' ? '一言メモ' : 'Note'}</span>
              <input
                value={zoom.note?.[language] ?? ''}
                placeholder={language === 'ja' ? '屋根の角にクロスヘア' : 'Crosshair on the roof corner'}
                onChange={(event) => {
                  const value = event.target.value;
                  patchZoom((next) => {
                    next.note = {
                      ja: language === 'ja' ? value : (next.note?.ja ?? ''),
                      en: language === 'en' ? value : (next.note?.en ?? ''),
                    };
                  });
                }}
              />
            </label>
          ))}
        </div>
      )}
      {(project.cardAimMarker || zoom.center) && (
        <button
          type="button"
          className="gd-mini"
          onClick={() =>
            update((current) => {
              current.cardAimMarker = undefined;
              if (current.cardAimZoom) current.cardAimZoom.center = undefined;
              return current;
            })
          }
        >
          動画の合わせ位置を使う
        </button>
      )}
    </div>
  );
};

type CardStill = Project['stills'][number];

const writeStillFocus = (stillId: string, focus: StillFocus | undefined): void => {
  update((current) => {
    const target = current.stills.find((item) => item.id === stillId);
    if (target) target.focus = focus;
    return current;
  });
};

const useStillPan = (
  still: CardStill | undefined,
  imageAspect: number,
  onClick?: (event: ReactPointerEvent<HTMLDivElement>) => void,
) => {
  const drag = useRef<{ x: number; y: number; focus: StillFocus; moved: boolean } | null>(null);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!still || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, focus: stillFocusOf(still), moved: false };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>): void => {
      const state = drag.current;
      if (!state || !still) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.moved && Math.hypot(dx, dy) < 4) return;
      state.moved = true;
      const next = panStillFocus(state.focus, dx, dy, event.currentTarget.getBoundingClientRect(), imageAspect);
      writeStillFocus(still.id, normalizedStillFocus(next));
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>): void => {
      const state = drag.current;
      drag.current = null;
      if (state && !state.moved) onClick?.(event);
    },
  };
};

const StillFocusControls = ({
  still,
  layout,
  role,
  imageAspect,
  matchesX,
}: {
  still: CardStill;
  layout: Project['cardLayout'];
  role: CardStillRole;
  imageAspect: number;
  matchesX: boolean;
}) => {
  const focus = stillFocusOf(still);
  const axes = stillFocusAxes(layout, role, imageAspect);
  const setAxis = (axis: 'x' | 'y', value: number): void => {
    writeStillFocus(still.id, normalizedStillFocus({ ...focus, [axis]: value }));
  };
  return (
    <div className="gd-still-focus">
      <span>切り抜き位置</span>
      <label>
        <span>上</span>
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(focus.y * 1000)}
          aria-label="切り抜きの上下"
          disabled={!axes.y}
          title={axes.y ? '左端が上、右端が下、真ん中が中央' : 'この画像とカード枠では上下に切れしろがありません'}
          onChange={(event) => setAxis('y', Number(event.target.value) / 1000)}
        />
        <span>下</span>
      </label>
      <label>
        <span>左</span>
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(focus.x * 1000)}
          aria-label="切り抜きの左右"
          disabled={!axes.x}
          title={axes.x ? '左端が左、右端が右、真ん中が中央' : 'この画像とカード枠では左右に切れしろがありません'}
          onChange={(event) => setAxis('x', Number(event.target.value) / 1000)}
        />
        <span>右</span>
      </label>
      {still.focus && (
        <button type="button" className="gd-mini" onClick={() => writeStillFocus(still.id, undefined)}>
          中央に戻す
        </button>
      )}
      <span className="gd-still-focus-note">
        画像をドラッグしても動かせます。スライダーの真ん中が中央です。
        {matchesX ? ' 表示は切れ幅の大きいX用カードに合わせています。完成カードはこれより広く写ります。' : ''}
      </span>
    </div>
  );
};

const rememberImageAspect = (
  event: { currentTarget: HTMLImageElement },
  setAspect: (aspect: number) => void,
): void => {
  const img = event.currentTarget;
  if (img.naturalWidth > 0 && img.naturalHeight > 0) setAspect(img.naturalWidth / img.naturalHeight);
};

const StillFramePreview = ({
  project,
  role,
  still,
  caption,
}: {
  project: Project;
  role: 'stand' | 'result';
  still?: CardStill;
  caption: string;
}) => {
  const [imageAspect, setImageAspect] = useState(16 / 9);
  const frame = stillPreviewFrame(project.cardLayout, role);
  const pan = useStillPan(still, imageAspect);
  return (
    <>
      <div
        className={`gd-still-hero ${still ? 'is-on is-pan' : ''}`}
        style={still ? { aspectRatio: `${frame.width} / ${frame.height}`, height: 'auto' } : undefined}
        {...pan}
      >
        {still && (
          <img
            src={mediaUrl(still.path)}
            alt=""
            draggable={false}
            style={{ objectPosition: stillObjectPosition(still) }}
            onLoad={(event) => rememberImageAspect(event, setImageAspect)}
          />
        )}
        {caption && <span className="gd-still-caption">{caption}</span>}
      </div>
      {still && (
        <StillFocusControls
          still={still}
          layout={project.cardLayout}
          role={role}
          imageAspect={imageAspect}
          matchesX={frame.matchesX}
        />
      )}
    </>
  );
};

const AimStillPreview = ({
  project,
  still,
  caption,
}: {
  project: Project;
  still?: CardStill;
  caption: string;
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [imageAspect, setImageAspect] = useState(16 / 9);
  const surface = aimZoomSurface(project.cardLayout, 'card');
  const box = aimZoomBox(surface, 'ja');
  const layout = resolveAimZoomFor(project, surface, 'ja');
  const marker = cardAimPoint(project);
  const imageUrl = still ? mediaUrl(still.path) : undefined;
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = (): void => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = width > 0 ? width / box.width : 0;
  const placeCenter = (x: number, y: number): void => {
    update((current) => {
      current.cardAimMarker = {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      };
      if (current.cardAimZoom?.center) current.cardAimZoom.center = undefined;
      return current;
    });
  };
  const setCenter = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    placeCenter(x, y);
  };
  const nudgeCenter = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const axis =
      event.key === 'ArrowLeft' ? { x: -1, y: 0 }
      : event.key === 'ArrowRight' ? { x: 1, y: 0 }
      : event.key === 'ArrowUp' ? { x: 0, y: -1 }
      : event.key === 'ArrowDown' ? { x: 0, y: 1 }
      : null;
    if (!axis) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    update((current) => {
      const base = cardAimPoint(current) ?? { x: 0.5, y: 0.5 };
      current.cardAimMarker = nudgeCardAimPoint(base, axis, box, step);
      if (current.cardAimZoom?.center) current.cardAimZoom.center = undefined;
      return current;
    });
  };
  const pan = useStillPan(still, imageAspect, setCenter);
  return (
    <>
      <div
        ref={frameRef}
        tabIndex={0}
        aria-label="合わせ位置。クリックで指定し、矢印キーで1ピクセルずつ動かせます。Shiftで10ピクセルです"
        className={`gd-still-hero is-aim ${imageUrl ? 'is-on is-pan' : ''} ${project.cardAimZoom?.enabled ? 'is-zoom' : ''}`}
        style={{ aspectRatio: `${box.width} / ${box.height}` }}
        onKeyDown={nudgeCenter}
        {...(imageUrl ? pan : {})}
        onPointerDown={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          if (imageUrl) pan.onPointerDown(event);
        }}
      >
        {scale > 0 && (
          <div className="gd-aim-stage" style={{ width: box.width, height: box.height, transform: `scale(${scale})` }}>
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                draggable={false}
                style={{ objectPosition: stillObjectPosition(still) }}
                onLoad={(event) => rememberImageAspect(event, setImageAspect)}
              />
            )}
            {(layout || marker) && (
              <AnnotationDim
                style={annotationStyleOf(project.annotationStyle)}
                center={layout ? layout.center : { x: marker!.x, y: marker!.y }}
                shortSide={Math.min(box.width, box.height)}
                zoom={Boolean(layout)}
                cropSize={layout?.source.size}
              />
            )}
            {marker && !layout && (
              <AimMarker
                x={marker.x}
                y={marker.y}
                accent={project.templateParams.accent}
                size={marker.size}
                style={annotationStyleOf(project.annotationStyle)}
                zIndex={2}
              />
            )}
            {layout && (
              <AimZoomChrome
                layout={layout}
                box={box}
                accent={project.templateParams.accent}
                language="ja"
                nativeImage
                style={annotationStyleOf(project.annotationStyle)}
                note={project.cardAimZoom?.note?.ja}
                stillUrl={imageUrl}
                objectPosition={stillObjectPosition(still)}
              />
            )}
          </div>
        )}
        {caption && <span className="gd-still-caption">{caption}</span>}
      </div>
      {still && (
        <StillFocusControls
          still={still}
          layout={project.cardLayout}
          role="aim"
          imageAspect={imageAspect}
          matchesX={false}
        />
      )}
    </>
  );
};

const CARD_FRAME_ROLE_LABEL: Record<CardStillRole, string> = {
  stand: '立ち位置',
  aim: '合わせ位置',
  result: '着弾結果',
};

const CardFramePicker = ({
  project,
  role,
  initialAssetId,
  initialSeconds,
  busy,
  onCapture,
  onClose,
  heading,
}: {
  project: Project;
  role: CardStillRole;
  initialAssetId: string;
  initialSeconds: number;
  busy: boolean;
  onCapture: (assetId: string, seconds: number) => Promise<boolean>;
  onClose: () => void;
  heading?: string;
}) => {
  const videos = videosOf(project);
  const initialAsset = videos.find((item) => item.id === initialAssetId) ?? videos[0];
  const [assetId, setAssetId] = useState(initialAsset?.id ?? '');
  const [seconds, setSeconds] = useState(initialSeconds);
  const [mediaDuration, setMediaDuration] = useState(initialAsset?.meta.duration ?? 0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const asset = videos.find((item) => item.id === assetId) ?? initialAsset;
  const duration = mediaDuration || asset?.meta.duration || 0;
  const frameStep = 1 / project.templateParams.fps;
  const lastFrame = Math.max(0, duration - frameStep);

  const seek = (value: number): void => {
    const next = Math.min(lastFrame, Math.max(0, Number.isFinite(value) ? value : 0));
    setSeconds(next);
    if (videoRef.current && Math.abs(videoRef.current.currentTime - next) > frameStep / 2) {
      videoRef.current.currentTime = next;
    }
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  if (!asset) return null;

  return (
    <div className="clip-editor-backdrop" onClick={() => !busy && onClose()}>
      <section
        className="clip-editor-dialog gd-card-frame-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-frame-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="clip-editor-heading">
          <div>
            <span className="eyebrow">{heading ? 'THUMBNAIL' : `CARD FRAME · ${role.toUpperCase()}`}</span>
            <h2 id="card-frame-picker-title">{heading ?? `${CARD_FRAME_ROLE_LABEL[role]}の画像を選ぶ`}</h2>
            <p className="clip-editor-hint">
              登録済みのどの動画からでも、現在位置のフレームをカード用画像にできます。
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="閉じる" disabled={busy} onClick={onClose}>
            ×
          </button>
        </header>

        <label className="gd-card-frame-source">
          元の動画
          <select
            value={asset.id}
            disabled={busy}
            onChange={(event) => {
              const next = videos.find((item) => item.id === event.target.value);
              if (!next) return;
              setAssetId(next.id);
              setMediaDuration(next.meta.duration ?? 0);
              setSeconds(0);
            }}
          >
            {videos.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index === 0 ? `最初の動画 · ${assetFileName(item)}` : assetFileName(item)}
              </option>
            ))}
          </select>
        </label>

        <div className="clip-editor-video">
          <video
            key={asset.id}
            ref={videoRef}
            src={mediaUrl(asset.proxyPath ?? asset.path)}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => {
              const loadedDuration = Number.isFinite(event.currentTarget.duration)
                ? event.currentTarget.duration
                : asset.meta.duration ?? 0;
              setMediaDuration(loadedDuration);
              const max = Math.max(0, loadedDuration - frameStep);
              const next = Math.min(max, Math.max(0, asset.id === initialAssetId ? initialSeconds : seconds));
              setSeconds(next);
              event.currentTarget.currentTime = next;
            }}
            onTimeUpdate={(event) => setSeconds(Math.min(lastFrame, event.currentTarget.currentTime))}
            onSeeked={(event) => setSeconds(Math.min(lastFrame, event.currentTarget.currentTime))}
          />
        </div>

        <div className="gd-card-frame-time">
          <button type="button" disabled={busy || seconds <= 0} onClick={() => seek(seconds - frameStep)}>
            −1フレーム
          </button>
          <strong>{frameStamp(seconds)}</strong>
          <button
            type="button"
            disabled={busy || seconds >= lastFrame}
            onClick={() => seek(seconds + frameStep)}
          >
            ＋1フレーム
          </button>
        </div>
        <input
          className="gd-card-frame-range"
          type="range"
          min={0}
          max={Math.max(lastFrame, frameStep)}
          step={frameStep}
          value={Math.min(seconds, Math.max(lastFrame, frameStep))}
          aria-label="カード用画像の再生位置"
          disabled={busy || duration <= 0}
          onChange={(event) => seek(Number(event.target.value))}
        />

        <footer className="gd-card-frame-actions">
          <span>{assetFileName(asset)} の {frameStamp(seconds)}</span>
          <div>
            <button type="button" disabled={busy} onClick={onClose}>キャンセル</button>
            <button
              type="button"
              className="primary"
              disabled={busy || duration <= 0}
              onClick={() => {
                void onCapture(asset.id, seconds).then((captured) => {
                  if (captured) onClose();
                });
              }}
            >
              {busy ? '画像を作成中…' : 'このフレームを使う'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};

const writeThumbnail = (recipe: (thumb: NonNullable<Project['thumbnail']>) => void): void => {
  update((current) => {
    const thumb: NonNullable<Project['thumbnail']> = {
      layout: current.thumbnail?.layout ?? 'classic',
      ...(current.thumbnail?.frame ? { frame: { ...current.thumbnail.frame } } : {}),
      ...(current.thumbnail?.focus ? { focus: { ...current.thumbnail.focus } } : {}),
      ...(current.thumbnail?.zoom !== undefined ? { zoom: current.thumbnail.zoom } : {}),
    };
    recipe(thumb);
    current.thumbnail = thumb;
    return current;
  });
};

const ThumbSetup = ({
  project,
  onPickFrame,
}: {
  project: Project;
  onPickFrame: () => void;
}) => {
  const focusOn = thumbnailLayoutOf(project) === 'focus';
  const pick = resolveFocusFrame(project);
  const asset = pick ? project.assets.find((item) => item.id === pick.assetId) : undefined;
  const size = focusFrameSize(project);
  const focus = thumbnailFocusOf(project);
  const zoom = thumbnailZoomOf(project);
  const crop = size ? resolveThumbCrop(size, focus, zoom) : null;
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ x: number; y: number; focus: { x: number; y: number }; moved: boolean } | null>(null);
  const [surface, setSurface] = useState<ThumbSurface>('full');
  const [actualSize, setActualSize] = useState(false);
  const [previewLanguage, setPreviewLanguage] = useState<Language>('ja');
  const candidates = cardCandidates(project).result;
  const upscale = focusUpscale(project);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !pick) return;
    const seek = (): void => {
      if (Math.abs(video.currentTime - pick.timeSec) > 0.04) video.currentTime = pick.timeSec;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
  }, [pick?.assetId, pick?.timeSec]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  return (
    <section className="gd-still-card gd-thumb-setup">
      <div className="gd-still-head">
        <span className="gd-still-num">04</span>
        <strong>サムネイル</strong>
        {focusOn && pick?.source === 'result' ? <span className="gd-still-ok">03に追従</span> : null}
        {focusOn && pick?.source === 'custom' ? <span className="gd-still-ok">フレーム指定</span> : null}
      </div>
      <ThumbnailLayoutSwitch project={project} />
      <div className="gd-thumb-split">
        <div
          ref={boxRef}
          className={`gd-thumb-source ${focusOn ? '' : 'is-off'}`}
          style={size ? { aspectRatio: `${size.w} / ${size.h}` } : undefined}
          tabIndex={focusOn ? 0 : -1}
          role="application"
          aria-label="サムネイルの中心"
          aria-disabled={!focusOn}
          onPointerDown={(event) => {
            if (!focusOn || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, focus, moved: false };
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            const rect = event.currentTarget.getBoundingClientRect();
            if (!state || !focusOn || rect.width <= 0 || rect.height <= 0) return;
            const dx = event.clientX - state.x;
            const dy = event.clientY - state.y;
            if (!state.moved && Math.hypot(dx, dy) < 4) return;
            state.moved = true;
            writeThumbnail((thumb) => {
              thumb.focus = {
                x: Math.min(1, Math.max(0, state.focus.x + dx / rect.width)),
                y: Math.min(1, Math.max(0, state.focus.y + dy / rect.height)),
              };
            });
          }}
          onPointerUp={(event) => {
            const state = drag.current;
            drag.current = null;
            if (!state || state.moved || !focusOn) return;
            const point = pointFromEvent(event);
            if (!point) return;
            writeThumbnail((thumb) => {
              thumb.focus = point;
            });
          }}
          onKeyDown={(event) => {
            if (!focusOn) return;
            const rect = boxRef.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return;
            const delta = event.shiftKey ? 10 : 1;
            const stepX = delta / rect.width;
            const stepY = delta / rect.height;
            const move = { x: 0, y: 0 };
            if (event.key === 'ArrowLeft') move.x = -stepX;
            else if (event.key === 'ArrowRight') move.x = stepX;
            else if (event.key === 'ArrowUp') move.y = -stepY;
            else if (event.key === 'ArrowDown') move.y = stepY;
            else return;
            event.preventDefault();
            writeThumbnail((thumb) => {
              const current = thumb.focus ?? focus;
              thumb.focus = {
                x: Math.min(1, Math.max(0, current.x + move.x)),
                y: Math.min(1, Math.max(0, current.y + move.y)),
              };
            });
          }}
        >
          {asset?.type === 'image' ? (
            <img src={mediaUrl(asset.path)} alt="" />
          ) : asset?.type === 'video' ? (
            <video
              key={`${asset.id}-${pick?.timeSec ?? 0}`}
              ref={videoRef}
              src={mediaUrl(asset.proxyPath ?? asset.path)}
              muted
              playsInline
              preload="auto"
            />
          ) : (
            <span className="gd-still-note">フレームがありません</span>
          )}
          {crop && size ? (
            <div
              className="gd-thumb-crop"
              style={{
                left: `${(crop.x / size.w) * 100}%`,
                top: `${(crop.y / size.h) * 100}%`,
                width: `${(crop.w / size.w) * 100}%`,
                height: `${(crop.h / size.h) * 100}%`,
              }}
            />
          ) : null}
        </div>
        <div>
          <div className="thumb-layout-switch">
            <button type="button" className={previewLanguage === 'ja' ? 'is-on' : ''} onClick={() => setPreviewLanguage('ja')}>日本語</button>
            <button type="button" className={previewLanguage === 'en' ? 'is-on' : ''} onClick={() => setPreviewLanguage('en')}>English</button>
          </div>
        <ThumbnailStage
          project={project}
          language={previewLanguage}
          fps={project.templateParams.fps}
          surface={surface}
          onSurface={setSurface}
          actualSize={actualSize}
          onActualSize={setActualSize}
          showControls
        />
        </div>
      </div>
      <span className="gd-still-note">
        クリックかドラッグで中心を動かします。矢印キーは1px、Shiftと一緒で10pxです。設定しなくても手順は完了できます。
      </span>
      <span className="gd-still-kicker">候補</span>
      <div className="gd-still-row">
        {candidates.map((candidate) => {
          const on = Boolean(
            pick &&
            candidate.assetId === pick.assetId &&
            Math.abs(candidate.seconds - pick.timeSec) < 0.08,
          );
          const preview = project.stills.find(
            (still) => still.assetId === candidate.assetId && Math.abs(still.frame - candidate.seconds) < 0.08,
          );
          const buttonLabel = CANDIDATE_LABEL.result[candidate.label]?.button ?? candidate.label;
          return (
            <button
              key={`${candidate.assetId}-${candidate.label}-${candidate.seconds}`}
              type="button"
              className={on ? 'is-on' : ''}
              disabled={!focusOn}
              onClick={() =>
                writeThumbnail((thumb) => {
                  thumb.layout = 'focus';
                  thumb.frame = { assetId: candidate.assetId, timeSec: candidate.seconds };
                })
              }
            >
              <span
                className="gd-still-thumb"
                style={preview ? { backgroundImage: `url(${mediaUrl(preview.path)})` } : undefined}
              />
              <span>{buttonLabel}</span>
            </button>
          );
        })}
      </div>
      <div className="gd-thumb-tools">
        <button type="button" disabled={!focusOn} onClick={onPickFrame}>
          フレームを選ぶ
        </button>
        <button
          type="button"
          disabled={!focusOn || !project.thumbnail?.frame}
          onClick={() =>
            writeThumbnail((thumb) => {
              delete thumb.frame;
            })
          }
        >
          03に合わせる
        </button>
        <button
          type="button"
          disabled={!focusOn}
          onClick={() =>
            writeThumbnail((thumb) => {
              thumb.focus = { x: 0.5, y: 0.5 };
            })
          }
        >
          中央に戻す
        </button>
        <TrimTimeField
          label="拡大率"
          value={zoom}
          min={THUMB_FOCUS.zoom.min}
          max={THUMB_FOCUS.zoom.max}
          step={THUMB_FOCUS.zoom.step}
          disabled={!focusOn}
          onChange={(next) => {
            const rounded = Math.min(THUMB_FOCUS.zoom.max, Math.max(THUMB_FOCUS.zoom.min, Number(next.toFixed(2))));
            writeThumbnail((thumb) => {
              thumb.zoom = rounded;
            });
          }}
        />
      </div>
      {focusOn && upscale !== null && upscale > THUMB_FOCUS.zoom.warnUpscale ? (
        <p className="gd-review-thumb-note">拡大が{upscale.toFixed(2)}倍です。1.60倍を超えると最終確認で警告します</p>
      ) : null}
    </section>
  );
};

export const CardStep = ({
  project,
}: {
  project: Project;
}) => {
  const candidates = cardCandidates(project);
  const videos = videosOf(project);
  const [pickerRole, setPickerRole] = useState<CardStillRole | null>(null);
  const [thumbPicker, setThumbPicker] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const capture = async (assetId: string, role: CardStillRole, seconds: number): Promise<boolean> => {
    const asset = project.assets.find((item) => item.id === assetId && item.type === 'video');
    if (!asset || extracting) return false;
    const roundedSeconds = Math.round(Math.max(0, seconds) * 1000) / 1000;
    const existing = project.stills.find(
      (still) => still.assetId === assetId && Math.abs(still.frame - roundedSeconds) < 0.08,
    );
    if (existing) {
      update((current) => {
        current.cardStills[role] = existing.id;
        return current;
      });
      return true;
    }
    const stillId = crypto.randomUUID();
    setExtracting(true);
    try {
      const stillPath = await window.studio.extractStill(
        asset.path,
        project.id,
        stillId,
        roundedSeconds,
      );
      update((current) => {
        current.stills.push({
          id: stillId,
          assetId,
          frame: roundedSeconds,
          role,
          path: stillPath,
        });
        current.cardStills[role] = stillId;
        return current;
      });
      return true;
    } catch (error: unknown) {
      useStudioStore.getState().setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setExtracting(false);
    }
  };

  const pick = (candidate: (typeof candidates.stand)[number]): void => {
    void capture(candidate.assetId, candidate.role, candidate.seconds);
  };

  const stillFor = (candidate: (typeof candidates.stand)[number]) =>
    project.stills.find(
      (still) => still.assetId === candidate.assetId && Math.abs(still.frame - candidate.seconds) < 0.08,
    );

  return (
    <div className="gd-step">
      <StepHead
        step={4}
        title="カード用画像"
        text="登録済みの動画からフレームを選びます。切り抜き済みのシーンがあれば、その範囲も候補に出ます。選んだ画像はドラッグかスライダーで切り抜き位置を上下左右にずらします"
      />
      <div className="gd-card-grid">
        {(Object.keys(CARD_COPY) as Array<keyof typeof CARD_COPY>).map((role) => {
          const copy = CARD_COPY[role];
          const selected = project.stills.find((still) => still.id === project.cardStills[role]);
          const chosen = candidates[role].find(
            (candidate) =>
              selected &&
              candidate.assetId === selected.assetId &&
              Math.abs(candidate.seconds - selected.frame) < 0.08,
          );
          const names = CANDIDATE_LABEL[role];
          const caption = selected
            ? `${chosen ? (names[chosen.label]?.hero ?? chosen.label) : '指定フレーム'} ${frameStamp(selected.frame)}`
            : '';
          return (
            <section key={role} className="gd-still-card">
              <div className="gd-still-head">
                <span className="gd-still-num">{copy.index}</span>
                <strong>{copy.title}</strong>
                {selected && <span className="gd-still-ok">✓ 選択済み</span>}
              </div>
              {role === 'aim' ? (
                <AimStillPreview project={project} still={selected} caption={caption} />
              ) : (
                <StillFramePreview project={project} role={role} still={selected} caption={caption} />
              )}
              <span className="gd-still-note">{copy.note}</span>
              <span className="gd-still-kicker">候補</span>
              <div className="gd-still-row">
                {candidates[role].map((candidate) => {
                  const on = Boolean(
                    selected &&
                    candidate.assetId === selected.assetId &&
                    Math.abs(candidate.seconds - selected.frame) < 0.08,
                  );
                  const preview = stillFor(candidate);
                  const buttonLabel = names[candidate.label]?.button ?? candidate.label;
                  return (
                    <button
                      key={`${candidate.assetId}-${candidate.label}-${candidate.seconds}`}
                      type="button"
                      className={on ? 'is-on' : ''}
                      aria-label={`${buttonLabel} を使う`}
                      disabled={extracting}
                      onClick={() => pick(candidate)}
                    >
                      <span
                        className="gd-still-thumb"
                        style={preview ? { backgroundImage: `url(${mediaUrl(preview.path)})` } : undefined}
                      />
                      <span>{buttonLabel}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="gd-frame-pick"
                disabled={videos.length === 0 || extracting}
                onClick={() => setPickerRole(role)}
              >
                別の動画・フレームから選ぶ
              </button>
              {role === 'aim' && <AimZoomControls project={project} />}
            </section>
          );
        })}
      </div>
      <ThumbSetup project={project} onPickFrame={() => setThumbPicker(true)} />
      <section className="gd-layout-block">
        <strong>動画での表示秒数（S5）</strong>
        <div className="gd-trim-seconds-row">
          <label className="gd-trim-seconds">
            秒数
            <input
              type="number"
              min={sceneDurationLimits('card').min}
              max={sceneDurationLimits('card').max}
              step={0.1}
              value={Number(sceneItemDuration(project, 'card').toFixed(1))}
              aria-label="S5カードの表示秒数"
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                update((current) => applySceneCutDuration(current, 'card', next));
              }}
            />
          </label>
          <span className="gd-trim-src">初期値 {builtinSceneDuration('card').toFixed(1)}秒</span>
        </div>
      </section>
      <section className="gd-layout-block">
        <strong>カードのレイアウト</strong>
        <div className="gd-layouts">
          <label className={project.cardLayout !== 'stack' ? 'gd-layout is-on' : 'gd-layout'}>
            <input
              type="radio"
              name="card-layout"
              checked={project.cardLayout !== 'stack'}
              onChange={() =>
                update((current) => {
                  current.cardLayout = 'aim';
                  return current;
                })
              }
            />
            <span className="gd-layout-preview gd-layout-a" aria-hidden="true">
              <i className="is-hot" />
              <span>
                <i />
                <i />
              </span>
            </span>
            <span>
              <strong>A案：合わせ位置を大きく</strong>
              <em>日本語はA案、英語はC案で書き出します</em>
            </span>
          </label>
          <label className={project.cardLayout === 'stack' ? 'gd-layout is-on' : 'gd-layout'}>
            <input
              type="radio"
              name="card-layout"
              checked={project.cardLayout === 'stack'}
              onChange={() =>
                update((current) => {
                  current.cardLayout = 'stack';
                  return current;
                })
              }
            />
            <span className="gd-layout-preview gd-layout-b" aria-hidden="true">
              <i />
              <i className="is-hot" />
              <i />
            </span>
            <span>
              <strong>B案：縦3ステップ</strong>
              <em>日英ともB案で書き出します</em>
            </span>
          </label>
        </div>
      </section>
      {pickerRole && (() => {
        const selected = project.stills.find((still) => still.id === project.cardStills[pickerRole]);
        const fallback = candidates[pickerRole][0];
        const initialAssetId = selected?.assetId ?? fallback?.assetId ?? videos[0]?.id ?? '';
        const initialSeconds = selected?.frame ?? fallback?.seconds ?? 0;
        return (
          <CardFramePicker
            key={`${pickerRole}-${initialAssetId}-${initialSeconds}`}
            project={project}
            role={pickerRole}
            initialAssetId={initialAssetId}
            initialSeconds={initialSeconds}
            busy={extracting}
            onCapture={(assetId, seconds) => capture(assetId, pickerRole, seconds)}
            onClose={() => setPickerRole(null)}
          />
        );
      })()}
      {thumbPicker && (() => {
        const pick = resolveFocusFrame(project);
        const fallback = candidates.result[0];
        return (
          <CardFramePicker
            key={`thumb-${pick?.assetId ?? ''}-${pick?.timeSec ?? 0}`}
            project={project}
            role="result"
            heading="サムネイルの画像を選ぶ"
            initialAssetId={pick?.assetId ?? fallback?.assetId ?? videos[0]?.id ?? ''}
            initialSeconds={pick?.timeSec ?? fallback?.seconds ?? 0}
            busy={false}
            onCapture={async (assetId, seconds) => {
              const timeSec = Math.round(Math.max(0, seconds) * 1000) / 1000;
              writeThumbnail((thumb) => {
                thumb.layout = 'focus';
                thumb.frame = { assetId, timeSec };
              });
              return true;
            }}
            onClose={() => setThumbPicker(false)}
          />
        );
      })()}
    </div>
  );
};

const CAPTION_ROWS = [
  ['hook', 'HOOK', 'フック · 最大3行'],
  ['stand', 'STAND', '立ち位置'],
  ['throw', 'AIM', '狙い（投げ方）'],
  ['cta', 'CTA', 'ループ'],
] as const;

export type CaptionPreviewId = (typeof CAPTION_ROWS)[number][0];
export type CaptionPreviewTarget = CaptionPreviewId | 'card' | 'x' | 'thumb';

const captionScene = (project: Project, id: (typeof CAPTION_ROWS)[number][0], hint: string): string => {
  if (id === 'cta') {
    return resolveCtaDesign(project) === 's4-block' ? 'S4 発動イメージ' : `S7 ${hint}`;
  }
  if (id === 'hook') return `S1 ${hint}`;
  if (id === 'stand') return 'S2 立ち位置';
  return 'S3 狙い（投げ方）';
};

const lineupNote = (
  body: string,
  language: Language,
): { text: string; warn: boolean } => {
  if (!body) {
    return {
      text:
        language === 'en'
          ? '! 英語の説明が未入力のため空になります → 1 定点情報で入力'
          : '! 日本語の説明が未入力です → 1 定点情報で入力',
      warn: true,
    };
  }
  return {
    text: language === 'ja' ? `定点の説明から：${body}` : `From lineup: ${body}`,
    warn: false,
  };
};

const fieldNote = (
  id: (typeof CAPTION_ROWS)[number][0],
  language: Language,
  text: string,
  project: Project,
): { text: string; warn: boolean } => {
  const metrics = captionMetrics(text, project, language, id);
  if (id === 'cta') {
    if (resolveCtaDesign(project) === 's4-block' && likeCtaActive(project)) {
      const text = resolveLikeCtaText(project);
      const fit = likeCtaFitWarning(language, text.before[language], text.after[language]);
      if (fit) return { text: fit, warn: true };
      const stock = text.line1[language] === LIKE_CTA_COPY[language].line1;
      if (!text.line1[language].trim()) return { text: '空にすると動画に出ません', warn: false };
      return { text: stock ? '高評価CTAの定型文' : '手入力', warn: false };
    }
    if (resolveCtaDesign(project) === 's4-block') {
      const stored = project.templateParams.s4Cta;
      const main = (stored?.main[language] ?? S4_CTA_COPY[language].main).trim();
      if (!main) return { text: '空にすると動画に出ません', warn: false };
      return {
        text: main === S4_CTA_COPY[language].main ? '短尺CTAの定型文' : '手入力',
        warn: false,
      };
    }
    if (!text.trim()) return { text: '空にすると動画に出ません', warn: false };
    return { text: text.trim() === CTA_TEXT[language] ? '定型文から' : '手入力', warn: false };
  }
  if (id === 'hook') {
    const pattern = project.hookPattern;
    const fromPattern = pattern !== 'custom' && text === HOOK_PATTERNS[pattern][language];
    return { text: `${metrics.lines}行 · ${fromPattern ? '型の下書きから' : '手入力'}`, warn: false };
  }
  if (text.includes('{standDescription}')) {
    return lineupNote(project.lineup.standDescription[language].trim(), language);
  }
  if (text.includes('{aimDescription}')) {
    return lineupNote(project.lineup.aimDescription[language].trim(), language);
  }
  if (text.includes('{throwType}') && text.replaceAll('{throwType}', '').trim() === '') {
    const label = project.lineup.throwType[language].trim();
    return { text: label || '投げ方が未設定です', warn: !label };
  }
  return { text: `${metrics.lines}行`, warn: metrics.empty && language === 'en' };
};

export const CaptionStep = ({
  project,
  onGoto,
  previewing,
  onPreview,
}: {
  project: Project;
  onGoto: (step: GuideStepId) => void;
  previewing: CaptionPreviewTarget;
  onPreview: (id: CaptionPreviewTarget, language?: Language) => void;
}) => {
  const [splitHook, setSplitHook] = useState(false);
  const [editStandAim, setEditStandAim] = useState(false);
  const [editCta, setEditCta] = useState(false);

  const ensureCaption = (current: Project, id: string): Caption | undefined => {
    const existing = current.captions.find((item) => item.id === id);
    if (existing) return existing;
    if (id !== 'cta') return undefined;
    const created = defaultCtaCaption();
    current.captions.push(created);
    return created;
  };

  const writeLike = (language: Language, field: 'line1' | 'before' | 'after', value: string): void => {
    update((current) => {
      const text: S4LikeCtaText = resolveLikeCtaText(current);
      current.templateParams = {
        ...current.templateParams,
        s4LikeCta: { ...text, [field]: { ...text[field], [language]: value } },
      };
      return current;
    });
  };

  const writeS4 = (language: Language, field: 'main' | 'sub', value: string): void => {
    update((current) => {
      const text: S4CtaText = current.templateParams.s4Cta ?? {
        main: { ja: S4_CTA_COPY.ja.main, en: S4_CTA_COPY.en.main },
        sub: { ja: S4_CTA_COPY.ja.sub, en: S4_CTA_COPY.en.sub },
      };
      current.templateParams = {
        ...current.templateParams,
        s4Cta: { ...text, [field]: { ...text[field], [language]: value } },
      };
      return current;
    });
  };

  const writeCaption = (id: string, language: Language, value: string): void => {
    update((current) => {
      const index = current.captions.findIndex((item) => item.id === id);
      if (index < 0) {
        const created = ensureCaption(current, id);
        if (!created) return current;
        created.text = { ...created.text, [language]: value };
        if (id === 'cta' && value.trim()) created.hidden = false;
        if (id === 'hook') current.hookPattern = 'custom';
        return current;
      }
      const target = current.captions[index];
      if (!target) return current;
      const next = {
        ...target,
        text: { ...target.text, [language]: value },
        hidden: id === 'cta' && value.trim() ? false : target.hidden,
      };
      return {
        ...current,
        hookPattern: id === 'hook' ? 'custom' : current.hookPattern,
        captions: current.captions.map((item, itemIndex) => (itemIndex === index ? next : item)),
      };
    });
  };

  return (
    <div className="gd-step gd-captions-step">
      <StepHead
        step={5}
        title="テロップ"
        text="特徴と雰囲気からフック・英語タイトル・固定コメントの案を出します。STAND・AIM は定点情報の定型、CTA は「高評価して見返す」のままです。変えたいときだけ開いてください"
      />
      <WordingIdeas project={project} />
      <section className="gd-captions">
        <div className="gd-caption-head">
          <span />
          <span>日本語</span>
          <span>English</span>
        </div>
        {CAPTION_ROWS.map(([id, label, hint]) => {
          if ((id === 'stand' || id === 'throw') && !editStandAim) return null;
          if (id === 'cta' && !editCta) return null;
          const caption =
            project.captions.find((item) => item.id === id) ??
            (id === 'cta' ? defaultCtaCaption() : undefined);
          if (!caption) return null;
          const rowOrder = id === 'hook' ? 1 : id === 'cta' ? 7 : 5;
          return (
            <div key={id} className="gd-caption-row" style={{ order: rowOrder }}>
              <div className="gd-caption-label">
                <strong>{label}</strong>
                <span>{captionScene(project, id, hint)}</span>
                <button
                  type="button"
                  className={`gd-caption-watch ${previewing === id ? 'is-on' : ''}`}
                  aria-pressed={previewing === id}
                  onClick={() => onPreview(id)}
                >
                  シーンを見る
                </button>
                {id === 'cta' && (
                  <select
                    aria-label="CTAデザイン"
                    className="gd-cta-design"
                    value={resolveCtaDesign(project)}
                    onChange={(event) => {
                      const ctaDesign = event.target.value as CtaDesign;
                      update((current) => {
                        current.templateParams = { ...current.templateParams, ctaDesign };
                        return current;
                      });
                    }}
                  >
                    {CTA_DESIGN_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                {id === 'cta' && (
                  <label className="gd-cta-show">
                    <input
                      type="checkbox"
                      checked={!caption.hidden}
                      onChange={(event) => {
                        const shown = event.target.checked;
                        update((current) => {
                          const target = ensureCaption(current, 'cta');
                          if (target) target.hidden = !shown;
                          return current;
                        });
                      }}
                    />
                    {resolveCtaDesign(project) === 's4-block' ? 'S4の末尾に表示' : '表示する'}
                  </label>
                )}
                {id === 'cta' && resolveCtaDesign(project) === 's4-block' && (
                  <>
                    <select
                      aria-label="CTAの目的"
                      className="gd-cta-design"
                      value={resolveS4CtaPurpose(project)}
                      onChange={(event) => {
                        const s4CtaPurpose = event.target.value as S4CtaPurpose;
                        update((current) => {
                          current.templateParams = { ...current.templateParams, s4CtaPurpose };
                          return current;
                        });
                      }}
                    >
                      <option value="like">高評価して見返す</option>
                      <option value="cv">ClutchVaultへ案内</option>
                    </select>
                    {likeCtaActive(project) && (
                      <label className="gd-cta-show">
                        <input
                          type="checkbox"
                          checked={resolveLikeCtaText(project).motion !== false}
                          onChange={(event) => {
                            const motion = event.target.checked;
                            update((current) => {
                              const text = resolveLikeCtaText(current);
                              current.templateParams = {
                                ...current.templateParams,
                                s4LikeCta: { ...text, motion },
                              };
                              return current;
                            });
                          }}
                        />
                        👍を軽く弾ませる
                      </label>
                    )}
                  </>
                )}
              </div>
              {(['ja', 'en'] as const).map((language) => {
                const note = fieldNote(id, language, caption.text[language], project);
                const empty = language === 'en' && captionMetrics(caption.text[language], project, language, id).empty;
                const s4 = id === 'cta' && resolveCtaDesign(project) === 's4-block';
                const like = s4 && likeCtaActive(project);
                const s4Text: S4CtaText = project.templateParams.s4Cta ?? {
                  main: { ja: S4_CTA_COPY.ja.main, en: S4_CTA_COPY.en.main },
                  sub: { ja: S4_CTA_COPY.ja.sub, en: S4_CTA_COPY.en.sub },
                };
                const likeText = resolveLikeCtaText(project);
                if (like) {
                  return (
                    <div key={language} className="gd-caption-field">
                      <label className="gd-cta-line">
                        1行目
                        <input
                          aria-label={`高評価CTA 1行目（${language === 'ja' ? '日本語' : '英語'}）`}
                          value={likeText.line1[language]}
                          onChange={(event) => writeLike(language, 'line1', event.target.value)}
                        />
                      </label>
                      <label className="gd-cta-line">
                        👍の前
                        <input
                          aria-label={`高評価CTA 👍の前（${language === 'ja' ? '日本語' : '英語'}）`}
                          value={likeText.before[language]}
                          onChange={(event) => writeLike(language, 'before', event.target.value)}
                        />
                      </label>
                      <span className="gd-cta-token">👍 固定</span>
                      <label className="gd-cta-line">
                        👍の後
                        <input
                          aria-label={`高評価CTA 👍の後（${language === 'ja' ? '日本語' : '英語'}）`}
                          value={likeText.after[language]}
                          onChange={(event) => writeLike(language, 'after', event.target.value)}
                        />
                      </label>
                      <span className={`gd-caption-note${note.warn ? ' is-warn' : ''}`}>{note.text}</span>
                    </div>
                  );
                }
                if (s4) {
                  return (
                    <div key={language} className="gd-caption-field">
                      <label className="gd-cta-line">
                        主文
                        <textarea
                          aria-label={`CTA主文（${language === 'ja' ? '日本語' : '英語'}）`}
                          value={s4Text.main[language]}
                          onFocus={() => onPreview(id, language)}
                          onChange={(event) => writeS4(language, 'main', event.target.value)}
                        />
                      </label>
                      <label className="gd-cta-line">
                        補助行
                        <textarea
                          aria-label={`CTA補助行（${language === 'ja' ? '日本語' : '英語'}）`}
                          value={s4Text.sub[language]}
                          onFocus={() => onPreview(id, language)}
                          onChange={(event) => writeS4(language, 'sub', event.target.value)}
                        />
                      </label>
                      <span className="gd-caption-note">{note.text}</span>
                    </div>
                  );
                }
                return (
                  <div key={language} className="gd-caption-field">
                    <textarea
                      aria-label={`${label}（${language === 'ja' ? '日本語' : '英語'}）`}
                      className={empty ? 'is-warn' : ''}
                      value={caption.text[language]}
                      onFocus={() => onPreview(id, language)}
                      onChange={(event) => writeCaption(id, language, event.target.value)}
                    />
                    {note.warn ? (
                      <button type="button" className="gd-caption-note is-warn" onClick={() => onGoto(1)}>
                        {note.text}
                      </button>
                    ) : (
                      <span className="gd-caption-note">{note.text}</span>
                    )}
                    {id === 'throw' && language === 'en' && (
                      <span className="gd-aim-templates">
                        {(
                          [
                            ['AIM {aimDescription}', 'AIM {aimDescription}'],
                            ['THROW {throwType}', 'THROW {throwType}'],
                            ['JUMP + THROW', 'JUMP + THROW'],
                          ] as const
                        ).map(([label, value]) => (
                          <button key={label} type="button" onClick={() => writeCaption(id, 'en', value)}>
                            {label}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <button
          type="button"
          className="gd-link gd-split-link"
          style={{ order: 2 }}
          aria-expanded={splitHook}
          onClick={() => setSplitHook((value) => !value)}
        >
          フックの改行を、動画・完成カード・X用カード・サムネイルで分ける
        </button>
        {splitHook && (
        <section className="gd-captions" style={{ order: 3 }}>
          {(
            [
              ['cardText', 'card', '完成カード', '空なら動画と同じ'],
              ['xText', 'x', 'X用カード', '空なら動画と同じ'],
              ['thumbText', 'thumb', 'サムネイル', '空なら動画と同じ · 最大3行'],
            ] as const
          ).map(([field, target, label, hint]) => (
            <div key={field} className="gd-caption-row">
              <div className="gd-caption-label">
                <strong>{label}</strong>
                <span>{hint}</span>
                <button
                  type="button"
                  className={`gd-caption-watch ${previewing === target ? 'is-on' : ''}`}
                  aria-pressed={previewing === target}
                  onClick={() => onPreview(target)}
                >
                  {target === 'thumb' ? 'サムネイルを見る' : 'カードを見る'}
                </button>
              </div>
              {(['ja', 'en'] as const).map((language) => (
                <div key={language} className="gd-caption-field">
                  <textarea
                    aria-label={`${label}（${language === 'ja' ? '日本語' : '英語'}）`}
                    value={project.captions.find((item) => item.id === 'hook')?.[field]?.[language] ?? ''}
                    onFocus={() => onPreview(target, language)}
                    onChange={(event) =>
                      update((current) => {
                        const hook = current.captions.find((item) => item.id === 'hook');
                        if (!hook) return current;
                        const prev = hook[field] ?? { ja: '', en: '' };
                        hook[field] = { ...prev, [language]: event.target.value };
                        return current;
                      })
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </section>
        )}
        <button
          type="button"
          className="gd-link gd-split-link"
          style={{ order: 4 }}
          aria-expanded={editStandAim}
          onClick={() => setEditStandAim((value) => !value)}
        >
          STAND・AIM の文言を変更する
        </button>
        <button
          type="button"
          className="gd-link gd-split-link"
          style={{ order: 6 }}
          aria-expanded={editCta}
          onClick={() => setEditCta((value) => !value)}
        >
          CTA を変更する
        </button>
      </section>
    </div>
  );
};

const SOURCE_LABEL: Record<AudioTrack['source'], string> = {
  bgmer: 'BGMer',
  musmus: 'MusMus',
  opentracks: 'OpenTracks',
  ytal: 'YTal',
  other: 'その他',
};

const SCENE_CODE: Record<SceneKey, string> = {
  hook: 'S1',
  stand: 'S2',
  aim: 'S3',
  throw: 'S4',
  card: 'S5',
  demo: 'S6',
  loop: 'S7',
};

const clock = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.round(safe - minutes * 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

const licenseChip = (track: AudioTrack): { label: string; tone: 'ok' | 'warn' | 'plain' } => {
  if (track.authorTermsNote.trim()) return { label: '作者の条件あり', tone: 'warn' };
  if (track.creditRequired) return { label: 'クレジット必須', tone: 'plain' };
  return { label: 'クレジット任意', tone: 'ok' };
};

const PlayMark = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4l13 8-13 8z" fill="currentColor" />
  </svg>
);

const StopMark = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6h12v12H6z" fill="currentColor" />
  </svg>
);

export const SoundStep = ({
  project,
  tracks,
  usage,
  onApply,
  onPreview,
}: {
  project: Project;
  tracks: AudioTrack[];
  usage: AudioUsageRecord[];
  onApply: (apply: (project: Project) => Project) => void;
  onPreview: () => void;
}) => {
  const playingId = useSyncExternalStore(subscribeBgmPreview, getBgmPreviewTrackId, getBgmPreviewTrackId);
  const [volume, setVolume] = useState(() => project.audio.bgm?.gain ?? 0.02);
  const bgm = tracks.filter((track) => track.kind === 'bgm');
  const selected = tracks.find((track) => track.id === project.audio.bgm?.audioTrackId) ?? null;
  const timeline = activeTimeline(project);
  const selectedPlatforms = platformsFor(project.guide.exportPresets);
  const license = licenseSummary(selected, selectedPlatforms);
  const [useSceneBgm, setUseSceneBgm] = useState(true);
  const [useGame, setUseGame] = useState(true);
  const platforms = selectedPlatforms
    .map((platform) => (platform === 'youtube' ? 'YouTube' : platform === 'tiktok' ? 'TikTok' : 'X'))
    .join('・');
  const licenseText =
    selected && license.ok && !selected.creditRequired
      ? `選んだ音源は、書き出し設定の投稿先（${platforms || '未選択'}）すべてで使えます。クレジット表記は不要です`
      : license.message;
  const gameLine = '全シーン 10%';

  useEffect(() => {
    onApply((current) => {
      const next = applyDefaultVolumes(current, useGame, useSceneBgm);
      if (!next.guide.confirmedSteps.includes('sound')) {
        next.guide.confirmedSteps = [...next.guide.confirmedSteps, 'sound'];
      }
      return next;
    });
  }, [onApply, useGame, useSceneBgm]);

  useEffect(() => () => stopBgmPreview(), []);

  useEffect(() => {
    setBgmPreviewVolume(volume);
  }, [volume]);

  const applyVolume = (next: number): void => {
    const gain = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 1));
    setVolume(gain);
    setBgmPreviewVolume(gain);
    update((current) => {
      if (!current.audio.bgm) return current;
      current.audio.bgm.gain = gain;
      return current;
    });
  };

  const previewTrack = (track: AudioTrack): void => {
    if (playingId === track.id) {
      stopBgmPreview();
      return;
    }
    onPreview();
    playBgmPreview(track.id, mediaUrl(track.filePath));
  };

  const openEditor = (): void => {
    update((current) => {
      current.guide.mode = 'editor';
      return current;
    });
  };

  const effectPlace = (start: number): string => {
    const item = timeline.items.find(
      (entry) => start + 0.001 >= entry.start && start < entry.start + entry.duration,
    );
    const code = item ? SCENE_CODE[item.sceneKey] : '';
    return code ? `${code} · ${start.toFixed(1)}s` : `${start.toFixed(1)}s`;
  };

  return (
    <div className="gd-step">
      <StepHead step={6} title="BGM・効果音" text="前回の設定が入っています。変えなければ、確認して次へ進むだけで大丈夫です" />
      <section className="gd-sound-block">
        <div className="gd-panel-title">
          <strong>BGM</strong>
          <span className="gd-spacer" />
          <button type="button" className="gd-mini" disabled={playingId === null} onClick={() => stopBgmPreview()}>
            停止
          </button>
          <button type="button" className="gd-link" onClick={openEditor}>
            ＋ 音源を登録（ダウンロードしたファイル）
          </button>
        </div>
        {bgm.map((track) => {
          const chosen = project.audio.bgm?.audioTrackId === track.id;
          const count = usage.filter((item) => item.audioTrackId === track.id).length;
          const chip = licenseChip(track);
          return (
            <label key={track.id} className={`gd-bgm ${chosen ? 'is-on' : ''}`}>
              <input
                type="radio"
                name="bgm"
                checked={chosen}
                onChange={() =>
                  update((current) => {
                    current.audio.bgm = {
                      ...defaultBgmPlacement(current, track.id),
                      gain: getBgmPreviewVolume(),
                    };
                    return current;
                  })
                }
              />
              <button
                type="button"
                className={`gd-play ${playingId === track.id ? 'is-playing' : ''}`}
                aria-label={playingId === track.id ? `${track.title} を停止` : `${track.title} を試聴`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  previewTrack(track);
                }}
              >
                {playingId === track.id ? <StopMark /> : <PlayMark />}
              </button>
              <strong>{track.title}</strong>
              <span className="gd-mono">{clock(track.durationSec)}</span>
              <span className="gd-chip">{SOURCE_LABEL[track.source]}</span>
              <span className={`gd-chip is-${chip.tone}`}>{chip.label}</span>
              <span className="gd-spacer" />
              <span className="gd-muted">
                {chosen ? `前回と同じ · 使用 ${count}回` : count > 0 ? `使用 ${count}回` : '未使用'}
              </span>
            </label>
          );
        })}
        <label className={`gd-bgm ${project.audio.bgm ? '' : 'is-on'}`}>
          <input
            type="radio"
            name="bgm"
            checked={!project.audio.bgm}
            onChange={() =>
              update((current) => {
                current.audio.bgm = null;
                return current;
              })
            }
          />
          <span className="gd-play" aria-hidden="true">
            <PlayMark />
          </span>
          <strong>BGMなし</strong>
          <span className="gd-chip">—</span>
          <span className="gd-chip">TikTokで後から付ける</span>
        </label>
        <label className="gd-bgm-volume">
          <span>BGMの音量</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            aria-label="BGMの音量"
            onChange={(event) => applyVolume(Number(event.target.value) / 100)}
          />
          <span className="gd-mono">{Math.round(volume * 100)}%</span>
        </label>
        <div className="gd-checks-row">
          <label>
            <input type="checkbox" checked={useSceneBgm} onChange={(event) => setUseSceneBgm(event.target.checked)} />
            シーンごとの既定の音量を使う（全シーン 40%）
          </label>
          <label>
            <input
              type="checkbox"
              checked={project.audio.bgm?.ducking ?? true}
              onChange={(event) =>
                update((current) => {
                  if (!current.audio.bgm) return current;
                  current.audio.bgm.ducking = event.target.checked;
                  return current;
                })
              }
            />
            ダッキング（ゲーム音が大きい所で下げる）
          </label>
        </div>
      </section>
      <section className="gd-panel gd-sound-block">
        <div className="gd-panel-title">
          <strong>効果音</strong>
          <span className="gd-muted">既定のセット（前回と同じ）</span>
          <span className="gd-spacer" />
          <button type="button" className="gd-mini" onClick={openEditor} title="効果音の割り当ては詳細編集で行います">
            セットを変える
          </button>
        </div>
        <div className="gd-effects">
          {timeline.effects.map((effect) => {
            const track = tracks.find((item) => item.id === effect.audioTrackId);
            return (
              <div key={effect.id} className="gd-effect">
                <strong>{effect.label}</strong>
                <span className="gd-mono">{effectPlace(effect.start)}</span>
                <span className={track ? 'is-set' : 'is-empty'}>{track ? `✓ ${track.title}` : '未設定'}</span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="gd-game">
        <strong>ゲーム音</strong>
        <label>
          <input type="checkbox" checked={useGame} onChange={(event) => setUseGame(event.target.checked)} />
          既定の配分を使う
        </label>
        <span className="gd-muted">{gameLine}</span>
      </section>
      <div className={`gd-banner ${license.ok ? 'is-ok' : 'is-warn'}`}>{license.ok ? `✓ ${licenseText}` : licenseText}</div>
      <p className="gd-sound-note">音量の点を動かす・効果音の位置を変えるなどの細かい調整は、詳細編集のタイムラインで行えます</p>
    </div>
  );
};

const ReviewClock = ({
  playerRef,
  fps,
  durationInFrames,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  durationInFrames: number;
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
  }, [playerRef, durationInFrames]);
  return (
    <span className="gd-review-time">
      {frameStamp(frame / fps)} / {frameStamp(durationInFrames / fps)}
    </span>
  );
};

const ReviewSeek = ({
  jaRef,
  enRef,
  fps,
  durationInFrames,
}: {
  jaRef: RefObject<PlayerRef | null>;
  enRef: RefObject<PlayerRef | null>;
  fps: number;
  durationInFrames: number;
}) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const player = jaRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }): void => {
      setFrame(event.detail.frame);
    };
    player.addEventListener('frameupdate', onFrame);
    setFrame(player.getCurrentFrame());
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [jaRef, durationInFrames]);
  const max = Math.max(0, durationInFrames - 1);
  const clamped = Math.min(frame, max);
  const progress = max === 0 ? 0 : (clamped / max) * 100;
  return (
    <input
      className="gd-preview-seek"
      type="range"
      min={0}
      max={max}
      step={1}
      value={clamped}
      aria-label="再生位置"
      aria-valuetext={`${frameStamp(clamped / fps)} / ${frameStamp(durationInFrames / fps)}`}
      disabled={max === 0}
      style={{ '--seek': `${progress}%` } as CSSProperties}
      onChange={(event) => {
        const next = Math.min(max, Math.max(0, Number(event.target.value)));
        setFrame(next);
        jaRef.current?.seekTo(next);
        enRef.current?.seekTo(next);
      }}
    />
  );
};

const FIX_STEP: Record<number, string> = {
  1: '定点情報',
  2: '動画選択',
  3: '切り抜き',
  4: 'カード用画像',
  5: 'テロップ',
  6: 'BGM・効果音',
};

const ReviewThumbnail = ({
  project,
  language,
  width,
  caption,
  surface,
  onSurface,
  actualSize,
  onActualSize,
  showSafeZone,
  showControls,
}: {
  project: Project;
  language: 'ja' | 'en';
  width: number;
  caption: string;
  surface: ThumbSurface;
  onSurface: (surface: ThumbSurface) => void;
  actualSize: boolean;
  onActualSize: (value: boolean) => void;
  showSafeZone: boolean;
  showControls: boolean;
}) => {
  return (
    <div className="gd-review-thumb" style={actualSize ? undefined : { width }}>
      <span>{caption}</span>
      <ThumbnailStage
        project={project}
        language={language}
        fps={project.templateParams.fps}
        surface={surface}
        onSurface={onSurface}
        actualSize={actualSize}
        onActualSize={onActualSize}
        showSafeZone={showSafeZone}
        showControls={showControls}
      />
    </div>
  );
};

export const ReviewStep = ({
  project,
  tracks,
  onGoto,
  onGate,
}: {
  project: Project;
  tracks: AudioTrack[];
  onGoto: (step: GuideStepId) => void;
  onGate: (gate: () => void) => void;
}) => {
  const items = reviewItems(project, tracks);
  const errors = items.some((item) => item.level === 'error');
  const warnings = items.some((item) => item.level === 'warn');
  const [ask, setAsk] = useState(false);
  const [safeZone, setSafeZone] = useState(false);
  const [showYtGuide, setShowYtGuide] = useState(false);
  const [thumbSurface, setThumbSurface] = useState<ThumbSurface>('yt');
  const [thumbActual, setThumbActual] = useState(true);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const jaRef = useRef<PlayerRef>(null);
  const enRef = useRef<PlayerRef>(null);
  const holdFrame = useRef<number | null>(null);
  const fps = project.templateParams.fps;
  const durationInFrames = Math.max(1, Math.round(activeTimeline(project).durationSec * fps));
  // inputProps の参照が変わると Remotion が再生クロックを作り直し、映像だけ進んだあと巻き戻る。
  const sharedInput = useMemo(
    () => ({
      project,
      mediaBaseUrl: 'studio-media://root',
      showSafeZone: safeZone,
      showYtGuide,
      audioTracks: tracks,
      audioTrack: tracks.find((track) => track.id === project.audio.bgm?.audioTrackId),
    }),
    [project, safeZone, showYtGuide, tracks],
  );
  const jaInput = useMemo(() => ({ ...sharedInput, language: 'ja' as const }), [sharedInput]);
  const enInput = useMemo(() => ({ ...sharedInput, language: 'en' as const }), [sharedInput]);

  const commit = (): void => {
    update((current) => {
      if (!current.guide.confirmedSteps.includes('review')) {
        current.guide.confirmedSteps = [...current.guide.confirmedSteps, 'review'];
      }
      const next = guideStepAfter(7);
    if (next) current.guide.lastStep = next;
      current.guide.mode = 'guide';
      return current;
    });
  };

  useEffect(() => {
    onGate(() => {
      if (errors) return;
      if (warnings) {
        setAsk(true);
        return;
      }
      commit();
    });
  }, [onGate, errors, warnings]);

  useEffect(() => {
    const frame = holdFrame.current;
    if (frame == null) return;
    holdFrame.current = null;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        jaRef.current?.seekTo(frame);
        enRef.current?.seekTo(frame);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [project.thumbnailFrame]);

  useEffect(() => {
    const ja = jaRef.current;
    const en = enRef.current;
    if (!ja || !en) return;
    let lastSync = 0;
    const onFrame = (event: { detail: { frame: number } }): void => {
      if (!playingRef.current) return;
      const frame = event.detail.frame;
      const other = en.getCurrentFrame();
      const nearStart = (value: number): boolean => value < fps;
      const nearEnd = (value: number): boolean => value > durationInFrames - fps * 2;
      if (nearEnd(frame) && nearStart(other)) return;
      const drift = Math.abs(other - frame);
      const now = performance.now();
      const leaderLooped = nearStart(frame) && nearEnd(other);
      if ((leaderLooped || drift > Math.max(3, Math.round(fps * 0.25))) && now - lastSync > 700) {
        en.seekTo(frame);
        lastSync = now;
      }
    };
    ja.addEventListener('frameupdate', onFrame);
    return () => ja.removeEventListener('frameupdate', onFrame);
  }, [project.id, durationInFrames, fps]);

  return (
    <div className="gd-step gd-review-step">
      <StepHead
        step={7}
        title="最終確認"
        text="日本語版と英語版を並べて通しで確認します。問題があれば、その手順に戻って直せます"
      />
      <div className="gd-review-layout">
        <div className="gd-review-stage">
          <div className="gd-review-videos">
            <div>
              <span>日本語</span>
              <div className="gd-review-phone">
                <Player
                  ref={jaRef}
                  component={LineupShortStandard}
                  inputProps={jaInput}
                  durationInFrames={durationInFrames}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={fps}
                  loop
                  clickToPlay={false}
                  spaceKeyToPlayOrPause={false}
                  browserMediaControlsBehavior={{ mode: 'do-nothing' }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
            <div>
              <span>English</span>
              <div className="gd-review-phone">
                <Player
                  ref={enRef}
                  component={LineupShortStandard}
                  inputProps={enInput}
                  durationInFrames={durationInFrames}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={fps}
                  loop
                  initiallyMuted
                  clickToPlay={false}
                  spaceKeyToPlayOrPause={false}
                  browserMediaControlsBehavior={{ mode: 'do-nothing' }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          </div>
          <ReviewSeek jaRef={jaRef} enRef={enRef} fps={fps} durationInFrames={durationInFrames} />
          <div className="gd-review-controls">
            <button
              type="button"
              className="gd-review-play"
              onClick={() => {
                const ja = jaRef.current;
                const en = enRef.current;
                if (!ja || !en) return;
                if (playingRef.current) {
                  ja.pause();
                  en.pause();
                  en.seekTo(ja.getCurrentFrame());
                  playingRef.current = false;
                  setPlaying(false);
                  return;
                }
                en.seekTo(ja.getCurrentFrame());
                void ja.play();
                void en.play();
                playingRef.current = true;
                setPlaying(true);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                {playing ? (
                  <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
                ) : (
                  <path d="M8 5l12 7-12 7z" fill="currentColor" />
                )}
              </svg>
              日英を同時に再生
            </button>
            <label className="gd-review-safe">
              <input type="checkbox" checked={safeZone} onChange={(event) => setSafeZone(event.target.checked)} />
              セーフゾーン
            </label>
            <label className="gd-review-safe">
              <input type="checkbox" checked={showYtGuide} onChange={(event) => setShowYtGuide(event.target.checked)} />
              YouTube の UI ガイド
            </label>
            <ReviewClock playerRef={jaRef} fps={fps} durationInFrames={durationInFrames} />
          </div>
          <div className="gd-review-thumbs">
            <strong>サムネイル（YouTube / TikTok）</strong>
            <ThumbnailLayoutSwitch project={project} />
            <div className="gd-review-thumb-row">
              <ReviewThumbnail
                project={project}
                language="ja"
                width={thumbActual ? 180 : 220}
                caption="日本語"
                surface={thumbSurface}
                onSurface={setThumbSurface}
                actualSize={thumbActual}
                onActualSize={setThumbActual}
                showSafeZone={safeZone}
                showControls
              />
              <ReviewThumbnail
                project={project}
                language="en"
                width={thumbActual ? 180 : 220}
                caption="English"
                surface={thumbSurface}
                onSurface={setThumbSurface}
                actualSize={thumbActual}
                onActualSize={setThumbActual}
                showSafeZone={safeZone}
                showControls={false}
              />
            </div>
            {thumbnailLayoutOf(project) === 'focus' ? null : (
              <ThumbnailFrameControls
                project={project}
                frameAt={() => jaRef.current?.getCurrentFrame() ?? 0}
                onApplied={(frame) => {
                  holdFrame.current = frame;
                }}
              />
            )}
            {thumbnailIconWarning(project) ? (
              <p className="gd-review-thumb-note">{thumbnailIconWarning(project)}</p>
            ) : null}
          </div>
        </div>
        <section className="gd-review-list" aria-label="チェック項目">
          <strong>チェック</strong>
          <ul className="gd-review">
            {items.map((item) => (
              <li key={item.id} className={`is-${item.level}`}>
                <span className={`gd-mark is-${item.level}`}>{item.level === 'warn' || item.level === 'error' ? '!' : '✓'}</span>
                <span>
                  <strong>{item.label}</strong>
                  <span className="gd-review-detail">{item.detail}</span>
                </span>
                {item.step && item.level !== 'ok' && item.level !== 'info' && (
                  <button type="button" className="gd-link" onClick={() => onGoto(item.step!)}>
                    {guideStepNumber(item.step)} {FIX_STEP[item.step] ?? ''}で直す
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      {ask && (
        <div className="confirm-backdrop" onClick={() => setAsk(false)}>
          <div className="confirm-dialog" role="dialog" onClick={(event) => event.stopPropagation()}>
            <h2>警告が残っています</h2>
            <p>このまま確認して次へ進みますか？</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setAsk(false)}>戻る</button>
              <button type="button" className="primary" onClick={commit}>
                確認する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const postStamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const translationLanguageLabel = (language: 'ja' | 'ko'): string => (language === 'ja' ? '日本語' : '한국어');

const translationMark = (
  project: Project,
  field: PublishingTranslationField,
  language: 'ja' | 'ko',
): { text: string; stale: boolean } => {
  const stale = publishingTranslationStale(project, field, language);
  const hand = publishingTranslationHandEdited(project, field, language);
  if (hand && stale) return { text: '手修正あり · 英語が更新されています', stale: true };
  if (hand) return { text: '手修正あり', stale: false };
  if (stale) return { text: '英語が更新されています', stale: true };
  const cell = project.guide.publishingTranslation?.[field]?.[language];
  const current = project.publishing[field][language] ?? '';
  if (cell && current === cell.text) return { text: '翻訳済み', stale: false };
  return { text: '未翻訳', stale: false };
};

const PublishFieldNotes = ({
  project,
  field,
  language,
  value,
}: {
  project: Project;
  field: 'title' | 'description' | 'hashtags';
  language: Language | 'ko';
  value: string;
}) => (
  <>
    {(field === 'title' ? titleIssues(value) : []).map((issue) => (
      <span key={issue.text} className={`gd-publish-warn is-${issue.level}`}>
        {issue.text}
      </span>
    ))}
    {field === 'title' && language === 'ko' && koreanTitleUsesEnglishHook(project) && (
      <span className="gd-publish-warn is-warn">韓国語のフックが未入力のため、英語の文を下書きにしています</span>
    )}
    {field === 'description' && value.trim() && !hasClutchVaultUrl(value) && (
      <span className="gd-publish-warn is-warn">説明文の上部に ClutchVault の URL を入れてください</span>
    )}
    {field === 'description' && /保存できます|Save it on ClutchVault|저장할 수 있어요/i.test(value) && (
      <span className="gd-publish-warn is-warn">
        クローズドβ前は「保存できます」と書かず、定点をチェックできることを書いてください
      </span>
    )}
  </>
);

const PublishCopy = ({
  project,
  credit,
  onEdit,
}: {
  project: Project;
  credit: string;
  onEdit: (field: 'title' | 'description' | 'hashtags', language: Language | 'ko', value: string) => void;
}) => {
  const languages = publishingTranslationLanguages(project);
  const includeKorean = languages.includes('ko');
  const [busy, setBusy] = useState<'generate' | 'read' | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [handoff, setHandoff] = useState<AiHandoff | null>(null);
  const [paste, setPaste] = useState('');
  const requestRef = useRef<{ fields: PublishingTranslationField[]; force: boolean }>({
    fields: ['title', 'description'],
    force: false,
  });
  useEffect(() => {
    setError('');
    setNote('');
    setHandoff(null);
    setPaste('');
  }, [project.id]);

  const applyPayload = (payload: PublishingTranslation, fields: PublishingTranslationField[], force: boolean): void => {
    const missing: string[] = [];
    for (const field of fields) {
      if (!(project.publishing[field].en ?? '').trim()) continue;
      for (const language of languages) {
        if (!payload[field]?.[language]?.trim()) {
          missing.push(`${field === 'title' ? 'タイトル' : '説明文'}（${translationLanguageLabel(language)}）`);
        }
      }
    }
    const hasAny = fields.some((field) => languages.some((language) => Boolean(payload[field]?.[language]?.trim())));
    if (!hasAny) {
      setError('翻訳を読めませんでした。もう一度押すか、返ってきたJSONを貼り戻してください。');
      return;
    }
    let skipped: Array<{ field: PublishingTranslationField; language: 'ja' | 'ko' }> = [];
    update((current) => {
      const applied = applyPublishingTranslation(current, payload, { fields, force });
      skipped = applied.skipped;
      return applied.project;
    });
    const parts = [
      skipped.length > 0
        ? '手で直した欄は残しました。置き換えるときは「手修正を上書きして再翻訳」を押してください。'
        : includeKorean
          ? '日本語と韓国語を入れました。'
          : '日本語を入れました。',
    ];
    if (missing.length > 0) parts.push(`空だった翻訳: ${missing.join('、')}`);
    setNote(parts.join(' '));
    setError('');
    setHandoff(null);
  };

  const run = async (fields: PublishingTranslationField[], force: boolean): Promise<void> => {
    const selected = fields.filter((field) => (project.publishing[field].en ?? '').trim());
    if (selected.length === 0 || busy) return;
    requestRef.current = { fields: selected, force };
    setBusy('generate');
    setError('');
    setNote('');
    try {
      const result = await window.studio.generateAi({ kind: 'publish-translate', project, fields: selected });
      if (!result.ok) {
        if (result.handoff) setHandoff(result.handoff);
        setError(result.message || AI_ERROR_MESSAGE[result.code]);
        return;
      }
      const payload = result.suggestions[0]?.payload;
      if (!payload || payload.type !== 'publish-translate') {
        if (result.handoff) setHandoff(result.handoff);
        setError('自動では返せませんでした。下の文を Claude Code に貼ってください。');
        return;
      }
      applyPayload(payload, selected, force);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AIを呼び出せませんでした。');
    } finally {
      setBusy(null);
    }
  };

  const readPaste = async (): Promise<void> => {
    if (!handoff || busy) return;
    setBusy('read');
    setError('');
    try {
      const result = await window.studio.parseAiHandoff({
        kind: handoff.kind,
        text: paste,
        sourceCounts: handoff.sourceCounts,
        sourceRefs: handoff.sourceRefs,
      });
      if (!result.ok) {
        setError(result.message || AI_ERROR_MESSAGE[result.code]);
        return;
      }
      const payload = result.suggestions[0]?.payload;
      if (!payload || payload.type !== 'publish-translate') {
        setError('翻訳を読めませんでした。JSONの形を確認してください。');
        return;
      }
      applyPayload(payload, requestRef.current.fields, requestRef.current.force);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'JSONを読めませんでした。');
    } finally {
      setBusy(null);
    }
  };

  const englishReady = Boolean(project.publishing.title.en.trim() || project.publishing.description.en.trim());
  const handEdited = (['title', 'description'] as const).some(
    (field) =>
      Boolean(project.publishing[field].en.trim()) &&
      languages.some((language) => publishingTranslationHandEdited(project, field, language)),
  );
  const sourceFields = [
    ['title', 'タイトル', 'is-title'],
    ['description', '説明文', 'is-body'],
    ['hashtags', 'ハッシュタグ（翻訳しません）', 'is-tags'],
  ] as const;

  return (
    <div className="gd-publish">
      <section className="gd-publish-col" aria-label="英語の原稿">
        <strong>英語（原稿）</strong>
        {sourceFields.map(([field, label, size]) => {
          const value = project.publishing[field].en ?? '';
          return (
            <label key={field}>
              <span className="gd-publish-label">
                <span>{label}</span>
                {field === 'title' && (
                  <span className={value.length > 100 ? 'gd-publish-count is-error' : 'gd-publish-count'}>
                    {value.length} / 100
                  </span>
                )}
              </span>
              <textarea
                aria-label={`${label}（English）`}
                className={size}
                value={value}
                onChange={(event) => onEdit(field, 'en', event.target.value)}
              />
              <PublishFieldNotes project={project} field={field} language="en" value={value} />
            </label>
          );
        })}
        <span className="gd-publish-note">{credit}</span>
        <div className="gd-publish-actions">
          {busy ? (
            <>
              <p className="gd-publish-note" role="status">
                {busy === 'read' ? 'JSONを読んでいます' : '翻訳しています'}
              </p>
              {busy === 'generate' && (
                <button type="button" onClick={() => void window.studio.cancelAi()}>
                  中止
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="primary" disabled={!englishReady} onClick={() => void run(['title', 'description'], false)}>
                {includeKorean ? '日本語と韓国語に翻訳' : '日本語に翻訳'}
              </button>
              {handEdited && (
                <button type="button" disabled={!englishReady} onClick={() => void run(['title', 'description'], true)}>
                  手修正を上書きして再翻訳
                </button>
              )}
            </>
          )}
        </div>
        <span className="gd-publish-note">URL、ハッシュタグ、開発者表記は残します。マップ名とエージェント名は決まり訳を使います。</span>
        {note && (
          <span className="gd-publish-note" role="status">
            {note}
          </span>
        )}
        {error && <span className="gd-publish-warn is-error">{error}</span>}
        {handoff && (
          <div className="gd-publish-handoff">
            <span className="gd-publish-note">Claude Code にこの文を貼り、返ってきたJSONを下に戻します。</span>
            <textarea className="is-body" readOnly value={handoff.prompt} aria-label="Claudeに渡す文" />
            <button type="button" onClick={() => void navigator.clipboard.writeText(handoff.prompt)}>
              文をコピー
            </button>
            <textarea
              className="is-body"
              value={paste}
              aria-label="Claudeから戻ったJSON"
              placeholder="返ってきたJSONを貼る"
              onChange={(event) => setPaste(event.target.value)}
            />
            <button type="button" disabled={busy !== null || !paste.trim()} onClick={() => void readPaste()}>
              貼り戻したJSONを読む
            </button>
          </div>
        )}
      </section>
      <section className="gd-publish-col" aria-label="翻訳">
        <strong>翻訳</strong>
        <span className="gd-publish-note">英語を書いてから翻訳します。翻訳後も直接直せます。</span>
        {(['title', 'description'] as const).map((field) => {
          const label = field === 'title' ? 'タイトル' : '説明文';
          const size = field === 'title' ? 'is-title' : 'is-body';
          const fieldHandEdited = languages.some((language) => publishingTranslationHandEdited(project, field, language));
          const english = project.publishing[field].en.trim();
          return (
            <div key={field} className="gd-publish-block">
              <div className="gd-publish-fieldhead">
                <strong>{label}</strong>
                <button
                  type="button"
                  disabled={busy !== null || !english}
                  onClick={() => void run([field], fieldHandEdited)}
                >
                  {fieldHandEdited ? 'この項目を上書きして再翻訳' : 'この項目を翻訳'}
                </button>
              </div>
              <div className={includeKorean ? 'gd-publish-langs' : 'gd-publish-langs is-one'}>
                {languages.map((language) => {
                  const value = project.publishing[field][language] ?? '';
                  const mark = translationMark(project, field, language);
                  return (
                    <label key={language} className="gd-publish-lang">
                      <span className="gd-publish-label">
                        <span>{translationLanguageLabel(language)}</span>
                        <span className="gd-publish-label-meta">
                          {field === 'title' && (
                            <span className={value.length > 100 ? 'gd-publish-count is-error' : 'gd-publish-count'}>
                              {value.length} / 100
                            </span>
                          )}
                          <span className={mark.stale ? 'gd-publish-status is-stale' : 'gd-publish-status'}>{mark.text}</span>
                        </span>
                      </span>
                      <textarea
                        aria-label={`${label}（${translationLanguageLabel(language)}）`}
                        className={size}
                        value={value}
                        onChange={(event) => onEdit(field, language, event.target.value)}
                      />
                      <PublishFieldNotes project={project} field={field} language={language} value={value} />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
};

export const PublishStep = ({ project }: { project: Project }) => {
  const projects = useStudioStore((state) => state.projects);
  const tracks = useStudioStore((state) => state.audioTracks);
  useEffect(() => {
    if (project.plannedPostDate) return;
    update((current) => {
      if (current.plannedPostDate) return current;
      current.plannedPostDate = defaultPostDate();
      return current;
    });
  }, [project.id, project.plannedPostDate]);

  const edit = (
    field: 'title' | 'description' | 'hashtags',
    language: Language | 'ko',
    value: string,
  ): void => {
    update((current) => {
      const next = markPublishingEdited(current, field, language);
      next.publishing[field][language] = value;
      return next;
    });
  };

  const local = toDateTimeLocal(project.plannedPostDate);
  const postDate = local.slice(0, 10);
  const postTime = local.slice(11, 16) || '19:00';
  const writeWhen = (date: string, time: string): void => {
    if (!date || !time) return;
    update((current) => {
      current.plannedPostDate = fromDateTimeLocal(`${date}T${time}`);
      return current;
    });
  };
  const inherited = projects.find((item) => item.id === project.inheritedFrom?.projectId);
  const previous =
    inherited?.plannedPostDate
      ? inherited
      : projects.find((item) => item.id !== project.id && item.plannedPostDate);
  const whenHint = previous?.plannedPostDate
    ? `前回の投稿（${postStamp(previous.plannedPostDate)}）から2日後。ファイル名の日付にも使います`
    : 'ファイル名の日付にも使います。初期値は2日後の19:00です。';
  const track = tracks.find((item) => item.id === project.audio.bgm?.audioTrackId) ?? null;
  const savedMemo = project.publishing.memoUrl;
  const [memoDraft, setMemoDraft] = useState(savedMemo);
  const [memoError, setMemoError] = useState<string | null>(null);
  useEffect(() => {
    setMemoDraft(savedMemo);
    setMemoError(null);
  }, [project.id, savedMemo]);
  const applyMemo = (): void => {
    const value = memoDraft.trim();
    if (value && !isClutchVaultUrl(value)) {
      setMemoError('clutchvault.app または gg.clutchvault.app の https リンクを入力してください');
      return;
    }
    setMemoError(null);
    update((current) => applyPublishingMemo(current, value));
  };
  const credit = !project.audio.bgm
    ? 'クレジット：不要（BGMなし）· 計測用URLを自動で付けます'
    : track?.creditRequired
      ? `クレジット：必須（${SOURCE_LABEL[track.source]}）· 計測用URLを自動で付けます`
      : `クレジット：不要（${track ? SOURCE_LABEL[track.source] : 'BGM'} は任意）· 計測用URLを自動で付けます`;

  return (
    <div className="gd-step">
      <StepHead
        step={8}
        title="投稿内容"
        text="英語が原稿です。翻訳ボタンで日本語を入れます。YouTube（海外）を書き出すときは韓国語も入ります。手で直した欄は雛形に追従しません。"
      />
      <PublishCopy project={project} credit={credit} onEdit={edit} />
      <section className="gd-publish-track" aria-label="固定コメント">
        <strong>固定コメント（英語）</strong>
        <span>手順{guideStepNumber(5)}で選んだ文です。YouTubeには自動で付きません。投稿するときにコピーして、自分で固定します。</span>
        <textarea
          aria-label="固定コメント"
          value={project.publishing.pinnedComment}
          onChange={(event) =>
            update((current) => {
              current.publishing.pinnedComment = event.target.value;
              return current;
            })
          }
        />
      </section>
      <section className="gd-publish-track" aria-label="定点メモリンク">
        <strong>定点メモリンク</strong>
        <span>
          この動画に紐づける ClutchVault の定点ページを貼ると、パスを残したまま計測用のパラメータを付けて説明文へ入れます。空にして入れると、トップページのURLに戻します。
        </span>
        <div>
          <input
            type="url"
            aria-label="定点メモリンク"
            placeholder="https://gg.clutchvault.app/..."
            value={memoDraft}
            onChange={(event) => setMemoDraft(event.target.value)}
          />
          <button type="button" onClick={applyMemo}>
            説明文に入れる
          </button>
        </div>
        {memoError && <span className="gd-publish-warn is-warn">{memoError}</span>}
      </section>
      <section className="gd-publish-track" aria-label="計測用URL">
        <strong>計測用URL</strong>
        <span>
          utm_campaign = {project.experiment.utmCampaign || 'first_9_lineups'} · utm_content は書き出しファイル名
        </span>
        {project.guide.exportPresets.map((preset) => {
          const language = DELIVERY_PRESETS[preset].videoLanguage === 'en' ? 'en' : 'ja';
          const url = trackingFor(project, preset, guessBasename(project, preset), language);
          return (
            <div key={preset}>
              <span>{DELIVERY_PRESETS[preset].label}</span>
              <code className="gd-mono">{url}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(url)}>
                URLをコピー
              </button>
            </div>
          );
        })}
      </section>
      <section className="gd-publish-when">
        <label>
          投稿予定日
          <input type="date" value={postDate} onChange={(event) => writeWhen(event.target.value, postTime)} />
        </label>
        <label>
          時刻
          <input type="time" value={postTime} onChange={(event) => writeWhen(postDate, event.target.value)} />
        </label>
        <span>{whenHint}</span>
      </section>
    </div>
  );
};

export const ExportStep = ({
  project,
  onExport,
  exporting,
  exportNote,
  onOpenPublishing,
}: {
  project: Project;
  onExport: () => void;
  exporting: boolean;
  exportNote: string | null;
  onOpenPublishing: () => void;
}) => {
  const workspace = useStudioStore((state) => state.workspace);
  const presets = project.guide.exportPresets;
  const videoLanguages = videoLanguagesFor(presets);
  const exportJobs = jobsForPresets(presets, project.guide.thumbnailOnly);
  const setThumbnailOnly = (language: 'ja' | 'en', checked: boolean): void => {
    update((current) => {
      const next = new Set(current.guide.thumbnailOnly);
      if (checked) next.add(language);
      else next.delete(language);
      current.guide.thumbnailOnly = (['ja', 'en'] as const).filter((id) => next.has(id));
      return current;
    });
  };
  const exported = project.guide.lastExport?.contentStamp === exportContentStamp(project);
  const folder = project.guide.lastExport?.outputDir ?? `exports/${new Date().toISOString().slice(0, 10)}`;
  const workspaceName = workspace?.split(/[\\/]/).filter(Boolean).pop();
  const destination = `${workspaceName ? `${workspaceName}/` : ''}${folder.replaceAll('\\', '/')}`;
  const wantsVideo = presets.some((preset) => DELIVERY_PRESETS[preset].videoLanguage);

  const copyPosts = (): void => {
    const text = exportJobs
      .map((job) => {
        const preset = job.presetIds[0];
        const basename = preset ? guessBasename(project, preset) : '';
        if (job.slot === 'x') {
          const prepared = prepareXPost(project);
          return prepared.copyable ? prepared.text : '';
        }
        return copyForJob(project, job, basename, '').text;
      })
      .filter(Boolean)
      .join('\n\n');
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="gd-step gd-export">
      <header className="gd-step-head">
        <span className="gd-kicker">STEP 9 / 10</span>
        <h1>書き出し</h1>
      </header>
      <div className="gd-export-platforms">
        {DELIVERY_PRESET_ORDER.map((preset) => {
          const on = presets.includes(preset);
          return (
            <label key={preset} className={on ? 'is-on' : ''}>
              <input
                type="checkbox"
                checked={on}
                onChange={(event) =>
                  update((current) => {
                    const next = new Set(current.guide.exportPresets);
                    if (event.target.checked) next.add(preset);
                    else next.delete(preset);
                    current.guide.exportPresets = DELIVERY_PRESET_ORDER.filter((id) => next.has(id));
                    return current;
                  })
                }
              />
              <span>
                <strong>{DELIVERY_PRESETS[preset].label}</strong>
                <span>{presetOutputs(preset)}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="gd-export-thumbs">
        <span>サムネイルだけ（動画なし）</span>
        {(['ja', 'en'] as const).map((language) => {
          const withVideo = videoLanguages.includes(language);
          return (
            <label key={language}>
              <input
                type="checkbox"
                checked={withVideo || project.guide.thumbnailOnly.includes(language)}
                disabled={withVideo}
                onChange={(event) => setThumbnailOnly(language, event.target.checked)}
              />
              {language === 'ja' ? '日本語' : '英語'}
              {withVideo ? '（動画と一緒）' : ''}
            </label>
          );
        })}
      </div>
      <div className="gd-export-bar">
        <label>
          <input
            type="checkbox"
            checked={project.guide.exportWithoutBgm}
            disabled={!wantsVideo}
            onChange={(event) =>
              update((current) => {
                current.guide.exportWithoutBgm = event.target.checked;
                return current;
              })
            }
          />
          BGMなし版も作る
        </label>
        <span className="gd-export-dest">
          保存先：<span className="gd-mono">{destination}</span>
        </span>
        <span className="gd-spacer" />
        <button type="button" className="gd-export-go" disabled={exporting || exportJobs.length === 0} onClick={onExport}>
          {exporting
            ? '書き出し中…'
            : `書き出す（${presets.length + exportJobs.filter((job) => job.presetIds.length === 0).length}件）`}
        </button>
      </div>
      {exported && (
        <section className="gd-export-done" aria-label="書き出しの結果">
          <strong>✓ 書き出し完了</strong>
          {exportNote && <span>{exportNote}</span>}
          <span className="gd-spacer" />
          <button
            type="button"
            onClick={() => void window.studio.openPath(project.guide.lastExport?.outputDir ?? 'exports')}
          >
            保存先フォルダを開く
          </button>
          <button type="button" className="gd-export-go" onClick={onOpenPublishing}>
            投稿運用を始める
          </button>
          <button type="button" onClick={copyPosts}>
            投稿文をコピー
          </button>
          {presets.includes('x-jp') && <span>Xの投稿文は、投稿運用のXで確認してコピーします</span>}
        </section>
      )}
    </div>
  );
};
