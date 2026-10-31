import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlayerRef } from '@remotion/player';
import { getDurationInFrames } from '../remotion/LineupShortStandard';
import { bounceChargeLabel } from '../shared/bounce-charge';
import { jobsForPresets } from '../shared/export-copy';
import {
  assignClipsFromRoles,
  defaultRoleForNewVideo,
  exportContentStamp,
  followPublishing,
  publishingPresets,
} from '../shared/guide';
import type { AudioUsageRecord, ProjectSummary } from '../shared/ipc';
import type { Project, SceneKey } from '../shared/schema/project';
import { applyDemoDurationToProject, applySceneCutDuration, rangeForSceneDuration, sceneItemDuration, SCENE_BAND } from '../shared/timeline';
import { useStudioStore, type SaveCommit } from './store';
import { TimelinePanel } from './TimelinePanel';
import { PreviewStage } from './PreviewStage';
import { GuideHome } from './guide/GuideHome';
import { GuideShell } from './guide/GuideShell';
import './analytics.css';
import { AppNav } from './analytics/chrome';
import { AnalyticsContext, type AnalyticsPage, type DetailTab } from './analytics/context';
import { DetailShell, ExperimentNew, WeeklyReview } from './analytics/DetailScreens';
import { GuideAnalysis, ReviewHome } from './analytics/ReviewScreens';
import { readyTasks } from '../shared/analytics';
import type { AnalyticsBundle, PrimaryVariable } from '../shared/schema/analytics';
import type { YoutubeExperimentLink } from '../shared/youtube-compare';
import {
  DELIVERY_PRESET_ORDER,
  DELIVERY_PRESETS,
  videoLanguagesFor,
  type DeliveryPresetId,
} from '../shared/delivery-presets';
import type { AudioRegistration } from '../shared/schema/audio';
import cvTitleUrl from '../resources/brand/cv-title.png';
import {
  getCanonicalAbilityId,
  getCanonicalAgentId,
  isSovaChargeAbility,
} from './valorantMaster';

const EDITABLE_SCENES: SceneKey[] = ['hook', 'stand', 'aim', 'throw', 'demo'];
const CARD_STILL_ROLES = ['stand', 'aim', 'result'] as const;
type CardStillRole = (typeof CARD_STILL_ROLES)[number];

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const persistProject = async (revision: number, sent: Project): Promise<SaveCommit> => {
  const saved = await window.studio.saveProject(sent);
  return useStudioStore.getState().acceptSavedProject(revision, sent, saved);
};

const mediaUrl = (path: string): string =>
  `studio-media://root/${path
    .split(/[\\/]/)
    .map((part) => encodeURIComponent(part))
    .join('/')}`;

export const App = () => {
  const store = useStudioStore();
  const [editingSceneKey, setEditingSceneKey] = useState<SceneKey | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [previewReveal, setPreviewReveal] = useState<'short' | 'card' | 'card45' | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const [projectToDelete, setProjectToDelete] = useState<ProjectSummary | null>(null);
  const [showSafeZone, setShowSafeZone] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | Project['status']>('all');
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [guideScene, setGuideScene] = useState<SceneKey>('hook');
  const playbackFrameRef = useRef(0);
  const [audioUsage, setAudioUsage] = useState<AudioUsageRecord[]>([]);
  const [defaultBgmTrackId, setDefaultBgmTrackId] = useState<string | null>(null);
  const [area, setArea] = useState<'create' | 'review' | 'detail'>('create');
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [analyticsPage, setAnalyticsPage] = useState<AnalyticsPage>('home');
  const [analytics, setAnalytics] = useState<AnalyticsBundle | null>(null);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [pausedToday, setPausedToday] = useState(false);
  const [publishHold, setPublishHold] = useState(false);
  const [prefillVariable, setPrefillVariable] = useState<PrimaryVariable | undefined>(undefined);
  const [experimentLink, setExperimentLink] = useState<YoutubeExperimentLink | undefined>(undefined);
  const {
    workspace,
    projects,
    project,
    audioTracks,
    language,
    busy,
    dirty,
    error,
    exportProgress,
  } = store;

  const refreshProjects = async (): Promise<void> => {
    if (!useStudioStore.getState().workspace) return;
    store.setProjects(await window.studio.listProjects());
  };

  useEffect(() => window.studio.onExportProgress(store.setExportProgress), []);

  useEffect(() => {
    document.title = 'CV Creator Studio';
    if (workspace) return;
    void (async () => {
      try {
        const selectedWorkspace = await window.studio.getWorkspace();
        if (useStudioStore.getState().workspace) return;
        store.setWorkspace(selectedWorkspace);
        if (selectedWorkspace) {
          store.setProjects(await window.studio.listProjects());
          store.setAudioTracks(await window.studio.listAudio());
          setAudioUsage(await window.studio.listAudioUsage());
          setDefaultBgmTrackId(await window.studio.getDefaultBgm());
        }
      } catch (initializationError) {
        store.setError(errorMessage(initializationError));
      }
    })();
  }, [workspace]);

  useEffect(() => {
    if (!project || !dirty) return;
    const revision = useStudioStore.getState().projectRevision;
    const timer = window.setTimeout(async () => {
      const state = useStudioStore.getState();
      const toSave = state.project;
      if (!toSave || state.projectRevision !== revision) return;
      try {
        const result = await persistProject(revision, toSave);
        if (result === 'saved') await refreshProjects();
      } catch (saveError) {
        useStudioStore.getState().setError(`自動保存に失敗しました: ${errorMessage(saveError)}`);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project, dirty]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const state = useStudioStore.getState();
      const toSave = state.project;
      if (!toSave || !state.dirty) return;
      const revision = state.projectRevision;
      try {
        await persistProject(revision, toSave);
      } catch (saveError) {
        useStudioStore.getState().setError(`定期保存に失敗しました: ${errorMessage(saveError)}`);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const reloadAnalytics = async (): Promise<void> => {
    setAnalytics(await window.studio.getAnalytics());
  };

  useEffect(() => {
    if (!workspace) return;
    void reloadAnalytics().catch((loadError) => store.setError(errorMessage(loadError)));
  }, [workspace]);

  const durationInFrames = useMemo(
    () => (project ? getDurationInFrames(project) : 1),
    [project],
  );
  const selectedAgent = project ? getCanonicalAgentId(project.lineup.agent) : '';
  const selectedAbility = project
    ? getCanonicalAbilityId(selectedAgent, project.lineup.ability)
    : '';
  const showChargeBounce = isSovaChargeAbility(selectedAgent, selectedAbility);
  const selectedBounce = project?.lineup.bounce ?? 0;
  const selectedCharge = project?.lineup.charge ?? 0;
  const selectedCrouch = Boolean(project?.lineup.crouch);

  useEffect(() => {
    let detach = (): void => undefined;
    const timer = window.setTimeout(() => {
      const player = playerRef.current;
      if (!player) return;
      const onFrame = (): void => {
        playbackFrameRef.current = player.getCurrentFrame();
      };
      player.addEventListener('frameupdate', onFrame);
      const frame = playbackFrameRef.current;
      if (frame > 0) player.seekTo(Math.min(frame, Math.max(0, durationInFrames - 1)));
      detach = () => player.removeEventListener('frameupdate', onFrame);
    }, 80);
    return () => {
      window.clearTimeout(timer);
      detach();
    };
  }, [project?.id, project?.guide.mode, durationInFrames]);

  useEffect(() => {
    if (!projectToDelete) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setProjectToDelete(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [projectToDelete]);

  useEffect(() => {
    if (!project || !showChargeBounce) return;
    const label = bounceChargeLabel(selectedBounce, selectedCharge, selectedCrouch);
    if (
      project.lineup.throwType.ja === label.ja &&
      project.lineup.throwType.en === label.en
    ) {
      return;
    }
    store.updateProject((current) => {
      current.lineup.throwType = label;
      return current;
    });
  }, [project, showChargeBounce, selectedBounce, selectedCharge, selectedCrouch]);

  const run = async (task: () => Promise<void>): Promise<void> => {
    store.setBusy(true);
    store.setError(null);
    try {
      await task();
    } catch (taskError) {
      store.setError(errorMessage(taskError));
    } finally {
      store.setBusy(false);
    }
  };

  const chooseWorkspace = (): void => {
    void run(async () => {
      const selected = await window.studio.selectWorkspace();
      if (!selected) return;
      store.setWorkspace(selected);
      store.setProject(null);
      await Promise.all([
        refreshProjects(),
        window.studio.listAudio().then(store.setAudioTracks),
        window.studio.listAudioUsage().then(setAudioUsage),
        window.studio.getDefaultBgm().then(setDefaultBgmTrackId),
      ]);
    });
  };

  const createProject = (): void => {
    void run(async () => {
      const created = await window.studio.createProject();
      store.setProject(created);
      await refreshProjects();
    });
  };

  const setDefaultBgm = (trackId: string | null): void => {
    void (async () => {
      try {
        setDefaultBgmTrackId(await window.studio.setDefaultBgm(trackId));
      } catch (settingsError) {
        store.setError(errorMessage(settingsError));
      }
    })();
  };

  const importVideo = (assignToScene?: SceneKey): void => {
    if (!project) return;
    void run(async () => {
      const imported = await window.studio.importVideo(project.id);
      if (!imported) return;
      const assetId = crypto.randomUUID();
      const proxyPath = await window.studio.createProxy(
        imported.relativePath,
        project.id,
        assetId,
      );
      const clipId = crypto.randomUUID();
      store.updateProject((current) => {
        current.assets.push({
          id: assetId,
          type: 'video',
          path: imported.relativePath,
          proxyPath,
          meta: imported.meta,
          loudnessEnvelope: imported.loudnessEnvelope,
          tags: assignToScene === 'demo' ? ['demo'] : [],
        });
        current.clips.push({
          id: clipId,
          assetId,
          in: 0,
          out: imported.meta.duration,
        });
        if (assignToScene) {
          const targetScene = current.scenes.find(
            (scene) => scene.sceneKey === assignToScene,
          );
          if (targetScene) targetScene.clipId = clipId;
          if (assignToScene === 'demo') {
            return applyDemoDurationToProject(current, imported.meta.duration);
          }
        } else {
          for (const scene of current.scenes) {
            if (EDITABLE_SCENES.includes(scene.sceneKey) && scene.sceneKey !== 'demo' && !scene.clipId) {
              scene.clipId = clipId;
            }
          }
        }
        return current;
      });
      if (assignToScene) {
        setEditingSceneKey(assignToScene);
        setEditingClipId(clipId);
      }
    });
  };

  const importGuideVideo = (): void => {
    if (!project) return;
    if (project.assets.filter((asset) => asset.type === 'video').length >= 3) return;
    void run(async () => {
      const imported = await window.studio.importVideo(project.id);
      if (!imported) return;
      const assetId = crypto.randomUUID();
      const proxyPath = await window.studio.createProxy(
        imported.relativePath,
        project.id,
        assetId,
      );
      store.updateProject((current) => {
        current.assets.push({
          id: assetId,
          type: 'video',
          path: imported.relativePath,
          proxyPath,
          meta: imported.meta,
          loudnessEnvelope: imported.loudnessEnvelope,
          tags: [`file:${imported.sourceName}`],
          role: defaultRoleForNewVideo(current),
        });
        return assignClipsFromRoles(current);
      });
    });
  };

  const extractStill = (
    clipId: string,
    role: CardStillRole,
    at?: number,
  ): void => {
    if (!project) return;
    const clip = project.clips.find((item) => item.id === clipId);
    const asset = project.assets.find((item) => item.id === clip?.assetId);
    if (!clip || !asset) return;
    setPreviewReveal('card');
    void run(async () => {
      const stillId = crypto.randomUUID();
      const requestedSeconds =
        at ?? (role === 'result' ? Math.max(clip.in, clip.out - 0.1) : clip.in);
      const mediaEnd =
        asset.meta.duration && asset.meta.duration > 0
          ? asset.meta.duration
          : Math.max(clip.out, requestedSeconds);
      const seconds =
        at === undefined
          ? Math.min(clip.out, Math.max(clip.in, requestedSeconds))
          : Math.min(mediaEnd, Math.max(0, requestedSeconds));
      const stillPath = await window.studio.extractStill(
        asset.path,
        project.id,
        stillId,
        seconds,
      );
      store.updateProject((current) => {
        current.stills.push({
          id: stillId,
          assetId: asset.id,
          frame: seconds,
          role,
          path: stillPath,
        });
        current.cardStills[role] = stillId;
        return current;
      });
    });
  };

  const openSceneClipEditor = (sceneKey: SceneKey): void => {
    if (!project) return;
    const scene = project.scenes.find((item) => item.sceneKey === sceneKey);
    const clip = project.clips.find((item) => item.id === scene?.clipId);
    if (!scene || !clip) return;

    const usageCount = project.scenes.filter((item) => item.clipId === clip.id).length;
    const nextClipId = usageCount > 1 ? crypto.randomUUID() : clip.id;
    store.updateProject((current) => {
      if (usageCount > 1) {
        const source = current.clips.find((item) => item.id === clip.id);
        const targetScene = current.scenes.find((item) => item.sceneKey === sceneKey);
        if (source && targetScene) {
          current.clips.push({ ...source, id: nextClipId });
          targetScene.clipId = nextClipId;
        }
      }
      const targetClip = current.clips.find((item) => item.id === nextClipId);
      const asset = current.assets.find((item) => item.id === targetClip?.assetId);
      if (!targetClip || !asset) return current;
      const mediaDuration = asset.meta.duration ?? targetClip.out;
      const targetDuration = sceneItemDuration(current, sceneKey);
      if (mediaDuration > 0 && targetClip.out - targetClip.in > targetDuration + 0.05) {
        const next = rangeForSceneDuration(targetClip.in, targetDuration, mediaDuration);
        targetClip.in = next.in;
        targetClip.out = next.out;
      }
      return current;
    });
    setEditingClipId(nextClipId);
    setEditingSceneKey(sceneKey);
  };

  const confirmDeleteProject = (): void => {
    if (!projectToDelete) return;
    const target = projectToDelete;
    setProjectToDelete(null);
    void run(async () => {
      if (useStudioStore.getState().project?.id === target.id) {
        store.setProject(null);
      }
      await window.studio.deleteProject(target.id);
      await refreshProjects();
    });
  };

  const duplicateCurrent = (): void => {
    if (!project) return;
    void run(async () => {
      const copy = await window.studio.duplicateProject(project.id);
      store.setProject(copy);
      await refreshProjects();
    });
  };

  const registerAudio = (registration: AudioRegistration, sourcePath?: string): void => {
    void run(async () => {
      const registered = await window.studio.registerAudio(registration, sourcePath);
      if (!registered) return;
      store.setAudioTracks(await window.studio.listAudio());
      store.updateProject((current) => {
        current.audio.bgm = {
          audioTrackId: registered.id,
          start: 0,
          duration: getDurationInFrames(current) / current.templateParams.fps,
          offset: 0,
          fadeIn: 0.5,
          fadeOut: 0.5,
          ducking: true,
          gain: 0.02,
        };
        return current;
      });
    });
  };

  const exportBoth = (): void => {
    const currentProject = useStudioStore.getState().project;
    if (!currentProject || exporting) return;
    const exportPresets = currentProject.guide.exportPresets;
    const exportWithoutBgm = currentProject.guide.exportWithoutBgm;
    const started = Date.now();
    playerRef.current?.pause();
    setExporting(true);
    store.setError(null);
    void (async () => {
      try {
        store.setExportProgress({ language: 'ja', phase: 'bundle', progress: 0 });
        const result = await window.studio.exportProject({
          project: useStudioStore.getState().project!,
          presets: exportPresets,
          exportWithoutBgm,
        });
        const outputs = result.files;
        const snapshot = useStudioStore.getState();
        const drafted = structuredClone(snapshot.project!);
        const deliveredPresets = exportPresets.length > 0 ? exportPresets : publishingPresets(drafted);
        if (deliveredPresets.length > 0) drafted.guide.exportPresets = deliveredPresets;
        drafted.guide.exportWithoutBgm = exportWithoutBgm;
        drafted.publishing.links = { ...drafted.publishing.links, ...result.links };
        const exportedProject = followPublishing(drafted);
        const outputFile = outputs[0] ?? '';
        const workspacePath = snapshot.workspace ?? '';
        const directory = outputFile.replace(/[\\/][^\\/]+$/, '');
        const outputDir =
          workspacePath && directory.toLowerCase().startsWith(workspacePath.toLowerCase())
            ? directory.slice(workspacePath.length).replace(/^[\\/]/, '')
            : directory || undefined;
        exportedProject.guide.lastExport = {
          at: new Date().toISOString(),
          projectUpdatedAt: exportedProject.updatedAt,
          presets: deliveredPresets,
          contentStamp: exportContentStamp(exportedProject),
          outputDir,
        };
        if (exportedProject.status === 'editing') exportedProject.status = 'exported';
        const elapsed = Date.now() - started;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.round((elapsed % 60000) / 1000);
        const clock = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
        const count = (slot: 'ja' | 'en' | 'x') =>
          outputs.filter((file) => file.includes(`_lineup_${slot}`)).length;
        setExportNote(
          `English ${count('en')}ファイル · 日本語 ${count('ja')}ファイル · X ${count('x')}ファイル · ${clock}`,
        );
        let saved: SaveCommit;
        try {
          saved = await persistProject(snapshot.projectRevision, exportedProject);
        } catch (saveError) {
          store.setError(`書き出しは完了しました。${errorMessage(saveError)}`);
          setAudioUsage(await window.studio.listAudioUsage());
          await refreshProjects();
          return;
        }
        if (saved === 'stale') {
          useStudioStore.getState().updateProject((current) => {
            if (current.status === 'editing') current.status = 'exported';
            current.guide.lastExport = exportedProject.guide.lastExport;
            if (deliveredPresets.length > 0) current.guide.exportPresets = deliveredPresets;
            current.publishing.links = { ...current.publishing.links, ...result.links };
            current.guide.exportWithoutBgm = exportWithoutBgm;
            return current;
          });
        }
        if (saved === 'rejected') {
          const reason = useStudioStore.getState().error ?? 'プロジェクトの保存に失敗しました';
          store.setError(`書き出しは完了しました。${reason}`);
        } else {
          store.setError(`書き出し完了: ${outputs[0]}`);
        }
        setAudioUsage(await window.studio.listAudioUsage());
        await refreshProjects();
      } catch (exportError) {
        store.setError(errorMessage(exportError));
      } finally {
        setExporting(false);
        store.setExportProgress(null);
      }
    })();
  };

  const backupProjects = (): void => {
    void run(async () => {
      const destination = await window.studio.exportBackup();
      if (destination) store.setError(`バックアップ完了: ${destination}`);
    });
  };

  const restoreProjects = (): void => {
    void run(async () => {
      const imported = await window.studio.importBackup();
      if (imported === null) return;
      store.setAudioTracks(await window.studio.listAudio());
      await refreshProjects();
      store.setError(`${imported}件のプロジェクトを取り込みました`);
    });
  };

  const readyCount = analytics ? readyTasks(analytics).length : 0;
  const shell = (child: ReactNode) => (
    <AnalyticsContext.Provider
      value={{
        bundle: analytics,
        reload: reloadAnalytics,
        pausedToday,
        setPausedToday,
        openReview: (taskId?: string) => {
          setArea('review');
          setAnalyticsPage(taskId ? 'guide' : 'home');
          setFocusTaskId(taskId ?? null);
        },
        openDetail: (tab) => {
          setArea('detail');
          setDetailTab(tab);
          setAnalyticsPage('home');
        },
        openWeekly: () => {
          setArea('review');
          setAnalyticsPage('weekly');
        },
        openExperimentNew: (variable, link) => {
          setPrefillVariable(variable);
          setExperimentLink(link);
          setArea('detail');
          setAnalyticsPage('experiment-new');
        },
        openProject: (projectId: string) => {
          setArea('create');
          setAnalyticsPage('home');
          void run(async () => store.setProject(await window.studio.loadProject(projectId)));
        },
      }}
    >
      <div className="an-app">
        <AppNav
          area={area}
          readyCount={readyCount}
          onHome={() => {
            setArea('create');
            store.setProject(null);
          }}
          onCreate={() => setArea('create')}
          onReview={() => {
            setArea('review');
            setAnalyticsPage('home');
          }}
          onDetail={() => {
            setArea('detail');
            setAnalyticsPage('home');
          }}
        />
        <div className="an-stage">{child}</div>
      </div>
    </AnalyticsContext.Provider>
  );

  if (!workspace) {
    return (
      <main className="welcome">
        <div className="welcome-card">
          <img className="welcome-title" src={cvTitleUrl} alt="Clutch Vault" />
          <span className="eyebrow">CV CREATOR STUDIO</span>
          <h1>定点ショートを、日英まとめて。</h1>
          <p>最初に素材・プロジェクト・書き出しを保存するフォルダを選択します。</p>
          <button className="primary" onClick={chooseWorkspace} disabled={busy}>
            保存先フォルダを選択
          </button>
          {error && <div className="notice error">{error}</div>}
        </div>
      </main>
    );
  }

  if (area !== 'create') {
    return shell(
      analyticsPage === 'weekly' ? (
        <WeeklyReview />
      ) : analyticsPage === 'experiment-new' ? (
        <ExperimentNew
          key={experimentLink?.postIds.join(',') ?? prefillVariable ?? 'new'}
          variable={prefillVariable}
          link={experimentLink}
        />
      ) : analyticsPage === 'guide' && focusTaskId ? (
        <GuideAnalysis taskId={focusTaskId} />
      ) : area === 'detail' ? (
        <DetailShell tab={detailTab} onTab={setDetailTab} />
      ) : (
        <ReviewHome />
      ),
    );
  }

  if (!project) {
    return shell(
      <GuideHome
        onBackup={backupProjects}
        onRestore={restoreProjects}
        onWorkspace={chooseWorkspace}
        publishHold={publishHold}
        onResumePublish={() => setPublishHold(false)}
        onOpenReview={(taskId) => {
          setPublishHold(false);
          setArea('review');
          setAnalyticsPage('guide');
          setFocusTaskId(taskId);
        }}
      />,
    );
  }

  const exportPresets = project.guide.exportPresets;
  const exportWithoutBgm = project.guide.exportWithoutBgm;
  const setExportPreset = (preset: DeliveryPresetId, checked: boolean): void => {
    store.updateProject((current) => {
      const next = new Set(current.guide.exportPresets);
      if (checked) next.add(preset);
      else next.delete(preset);
      current.guide.exportPresets = DELIVERY_PRESET_ORDER.filter((id) => next.has(id));
      return current;
    });
  };
  const wantsVideo = exportPresets.some((id) => DELIVERY_PRESETS[id].videoLanguage);
  const videoLanguages = videoLanguagesFor(exportPresets);
  const exportJobs = jobsForPresets(exportPresets, project.guide.thumbnailOnly);
  const setThumbnailOnly = (language: 'ja' | 'en', checked: boolean): void => {
    store.updateProject((current) => {
      const next = new Set(current.guide.thumbnailOnly);
      if (checked) next.add(language);
      else next.delete(language);
      current.guide.thumbnailOnly = (['ja', 'en'] as const).filter((id) => next.has(id));
      return current;
    });
  };
  const clipEditor =
    editingSceneKey && editingClipId ? (
      <div
        className="clip-editor-backdrop"
        onClick={() => {
          setEditingSceneKey(null);
          setEditingClipId(null);
        }}
      >
        <div className="clip-editor-dialog" onClick={(event) => event.stopPropagation()}>
          <VideoClipEditor
            project={project}
            sceneKey={editingSceneKey}
            clipId={editingClipId}
            onChangeRange={(range) =>
              store.updateProject((current) => {
                const target = current.clips.find((item) => item.id === editingClipId);
                if (target) {
                  target.in = range.in;
                  target.out = range.out;
                }
                return applySceneCutDuration(current, editingSceneKey, range.out - range.in);
              })
            }
            onExtractStill={(role, seconds) => extractStill(editingClipId, role, seconds)}
            onClose={() => {
              setEditingSceneKey(null);
              setEditingClipId(null);
            }}
          />
        </div>
      </div>
    ) : null;
  const statusToast = (error || exportProgress || busy) && (
    <div className={`status-toast ${error?.startsWith('書き出し完了') ? 'success' : ''}`}>
      {busy && !exportProgress && '処理中…'}
      {exportProgress &&
        `書き出し ${exportProgress.language.toUpperCase()} · ${exportProgress.phase} · ${Math.round(
          exportProgress.progress * 100,
        )}%${exportProgress.remainingSec ? ` · 残り約${exportProgress.remainingSec}秒` : ''}`}
      {error && <span>{error}</span>}
      {error && (
        <button aria-label="閉じる" onClick={() => store.setError(null)}>
          ×
        </button>
      )}
    </div>
  );

  if (project.guide.mode === 'guide') {
    return shell(
      <>
        <GuideShell
          project={project}
          playerRef={playerRef}
          playbackFrameRef={playbackFrameRef}
          sceneKey={guideScene}
          onSceneKey={setGuideScene}
          onImportVideo={importGuideVideo}
          onEditRange={openSceneClipEditor}
          audioUsage={audioUsage}
          onExport={exportBoth}
          exporting={exporting}
          exportNote={exportNote}
          showSafeZone={showSafeZone}
          onPublishingHome={(hold) => {
            setPublishHold(hold);
            setArea('create');
            store.setProject(null);
          }}
        />
        {clipEditor}
        {statusToast}
      </>,
    );
  }

  return shell(
    <div className="app-shell">
      <header className="topbar">
        <div className="top-actions">
          <span className={dirty ? 'save-state dirty' : 'save-state'}>
            {dirty ? '保存中…' : '保存済み'}
          </span>
          <button onClick={chooseWorkspace}>保存先変更</button>
          <details className="export-options">
            <summary>書き出し設定</summary>
            <div>
              {DELIVERY_PRESET_ORDER.map((preset) => (
                <label key={preset}>
                  <input
                    type="checkbox"
                    checked={exportPresets.includes(preset)}
                    onChange={(event) => setExportPreset(preset, event.target.checked)}
                  />
                  {DELIVERY_PRESETS[preset].label}
                </label>
              ))}
              <p className="export-hint">チェックしたプリセットだけ書き出します。同じ言語の動画は1本です。</p>
              <p className="export-hint">サムネイルだけ（動画なし）</p>
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
                    {language === 'ja' ? '日本語サムネイル' : '英語サムネイル'}
                    {withVideo ? '（動画と一緒）' : ''}
                  </label>
                );
              })}
              <label>
                <input
                  type="checkbox"
                  checked={exportWithoutBgm}
                  disabled={!wantsVideo}
                  onChange={(event) =>
                    store.updateProject((current) => {
                      current.guide.exportWithoutBgm = event.target.checked;
                      return current;
                    })
                  }
                />
                BGMなし版も生成
              </label>
            </div>
          </details>
          <div className="gd-mode" role="group" aria-label="画面の切り替え">
            <button
              type="button"
              onClick={() =>
                store.updateProject((current) => {
                  current.guide.mode = 'guide';
                  return current;
                })
              }
            >
              ガイド作成
            </button>
            <button type="button" className="is-on">
              詳細編集
            </button>
          </div>
          <button className="primary" onClick={exportBoth} disabled={!project || exporting || exportJobs.length === 0}>
            {`書き出す（${exportPresets.length + exportJobs.filter((job) => job.presetIds.length === 0).length}件）`}
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-heading">
          <h2>プロジェクト</h2>
          <button onClick={backupProjects} disabled={busy}>バックアップ</button>
          <button
            onClick={() =>
              void run(async () => {
                const file = await window.studio.exportPostsCsv();
                if (file) store.setError(`CSVを書き出しました: ${file}`);
              })
            }
            disabled={busy}
          >
            数字CSV
          </button>
          <button onClick={restoreProjects} disabled={busy}>取り込み</button>
          <button className="icon-button" onClick={createProject} disabled={busy} title="新規作成">
            ＋
          </button>
          <button onClick={duplicateCurrent} disabled={busy || !project} title="複製">
            複製
          </button>
        </div>
        <div className="project-list">
          <select
            className="status-filter"
            aria-label="状態で絞り込む"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
          >
            <option value="all">すべての状態</option>
            <option value="editing">編集中</option>
            <option value="exported">書き出し済み</option>
            <option value="posted">投稿済み</option>
          </select>
          {projects.filter((item) => statusFilter === 'all' || item.status === statusFilter).length === 0 && (
            <p className="muted">プロジェクトはまだありません。</p>
          )}
          {projects
            .filter((item) => statusFilter === 'all' || item.status === statusFilter)
            .map((item) => (
            <div
              key={item.id}
              className={`project-item ${project?.id === item.id ? 'active' : ''}`}
            >
              <button
                className="project-item-open"
                onClick={() =>
                  void run(async () => store.setProject(await window.studio.loadProject(item.id)))
                }
              >
                <strong>{item.title}</strong>
                <span>
                  {item.map.toUpperCase()} · {item.agent.toUpperCase()}
                  {item.pendingMetrics > 0 ? ` · 数字未入力 ${item.pendingMetrics}` : ''}
                </span>
              </button>
              <button
                className="project-item-delete"
                title="プロジェクトを削除"
                disabled={busy}
                onClick={() => setProjectToDelete(item)}
              >
                削除
              </button>
            </div>
          ))}
        </div>
      </aside>

      {projectToDelete && (
        <div className="confirm-backdrop" onClick={() => setProjectToDelete(null)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">DELETE PROJECT</span>
            <h2 id="delete-project-title">プロジェクトを削除しますか？</h2>
            <p>
              「{projectToDelete.title}」を削除します。映像・静止画を含むプロジェクトデータは元に戻せません。
            </p>
            <div className="confirm-actions">
              <button onClick={() => setProjectToDelete(null)}>キャンセル</button>
              <button className="primary" onClick={confirmDeleteProject} disabled={busy}>
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      <main className={project ? 'workspace has-timeline' : 'workspace'}>
        {!project ? (
          <section className="empty-state">
            <h1>制作を始める</h1>
            <p>既存のプロジェクトを開くか、新規プロジェクトを作成してください。</p>
            <button className="primary" onClick={createProject} disabled={busy}>
              新規プロジェクト
            </button>
          </section>
        ) : (
          <>
            <PreviewStage
              project={project}
              language={language}
              audioTracks={audioTracks}
              showSafeZone={showSafeZone}
              playerRef={playerRef}
              durationInFrames={durationInFrames}
              revealPane={previewReveal}
              playbackSuspended={exporting}
              onLanguage={store.setLanguage}
              onShowSafeZone={setShowSafeZone}
              onRevealHandled={() => setPreviewReveal(null)}
            />
            <div id="timeline-inspector-root" className="timeline-inspector-slot" />
            <TimelinePanel
              project={project}
              tracks={audioTracks}
              playerRef={playerRef}
              previewLinked
              language={language}
              busy={busy}
              audioUsage={audioUsage}
              defaultBgmTrackId={defaultBgmTrackId}
              defaultPostPlatform={
                DELIVERY_PRESETS[exportPresets[0] ?? 'yt-global'].platform
              }
              focusSceneKey={guideScene}
              onFocusScene={setGuideScene}
              onChange={store.updateProject}
              onImportVideo={importVideo}
              onEditRange={openSceneClipEditor}
              onRegisterAudio={registerAudio}
              onSetDefaultBgm={setDefaultBgm}
              onSave={() => {
                const state = useStudioStore.getState();
                const current = state.project;
                if (!current) return;
                const revision = state.projectRevision;
                void persistProject(revision, current).catch((saveError: unknown) => {
                  useStudioStore.getState().setError(`保存に失敗しました: ${errorMessage(saveError)}`);
                });
              }}
            />
            {clipEditor}
          </>
        )}
      </main>

      {statusToast}
    </div>,
  );
};

const formatTime = (seconds: number): string => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
};

const VideoClipEditor = ({
  project,
  sceneKey,
  clipId,
  onChangeRange,
  onExtractStill,
  onClose,
}: {
  project: Project;
  sceneKey: SceneKey;
  clipId: string;
  onChangeRange: (range: { in: number; out: number }) => void;
  onExtractStill: (role: CardStillRole, seconds: number) => void;
  onClose: () => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const isScrubbingRef = useRef(false);
  const clip = project.clips.find((item) => item.id === clipId);
  const asset = project.assets.find((item) => item.id === clip?.assetId);
  const duration = asset?.meta.duration ?? clip?.out ?? 0;
  const frameStep = 1 / project.templateParams.fps;
  const targetDuration = sceneItemDuration(project, sceneKey);
  const [playhead, setPlayhead] = useState(clip?.in ?? 0);

  useEffect(() => {
    if (!clip) return;
    setPlayhead(clip.in);
    if (videoRef.current) videoRef.current.currentTime = clip.in;
  }, [clipId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!clip || !asset) return null;

  const seek = (seconds: number): void => {
    if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return;
    const next = Math.min(duration, Math.max(0, seconds));
    setPlayhead(next);
    pendingSeekRef.current = next;
    if (videoRef.current) {
      if (Math.abs(videoRef.current.currentTime - next) > frameStep / 2) {
        videoRef.current.currentTime = next;
      } else {
        pendingSeekRef.current = null;
      }
    }
  };

  const setIn = (seconds: number): void => {
    const nextIn = Math.min(Math.max(0, seconds), clip.out - frameStep);
    onChangeRange({ in: nextIn, out: clip.out });
  };

  const setOut = (seconds: number): void => {
    const nextOut = Math.max(Math.min(duration, seconds), clip.in + frameStep);
    onChangeRange({ in: clip.in, out: nextOut });
  };

  const applySceneWindow = (start: number): void => {
    const next = rangeForSceneDuration(start, targetDuration, duration);
    onChangeRange(next);
    seek(next.in);
  };

  const selectionLeft = duration > 0 ? (clip.in / duration) * 100 : 0;
  const selectionWidth = duration > 0 ? ((clip.out - clip.in) / duration) * 100 : 100;
  const playheadLeft = duration > 0 ? (playhead / duration) * 100 : 0;

  const timeFromPointer = (clientX: number): number | null => {
    const bounds = timelineRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || !Number.isFinite(clientX) || duration <= 0) {
      return null;
    }
    const ratio = (clientX - bounds.left) / bounds.width;
    const seconds = Math.min(1, Math.max(0, ratio)) * duration;
    return Number.isFinite(seconds) ? seconds : null;
  };

  const updateAtTime = (
    kind: 'playhead' | 'in' | 'out',
    seconds: number,
  ): void => {
    if (!Number.isFinite(seconds)) return;
    if (kind === 'in') {
      const lockToScene = Math.abs(clip.out - clip.in - targetDuration) <= 0.08;
      if (lockToScene) {
        applySceneWindow(seconds);
        return;
      }
      const nextIn = Math.min(Math.max(0, seconds), clip.out - frameStep);
      setIn(nextIn);
      seek(nextIn);
      return;
    }
    if (kind === 'out') {
      const nextOut = Math.max(Math.min(duration, seconds), clip.in + frameStep);
      setOut(nextOut);
      seek(nextOut);
      return;
    }
    seek(seconds);
  };

  const updateFromPointer = (
    kind: 'playhead' | 'in' | 'out',
    clientX: number,
  ): void => {
    const seconds = timeFromPointer(clientX);
    if (seconds === null) return;
    updateAtTime(kind, seconds);
  };

  const startHandleDrag = (
    kind: 'playhead' | 'in' | 'out',
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    isScrubbingRef.current = true;
    videoRef.current?.pause();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(kind, event.clientX);
  };

  const moveHandle = (
    kind: 'playhead' | 'in' | 'out',
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromPointer(kind, event.clientX);
  };

  const finishHandleDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    isScrubbingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const moveHandleByKeyboard = (
    kind: 'playhead' | 'in' | 'out',
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = kind === 'in' ? clip.in : kind === 'out' ? clip.out : playhead;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    updateAtTime(kind, current + direction * frameStep);
  };

  return (
    <section className="clip-editor-inline" aria-label={`${sceneKey}の映像範囲エディタ`}>
        <header className="clip-editor-heading">
          <div>
            <span className="eyebrow">{SCENE_BAND[sceneKey]}</span>
            <h2>映像から使用範囲を指定</h2>
            <p className="clip-editor-hint">
              このシーンは {targetDuration.toFixed(1)} 秒です。開始位置を決めれば、終了位置はシーン尺に合わせられます。
            </p>
          </div>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="clip-editor-video">
          <video
            ref={videoRef}
            src={mediaUrl(asset.proxyPath ?? asset.path)}
            controls
            onLoadedMetadata={() => seek(clip.in)}
            onTimeUpdate={(event) => {
              const current = event.currentTarget.currentTime;
              if (isScrubbingRef.current || pendingSeekRef.current !== null) return;
              setPlayhead(current);
              if (current >= clip.out && !event.currentTarget.paused) {
                event.currentTarget.pause();
                seek(clip.out);
              }
            }}
            onSeeked={(event) => {
              const requested = pendingSeekRef.current;
              const current = event.currentTarget.currentTime;
              if (
                requested !== null &&
                Math.abs(current - requested) > Math.max(frameStep * 1.5, 0.02)
              ) {
                event.currentTarget.currentTime = requested;
                return;
              }
              pendingSeekRef.current = null;
              if (!isScrubbingRef.current) setPlayhead(current);
            }}
          />
        </div>

        <div className="timeline-readout">
          <strong>{formatTime(playhead)}</strong>
          <span>
            選択 {formatTime(clip.in)} — {formatTime(clip.out)}（
            {(clip.out - clip.in).toFixed(2)}秒）
          </span>
        </div>

        <div
          ref={timelineRef}
          className="range-timeline"
          title="クリックして再生位置を移動"
        >
          <div className="range-track" />
          <div
            className="range-selection"
            style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
          />
          <div className="range-playhead" style={{ left: `${playheadLeft}%` }} />
          <button
            type="button"
            className="range-seek-surface"
            aria-label="クリックまたはドラッグして再生位置を移動"
            onPointerDown={(event) => startHandleDrag('playhead', event)}
            onPointerMove={(event) => moveHandle('playhead', event)}
            onPointerUp={finishHandleDrag}
            onPointerCancel={finishHandleDrag}
          />
          <button
            type="button"
            className="range-drag-handle range-playhead-handle"
            aria-label="現在の再生位置"
            style={{ left: `${playheadLeft}%` }}
            onPointerDown={(event) => startHandleDrag('playhead', event)}
            onPointerMove={(event) => moveHandle('playhead', event)}
            onPointerUp={finishHandleDrag}
            onPointerCancel={finishHandleDrag}
            onKeyDown={(event) => moveHandleByKeyboard('playhead', event)}
          />
          <button
            type="button"
            className="range-drag-handle range-handle-in"
            aria-label="開始位置"
            style={{ left: `${selectionLeft}%` }}
            onPointerDown={(event) => startHandleDrag('in', event)}
            onPointerMove={(event) => moveHandle('in', event)}
            onPointerUp={finishHandleDrag}
            onPointerCancel={finishHandleDrag}
            onKeyDown={(event) => moveHandleByKeyboard('in', event)}
          />
          <button
            type="button"
            className="range-drag-handle range-handle-out"
            aria-label="終了位置"
            style={{ left: `${selectionLeft + selectionWidth}%` }}
            onPointerDown={(event) => startHandleDrag('out', event)}
            onPointerMove={(event) => moveHandle('out', event)}
            onPointerUp={finishHandleDrag}
            onPointerCancel={finishHandleDrag}
            onKeyDown={(event) => moveHandleByKeyboard('out', event)}
          />
        </div>

        <div className="range-fields">
          <label>
            IN
            <input
              type="number"
              min={0}
              max={clip.out - frameStep}
              step={frameStep}
              value={Number(clip.in.toFixed(2))}
              onChange={(event) => setIn(Number(event.target.value))}
            />
          </label>
          <button onClick={() => applySceneWindow(playhead)}>現在位置からシーン尺で選択</button>
          <label>
            OUT
            <input
              type="number"
              min={clip.in + frameStep}
              max={duration}
              step={frameStep}
              value={Number(clip.out.toFixed(2))}
              onChange={(event) => setOut(Number(event.target.value))}
            />
          </label>
          <button onClick={() => setOut(playhead)}>現在位置を OUT に設定</button>
          <button className="span-all" onClick={() => applySceneWindow(clip.in)}>
            開始位置から{targetDuration.toFixed(1)}秒に合わせる
          </button>
        </div>

        <div className="still-capture">
          <div>
            <strong>現在のフレームをカードに使用</strong>
            <span>{formatTime(playhead)} の映像を静止画として保存します</span>
          </div>
          <div className="still-actions">
            {CARD_STILL_ROLES.map((role) => (
              <button key={role} onClick={() => onExtractStill(role, playhead)}>
                {role.toUpperCase()} に設定
              </button>
            ))}
          </div>
        </div>

        <footer className="clip-editor-footer">
          <span>再生位置は動画上のシークバーでも移動できます</span>
          <button onClick={onClose}>
            エディタを閉じる
          </button>
        </footer>
    </section>
  );
};
