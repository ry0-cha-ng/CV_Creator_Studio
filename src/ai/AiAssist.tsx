import { useState, type ReactNode } from 'react';
import {
  AI_ERROR_MESSAGE,
  AI_HELP,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiHelpId,
  type AiHandoff,
  type AiSuggestion,
} from '../../shared/ai';

export const AiHelp = ({ id }: { id: AiHelpId }) => {
  const [open, setOpen] = useState(false);
  const help = AI_HELP[id];
  return (
    <div className="ai-help">
      <button type="button" className="an-ghost ai-help-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        使い方
      </button>
      {open && (
        <div className="ai-help-pop" role="note">
          <strong>{help.title}</strong>
          <p>{help.summary}</p>
          <ol>
            {help.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>{help.note}</p>
        </div>
      )}
    </div>
  );
};

export const AiAssist = ({
  help,
  sentHint,
  build,
  renderSuggestions,
  withInstruction = false,
}: {
  help: AiHelpId;
  sentHint: string;
  build: (instruction: string) => AiGenerateRequest;
  renderSuggestions: (suggestions: AiSuggestion[]) => ReactNode;
  withInstruction?: boolean;
}) => {
  const [busy, setBusy] = useState<'generate' | 'read' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [sent, setSent] = useState(sentHint);
  const [handoff, setHandoff] = useState<AiHandoff | null>(null);
  const [paste, setPaste] = useState('');
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const copy = AI_HELP[help];

  const applyResult = (result: AiGenerateResult): void => {
    if (result.ok) {
      setSent(result.sentSummary);
      setHandoff(result.handoff ?? null);
      setSuggestions(result.suggestions);
      setMessage(result.suggestions.length === 0 ? '自動では返せませんでした。下の文を Claude Code に貼ってください。' : null);
      window.dispatchEvent(new CustomEvent('cv-ai-status'));
      return;
    }
    setSuggestions([]);
    if (result.handoff) setHandoff(result.handoff);
    else if (result.code !== 'invalid_output') setHandoff(null);
    setMessage(result.message || AI_ERROR_MESSAGE[result.code]);
    window.dispatchEvent(new CustomEvent('cv-ai-status'));
  };

  const generate = async (): Promise<void> => {
    setBusy('generate');
    setMessage(null);
    try {
      applyResult(await window.studio.generateAi(build(withInstruction ? instruction.trim() : '')));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AIを呼び出せませんでした。');
    } finally {
      setBusy(null);
    }
  };

  const readPaste = async (): Promise<void> => {
    if (!handoff) return;
    setBusy('read');
    setMessage(null);
    try {
      applyResult(
        await window.studio.parseAiHandoff({
          kind: handoff.kind,
          text: paste,
          sourceCounts: handoff.sourceCounts,
          sourceRefs: handoff.sourceRefs,
        }),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'JSONを読めませんでした。');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="an-ai-box" aria-busy={busy !== null}>
      <div className="ai-head">
        <strong>{help === 'summary' ? 'AIの要約' : 'AIの候補'}</strong>
        <AiHelp id={help} />
      </div>
      <span>{sent}</span>
      <span className="an-muted">{copy.summary}</span>
      {withInstruction && (
        <label className="ai-field">
          AIへの指示（任意）
          <textarea
            className="ai-paste"
            value={instruction}
            aria-label="AIへの指示"
            placeholder={
              help === 'captions'
                ? '例: 今の日本語テロップを英語にして。英語は1枚4語まで'
                : '例: 今の日本語の説明文を英語に訳して。URLとクローズドβの注意は残す'
            }
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
      )}
      <div className="ai-actions">
        {busy ? (
          <>
            <p className="ai-loading" role="status">
              <span className="ai-spinner" aria-hidden="true" />
              {busy === 'read' ? 'JSONを読んでいます' : '生成しています'}
            </p>
            {busy === 'generate' && (
              <button type="button" className="an-secondary" onClick={() => void window.studio.cancelAi()}>
                中止
              </button>
            )}
          </>
        ) : (
          <button type="button" className="an-secondary" onClick={() => void generate()}>
            {help === 'summary' ? 'AIに要約してもらう' : help === 'captions' || help === 'publishing' ? 'AIで案を作る' : 'AIに候補を出してもらう'}
          </button>
        )}
      </div>
      {message && <p className="ai-error">{message}</p>}
      {suggestions.length > 0 && renderSuggestions(suggestions)}
      {handoff && (
        <div className="ai-card">
          <span>Claude Code にこの文を貼り、返ってきたJSONを下に戻します。</span>
          <textarea className="ai-paste" readOnly value={handoff.prompt} aria-label="Claudeに渡す文" />
          <div className="ai-actions">
            <button
              type="button"
              className="an-ghost"
              onClick={() => void navigator.clipboard.writeText(handoff.prompt)}
            >
              文をコピー
            </button>
          </div>
          <span className="an-muted">ファイル: {handoff.filePath}</span>
          <textarea
            className="ai-paste"
            value={paste}
            aria-label="Claudeから戻ったJSON"
            placeholder="返ってきたJSONを貼る"
            onChange={(event) => setPaste(event.target.value)}
          />
          <button type="button" className="an-secondary" disabled={busy !== null || !paste.trim()} onClick={() => void readPaste()}>
            貼り戻したJSONを読む
          </button>
        </div>
      )}
    </div>
  );
};
