import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { YoutubePlaylistOption, YoutubePublishJob, YoutubePublishMetadata, YoutubePublishProgress, YoutubePublishView } from '../../shared/schema/youtube-publish';
import { DEFAULT_PUBLISH_TIMEZONE } from '../../shared/schema/youtube-publish';
import { utcToZonedLocal, zonedLocalToUtc } from '../../shared/youtube-publish';
import type { DeliveryPresetId } from '../../shared/delivery-presets';
import type { PublishingView } from '../../shared/publishing';

const ipcMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const stateLabel = (job: YoutubePublishJob): string => {
  if (job.operationState === 'outcome_unknown') return '結果不明';
  if (job.publicationState === 'scheduled') return '予約済み（YouTube確認済み）';
  if (job.publicationState === 'public') return '公開済み';
  if (job.publicationState === 'unlisted') return '限定公開';
  if (job.publicationState === 'private') return '非公開';
  const labels: Record<YoutubePublishJob['operationState'], string> = {
    draft: '下書き',
    uploading: '転送中',
    paused: '一時停止',
    processing: '処理中',
    setting_metadata: '設定適用中',
    awaiting_studio: 'Studio確認待ち',
    ready_to_publish: '予約できます',
    verifying: '結果確認中',
    idle: '待機',
    action_required: '要対応',
    outcome_unknown: '結果不明',
  };
  return labels[job.operationState];
};

const primaryFor = (job: YoutubePublishJob, canPublish: boolean): { action: string; label: string; disabled?: boolean } => {
  if (!canPublish) return { action: 'connect', label: '投稿を有効にする（再認可）' };
  if (job.operationState === 'outcome_unknown') return { action: 'bind', label: '動画IDを確認して紐付ける' };
  if (job.operationState === 'uploading') return { action: 'pause', label: '転送を中断' };
  if (job.operationState === 'paused') return { action: 'resume', label: '再開' };
  if (job.operationState === 'draft' || job.publicationState === 'not_uploaded') {
    return { action: 'upload', label: '非公開でアップロード' };
  }
  if (job.operationState === 'awaiting_studio') return { action: 'studio', label: 'Studioで仕上げる' };
  if (job.operationState === 'ready_to_publish' || job.publicationState === 'private') {
    return { action: 'schedule', label: 'この日時で予約する' };
  }
  if (job.publicationState === 'scheduled') return { action: 'refresh', label: '状態を再取得' };
  return { action: 'refresh', label: '状態を再取得' };
};

export const YoutubePublishPanel = ({
  project,
  taskId,
  preset,
  reviewing,
  onView,
  refresh,
}: {
  /** 短尺は Project、横動画は ID だけを渡す */
  project: { id: string };
  taskId: string;
  preset: DeliveryPresetId;
  reviewing: boolean;
  /** 短尺：投稿運用の表示を更新する */
  onView?: (next: PublishingView) => void;
  /** 横動画：投稿運用の表示を更新する（指定すると短尺の更新は使わない） */
  refresh?: () => Promise<void>;
}) => {
  const [pub, setPub] = useState<YoutubePublishView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<YoutubePublishProgress | null>(null);
  const [localTime, setLocalTime] = useState('');
  const [bindId, setBindId] = useState('');
  const [playlists, setPlaylists] = useState<YoutubePlaylistOption[]>([]);
  const [playlistsReady, setPlaylistsReady] = useState(false);
  const [confirmReupload, setConfirmReupload] = useState(false);
  const pubRef = useRef<YoutubePublishView | null>(null);
  const metaRef = useRef<YoutubePublishMetadata | null>(null);
  const revisionRef = useRef(0);
  const jobIdRef = useRef('');
  const dirtyRef = useRef(false);
  const timeDirtyRef = useRef(false);
  const timeGeneration = useRef(0);
  const tail = useRef(Promise.resolve());
  const busyCount = useRef(0);
  const onViewRef = useRef(onView);
  const refreshRef = useRef(refresh);
  pubRef.current = pub;
  onViewRef.current = onView;
  refreshRef.current = refresh;
  const refreshWorkflow = async (): Promise<void> => {
    if (refreshRef.current) {
      await refreshRef.current();
      return;
    }
    const refreshed = await window.studio.getPublishing(project.id);
    onViewRef.current?.(refreshed);
  };

  const begin = () => {
    busyCount.current += 1;
    setBusy(true);
  };
  const end = () => {
    busyCount.current = Math.max(0, busyCount.current - 1);
    if (busyCount.current === 0) setBusy(false);
  };

  const applyTime = (next: YoutubePublishView) => {
    if (timeDirtyRef.current || !next.job) return;
    setLocalTime(next.job.desiredPublishAt ? utcToZonedLocal(next.job.desiredPublishAt, next.job.timezone || DEFAULT_PUBLISH_TIMEZONE) : '');
  };

  const remember = (next: YoutubePublishView, keepLocal: boolean) => {
    if (!next.job) {
      pubRef.current = next;
      setPub(next);
      return;
    }
    const metadata = keepLocal && metaRef.current ? metaRef.current : next.job.metadata;
    if (!keepLocal) dirtyRef.current = false;
    metaRef.current = metadata;
    jobIdRef.current = next.job.id;
    revisionRef.current = next.job.revision;
    const view = { ...next, job: { ...next.job, metadata } };
    pubRef.current = view;
    setPub(view);
    applyTime(next);
    if (next.conflict) setError(next.conflict.message);
  };

  const load = useCallback(async () => {
    const next = await window.studio.getYoutubePublish(project.id, taskId);
    if (next.job) {
      jobIdRef.current = next.job.id;
      revisionRef.current = next.job.revision;
      if (!dirtyRef.current) metaRef.current = next.job.metadata;
    }
    const metadata = next.job && dirtyRef.current && metaRef.current ? metaRef.current : next.job?.metadata;
    const view = { ...next, job: next.job && metadata ? { ...next.job, metadata } : next.job };
    if (view.job) metaRef.current = view.job.metadata;
    pubRef.current = view;
    setPub(view);
    if (!timeDirtyRef.current && next.job) {
      setLocalTime(next.job.desiredPublishAt ? utcToZonedLocal(next.job.desiredPublishAt, next.job.timezone || DEFAULT_PUBLISH_TIMEZONE) : '');
    }
  }, [project.id, taskId]);

  useEffect(() => {
    void load().catch((reason) => setError(ipcMessage(reason)));
    return window.studio.onYoutubePublishProgress((next) => {
      setProgress(next.stage === 'done' ? null : next);
      if (next.stage === 'done') void load();
    });
  }, [load]);

  useEffect(() => {
    if (!pub?.canPublish) return;
    let cancel = false;
    void window.studio
      .listYoutubePlaylists()
      .then((items) => {
        if (cancel) return;
        setPlaylists(items);
        setPlaylistsReady(true);
      })
      .catch((reason) => {
        if (cancel) return;
        setPlaylistsReady(true);
        setError(ipcMessage(reason));
      });
    return () => {
      cancel = true;
    };
  }, [pub?.canPublish]);

  const job = pub?.job;

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = tail.current.then(task, task).then(
      () => undefined,
      () => undefined,
    );
    tail.current = next;
    return next;
  };

  const persist = (patch?: Partial<YoutubePublishMetadata>, publishAt?: string): Promise<void> => {
    const requestedPatch = patch;
    const requestedAt = publishAt;
    begin();
    return enqueue(async () => {
      try {
        const jobId = jobIdRef.current;
        const hasPatch = Boolean(requestedPatch && Object.keys(requestedPatch).length > 0);
        if (!jobId || (!hasPatch && requestedAt === undefined)) return;
        setError('');
        const snapshot = metaRef.current;
        const next = await window.studio.updateYoutubePublishDraft({
          jobId,
          revision: revisionRef.current,
          metadata: hasPatch ? requestedPatch : undefined,
          desiredPublishAt: requestedAt === undefined ? undefined : requestedAt || null,
          timezone: DEFAULT_PUBLISH_TIMEZONE,
        });
        if (metaRef.current === snapshot) dirtyRef.current = false;
        remember(next, true);
        await refreshWorkflow();
      } catch (reason) {
        setError(ipcMessage(reason));
      } finally {
        end();
      }
    });
  };

  const editMetadata = (patch: Partial<YoutubePublishMetadata>, save: boolean, publishAt?: string) => {
    const currentMeta = metaRef.current ?? pubRef.current?.job?.metadata;
    if (!currentMeta) return;
    const metadata = { ...currentMeta, ...patch };
    metaRef.current = metadata;
    dirtyRef.current = true;
    setPub((current) => {
      if (!current?.job) return current;
      const view = { ...current, job: { ...current.job, metadata } };
      pubRef.current = view;
      return view;
    });
    if (save) void persist(patch, publishAt);
  };

  const run = async (task: () => Promise<YoutubePublishView>): Promise<void> => {
    begin();
    setError('');
    try {
      await tail.current;
      const next = await task();
      remember(next, dirtyRef.current);
      await refreshWorkflow();
    } catch (reason) {
      setError(ipcMessage(reason));
    } finally {
      end();
    }
  };

  const saveDraft = async (patch?: Partial<YoutubePublishMetadata>, publishAt?: string) => {
    if (!jobIdRef.current) {
      await run(() =>
        window.studio.createYoutubePublishDraft({
          projectId: project.id,
          taskId,
          preset,
          metadata: patch,
          desiredPublishAt: publishAt || undefined,
          timezone: DEFAULT_PUBLISH_TIMEZONE,
        }),
      );
      return;
    }
    if (patch) editMetadata(patch, false);
    await persist(patch, publishAt);
  };

  const scheduleUtc = useMemo(() => {
    if (!localTime) return undefined;
    try {
      return zonedLocalToUtc(localTime, DEFAULT_PUBLISH_TIMEZONE);
    } catch {
      return undefined;
    }
  }, [localTime]);

  if (!pub) {
    return (
      <div className="ytp">
        <p className="gd-muted">{error || 'YouTube投稿を読み込んでいます'}</p>
      </div>
    );
  }

  const primary = job ? primaryFor(job, pub.canPublish) : { action: pub.canPublish ? 'draft' : 'connect', label: pub.canPublish ? '投稿下書きを作る' : '投稿を有効にする（再認可）' };
  const percent = progress && progress.totalBytes > 0 ? Math.round((progress.sentBytes / progress.totalBytes) * 100) : 0;

  return (
    <div className="ytp">
      <header className="ytp-head">
        <strong>アプリからYouTubeへ</strong>
        <span>
          {pub.channel ? `${pub.channel.title}${pub.channel.handle ? `（${pub.channel.handle}）` : ''}` : 'チャンネル未確認'}
          {job ? ` · ${stateLabel(job)}` : ''}
        </span>
      </header>
      <p className="gd-muted">
        流れ：Googleで接続 → 非公開アップロード → YouTube Studioで補完 → アプリで予約確定。予約後の公開はYouTubeが行います。接続しなくても、下の手動投稿は使えます。
      </p>
      {!pub.canPublish && (
        <div className="ytp-actions">
          <button type="button" className="pw-primary" disabled={busy || reviewing} onClick={() => void run(() => window.studio.connectYoutube('publish').then(() => window.studio.getYoutubePublish(project.id, taskId)))}>
            投稿を有効にする（再認可）
          </button>
          <span className="gd-muted">読み取り接続はそのまま残します。許可スコープを追加します。</span>
        </div>
      )}
      {pub.canPublish && !job && (
        <button type="button" className="pw-primary" disabled={busy || reviewing} onClick={() => void saveDraft()}>
          この書き出しで下書きを作る
        </button>
      )}
      {job && (
        <>
          <label>
            予定公開（Asia/Tokyo）
            <input
              type="datetime-local"
              value={localTime}
              disabled={reviewing}
              onChange={(event) => {
                timeDirtyRef.current = true;
                timeGeneration.current += 1;
                setLocalTime(event.target.value);
              }}
              onBlur={() => {
                if (!scheduleUtc) return;
                const generation = timeGeneration.current;
                void persist(undefined, scheduleUtc).finally(() => {
                  if (timeGeneration.current === generation) timeDirtyRef.current = false;
                });
              }}
            />
          </label>
          <p className="gd-muted">この段階ではYouTubeへ日時を送りません。予約確定のときだけ送信します。UTC: {scheduleUtc ?? '—'}</p>
          <label>
            タイトル
            <input
              value={job.metadata.title}
              disabled={reviewing || job.operationState === 'uploading'}
              onChange={(event) => editMetadata({ title: event.target.value }, false)}
              onBlur={(event) => void persist({ title: event.target.value })}
            />
          </label>
          <label>
            再生リスト（任意）
            <select
              key={`${playlistsReady ? 'ready' : 'loading'}:${job.metadata.playlistIds.join('\n')}`}
              value=""
              disabled={reviewing || !playlistsReady}
              onChange={(event) => {
                const id = event.target.value;
                if (!id) return;
                const current = metaRef.current?.playlistIds ?? [];
                const playlistIds = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
                editMetadata({ playlistIds }, true);
              }}
            >
              <option value="">
                {!playlistsReady ? '読み込み中' : job.metadata.playlistIds.length === 0 ? '選択しない' : '追加する'}
              </option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {job.metadata.playlistIds.includes(playlist.id) ? `✓ ${playlist.title}` : playlist.title}
                </option>
              ))}
            </select>
          </label>
          {job.metadata.playlistIds.length > 0 && (
            <div className="ytp-picks">
              {job.metadata.playlistIds.map((id) => (
                <span key={id} className="ytp-pick">
                  {playlists.find((playlist) => playlist.id === id)?.title ?? id}
                  <button
                    type="button"
                    disabled={reviewing}
                    onClick={() =>
                      editMetadata(
                        { playlistIds: (metaRef.current?.playlistIds ?? []).filter((item) => item !== id) },
                        true,
                      )
                    }
                  >
                    外す
                  </button>
                </span>
              ))}
            </div>
          )}
          <label className="ytp-inline">
            <input
              type="checkbox"
              checked={job.metadata.containsSyntheticMedia}
              disabled={reviewing}
              onChange={(event) => editMetadata({ containsSyntheticMedia: event.target.checked }, true)}
            />
            AI使用を開示する
          </label>
          <label className="ytp-inline">
            <input
              type="checkbox"
              checked={job.metadata.selfDeclaredMadeForKids}
              disabled={reviewing}
              onChange={(event) => editMetadata({ selfDeclaredMadeForKids: event.target.checked }, true)}
            />
            子ども向け
          </label>
          {job.metadata.contentKind !== 'video' && (
          <label>
            Shorts関連動画
            <select
              value={job.metadata.relatedVideosMode}
              disabled={reviewing}
              onChange={(event) => editMetadata({ relatedVideosMode: event.target.value as 'unused' | 'set' }, true)}
            >
              <option value="unused">使わない</option>
              <option value="set">Studioで設定する</option>
            </select>
          </label>
          )}
          {job.metadata.contentKind !== 'video' && job.metadata.relatedVideosMode === 'set' && (
            <label>
              関連動画のURL / ID（コピー用）
              <textarea
                value={job.metadata.relatedVideoRefs.join('\n')}
                disabled={reviewing}
                onChange={(event) => editMetadata({ relatedVideoRefs: event.target.value.split('\n') }, false)}
                onBlur={(event) => {
                  const relatedVideoRefs = event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean);
                  editMetadata({ relatedVideoRefs, relatedVideosMode: 'set' }, true);
                }}
              />
            </label>
          )}
          {progress && (
            <div className="ytp-progress">
              <span>
                {progress.stage} {percent}%
              </span>
              <div className="an-progress">
                <span style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}
          {job.lastError && <p className="pw-error">{job.lastError}</p>}
          {job.youtubeVideoId && (
            <div className="ytp-checks">
              <p className="gd-muted">ゲームタイトルの作業メモ：{job.metadata.gameTitleMemo}（APIには送りません）</p>
              {job.studioChecks.map((item) => (
                <div key={item.key} className="ytp-check">
                  <span>
                    <strong>{item.label}</strong>
                    <em>
                      {item.status === 'done' ? '完了' : item.status === 'not_applicable' ? '対象外' : '未確認'}
                      {item.method === 'manual' ? ' · 手動' : item.method === 'api' ? ' · API' : ''}
                    </em>
                  </span>
                  {item.status === 'unchecked' && item.required && (
                    <span>
                      <button type="button" className="pw-ghost" disabled={reviewing || busy} onClick={() => void run(() => window.studio.confirmYoutubeStudioItem({ jobId: jobIdRef.current, revision: revisionRef.current, key: item.key, status: 'done' }))}>
                        完了
                      </button>
                      <button type="button" className="pw-link" disabled={reviewing || busy} onClick={() => void run(() => window.studio.confirmYoutubeStudioItem({ jobId: jobIdRef.current, revision: revisionRef.current, key: item.key, status: 'not_applicable', reason: '対象外' }))}>
                        対象外
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {job.operationState === 'outcome_unknown' && (
            <label>
              Studioで確認した動画ID
              <input value={bindId} onChange={(event) => setBindId(event.target.value)} />
              <button
                type="button"
                className="pw-ghost"
                disabled={busy || bindId.trim().length < 11}
                onClick={() => void run(() => window.studio.bindYoutubeVideoPreview(jobIdRef.current, bindId.trim()))}
              >
                所有者を確認
              </button>
            </label>
          )}
          {pub.bindCandidate && (
            <div className="ytp-bind">
              <p>
                {pub.bindCandidate.title}（{pub.bindCandidate.channelId} / {pub.bindCandidate.privacyStatus}）
              </p>
              <button
                type="button"
                className="pw-primary"
                disabled={busy || pub.bindCandidate.channelId !== job.channelId}
                onClick={() =>
                  void run(() =>
                    window.studio.bindYoutubeVideo({ jobId: jobIdRef.current, revision: revisionRef.current, videoId: pub.bindCandidate!.videoId, confirmed: true }),
                  )
                }
              >
                この動画を紐付ける
              </button>
            </div>
          )}
          {pub.conflict && (
            <div className="ytp-conflict">
              <strong>Studio側の変更があります。古い値では上書きしません。</strong>
              <p>{pub.conflict.message}</p>
              <button type="button" className="pw-ghost" onClick={() => void run(() => window.studio.refreshYoutubePublish(jobIdRef.current))}>
                最新を取り込む
              </button>
            </div>
          )}
          {!reviewing && (
            <div className="ytp-actions">
              {primary.action === 'upload' && (
                <button type="button" className="pw-primary" disabled={busy} onClick={() => void run(() => window.studio.startYoutubeUpload(jobIdRef.current, revisionRef.current))}>
                  {primary.label}
                </button>
              )}
              {primary.action === 'pause' && (
                <button type="button" className="pw-ghost" disabled={busy} onClick={() => void run(() => window.studio.pauseYoutubeUpload(jobIdRef.current))}>
                  {primary.label}
                </button>
              )}
              {primary.action === 'resume' && (
                <button type="button" className="pw-primary" disabled={busy} onClick={() => void run(() => window.studio.resumeYoutubeUpload(jobIdRef.current, revisionRef.current))}>
                  {primary.label}
                </button>
              )}
              {primary.action === 'studio' && (
                <button type="button" className="pw-primary" disabled={busy} onClick={() => void run(() => window.studio.openYoutubeStudio(jobIdRef.current).then(() => window.studio.getYoutubePublish(project.id, taskId)))}>
                  {primary.label}
                </button>
              )}
              {primary.action === 'schedule' && scheduleUtc && (
                <button
                  type="button"
                  className="pw-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await window.studio.updateYoutubePublishDraft({
                        jobId: jobIdRef.current,
                        revision: revisionRef.current,
                        desiredPublishAt: scheduleUtc,
                        timezone: DEFAULT_PUBLISH_TIMEZONE,
                      });
                      const latest = await window.studio.getYoutubePublish(project.id, taskId);
                      if (!latest.job) return latest;
                      const preview = await window.studio.previewYoutubePublication({
                        jobId: latest.job.id,
                        revision: latest.job.revision,
                        remoteFingerprint: latest.job.lastRemoteState?.fingerprint ?? '',
                        action: 'schedule',
                        publishAt: scheduleUtc,
                        timezone: DEFAULT_PUBLISH_TIMEZONE,
                      });
                      if (preview.conflict) return preview;
                      return window.studio.applyYoutubePublication({
                        jobId: preview.job!.id,
                        revision: preview.job!.revision,
                        remoteFingerprint: preview.job!.lastRemoteState?.fingerprint ?? '',
                        action: 'schedule',
                        publishAt: scheduleUtc,
                        timezone: DEFAULT_PUBLISH_TIMEZONE,
                      });
                    })
                  }
                >
                  {primary.label}
                </button>
              )}
              {primary.action === 'refresh' && (
                <button type="button" className="pw-primary" disabled={busy} onClick={() => void run(() => window.studio.refreshYoutubePublish(jobIdRef.current))}>
                  {primary.label}
                </button>
              )}
              {job.publicationState === 'scheduled' && (
                <>
                  <button
                    type="button"
                    className="pw-ghost"
                    disabled={busy || !scheduleUtc}
                    onClick={() =>
                      void run(() =>
                        window.studio.applyYoutubePublication({
                          jobId: jobIdRef.current,
                          revision: revisionRef.current,
                          remoteFingerprint: job.lastRemoteState?.fingerprint ?? '',
                          action: 'reschedule',
                          publishAt: scheduleUtc,
                          timezone: DEFAULT_PUBLISH_TIMEZONE,
                        }),
                      )
                    }
                  >
                    予約を変更
                  </button>
                  <button
                    type="button"
                    className="pw-link"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        window.studio.applyYoutubePublication({
                          jobId: jobIdRef.current,
                          revision: revisionRef.current,
                          remoteFingerprint: job.lastRemoteState?.fingerprint ?? '',
                          action: 'cancelSchedule',
                        }),
                      )
                    }
                  >
                    予約を解除（非公開のまま）
                  </button>
                </>
              )}
              {(job.publicationState === 'private' || job.publicationState === 'scheduled') && job.youtubeVideoId && (
                <>
                  <button
                    type="button"
                    className="pw-link"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        window.studio.applyYoutubePublication({
                          jobId: jobIdRef.current,
                          revision: revisionRef.current,
                          remoteFingerprint: job.lastRemoteState?.fingerprint ?? '',
                          action: 'unlisted',
                        }),
                      )
                    }
                  >
                    限定公開で保管
                  </button>
                  <button
                    type="button"
                    className="pw-link"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        window.studio.applyYoutubePublication({
                          jobId: jobIdRef.current,
                          revision: revisionRef.current,
                          remoteFingerprint: job.lastRemoteState?.fingerprint ?? '',
                          action: 'private',
                        }),
                      )
                    }
                  >
                    非公開で保管
                  </button>
                  <button
                    type="button"
                    className="pw-link"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        window.studio.applyYoutubePublication({
                          jobId: jobIdRef.current,
                          revision: revisionRef.current,
                          remoteFingerprint: job.lastRemoteState?.fingerprint ?? '',
                          action: 'public',
                        }),
                      )
                    }
                  >
                    今すぐ公開
                  </button>
                </>
              )}
              {job.operationState !== 'uploading' &&
                job.operationState !== 'outcome_unknown' &&
                (job.youtubeVideoId || job.operationState === 'paused' || job.operationState === 'action_required') &&
                (confirmReupload ? (
                  <div className="ytp-conflict">
                    <strong>新しい非公開動画としてアップロードします。</strong>
                    <p>
                      今YouTubeにある動画と、その予約は残します。不要ならStudioで削除してください。タイトル・説明・タグ・言語・再生リストは、今の入力で送り直します。
                    </p>
                    <span className="ytp-actions">
                      <button
                        type="button"
                        className="pw-primary"
                        disabled={busy}
                        onClick={() => {
                          setConfirmReupload(false);
                          void run(() => window.studio.reuploadYoutube(jobIdRef.current, revisionRef.current));
                        }}
                      >
                        アップロードする
                      </button>
                      {job.youtubeVideoId && (
                        <button
                          type="button"
                          className="pw-ghost"
                          disabled={busy}
                          onClick={() => void run(() => window.studio.openYoutubeStudio(jobIdRef.current).then(() => window.studio.getYoutubePublish(project.id, taskId)))}
                        >
                          Studioで今の動画を開く
                        </button>
                      )}
                      <button type="button" className="pw-link" disabled={busy} onClick={() => setConfirmReupload(false)}>
                        やめる
                      </button>
                    </span>
                  </div>
                ) : (
                  <button type="button" className="pw-link" disabled={busy} onClick={() => setConfirmReupload(true)}>
                    もう一度アップロード
                  </button>
                ))}
            </div>
          )}
        </>
      )}
      {error && <p className="pw-error">{error}</p>}
      <p className="gd-muted">手動でStudio投稿する場合は、この下のチェックリストとURL入力を使ってください。</p>
    </div>
  );
};
