import { useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addScene,
  assignCandidate,
  createReplay,
  moveTimed,
  rebuildChapter,
  resizeTimed,
  setPlacementRange,
  splitScene,
  updateScene,
  type RebuildDiff,
  type TimedKey,
} from '../../shared/long/commands';
import { resolveAnchor, resolveTimeline, type RenderPlan } from '../../shared/long/render-plan';
import type { LongProject, ShowOrder } from '../../shared/long/schema';
import { SCENE_PURPOSE_LABEL, SHOW_ORDER_LABEL } from '../../shared/long/templates';
import { frameToTicks } from '../../shared/long/time';
import { CANDIDATE_MIME } from './AssetPanel';
import { useLongPlayer } from './player';
import { useLongStore, type Selection } from './store';

type Row = { key: string; code: string; label: string; height: number };

const ROWS: Row[] = [
  { key: 'scene', code: '', label: 'シーン', height: 24 },
  { key: 'captions', code: 'T', label: '字幕・解説', height: 26 },
  { key: 'overlays', code: 'G', label: '図形・カットイン', height: 26 },
  { key: 'avatar', code: 'AV', label: 'アバター', height: 26 },
  { key: 'layers', code: 'V2', label: '副映像・拡大', height: 28 },
  { key: 'main', code: 'V1', label: '主映像', height: 34 },
  { key: 'audio', code: 'A1', label: '原音（ゲーム・声）', height: 26 },
  { key: 'bgm', code: 'A3', label: 'BGM', height: 28 },
  { key: 'se', code: 'A4', label: '効果音', height: 24 },
];

const avatarEventId = (pieceId: string): string => pieceId.slice(0, pieceId.lastIndexOf('-'));

/** 選択章のタイムライン。上端に動画全体の位置を示す帯（W2） */
export const LongTimeline = ({ plan }: { plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const selection = useLongStore((state) => state.selection);
  const frame = useLongStore((state) => state.frame);
  const transact = useLongStore((state) => state.transact);
  const player = useLongPlayer();
  const [zoom, setZoom] = useState(1);
  const [rebuild, setRebuild] = useState<{ order: ShowOrder; diff: RebuildDiff; next: LongProject } | null>(null);
  const lane = useRef<HTMLDivElement>(null);
  const timeline = useMemo(() => resolveTimeline(project), [project]);

  const chapter =
    plan.chapters.find((item) => item.id === project.editor.chapterId) ??
    plan.chapters.find((item) => frame >= item.from && frame < item.to) ??
    plan.chapters[0];
  const source = project.chapters.find((item) => item.id === chapter?.id);
  const from = chapter?.from ?? 0;
  const to = Math.max(from + 1, chapter?.to ?? plan.durationInFrames);
  const span = to - from;
  const pct = (value: number): string => `${((value - from) / span) * 100}%`;
  const width = (a: number, b: number): string => `${(Math.max(0, Math.min(b, to) - Math.max(a, from)) / span) * 100}%`;
  const inside = (a: number, b: number): boolean => b > from && a < to;
  const collapsed = new Set(project.editor.collapsedRows);
  const isSel = (kind: Selection['kind'], id: string): boolean => selection.kind === kind && 'id' in selection && selection.id === id;
  const select = (value: Selection): void => useLongStore.getState().select(value);

  const scenesInChapter = plan.scenes.filter((scene) => scene.chapterId === chapter?.id);
  const sceneAt = scenesInChapter.find((scene) => frame >= scene.from && frame < scene.to);

  const framesPerPixel = (): number => {
    const element = lane.current;
    return element ? span / (element.clientWidth || 1) : 1;
  };

  /** 横方向のドラッグ（移動・端の調整）。1回のドラッグを1件の履歴にまとめる */
  const drag =
    (label: string, apply: (project: LongProject, deltaFrames: number) => LongProject) =>
    (event: ReactPointerEvent) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      const startX = event.clientX;
      const perPixel = framesPerPixel();
      const base = useLongStore.getState().project!;
      let moved = false;
      const move = (moveEvent: PointerEvent): void => {
        const delta = Math.round((moveEvent.clientX - startX) * perPixel);
        if (!moved && Math.abs(moveEvent.clientX - startX) < 3) return;
        if (!moved) useLongStore.getState().beginGesture(label);
        moved = true;
        useLongStore.getState().live(() => apply(base, delta));
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) useLongStore.getState().endGesture();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

  const ticksOf = (frames: number): number => frameToTicks(frames, plan.fps);
  const moveItem = (key: TimedKey, id: string) => drag('タイミングの移動', (base, delta) => moveTimed(base, key, id, ticksOf(delta)));
  const resizeItem = (key: Exclude<TimedKey, 'se'>, id: string, duration: number) =>
    drag('長さの変更', (base, delta) => resizeTimed(base, key, id, duration + ticksOf(delta)));

  const seekFromLane = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    player.seek(from + ratio * span);
  };

  const onDropCandidate = (sceneId: string) => (event: DragEvent) => {
    const candidateId = event.dataTransfer.getData(CANDIDATE_MIME);
    const candidate = project.candidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    event.preventDefault();
    transact('素材の割り当て', (current) => assignCandidate(current, sceneId, candidate));
  };

  const toggleRow = (key: string): void =>
    useLongStore.getState().live((current) => ({
      ...current,
      editor: {
        ...current.editor,
        collapsedRows: current.editor.collapsedRows.includes(key)
          ? current.editor.collapsedRows.filter((item) => item !== key)
          : [...current.editor.collapsedRows, key],
      },
    }));

  const split = (): void => {
    if (!sceneAt) return;
    const scene = project.scenes.find((item) => item.id === sceneAt.id);
    if (scene?.content.kind !== 'placement') {
      useLongStore.getState().setMessage('分割できるのは素材を割り当てたシーンだけです');
      return;
    }
    const local = ticksOf(frame) - ticksOf(sceneAt.from);
    transact('シーンの分割', (current) => splitScene(current, sceneAt.id, local).project);
  };

  const insert = (purpose: 'fail' | 'action' | 'unexpected'): void => {
    if (!source) return;
    const at = sceneAt ? source.sceneIds.indexOf(sceneAt.id) + 1 : source.sceneIds.length;
    transact(purpose === 'action' ? 'シーンの追加' : '失敗・想定外の挿入', (current) => {
      const added = addScene(current, source.id, purpose, { label: purpose === 'fail' ? '失敗（挿入）' : purpose === 'unexpected' ? '想定外（挿入）' : 'シーン', at });
      useLongStore.getState().select({ kind: 'scene', id: added.sceneId });
      return added.project;
    });
  };

  const replay = (): void => {
    if (!sceneAt) return;
    transact('リプレイの作成', (current) => createReplay(current, sceneAt.id).project);
  };

  const markers = project.markers
    .map((marker) => {
      const result = resolveAnchor(project, timeline, { kind: 'source', placementId: marker.placementId, ticks: marker.at });
      return result.ok ? { marker, frame: Math.round((result.ticks * plan.fps) / 120_000) } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && inside(item.frame, item.frame + 1));

  const ticks = useMemo(() => {
    const seconds = span / plan.fps;
    const step = seconds > 120 ? 20 : seconds > 60 ? 10 : seconds > 20 ? 5 : 1;
    const list: number[] = [];
    for (let s = 0; s <= seconds; s += step) list.push(s);
    return list;
  }, [span, plan.fps]);

  if (!chapter) {
    return (
      <div className="lv-tl">
        <div className="lv-tlbar muted">有効な章がありません。ストーリーボードの「＋」から章を追加してください。</div>
      </div>
    );
  }

  const block = (key: string, left: number, right: number, className: string, label: React.ReactNode, onSelect: () => void, selected: boolean, extra?: { onPointerDown?: (event: ReactPointerEvent) => void; title?: string; onDrop?: (event: DragEvent) => void; grip?: (event: ReactPointerEvent) => void }) =>
    inside(left, right) ? (
      <div
        key={key}
        className={`lv-blk ${className} ${selected ? 'sel' : ''}`}
        style={{ left: pct(Math.max(left, from)), width: width(left, right) }}
        title={extra?.title}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerDown={extra?.onPointerDown}
        onDragOver={extra?.onDrop ? (event) => event.preventDefault() : undefined}
        onDrop={extra?.onDrop}
      >
        {label}
        {extra?.grip ? <span className="grip r" onPointerDown={extra.grip} /> : null}
      </div>
    ) : null;

  return (
    <div className="lv-tl">
      <div className="lv-tlbar">
        <b>タイムライン</b>
        <span className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chapter.title || '章'}
        </span>
        <button type="button" className="sm" title="再生位置でシーンを分割（S）" onClick={split}>
          ✂ 分割
        </button>
        <span className="sp" />
        <button type="button" className="sm" onClick={() => insert('action')}>
          ＋ シーン
        </button>
        <button type="button" className="sm" onClick={() => insert('fail')}>
          ＋ 失敗を挿入
        </button>
        <button type="button" className="sm" onClick={() => insert('unexpected')}>
          ＋ 想定外
        </button>
        <button type="button" className="sm" disabled={!sceneAt} onClick={replay}>
          ＋ リプレイ
        </button>
        <span className="muted">ズーム</span>
        <input type="range" min={1} max={8} step={0.5} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} style={{ width: 90 }} />
        {source?.role === 'set' ? (
          <select
            value=""
            onChange={(event) => {
              const order = event.target.value as ShowOrder;
              if (!order) return;
              const result = rebuildChapter(project, source.id, order);
              setRebuild({ order, diff: result.diff, next: result.project });
            }}
          >
            <option value="">章を組み直す…</option>
            {(Object.keys(SHOW_ORDER_LABEL) as ShowOrder[]).map((order) => (
              <option key={order} value={order}>
                {SHOW_ORDER_LABEL[order]}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="lv-trk" style={{ height: 18 }}>
        <div className="th dim">動画全体</div>
        <div className="lv-lane" style={{ display: 'flex', gap: 1, padding: '3px 0', cursor: 'pointer' }}>
          {plan.chapters.map((item) => (
            <i
              key={item.id}
              title={item.title}
              style={{ flex: Math.max(1, item.to - item.from), background: item.id === chapter.id ? 'var(--accent)' : '#2b3a50' }}
              onClick={() => {
                useLongStore.getState().live((current) => ({ ...current, editor: { ...current.editor, chapterId: item.id } }));
                player.seek(item.from);
              }}
            />
          ))}
        </div>
      </div>
      <div className="lv-tracks">
        <div style={{ width: `${zoom * 100}%`, minWidth: '100%', position: 'relative' }}>
          <div className="lv-trk">
            <div className="th" style={{ background: '#12161b' }} />
            <div className="lv-ruler" ref={lane} onClick={seekFromLane}>
              {ticks.map((second) => (
                <span key={second} style={{ left: `${((second * plan.fps) / span) * 100}%` }}>
                  {second}s
                </span>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 150, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
              {inside(frame, frame + 1) ? <div className="lv-playhead" style={{ left: pct(frame) }} /> : null}
              {markers.map(({ marker, frame: at }) => (
                <div key={marker.id} className={`lv-mk ${marker.kind === 'sync' ? 'sync' : ''}`} style={{ left: pct(at) }}>
                  <span>
                    {marker.kind === 'highlight' ? '★' : marker.kind === 'sync' ? '◆' : '•'} {marker.label}
                    {marker.needsReview ? '（要確認）' : ''}
                  </span>
                </div>
              ))}
            </div>
            {ROWS.map((row) => (
              <div key={row.key} className="lv-trk" style={{ height: collapsed.has(row.key) ? 14 : row.height }}>
                <div className="th" onDoubleClick={() => toggleRow(row.key)} title="ダブルクリックで折りたたみ">
                  <b>{row.code}</b>
                  {row.label}
                  <button type="button" className="sm ghost" style={{ marginLeft: 'auto', padding: '0 4px' }} onClick={() => toggleRow(row.key)}>
                    {collapsed.has(row.key) ? '▸' : '▾'}
                  </button>
                </div>
                <div className="lv-lane" onClick={seekFromLane}>
                  {collapsed.has(row.key) ? null : renderRow(row.key)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {rebuild ? (
        <div className="lv-backdrop">
          <div className="lv-dialog" style={{ width: 520 }}>
            <div className="dh">章を組み直す：{SHOW_ORDER_LABEL[rebuild.order]}</div>
            <div className="db">
              <p className="muted" style={{ marginTop: 0 }}>割り当て済みのシーンは役割の順に引き継ぎます。元に戻す（Ctrl+Z）で取り消せます。</p>
              <div>引き継ぐ：{rebuild.diff.kept.map((item) => item.label).join('、') || 'なし'}</div>
              <div>新しく作る枠：{rebuild.diff.added.map((item) => item.label).join('、') || 'なし'}</div>
              {rebuild.diff.removed.length > 0 ? (
                <div className="diag warning">
                  削除されるシーン：{rebuild.diff.removed.map((item) => `${item.label}${item.assigned ? '（割当済み）' : ''}`).join('、')}
                </div>
              ) : null}
            </div>
            <div className="df">
              <button type="button" onClick={() => setRebuild(null)}>
                やめる
              </button>
              <button
                type="button"
                className="pri"
                onClick={() => {
                  transact(`章を組み直す（${SHOW_ORDER_LABEL[rebuild.order]}）`, () => rebuild.next);
                  setRebuild(null);
                }}
              >
                組み直す
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  function renderRow(key: string): React.ReactNode {
    switch (key) {
      case 'scene':
        return scenesInChapter.map((scene) => {
          const data = project.scenes.find((item) => item.id === scene.id);
          return block(
            scene.id,
            scene.from,
            scene.to,
            data?.content.kind === 'empty' ? 'empty' : data?.purpose === 'fail' || data?.purpose === 'unexpected' ? 'c reaction' : 'still',
            `${scene.label || (data ? SCENE_PURPOSE_LABEL[data.purpose] : '')}${data?.content.kind === 'empty' ? '（未割当）' : ''}`,
            () => select({ kind: 'scene', id: scene.id }),
            isSel('scene', scene.id),
            { onDrop: onDropCandidate(scene.id), title: '候補区間をドロップすると割り当てます' },
          );
        });
      case 'captions':
        return plan.captions
          .filter((caption) => !caption.id.startsWith('avatar-text-'))
          .map((caption) => {
            const source = project.captions.find((item) => item.id === caption.id);
            return block(
              caption.id,
              caption.from,
              caption.from + caption.duration,
              `c ${caption.kind}`,
              `${caption.kind === 'speech' ? '発話' : caption.kind === 'explain' ? '解説' : '反応'} ${caption.text}`,
              () => select({ kind: 'caption', id: caption.id }),
              isSel('caption', caption.id),
              {
                onPointerDown: moveItem('captions', caption.id),
                grip: source ? resizeItem('captions', caption.id, source.duration) : undefined,
              },
            );
          });
      case 'overlays':
        return plan.overlays.map((overlay) => {
          const source = project.overlays.find((item) => item.id === overlay.id);
          return block(
            overlay.id,
            overlay.from,
            overlay.from + overlay.duration,
            overlay.kind === 'cutin' ? 'ci' : 'fx',
            overlay.kind === 'cutin' ? '予告' : { arrow: '→ 矢印', rect: '□ 矩形', circle: '○ 円', marker: '◎ マーカー', image: '画像', card: 'カード', cutin: '' }[overlay.kind],
            () => select({ kind: 'overlay', id: overlay.id }),
            isSel('overlay', overlay.id),
            { onPointerDown: moveItem('overlays', overlay.id), grip: source ? resizeItem('overlays', overlay.id, source.duration) : undefined },
          );
        });
      case 'avatar':
        return plan.avatars.map((piece) => {
          const eventId = avatarEventId(piece.id);
          const event = project.avatarEvents.find((item) => item.id === eventId);
          return block(
            piece.id,
            piece.from,
            piece.from + piece.duration,
            event ? 'av' : 'av still',
            event ? `${event.expressionId} ${project.expressions.find((item) => item.id === event.expressionId)?.name ?? ''}` : '通常',
            () => (event ? select({ kind: 'avatar', id: event.id }) : undefined),
            event ? isSel('avatar', event.id) : false,
            event ? { onPointerDown: moveItem('avatarEvents', event.id), grip: resizeItem('avatarEvents', event.id, event.duration) } : undefined,
          );
        });
      case 'layers':
        return plan.layers
          .filter((layer) => layer.role !== 'main' && layer.pieces.length > 0)
          .map((layer) => {
            const a = layer.pieces[0]!.from;
            const b = Math.max(...layer.pieces.map((piece) => piece.from + piece.duration));
            return block(
              layer.id,
              a,
              b,
              layer.role === 'zoom' ? 'zm' : 'v2',
              layer.role === 'zoom' ? '⧉ 拡大小窓' : '⛓ PiP 副視点',
              () => select({ kind: 'placement', id: layer.placementId }),
              isSel('placement', layer.placementId),
            );
          });
      case 'main':
        return [
          ...scenesInChapter.map((scene) => {
            const data = project.scenes.find((item) => item.id === scene.id);
            if (data?.content.kind !== 'placement') {
              const still = plan.stills.find((item) => item.sceneId === scene.id);
              return block(
                `main-${scene.id}`,
                scene.from,
                scene.to,
                still?.placeholder ? 'empty' : 'still',
                still?.placeholder ? '未割当（候補をドロップ）' : '静止画・カード',
                () => select({ kind: 'scene', id: scene.id }),
                isSel('scene', scene.id),
                {
                  onDrop: onDropCandidate(scene.id),
                  grip:
                    data?.content.kind === 'still'
                      ? drag('長さの変更', (base, delta) => {
                          const s = base.scenes.find((item) => item.id === scene.id);
                          if (s?.content.kind !== 'still') return base;
                          return updateScene(base, scene.id, { content: { ...s.content, duration: Math.max(12_000, s.content.duration + ticksOf(delta)) } });
                        })
                      : undefined,
                },
              );
            }
            const placementId = data.content.placementId;
            const placement = project.placements.find((item) => item.id === placementId);
            if (placement?.role !== 'main') return null;
            const candidate = project.candidates.find((item) => item.id === placement.candidateId);
            const asset = project.assets.find((item) => item.id === placement.assetId);
            const linked = project.syncGroups.some((group) => group.members.some((member) => member.placementId === placement.id));
            return block(
              `main-${scene.id}`,
              scene.from,
              scene.to,
              'v',
              <>
                {candidate?.name ?? asset?.name ?? '素材'}
                {placement.speed !== 1 ? <span className="badge" style={{ marginLeft: 3 }}>{placement.speed}x</span> : null}
                {placement.freezes.length > 0 ? <span className="badge" style={{ marginLeft: 3 }}>❄{placement.freezes.length}</span> : null}
                {linked ? <span className="badge" style={{ marginLeft: 3 }}>⛓</span> : null}
              </>,
              () => select({ kind: 'placement', id: placement.id }),
              isSel('placement', placement.id),
              {
                onDrop: onDropCandidate(scene.id),
                title: '右端をドラッグで OUT を調整。候補区間をドロップで差し替え',
                grip: drag('OUT の調整', (base, delta) => {
                  const p = base.placements.find((item) => item.id === placement.id);
                  if (p?.role !== 'main') return base;
                  const out = Math.max(p.sourceIn + 12_000, p.sourceOut + Math.round(ticksOf(delta) * p.speed));
                  return setPlacementRange(base, p.id, p.sourceIn, out);
                }),
              },
            );
          }),
        ];
      case 'audio': {
        const frozen = plan.layers
          .filter((layer) => layer.role === 'main')
          .flatMap((layer) => layer.pieces.filter((piece) => piece.kind === 'freeze'));
        return [
          ...plan.audio.map((piece) =>
            inside(piece.from, piece.from + piece.duration) ? (
              <div key={piece.id} className="lv-wave g" style={{ left: pct(Math.max(piece.from, from)), width: width(piece.from, piece.from + piece.duration), opacity: Math.min(1, 0.4 + piece.gain) }} title="原音" onClick={(event) => { event.stopPropagation(); select({ kind: 'placement', id: piece.placementId }); }} />
            ) : null,
          ),
          ...frozen.map((piece, index) =>
            inside(piece.from, piece.from + piece.duration) ? (
              <div key={`fz-${index}`} className="lv-wave mute" style={{ left: pct(Math.max(piece.from, from)), width: width(piece.from, piece.from + piece.duration) }} title="フリーズ中は原音なし" />
            ) : null,
          ),
        ];
      }
      case 'bgm':
        return [
          ...plan.bgm.map((bgm) =>
            block(
              bgm.id,
              bgm.from,
              bgm.from + bgm.duration,
              'bgm',
              `BGM ${project.bgm.find((item) => item.id === bgm.id)?.chapterId ? '（章）' : '（全体）'}`,
              () => select({ kind: 'bgm', id: bgm.id }),
              isSel('bgm', bgm.id),
            ),
          ),
          ...(plan.bgm[0]?.ducks ?? []).map((duck) => {
            const source = project.ducking.find((item) => item.id === duck.id);
            return source
              ? block(`dk-${source.id}`, duck.from, duck.to, 'dk', '下げ', () => select({ kind: 'ducking', id: source.id }), isSel('ducking', source.id), {
                  onPointerDown: moveItem('ducking', source.id),
                  grip: resizeItem('ducking', source.id, source.duration),
                })
              : null;
          }),
        ];
      case 'se':
        return plan.se.map((se) => {
          const projectSe = project.se.find((item) => item.id === se.id);
          return block(
            se.id,
            se.from,
            se.from + Math.max(se.duration, Math.round(plan.fps * 0.3)),
            'se',
            '♪',
            () => (projectSe ? select({ kind: 'se', id: se.id }) : undefined),
            isSel('se', se.id),
            projectSe ? { onPointerDown: moveItem('se', se.id) } : undefined,
          );
        });
      default:
        return null;
    }
  }
};
