import { AI_SENT, type AiSuggestion } from '../../shared/ai';
import { ACTION_LABELS, HYPOTHESIS_LABELS, comparisonCohort } from '../../shared/analytics';
import type { AnalyticsBundle, AnalyticsPost, AnalysisTask } from '../../shared/schema/analytics';
import { AiAssist } from './AiAssist';

const Counts = ({ suggestion }: { suggestion: AiSuggestion }) => (
  <span className="an-muted">
    参照：投稿{suggestion.sourceCounts.posts}件 · 実験{suggestion.sourceCounts.experiments}件
    {suggestion.disclaimer ? ` · ${suggestion.disclaimer}` : ''}
  </span>
);

export const SummaryAi = ({ bundle, post }: { bundle: AnalyticsBundle; post: AnalyticsPost }) => (
  <AiAssist
    help="summary"
    sentHint={`この投稿の数字・作り方と、比較${comparisonCohort(bundle, post).count}件の平均（動画は送りません）`}
    build={() => ({ kind: 'summary', bundle, postId: post.id })}
    renderSuggestions={(suggestions) => {
      const suggestion = suggestions[0];
      if (!suggestion || suggestion.payload.type !== 'summary') return null;
      const payload = suggestion.payload;
      return (
        <div className="ai-stack">
          {payload.insufficient && <p>判断材料不足</p>}
          <div>
            <span className="an-muted">良かった点</span>
            <ul>
              {payload.good.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <span className="an-muted">気になる点</span>
            <ul>
              {payload.concerns.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          {suggestion.rationale && <span className="an-muted">{suggestion.rationale}</span>}
          <Counts suggestion={suggestion} />
        </div>
      );
    }}
  />
);

export const HypothesisAi = ({
  bundle,
  post,
  task,
  onChange,
}: {
  bundle: AnalyticsBundle;
  post: AnalyticsPost;
  task: AnalysisTask;
  onChange: (draft: AnalysisTask['draft']) => void;
}) => (
  <AiAssist
    help="hypothesis"
    sentHint={AI_SENT.hypothesis}
    build={() => ({ kind: 'hypothesis', bundle, postId: post.id, draft: task.draft })}
    renderSuggestions={(suggestions) => {
      const suggestion = suggestions[0];
      if (!suggestion || suggestion.payload.type !== 'hypothesis') return null;
      const payload = suggestion.payload;
      return (
        <div className="ai-stack">
          {payload.insufficient && <p>判断材料不足</p>}
          <strong>{HYPOTHESIS_LABELS[payload.judgement]}</strong>
          {suggestion.rationale && <span>{suggestion.rationale}</span>}
          <Counts suggestion={suggestion} />
          <button
            type="button"
            className="an-secondary"
            onClick={() => onChange({ ...task.draft, hypothesis: payload.judgement })}
          >
            この候補を選ぶ
          </button>
        </div>
      );
    }}
  />
);

export const NoticesAi = ({
  bundle,
  post,
  task,
  onChange,
}: {
  bundle: AnalyticsBundle;
  post: AnalyticsPost;
  task: AnalysisTask;
  onChange: (draft: AnalysisTask['draft']) => void;
}) => (
  <AiAssist
    help="notices"
    sentHint={AI_SENT.notices}
    build={() => ({ kind: 'notices', bundle, postId: post.id, draft: task.draft })}
    renderSuggestions={(suggestions) => {
      const suggestion = suggestions[0];
      if (!suggestion || suggestion.payload.type !== 'notices') return null;
      const add = (text: string) => {
        const memo = task.draft.memo.trim() ? `${task.draft.memo.trim()}\n${text}` : text;
        onChange({ ...task.draft, memo });
      };
      return (
        <div className="ai-stack">
          {suggestion.payload.items.map((item) => (
            <div key={`${item.notice}-${item.text}`} className="ai-actions">
              <span>{item.text}</span>
              <button type="button" className="an-secondary" onClick={() => add(item.text)}>
                メモに追加
              </button>
            </div>
          ))}
          <Counts suggestion={suggestion} />
        </div>
      );
    }}
  />
);

export const NextActionAi = ({
  bundle,
  post,
  task,
  onChange,
}: {
  bundle: AnalyticsBundle;
  post: AnalyticsPost;
  task: AnalysisTask;
  onChange: (draft: AnalysisTask['draft']) => void;
}) => (
  <AiAssist
    help="nextAction"
    sentHint={AI_SENT['next-action']}
    build={() => ({ kind: 'next-action', bundle, postId: post.id, draft: task.draft })}
    renderSuggestions={(suggestions) => {
      const suggestion = suggestions[0];
      if (!suggestion || suggestion.payload.type !== 'next-action') return null;
      const payload = suggestion.payload;
      return (
        <div className="ai-stack">
          {payload.insufficient && <p>判断材料不足</p>}
          <strong>{ACTION_LABELS[payload.action]}</strong>
          {suggestion.rationale && <span>{suggestion.rationale}</span>}
          <Counts suggestion={suggestion} />
          <button
            type="button"
            className="an-secondary"
            onClick={() =>
              onChange({
                ...task.draft,
                action: payload.action,
                ...(payload.action === 'continue' ? { continueCount: payload.continueCount ?? task.draft.continueCount } : {}),
              })
            }
          >
            この候補を選ぶ
          </button>
        </div>
      );
    }}
  />
);
