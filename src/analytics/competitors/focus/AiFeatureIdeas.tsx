import { useEffect, useRef, useState } from 'react';
import type { FeatureIdea, FeatureIdeaResult } from '../../../../shared/schema/competitor-observation';
import { mutate } from '../api';
import { useCompetitors } from '../state';
import { FORMAT_LABEL, requestId } from '../ui';

const COMPARE_MAX = 6;

/**
 * 選んだ注目動画について、AI に特徴の候補を挙げてもらう。
 * 送るのは自分で付けたタグ・気づき・形式・注目した理由だけ。採用するまでタグや気づきは変わらない。
 */
export const AiFeatureIdeas = ({
  focusVideoIds,
  channelIds,
  onClose,
}: {
  focusVideoIds: string[];
  channelIds?: string[];
  onClose: () => void;
}) => {
  const { say } = useCompetitors();
  const [result, setResult] = useState<FeatureIdeaResult | null>(null);
  const [ideas, setIdeas] = useState<FeatureIdea[]>([]);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  const run = async () => {
    setRunning(true);
    setError('');
    // 比べる動画：注目していないが、自分のタグか気づきがある動画。
    const pool = await window.studio.competitorVideos({ ...(channelIds ? { channelIds } : {}), limit: 96 });
    const compareVideoIds = pool.ok
      ? pool.data.items
          .filter((item) => !item.focusAt && !focusVideoIds.includes(item.videoId) && (item.tagIds.length > 0 || item.jotCount > 0))
          .slice(0, COMPARE_MAX)
          .map((item) => item.videoId)
      : [];
    const response = await window.studio.competitorFeatureIdeas({ focusVideoIds, compareVideoIds });
    setRunning(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult(response.data);
    setIdeas(response.data.ideas);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, []);

  const adopt = async (idea: FeatureIdea) => {
    const saved = await mutate(window.studio.saveCompetitorTag({ name: idea.name, group: idea.group, criteria: idea.fact || idea.hypothesis }), ['tags']);
    if (!saved.ok) {
      say(saved.message);
      return;
    }
    if (idea.videoIds.length > 0) {
      const assigned = await mutate(
        window.studio.assignCompetitorTag({ videoIds: idea.videoIds, tagId: saved.data.id, origin: 'ai_adopted' }),
        ['tags', 'videos'],
      );
      if (!assigned.ok) {
        say(assigned.message);
        return;
      }
    }
    setIdeas((current) => current.filter((item) => item !== idea));
    say(`「${idea.name}」をタグにして ${idea.videoIds.length} 本に付けました`, 'info');
  };

  const jot = async (idea: FeatureIdea) => {
    const body = [`特徴の候補：${idea.name}`, idea.hypothesis && `仮説：${idea.hypothesis}`, idea.counter && `反例：${idea.counter}`].filter(Boolean).join('\n');
    const saved = await mutate(window.studio.saveCompetitorJot({ clientRequestId: requestId(), channelId: null, videoId: null, body }), ['jots', 'overview']);
    if (!saved.ok) say(saved.message);
    else say('気づきの受け箱に書き留めました', 'info');
  };

  const sent = result?.sent;
  const focusCount = sent?.videos.filter((video) => video.focus).length ?? focusVideoIds.length;
  const compareCount = sent ? sent.videos.length - focusCount : 0;

  return (
    <section aria-label="AIが挙げた特徴の候補" className="cp-card is-info">
      <div className="cp-row">
        <h2 className="cp-h2" style={{ fontSize: 16 }}>
          AI が挙げた特徴の候補
        </h2>
        <span className="cp-chip is-pill is-info">
          注目 {focusCount} 本 ／ 比べる {compareCount} 本
        </span>
        <span className="cp-spacer" />
        <button type="button" className="cp-btn is-small" disabled={running} onClick={() => void run()}>
          もう一度挙げてもらう
        </button>
        <button type="button" className="cp-btn is-small is-quiet" onClick={onClose}>
          閉じる
        </button>
      </div>
      <div className="cp-row cp-faint" style={{ gap: 6 }}>
        <span>送る内容：</span>
        <span className="cp-chip">付けたタグ</span>
        <span className="cp-chip">気づき</span>
        <span className="cp-chip">自分で確認した形式</span>
        <span className="cp-chip">注目した理由</span>
        <span>タイトル・尺・再生数などの YouTube のデータは送りません</span>
      </div>
      {sent && (
        <details>
          <summary className="cp-small cp-muted" style={{ cursor: 'pointer' }}>
            送った内容を見る
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {sent.videos.map((video) => (
              <div key={video.ref} className="cp-small" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--cp-surface-2)' }}>
                <strong>{video.ref}</strong> {video.focus ? '注目' : '比べる'} · 形式 {video.format ? FORMAT_LABEL[video.format] : '未確認'} · タグ {video.tags.join('、') || 'なし'}
                {video.focusReason && <div className="cp-faint">理由：{video.focusReason}</div>}
                {video.jots.map((text, index) => (
                  <div key={index} className="cp-faint">
                    気づき：{text}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
      {running && <p className="cp-loading">Claude に候補を挙げてもらっています…</p>}
      {error && <p className="cp-message">{error}</p>}
      {result && !running && ideas.length === 0 && (
        <p className="cp-small cp-muted">候補はありません。タグや気づきを足すと、材料が増えます。</p>
      )}
      <div className="cp-grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {ideas.map((idea) => (
          <article key={idea.name} className="cp-card is-tight is-sunk">
            <div className="cp-row" style={{ gap: 8 }}>
              <span className="cp-chip">{idea.group}</span>
              <span className="cp-faint">
                注目 {idea.focusHits}/{focusCount} · 比べる {idea.compareHits}/{compareCount}
              </span>
            </div>
            <strong style={{ fontSize: 14, lineHeight: 1.6 }}>{idea.name}</strong>
            <dl className="cp-dl">
              <dt>事実</dt>
              <dd>{idea.fact || '—'}</dd>
              <dt>仮説</dt>
              <dd>{idea.hypothesis || '—'}</dd>
              <dt>反例</dt>
              <dd>{idea.counter || '—'}</dd>
            </dl>
            <div className="cp-row" style={{ gap: 6 }}>
              <button type="button" className="cp-btn is-light is-small" onClick={() => void adopt(idea)}>
                タグとして採用
              </button>
              <button type="button" className="cp-btn is-small" onClick={() => void jot(idea)}>
                気づきに書き留める
              </button>
              <span className="cp-spacer" />
              <button type="button" className="cp-btn is-small is-quiet" onClick={() => setIdeas((current) => current.filter((item) => item !== idea))}>
                見送る
              </button>
            </div>
          </article>
        ))}
      </div>
      <span className="cp-faint">相関の話で、原因は断定していません。採用するまでタグや気づきは変わりません。</span>
    </section>
  );
};
