import { useEffect, useState } from 'react';
import {
  DELIVERY_PRESETS,
  replaceClutchVaultUrl,
  type DeliveryPresetId,
} from '../../shared/delivery-presets';
import { guessBasename, trackingFor } from '../../shared/export-copy';
import { dueAtFor7d } from '../../shared/analytics';
import { fromDateTimeLocal, toDateTimeLocal } from '../../shared/guide';
import {
  PUBLISH_PAGES,
  QA_ITEMS,
  canCompletePublish,
  doneCount,
  isPublishTask,
  manualPrecheckReady,
  publishingPresets,
  qaReady,
  remainingCount,
  taskBlurb,
  taskShortLabel,
  taskTitle,
  type PublishingView,
  type WorkflowTask,
} from '../../shared/publishing';
import { checkPostUrl } from '../../shared/post-url';
import type { Project } from '../../shared/schema/project';
import { activeTimeline } from '../../shared/timeline';
import { mediaUrl } from './media';
import { XPostComposer } from './XPostComposer';
import { YoutubePublishPanel } from './YoutubePublishPanel';

const presetOf = (value: string | undefined): DeliveryPresetId | undefined =>
  value && value in DELIVERY_PRESETS ? (value as DeliveryPresetId) : undefined;

const copyLanguage = (preset: DeliveryPresetId): 'ja' | 'en' | 'ko' =>
  DELIVERY_PRESETS[preset].copyLanguages[0] ?? 'ja';

const platformName = (platform: 'youtube' | 'tiktok' | 'x'): string =>
  platform === 'youtube' ? 'YouTube' : platform === 'tiktok' ? 'TikTok' : 'X';

const languageName = (language: 'ja' | 'en' | 'ko'): string =>
  language === 'en' ? 'English' : language === 'ko' ? '한국어' : '日本語';

const pad = (value: number): string => String(value).padStart(2, '0');

const clock = (iso?: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const dayLabel = (iso?: string): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
};

const shortUrl = (url: string): string => url.replace(/^https?:\/\//, '');

const nextCue = (task: WorkflowTask): string => {
  const title = taskTitle(task);
  return title.endsWith('してください') ? title.slice(0, -'してください'.length) : title;
};

const ExternalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);

export const PublishFlow = ({
  project,
  onHome,
  onProject,
  onActive,
}: {
  project: Project;
  onHome: (hold: boolean) => void;
  onProject: (project: Project) => void;
  onActive?: (active: boolean) => void;
}) => {
  const [view, setView] = useState<PublishingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    void window.studio
      .getPublishing(project.id)
      .then((next) => {
        if (alive) setView(next);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      alive = false;
    };
  }, [project.id, project.updatedAt, project.guide.lastExport?.contentStamp]);

  const active = Boolean(view && (view.started || view.workflow?.status === 'done'));
  useEffect(() => {
    onActive?.(active);
  }, [active, onActive]);
  useEffect(() => () => onActive?.(false), [onActive]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!project.guide.lastExport) {
    return (
      <div className="pw pw-intro">
        <header className="pw-head">
          <span className="gd-kicker">STEP 10 / 10</span>
          <h1>投稿・運用</h1>
          <p>先に手順9で書き出してください。書き出しが終わると、ここから投稿の手順が始まります。</p>
        </header>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="pw">
        <p className="gd-muted">{error ?? '投稿運用を読み込んでいます'}</p>
      </div>
    );
  }

  const applyProject = (next: { project: Project; view: PublishingView }): void => {
    setView(next.view);
    onProject(next.project);
  };

  if (!view.started && view.workflow?.status !== 'done') {
    const exportedAt = clock(project.guide.lastExport.at);
    const presets = publishingPresets(project);
    return (
      <div className="pw pw-intro">
        <header className="pw-head">
          <span className="gd-kicker">STEP 10 / 10</span>
          <h1>投稿・運用</h1>
          <p>書き出したものを各媒体に投稿し、公開を確かめて記録するところまで、1件ずつ案内します</p>
        </header>
        <section className="pw-start">
          <div className="pw-start-top">
            <strong>✓ 書き出し完了</strong>
            <span>
              {[exportedAt, `${presets.length}プリセット`, `${view.files.length}ファイル`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <div className="pw-start-grid">
            {presets.map((preset) => (
              <div key={preset}>
                <strong>{platformName(DELIVERY_PRESETS[preset].platform)}</strong>
                <span>{DELIVERY_PRESETS[preset].detail}</span>
                <span className="gd-mono">{preset}</span>
              </div>
            ))}
          </div>
          {presets.length === 0 ? (
            <p>投稿先のプリセットがありません。手順9でプリセットを選んで書き出してください。</p>
          ) : (
            <p>
              この順に進めます：
              {view.tasks.map((task) => taskShortLabel(task)).join(' → ')}（{view.tasks.length}件）
            </p>
          )}
          <div className="pw-start-actions">
            <button
              type="button"
              className="pw-primary"
              disabled={busy || presets.length === 0}
              onClick={() =>
                void run(async () => setView(await window.studio.startPublishing(project.id)))
              }
            >
              投稿運用を始める
            </button>
            <span>あとからでも、ホームの「次にやること」から再開できます</span>
          </div>
        </section>
        {error && <p className="pw-error">{error}</p>}
        <PostLog project={project} view={view} busy={busy} onSaved={applyProject} />
      </div>
    );
  }

  const opened = openedId ? view.tasks.find((item) => item.id === openedId) : undefined;
  const task = opened ?? view.current;
  const done = view.workflow?.status === 'done';
  const reviewing = Boolean(task && task.id !== view.current?.id);
  const openTask = (id: string): void => {
    setShowAll(false);
    setOpenedId(id === view.current?.id ? null : id);
  };

  return (
    <div className="pw pw-active">
      <FlowRail project={project} view={view} viewedId={task?.id} onOpen={openTask} onShowAll={() => setShowAll(true)} />
      {view.workflow?.staleExport && (
        <p className="pw-stale">新しい書き出しがあります。投稿済みのタスクは戻していません。未投稿のファイルだけ新しい書き出しを使います。</p>
      )}
      <div className="pw-main">
        {showAll ? (
          <AllTasks
            project={project}
            view={view}
            onOpen={openTask}
            onBack={() => setShowAll(false)}
          />
        ) : task ? (
          <TaskBody
            project={project}
            view={view}
            task={task}
            reviewing={reviewing}
            busy={busy}
            error={error}
            onRun={run}
            onView={setView}
            onSaved={applyProject}
            onCloseReview={() => setOpenedId(null)}
          />
        ) : done ? (
          <section className="pw-task">
            <div className="pw-done">
              <h1>投稿運用が完了しました</h1>
              <p>7日後に振り返ります</p>
              <strong>{dayLabel(dueAtFor7d(firstPostedAt(project)))}</strong>
              {view.settings.enable24hCheck && (
                <p className="gd-muted">24時間後の確認 {dayLabel(plusDay(firstPostedAt(project)))}</p>
              )}
              <button type="button" className="pw-primary" onClick={() => onHome(false)}>
                ホームへ
              </button>
              <p className="gd-muted">上の進み具合か「全タスクを見る」から、完了したタスクの画面を開けます</p>
            </div>
            {error && <p className="pw-error">{error}</p>}
            <PostLog project={project} view={view} busy={busy} onSaved={applyProject} />
          </section>
        ) : (
          <section className="pw-task">
            <p className="gd-muted">次のタスクがありません</p>
          </section>
        )}
      </div>
      {!done && (
        <footer className="pw-foot">
          <button
            type="button"
            className="pw-pause"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.studio.pausePublishing(project.id);
                onHome(true);
              })
            }
          >
            今日はここまで
          </button>
          <span className="gd-muted">閉じても、次回はこのタスクから再開します</span>
          <span className="pw-remain">
            このあと <strong>残り {remainingCount(view.tasks, view.current?.id)}件</strong>
          </span>
        </footer>
      )}
    </div>
  );
};

const firstPostedAt = (project: Project): string =>
  project.posts
    .map((post) => post.postedAt)
    .filter(Boolean)
    .sort()[0] ?? new Date().toISOString();

const plusDay = (iso: string): string => new Date(new Date(iso).getTime() + 24 * 60 * 60 * 1000).toISOString();

const FlowRail = ({
  project,
  view,
  viewedId,
  onOpen,
  onShowAll,
}: {
  project: Project;
  view: PublishingView;
  viewedId?: string;
  onOpen: (id: string) => void;
  onShowAll: () => void;
}) => {
  const exportedAt = clock(project.guide.lastExport?.at);
  return (
    <header className="pw-rail">
      <div className="pw-rail-id">
        <span className="pw-rail-kicker">投稿運用</span>
        <strong>{project.title}</strong>
        <em>
          書き出し {exportedAt || '—'} · {publishingPresets(project).join(' · ')}
        </em>
      </div>
      <ol aria-label="投稿運用の進み具合" style={{ gridTemplateColumns: `repeat(${view.tasks.length}, minmax(0, 1fr))` }}>
        {view.tasks.map((task, index) => {
          const state =
            task.id === viewedId
              ? 'is-current'
              : task.status === 'needs-fix'
                ? 'is-fix'
                : task.status === 'done' || task.status === 'skipped'
                  ? 'is-done'
                  : '';
          const mark =
            task.status === 'needs-fix' ? '!' : task.status === 'done' || task.status === 'skipped' ? '✓' : String(index + 1);
          return (
            <li key={task.id} className={state}>
              <button
                type="button"
                className="pw-rail-open"
                aria-current={task.id === viewedId ? 'step' : undefined}
                onClick={() => onOpen(task.id)}
              >
                <span className="pw-rail-bar" />
                <span className="pw-rail-name">
                  <span>{mark}</span>
                  {taskShortLabel(task)}
                  {task.status === 'skipped' ? '（スキップ）' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="pw-rail-count">
        <span className="gd-mono">
          完了 {doneCount(view.tasks)} / {view.tasks.length}
        </span>
        <button type="button" className="pw-textlink" onClick={onShowAll}>
          全タスクを見る
        </button>
      </div>
    </header>
  );
};

const TaskBody = ({
  project,
  view,
  task,
  reviewing,
  busy,
  error,
  onRun,
  onView,
  onSaved,
  onCloseReview,
}: {
  project: Project;
  view: PublishingView;
  task: WorkflowTask;
  reviewing: boolean;
  busy: boolean;
  error: string | null;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onView: (view: PublishingView) => void;
  onSaved: (result: { project: Project; view: PublishingView }) => void;
  onCloseReview: () => void;
}) => {
  const index = view.tasks.findIndex((item) => item.id === task.id) + 1;
  const publishPresets = view.tasks
    .filter((item) => isPublishTask(item.type) && item.status !== 'skipped')
    .map((item) => presetOf(item.preset))
    .filter((preset): preset is DeliveryPresetId => Boolean(preset));
  const [qaPreset, setQaPreset] = useState<DeliveryPresetId | undefined>(publishPresets[0]);
  const asidePreset = task.type === 'post-publish-verify' ? qaPreset : presetOf(task.preset);
  return (
    <>
      <section className="pw-task">
        <header>
          <div>
            <span className="gd-kicker">
              {reviewing ? '振り返り' : '次にやること'} · {index} / {view.tasks.length}
            </span>
            <h1>{taskTitle(task)}</h1>
            <p>{taskBlurb(task)}</p>
          </div>
          {task.platform && (
            <a className="pw-open" href={PUBLISH_PAGES[task.platform].href} target="_blank" rel="noreferrer">
              {PUBLISH_PAGES[task.platform].label}
              <ExternalIcon />
            </a>
          )}
          {task.type === 'post-publish-verify' && qaPreset && (
            <QaOpen project={project} preset={qaPreset} />
          )}
        </header>
        {reviewing && (
          <p className="pw-review">
            <span>
              {task.status === 'skipped'
                ? `スキップしました${task.skippedReason ? `（${task.skippedReason}）` : ''}`
                : task.status === 'done'
                  ? 'このタスクは完了しています'
                  : '今の作業ではありません'}
              {task.type === 'x-publish' ? '。投稿文の確認とコピーはできます' : ''}
            </span>
            <button type="button" className="pw-textlink" onClick={onCloseReview}>
              {view.current ? '今のタスクに戻る' : '完了画面に戻る'}
            </button>
          </p>
        )}
        {task.type === 'x-publish' && <XPostComposer project={project} />}
        {task.type === 'youtube-publication-verify' && (
          <YoutubePublishPanel
            project={project}
            taskId={view.tasks.find((item) => item.type === 'youtube-publish' && item.preset === task.preset)?.id ?? task.id}
            preset={presetOf(task.preset) ?? 'yt-global'}
            reviewing={reviewing}
            onView={onView}
          />
        )}
        {task.type === 'pre-publish-check' && (
          <Precheck project={project} view={view} task={task} reviewing={reviewing} busy={busy} onRun={onRun} onView={onView} />
        )}
        {isPublishTask(task.type) && (
          <PublishTask
            project={project}
            view={view}
            task={task}
            reviewing={reviewing}
            busy={busy}
            onRun={onRun}
            onView={onView}
            onSaved={onSaved}
          />
        )}
        {task.type === 'post-publish-verify' && (
          <Verify
            project={project}
            view={view}
            task={task}
            reviewing={reviewing}
            presets={publishPresets}
            tab={qaPreset ?? publishPresets[0]}
            busy={busy}
            onTab={setQaPreset}
            onRun={onRun}
            onView={onView}
            onSaved={onSaved}
          />
        )}
        {task.type === 'record-complete' && (
          <RecordDone
            project={project}
            view={view}
            task={task}
            reviewing={reviewing}
            busy={busy}
            onRun={onRun}
            onSaved={onSaved}
          />
        )}
        {error && <p className="pw-error">{error}</p>}
      </section>
      {task.type === 'record-complete' ? (
        <RecordAside project={project} />
      ) : asidePreset && task.type !== 'pre-publish-check' ? (
        <Materials project={project} view={view} preset={asidePreset} />
      ) : (
        <FileAside project={project} view={view} />
      )}
    </>
  );
};

const Precheck = ({
  project,
  view,
  task,
  reviewing,
  busy,
  onRun,
  onView,
}: {
  project: Project;
  view: PublishingView;
  task: WorkflowTask;
  reviewing: boolean;
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onView: (view: PublishingView) => void;
}) => {
  const manual = task.checklistItems.find((item) => item.key === 'conditions-match');
  const ready = manualPrecheckReady(task, view.autoChecks);
  const checksOk = view.autoChecks.every((check) => check.ok || check.severity === 'warn');
  const next = view.tasks.find((item) => item.sortOrder > task.sortOrder);
  const hint = checksOk ? '最後の1つを目で確認してください' : '自動の確認が済んでから進めます';
  return (
    <div className="pw-checks">
      {view.autoChecks.map((check) => (
        <div key={check.key} className={`pw-auto ${check.ok ? 'is-ok' : check.severity === 'warn' ? 'is-warn' : 'is-bad'}`}>
          <span className="pw-dot">{check.ok ? '✓' : '!'}</span>
          <span className="pw-copyline">
            <strong>{check.label}</strong>
            <span>{check.detail}</span>
          </span>
          <em>自動</em>
        </div>
      ))}
      {manual && (
        <button
          type="button"
          className={`pw-check ${manual.checked ? 'is-on' : 'is-focus'}`}
          role="checkbox"
          aria-checked={manual.checked}
          disabled={reviewing}
          onClick={() =>
            void onRun(async () =>
              onView(
                await window.studio.patchPublishing(project.id, task.id, {
                  checklist: [{ id: manual.id, checked: !manual.checked }],
                }),
              ),
            )
          }
        >
          <span className="pw-box">{manual.checked ? '✓' : ''}</span>
          <span className="pw-copyline">
            <strong>{manual.label}</strong>
            <span>
              {publishingPresets(project).map((preset) => DELIVERY_PRESETS[preset].label).join(' · ')}
              {project.experimentRef ? ` · ${project.experimentRef.arm === 'control' ? 'Control' : 'Variant'}` : ' · 実験なし'}
            </span>
          </span>
          <em>目で確認</em>
        </button>
      )}
      {!reviewing && (
        <>
          <div className="pw-grow" />
          <div className="pw-actions">
            <button
              type="button"
              className="pw-primary"
              disabled={!ready || busy}
              onClick={() =>
                void onRun(async () => {
                  const result = await window.studio.completePublishing(project.id, task.id, {
                    checklist: task.checklistItems.filter((item) => !item.auto).map((item) => ({ id: item.id, checked: item.checked })),
                  });
                  onView(result.view);
                })
              }
            >
              確認して次へ{next ? `：${nextCue(next)}` : ''}
            </button>
            {!ready && <span className="gd-muted">{hint}</span>}
          </div>
        </>
      )}
    </div>
  );
};

const PublishTask = ({
  project,
  view,
  task,
  reviewing,
  busy,
  onRun,
  onView,
  onSaved,
}: {
  project: Project;
  view: PublishingView;
  task: WorkflowTask;
  reviewing: boolean;
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onView: (view: PublishingView) => void;
  onSaved: (result: { project: Project; view: PublishingView }) => void;
}) => {
  const [url, setUrl] = useState(task.urlDraft ?? '');
  const [postedAt, setPostedAt] = useState(toDateTimeLocal(task.postedAtDraft || project.plannedPostDate));
  const [showShould, setShowShould] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    const drafted = task.urlDraft;
    const candidate =
      project.publishing.xPost.videoUrlEdited && task.platform && task.platform !== 'x' && project.guide.xReplyVideo === task.platform
        ? project.publishing.xPost.videoUrl.trim()
        : '';
    const reusable =
      candidate && task.platform && checkPostUrl(task.platform, candidate).status !== 'error' ? candidate : '';
    setUrl(drafted !== undefined ? drafted : reusable);
    setPostedAt(toDateTimeLocal(task.postedAtDraft || project.plannedPostDate));
    // 動画URLの入力では、いま編集中の投稿URLを消さない。タスクを開いたときだけ初期値にする。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.urlDraft, task.postedAtDraft, project.plannedPostDate]);
  const preset = presetOf(task.preset);
  const verdict = task.platform
    ? checkPostUrl(task.platform, url, {
        accounts: view.settings.accounts,
        taken: view.taken,
        ignore: preset ? { projectId: project.id, preset } : undefined,
      })
    : { status: 'empty' as const, message: '' };
  const required = task.checklistItems.filter((item) => item.required);
  const optional = task.checklistItems.filter((item) => !item.required);
  const doneRequired = required.filter((item) => item.checked).length;
  const blocker = canCompletePublish(task, verdict);
  const toggle = (id: string, checked: boolean): void => {
    void onRun(async () =>
      onView(
        await window.studio.patchPublishing(project.id, task.id, {
          checklist: [{ id, checked }],
          url,
          postedAt: fromDateTimeLocal(postedAt),
        }),
      ),
    );
  };
  return (
    <div className={`pw-publish${task.type === 'x-publish' ? ' is-x' : ''}`}>
      <div className="pw-col">
        {task.type === 'youtube-publish' && preset && (
          <YoutubePublishPanel
            project={project}
            taskId={task.id}
            preset={preset}
            reviewing={reviewing}
            onView={onView}
          />
        )}
        <div className="pw-meter">
          <strong>必須</strong>
          <span className="gd-mono">
            {doneRequired} / {required.length}
          </span>
          <span className="pw-meter-track">
            <span style={{ width: `${required.length ? (doneRequired / required.length) * 100 : 0}%` }} />
          </span>
        </div>
        {required.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`pw-check ${item.checked ? 'is-on' : ''}`}
            role="checkbox"
            aria-checked={item.checked}
            disabled={reviewing}
            onClick={() => toggle(item.id, !item.checked)}
          >
            <span className="pw-box">{item.checked ? '✓' : ''}</span>
            <span className="pw-copyline">
              <strong>{item.label}</strong>
              {item.hint && <span>{item.hint}</span>}
            </span>
          </button>
        ))}
        {optional.length > 0 && (
          <button type="button" className="pw-fold" aria-expanded={showShould} onClick={() => setShowShould((open) => !open)}>
            <span>{showShould ? '▾' : '▸'}</span>
            できればやる（{optional.filter((item) => item.checked).length} / {optional.length}）
            <span className="gd-muted">未完了でも完了できます</span>
          </button>
        )}
        {showShould &&
          optional.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`pw-check is-optional ${item.checked ? 'is-on' : ''}`}
              role="checkbox"
              aria-checked={item.checked}
              disabled={reviewing}
              onClick={() => toggle(item.id, !item.checked)}
            >
              <span className="pw-box">{item.checked ? '✓' : ''}</span>
              <span className="pw-copyline">
                <strong>{item.label}</strong>
              </span>
            </button>
          ))}
      </div>
      <div className="pw-record">
        <div className="pw-record-card">
          <label>
            投稿URL
            <input
              className={`pw-url is-${verdict.status}`}
              value={url}
              readOnly={reviewing}
              placeholder={task.platform === 'youtube' ? 'https://youtube.com/shorts/…' : task.platform === 'tiktok' ? 'https://tiktok.com/@…/video/…' : 'https://x.com/…/status/…'}
              onChange={(event) => setUrl(event.target.value)}
              onBlur={() => {
                if (reviewing) return;
                void onRun(async () =>
                  onView(await window.studio.patchPublishing(project.id, task.id, { url, postedAt: fromDateTimeLocal(postedAt) })),
                );
              }}
            />
            <span className={`pw-url-note is-${verdict.status}`}>{verdict.message}</span>
          </label>
          {!reviewing && verdict.suggestion && (
            <button type="button" className="pw-textlink" onClick={() => setUrl(verdict.suggestion?.url ?? url)}>
              {verdict.suggestion.label}
            </button>
          )}
          <label>
            投稿日時
            <span className="pw-when">
              <input type="datetime-local" value={postedAt} readOnly={reviewing} onChange={(event) => setPostedAt(event.target.value)} />
              <button
                type="button"
                className="pw-now"
                disabled={reviewing}
                onClick={() => setPostedAt(toDateTimeLocal(new Date().toISOString()))}
              >
                いまにする
              </button>
            </span>
          </label>
          {!reviewing && <span className="gd-muted">保存すると投稿記録とPostに入り、7日後の振り返りが予約されます</span>}
        </div>
        {!reviewing && <div className="pw-grow" />}
        {!reviewing && (
        <div className="pw-finish">
          <button
            type="button"
            className="pw-primary"
            disabled={Boolean(blocker) || busy}
            onClick={() =>
              void onRun(async () =>
                onSaved(
                  await window.studio.completePublishing(project.id, task.id, {
                    checklist: task.checklistItems.map((item) => ({ id: item.id, checked: item.checked })),
                    url,
                    postedAt: fromDateTimeLocal(postedAt),
                  }),
                ),
              )
            }
          >
            このタスクを完了
          </button>
          {blocker && <span className="gd-muted">{blocker}</span>}
          {!skipping ? (
            <button type="button" className="pw-link" onClick={() => setSkipping(true)}>
              今回は{taskShortLabel(task)}に投稿しない（スキップ）
            </button>
          ) : (
            <label>
              スキップ理由（任意）
              <input value={reason} onChange={(event) => setReason(event.target.value)} />
              <button
                type="button"
                className="pw-ghost"
                disabled={busy}
                onClick={() =>
                  void onRun(async () => onSaved(await window.studio.skipPublishing(project.id, task.id, reason)))
                }
              >
                スキップする
              </button>
            </label>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

const Verify = ({
  project,
  view,
  task,
  reviewing,
  presets,
  tab,
  busy,
  onTab,
  onRun,
  onView,
  onSaved,
}: {
  project: Project;
  view: PublishingView;
  task: WorkflowTask;
  reviewing: boolean;
  presets: DeliveryPresetId[];
  tab: DeliveryPresetId;
  busy: boolean;
  onTab: (preset: DeliveryPresetId) => void;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onView: (view: PublishingView) => void;
  onSaved: (result: { project: Project; view: PublishingView }) => void;
}) => {
  const qa = task.qa ?? {};
  const platform = DELIVERY_PRESETS[tab].platform;
  const items = QA_ITEMS[platform];
  const marks = qa[tab] ?? {};
  const setMark = (key: string, value: 'ok' | 'problem'): void => {
    const next = { ...qa, [tab]: { ...marks, [key]: value } };
    void onRun(async () => onView(await window.studio.patchPublishing(project.id, task.id, { qa: next })));
  };
  const publishTask = view.tasks.find((item) => item.preset === tab && isPublishTask(item.type));
  const problems = items.some((item) => marks[item.key] === 'problem');
  const ready = qaReady({ ...task, qa }, presets, view.workflow?.skipQaPresets);
  const next = view.tasks.find((item) => item.sortOrder > task.sortOrder);
  const left = presets.reduce((sum, preset) => {
    const entries = QA_ITEMS[DELIVERY_PRESETS[preset].platform];
    const answered = qa[preset] ?? {};
    return sum + entries.filter((item) => answered[item.key] !== 'ok').length;
  }, 0);
  return (
    <div className="pw-qa">
      <div role="tablist" aria-label="媒体" className="pw-tabs">
        {presets.map((preset) => {
          const count = QA_ITEMS[DELIVERY_PRESETS[preset].platform];
          const answered = count.filter((item) => (qa[preset] ?? {})[item.key] === 'ok').length;
          const full = answered === count.length;
          return (
            <button key={preset} type="button" role="tab" aria-selected={preset === tab} onClick={() => onTab(preset)}>
              {platformName(DELIVERY_PRESETS[preset].platform)}
              <span className={full ? 'pw-pill is-full' : 'pw-pill'}>
                {answered} / {count.length}
              </span>
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div key={item.key} className={marks[item.key] === 'ok' ? 'pw-qa-row is-ok' : 'pw-qa-row'}>
          <span className="pw-copyline">
            <strong>{item.label}</strong>
            {item.hint && <span>{item.hint}</span>}
          </span>
          <span className="pw-qa-actions" role="group" aria-label={item.label}>
            <button type="button" aria-pressed={marks[item.key] === 'ok'} disabled={reviewing} onClick={() => setMark(item.key, 'ok')}>
              ✓ 問題なし
            </button>
            <button type="button" className="is-problem" aria-pressed={marks[item.key] === 'problem'} disabled={reviewing} onClick={() => setMark(item.key, 'problem')}>
              問題あり
            </button>
          </span>
        </div>
      ))}
      {!reviewing && problems && publishTask && (
        <button
          type="button"
          className="pw-fix"
          disabled={busy}
          onClick={() =>
            void onRun(async () => onSaved(await window.studio.needsFixPublishing(project.id, publishTask.id)))
          }
        >
          {platformName(platform)}を要修正に戻す
        </button>
      )}
      {!reviewing && (
        <>
          <div className="pw-grow" />
          <div className="pw-actions">
            <button
              type="button"
              className="pw-primary"
              disabled={!ready || busy}
              onClick={() =>
                void onRun(async () => onSaved(await window.studio.completePublishing(project.id, task.id, { qa })))
              }
            >
              QAを完了して次へ{next ? `：${nextCue(next)}` : ''}
            </button>
            {!ready && <span className="gd-muted">あと {left} 項目</span>}
          </div>
        </>
      )}
    </div>
  );
};

const QaOpen = ({ project, preset }: { project: Project; preset: DeliveryPresetId }) => {
  const post = project.posts.find((item) => item.preset === preset && item.url.trim());
  if (!post) return null;
  return (
    <a className="pw-open" href={post.url} target="_blank" rel="noreferrer">
      {platformName(DELIVERY_PRESETS[preset].platform)} で開く
      <ExternalIcon />
    </a>
  );
};

const RecordDone = ({
  project,
  view,
  task,
  reviewing,
  busy,
  onRun,
  onSaved,
}: {
  project: Project;
  view: PublishingView;
  task: WorkflowTask;
  reviewing: boolean;
  busy: boolean;
  onRun: (action: () => Promise<void>) => Promise<void>;
  onSaved: (result: { project: Project; view: PublishingView }) => void;
}) => {
  const ready = view.recordChecks.every((check) => check.ok || check.key === 'review');
  return (
    <div className="pw-checks">
      {view.recordChecks.map((check) => (
        <div key={check.key} className={`pw-auto ${check.ok ? 'is-ok' : 'is-bad'}`}>
          <span className="pw-dot">{check.ok ? '✓' : '!'}</span>
          <span className="pw-copyline">
            <strong>{check.label}</strong>
            <span>{check.detail}</span>
          </span>
        </div>
      ))}
      {!reviewing && (
        <>
          <div className="pw-grow" />
          <div className="pw-actions">
            <button
              type="button"
              className="pw-primary"
              disabled={!ready || busy}
              onClick={() =>
                void onRun(async () => onSaved(await window.studio.completePublishing(project.id, task.id, {})))
              }
            >
              記録を完了する
            </button>
            <span className="gd-muted">プロジェクトは「投稿済み」になります</span>
          </div>
        </>
      )}
    </div>
  );
};

const Materials = ({ project, view, preset }: { project: Project; view: PublishingView; preset: DeliveryPresetId }) => {
  const language = copyLanguage(preset);
  const spec = DELIVERY_PRESETS[preset];
  const languages = spec.copyLanguages;
  const files = view.files.filter((file) => file.preset === preset && file.kind !== 'copy');
  const poster = files.find((file) => file.kind === 'thumbnail' || file.kind === 'xCard') ?? files[0];
  const link = trackingFor(project, preset, guessBasename(project, preset), language);
  const seconds = activeTimeline(project).durationSec;
  return (
    <aside className="pw-side" aria-label="投稿に使うもの">
      <div className="pw-side-top">
        <span className="pw-side-kicker">投稿に使うもの</span>
        <span className="pw-chip is-id">{preset}</span>
        <span className="pw-chip">{languageName(language)}</span>
      </div>
      <div className="pw-preview">
        <div className={spec.platform === 'x' ? 'pw-poster is-card' : 'pw-poster'}>
          {poster && <img src={mediaUrl(poster.relativePath)} alt="" />}
          <span className="pw-poster-lang">{language === 'en' ? 'EN' : language === 'ko' ? 'KO' : 'JA'}</span>
          <span className="pw-poster-meta">{spec.platform === 'x' ? '4:5' : `9:16 · ${seconds.toFixed(1)}秒`}</span>
        </div>
        <div className="pw-preview-files">
          {files.map((file) => (
            <div key={file.relativePath} className="pw-file">
              <span className="gd-mono">{file.name}</span>
              <button type="button" className="pw-mini" onClick={() => void window.studio.revealPath(file.relativePath)}>
                表示
              </button>
            </div>
          ))}
          <span className="pw-hint">「表示」はフォルダでファイルを選んだ状態で開きます。ドラッグして投稿画面へ</span>
        </div>
      </div>
      {spec.platform === 'x' ? (
        <p className="xpost-side-note">投稿文は左の欄で確認してコピーします。添付するカードは上の画像です。</p>
      ) : (
        <>
          {languages.map((copyLanguageId) => {
            const copyLink = trackingFor(project, preset, guessBasename(project, preset), copyLanguageId);
            const description = replaceClutchVaultUrl(project.publishing.description[copyLanguageId] ?? '', copyLink);
            const title = project.publishing.title[copyLanguageId] ?? '';
            const hashtags = project.publishing.hashtags[copyLanguageId] ?? '';
            return (
              <div key={copyLanguageId} className="pw-lang-copy">
                {languages.length > 1 && <span className="pw-chip">{languageName(copyLanguageId)}</span>}
                <CopyBlock
                  label={spec.platform === 'tiktok' ? 'キャプション' : 'タイトル'}
                  text={title}
                  meta={`${title.length} / ${spec.platform === 'tiktok' ? 2200 : 100}`}
                />
                <CopyBlock label="説明文" text={description} meta={languageName(copyLanguageId)} />
                <CopyBlock label="ハッシュタグ" text={hashtags} />
              </div>
            );
          })}
          {spec.platform === 'youtube' && project.publishing.pinnedComment.trim() && (
            <CopyBlock label="固定コメント" text={project.publishing.pinnedComment} meta="英語・自分で固定" />
          )}
          <CopyBlock label="ClutchVault URL" text={link} meta={spec.platform === 'tiktok' ? 'プロフィール用' : 'UTM付き'} mono />
        </>
      )}
    </aside>
  );
};

const FileAside = ({ project, view }: { project: Project; view: PublishingView }) => (
  <aside className="pw-side" aria-label="書き出したもの">
    <span className="pw-side-kicker">書き出したもの</span>
    {publishingPresets(project).map((preset) => (
      <section key={preset} className="pw-bundle">
        <div className="pw-bundle-top">
          <strong>{platformName(DELIVERY_PRESETS[preset].platform)}</strong>
          <span className="pw-chip is-id">{preset}</span>
          <span className="pw-chip">{languageName(copyLanguage(preset))}</span>
        </div>
        {view.files
          .filter((file) => file.preset === preset)
          .map((file) => (
            <span key={file.relativePath} className="gd-mono">
              {file.name}
            </span>
          ))}
      </section>
    ))}
    <button type="button" className="pw-ghost" onClick={() => void window.studio.openPath(project.guide.lastExport?.outputDir ?? 'exports')}>
      書き出しフォルダを開く
    </button>
  </aside>
);

const RecordAside = ({ project }: { project: Project }) => (
  <aside className="pw-side" aria-label="記録した投稿">
    <span className="pw-side-kicker">記録した投稿（Post）</span>
    {publishingPresets(project).map((preset) => {
      const post = project.posts.find((item) => item.preset === preset);
      const arm = project.experimentRef ? (project.experimentRef.arm === 'control' ? 'Control' : 'Variant') : '';
      return (
        <section key={preset} className="pw-bundle pw-post">
          <div className="pw-post-top">
            <strong>{platformName(DELIVERY_PRESETS[preset].platform)}</strong>
            <span className="pw-chip">{languageName(copyLanguage(preset))}</span>
            <span className="gd-mono">{post ? clock(post.postedAt) : '—'}</span>
          </div>
          <span className="gd-mono">{post?.url ? shortUrl(post.url) : '未記録'}</span>
          <span className="gd-muted">
            utm_content {guessBasename(project, preset)}
            {arm ? ` · ${arm}` : ''}
          </span>
        </section>
      );
    })}
  </aside>
);

const CopyBlock = ({ label, text, meta, mono }: { label: string; text: string; meta?: string; mono?: boolean }) => (
  <section className="pw-copy">
    <div>
      <strong>{label}</strong>
      {meta && <span className="gd-muted">{meta}</span>}
      <button
        type="button"
        className="pw-mini is-strong"
        aria-label={`${label}をコピー`}
        onClick={() => void navigator.clipboard.writeText(text)}
        disabled={!text.trim()}
      >
        コピー
      </button>
    </div>
    <p className={mono ? 'gd-mono' : undefined}>{text || '（空）'}</p>
  </section>
);

const listName = (task: WorkflowTask): string => {
  if (task.type === 'youtube-publish') return 'YouTube に投稿';
  if (task.type === 'tiktok-publish') return 'TikTok に投稿';
  if (task.type === 'x-publish') return 'X に投稿';
  return taskTitle(task);
};

const listMemo = (task: WorkflowTask, project: Project, autoCount: number): string => {
  if (task.warningNote) return task.warningNote;
  if (task.skippedReason) return task.skippedReason;
  if (task.type === 'pre-publish-check') return `自動判定${autoCount}件 · 目で確認1件`;
  const post = project.posts.find((item) => item.preset === task.preset && item.url.trim());
  if (post) return shortUrl(post.url);
  if (task.urlDraft) return shortUrl(task.urlDraft);
  return '';
};

const previousLabel = (task: WorkflowTask, tasks: WorkflowTask[]): string => {
  if (task.type === 'pre-publish-check') return '書き出し';
  if (task.type === 'post-publish-verify') {
    return tasks
      .filter((item) => isPublishTask(item.type))
      .map((item) => String(tasks.findIndex((entry) => entry.id === item.id) + 1))
      .join('・');
  }
  const index = tasks.findIndex((item) => item.id === task.id);
  return index > 0 ? String(index) : '—';
};

const AllTasks = ({
  project,
  view,
  onOpen,
  onBack,
}: {
  project: Project;
  view: PublishingView;
  onOpen: (id: string) => void;
  onBack: () => void;
}) => {
  const postedAt = project.posts.map((post) => post.postedAt).filter(Boolean).sort()[0];
  const due = postedAt ? dayLabel(dueAtFor7d(postedAt)) : '';
  return (
    <section className="pw-task pw-all">
      <header>
        <div>
          <button type="button" className="pw-textlink" onClick={onBack}>
            {view.current ? '← 今のタスクへ戻る' : '← 完了画面に戻る'}
          </button>
          <h1>全タスク</h1>
          <p>行を選ぶと、そのタスクの画面を表示します。完了やスキップのあとでも開けます。</p>
        </div>
      </header>
      <div className="pw-table">
        <div className="pw-row is-head">
          <span>#</span>
          <span>タスク</span>
          <span>状態</span>
          <span>メモ</span>
          <span>前のタスク</span>
          <span>完了</span>
        </div>
        {view.tasks.map((task, index) => {
          const tone =
            task.status === 'done'
              ? 'is-ok'
              : task.status === 'needs-fix'
                ? 'is-fix'
                : task.id === view.current?.id
                  ? 'is-now'
                  : '';
          const label =
            task.status === 'done'
              ? '完了'
              : task.status === 'skipped'
                ? 'スキップ'
                : task.status === 'needs-fix'
                  ? '要修正'
                  : task.id === view.current?.id
                    ? '今ここ'
                    : '待ち';
          return (
            <button
              key={task.id}
              type="button"
              className={task.status === 'needs-fix' ? 'pw-row is-fix' : 'pw-row'}
              onClick={() => onOpen(task.id)}
            >
              <span className="gd-mono">{index + 1}</span>
              <strong>{listName(task)}</strong>
              <span>
                <span className={tone ? `pw-badge ${tone}` : 'pw-badge'}>{label}</span>
              </span>
              <span className="pw-memo">{listMemo(task, project, view.autoChecks.length)}</span>
              <span className="gd-muted">{previousLabel(task, view.tasks)}</span>
              <span className="gd-mono">{task.completedAt ? clock(task.completedAt) : '—'}</span>
            </button>
          );
        })}
      </div>
      <section className="pw-later">
        <span>このあと（分析）</span>
        <div className="pw-later-grid">
          <div>
            <strong>
              24時間の確認 <em>{view.settings.enable24hCheck ? '有効' : '任意 · 設定でオフ'}</em>
            </strong>
            <span>
              {view.settings.enable24hCheck && postedAt
                ? `${dayLabel(plusDay(postedAt))} に「振り返る」へ入ります`
                : '有効にすると、投稿の翌日に「振り返る」へ入ります'}
            </span>
          </div>
          <div>
            <strong>
              7日後の振り返り <em className={due ? 'is-booked' : undefined}>{due ? '予約済み' : '未予約'}</em>
            </strong>
            <span>
              {due
                ? `${due} · 投稿${project.posts.filter((post) => post.url.trim()).length}件`
                : '最初の投稿を記録すると予約されます'}
            </span>
          </div>
        </div>
      </section>
    </section>
  );
};

const PostLog = ({
  project,
  view,
  busy,
  onSaved,
}: {
  project: Project;
  view: PublishingView;
  busy: boolean;
  onSaved: (result: { project: Project; view: PublishingView }) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  return (
    <section className="pw-log">
      <button type="button" className="pw-fold" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{open ? '▾' : '▸'}</span>
        投稿記録の表（詳細）
      </button>
      {open && (
        <div className="pw-log-table">
          {publishingPresets(project).map((preset) => {
            const post = project.posts.find((item) => item.preset === preset);
            const value = drafts[preset] ?? post?.url ?? '';
            return (
              <label key={preset}>
                {DELIVERY_PRESETS[preset].label}
                <input
                  value={value}
                  placeholder="https://"
                  onChange={(event) => setDrafts((current) => ({ ...current, [preset]: event.target.value }))}
                  onBlur={() => {
                    if (!value.trim() || value === (post?.url ?? '')) return;
                    setNote(null);
                    void window.studio
                      .recordPublishingUrl(project.id, preset, value, post?.postedAt)
                      .then(onSaved)
                      .catch((reason: unknown) => setNote(reason instanceof Error ? reason.message : String(reason)));
                  }}
                  disabled={busy}
                />
              </label>
            );
          })}
          {note && <p className="pw-error">{note}</p>}
        </div>
      )}
    </section>
  );
};
