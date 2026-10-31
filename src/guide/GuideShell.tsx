import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PlayerRef } from '@remotion/player';
import {
  compositionBlocks,
  guideHeadline,
  guideStepAfter,
  guideStepBefore,
  guideStepNumber,
  guideSteps,
  reviewItems,
  sceneHasRange,
  trimScenes,
  type GuideStepId,
} from '../../shared/guide';
import type { AudioUsageRecord } from '../../shared/ipc';
import type { Project } from '../../shared/schema/project';
import type { SceneKey } from '../../shared/schema/project-keys';
import { activeTimeline, defaultLoopRange } from '../../shared/timeline';
import { useStudioStore } from '../store';
import { stopBgmPreview } from './bgm-preview';
import { stopSourcePreview } from './source-preview';
import { GuidePreview } from './GuidePreview';
import { PublishFlow } from './PublishFlow';
import {
  CaptionStep,
  CardStep,
  ExportStep,
  LineupStep,
  PublishStep,
  ReviewStep,
  SoundStep,
  TrimStep,
  VideoStep,
  type CaptionPreviewTarget,
  type TrimHandles,
} from './steps';

const BLOCK_TITLE: Record<SceneKey, string> = {
  hook: 'S1 フック',
  stand: 'S2 立ち位置',
  aim: 'S3 狙い',
  throw: 'S4 発動',
  card: 'S5 カード',
  demo: 'S6 デモ',
  loop: 'S7 ループ',
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
};

export const GuideShell = ({
  project,
  playerRef,
  playbackFrameRef,
  sceneKey,
  onSceneKey,
  onImportVideo,
  onEditRange,
  audioUsage,
  onExport,
  exporting,
  exportNote,
  showSafeZone,
  onPublishingHome,
}: {
  project: Project;
  playerRef: RefObject<PlayerRef | null>;
  playbackFrameRef: RefObject<number>;
  sceneKey: SceneKey;
  onSceneKey: (sceneKey: SceneKey) => void;
  onImportVideo: () => void;
  onEditRange: (sceneKey: SceneKey) => void;
  audioUsage: AudioUsageRecord[];
  onExport: () => void;
  exporting: boolean;
  exportNote: string | null;
  showSafeZone: boolean;
  onPublishingHome: (hold: boolean) => void;
}) => {
  const store = useStudioStore();
  const handlesRef = useRef<TrimHandles | null>(null);
  const soundApplyRef = useRef<((project: Project) => Project) | null>(null);
  const reviewGateRef = useRef<(() => void) | null>(null);
  const rememberSoundApply = useCallback((apply: (project: Project) => Project) => {
    soundApplyRef.current = apply;
  }, []);
  const rememberReviewGate = useCallback((gate: () => void) => {
    reviewGateRef.current = gate;
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [captionPreview, setCaptionPreview] = useState<CaptionPreviewTarget>('hook');
  const [narrow, setNarrow] = useState(window.innerWidth < 1280);
  const [previewOpen, setPreviewOpen] = useState(window.innerWidth >= 1280);
  const [publishWide, setPublishWide] = useState(false);
  const step = Math.min(10, Math.max(1, project.guide.lastStep || 1)) as GuideStepId;
  const steps = guideSteps(project, step, store.audioTracks);
  const blocks = compositionBlocks(project);
  const total = activeTimeline(project).durationSec;
  const current = steps.find((item) => item.id === step);

  useEffect(() => {
    if (step !== 10) setPublishWide(false);
  }, [step]);

  useEffect(() => {
    if (step !== 3) return;
    const scenes = trimScenes(project);
    if (!scenes.some((key) => key === sceneKey) && scenes[0]) onSceneKey(scenes[0]);
  }, [
    step,
    sceneKey,
    project.id,
    project.templateParams.sceneOrder,
    onSceneKey,
  ]);

  useEffect(() => {
    const onResize = (): void => {
      const next = window.innerWidth < 1280;
      setNarrow(next);
      if (!next) setPreviewOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const go = (next: GuideStepId): void => {
    store.updateProject((currentProject) => {
      currentProject.guide.lastStep = next;
      currentProject.guide.mode = 'guide';
      return currentProject;
    });
  };

  const setMode = (mode: 'guide' | 'editor'): void => {
    store.updateProject((currentProject) => {
      currentProject.guide.mode = mode;
      return currentProject;
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowRight') {
        event.preventDefault();
        const forward = guideStepAfter(step);
        if (forward) go(forward);
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowLeft') {
        event.preventDefault();
        const back = guideStepBefore(step);
        if (back) go(back);
      } else if (event.code === 'Space') {
        event.preventDefault();
        const player = playerRef.current;
        if (!player) return;
        if (player.isPlaying()) player.pause();
        else {
          stopBgmPreview();
          void player.play();
        }
      } else if (
        step === 3 &&
        handlesRef.current?.nudgeCrop &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        const stepSize = event.shiftKey ? 0.05 : 0.01;
        const axis = event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'y' : 'x';
        const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        handlesRef.current.nudgeCrop(axis, sign * stepSize);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const player = playerRef.current;
        if (!player) return;
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        player.seekTo(Math.max(0, player.getCurrentFrame() + delta));
      } else if (step === 3 && event.key.toLowerCase() === 'i') {
        handlesRef.current?.setIn();
      } else if (step === 3 && event.key.toLowerCase() === 'o') {
        handlesRef.current?.setOut();
      } else if (step === 3 && event.key === 'Enter') {
        event.preventDefault();
        handlesRef.current?.confirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, playerRef]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onPlay = (): void => {
      stopBgmPreview();
      stopSourcePreview();
    };
    player.addEventListener('play', onPlay);
    return () => player.removeEventListener('play', onPlay);
  }, [step, playerRef]);

  const stepIndex = steps.findIndex((item) => item.id === step);
  const nextStep = stepIndex >= 0 ? steps[stepIndex + 1] : undefined;
  const previousStep = stepIndex > 0 ? steps[stepIndex - 1] : undefined;
  const decidedSec = blocks
    .filter((block) => !block.auto && sceneHasRange(project, block.sceneKey))
    .reduce((sum, block) => sum + block.duration, 0);
  const autoSec = blocks.filter((block) => block.auto).reduce((sum, block) => sum + block.duration, 0);
  const rangesReady = blocks.every((block) => block.auto || sceneHasRange(project, block.sceneKey));
  const sumLabel = rangesReady
    ? `合計 ${total.toFixed(1)}s`
    : `決定 ${decidedSec.toFixed(1)}s + 自動 ${autoSec.toFixed(1)}s`;
  const blockTitle = (scene: SceneKey): string => BLOCK_TITLE[scene];

  const reviewBlocked =
    step === 7 && reviewItems(project, store.audioTracks).some((item) => item.level === 'error');
  const advance = (): void => {
    if (!nextStep || reviewBlocked) return;
    if (step === 7) {
      reviewGateRef.current?.();
      return;
    }
    const apply = step === 6 ? soundApplyRef.current : null;
    store.updateProject((currentProject) => {
      const next = apply ? apply(currentProject) : currentProject;
      next.guide.lastStep = nextStep.id;
      next.guide.mode = 'guide';
      return next;
    });
  };

  return (
    <div className="gd-app">
      <header className="gd-top">
        <button type="button" className="gd-project" onClick={() => setMenuOpen((open) => !open)}>
          {project.title}
        </button>
        <span className={store.dirty ? 'save-state dirty' : 'save-state'}>{store.dirty ? '保存中…' : '保存済み'}</span>
        <span className="gd-spacer" />
        <span className="gd-muted">{guideHeadline(project, store.audioTracks)}</span>
        <div className="gd-mode" role="group" aria-label="画面の切り替え">
          <button type="button" className="is-on" onClick={() => setMode('guide')}>ガイド作成</button>
          <button type="button" onClick={() => setMode('editor')}>詳細編集</button>
        </div>
        {menuOpen && (
          <div className="gd-menu">
            {store.projects.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void window.studio.loadProject(item.id).then((loaded) => store.setProject(loaded));
                }}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="gd-body">
        {!(step === 10 && publishWide) && <nav className="gd-steps" aria-label="作成の手順">
          <div className="gd-steps-label">
            <span>作成の手順</span>
            <span>T-STD 定点ショート</span>
          </div>
          <div className="gd-step-list">
            {steps.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`gd-step-link is-${item.status} ${item.id === step ? 'is-current' : ''}`}
                onClick={() => go(item.id)}
              >
                <span className="gd-num">
                  {item.id === step
                    ? guideStepNumber(item.id)
                    : item.status === 'done'
                      ? '✓'
                      : item.status === 'warn'
                        ? '!'
                        : guideStepNumber(item.id)}
                </span>
                <span className="gd-step-copy">
                  <strong>{item.name}</strong>
                  <span>{item.summary || item.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="gd-steps-note">細かい調整（音量の点・トランジションなど）は詳細編集のタイムラインで行います</p>
        </nav>}
        <main className={step === 10 ? 'gd-work pw-work' : 'gd-work'}>
          {current?.blocker ? (
            <div className="gd-step">
              <h1>{current.name}</h1>
              <p className="gd-banner is-warn">{current.blocker}</p>
              <button type="button" onClick={() => go(2)}>2 動画選択へ</button>
            </div>
          ) : (
            <>
              {step === 1 && <LineupStep project={project} />}
              {step === 2 && (
                <VideoStep
                  project={project}
                  onImport={onImportVideo}
                  onPreview={() => {
                    playerRef.current?.pause();
                  }}
                />
              )}
              {step === 3 && (
                <TrimStep
                  project={project}
                  sceneKey={sceneKey}
                  onSceneKey={onSceneKey}
                  handlesRef={handlesRef}
                  onEditRange={onEditRange}
                />
              )}
              {step === 4 && <CardStep project={project} />}
              {step === 5 && (
                <CaptionStep
                  project={project}
                  onGoto={go}
                  previewing={captionPreview}
                  onPreview={(id, language) => {
                    setCaptionPreview(id);
                    if (language) store.setLanguage(language);
                  }}
                />
              )}
              {step === 6 && (
                <SoundStep
                  project={project}
                  tracks={store.audioTracks}
                  usage={audioUsage}
                  onApply={rememberSoundApply}
                  onPreview={() => {
                    playerRef.current?.pause();
                  }}
                />
              )}
              {step === 7 && (
                <ReviewStep
                  project={project}
                  tracks={store.audioTracks}
                  onGoto={go}
                  onGate={rememberReviewGate}
                />
              )}
              {step === 8 && <PublishStep project={project} />}
              {step === 9 && (
                <ExportStep
                  project={project}
                  onExport={onExport}
                  exporting={exporting}
                  exportNote={exportNote}
                  onOpenPublishing={() => go(10)}
                />
              )}
              {step === 10 && (
                <PublishFlow
                  project={project}
                  onHome={onPublishingHome}
                  onProject={(next) => store.setProject(next)}
                  onActive={setPublishWide}
                />
              )}
            </>
          )}
        </main>
        {step !== 10 && (
        <GuidePreview
          project={project}
          step={step}
          sceneKey={sceneKey}
          captionPreview={captionPreview}
          language={store.language}
          audioTracks={store.audioTracks}
          showSafeZone={showSafeZone}
          onLanguage={store.setLanguage}
          playerRef={playerRef}
          playbackFrameRef={playbackFrameRef}
          exporting={exporting}
          collapsed={narrow && !previewOpen}
          onToggle={() => setPreviewOpen((open) => !open)}
        />
        )}
      </div>
      {step !== 10 && <footer className="gd-compose">
        <div className="gd-compose-total">
          <span className="gd-compose-kicker">構成</span>
          <span className={rangesReady ? 'gd-compose-sum' : 'gd-compose-sum is-warn'}>{sumLabel}</span>
        </div>
        <div className="gd-blocks">
          {blocks.map((block, index) => {
            const editing = step === 3 && sceneKey === block.sceneKey;
            const empty = !block.auto && !sceneHasRange(project, block.sceneKey);
            const detail =
              block.auto && block.sceneKey === 'loop'
                ? defaultLoopRange(project) ? 'S1の直前' : 'S1と同じ'
                : block.auto && block.sceneKey === 'demo'
                  ? `任意${editing ? ' · 編集中' : ''}`
                  : empty
                    ? '未設定'
                    : `${block.duration.toFixed(1)}s${editing ? ' 編集中' : ''}`;
            return (
              <button
                key={`${block.sceneKey}-${index}`}
                type="button"
                style={{ flexGrow: Math.max(block.duration, 0.6) }}
                className={[block.auto ? 'is-auto' : '', empty ? 'is-empty' : '', editing ? 'is-on' : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`${blockTitle(block.sceneKey)} ${detail}`}
                onClick={() => {
                  onSceneKey(block.sceneKey);
                  go(3);
                }}
              >
                <strong>{blockTitle(block.sceneKey)}</strong>
                <span>{detail}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="gd-compose-back"
          disabled={!previousStep}
          onClick={() => previousStep && go(previousStep.id)}
        >
          戻る
        </button>
        <button type="button" className="gd-compose-next" disabled={!nextStep || reviewBlocked} onClick={advance}>
          次へ{nextStep ? `：${nextStep.name}` : ''}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </footer>}
    </div>
  );
};
