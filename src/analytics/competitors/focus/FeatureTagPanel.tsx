import { useMemo, useState } from 'react';
import { FEATURE_TAG_GROUPS } from '../../../../shared/competitor-observation';
import type { FeatureTag } from '../../../../shared/schema/competitor-observation';
import { mutate } from '../api';
import { useCompetitors } from '../state';

/** 特徴タグを分類ごとに並べ、注目動画での出現数を見る。新しいタグもここで作る。 */
export const FeatureTagPanel = ({ tags, focusTotal }: { tags: FeatureTag[]; focusTotal: number }) => {
  const { say } = useCompetitors();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<string>(FEATURE_TAG_GROUPS[0]);
  const [customGroup, setCustomGroup] = useState('');
  const [criteria, setCriteria] = useState('');
  const groups = useMemo(() => {
    const map = new Map<string, FeatureTag[]>();
    for (const tag of tags) map.set(tag.group, [...(map.get(tag.group) ?? []), tag]);
    return [...map.entries()];
  }, [tags]);
  const groupNames = [...new Set([...FEATURE_TAG_GROUPS, ...tags.map((tag) => tag.group)])];

  const add = async () => {
    const finalGroup = group === '__new' ? customGroup.trim() : group;
    if (!name.trim() || !finalGroup) return;
    const result = await mutate(window.studio.saveCompetitorTag({ name, group: finalGroup, criteria }), ['tags']);
    if (!result.ok) {
      say(result.message);
      return;
    }
    setName('');
    setCriteria('');
    setCustomGroup('');
  };

  const archive = async (tag: FeatureTag) => {
    if (!window.confirm(`「${tag.name}」を片付けますか？ 動画に付けた分も外れます。`)) return;
    const result = await mutate(window.studio.archiveCompetitorTag(tag.id), ['tags', 'videos']);
    if (!result.ok) say(result.message);
  };

  return (
    <section className="cp-card is-tight" aria-label="特徴タグ">
      <div className="cp-row" style={{ alignItems: 'baseline' }}>
        <h2 className="cp-h3" style={{ fontSize: 14 }}>
          特徴タグ
        </h2>
        <span className="cp-faint">注目動画での出現 / タグを付けた全体</span>
      </div>
      {groups.length === 0 && <span className="cp-faint">まだタグがありません。</span>}
      {groups.map(([groupName, items]) => (
        <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="cp-faint" style={{ fontWeight: 700 }}>
            {groupName}
          </span>
          {items.map((tag) => (
            <div key={tag.id} className="cp-tag-stat" title={tag.criteria || undefined}>
              <span>{tag.name}</span>
              <span className="cp-bar" aria-hidden="true">
                <span style={{ width: `${focusTotal > 0 ? (tag.focusCount / focusTotal) * 100 : 0}%` }} />
              </span>
              <span className="cp-row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <span style={{ fontSize: 11, color: 'var(--cp-text-2)' }}>
                  {tag.focusCount} / {tag.allCount}
                </span>
                <button
                  type="button"
                  aria-label={`${tag.name} を片付ける`}
                  onClick={() => void archive(tag)}
                  style={{ border: 0, background: 'transparent', color: 'var(--cp-faint)', cursor: 'pointer', padding: 0 }}
                >
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}
      <form
        className="cp-card is-tight is-dashed"
        style={{ gap: 8 }}
        aria-label="特徴を追加"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <strong className="cp-small">特徴を追加</strong>
        <input className="cp-input" value={name} placeholder="例：最初の1秒で結論を言う" aria-label="特徴の名前" onChange={(event) => setName(event.target.value)} />
        <select className="cp-select" value={group} aria-label="分類" onChange={(event) => setGroup(event.target.value)}>
          {groupNames.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
          <option value="__new">+ 分類を作る</option>
        </select>
        {group === '__new' && (
          <input className="cp-input" value={customGroup} placeholder="新しい分類の名前" aria-label="新しい分類の名前" onChange={(event) => setCustomGroup(event.target.value)} />
        )}
        <textarea
          className="cp-textarea"
          rows={2}
          value={criteria}
          placeholder="付ける基準（あとで迷わないように）"
          aria-label="付ける基準"
          onChange={(event) => setCriteria(event.target.value)}
          style={{ fontSize: 12 }}
        />
        <button type="submit" className="cp-btn is-primary is-small" style={{ alignSelf: 'flex-end' }} disabled={!name.trim()}>
          追加
        </button>
      </form>
    </section>
  );
};
