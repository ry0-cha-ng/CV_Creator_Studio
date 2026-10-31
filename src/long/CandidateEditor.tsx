import { useEffect, useRef, useState } from 'react';
import { randomId } from '../../shared/long/ids';
import { CANDIDATE_TAGS, type Candidate, type LongAsset, type MarkerKind } from '../../shared/long/schema';
import { formatTicks, parseTimecode, secToTicks, ticksToSec } from '../../shared/long/time';
import { studioUrl } from './util';

const MARKER_LABEL: Record<MarkerKind, string> = {
  highlight: '★ 見せ場',
  sync: '◆ 同期',
  throw: '投擲',
  impact: '着弾',
  kill: 'キル',
  speech: '発話',
  custom: 'メモ',
};

/** 候補区間の作成・編集：非破壊の IN/OUT、名前・タグ・メモ・見せ場マーカー */
export const CandidateEditor = ({
  asset,
  candidate,
  onSave,
  onClose,
  onDelete,
}: {
  asset: LongAsset | undefined;
  candidate?: Candidate;
  onSave: (candidate: Candidate) => void;
  onClose: () => void;
  onDelete?: () => void;
}) => {
  const video = useRef<HTMLVideoElement>(null);
  const duration = asset?.probe?.durationTicks ?? secToTicks(10);
  const fps = asset?.probe?.fps || 60;
  const [now, setNow] = useState(candidate?.in ?? 0);
  const [draft, setDraft] = useState<Candidate>(
    candidate ?? {
      id: randomId('cand'),
      assetId: asset?.id ?? '',
      name: '',
      in: 0,
      out: Math.min(duration, secToTicks(10)),
      tags: [],
      memo: '',
      markers: [],
      lineupIds: [],
    },
  );
  const [markerKind, setMarkerKind] = useState<MarkerKind>('highlight');

  useEffect(() => {
    if (video.current) video.current.currentTime = ticksToSec(now);
  }, []);

  const seek = (ticks: number): void => {
    const clamped = Math.max(0, Math.min(duration, ticks));
    setNow(clamped);
    if (video.current) video.current.currentTime = ticksToSec(clamped);
  };
  const step = (frames: number): void => seek(now + Math.round((frames * 120_000) / fps));
  const invalid = !(draft.out > draft.in) || !draft.assetId;

  if (!asset) return null;
  return (
    <div className="lv-backdrop">
      <div className="lv-dialog" style={{ width: 920 }}>
        <div className="dh">
          候補区間：{asset.name}
          <span className="sp" />
          <button type="button" className="sm ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="db" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14 }}>
          <div>
            <video
              ref={video}
              src={studioUrl(asset.proxyPath ?? asset.path)}
              style={{ width: '100%', aspectRatio: '16/9', background: '#000' }}
              onTimeUpdate={(event) => setNow(secToTicks(event.currentTarget.currentTime))}
              controls={false}
              preload="auto"
            />
            <input
              type="range"
              min={0}
              max={duration}
              step={1000}
              value={now}
              onChange={(event) => seek(Number(event.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ position: 'relative', height: 10, background: 'var(--line2)', borderRadius: 3 }}>
              <div
                style={{
                  position: 'absolute',
                  left: `${(draft.in / duration) * 100}%`,
                  width: `${((draft.out - draft.in) / duration) * 100}%`,
                  top: 0,
                  bottom: 0,
                  background: 'var(--accent)',
                  opacity: 0.7,
                  borderRadius: 3,
                }}
              />
              {draft.markers.map((marker) => (
                <div key={marker.id} title={MARKER_LABEL[marker.kind]} style={{ position: 'absolute', left: `${(marker.ticks / duration) * 100}%`, top: -3, bottom: -3, width: 2, background: 'var(--vol)' }} />
              ))}
            </div>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button type="button" className="sm" onClick={() => step(-1)}>
                ◀ 1f
              </button>
              <button type="button" className="sm" onClick={() => (video.current?.paused ? void video.current.play() : video.current?.pause())}>
                ▶ / ⏸
              </button>
              <button type="button" className="sm" onClick={() => step(1)}>
                1f ▶
              </button>
              <span className="mono">{formatTicks(now)}</span>
              <span className="sp" />
              <button type="button" className="sm" onClick={() => setDraft((value) => ({ ...value, in: now, out: value.out > now ? value.out : Math.min(duration, now + secToTicks(5)) }))}>
                ここを IN
              </button>
              <button type="button" className="sm" onClick={() => setDraft((value) => ({ ...value, out: now }))}>
                ここを OUT
              </button>
            </div>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <select value={markerKind} onChange={(event) => setMarkerKind(event.target.value as MarkerKind)}>
                {(Object.keys(MARKER_LABEL) as MarkerKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {MARKER_LABEL[kind]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sm"
                onClick={() => setDraft((value) => ({ ...value, markers: [...value.markers, { id: randomId('cmk'), kind: markerKind, ticks: now, label: '' }] }))}
              >
                再生位置にマーカー
              </button>
              <span className="dim">見せ場マーカーには予告カットイン・表情・SEを結び付けられます</span>
            </div>
            {draft.markers.length > 0 ? (
              <table className="t" style={{ marginTop: 6 }}>
                <tbody>
                  {draft.markers
                    .slice()
                    .sort((a, b) => a.ticks - b.ticks)
                    .map((marker) => (
                      <tr key={marker.id}>
                        <td>{MARKER_LABEL[marker.kind]}</td>
                        <td className="mono">{formatTicks(marker.ticks)}</td>
                        <td>
                          <input
                            value={marker.label}
                            placeholder="ラベル"
                            onChange={(event) =>
                              setDraft((value) => ({ ...value, markers: value.markers.map((item) => (item.id === marker.id ? { ...item, label: event.target.value } : item)) }))
                            }
                          />
                        </td>
                        <td>
                          <button type="button" className="sm ghost" onClick={() => seek(marker.ticks)}>
                            移動
                          </button>
                          <button
                            type="button"
                            className="sm ghost"
                            onClick={() => setDraft((value) => ({ ...value, markers: value.markers.filter((item) => item.id !== marker.id) }))}
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : null}
          </div>
          <div>
            <div className="lv-field">
              <span>名前</span>
              <input value={draft.name} placeholder="例：B ロング 成功② 2キル" onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} />
            </div>
            <div className="lv-field">
              <span>IN</span>
              <TimeInput value={draft.in} onChange={(ticks) => setDraft((value) => ({ ...value, in: Math.max(0, ticks) }))} />
            </div>
            <div className="lv-field">
              <span>OUT</span>
              <TimeInput value={draft.out} onChange={(ticks) => setDraft((value) => ({ ...value, out: Math.min(duration, ticks) }))} />
            </div>
            <div className="lv-field">
              <span>長さ</span>
              <span className="mono">{formatTicks(Math.max(0, draft.out - draft.in))}</span>
            </div>
            <div className="lv-field wide">
              <span className="muted">タグ</span>
              <div>
                {CANDIDATE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="chip"
                    aria-pressed={draft.tags.includes(tag)}
                    onClick={() => setDraft((value) => ({ ...value, tags: value.tags.includes(tag) ? value.tags.filter((item) => item !== tag) : [...value.tags, tag] }))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <div className="lv-field wide">
              <span className="muted">メモ</span>
              <textarea value={draft.memo} onChange={(event) => setDraft((value) => ({ ...value, memo: event.target.value }))} />
            </div>
            {invalid ? <div className="diag error">OUT は IN より後にしてください</div> : null}
          </div>
        </div>
        <div className="df">
          {onDelete ? (
            <button type="button" className="ghost danger" style={{ marginRight: 'auto' }} onClick={onDelete}>
              候補を削除
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            閉じる
          </button>
          <button type="button" className="pri" disabled={invalid} onClick={() => onSave({ ...draft, name: draft.name.trim() || `${asset.name} ${formatTicks(draft.in, false)}` })}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

/** 時刻の入力（秒 または mm:ss.mmm）。確定時に反映 */
export const TimeInput = ({ value, onChange, allowNegative = false }: { value: number; onChange: (ticks: number) => void; allowNegative?: boolean }) => {
  const [text, setText] = useState(formatTicks(value));
  useEffect(() => setText(formatTicks(value)), [value]);
  const commit = (): void => {
    const parsed = parseTimecode(text.replace('−', '-'));
    if (parsed === null || (!allowNegative && parsed < 0)) {
      setText(formatTicks(value));
      return;
    }
    onChange(parsed);
  };
  return (
    <input
      className="mono"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
};
