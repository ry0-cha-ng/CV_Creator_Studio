import { useEffect, useMemo, useState } from 'react';
import { randomId } from '../../shared/long/ids';
import type { AvatarSet, ExpressionMedia, MotionKind, ReactionPreset } from '../../shared/long/schema';
import { secToTicks } from '../../shared/long/time';
import { useStudioStore } from '../store';
import { useLongStore } from './store';
import { errorText, studioUrl } from './util';

export const MOTION_LABEL: Record<MotionKind, string> = {
  none: '静止',
  pop: 'ポップイン',
  bounce: '単発バウンス',
  shake: '震え',
  fade: 'フェード',
};

const firstPath = (media: ExpressionMedia): string => (media.kind === 'still' ? media.path : media.frames[0]!);

const imageSize = (path: string): Promise<{ w: number; h: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight });
    image.onerror = () => reject(new Error('画像を読み込めませんでした'));
    image.src = studioUrl(path);
  });

/**
 * W5：外観セット×表情IDの登録。透明余白は切り取らず、セット共通の原点とサイズで置く。
 * 表情名・セット数はコードに固定しない。
 */
export const AvatarManager = ({ onClose }: { onClose: () => void }) => {
  const project = useLongStore((state) => state.project)!;
  const transact = useLongStore((state) => state.transact);
  const audioTracks = useStudioStore((state) => state.audioTracks).filter((track) => track.kind === 'se');
  const [cycle, setCycle] = useState<string | null>(null);
  const [cycleIndex, setCycleIndex] = useState(0);
  const expressions = project.expressions;

  useEffect(() => {
    if (!cycle) return;
    const timer = window.setInterval(() => setCycleIndex((value) => value + 1), 600);
    return () => window.clearInterval(timer);
  }, [cycle]);

  const updateSet = (setId: string, fn: (set: AvatarSet) => AvatarSet, label = 'アバターの変更'): void =>
    transact(label, (current) => ({ ...current, avatarSets: current.avatarSets.map((set) => (set.id === setId ? fn(set) : set)) }));

  const register = async (set: AvatarSet, expressionId: string, kind: 'still' | 'sequence'): Promise<void> => {
    try {
      const imported =
        kind === 'still' ? await window.studio.long.importImages(project.id, 'avatar') : await window.studio.long.importImageFolder(project.id);
      if (!imported || imported.paths.length === 0) return;
      const media: ExpressionMedia =
        kind === 'still' ? { kind: 'still', path: imported.paths[0]! } : { kind: 'sequence', frames: imported.paths, fps: 25, loop: true };
      const size = await imageSize(imported.paths[0]!);
      const first = Object.keys(set.expressions).length === 0;
      if (!first && (size.w !== set.width || size.h !== set.height)) {
        useLongStore
          .getState()
          .setMessage(`画像の大きさ（${size.w}×${size.h}）がセット（${set.width}×${set.height}）と違います。比率を保って枠に収めます。必要なら原点を補正してください`);
      }
      updateSet(
        set.id,
        (value) => ({
          ...value,
          width: first ? size.w : value.width,
          height: first ? size.h : value.height,
          expressions: { ...value.expressions, [expressionId]: media },
        }),
        '表情の登録',
      );
    } catch (error) {
      useLongStore.getState().setMessage(errorText(error));
    }
  };

  const addSet = (): void =>
    transact('外観セットの追加', (current) => ({
      ...current,
      avatarSets: [
        ...current.avatarSets,
        { id: randomId('avset'), name: current.avatarSets.length === 0 ? '通常の猫' : `セット${current.avatarSets.length + 1}`, width: 768, height: 768, originX: 0.5, originY: 1, expressions: {}, offsets: {} },
      ],
      avatarBase: current.avatarSets.length === 0 ? { ...current.avatarBase, setId: undefined } : current.avatarBase,
    }));

  const missingCount = (set: AvatarSet): number => expressions.filter((item) => !set.expressions[item.id]).length;
  const cycleSet = project.avatarSets.find((set) => set.id === cycle);
  const cycleList = useMemo(() => (cycleSet ? expressions.filter((item) => cycleSet.expressions[item.id]) : []), [cycleSet, expressions]);
  const shown = cycleList.length > 0 ? cycleList[cycleIndex % cycleList.length] : undefined;

  return (
    <div className="lv-backdrop">
      <div className="lv-dialog" style={{ width: 1180 }}>
        <div className="dh">
          アバターの登録
          <span className="sp" />
          <button type="button" className="sm" onClick={addSet}>
            ＋ 外観セットを追加
          </button>
          <button type="button" className="sm ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="db">
          <div className="lv-avgrid">
            <div className="muted">表情ID</div>
            {expressions.map((expression) => (
              <div key={expression.id} style={{ textAlign: 'center' }}>
                <div className="mono dim" style={{ fontSize: 10 }}>
                  {expression.id}
                </div>
                <input
                  value={expression.name}
                  style={{ width: '100%', fontSize: 10.5, padding: '1px 3px', textAlign: 'center' }}
                  onChange={(event) =>
                    transact('表情名の変更', (current) => ({
                      ...current,
                      expressions: current.expressions.map((item) => (item.id === expression.id ? { ...item, name: event.target.value } : item)),
                    }))
                  }
                />
              </div>
            ))}
            {project.avatarSets.map((set) => (
              <FragmentRow key={set.id}>
                <div>
                  <input value={set.name} style={{ width: '100%', fontWeight: 700 }} onChange={(event) => updateSet(set.id, (value) => ({ ...value, name: event.target.value }), 'セット名の変更')} />
                  <div className="dim" style={{ fontSize: 10 }}>
                    {set.width}×{set.height} · 原点 {set.originX.toFixed(2)},{set.originY.toFixed(2)}
                  </div>
                  {missingCount(set) > 0 ? <span className="badge warn">未登録 {missingCount(set)}</span> : <span className="badge ok">全表情登録済み</span>}
                </div>
                {expressions.map((expression) => {
                  const media = set.expressions[expression.id];
                  return media ? (
                    <div
                      key={expression.id}
                      className="lv-avcell"
                      title={`${expression.name}（クリックで差し替え・右クリックで削除）`}
                      style={{ backgroundImage: `url("${studioUrl(firstPath(media))}")` }}
                      onClick={() => void register(set, expression.id, media.kind)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        updateSet(set.id, (value) => {
                          const next = { ...value.expressions };
                          delete next[expression.id];
                          return { ...value, expressions: next };
                        }, '表情の削除');
                      }}
                    >
                      {media.kind === 'sequence' ? <span className="seq">連番{media.frames.length}</span> : null}
                    </div>
                  ) : (
                    <div key={expression.id} className="lv-avcell missing" style={{ flexDirection: 'column', gap: 2 }}>
                      <button type="button" className="sm" style={{ fontSize: 9.5, padding: '0 4px' }} onClick={() => void register(set, expression.id, 'still')}>
                        PNG
                      </button>
                      <button type="button" className="sm" style={{ fontSize: 9.5, padding: '0 4px' }} onClick={() => void register(set, expression.id, 'sequence')}>
                        連番
                      </button>
                    </div>
                  );
                })}
              </FragmentRow>
            ))}
          </div>
          {project.avatarSets.length === 0 ? <p className="muted">「外観セットを追加」から始めます。表情の画像は背景透過のPNG（1枚）か、連番PNGのフォルダを登録できます。</p> : null}

          <div className="grid2" style={{ marginTop: 14, gap: 14 }}>
            <div className="card">
              <h3>原点とプレビュー</h3>
              {project.avatarSets.map((set) => (
                <div key={set.id} className="row wrap" style={{ marginBottom: 6 }}>
                  <b style={{ width: 110 }}>{set.name}</b>
                  原点X
                  <input type="number" step={0.01} min={0} max={1} value={set.originX} style={{ width: 64 }} onChange={(event) => updateSet(set.id, (value) => ({ ...value, originX: Number(event.target.value) }), '原点の補正')} />
                  原点Y
                  <input type="number" step={0.01} min={0} max={1} value={set.originY} style={{ width: 64 }} onChange={(event) => updateSet(set.id, (value) => ({ ...value, originY: Number(event.target.value) }), '原点の補正')} />
                  <button type="button" className="sm" onClick={() => setCycle(cycle === set.id ? null : set.id)}>
                    {cycle === set.id ? '停止' : '一括切替プレビュー ▶'}
                  </button>
                </div>
              ))}
              {cycleSet && shown ? (
                <div style={{ position: 'relative', width: 220, height: 220, background: 'repeating-conic-gradient(#20262e 0 25%, #171b21 0 50%) 0 0/20px 20px', margin: '8px 0' }}>
                  <img
                    src={studioUrl(firstPath(cycleSet.expressions[shown.id]!))}
                    alt=""
                    style={{
                      position: 'absolute',
                      left: 110 - cycleSet.originX * 200 + (cycleSet.offsets[shown.id]?.dx ?? 0) * 200,
                      top: 200 - cycleSet.originY * 200 + (cycleSet.offsets[shown.id]?.dy ?? 0) * 200,
                      width: 200,
                      height: 200,
                      objectFit: 'contain',
                    }}
                  />
                  <div style={{ position: 'absolute', left: 110, top: 0, bottom: 0, width: 1, background: 'rgba(62,199,255,.6)' }} />
                  <div style={{ position: 'absolute', top: 200, left: 0, right: 0, height: 1, background: 'rgba(62,199,255,.6)' }} />
                  <span className="badge" style={{ position: 'absolute', left: 4, top: 4 }}>
                    {shown.id} {shown.name}
                  </span>
                </div>
              ) : null}
              <p className="dim" style={{ fontSize: 11 }}>水色の線が共通の原点です。顔の位置が表情で跳ねないかを確認し、必要な画像だけ補正します。</p>
            </div>
            <div className="card">
              <h3>常時表示と未登録の扱い</h3>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={project.avatarBase.enabled}
                  onChange={(event) => transact('アバターの常時表示', (current) => ({ ...current, avatarBase: { ...current.avatarBase, enabled: event.target.checked } }))}
                />
                通常の表情を常に表示する（オフなら表情イベントの区間だけ表示）
              </label>
              <div className="lv-field">
                <span>セット</span>
                <select value={project.avatarBase.setId ?? ''} onChange={(event) => transact('アバターのセット', (current) => ({ ...current, avatarBase: { ...current.avatarBase, setId: event.target.value || undefined } }))}>
                  <option value="">先頭のセット</option>
                  {project.avatarSets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lv-field">
                <span>通常の表情</span>
                <select value={project.avatarBase.expressionId} onChange={(event) => transact('通常の表情', (current) => ({ ...current, avatarBase: { ...current.avatarBase, expressionId: event.target.value } }))}>
                  {expressions.map((expression) => (
                    <option key={expression.id} value={expression.id}>
                      {expression.id} {expression.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lv-field">
                <span>位置・高さ</span>
                <div className="row">
                  X <input type="number" step={0.01} value={project.avatarBase.x} style={{ width: 60 }} onChange={(event) => transact('アバターの位置', (current) => ({ ...current, avatarBase: { ...current.avatarBase, x: Number(event.target.value) } }))} />
                  Y <input type="number" step={0.01} value={project.avatarBase.y} style={{ width: 60 }} onChange={(event) => transact('アバターの位置', (current) => ({ ...current, avatarBase: { ...current.avatarBase, y: Number(event.target.value) } }))} />
                  高さ <input type="number" step={0.01} value={project.avatarBase.height} style={{ width: 60 }} onChange={(event) => transact('アバターの大きさ', (current) => ({ ...current, avatarBase: { ...current.avatarBase, height: Number(event.target.value) } }))} />
                </div>
              </div>
              <div className="lv-field">
                <span>未登録のとき</span>
                <div className="seg">
                  <button type="button" aria-pressed={project.avatarBase.missing === 'base'} onClick={() => transact('未登録の扱い', (current) => ({ ...current, avatarBase: { ...current.avatarBase, missing: 'base' } }))}>
                    通常の表情へ戻す
                  </button>
                  <button type="button" aria-pressed={project.avatarBase.missing === 'hidden'} onClick={() => transact('未登録の扱い', (current) => ({ ...current, avatarBase: { ...current.avatarBase, missing: 'hidden' } }))}>
                    非表示
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3>
              リアクションプリセット
              <span className="sp" />
              <button
                type="button"
                className="sm"
                onClick={() =>
                  transact('プリセットの追加', (current) => ({
                    ...current,
                    reactionPresets: [
                      ...current.reactionPresets,
                      { id: randomId('rp'), name: '新しいリアクション', expressionId: 'E04', motion: 'bounce', duration: secToTicks(1.5), text: {} } satisfies ReactionPreset,
                    ],
                  }))
                }
              >
                ＋ 追加
              </button>
            </h3>
            <table className="t">
              <thead>
                <tr>
                  <th>名前</th>
                  <th>表情</th>
                  <th>動き</th>
                  <th>秒</th>
                  <th>効果音</th>
                  <th>文字（日）</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {project.reactionPresets.map((preset) => {
                  const patch = (value: Partial<ReactionPreset>): void =>
                    transact('プリセットの変更', (current) => ({
                      ...current,
                      reactionPresets: current.reactionPresets.map((item) => (item.id === preset.id ? { ...item, ...value } : item)),
                    }));
                  return (
                    <tr key={preset.id}>
                      <td>
                        <input value={preset.name} onChange={(event) => patch({ name: event.target.value })} />
                      </td>
                      <td>
                        <select value={preset.expressionId} onChange={(event) => patch({ expressionId: event.target.value })}>
                          {expressions.map((expression) => (
                            <option key={expression.id} value={expression.id}>
                              {expression.id} {expression.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={preset.motion} onChange={(event) => patch({ motion: event.target.value as MotionKind })}>
                          {(Object.keys(MOTION_LABEL) as MotionKind[]).map((motion) => (
                            <option key={motion} value={motion}>
                              {MOTION_LABEL[motion]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="number" step={0.1} min={0.1} style={{ width: 60 }} value={preset.duration / 120_000} onChange={(event) => patch({ duration: Math.max(12_000, secToTicks(Number(event.target.value) || 1)) })} />
                      </td>
                      <td>
                        <select value={preset.seTrackId ?? ''} onChange={(event) => patch({ seTrackId: event.target.value || undefined })}>
                          <option value="">なし</option>
                          {audioTracks.map((track) => (
                            <option key={track.id} value={track.id}>
                              {track.title}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input value={preset.text.ja ?? ''} onChange={(event) => patch({ text: { ...preset.text, ja: event.target.value } })} />
                      </td>
                      <td>
                        <button type="button" className="sm ghost" onClick={() => transact('プリセットの削除', (current) => ({ ...current, reactionPresets: current.reactionPresets.filter((item) => item.id !== preset.id) }))}>
                          削除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="df">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

const FragmentRow = ({ children }: { children: React.ReactNode }) => <>{children}</>;
