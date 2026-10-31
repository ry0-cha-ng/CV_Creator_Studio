import { useEffect, useRef, useState } from 'react';
import type { RenderPlan } from '../../shared/long/render-plan';
import { assetById, type MainPlacement } from '../../shared/long/schema';
import { secondarySourceAt } from '../../shared/long/sync';
import { formatTicks, secToTicks, ticksToSec } from '../../shared/long/time';
import { TimeInput } from './CandidateEditor';
import { useLongStore } from './store';
import { studioUrl } from './util';

const Viewer = ({
  title,
  path,
  ticks,
  fps,
  onChange,
  duration,
}: {
  title: string;
  path: string;
  ticks: number;
  fps: number;
  duration: number;
  onChange: (ticks: number) => void;
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && Math.abs(ref.current.currentTime - ticksToSec(ticks)) > 0.001) ref.current.currentTime = ticksToSec(ticks);
  }, [ticks]);
  const step = (frames: number): void => onChange(Math.max(0, Math.min(duration, ticks + Math.round((frames * 120_000) / fps))));
  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <b>{title}</b>
        <span className="dim mono">{fps ? `${Math.round(fps * 100) / 100}fps` : ''}</span>
      </div>
      <video ref={ref} src={studioUrl(path)} muted preload="auto" style={{ width: '100%', aspectRatio: '16/9', background: '#000' }} />
      <input type="range" min={0} max={duration} step={500} value={ticks} onChange={(event) => onChange(Number(event.target.value))} style={{ width: '100%' }} />
      <div className="row">
        <button type="button" className="sm" onClick={() => step(-10)}>
          ◀◀ 10f
        </button>
        <button type="button" className="sm" onClick={() => step(-1)}>
          ◀ 1f
        </button>
        <button type="button" className="sm" onClick={() => step(1)}>
          1f ▶
        </button>
        <button type="button" className="sm" onClick={() => step(10)}>
          10f ▶▶
        </button>
        <TimeInput value={ticks} onChange={onChange} />
      </div>
    </div>
  );
};

/**
 * W4：同じ出来事（投擲・着弾など）のマーカーで2視点を合わせる。
 * 録画の作成日時では同期を確定しない。groupTime = 主の素材時刻 − 主の同期点。
 */
export const SyncDialog = ({
  mainId,
  secondaryAssetId,
  initial,
  onConfirm,
  onClose,
}: {
  mainId: string;
  secondaryAssetId: string;
  plan: RenderPlan;
  initial?: { mainAt: number; secondaryAt: number };
  onConfirm: (pair: { mainAt: number; secondaryAt: number }) => void;
  onClose: () => void;
}) => {
  const project = useLongStore((state) => state.project)!;
  const main = project.placements.find((item): item is MainPlacement => item.id === mainId && item.role === 'main');
  const mainAsset = main ? assetById(project, main.assetId) : undefined;
  const secondaryAsset = assetById(project, secondaryAssetId);
  const syncMarker = project.markers.find((marker) => marker.placementId === mainId && marker.kind === 'sync');
  const [mainAt, setMainAt] = useState(initial?.mainAt ?? syncMarker?.at ?? main?.sourceIn ?? 0);
  const [secondaryAt, setSecondaryAt] = useState(initial?.secondaryAt ?? 0);
  const [checkOffset, setCheckOffset] = useState(10);
  const [viewA, setViewA] = useState(mainAt);
  const [viewB, setViewB] = useState(secondaryAt);
  if (!main || !mainAsset || !secondaryAsset) return null;
  const pair = { mainAt, secondaryAt };
  const plus = secToTicks(1);
  const durationB = secondaryAsset.probe?.durationTicks ?? secToTicks(600);
  const outOfRange = main.sourceIn < pair.mainAt - pair.secondaryAt || main.sourceOut > pair.mainAt - pair.secondaryAt + durationB;
  return (
    <div className="lv-backdrop">
      <div className="lv-dialog" style={{ width: 1100 }}>
        <div className="dh">
          同期点を合わせる
          <span className="dim" style={{ fontWeight: 400 }}>
            同じ投擲・着弾・爆発などのフレームを、両方の映像で表示してください
          </span>
          <span className="sp" />
          <button type="button" className="sm ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="db">
          <div className="grid2" style={{ gap: 14 }}>
            <Viewer title={`A 主：${mainAsset.name}`} path={mainAsset.proxyPath ?? mainAsset.path} ticks={viewA} fps={mainAsset.probe?.fps ?? 60} duration={mainAsset.probe?.durationTicks ?? secToTicks(600)} onChange={setViewA} />
            <Viewer title={`B 副：${secondaryAsset.name}`} path={secondaryAsset.proxyPath ?? secondaryAsset.path} ticks={viewB} fps={secondaryAsset.probe?.fps ?? 60} duration={durationB} onChange={setViewB} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="pri"
              onClick={() => {
                setMainAt(viewA);
                setSecondaryAt(viewB);
              }}
            >
              表示中の2フレームを同期点にする
            </button>
            <button
              type="button"
              onClick={() => {
                setViewA(mainAt);
                setViewB(secondaryAt);
              }}
            >
              同期点を表示
            </button>
            <button type="button" title="A の位置に合わせて、B を同期点どおりに動かします" onClick={() => setViewB(secondarySourceAt(viewA, pair))}>
              B を A に追従
            </button>
          </div>
          <div className="card" style={{ marginTop: 10 }}>
            <div className="mono">
              同期点：A {formatTicks(mainAt)} ＝ B {formatTicks(secondaryAt)}
              <span className="dim">　（共通時刻 +1.000秒 → A {formatTicks(mainAt + plus)} ／ B {formatTicks(secondarySourceAt(mainAt + plus, pair))}）</span>
            </div>
            <div className="dim" style={{ fontSize: 11 }}>
              B を {((mainAt - secondaryAt) / 120_000).toFixed(3)} 秒ずらして重ねます（正の値は B を後ろへ）。
              {syncMarker ? '主映像の「同期」マーカーを初期値にしました。' : ''}
            </div>
            {outOfRange ? <div className="diag warning">主映像の範囲の一部で、副素材が存在しません。その区間は副視点を表示しません（設定で変更できます）。</div> : null}
            <div className="row wrap" style={{ marginTop: 6 }}>
              <span className="muted">後半の同期点を確認</span>
              <input type="number" min={1} max={3600} value={checkOffset} style={{ width: 60 }} onChange={(event) => setCheckOffset(Number(event.target.value) || 10)} />
              秒後
              <button
                type="button"
                className="sm"
                onClick={() => {
                  const target = mainAt + secToTicks(checkOffset);
                  setViewA(target);
                  setViewB(secondarySourceAt(target, pair));
                }}
              >
                両方をその位置へ
              </button>
              <span className="dim" style={{ fontSize: 11 }}>
                ずれていたら、シーンを分割して後半だけ同期し直します（自動補正は H2）。
              </span>
            </div>
          </div>
        </div>
        <div className="df">
          <button type="button" onClick={onClose}>
            閉じる
          </button>
          <button type="button" className="pri" onClick={() => onConfirm(pair)}>
            この同期点で決定
          </button>
        </div>
      </div>
    </div>
  );
};
