import { useRef, useState } from 'react';
import { mutate } from '../api';
import { useCompetitors } from '../state';
import { Icon, parseClock, requestId } from '../ui';

/** 気づきをすばやく書く。チャンネル・動画は呼び出し側が決め、ここでは本文と秒数だけを受け取る。 */
export const JotComposer = ({
  channelId,
  videoId,
  withClock,
  compact,
  placeholder,
  hint,
}: {
  channelId: string | null;
  videoId: string | null;
  withClock?: boolean;
  compact?: boolean;
  placeholder?: string;
  hint?: string;
}) => {
  const { say } = useCompetitors();
  const [body, setBody] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(requestId());

  const submit = async () => {
    const text = body.trim();
    if (!text || saving) return;
    const atSeconds = withClock ? parseClock(time) : null;
    if (withClock && time.trim() && atSeconds === null) {
      say('秒数は 1:23 のように入れてください');
      return;
    }
    setSaving(true);
    const result = await mutate(
      window.studio.saveCompetitorJot({ clientRequestId: pending.current, channelId, videoId, body: text, atSeconds }),
      ['jots', 'overview', 'videos'],
    );
    setSaving(false);
    if (!result.ok) {
      say(result.message);
      return;
    }
    pending.current = requestId();
    setBody('');
    setTime('');
  };

  if (compact) {
    return (
      <form
        className="cp-row"
        style={{ flexWrap: 'nowrap' }}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          className="cp-input"
          style={{ flex: 1, minWidth: 0 }}
          value={body}
          placeholder={placeholder ?? 'ふと思ったこと'}
          aria-label="気づき"
          onChange={(event) => setBody(event.target.value)}
        />
        <button type="submit" className="cp-btn is-primary is-small" disabled={!body.trim() || saving}>
          書き留める
        </button>
      </form>
    );
  }

  return (
    <div className="cp-card is-tight is-sunk" style={{ background: 'var(--cp-bg)', borderColor: 'var(--cp-line-strong)' }}>
      <label className="cp-h3" htmlFor={`jot-${channelId ?? 'none'}-${videoId ?? 'none'}`}>
        気づき
      </label>
      <textarea
        id={`jot-${channelId ?? 'none'}-${videoId ?? 'none'}`}
        className="cp-textarea"
        rows={3}
        value={body}
        placeholder={placeholder ?? 'ふと思ったことをそのまま。1行でも構いません'}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="cp-row">
        {withClock && (
          <label className="cp-chip is-outline is-pill" style={{ height: 30, gap: 6, padding: '0 10px' }}>
            <Icon name="clock" size={13} />
            <input
              value={time}
              placeholder="0:00"
              aria-label="動画の秒数（任意）"
              onChange={(event) => setTime(event.target.value)}
              style={{ width: 52, border: 0, background: 'transparent', outline: 'none' }}
            />
          </label>
        )}
        {hint && <span className="cp-faint">{hint}</span>}
        <span className="cp-spacer" />
        <span className="cp-faint">Ctrl + Enter</span>
        <button type="button" className="cp-btn is-primary is-small" disabled={!body.trim() || saving} onClick={() => void submit()}>
          書き留める
        </button>
      </div>
    </div>
  );
};
