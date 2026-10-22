import { useState } from 'react';
import {
  AI_SENT,
  captionOverflowNotes,
  type AiSuggestion,
  type CaptionCandidate,
  type PublishingCandidate,
} from '../../shared/ai';
import { ACTION_LABELS, HYPOTHESIS_LABELS, comparisonCohort } from '../../shared/analytics';
import { markPublishingEdited } from '../../shared/guide';
import { normalizePublishingDraft } from '../../shared/production';
import type { AnalyticsBundle, AnalyticsPost, AnalysisTask } from '../../shared/schema/analytics';
import { defaultDemoCaption, type Language, type Project } from '../../shared/schema/project';
import { useStudioStore } from '../store';
import { AiAssist } from './AiAssist';

const update = (recipe: (project: Project) => Project): void => {
  useStudioStore.getState().updateProject(recipe);
};

const Counts = ({ suggestion }: { suggestion: AiSuggestion }) => (
  <span className="an-muted">
    参照：投稿{suggestion.sourceCounts.posts}件 · 実験{suggestion.sourceCounts.experiments}件
    {suggestion.disclaimer ? ` · ${suggestion.disclaimer}` : ''}
  </span>
);

const applyCaptions = (candidate: CaptionCandidate): void => {
  update((current) => {
    const rows = [
      ['hook', candidate.hook],
      ['stand', candidate.stand],
      ['throw', candidate.aim],
      ['demo', candidate.demo],
    ] as const;
    for (const [id, text] of rows) {
      if (!text) continue;
      let target = current.captions.find((item) => item.id === id);
      if (!target && id === 'demo') {
        target = defaultDemoCaption();
        current.captions.push(target);
      }
      if (!target) continue;
      target.text = { ...target.text, ja: text.ja, en: text.en };
    }
    return current;
  });
};

const CaptionCard = ({ project, candidate }: { project: Project; candidate: CaptionCandidate }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(candidate);
  const notes = captionOverflowNotes(project, draft);
  const rows = [
    ['HOOK', 'hook', draft.hook],
    ['STAND', 'stand', draft.stand],
    ['AIM', 'aim', draft.aim],
    ['実戦', 'demo', draft.demo],
  ] as const;
  return (
    <article className="ai-card">
      {rows.map(([label, key, text]) =>
        text ? (
          <div key={key}>
            <span className="an-muted">{label}</span>
            {editing ? (
              <div className="ai-edit">
                {(['ja', 'en'] as const).map((language) => (
                  <textarea
                    key={language}
                    aria-label={`${label} ${language}`}
                    value={text[language]}
                    onChange={(event) =>
                      setDraft((current) => {
                        const next = { ...current, [key]: { ...text, [language]: event.target.value } };
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <p>
                {text.ja}
                <br />
                {text.en}
              </p>
            )}
          </div>
        ) : null,
      )}
      {candidate.rationale && <span className="an-muted">{candidate.rationale}</span>}
      {notes.length > 0 && <p className="ai-error">{notes.join(' / ')}。採用後も欄の下で確認できます。</p>}
      <div className="ai-actions">
        <button type="button" className="an-secondary" onClick={() => applyCaptions(draft)}>
          {editing ? 'この内容で採用' : '採用'}
        </button>
        <button type="button" className="an-ghost" onClick={() => setEditing((value) => !value)}>
          {editing ? '編集を閉じる' : '編集して採用'}
        </button>
      </div>
    </article>
  );
};

export const CaptionAi = ({ project }: { project: Project }) => (
  <AiAssist
    help="captions"
    sentHint={AI_SENT.captions}
    withInstruction
    build={(instruction) => ({ kind: 'captions', project, ...(instruction ? { instruction } : {}) })}
    renderSuggestions={(suggestions) => <CandidatePager suggestions={suggestions} project={project} />}
  />
);

const CandidatePager = ({ suggestions, project }: { suggestions: AiSuggestion[]; project: Project }) => {
  const payload = suggestions[0]?.payload;
  const [index, setIndex] = useState(0);
  if (!payload || payload.type !== 'captions') return null;
  const candidate = payload.candidates[index];
  if (!candidate || !suggestions[0]) return null;
  return (
    <div className="ai-stack">
      <Counts suggestion={suggestions[0]} />
      <span className="an-muted">
        {index + 1} / {payload.candidates.length}
      </span>
      <CaptionCard project={project} candidate={candidate} />
      {payload.candidates.length > 1 && (
        <button
          type="button"
          className="an-ghost"
          onClick={() => setIndex((value) => (value + 1) % payload.candidates.length)}
        >
          次の案
        </button>
      )}
    </div>
  );
};

const applyPublishing = (project: Project, candidate: PublishingCandidate): void => {
  const includeKorean = project.guide.exportPresets.includes('yt-global');
  const normalized = normalizePublishingDraft(project, candidate);
  update((current) => {
    let next = current;
    const fields = ['title', 'description', 'hashtags'] as const;
    for (const field of fields) {
      const languages: Array<Language | 'ko'> = includeKorean ? ['ja', 'en', 'ko'] : ['ja', 'en'];
      for (const language of languages) {
        const value = normalized[field][language];
        if (value === undefined) continue;
        next = markPublishingEdited(next, field, language);
        next.publishing[field][language] = value;
      }
    }
    return next;
  });
};

const PublishingCard = ({ project, candidate }: { project: Project; candidate: PublishingCandidate }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => normalizePublishingDraft(project, candidate));
  const includeKorean = project.guide.exportPresets.includes('yt-global');
  const fields = [
    ['title', 'タイトル'],
    ['description', '説明文'],
    ['hashtags', 'ハッシュタグ'],
  ] as const;
  return (
    <article className="ai-card">
      {fields.map(([field, label]) => (
        <div key={field}>
          <span className="an-muted">{label}</span>
          {editing ? (
            <div className="ai-edit">
              {(includeKorean ? (['ja', 'en', 'ko'] as const) : (['ja', 'en'] as const)).map((language) => (
                <textarea
                  key={language}
                  aria-label={`${label} ${language}`}
                  value={draft[field][language] ?? ''}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [field]: { ...current[field], [language]: event.target.value },
                    }))
                  }
                />
              ))}
            </div>
          ) : (
            <p>
              {draft[field].ja}
              <br />
              {draft[field].en}
              {includeKorean && draft[field].ko ? (
                <>
                  <br />
                  {draft[field].ko}
                </>
              ) : null}
            </p>
          )}
        </div>
      ))}
      {candidate.rationale && <span className="an-muted">{candidate.rationale}</span>}
      <div className="ai-actions">
        <button type="button" className="an-secondary" onClick={() => applyPublishing(project, draft)}>
          {editing ? 'この内容で採用' : '採用'}
        </button>
        <button type="button" className="an-ghost" onClick={() => setEditing((value) => !value)}>
          {editing ? '編集を閉じる' : '編集して採用'}
        </button>
      </div>
    </article>
  );
};

export const PublishingAi = ({ project }: { project: Project }) => (
  <AiAssist
    help="publishing"
    sentHint={AI_SENT.publishing}
    withInstruction
    build={(instruction) => ({ kind: 'publishing', project, ...(instruction ? { instruction } : {}) })}
    renderSuggestions={(suggestions) => {
      const payload = suggestions[0]?.payload;
      if (!payload || payload.type !== 'publishing' || !suggestions[0]) return null;
      return <PublishingPager suggestion={suggestions[0]} project={project} />;
    }}
  />
);

const PublishingPager = ({ suggestion, project }: { suggestion: AiSuggestion; project: Project }) => {
  const payload = suggestion.payload;
  const [index, setIndex] = useState(0);
  if (payload.type !== 'publishing') return null;
  const candidate = payload.candidates[index];
  if (!candidate) return null;
  return (
    <div className="ai-stack">
      <Counts suggestion={suggestion} />
      <span className="an-muted">
        {index + 1} / {payload.candidates.length}
      </span>
      <PublishingCard key={index} project={project} candidate={candidate} />
      {payload.candidates.length > 1 && (
        <button type="button" className="an-ghost" onClick={() => setIndex((value) => (value + 1) % payload.candidates.length)}>
          次の案
        </button>
      )}
    </div>
  );
};

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
