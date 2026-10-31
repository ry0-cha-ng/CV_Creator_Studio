import { useSyncExternalStore } from 'react';
import {
  AI_ERROR_MESSAGE,
  type AiGenerateResult,
  type WordingIdeas as WordingPayload,
} from '../../shared/ai';
import { markPublishingEdited, HOOK_JA_MAX_CHARS, CAPTION_EN_MAX_WORDS } from '../../shared/guide';
import { composePublishingTitle } from '../../shared/production';
import type { Project } from '../../shared/schema/project';
import { AiHelp } from '../ai/AiAssist';
import { useStudioStore } from '../store';
import { patchWordingSession, subscribeWordingSessions, wordingSessionOf } from './wording-session';

const update = (recipe: (project: Project) => Project): void => {
  useStudioStore.getState().updateProject(recipe);
};

const ReadingGloss = ({ text }: { text: string }) =>
  text ? (
    <p className="gd-idea-ja">
      <span>訳</span>
      {text}
    </p>
  ) : null;

const readPayload = (result: AiGenerateResult): WordingPayload | null => {
  if (!result.ok) return null;
  const payload = result.suggestions[0]?.payload;
  return payload?.type === 'wording' ? payload : null;
};

export const WordingIdeas = ({ project }: { project: Project }) => {
  const session = useSyncExternalStore(
    subscribeWordingSessions,
    () => wordingSessionOf(project.id),
    () => wordingSessionOf(project.id),
  );
  const { busy, message, handoff, paste, ideas, picked } = session;
  const suffix = `${project.lineup.map} ${project.lineup.site} ${project.lineup.agent} Lineup #valorant`;
  const wordLimit = CAPTION_EN_MAX_WORDS;
  const patch = (recipe: Parameters<typeof patchWordingSession>[1]): void => {
    patchWordingSession(project.id, recipe);
  };

  const applyResult = (result: AiGenerateResult): void => {
    if (result.ok) {
      const payload = readPayload(result);
      patch(() => ({
        handoff: result.handoff ?? null,
        ideas: payload,
        picked: {},
        message: payload ? null : '自動では返せませんでした。下の文を Claude Code に貼ってください。',
      }));
      window.dispatchEvent(new CustomEvent('cv-ai-status'));
      return;
    }
    patch((current) => ({
      ideas: null,
      handoff: result.handoff ? result.handoff : result.code === 'invalid_output' ? current.handoff : null,
      message: result.message || AI_ERROR_MESSAGE[result.code],
    }));
    window.dispatchEvent(new CustomEvent('cv-ai-status'));
  };

  const generate = async (): Promise<void> => {
    const projectId = project.id;
    patchWordingSession(projectId, () => ({ busy: 'generate', message: null }));
    try {
      applyResult(
        await window.studio.generateAi({
          kind: 'wording',
          project,
          brief: project.guide.wordingBrief,
          tone: project.guide.wordingTone,
        }),
      );
    } catch (error) {
      patchWordingSession(projectId, () => ({
        message: error instanceof Error ? error.message : 'AIを呼び出せませんでした。',
      }));
    } finally {
      patchWordingSession(projectId, () => ({ busy: null }));
    }
  };

  const readPaste = async (): Promise<void> => {
    if (!handoff) return;
    const projectId = project.id;
    const request = {
      kind: handoff.kind,
      text: paste,
      sourceCounts: handoff.sourceCounts,
      sourceRefs: handoff.sourceRefs,
    };
    patchWordingSession(projectId, () => ({ busy: 'read', message: null }));
    try {
      applyResult(await window.studio.parseAiHandoff(request));
    } catch (error) {
      patchWordingSession(projectId, () => ({
        message: error instanceof Error ? error.message : 'JSONを読めませんでした。',
      }));
    } finally {
      patchWordingSession(projectId, () => ({ busy: null }));
    }
  };

  const adoptHook = (index: number, hook: { ja: string; en: string }): void => {
    update((current) => {
      const text = { ja: hook.ja, en: hook.en };
      const captions = current.captions.some((item) => item.id === 'hook')
        ? current.captions.map((item) => (item.id === 'hook' ? { ...item, text } : item))
        : [
            ...current.captions,
            { id: 'hook', sceneKey: 'hook' as const, text, styleId: 'cap.hook' as const },
          ];
      return { ...current, hookPattern: 'custom' as const, captions };
    });
    patch((current) => ({ picked: { ...current.picked, hook: index } }));
  };

  const adoptTitle = (index: number, lead: string): void => {
    update((current) => {
      const titled = {
        ...current,
        publishing: {
          ...current.publishing,
          title: { ...current.publishing.title, en: composePublishingTitle(current, 'en', lead) },
        },
      };
      return markPublishingEdited(titled, 'title', 'en');
    });
    patch((current) => ({ picked: { ...current.picked, title: index } }));
  };

  const adoptComment = (index: number, text: string): void => {
    update((current) => {
      current.publishing.pinnedComment = text;
      return current;
    });
    patch((current) => ({ picked: { ...current.picked, comment: index } }));
  };

  return (
    <section className="gd-ideas" aria-label="フックとタイトルの案">
      <div className="ai-head">
        <strong>フック・タイトル・固定コメント</strong>
        <AiHelp id="wording" />
      </div>
      <span className="gd-muted">
        使うと何が判断でき、何が便利かを、それぞれ5件出します。タイトルは前半だけを作り、｜ 以降は {suffix} を維持します。英語の下の日本語は意味の確認用で、選んでも投稿には入りません。フックは日本語{HOOK_JA_MAX_CHARS}文字・英語{wordLimit}語までです。上限まで埋めなくてよく、超えた文は途中で切りません。
      </span>
      <div className="gd-ideas-fields">
        <label>
          動画の特徴
          <span className="gd-idea-hint">
            使う場面、相手の行動、スキルの効果、そのあと何を判断しやすくなるか、意外さや便利さを書いてください。投げ方や立ち位置が空でも、ここが十分なら案を出せます。
          </span>
          <textarea
            aria-label="動画の特徴"
            placeholder="敵の裏取りで反応する罠を、見落とされやすい位置に設置する。味方がサイト攻略に集中していても、背後の進行に気づく手がかりになる。相手の裏をかく楽しさを伝えたい。"
            value={project.guide.wordingBrief}
            onChange={(event) =>
              update((current) => {
                current.guide.wordingBrief = event.target.value.slice(0, 500);
                return current;
              })
            }
          />
        </label>
        <label>
          ほしい雰囲気
          <span className="gd-idea-hint">口調の指定です。空でも、短く自信のある口調で案を出します。</span>
          <textarea
            aria-label="ほしい雰囲気"
            placeholder="短く自信のある口調。軽い挑発や皮肉は歓迎。説明口調より、次の試合で試したくなる表現。"
            value={project.guide.wordingTone}
            onChange={(event) =>
              update((current) => {
                current.guide.wordingTone = event.target.value.slice(0, 200);
                return current;
              })
            }
          />
        </label>
      </div>
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
            {ideas ? 'もう一度提案する' : '案を出す'}
          </button>
        )}
      </div>
      {message && <p className="ai-error">{message}</p>}
      {ideas && (
        <div className="gd-ideas-grid">
          <div className="gd-ideas-col">
            <span>フック</span>
            {ideas.hooks.map((hook, index) => (
              <article key={`hook-${index}`} className="gd-idea">
                <p>{hook.ja}</p>
                <p className="gd-muted">{hook.en}</p>
                <button type="button" onClick={() => adoptHook(index, hook)}>
                  {picked.hook === index ? 'フックに使用中' : 'フックに使う'}
                </button>
              </article>
            ))}
          </div>
          <div className="gd-ideas-col">
            <span>英語タイトル</span>
            {ideas.titles.map((title, index) => (
              <article key={`title-${index}`} className="gd-idea">
                <p>{composePublishingTitle(project, 'en', title.en)}</p>
                <ReadingGloss text={title.ja} />
                <button type="button" onClick={() => adoptTitle(index, title.en)}>
                  {picked.title === index ? 'タイトルに使用中' : 'タイトルに使う'}
                </button>
              </article>
            ))}
          </div>
          <div className="gd-ideas-col">
            <span>固定コメント</span>
            {ideas.pinnedComments.map((comment, index) => (
              <article key={`comment-${index}`} className="gd-idea">
                <p>{comment.en}</p>
                <ReadingGloss text={comment.ja} />
                <button type="button" onClick={() => adoptComment(index, comment.en)}>
                  {picked.comment === index ? 'コメントに使用中' : 'コメントに使う'}
                </button>
              </article>
            ))}
          </div>
        </div>
      )}
      {handoff && (
        <div className="ai-card">
          <span>Claude Code にこの文を貼り、返ってきたJSONを下に戻します。</span>
          <textarea className="ai-paste" readOnly value={handoff.prompt} aria-label="Claudeに渡す文" />
          <div className="ai-actions">
            <button type="button" className="an-ghost" onClick={() => void navigator.clipboard.writeText(handoff.prompt)}>
              文をコピー
            </button>
          </div>
          <textarea
            className="ai-paste"
            aria-label="Claudeの返答"
            placeholder="返ってきたJSONを貼る"
            value={paste}
            onChange={(event) => patch(() => ({ paste: event.target.value }))}
          />
          <button type="button" className="an-secondary" disabled={busy !== null || !paste.trim()} onClick={() => void readPaste()}>
            このJSONを読む
          </button>
        </div>
      )}
    </section>
  );
};
