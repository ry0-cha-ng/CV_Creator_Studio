import type { PlayerRef } from '@remotion/player';
import { useRef, useState } from 'react';
import { hasErrors } from '../../shared/long/diagnostics';
import { AssetPanel } from './AssetPanel';
import { ExportDialog } from './ExportDialog';
import { Inspector } from './Inspector';
import { LongTimeline } from './LongTimeline';
import { LongPlayerContext } from './player';
import { PreviewPane } from './PreviewPane';
import { Storyboard } from './Storyboard';
import { isDirty, saveLongNow, useLongStore } from './store';
import { useLongPlan } from './util';

/** 横動画の詳細編集（W2） */
export const LongWorkspace = ({ active }: { active: boolean }) => {
  const playerRef = useRef<PlayerRef | null>(null);
  const project = useLongStore((state) => state.project)!;
  const saving = useLongStore((state) => state.saving);
  const dirty = useLongStore((state) => isDirty(state));
  const past = useLongStore((state) => state.past.length);
  const future = useLongStore((state) => state.future.length);
  const { plan } = useLongPlan();
  const [exporting, setExporting] = useState(false);
  if (!plan) return null;
  const errors = hasErrors(plan.diagnostics);
  return (
    <LongPlayerContext.Provider value={playerRef}>
      <div className="lv-top">
        <button
          type="button"
          className="sm ghost"
          title="横動画の一覧へ"
          onClick={() =>
            void saveLongNow().then((ok) => {
              if (ok) useLongStore.getState().open(null);
            })
          }
        >
          ☰ 一覧
        </button>
        <span className="pname">{project.title}</span>
        <span className="badge long">
          横動画 · {plan.width}×{plan.height} · {project.output.fps}fps
        </span>
        <span className={saving || dirty ? 'saving' : 'saved'}>{saving ? '保存中…' : dirty ? '未保存の変更あり' : '● 保存済み'}</span>
        <button type="button" className="sm ghost" title="元に戻す（Ctrl+Z）" disabled={past === 0} onClick={() => useLongStore.getState().undo()}>
          ↶
        </button>
        <button type="button" className="sm ghost" title="やり直す（Ctrl+Shift+Z）" disabled={future === 0} onClick={() => useLongStore.getState().redo()}>
          ↷
        </button>
        <span className="sp" />
        <span className="seg">
          <button
            type="button"
            aria-pressed={false}
            onClick={() => useLongStore.getState().live((current) => ({ ...current, editor: { ...current.editor, mode: 'guide' } }))}
          >
            ガイド作成
          </button>
          <button type="button" aria-pressed>
            詳細編集
          </button>
        </span>
        <button type="button" className="pri" onClick={() => setExporting(true)} title={errors ? '書き出す前に解決が必要な項目があります' : undefined}>
          書き出す（{project.output.languages.map((item) => (item === 'ja' ? '日本語' : item.toUpperCase())).join('・')}）
        </button>
      </div>
      <div className="lv-ws">
        <AssetPanel />
        <div className="lv-center">{active ? <PreviewPane plan={plan} /> : null}</div>
        <Inspector plan={plan} />
        <Storyboard plan={plan} />
        <LongTimeline plan={plan} />
      </div>
      {exporting ? <ExportDialog plan={plan} onClose={() => setExporting(false)} /> : null}
    </LongPlayerContext.Provider>
  );
};
