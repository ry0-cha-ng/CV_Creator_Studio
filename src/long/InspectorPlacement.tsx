import { useState } from 'react';
import {
  addCutIn,
  addFreeze,
  addSecondary,
  addZoom,
  assignCandidate,
  createReplay,
  removeFreeze,
  removeLayer,
  setPlacementRange,
  setSpeed,
  swapSecondary,
  updatePlacement,
  upsert,
} from '../../shared/long/commands';
import { aspectRatio, OUTPUT_SIZE, applyAspect, zoomPresets, type Size } from '../../shared/long/geometry';
import { randomId } from '../../shared/long/ids';
import type { RenderPlan } from '../../shared/long/render-plan';
import { assetById, type MainPlacement, type MarkerKind, type Placement, type SecondaryGapPolicy, type ZoomPlacement } from '../../shared/long/schema';
import { formatTicks, frameToTicks, secToTicks } from '../../shared/long/time';
import { AspectPicker, Field, NumberInput, RectInputs, Section, Seg } from './fields';
import { TimeInput } from './CandidateEditor';
import { SyncDialog } from './SyncDialog';
import { useLongStore } from './store';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4] as const;

const ROLE_LABEL: Record<string, string> = { game: 'ゲーム音', voice: '本人の声', mixed: '混合', secondary: '副視点', unused: '使わない' };

const MARKER_KINDS: Array<[MarkerKind, string]> = [
  ['highlight', '★ 見せ場'],
  ['sync', '◆ 同期'],
  ['throw', '投擲'],
  ['impact', '着弾'],
  ['kill', 'キル'],
  ['speech', '発話'],
  ['custom', 'メモ'],
];

const sizeOf = (asset: { probe?: { width: number; height: number } } | undefined): Size => ({ w: asset?.probe?.width || 1920, h: asset?.probe?.height || 1080 });

/** 主配置の、出力フレーム f における素材時刻（tick） */
export const sourceTicksAt = (plan: RenderPlan, placementId: string, frame: number): number | null => {
  const layer = plan.layers.find((item) => item.placementId === placementId);
  const piece = layer?.pieces.find((item) => frame >= item.from && frame < item.from + item.duration);
  if (!piece) return null;
  const sourceFrames = piece.kind === 'freeze' ? piece.trimBefore : piece.trimBefore + (frame - piece.from) * piece.speed;
  return frameToTicks(sourceFrames, plan.fps);
};

/** 主配置の、出力フレーム f における配置内の出力時刻（tick） */
const localTicksAt = (plan: RenderPlan, sceneId: string, frame: number): number | null => {
  const scene = plan.scenes.find((item) => item.id === sceneId);
  return scene ? frameToTicks(Math.max(0, frame - scene.from), plan.fps) : null;
};

/** 映像枠（切り抜き・表示枠・比率・収め方・枠線・動き） */
const FrameSection = ({ placement, source }: { placement: Placement; source: Size }) => {
  const transact = useLongStore((state) => state.transact);
  const frameEdit = useLongStore((state) => state.frameEdit);
  const update = (label: string, patch: Partial<Placement>): void => transact(label, (current) => updatePlacement(current, placement.id, patch));
  const cropRatio = placement.cropLocked ? aspectRatio(placement.cropAspect, source) : null;
  const rectRatio = placement.rectLocked ? aspectRatio(placement.rectAspect, source) : null;
  const editing = frameEdit?.placementId === placement.id ? frameEdit : null;
  return (
    <Section title="映像枠" right={<span className="badge">{placement.fit} · {Math.round(placement.rect.w * 1920)}×{Math.round(placement.rect.h * 1080)}</span>}>
      <div className="row wrap" style={{ marginBottom: 6 }}>
        <button type="button" className="sm" aria-pressed={editing?.mode === 'crop' && !editing.end} onClick={() => useLongStore.getState().setFrameEdit(editing?.mode === 'crop' && !editing.end ? null : { placementId: placement.id, mode: 'crop' })}>
          切り抜きを編集
        </button>
        <button type="button" className="sm" aria-pressed={editing?.mode === 'rect' && !editing.end} onClick={() => useLongStore.getState().setFrameEdit(editing?.mode === 'rect' && !editing.end ? null : { placementId: placement.id, mode: 'rect' })}>
          表示枠を編集
        </button>
      </div>
      <Field label="切り抜きの比率">
        <AspectPicker
          value={placement.cropAspect}
          onChange={(aspect) => update('切り抜きの比率', { cropAspect: aspect, cropLocked: aspect !== 'free', crop: applyAspect(placement.crop, aspectRatio(aspect, source), source) })}
        />
      </Field>
      <Field label="切り抜き（素材px）">
        <RectInputs rect={placement.crop} size={source} ratio={cropRatio} onChange={(crop) => update('切り抜き範囲', { crop })} />
      </Field>
      <Field label="表示枠の比率">
        <AspectPicker
          value={placement.rectAspect}
          onChange={(aspect) => update('表示枠の比率', { rectAspect: aspect, rectLocked: aspect !== 'free', rect: applyAspect(placement.rect, aspectRatio(aspect, source), OUTPUT_SIZE) })}
        />
      </Field>
      <Field label="表示枠（出力px）">
        <RectInputs rect={placement.rect} size={OUTPUT_SIZE} ratio={rectRatio} onChange={(rect) => update('表示枠', { rect })} />
      </Field>
      <Field label="収め方">
        <Seg value={placement.fit} options={[['contain', 'contain（全体）'], ['cover', 'cover（満たす）']] as const} onChange={(fit) => update('収め方', { fit })} />
      </Field>
      <Field label="枠線・背景">
        <div className="row wrap">
          <NumberInput value={placement.style.borderWidth} min={0} max={40} step={1} digits={0} width={48} onChange={(value) => update('枠線', { style: { ...placement.style, borderWidth: value } })} />
          <input type="color" value={placement.style.borderColor} onChange={(event) => update('枠線の色', { style: { ...placement.style, borderColor: event.target.value } })} />
          <label className="row" style={{ gap: 3 }}>
            <input type="checkbox" checked={placement.style.background !== null} onChange={(event) => update('余白の背景', { style: { ...placement.style, background: event.target.checked ? '#0F1216' : null } })} />
            背景色
          </label>
          不透明度
          <NumberInput value={placement.style.opacity} min={0} max={1} step={0.05} digits={2} width={52} onChange={(value) => update('不透明度', { style: { ...placement.style, opacity: value } })} />
        </div>
      </Field>
      {placement.role !== 'secondary' ? (
        <>
          <Field label="動き">
            <Seg
              value={placement.motion ? 'move' : 'fixed'}
              options={[['fixed', '固定'], ['move', '開始→終了']] as const}
              onChange={(value) => update('動きの設定', { motion: value === 'move' ? { to: placement.rect, cropTo: placement.crop, easing: 'ease' } : undefined })}
            />
          </Field>
          {placement.motion ? (
            <>
              <Field label="補間">
                <Seg value={placement.motion.easing} options={[['step', '即時'], ['linear', '直線'], ['ease', 'イーズ']] as const} onChange={(easing) => update('補間', { motion: { ...placement.motion!, easing } })} />
              </Field>
              <div className="row wrap">
                <button type="button" className="sm" aria-pressed={editing?.end && editing.mode === 'rect'} onClick={() => useLongStore.getState().setFrameEdit({ placementId: placement.id, mode: 'rect', end: true })}>
                  終了の表示枠を編集
                </button>
                <button type="button" className="sm" aria-pressed={editing?.end && editing.mode === 'crop'} onClick={() => useLongStore.getState().setFrameEdit({ placementId: placement.id, mode: 'crop', end: true })}>
                  終了の切り抜きを編集
                </button>
              </div>
              <p className="dim" style={{ fontSize: 10.5 }}>複数のキーフレームは H2 で対応します。</p>
            </>
          ) : null}
        </>
      ) : null}
    </Section>
  );
};

const MainInspector = ({ placement, plan }: { placement: MainPlacement; plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const frame = useLongStore((state) => state.frame);
  const transact = useLongStore((state) => state.transact);
  const [freezeSec, setFreezeSec] = useState(1);
  const [markerKind, setMarkerKind] = useState<MarkerKind>('highlight');
  const [sync, setSync] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ speed: number; captions: boolean; se: boolean; avatar: boolean; cutin: boolean } | null>(null);
  const asset = assetById(project, placement.assetId);
  const source = sizeOf(asset);
  const scene = project.scenes.find((item) => item.id === placement.sceneId);
  const layers = (scene?.layerIds ?? []).map((id) => project.placements.find((item) => item.id === id)).filter((item): item is Placement => Boolean(item));
  const secondary = layers.find((item) => item.role === 'secondary');
  const zooms = layers.filter((item): item is ZoomPlacement => item.role === 'zoom');
  const now = sourceTicksAt(plan, placement.id, frame);
  const markers = project.markers.filter((marker) => marker.placementId === placement.id);
  const videos = project.assets.filter((item) => item.kind === 'video' && item.id !== placement.assetId);
  const images = project.assets.filter((item) => item.kind === 'image');
  const local = scene ? localTicksAt(plan, scene.id, frame) : null;
  const update = (label: string, patch: Partial<MainPlacement>): void => transact(label, (current) => updatePlacement(current, placement.id, patch));

  return (
    <>
      <div style={{ padding: '8px 12px' }}>
        <div className="row">
          <b>主映像</b>
          <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {scene?.label}
          </span>
          <span className="sp" />
          <span className="dim mono" style={{ fontSize: 10 }}>
            {placement.id}
          </span>
        </div>
        <Field label="素材">
          <select
            value={placement.candidateId ?? ''}
            onChange={(event) => {
              const candidate = project.candidates.find((item) => item.id === event.target.value);
              if (candidate && scene) transact('素材の差し替え', (current) => assignCandidate(current, scene.id, candidate));
            }}
          >
            <option value="">{asset?.name ?? '素材'}（範囲を直接指定）</option>
            {project.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="IN / OUT">
          <div className="grid2">
            <TimeInput value={placement.sourceIn} onChange={(ticks) => transact('IN の変更', (current) => setPlacementRange(current, placement.id, ticks, placement.sourceOut))} />
            <TimeInput value={placement.sourceOut} onChange={(ticks) => transact('OUT の変更', (current) => setPlacementRange(current, placement.id, placement.sourceIn, ticks))} />
          </div>
        </Field>
        <Field label="速度">
          <span className="seg">
            {SPEEDS.map((speed) => (
              <button key={speed} type="button" aria-pressed={placement.speed === speed} onClick={() => transact('速度の変更', (current) => setSpeed(current, placement.id, speed))}>
                {speed}x
              </button>
            ))}
          </span>
        </Field>
        {secondary ? <p className="dim" style={{ fontSize: 10.5, margin: 0 }}>同期中の副視点にも、同じ速度・フリーズ・トリムを適用します。</p> : null}
        <Field label="フリーズ">
          <div>
            {placement.freezes.map((freeze) => (
              <div key={freeze.id} className="row">
                <span className="mono">素材 {formatTicks(freeze.at)}</span>
                <span className="dim">{(freeze.duration / 120_000).toFixed(2)}秒</span>
                <button type="button" className="sm ghost" onClick={() => transact('フリーズの削除', (current) => removeFreeze(current, placement.id, freeze.id))}>
                  削除
                </button>
              </div>
            ))}
            <div className="row">
              <NumberInput value={freezeSec} min={0.05} max={30} step={0.1} digits={2} width={52} onChange={setFreezeSec} />
              秒
              <button type="button" className="sm" disabled={now === null} onClick={() => now !== null && transact('フリーズの追加', (current) => addFreeze(current, placement.id, now, secToTicks(freezeSec)))}>
                ＋ 再生位置に追加
              </button>
            </div>
          </div>
        </Field>
      </div>
      <FrameSection placement={placement} source={source} />
      <Section title="音声ストリーム">
        {(asset?.probe?.audioStreams ?? []).length === 0 ? <span className="dim">音声なし</span> : null}
        {(asset?.probe?.audioStreams ?? []).map((stream) => {
          const use = placement.audio.find((item) => item.audioIndex === stream.audioIndex);
          return (
            <div key={stream.audioIndex} className="row">
              <label className="row" style={{ gap: 4, minWidth: 130 }}>
                <input
                  type="checkbox"
                  checked={Boolean(use && !use.muted)}
                  onChange={(event) =>
                    update('音声ストリームの選択', {
                      audio: use
                        ? placement.audio.map((item) => (item.audioIndex === stream.audioIndex ? { ...item, muted: !event.target.checked } : item))
                        : [...placement.audio, { audioIndex: stream.audioIndex, gainDb: 0, muted: !event.target.checked }],
                    })
                  }
                />
                #{stream.audioIndex} {stream.role ? ROLE_LABEL[stream.role] : stream.title ?? ''}
              </label>
              <NumberInput
                value={use?.gainDb ?? 0}
                min={-60}
                max={24}
                step={0.5}
                digits={1}
                width={56}
                onChange={(value) =>
                  update('音量', {
                    audio: use ? placement.audio.map((item) => (item.audioIndex === stream.audioIndex ? { ...item, gainDb: value } : item)) : [...placement.audio, { audioIndex: stream.audioIndex, gainDb: value, muted: false }],
                  })
                }
              />
              dB
            </div>
          );
        })}
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={placement.muteDuringSlow} onChange={(event) => update('スロー時の原音', { muteDuringSlow: event.target.checked })} />
          スロー中は原音をミュート（フリーズ中は常にミュート）
        </label>
        <Field label="フェード">
          <div className="row">
            in <NumberInput value={placement.fadeIn / 120_000} min={0} max={10} step={0.1} digits={2} width={50} onChange={(value) => update('フェード', { fadeIn: secToTicks(value) })} />
            out <NumberInput value={placement.fadeOut / 120_000} min={0} max={10} step={0.1} digits={2} width={50} onChange={(value) => update('フェード', { fadeOut: secToTicks(value) })} />
          </div>
        </Field>
      </Section>
      <Section title="マーカー（素材時刻）">
        {markers.map((marker) => (
          <div key={marker.id} className="row">
            <span>{MARKER_KINDS.find(([kind]) => kind === marker.kind)?.[1]}</span>
            <span className="mono">{formatTicks(marker.at)}</span>
            <input value={marker.label} style={{ width: 70 }} onChange={(event) => transact('マーカー名', (current) => upsert(current, 'markers', { ...marker, label: event.target.value }))} />
            {marker.needsReview ? (
              <button type="button" className="sm" title="素材の差し替え後に、同じ出来事を指しているか確認してください" onClick={() => transact('マーカーを確認済みにする', (current) => upsert(current, 'markers', { ...marker, needsReview: false }))}>
                要確認→確認済み
              </button>
            ) : null}
            <button type="button" className="sm ghost" onClick={() => transact('マーカーの削除', (current) => ({ ...current, markers: current.markers.filter((item) => item.id !== marker.id) }))}>
              ×
            </button>
          </div>
        ))}
        <div className="row">
          <select value={markerKind} onChange={(event) => setMarkerKind(event.target.value as MarkerKind)}>
            {MARKER_KINDS.map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="sm"
            disabled={now === null}
            onClick={() => now !== null && transact('マーカーの追加', (current) => upsert(current, 'markers', { id: randomId('mk'), kind: markerKind, placementId: placement.id, at: now, label: '', needsReview: false }))}
          >
            ＋ 再生位置
          </button>
        </div>
        {markers.some((marker) => marker.kind === 'highlight') ? (
          <div className="row wrap" style={{ marginTop: 4 }}>
            <span className="muted">予告カットイン</span>
            <select
              value=""
              onChange={(event) => {
                const highlight = markers.find((marker) => marker.kind === 'highlight');
                if (highlight && event.target.value) {
                  transact('予告カットインの追加', (current) => {
                    const added = addCutIn(current, highlight.id, event.target.value);
                    useLongStore.getState().select({ kind: 'overlay', id: added.overlayId });
                    return added.project;
                  });
                }
              }}
            >
              <option value="">画像を選んで追加…</option>
              {images.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </Section>
      <Section title="視点・拡大">
        {secondary ? (
          <div className="row">
            <span className="badge ok">副視点あり</span>
            <button type="button" className="sm" onClick={() => useLongStore.getState().select({ kind: 'placement', id: secondary.id })}>
              副視点の設定
            </button>
          </div>
        ) : (
          <div className="row wrap">
            <select value="" onChange={(event) => event.target.value && setSync(event.target.value)}>
              <option value="">＋ 副視点（PiP）を追加…</option>
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="row wrap" style={{ marginTop: 4 }}>
          {zoomPresets(source).map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="sm"
              onClick={() => {
                const start = local ?? 0;
                const end = Math.min(start + secToTicks(5), scene ? frameToTicks((plan.scenes.find((item) => item.id === scene.id)?.to ?? 0) - (plan.scenes.find((item) => item.id === scene.id)?.from ?? 0), plan.fps) : start + secToTicks(5));
                transact('拡大小窓の追加', (current) => {
                  const added = addZoom(current, placement.id, preset.id, { start, end: Math.max(end, start + 12_000) });
                  useLongStore.getState().select({ kind: 'placement', id: added.placementId });
                  return added.project;
                });
              }}
            >
              ⧉ {preset.label}
            </button>
          ))}
        </div>
        {zooms.map((zoom) => (
          <div key={zoom.id} className="row">
            <span>⧉ 拡大 {formatTicks(zoom.start, false)}–{formatTicks(zoom.end, false)}</span>
            <button type="button" className="sm" onClick={() => useLongStore.getState().select({ kind: 'placement', id: zoom.id })}>
              設定
            </button>
          </div>
        ))}
      </Section>
      <Section title="リプレイ">
        {replay ? (
          <div>
            <Field label="速度">
              <span className="seg">
                {[0.25, 0.5, 1].map((speed) => (
                  <button key={speed} type="button" aria-pressed={replay.speed === speed} onClick={() => setReplay({ ...replay, speed })}>
                    {speed}x
                  </button>
                ))}
              </span>
            </Field>
            <div className="dim" style={{ fontSize: 11 }}>コピーする要素（既定はすべてオフ・原音はミュート）</div>
            {(
              [
                ['captions', '字幕'],
                ['se', '効果音'],
                ['avatar', 'アバターの表情'],
                ['cutin', 'カットイン'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={replay[key]} onChange={(event) => setReplay({ ...replay, [key]: event.target.checked })} />
                {label}
              </label>
            ))}
            <div className="row" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="sm pri"
                onClick={() => {
                  transact('リプレイの作成', (current) => {
                    const created = createReplay(current, placement.sceneId, { speed: replay.speed, copy: replay });
                    useLongStore.getState().select({ kind: 'scene', id: created.sceneId });
                    return created.project;
                  });
                  setReplay(null);
                }}
              >
                作成
              </button>
              <button type="button" className="sm ghost" onClick={() => setReplay(null)}>
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="sm" onClick={() => setReplay({ speed: 0.5, captions: false, se: false, avatar: false, cutin: false })}>
            このシーンからリプレイを作る
          </button>
        )}
      </Section>
      {sync ? (
        <SyncDialog
          mainId={placement.id}
          secondaryAssetId={sync}
          plan={plan}
          onClose={() => setSync(null)}
          onConfirm={(pair) => {
            transact('副視点の追加', (current) => {
              const added = addSecondary(current, placement.id, sync, pair);
              useLongStore.getState().select({ kind: 'placement', id: added.placementId });
              return added.project;
            });
            setSync(null);
          }}
        />
      ) : null}
    </>
  );
};

const SecondaryInspector = ({ placement, plan }: { placement: Placement & { role: 'secondary' }; plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const frame = useLongStore((state) => state.frame);
  const transact = useLongStore((state) => state.transact);
  const [sync, setSync] = useState(false);
  const asset = assetById(project, placement.assetId);
  const group = project.syncGroups.find((item) => item.id === placement.syncGroupId);
  const mainAt = group?.members.find((member) => member.placementId === placement.parentId)?.syncAt;
  const secondaryAt = group?.members.find((member) => member.placementId === placement.id)?.syncAt;
  const update = (label: string, patch: Partial<Placement>): void => transact(label, (current) => updatePlacement(current, placement.id, patch));
  const scene = plan.scenes.find((item) => item.id === placement.sceneId);
  const local = scene ? frameToTicks(Math.max(0, frame - scene.from), plan.fps) : 0;
  return (
    <>
      <div style={{ padding: '8px 12px' }}>
        <div className="row">
          <b>副視点（PiP）</b>
          <span className="muted">{asset?.name}</span>
        </div>
        <Field label="同期">
          <div>
            <span className={`badge ${group?.linked ? 'ok' : 'warn'}`}>{group?.linked ? 'リンク中 ⛓' : 'リンク解除'}</span>
            <div className="mono dim" style={{ fontSize: 11 }}>
              主 {mainAt !== undefined ? formatTicks(mainAt) : '—'} ＝ 副 {secondaryAt !== undefined ? formatTicks(secondaryAt) : '—'}
            </div>
            <div className="row" style={{ marginTop: 3 }}>
              <button type="button" className="sm" onClick={() => setSync(true)}>
                同期点を開く
              </button>
              {group ? (
                <label className="row" style={{ gap: 4 }} title="参考映像・再現など、同じ瞬間ではない映像">
                  <input type="checkbox" checked={group.reference} onChange={(event) => transact('参考映像の指定', (current) => ({ ...current, syncGroups: current.syncGroups.map((item) => (item.id === group.id ? { ...item, reference: event.target.checked } : item)) }))} />
                  参考映像／再現
                </label>
              ) : null}
            </div>
          </div>
        </Field>
        <Field label="レイアウト">
          <Seg
            value={placement.layout}
            options={[['corner', '四隅'], ['free', '自由'], ['split-h', '左右分割'], ['split-v', '上下分割']] as const}
            onChange={(layout) => update('レイアウト', { layout })}
          />
        </Field>
        {placement.layout === 'corner' ? (
          <Field label="位置">
            <Seg value={placement.corner} options={[['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下']] as const} onChange={(corner) => update('PiP の位置', { corner })} />
          </Field>
        ) : null}
        {placement.layout.startsWith('split') ? (
          <Field label="分割比率">
            <div className="row">
              <input type="range" min={0.2} max={0.8} step={0.05} value={placement.splitRatio} onChange={(event) => update('分割比率', { splitRatio: Number(event.target.value) })} />
              <span className="mono">{Math.round(placement.splitRatio * 100)} : {Math.round((1 - placement.splitRatio) * 100)}</span>
            </div>
          </Field>
        ) : null}
        <Field label="表示区間">
          <div>
            {placement.visible.length === 0 ? <span className="dim">シーン全体</span> : null}
            {placement.visible.map((range, index) => (
              <div key={index} className="row">
                <span className="mono">{formatTicks(range.start, false)}–{formatTicks(range.end, false)}</span>
                <button type="button" className="sm ghost" onClick={() => update('表示区間の削除', { visible: placement.visible.filter((_, i) => i !== index) })}>
                  ×
                </button>
              </div>
            ))}
            <div className="row">
              <button type="button" className="sm" onClick={() => update('表示区間の追加', { visible: [...placement.visible, { start: local, end: local + secToTicks(5) }].sort((a, b) => a.start - b.start) })}>
                ＋ 再生位置から5秒
              </button>
              {placement.visible.length > 0 ? (
                <button type="button" className="sm ghost" onClick={() => update('表示区間をシーン全体に', { visible: [] })}>
                  全体に戻す
                </button>
              ) : null}
            </div>
          </div>
        </Field>
        <Field label="視点ラベル">
          <div>
            <label className="row" style={{ gap: 4 }}>
              <input type="checkbox" checked={placement.showLabel} onChange={(event) => update('視点ラベル', { showLabel: event.target.checked })} />
              表示する
            </label>
            {project.output.languages.map((language) => (
              <input key={language} value={placement.label[language] ?? ''} placeholder={language} style={{ width: '100%', marginTop: 2 }} onChange={(event) => update('視点ラベル', { label: { ...placement.label, [language]: event.target.value } })} />
            ))}
          </div>
        </Field>
        <div className="row" style={{ margin: '6px 0' }}>
          <button type="button" onClick={() => transact('主副の入れ替え', (current) => swapSecondary(current, placement.id))}>
            ⇄ 主副を入れ替え
          </button>
          <span className="dim" style={{ fontSize: 10.5 }}>表示枠だけを交換します。同期・切り抜き・音声は変わりません</span>
        </div>
        <Field label="素材が足りない区間">
          <select value={placement.gapPolicy} onChange={(event) => update('副素材不足の扱い', { gapPolicy: event.target.value as SecondaryGapPolicy })}>
            <option value="hide-main-full">非表示＋警告（主映像を全画面へ）</option>
            <option value="hide-keep-layout">非表示（分割配置を維持）</option>
            <option value="hold-last">直前フレームを保持（明示）</option>
          </select>
        </Field>
        <Field label="音声">
          <div>
            {(asset?.probe?.audioStreams ?? []).map((stream) => {
              const use = placement.audio.find((item) => item.audioIndex === stream.audioIndex);
              return (
                <label key={stream.audioIndex} className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(use && !use.muted)}
                    onChange={(event) =>
                      update('副視点の音声', {
                        audio: use
                          ? placement.audio.map((item) => (item.audioIndex === stream.audioIndex ? { ...item, muted: !event.target.checked } : item))
                          : [...placement.audio, { audioIndex: stream.audioIndex, gainDb: 0, muted: !event.target.checked }],
                      })
                    }
                  />
                  #{stream.audioIndex}（既定はミュート）
                </label>
              );
            })}
          </div>
        </Field>
        <button type="button" className="sm ghost danger" onClick={() => { transact('副視点の削除', (current) => removeLayer(current, placement.id)); useLongStore.getState().select({ kind: 'none' }); }}>
          副視点を外す（主映像だけに戻す）
        </button>
      </div>
      <FrameSection placement={placement} source={sizeOf(asset)} />
      {sync && group ? (
        <SyncDialog
          mainId={placement.parentId}
          secondaryAssetId={placement.assetId}
          plan={plan}
          initial={{ mainAt: mainAt ?? 0, secondaryAt: secondaryAt ?? 0 }}
          onClose={() => setSync(false)}
          onConfirm={(pair) => {
            transact('同期点の変更', (current) => ({
              ...current,
              syncGroups: current.syncGroups.map((item) =>
                item.id === group.id
                  ? {
                      ...item,
                      members: item.members.map((member) =>
                        member.placementId === placement.parentId ? { ...member, syncAt: pair.mainAt } : member.placementId === placement.id ? { ...member, syncAt: pair.secondaryAt } : member,
                      ),
                    }
                  : item,
              ),
            }));
            setSync(false);
          }}
        />
      ) : null}
    </>
  );
};

const ZoomInspector = ({ placement, plan }: { placement: ZoomPlacement; plan: RenderPlan }) => {
  const project = useLongStore((state) => state.project)!;
  const frame = useLongStore((state) => state.frame);
  const transact = useLongStore((state) => state.transact);
  const parent = project.placements.find((item) => item.id === placement.parentId);
  const asset = parent && 'assetId' in parent ? assetById(project, parent.assetId) : undefined;
  const source = sizeOf(asset);
  const scene = plan.scenes.find((item) => item.id === placement.sceneId);
  const local = scene ? frameToTicks(Math.max(0, frame - scene.from), plan.fps) : 0;
  const update = (label: string, patch: Partial<ZoomPlacement>): void => transact(label, (current) => updatePlacement(current, placement.id, patch));
  return (
    <>
      <div style={{ padding: '8px 12px' }}>
        <div className="row">
          <b>拡大小窓</b>
          <span className="muted">同じ映像・同じ時刻（音声なし）</span>
        </div>
        <Field label="方式">
          <Seg value={placement.mode} options={[['window', '拡大小窓'], ['fullscreen', '画面切り替え（全画面）']] as const} onChange={(mode) => update('拡大の方式', { mode })} />
        </Field>
        <Field label="プリセット">
          <div>
            {zoomPresets(source).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="chip"
                aria-pressed={placement.preset === preset.id}
                onClick={() => update('プリセット', { preset: preset.id, crop: preset.crop, cropAspect: preset.cropAspect, rect: preset.rect, rectAspect: preset.cropAspect, cropLocked: true, rectLocked: true })}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="表示区間">
          <div className="grid2">
            <TimeInput value={placement.start} onChange={(ticks) => update('表示区間', { start: Math.max(0, ticks) })} />
            <TimeInput value={placement.end} onChange={(ticks) => update('表示区間', { end: Math.max(placement.start + 12_000, ticks) })} />
          </div>
        </Field>
        <div className="row">
          <button type="button" className="sm" onClick={() => update('表示の開始', { start: local, end: Math.max(placement.end, local + 12_000) })}>
            開始を再生位置に
          </button>
          <button type="button" className="sm" onClick={() => update('表示の終了', { end: Math.max(placement.start + 12_000, local) })}>
            終了を再生位置に
          </button>
        </div>
        <button type="button" className="sm ghost danger" style={{ marginTop: 6 }} onClick={() => { transact('拡大小窓の削除', (current) => removeLayer(current, placement.id)); useLongStore.getState().select({ kind: 'none' }); }}>
          拡大小窓を削除
        </button>
      </div>
      <FrameSection placement={placement} source={source} />
    </>
  );
};

export const PlacementInspector = ({ placementId, plan }: { placementId: string; plan: RenderPlan }) => {
  const placement = useLongStore((state) => state.project?.placements.find((item) => item.id === placementId));
  if (!placement) return <p className="muted" style={{ padding: 12 }}>配置が見つかりません</p>;
  if (placement.role === 'main') return <MainInspector placement={placement} plan={plan} />;
  if (placement.role === 'secondary') return <SecondaryInspector placement={placement} plan={plan} />;
  return <ZoomInspector placement={placement} plan={plan} />;
};
