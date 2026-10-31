import { useEffect, useState, type KeyboardEvent } from 'react';
import { applyPublishingMemo } from '../../shared/guide';
import { applyVideoHooks, hookLength, isSpotDetailUrl, prepareXPost, savedReplyVideoUrl, X_HOOK_SOFT_LIMIT } from '../../shared/x-post';
import type { Project } from '../../shared/schema/project';
import { useStudioStore } from '../store';

const update = (recipe: (project: Project) => Project): void => {
  useStudioStore.getState().updateProject(recipe);
};

const blockBreak = (event: KeyboardEvent<HTMLInputElement>): void => {
  if (event.key === 'Enter') event.preventDefault();
};

export const XPostComposer = ({ project }: { project: Project }) => {
  const prepared = prepareXPost(project);
  const xPost = project.publishing.xPost;
  const edited = xPost.jaEdited || xPost.enEdited;
  const published = savedReplyVideoUrl(project);
  const platformLabel = project.guide.xReplyVideo === 'tiktok' ? 'TikTok' : 'YouTube';
  const jaCount = hookLength(xPost.ja);
  const enCount = hookLength(xPost.en);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const writeHook = (language: 'ja' | 'en', value: string): void => {
    update((current) => {
      const normalized = value.replaceAll(/[\r\n]+/g, ' ');
      if (language === 'ja') {
        current.publishing.xPost.ja = normalized;
        current.publishing.xPost.jaEdited = true;
      } else {
        current.publishing.xPost.en = normalized;
        current.publishing.xPost.enEdited = true;
      }
      return current;
    });
  };

  const writeSpot = (value: string): void => {
    update((current) => {
      const trimmed = value.trim();
      if (!trimmed) {
        current.publishing.xPost.spotDraft = '';
        return applyPublishingMemo(current, '');
      }
      if (isSpotDetailUrl(trimmed)) {
        current.publishing.xPost.spotDraft = '';
        return applyPublishingMemo(current, trimmed);
      }
      current.publishing.xPost.spotDraft = value;
      return current;
    });
  };

  const copy = async (): Promise<void> => {
    const latest = useStudioStore.getState().project ?? project;
    const next = prepareXPost(latest);
    if (!next.copyable) return;
    try {
      await navigator.clipboard.writeText(next.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const videoNote = (): string => {
    if (prepared.problems.some((problem) => problem.startsWith('動画URL'))) {
      return prepared.problems.find((problem) => problem.startsWith('動画URL')) ?? '';
    }
    if (!xPost.videoUrlEdited && published) return `${platformLabel} の公開URLを使っています`;
    if (xPost.videoUrlEdited && published) return '手入力のURLを使っています';
    return 'このURLを保存しています';
  };

  return (
    <section className="xpost" aria-label="Xの投稿文">
      <header className="xpost-head">
        <strong>投稿文</strong>
        <span className={prepared.copyable ? 'xpost-status is-ready' : 'xpost-status'}>
          {prepared.copyable ? 'コピーできます' : '未完成'}
        </span>
      </header>
      <p className="xpost-lead">定点の見出し、日英のフック、2つのリンクから組み立てます。末尾は #VAROLANT #定点 です。</p>

      <div className="xpost-hooks">
        <label>
          <span className="xpost-label">
            日本語フック
            <em className={jaCount > X_HOOK_SOFT_LIMIT.ja ? 'is-over' : ''}>
              {jaCount} / {X_HOOK_SOFT_LIMIT.ja}
            </em>
          </span>
          <input
            value={xPost.ja}
            aria-label="日本語フック"
            onKeyDown={blockBreak}
            onChange={(event) => writeHook('ja', event.target.value)}
          />
          {jaCount > X_HOOK_SOFT_LIMIT.ja && <span className="xpost-soft">目安の20文字を超えています</span>}
        </label>
        <label>
          <span className="xpost-label">
            英語フック
            <em className={enCount > X_HOOK_SOFT_LIMIT.en ? 'is-over' : ''}>
              {enCount} / {X_HOOK_SOFT_LIMIT.en}
            </em>
          </span>
          <input
            value={xPost.en}
            aria-label="英語フック"
            onKeyDown={blockBreak}
            onChange={(event) => writeHook('en', event.target.value)}
          />
          {enCount > X_HOOK_SOFT_LIMIT.en && <span className="xpost-soft">目安の60文字を超えています</span>}
        </label>
      </div>
      <div className="xpost-import">
        <button type="button" onClick={() => update(applyVideoHooks)}>
          {edited ? '動画のフックで上書きする' : '動画のフックを取り込む'}
        </button>
        {edited && <span>編集済みの日本語・英語フックは、動画のフックに置き換わります</span>}
      </div>

      <label>
        <span className="xpost-label">定点詳細URL</span>
        <input
          className="xpost-url"
          type="url"
          aria-label="定点詳細URL"
          placeholder="https://gg.clutchvault.app/..."
          value={prepared.spotInput}
          aria-invalid={prepared.problems.some((problem) => problem.includes('定点'))}
          onChange={(event) => writeSpot(event.target.value)}
        />
        {prepared.spotUrl ? (
          <span className="xpost-tracked gd-mono">{prepared.spotUrl}</span>
        ) : (
          <span className="xpost-warn">{prepared.problems.find((problem) => problem.includes('定点'))}</span>
        )}
        <span className="xpost-soft">YouTube と TikTok の説明文も、同じ定点URLを使います</span>
      </label>

      <div className="xpost-video">
        <label>
          <span className="xpost-label">本文に使う動画</span>
          <select
            aria-label="本文に使う動画"
            value={project.guide.xReplyVideo}
            onChange={(event) =>
              update((current) => {
                current.guide.xReplyVideo = event.target.value === 'tiktok' ? 'tiktok' : 'youtube';
                return current;
              })
            }
          >
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
          </select>
        </label>
        <label>
          <span className="xpost-label">動画URL</span>
          <input
            className="xpost-url"
            type="url"
            aria-label="動画URL"
            placeholder="https://"
            value={prepared.videoInput}
            aria-invalid={prepared.problems.some((problem) => problem.startsWith('動画URL'))}
            onChange={(event) =>
              update((current) => {
                current.publishing.xPost.videoUrl = event.target.value;
                current.publishing.xPost.videoUrlEdited = true;
                return current;
              })
            }
          />
          <span className={prepared.problems.some((problem) => problem.startsWith('動画URL')) ? 'xpost-warn' : 'xpost-soft'}>
            {videoNote()}
          </span>
        </label>
        {xPost.videoUrlEdited && published && (
          <button
            type="button"
            onClick={() =>
              update((current) => {
                current.publishing.xPost.videoUrl = '';
                current.publishing.xPost.videoUrlEdited = false;
                return current;
              })
            }
          >
            公開済みのURLを使う
          </button>
        )}
        <span className="xpost-soft">本文に入れる動画URLは1本です。YouTube でも TikTok でも、http または https のURLを保存できます。</span>
      </div>

      <div className="xpost-preview">
        <div className="xpost-countline">
          <strong>プレビュー</strong>
          <span className={prepared.valid ? 'gd-mono' : 'gd-mono is-over'}>
            {prepared.weightedLength} / 280 · 残り {prepared.remaining}
          </span>
        </div>
        <pre>{prepared.text}</pre>
        {prepared.problems.length > 0 && (
          <ul className="xpost-problems">
            {prepared.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <span className="xpost-soft">画像の添付は文字数に含まれません</span>
        <div className="xpost-actions">
          <button type="button" className="pw-primary" disabled={!prepared.copyable} onClick={() => void copy()}>
            投稿文をコピー
          </button>
          <span aria-live="polite">{copied ? 'コピーしました' : ''}</span>
        </div>
      </div>
    </section>
  );
};
