import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeliveryPresetId } from '../../shared/delivery-presets';
import {
  LONG_FILE_LABEL,
  LONG_LANGUAGE_NAME,
  LONG_QA_ITEMS,
  longDoneCount,
  longLanguageOf,
  longStatusForWorkflow,
  longTaskBlurb,
  longTaskTitle,
  type LongPublishingView,
} from '../../shared/long/publishing';
import type { LongPublishingTaskBody } from '../../shared/long/ipc';
import { checkYoutubeVideoUrl } from '../../shared/post-url';
import { PUBLISH_PAGES, type AutoCheck, type WorkflowTask } from '../../shared/publishing';
import { YoutubePublishPanel } from '../guide/YoutubePublishPanel';
import { saveLongNow, useLongStore } from './store';
import { errorText } from './util';

const STATUS_MARK: Record<WorkflowTask['status'], string> = {
  pending: '・',
  ready: '▶',
  'in-progress': '▶',
  done: '✓',
  skipped: '－',
  'needs-fix': '!',
};

const toLocalInput = (iso: string | undefined): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 投稿の状態が変わったことを、右パネルの「投稿」タブなどへ知らせる */
export const LONG_PUBLISHING_EVENT = 'cvcs:long-publishing';

const copyText = async (text: string): Promise<void> => {
  await navigator.clipboard.writeText(text);
  useLongStore.getState().setMessage('コピーしました');
};

const Checks = ({ checks }: { checks: AutoCheck[] }) => (
  <div className="lv-pub-checks">
    {checks.map((check) => (
      <div key={check.key} className={`diag ${check.ok ? 'info' : check.severity === 'warn' ? 'warning' : 'error'}`}>
        {check.ok ? '✓' : check.severity === 'warn' ? '⚠' : '✕'}
        <div style={{ flex: 1 }}>
          <b>{check.label}</b>
          <div style={{ opacity: 0.85 }}>{check.detail}</div>
        </div>
      </div>
    ))}
  </div>
);

/**
 * 横動画の投稿運用（YouTube 通常動画）。
 * 投稿前確認 → 言語ごとの投稿（アプリから送る／手動で投稿して URL を記録） → 公開確認 → 公開後QA → 記録完了。
 * YouTube に接続していなくても、書き出したMP4と投稿文で手動投稿して進められる。
 */
export const LongPublishDialog = ({ onClose }: { onClose: () => void }) => {
  const project = useLongStore((state) => state.project)!;
  const [view, setView] = useState<LongPublishingView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState('');
  const [skipping, setSkipping] = useState(false);
  const [showApi, setShowApi] = useState(false);

  const apply = useCallback((next: LongPublishingView) => {
    setView(next);
    window.dispatchEvent(new Event(LONG_PUBLISHING_EVENT));
    // ワークフローの完了・やり直しを Project の状態にも反映する（Project ファイルは画面側で保存する）
    const current = useLongStore.getState().project;
    if (current && next.workflow) {
      const status = longStatusForWorkflow(current, next);
      if (status !== current.status) useLongStore.getState().transact('投稿の状態', (draft) => ({ ...draft, status }));
    }
  }, []);

  // 投稿の判定はディスク上の Project を読むため、先に画面の変更（書き出しの記録など）を保存する
  const refresh = useCallback(async (): Promise<void> => {
    await saveLongNow();
    apply(await window.studio.long.publishing.get(project.id));
  }, [apply, project.id]);

  useEffect(() => {
    void refresh().catch((reason) => setError(errorText(reason)));
  }, [refresh]);

  const run = async (task: () => Promise<LongPublishingView>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await saveLongNow();
      apply(await task());
    } catch (reason) {
      setError(errorText(reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  const tasks = useMemo(() => [...(view?.tasks ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [view]);
  const task = tasks.find((item) => item.id === (selected ?? view?.current?.id)) ?? view?.current ?? tasks[0];

  if (!view) {
    return (
      <div className="lv-backdrop">
        <div className="lv-dialog" style={{ width: 640 }}>
          <div className="db">{error ?? '読み込んでいます…'}</div>
          <div className="df">
            <button type="button" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
      </div>
    );
  }

  const patch = (body: LongPublishingTaskBody): void => {
    if (!task) return;
    // 押したらすぐ表示に反映し、保存は裏で行う（保存の結果で置き換わる）
    const checks = new Map((body.checklist ?? []).map((entry) => [entry.id, entry.checked]));
    setView((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    qa: body.qa ?? item.qa,
                    checklistItems: item.checklistItems.map((entry) => (checks.has(entry.id) ? { ...entry, checked: checks.get(entry.id)! } : entry)),
                  }
                : item,
            ),
          }
        : current,
    );
    void run(() => window.studio.long.publishing.patch(project.id, task.id, body));
  };
  const complete = (body: LongPublishingTaskBody = {}): void => {
    if (!task) return;
    void run(() => window.studio.long.publishing.complete(project.id, task.id, body));
  };
  const language = longLanguageOf(task?.preset);
  const publishTasks = tasks.filter((item) => item.type === 'youtube-publish');
  const youtubeTaskFor = (preset?: string): WorkflowTask | undefined => publishTasks.find((item) => item.preset === preset);

  const manualChecklist = (item: WorkflowTask) =>
    item.checklistItems
      .filter((entry) => !entry.auto)
      .map((entry) => (
        <label key={entry.id} className="lv-pub-check">
          <input
            type="checkbox"
            checked={entry.checked}
            disabled={busy || item.status === 'done' || item.status === 'skipped'}
            onChange={(event) => patch({ checklist: [{ id: entry.id, checked: event.target.checked }] })}
          />
          <span>
            {entry.label}
            {entry.required ? '' : <span className="dim">（任意）</span>}
            {entry.hint ? <span className="dim"> — {entry.hint}</span> : null}
          </span>
        </label>
      ));

  const body = (): React.ReactNode => {
    if (!task) return <p className="muted">タスクがありません。</p>;
    const settled = task.status === 'done' || task.status === 'skipped';
    if (task.type === 'pre-publish-check') {
      return (
        <>
          <Checks checks={view.autoChecks} />
          <div style={{ marginTop: 8 }}>{manualChecklist(task)}</div>
          {!settled ? (
            <button type="button" className="pri" disabled={busy} onClick={() => complete()}>
              確認できた
            </button>
          ) : null}
        </>
      );
    }
    if (task.type === 'youtube-publish' && language) {
      return <PublishTask key={task.id} task={task} view={view} busy={busy} run={run} patch={patch} complete={complete} checklist={manualChecklist(task)} showApi={showApi} setShowApi={setShowApi} refresh={refresh} />;
    }
    if (task.type === 'youtube-publication-verify') {
      const youtube = youtubeTaskFor(task.preset);
      return (
        <>
          <p>
            予定時刻：<b>{task.dueAt ? new Date(task.dueAt).toLocaleString('ja-JP') : '—'}</b>
          </p>
          <p className="muted">予定時刻を過ぎたら、YouTube の状態を再取得して公開を確かめます。手動で確かめた場合は「公開を確認した」を押します。</p>
          {youtube ? <YoutubePublishPanel project={{ id: project.id }} taskId={youtube.id} preset={youtube.preset as DeliveryPresetId} reviewing={false} refresh={refresh} /> : null}
          {!settled ? (
            <button type="button" className="pri" disabled={busy} style={{ marginTop: 8 }} onClick={() => complete()}>
              公開を確認した
            </button>
          ) : null}
        </>
      );
    }
    if (task.type === 'post-publish-verify') {
      const targets = publishTasks.filter((item) => item.status !== 'skipped' && !view.workflow?.skipQaPresets.includes(item.preset ?? ''));
      const qa = task.qa ?? {};
      const mark = (preset: string, key: string, value: 'ok' | 'problem'): void =>
        patch({ qa: { ...qa, [preset]: { ...(qa[preset] ?? {}), [key]: value } } });
      return (
        <>
          {targets.length === 0 ? <p className="muted">確認する投稿がありません（スキップ、または非公開で保管）。</p> : null}
          {targets.map((item) => {
            const post = view.posts.find((entry) => entry.preset === item.preset);
            const name = LONG_LANGUAGE_NAME[longLanguageOf(item.preset) ?? 'ja'];
            return (
              <div key={item.id} className="card" style={{ padding: 8, marginBottom: 8 }}>
                <div className="row">
                  <b>{name}</b>
                  {post?.url ? (
                    <a href={post.url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11 }}>
                      {post.url}
                    </a>
                  ) : null}
                  <span className="sp" />
                  <button type="button" className="sm ghost" disabled={busy || settled} onClick={() => void run(() => window.studio.long.publishing.needsFix(project.id, item.id))}>
                    投稿をやり直す
                  </button>
                </div>
                {LONG_QA_ITEMS.map((entry) => (
                  <div key={entry.key} className="lv-pub-qa">
                    <span>
                      {entry.label}
                      {entry.hint ? <span className="dim"> — {entry.hint}</span> : null}
                    </span>
                    <span className="seg">
                      <button type="button" disabled={busy || settled} aria-pressed={qa[item.preset ?? '']?.[entry.key] === 'ok'} onClick={() => mark(item.preset ?? '', entry.key, 'ok')}>
                        OK
                      </button>
                      <button type="button" disabled={busy || settled} aria-pressed={qa[item.preset ?? '']?.[entry.key] === 'problem'} onClick={() => mark(item.preset ?? '', entry.key, 'problem')}>
                        問題あり
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          {!settled ? (
            <button type="button" className="pri" disabled={busy} onClick={() => complete()}>
              確認できた
            </button>
          ) : null}
        </>
      );
    }
    return (
      <>
        <Checks checks={view.recordChecks} />
        <p className="dim" style={{ fontSize: 11 }}>
          投稿は分析の Post に記録し、書き出した版（exportId）と結び付けています。横動画の分析画面での詳しい表示は今後の対応です。
        </p>
        {!settled ? (
          <button type="button" className="pri" disabled={busy} onClick={() => complete()}>
            記録を完了する
          </button>
        ) : null}
      </>
    );
  };

  return (
    <div className="lv-backdrop">
      <div className="lv-dialog" style={{ width: 1180, height: '88vh' }}>
        <div className="dh">
          投稿：{project.title}
          <span className="badge long">YouTube 通常動画</span>
          {view.workflow ? (
            <span className="dim" style={{ fontWeight: 400 }}>
              {longDoneCount(tasks)} / {tasks.length} 完了{view.workflow.status === 'done' ? ' · すべて完了' : ''}
            </span>
          ) : null}
          <span className="sp" />
          <button type="button" className="sm ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="db" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, flex: 1, minHeight: 0 }}>
          {!view.available ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <p>まだ書き出していません。書き出しが終わると、言語ごとの投稿の手順をここで進められます。</p>
            </div>
          ) : (
            <>
              <div className="scroll lv-pub-steps">
                {tasks.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`lv-pub-step ${item.status} ${task?.id === item.id ? 'on' : ''}`}
                    onClick={() => {
                      setSelected(item.id);
                      setSkipping(false);
                    }}
                  >
                    <span className="mark">{STATUS_MARK[item.status]}</span>
                    <span>{longTaskTitle(item)}</span>
                  </button>
                ))}
                <p className="dim" style={{ fontSize: 10.5, marginTop: 8 }}>
                  YouTube に接続していなくても、書き出したMP4と投稿文で手動投稿して進められます。
                </p>
              </div>
              <div className="scroll" style={{ minHeight: 0 }}>
                {view.workflow?.staleExport ? (
                  <div className="diag warning">投稿した後に書き出し直しています。新しい版を投稿する場合は、その言語の「投稿をやり直す」を使ってください。</div>
                ) : null}
                {task ? (
                  <>
                    <h3 style={{ margin: '0 0 4px' }}>
                      {longTaskTitle(task)}
                      {task.status === 'done' ? <span className="badge ok" style={{ marginLeft: 6 }}>完了</span> : null}
                      {task.status === 'skipped' ? <span className="badge" style={{ marginLeft: 6 }}>スキップ{task.skippedReason ? `：${task.skippedReason}` : ''}</span> : null}
                      {task.status === 'needs-fix' ? <span className="badge err" style={{ marginLeft: 6 }}>やり直し</span> : null}
                      {task.status === 'pending' ? <span className="badge" style={{ marginLeft: 6 }}>前の手順の完了待ち</span> : null}
                    </h3>
                    <p className="muted" style={{ marginTop: 0 }}>{longTaskBlurb(task)}</p>
                    {error ? <div className="diag error">{error}</div> : null}
                    {body()}
                    {task.type === 'youtube-publish' && task.status !== 'done' && task.status !== 'skipped' ? (
                      <div style={{ marginTop: 12 }}>
                        {skipping ? (
                          <div className="row">
                            <input placeholder="スキップする理由（例：英語版は出さない）" value={skipReason} onChange={(event) => setSkipReason(event.target.value)} style={{ flex: 1 }} />
                            <button type="button" className="sm" disabled={busy} onClick={() => void run(() => window.studio.long.publishing.skip(project.id, task.id, skipReason)).then(() => setSkipping(false))}>
                              スキップする
                            </button>
                            <button type="button" className="sm ghost" onClick={() => setSkipping(false)}>
                              やめる
                            </button>
                          </div>
                        ) : (
                          <button type="button" className="sm ghost" onClick={() => setSkipping(true)}>
                            この言語は投稿しない（スキップ）
                          </button>
                        )}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
        <div className="df">
          <span className="dim" style={{ marginRight: 'auto', fontSize: 11 }}>
            投稿の記録は分析にも残ります。実際の投稿・公開は、ボタンを押したときだけ行います。
          </span>
          {view.available && !view.started ? (
            <button type="button" disabled={busy} onClick={() => void run(() => window.studio.long.publishing.start(project.id))}>
              投稿運用を始める
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

/** 言語ごとの投稿：ファイル・投稿文・（任意）アプリから YouTube へ・手動投稿の URL 記録 */
const PublishTask = ({
  task,
  view,
  busy,
  run,
  patch,
  complete,
  checklist,
  showApi,
  setShowApi,
  refresh,
}: {
  task: WorkflowTask;
  view: LongPublishingView;
  busy: boolean;
  run: (task: () => Promise<LongPublishingView>) => Promise<void>;
  patch: (body: LongPublishingTaskBody) => void;
  complete: (body?: LongPublishingTaskBody) => void;
  checklist: React.ReactNode;
  showApi: boolean;
  setShowApi: (value: boolean) => void;
  refresh: () => Promise<void>;
}) => {
  const project = useLongStore((state) => state.project)!;
  const language = longLanguageOf(task.preset)!;
  const files = view.files.filter((file) => file.language === language);
  const copy = view.copy[language];
  const post = view.posts.find((item) => item.preset === task.preset);
  const [url, setUrl] = useState(task.urlDraft ?? '');
  const [postedAt, setPostedAt] = useState(toLocalInput(task.postedAtDraft));
  const settled = task.status === 'done' || task.status === 'skipped';
  const verdict = checkYoutubeVideoUrl(url, { accounts: view.settings.accounts, taken: view.taken, ignore: { projectId: project.id, preset: task.preset ?? '' } });
  const video = files.find((file) => file.kind === 'video');
  return (
    <>
      <div className="lv-pub-sec">
        <h4>1. 書き出したファイル（{LONG_LANGUAGE_NAME[language]}）</h4>
        {files.map((file) => (
          <div key={file.relativePath} className="row" style={{ fontSize: 11.5 }}>
            <span style={{ width: 110 }}>{LONG_FILE_LABEL[file.kind]}</span>
            <span className="mono dim" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file.name}
            </span>
            {view.present[file.relativePath] ? null : <span className="badge err">見つかりません</span>}
          </div>
        ))}
        {video ? (
          <button type="button" className="sm" onClick={() => void window.studio.revealPath(video.relativePath)}>
            フォルダで表示
          </button>
        ) : null}
      </div>
      <div className="lv-pub-sec">
        <h4>2. 投稿文（書き出した版のチャプター込み）</h4>
        {copy ? (
          <>
            <div className="row">
              <span className="muted lv-pub-label">タイトル</span>
              <span style={{ flex: 1 }}>{copy.title || <span className="diag error">タイトルが空です（右パネルの「投稿」で入力）</span>}</span>
              <button type="button" className="sm" disabled={!copy.title} onClick={() => void copyText(copy.title)}>
                コピー
              </button>
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="muted lv-pub-label">説明欄</span>
              <pre className="lv-pub-pre">{copy.description || '（空）'}</pre>
              <button type="button" className="sm" disabled={!copy.description} onClick={() => void copyText(copy.description)}>
                コピー
              </button>
            </div>
            {copy.tags.length > 0 ? (
              <div className="row">
                <span className="muted lv-pub-label">タグ</span>
                <span style={{ flex: 1 }}>{copy.tags.join(', ')}</span>
                <button type="button" className="sm" onClick={() => void copyText(copy.tags.join(','))}>
                  コピー
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="lv-pub-sec">
        <h4>
          3. アプリから YouTube へ送る（任意）
          <button type="button" className="sm ghost" style={{ marginLeft: 8 }} onClick={() => setShowApi(!showApi)}>
            {showApi ? '閉じる' : '開く'}
          </button>
        </h4>
        {showApi ? (
          <YoutubePublishPanel project={{ id: project.id }} taskId={task.id} preset={task.preset as DeliveryPresetId} reviewing={settled} refresh={refresh} />
        ) : (
          <p className="dim" style={{ fontSize: 11, margin: 0 }}>非公開でアップロードし、YouTube Studio で仕上げてから予約・公開します。通常動画（Shorts ではない）として送ります。</p>
        )}
      </div>
      <div className="lv-pub-sec">
        <h4>4. 手動で投稿した場合は、URL を記録</h4>
        <a className="pw-open" href={PUBLISH_PAGES.youtube.href} target="_blank" rel="noreferrer">
          {PUBLISH_PAGES.youtube.label}
        </a>
        <div style={{ margin: '6px 0' }}>{checklist}</div>
        {post?.url && settled ? (
          <div className="diag info">
            記録済み：
            <a href={post.url} target="_blank" rel="noreferrer" className="mono">
              {post.url}
            </a>
            <span className="dim">{post.publicationState ? `（${post.publicationState}）` : ''}</span>
          </div>
        ) : null}
        {!settled ? (
          <>
            <div className="lv-field">
              <span>動画のURL</span>
              <div>
                <input
                  value={url}
                  placeholder="https://www.youtube.com/watch?v=…"
                  style={{ width: '100%' }}
                  onChange={(event) => setUrl(event.target.value)}
                  onBlur={() => url !== (task.urlDraft ?? '') && patch({ url })}
                />
                {url ? (
                  <div className={`diag ${verdict.status === 'valid' ? 'info' : verdict.status === 'warning' ? 'warning' : 'error'}`} style={{ marginTop: 4 }}>
                    {verdict.message}
                    {verdict.suggestion ? (
                      <button type="button" className="sm" onClick={() => setUrl(verdict.suggestion!.url)}>
                        {verdict.suggestion.label}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="lv-field">
              <span>公開日時</span>
              <input type="datetime-local" value={postedAt} onChange={(event) => setPostedAt(event.target.value)} />
            </div>
            <button
              type="button"
              className="pri"
              disabled={busy || verdict.status === 'error' || verdict.status === 'empty'}
              onClick={() => complete({ url, postedAt: postedAt ? new Date(postedAt).toISOString() : undefined })}
            >
              投稿を記録する
            </button>
          </>
        ) : task.status === 'done' ? (
          <button type="button" className="sm ghost" disabled={busy} onClick={() => void run(() => window.studio.long.publishing.needsFix(project.id, task.id))}>
            投稿をやり直す
          </button>
        ) : null}
      </div>
    </>
  );
};
