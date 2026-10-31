import { useEffect, useState, type ReactNode } from 'react';
import './long.css';
import { LongModeRoot } from './LongModeRoot';
import { saveLongNow, useLongStore } from './store';
import { errorText } from './util';

export type CreateMode = 'short' | 'long';

/**
 * 「作る」の直下：ショート動画作成／横動画作成の独立した入口（W1・W9）。
 * モード移動は別ワークスペースへの移動で、開いている Project の形式は変えない。
 * 移動前に今のモードを保存し、失敗したら移動せずに再試行できる。
 * 両方のワークスペースはマウントしたまま切り替え、各モードの編集状態を保つ。
 */
export const CreateModes = ({
  mode,
  onModeChange,
  short,
  saveShort,
  openShortProject,
  pauseShort,
}: {
  mode: CreateMode;
  onModeChange: (mode: CreateMode) => void;
  short: ReactNode;
  saveShort: () => Promise<boolean>;
  openShortProject: (id: string) => Promise<void>;
  pauseShort: () => void;
}) => {
  const [visitedLong, setVisitedLong] = useState(mode === 'long');
  const [failed, setFailed] = useState<{ target: CreateMode; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const longProject = useLongStore((state) => state.project);

  useEffect(() => {
    if (mode === 'long') setVisitedLong(true);
  }, [mode]);

  const switchTo = async (target: CreateMode): Promise<void> => {
    if (target === mode || busy) return;
    setBusy(true);
    try {
      const ok = mode === 'short' ? await saveShort() : await saveLongNow();
      if (!ok) {
        const reason = mode === 'long' ? useLongStore.getState().saveError : null;
        setFailed({ target, message: reason ?? '保存先に書き込めませんでした。' });
        return;
      }
      setFailed(null);
      if (mode === 'short') pauseShort();
      onModeChange(target);
      void window.studio.long.setCreateState({ createMode: target });
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (): Promise<void> => {
    try {
      const result = await window.studio.long.openProjectFile();
      if (!result) return;
      // 開く先は、現在のモードではなく保存された制作形式で決める
      if (result.format === 'long') {
        if (mode === 'short' && !(await saveShort())) {
          setFailed({ target: 'long', message: '保存先に書き込めませんでした。' });
          return;
        }
        if (mode === 'long' && !(await saveLongNow())) {
          setFailed({ target: 'long', message: useLongStore.getState().saveError ?? '保存できませんでした。' });
          return;
        }
        const project = await window.studio.long.load(result.id);
        useLongStore.getState().open(project);
        onModeChange('long');
        void window.studio.long.setCreateState({ createMode: 'long', lastLongProjectId: project.id });
      } else {
        if (mode === 'long' && !(await saveLongNow())) {
          setFailed({ target: 'short', message: useLongStore.getState().saveError ?? '保存できませんでした。' });
          return;
        }
        await openShortProject(result.id);
        onModeChange('short');
        void window.studio.long.setCreateState({ createMode: 'short' });
      }
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    }
  };

  return (
    <div className="lv-modes">
      <div className="lv-modebar" role="navigation" aria-label="制作モード">
        <span className="seg">
          <button type="button" aria-pressed={mode === 'short'} onClick={() => void switchTo('short')} disabled={busy}>
            <i className="ratio v" />
            ショート動画作成
          </button>
          <button type="button" aria-pressed={mode === 'long'} onClick={() => void switchTo('long')} disabled={busy}>
            <i className="ratio h" />
            横動画作成
          </button>
        </span>
        {mode === 'short' && longProject ? <span className="hint">横動画側の状態を保持中：{longProject.title}</span> : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="ghost" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => void openFile()}>
          ファイルから開く
        </button>
      </div>
      <div className="lv-mode" hidden={mode !== 'short'}>
        {short}
      </div>
      {visitedLong ? (
        <div className="lv-mode" hidden={mode !== 'long'}>
          <LongModeRoot active={mode === 'long'} />
        </div>
      ) : null}
      {failed ? (
        <div className="lv lv-backdrop" style={{ height: 'auto' }}>
          <div className="lv-dialog" style={{ width: 480 }}>
            <div className="dh">⚠ 保存できませんでした</div>
            <div className="db">
              <p style={{ margin: 0 }}>
                「{failed.target === 'long' ? '横動画作成' : 'ショート動画作成'}」へ移動する前の保存に失敗しました。{failed.message}
              </p>
              <p className="dim" style={{ marginBottom: 0 }}>
                移動はしていません。編集中の内容はこの画面に残っています。Projectの形式も変わっていません。
              </p>
            </div>
            <div className="df">
              <button type="button" onClick={() => setFailed(null)}>
                このまま編集を続ける
              </button>
              <button type="button" className="pri" onClick={() => void switchTo(failed.target)}>
                再試行して移動
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
