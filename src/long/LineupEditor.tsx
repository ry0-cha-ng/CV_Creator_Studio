import { useState } from 'react';
import { randomId } from '../../shared/long/ids';
import type { LongLineup } from '../../shared/long/schema';
import {
  getAbilityOptionLabel,
  getAgentOptionLabel,
  getLineupAbilities,
  getMapOptionLabel,
  getMapSites,
  valorantMaster,
} from '../valorantMaster';
import { useLongStore } from './store';

/** 定点（章ごとに複数参照できる）。短尺の定点データと同じ項目 */
export const LineupEditor = ({ lineup, onClose }: { lineup: LongLineup | null; onClose: () => void }) => {
  const [draft, setDraft] = useState<LongLineup>(
    lineup ?? {
      id: randomId('lineup'),
      title: '',
      map: 'Ascent',
      site: 'A',
      side: 'attack',
      agent: 'Phoenix',
      ability: 'Curveball',
      throwType: { ja: '', en: '' },
      crouch: false,
      standDescription: { ja: '', en: '' },
      aimDescription: { ja: '', en: '' },
    },
  );
  const set = <K extends keyof LongLineup>(key: K, value: LongLineup[K]): void => setDraft((current) => ({ ...current, [key]: value }));
  const usedBy = useLongStore((state) => state.project?.chapters.filter((chapter) => chapter.lineups.some((link) => link.lineupId === draft.id)).length ?? 0);
  return (
    <div className="lv-backdrop">
      <div className="lv-dialog" style={{ width: 560 }}>
        <div className="dh">定点</div>
        <div className="db">
          <div className="lv-field">
            <span>名前</span>
            <input value={draft.title} placeholder="例：B ロング ワンウェイ" onChange={(event) => set('title', event.target.value)} />
          </div>
          <div className="grid2">
            <div className="lv-field">
              <span>マップ</span>
              <select value={draft.map} onChange={(event) => set('map', event.target.value)}>
                {valorantMaster.maps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {getMapOptionLabel(map.id)}
                  </option>
                ))}
              </select>
            </div>
            <div className="lv-field">
              <span>サイト</span>
              <select value={draft.site} onChange={(event) => set('site', event.target.value as LongLineup['site'])}>
                {getMapSites(draft.map).map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
              </select>
            </div>
            <div className="lv-field">
              <span>攻守</span>
              <select value={draft.side} onChange={(event) => set('side', event.target.value as LongLineup['side'])}>
                <option value="attack">攻め</option>
                <option value="defense">守り</option>
              </select>
            </div>
            <div className="lv-field">
              <span>エージェント</span>
              <select
                value={draft.agent}
                onChange={(event) => {
                  const abilities = getLineupAbilities(event.target.value);
                  setDraft((current) => ({ ...current, agent: event.target.value, ability: abilities[0]?.id ?? '' }));
                }}
              >
                {valorantMaster.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {getAgentOptionLabel(agent.id)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="lv-field">
            <span>スキル</span>
            <select value={draft.ability} onChange={(event) => set('ability', event.target.value)}>
              {getLineupAbilities(draft.agent).map((ability) => (
                <option key={ability.id} value={ability.id}>
                  {getAbilityOptionLabel(draft.agent, ability.id)}
                </option>
              ))}
            </select>
          </div>
          <div className="lv-field">
            <span>投げ方</span>
            <input value={draft.throwType.ja} onChange={(event) => set('throwType', { ...draft.throwType, ja: event.target.value })} />
          </div>
          <div className="lv-field">
            <span>立ち位置（日）</span>
            <textarea value={draft.standDescription.ja} onChange={(event) => set('standDescription', { ...draft.standDescription, ja: event.target.value })} />
          </div>
          <div className="lv-field">
            <span>立ち位置（EN）</span>
            <textarea value={draft.standDescription.en} onChange={(event) => set('standDescription', { ...draft.standDescription, en: event.target.value })} />
          </div>
          <div className="lv-field">
            <span>合わせ方（日）</span>
            <textarea value={draft.aimDescription.ja} onChange={(event) => set('aimDescription', { ...draft.aimDescription, ja: event.target.value })} />
          </div>
          <div className="lv-field">
            <span>合わせ方（EN）</span>
            <textarea value={draft.aimDescription.en} onChange={(event) => set('aimDescription', { ...draft.aimDescription, en: event.target.value })} />
          </div>
          {lineup?.importedFrom ? <p className="dim">取り込み元：{lineup.importedFrom.projectTitle}（元のショートが変わっても自動では更新しません）</p> : null}
        </div>
        <div className="df">
          {lineup ? (
            <button
              type="button"
              className="ghost danger"
              style={{ marginRight: 'auto' }}
              onClick={() => {
                useLongStore.getState().transact('定点の削除', (current) => ({
                  ...current,
                  lineups: current.lineups.filter((item) => item.id !== draft.id),
                  chapters: current.chapters.map((chapter) => ({ ...chapter, lineups: chapter.lineups.filter((link) => link.lineupId !== draft.id) })),
                  candidates: current.candidates.map((candidate) => ({ ...candidate, lineupIds: candidate.lineupIds.filter((id) => id !== draft.id) })),
                }));
                onClose();
              }}
            >
              削除{usedBy > 0 ? `（${usedBy}章で使用中）` : ''}
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            閉じる
          </button>
          <button
            type="button"
            className="pri"
            onClick={() => {
              useLongStore.getState().transact('定点の保存', (current) => ({
                ...current,
                lineups: current.lineups.some((item) => item.id === draft.id)
                  ? current.lineups.map((item) => (item.id === draft.id ? draft : item))
                  : [...current.lineups, draft],
              }));
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
