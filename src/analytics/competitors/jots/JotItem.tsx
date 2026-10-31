import { useState } from 'react';
import type { CompetitorJot } from '../../../../shared/schema/competitor-observation';
import { mutate } from '../api';
import { useCompetitors } from '../state';
import { ago, clock } from '../ui';

export const JotItem = ({
  jot,
  selected,
  onSelect,
  showChannel,
}: {
  jot: CompetitorJot;
  selected?: boolean;
  onSelect?: (value: boolean) => void;
  showChannel?: boolean;
}) => {
  const { say } = useCompetitors();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(jot.body);

  const save = async () => {
    const text = body.trim();
    if (!text) return;
    const result = await mutate(
      window.studio.saveCompetitorJot({
        id: jot.id,
        clientRequestId: crypto.randomUUID(),
        channelId: jot.channelId,
        videoId: jot.videoId,
        body: text,
        atSeconds: jot.atSeconds,
      }),
      ['jots'],
    );
    if (!result.ok) say(result.message);
    else setEditing(false);
  };

  const remove = async () => {
    if (!window.confirm('この気づきを削除しますか？')) return;
    const result = await mutate(window.studio.removeCompetitorJot(jot.id), ['jots', 'overview', 'videos']);
    if (!result.ok) say(result.message);
  };

  return (
    <div className="cp-jot">
      {onSelect && (
        <input
          type="checkbox"
          checked={Boolean(selected)}
          disabled={jot.status !== 'open'}
          aria-label="仮説検証へ渡す気づきとして選ぶ"
          onChange={(event) => onSelect(event.target.checked)}
          style={{ marginTop: 4, accentColor: 'var(--cp-info)' }}
        />
      )}
      <div className="cp-jot-body">
        {editing ? (
          <>
            <textarea className="cp-textarea" rows={3} value={body} aria-label="気づきを直す" onChange={(event) => setBody(event.target.value)} />
            <div className="cp-row">
              <button type="button" className="cp-btn is-primary is-small" onClick={() => void save()}>
                保存
              </button>
              <button
                type="button"
                className="cp-btn is-small"
                onClick={() => {
                  setBody(jot.body);
                  setEditing(false);
                }}
              >
                やめる
              </button>
            </div>
          </>
        ) : (
          <span className="cp-jot-text">{jot.body}</span>
        )}
        <div className="cp-row" style={{ gap: 6 }}>
          {showChannel && <span className="cp-faint">{jot.channelLabel ?? 'チャンネルなし'}{jot.videoId ? ' · 動画' : jot.channelId ? ' · チャンネル全体' : ''}</span>}
          {jot.atSeconds !== null && <span className="cp-chip">{clock(jot.atSeconds)}</span>}
          <span className="cp-faint">{ago(jot.updatedAt)}</span>
          <span className={`cp-chip is-pill${jot.status === 'handed_off' ? ' is-info' : ''}`}>
            {jot.status === 'handed_off' ? '仮説検証へ渡した' : '未整理'}
          </span>
          <span className="cp-spacer" />
          {!editing && (
            <>
              <button type="button" className="cp-link" onClick={() => setEditing(true)}>
                直す
              </button>
              <button type="button" className="cp-link" style={{ color: 'var(--cp-faint)' }} onClick={() => void remove()}>
                削除
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
