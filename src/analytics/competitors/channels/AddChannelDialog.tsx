import { useState } from 'react';
import type { CompetitorPreview } from '../../../../shared/schema/competitor';
import { invalidate } from '../api';
import { useCompetitors } from '../state';

/** URL・@ハンドル・チャンネルIDを1行に1件。確認してから登録する。 */
export const AddChannelDialog = ({ onClose }: { onClose: () => void }) => {
  const { say } = useCompetitors();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<CompetitorPreview | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const check = async () => {
    setBusy(true);
    const result = await window.studio.previewCompetitorRegistration(text);
    setBusy(false);
    if (!result.ok) {
      setNote(result.message);
      return;
    }
    setPreview(result.data);
    setPicked(result.data.rows.filter((row) => row.canSave).map((row) => row.key));
    setNote(
      [result.data.truncated ? '一度に確認できるのは50行までです。' : '', result.data.connected ? '' : 'YouTube未接続です。URLとメモだけで登録できます。']
        .filter(Boolean)
        .join(' '),
    );
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    const result = await window.studio.confirmCompetitorRegistration(preview.previewId, picked);
    setBusy(false);
    if (!result.ok) {
      setNote(result.message);
      return;
    }
    invalidate('overview', 'matrix');
    say(`${result.data.channels.length} チャンネルを登録しました`, 'info');
    onClose();
  };

  return (
    <div className="cp-dialog-layer" role="presentation" onClick={onClose}>
      <section className="cp-dialog" role="dialog" aria-modal="true" aria-label="チャンネルを追加" onClick={(event) => event.stopPropagation()}>
        <div className="cp-row">
          <h2 className="cp-h2">チャンネルを追加</h2>
          <span className="cp-spacer" />
          <button type="button" className="cp-btn is-small" onClick={onClose}>
            閉じる
          </button>
        </div>
        <label className="cp-field">
          チャンネルURL、@ハンドル、チャンネルID。1行に1件
          <textarea className="cp-textarea" rows={5} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="cp-row">
          <button type="button" className="cp-btn" disabled={!text.trim() || busy} onClick={() => void check()}>
            確認する
          </button>
          {note && <span className="cp-small cp-muted">{note}</span>}
        </div>
        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {preview.rows.map((row) => (
              <label key={row.key} className="cp-row" style={{ flexWrap: 'nowrap', padding: '8px 10px', borderRadius: 8, background: 'var(--cp-surface-2)' }}>
                <input
                  type="checkbox"
                  checked={picked.includes(row.key)}
                  disabled={!row.canSave}
                  onChange={(event) =>
                    setPicked((current) => (event.target.checked ? [...current, row.key] : current.filter((key) => key !== row.key)))
                  }
                />
                <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title || row.raw}</span>
                <span className="cp-small cp-muted" style={{ flex: 1 }}>
                  {row.message}
                </span>
              </label>
            ))}
            <div className="cp-row">
              <span className="cp-spacer" />
              <button type="button" className="cp-btn is-primary" disabled={picked.length === 0 || busy} onClick={() => void confirm()}>
                {picked.length} 件を登録する
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
