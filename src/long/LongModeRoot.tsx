import { useEffect } from 'react';
import { LongGuide } from './LongGuide';
import { LongHome } from './LongHome';
import { LongWorkspace } from './LongWorkspace';
import { isDirty, saveLongNow, useLongStore } from './store';
import { errorText } from './util';

/** 横動画作成モードのルート。ガイド／詳細編集は同じ Project の表示方法の違い。 */
export const LongModeRoot = ({ active }: { active: boolean }) => {
  const project = useLongStore((state) => state.project);
  const revision = useLongStore((state) => state.revision);
  const message = useLongStore((state) => state.message);
  const saveError = useLongStore((state) => state.saveError);
  const exportProgress = useLongStore((state) => state.exportProgress);

  // 一覧と、前回開いていた横動画の復元
  useEffect(() => {
    void (async () => {
      try {
        const store = useLongStore.getState();
        store.setSummaries(await window.studio.long.list());
        if (store.project) return;
        const state = await window.studio.long.getCreateState();
        if (state.lastLongProjectId) {
          try {
            const project = await window.studio.long.load(state.lastLongProjectId);
            if (!useLongStore.getState().project) useLongStore.getState().open(project);
          } catch {
            // 削除済みなら一覧を表示する
          }
        }
      } catch (error) {
        useLongStore.getState().setMessage(errorText(error));
      }
    })();
  }, []);

  // 素材の確認（欠落・プロキシの再作成）
  useEffect(() => {
    if (!project) return;
    void window.studio.long.setCreateState({ lastLongProjectId: project.id });
    void window.studio.long
      .checkAssets(project)
      .then((missing) => useLongStore.getState().setMissingAssets(missing))
      .catch(() => undefined);
    // project の切り替え時だけ
  }, [project?.id]);

  // プロキシ作成の進捗
  useEffect(
    () =>
      window.studio.long.onMediaProgress((progress) => {
        const store = useLongStore.getState();
        if (store.project?.id !== progress.projectId) return;
        if (progress.stage === 'proxy') store.setProxyProgress(progress.assetId, progress.ratio);
        if (progress.stage === 'error') {
          store.setProxyProgress(progress.assetId, null);
          store.setMessage(`プレビュー用ファイルの作成に失敗しました：${progress.message ?? ''}`);
        }
        if (progress.stage === 'done' && progress.proxyPath) {
          store.setProxyProgress(progress.assetId, null);
          store.live((current) => ({
            ...current,
            assets: current.assets.map((asset) => (asset.id === progress.assetId ? { ...asset, proxyPath: progress.proxyPath } : asset)),
          }));
        }
      }),
    [],
  );

  useEffect(() => window.studio.long.onExportProgress((progress) => useLongStore.getState().setExportProgress(progress)), []);

  // 自動保存（700ms のデバウンス＋30秒ごと）
  useEffect(() => {
    if (!project || !isDirty(useLongStore.getState()) || useLongStore.getState().gesture) return;
    const timer = window.setTimeout(() => {
      void saveLongNow().then(async (ok) => {
        if (ok) useLongStore.getState().setSummaries(await window.studio.long.list());
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [revision]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isDirty(useLongStore.getState())) void saveLongNow();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // ショートカット（このモードが表示されているときだけ）
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useLongStore.getState().undo();
      } else if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) {
        event.preventDefault();
        useLongStore.getState().redo();
      } else if (mod && key === 's') {
        event.preventDefault();
        void saveLongNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const toast = message || saveError || (exportProgress && exportProgress.phase !== 'done');
  return (
    <div className="lv">
      {!project ? <LongHome /> : project.editor.mode === 'guide' ? <LongGuide active={active} /> : <LongWorkspace active={active} />}
      {toast ? (
        <div className={`lv-toast ${saveError || exportProgress?.phase === 'error' ? 'err' : ''}`}>
          <span>
            {exportProgress && exportProgress.phase !== 'done'
              ? `書き出し ${exportProgress.language.toUpperCase()} · ${PHASE_LABEL[exportProgress.phase]} · ${Math.round(exportProgress.ratio * 100)}%${
                  exportProgress.remainingSec ? ` · 残り約${Math.ceil(exportProgress.remainingSec / 60)}分` : ''
                }${exportProgress.message ? ` · ${exportProgress.message}` : ''}`
              : saveError ?? message}
          </span>
          <button
            type="button"
            className="sm ghost"
            onClick={() => {
              useLongStore.getState().setMessage(null);
              useLongStore.getState().setSaving(false, null);
              if (exportProgress && ['cancelled', 'error'].includes(exportProgress.phase)) useLongStore.getState().setExportProgress(null);
            }}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
};

const PHASE_LABEL: Record<string, string> = {
  prepare: '準備',
  bundle: '準備',
  render: '映像と音声を描画',
  audio: '音声',
  nobgm: 'BGMなし版',
  finalize: '音量の調整',
  outputs: '字幕・メタデータ',
  thumbnail: 'サムネイル',
  done: '完了',
  cancelled: 'キャンセル',
  error: '失敗',
};
