import { useEffect, useRef, useState } from 'react';
import type { RenderPlan } from '../../shared/long/render-plan';
import { assetById, type AudioStreamInfo, type LongAsset, type MainPlacement } from '../../shared/long/schema';
import { secondarySourceAt } from '../../shared/long/sync';
import { formatTicks, secToTicks, ticksToSec } from '../../shared/long/time';
import { TimeInput } from './CandidateEditor';
import { useLongStore } from './store';
import { errorText, studioUrl } from './util';

const WAVE_HALF = secToTicks(2);
const WAVE_BUCKETS = 400;

/** 波形に使う音声：ゲーム音 → 混合 → 副視点 → それ以外の順（使わないものは除く） */
export const waveformStream = (asset: LongAsset | undefined): AudioStreamInfo | undefined => {
  const streams = (asset?.probe?.audioStreams ?? []).filter((stream) => stream.extractedPath && stream.role !== 'unused');
  const order = ['game', 'mixed', 'secondary', 'voice'];
  const rank = (role: string | undefined): number => {
    const index = order.indexOf(role ?? '');
    return index < 0 ? order.length : index;
  };
  return [...streams].sort((a, b) => rank(a.role) - rank(b.role) || a.audioIndex - b.audioIndex)[0];
};

/**
 * 再生位置の前後2秒の波形。中央の線が表示中のフレーム、黄色の線が同期点。
 * クリックでその位置へ移動する。投擲音・着弾音などの立ち上がりを両方で揃える目安にする。
 */
const Waveform = ({
  asset,
  ticks,
  syncAt,
  duration,
  onChange,
}: {
  asset: LongAsset | undefined;
  ticks: number;
  syncAt: number;
  duration: number;
  onChange: (ticks: number) => void;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = waveformStream(asset);
  const [peaks, setPeaks] = useState<{ from: number; values: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 表示位置が動いたら、少し待ってから読み直す（フレーム送りの連打で ffmpeg を何度も起動しない）
  useEffect(() => {
    if (!stream?.extractedPath) return;
    const from = ticks - WAVE_HALF;
    const timer = setTimeout(() => {
      window.studio.long
        .waveform(stream.extractedPath!, from - stream.startOffset, WAVE_HALF * 2, WAVE_BUCKETS)
        .then((values) => {
          setPeaks({ from, values });
          setError(null);
        })
        .catch((reason: unknown) => setError(errorText(reason)));
    }, 120);
    return () => clearTimeout(timer);
  }, [stream?.extractedPath, stream?.startOffset, ticks]);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const width = element.width;
    const height = element.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b0e12';
    context.fillRect(0, 0, width, height);
    const from = ticks - WAVE_HALF;
    const x = (at: number): number => ((at - from) / (WAVE_HALF * 2)) * width;
    // 素材の外
    context.fillStyle = 'rgba(255,255,255,0.06)';
    if (from < 0) context.fillRect(0, 0, x(0), height);
    if (from + WAVE_HALF * 2 > duration) context.fillRect(x(duration), 0, width - x(duration), height);
    // 同期点・現在位置は波形の下に描く（音の立ち上がりが線に隠れないように）
    if (syncAt >= from && syncAt <= from + WAVE_HALF * 2) {
      context.fillStyle = 'rgba(255, 211, 77, 0.8)';
      context.fillRect(x(syncAt) - 1, 0, 2, height);
    }
    context.fillStyle = 'rgba(255, 70, 85, 0.85)';
    context.fillRect(width / 2 - 1, 0, 2, height);
    if (peaks) {
      // 読み込み済みの波形を、今の表示位置に合わせてずらして描く
      const shift = ((peaks.from - from) / (WAVE_HALF * 2)) * width;
      const max = Math.max(0.05, ...peaks.values);
      context.fillStyle = '#7cc4ff';
      const bar = width / peaks.values.length;
      peaks.values.forEach((value, index) => {
        const h = Math.max(1, (value / max) * (height - 4));
        context.fillRect(shift + index * bar, (height - h) / 2, Math.max(1, bar - 0.5), h);
      });
    }
  }, [peaks, ticks, syncAt, duration]);
  if (!stream) return <div className="dim" style={{ fontSize: 11, padding: '4px 0' }}>音声がないため波形を表示できません</div>;
  return (
    <div>
      <canvas
        ref={canvas}
        width={800}
        height={56}
        style={{ width: '100%', height: 56, display: 'block', cursor: 'pointer', borderRadius: 3 }}
        title="クリックでその位置へ移動"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const at = ticks - WAVE_HALF + Math.round(((event.clientX - box.left) / box.width) * WAVE_HALF * 2);
          onChange(Math.max(0, Math.min(duration, at)));
        }}
      />
      <div className="row dim" style={{ fontSize: 10.5 }}>
        <span>−2秒</span>
        <span className="sp" />
        <span>波形：{stream.title || `音声 ${stream.audioIndex + 1}`}{error ? `（読み込めません：${error}）` : ''}</span>
        <span className="sp" />
        <span>+2秒</span>
      </div>
    </div>
  );
};

const Viewer = ({
  title,
  path,
  asset,
  syncAt,
  ticks,
  fps,
  onChange,
  duration,
}: {
  title: string;
  path: string;
  asset: LongAsset | undefined;
  syncAt: number;
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
      <Waveform asset={asset} ticks={ticks} syncAt={syncAt} duration={duration} onChange={onChange} />
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
            <Viewer title={`A 主：${mainAsset.name}`} path={mainAsset.proxyPath ?? mainAsset.path} asset={mainAsset} syncAt={mainAt} ticks={viewA} fps={mainAsset.probe?.fps ?? 60} duration={mainAsset.probe?.durationTicks ?? secToTicks(600)} onChange={setViewA} />
            <Viewer title={`B 副：${secondaryAsset.name}`} path={secondaryAsset.proxyPath ?? secondaryAsset.path} asset={secondaryAsset} syncAt={secondaryAt} ticks={viewB} fps={secondaryAsset.probe?.fps ?? 60} duration={durationB} onChange={setViewB} />
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
