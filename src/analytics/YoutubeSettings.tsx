import { useCallback, useEffect, useState } from 'react';
import type { SyncRun, YoutubeStatus, YoutubeSyncProgress } from '../../shared/schema/youtube';
import { SYNC_ERROR_LABELS } from '../../shared/youtube-analytics';
import { useAnalyticsOptional } from './context';

const STAGE_LABELS: Record<YoutubeSyncProgress['stage'], string> = {
  channel: 'チャンネルを確認中',
  ledger: '動画一覧を取得中',
  horizon: 'データの最終日を確認中',
  'content-type': '形式（Shorts等）を確認中',
  videos: '動画ごとの実績を取得中',
  done: '完了',
};

const RUN_LABELS: Record<SyncRun['status'], string> = {
  running: '実行中',
  done: '完了',
  partial: '一部取得できませんでした',
  failed: '失敗',
  cancelled: '中止',
};

const RANGE_OPTIONS = [
  { value: '90', label: '直近90日' },
  { value: '180', label: '直近180日' },
  { value: '365', label: '直近365日' },
  { value: 'all', label: '公開日から全期間' },
] as const;

const ipcMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const stamp = (iso: string | undefined): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const errorSummary = (run: SyncRun): Array<{ label: string; count: number; sample: string }> => {
  const groups = new Map<string, { label: string; count: number; sample: string }>();
  for (const error of run.errors) {
    const current = groups.get(error.kind) ?? { label: SYNC_ERROR_LABELS[error.kind], count: 0, sample: error.message };
    current.count += 1;
    groups.set(error.kind, current);
  }
  return [...groups.values()];
};

export const YoutubeSettings = () => {
  const analytics = useAnalyticsOptional();
  const [status, setStatus] = useState<YoutubeStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState<'save' | 'login' | 'disconnect' | null>(null);
  const [progress, setProgress] = useState<YoutubeSyncProgress | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await window.studio.getYoutubeStatus();
      setStatus(next);
      setClientId((current) => current || next.clientId);
    } catch (reason) {
      setError(ipcMessage(reason));
    }
  }, []);

  useEffect(() => {
    void load();
    return window.studio.onYoutubeProgress((next) => {
      setProgress(next.stage === 'done' ? null : next);
      if (next.stage === 'done') {
        void load();
        void analytics?.reload();
      }
    });
  }, [load, analytics]);

  const run = async (kind: typeof busy, task: () => Promise<YoutubeStatus>) => {
    setBusy(kind);
    setError('');
    try {
      setStatus(await task());
    } catch (reason) {
      setError(ipcMessage(reason));
      void load();
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setError('');
    try {
      await window.studio.syncYoutube();
    } catch (reason) {
      setError(ipcMessage(reason));
    }
    void load();
  };

  if (!status) return <strong>YouTube 連携</strong>;
  const running = status.running || Boolean(progress);
  const settings = status.settings;
  const range = settings.fromPublish ? 'all' : String(settings.initialDays);
  const lastRun = status.lastRun;

  return (
    <>
      <strong>YouTube 連携</strong>
      {status.phase === 'unconfigured' && (
        <p className="an-muted">Google Cloud で作った OAuth クライアント（種類：デスクトップアプリ）の ID を入れてください。分析は読み取り、投稿は別途「投稿を有効にする」で許可します。</p>
      )}
      {status.phase === 'disconnected' && <p className="an-muted">未接続です。</p>}
      {status.phase === 'reauth-required' && <p className="ai-error">Googleの許可が切れています。もう一度ログインしてください。</p>}
      {status.phase === 'connected' && (
        <p className="an-muted">
          接続中：{status.channel ? `${status.channel.title}${status.channel.handle ? `（${status.channel.handle}）` : ''}` : 'チャンネルを確認してください'}
          {' · '}
          {status.capabilities?.publish ? '投稿可' : '読み取りのみ'}
          {status.capabilities?.analytics ? ' · 分析可' : ''}
        </p>
      )}
      {!status.secureStorage && <p className="ai-error">このPCでは認証情報を暗号化して保存できないため、接続できません。</p>}

      <details className="yt-client" open={status.phase === 'unconfigured'}>
        <summary>OAuth クライアント</summary>
        <label className="ai-field">
          クライアントID
          <input value={clientId} spellCheck={false} onChange={(event) => setClientId(event.target.value)} />
        </label>
        <label className="ai-field">
          クライアントシークレット
          <input
            type="password"
            value={clientSecret}
            autoComplete="off"
            placeholder={status.hasClientSecret ? '保存済み（変えるときだけ入力）' : '未入力'}
            onChange={(event) => setClientSecret(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="an-secondary yt-button"
          disabled={busy !== null || !clientId.trim()}
          onClick={() =>
            void run('save', async () => {
              const next = await window.studio.setYoutubeClient(clientId, clientSecret || undefined);
              setClientSecret('');
              return next;
            })
          }
        >
          保存
        </button>
      </details>

      {(status.phase === 'disconnected' || status.phase === 'reauth-required') && (
        <div className="an-row">
          <button
            type="button"
            className="an-primary yt-button"
            disabled={busy !== null || !status.secureStorage}
            onClick={() => void run('login', () => window.studio.connectYoutube())}
          >
            {busy === 'login' ? 'ブラウザで許可してください…' : 'Google でログイン'}
          </button>
          {busy === 'login' && (
            <button type="button" className="an-text-btn" onClick={() => void window.studio.cancelYoutubeLogin()}>
              中止
            </button>
          )}
        </div>
      )}

      {status.phase === 'connected' && (
        <>
          <div className="an-row">
            {running ? (
              <button type="button" className="an-secondary yt-button" onClick={() => void window.studio.cancelYoutubeSync()}>
                同期を中止
              </button>
            ) : (
              <button type="button" className="an-primary yt-button" onClick={() => void sync()}>
                今すぐ同期
              </button>
            )}
            {!status.capabilities?.publish && (
              <button
                type="button"
                className="an-secondary yt-button"
                disabled={busy !== null || !status.secureStorage}
                onClick={() => void run('login', () => window.studio.connectYoutube('publish'))}
              >
                {busy === 'login' ? 'ブラウザで許可してください…' : '投稿を有効にする'}
              </button>
            )}
            <button
              type="button"
              className="an-text-btn"
              disabled={busy !== null}
              onClick={() => void run('disconnect', () => window.studio.disconnectYoutubeLocal())}
            >
              このPCの接続を解除
            </button>
            <button
              type="button"
              className="an-text-btn"
              disabled={busy !== null}
              onClick={() => void run('disconnect', () => window.studio.disconnectYoutube())}
            >
              Googleの許可も取り消す
            </button>
          </div>
          <p className="an-muted">このPCの接続を解除しても、YouTube上の予約と動画は残ります。Googleの許可を取り消すと分析連携も切れます。</p>
          {progress && (
            <div className="yt-progress">
              <span>
                {STAGE_LABELS[progress.stage]}
                {progress.stage === 'videos' && progress.total > 0 ? `（${progress.done} / ${progress.total}本）` : ''}
              </span>
              {progress.stage === 'videos' && progress.total > 0 && (
                <div className="an-progress">
                  <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                </div>
              )}
            </div>
          )}
          <label className="ai-field">
            取り込む期間（初回）
            <select
              className="ai-select"
              value={range}
              disabled={running}
              onChange={(event) => {
                const value = event.target.value;
                void run(null, () =>
                  window.studio.setYoutubeSettings(
                    value === 'all' ? { fromPublish: true } : { fromPublish: false, initialDays: Number(value) },
                  ),
                );
              }}
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-field">
            毎回取り直す直近の日数（データの訂正に追従）
            <select
              className="ai-select"
              value={settings.refetchDays}
              disabled={running}
              onChange={(event) => void run(null, () => window.studio.setYoutubeSettings({ refetchDays: Number(event.target.value) }))}
            >
              {[7, 10, 14].map((days) => (
                <option key={days} value={days}>
                  {days}日
                </option>
              ))}
            </select>
          </label>
          <label className="ai-field yt-inline">
            <input
              type="checkbox"
              checked={settings.syncOnStartup}
              onChange={(event) => void run(null, () => window.studio.setYoutubeSettings({ syncOnStartup: event.target.checked }))}
            />
            起動時に未取得の期間を補完する
          </label>
          <div className="yt-facts">
            <span>最終同期</span>
            <span>
              {lastRun ? `${stamp(lastRun.finishedAt ?? lastRun.startedAt)}・${RUN_LABELS[lastRun.status]}` : 'まだありません'}
            </span>
            <span>データの最終日</span>
            <span>{status.horizon ? `${status.horizon}（太平洋時間）` : '未取得'}</span>
            <span>動画</span>
            <span>
              {status.counts.videos}本（制作と紐付け {status.counts.linked} / 未紐付け {status.counts.unlinked}）
            </span>
            <span>日別データ</span>
            <span>{status.counts.withDaily}本</span>
          </div>
          {lastRun && lastRun.errors.length > 0 && (
            <ul className="yt-errors">
              {errorSummary(lastRun).map((item) => (
                <li key={item.label} title={item.sample}>
                  {item.label}：{item.count}件
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="ai-error">{error}</p>}
    </>
  );
};
