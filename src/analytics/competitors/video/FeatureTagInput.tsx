import { useMemo, useState } from 'react';
import { FEATURE_TAG_GROUPS } from '../../../../shared/competitor-observation';
import type { ObservedVideo } from '../../../../shared/schema/competitor-observation';
import { keyOf, mutate, useResource } from '../api';
import { useCompetitors } from '../state';

/** 動画に特徴タグを付け外しする。無い名前を入れたら、その場で新しいタグを作って付ける。 */
export const FeatureTagInput = ({ video }: { video: ObservedVideo }) => {
  const { say, updateVideo } = useCompetitors();
  const tags = useResource(keyOf('tags'), () => window.studio.competitorTags());
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map((tags.data ?? []).map((tag) => [tag.id, tag])), [tags.data]);
  const assigned = video.tagIds.map((id) => byId.get(id)).filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
  const query = text.trim();
  const suggestions = (tags.data ?? []).filter(
    (tag) => !video.tagIds.includes(tag.id) && (!query || tag.name.includes(query) || tag.group.includes(query)),
  );
  const exact = (tags.data ?? []).find((tag) => tag.name === query);

  const assign = async (tagId: string) => {
    const result = await mutate(window.studio.assignCompetitorTag({ videoIds: [video.videoId], tagId }), ['tags', 'videos']);
    if (!result.ok) {
      say(result.message);
      return;
    }
    updateVideo({ ...video, tagIds: [...video.tagIds, tagId] });
    setText('');
    setOpen(false);
  };

  const create = async () => {
    if (!query) return;
    if (exact) {
      await assign(exact.id);
      return;
    }
    const saved = await mutate(window.studio.saveCompetitorTag({ name: query, group: FEATURE_TAG_GROUPS[0] }), ['tags']);
    if (!saved.ok) {
      say(saved.message);
      return;
    }
    await assign(saved.data.id);
  };

  const remove = async (tagId: string) => {
    const result = await mutate(window.studio.unassignCompetitorTag({ videoId: video.videoId, tagId }), ['tags', 'videos']);
    if (!result.ok) say(result.message);
    else updateVideo({ ...video, tagIds: video.tagIds.filter((id) => id !== tagId) });
  };

  return (
    <div className="cp-row" style={{ gap: 6, position: 'relative' }}>
      {assigned.map((tag) => (
        <span key={tag.id} className="cp-chip" style={{ fontSize: 12, padding: '3px 9px' }}>
          {tag.name}
          <button
            type="button"
            aria-label={`${tag.name} を外す`}
            onClick={() => void remove(tag.id)}
            style={{ border: 0, background: 'transparent', color: 'var(--cp-faint)', cursor: 'pointer', padding: '0 0 0 4px' }}
          >
            ×
          </button>
        </span>
      ))}
      <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
        <input
          className="cp-input"
          style={{ height: 30, width: '100%', fontSize: 12 }}
          value={text}
          placeholder="+ タグを付ける・新しく作る"
          aria-label="特徴タグを付ける"
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void create();
            }
          }}
        />
        {open && (suggestions.length > 0 || (query && !exact)) && (
          <div className="cp-popover" role="listbox" aria-label="特徴タグの候補">
            {suggestions.slice(0, 12).map((tag) => (
              <button key={tag.id} type="button" role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => void assign(tag.id)}>
                {tag.name}
                <span className="cp-faint" style={{ marginLeft: 6 }}>
                  {tag.group}
                </span>
              </button>
            ))}
            {query && !exact && (
              <button type="button" role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => void create()}>
                「{query}」を新しいタグにして付ける
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
