import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { BgmUse } from '../../shared/long/schema';
import { formatTicks } from '../../shared/long/time';
import { NumberInput } from './fields';
import { useLongStore } from './store';

type Point = BgmUse['volumePoints'][number];

const DB_MIN = -30;
const DB_MAX = 6;
const WIDTH = 300;
const HEIGHT = 96;
const PAD = 6;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const sorted = (points: Point[]): Point[] => [...points].sort((a, b) => a.at - b.at);

/** 点の間を dB で直線補間した値（プレビュー描画用。描画計画の bgmCurveGain と同じ規則） */
export const curveDbAt = (points: Point[], at: number): number => {
  const list = sorted(points);
  if (list.length === 0) return 0;
  if (at <= list[0]!.at) return list[0]!.db;
  const last = list[list.length - 1]!;
  if (at >= last.at) return last.db;
  for (let index = 1; index < list.length; index += 1) {
    const right = list[index]!;
    if (at > right.at) continue;
    const left = list[index - 1]!;
    return left.db + ((right.db - left.db) * (at - left.at)) / Math.max(1, right.at - left.at);
  }
  return last.db;
};

/**
 * BGM の音量の線。空いている所をクリックで点を追加、点をドラッグで移動、ダブルクリックで削除。
 * 縦軸は基準音量からの増減（−30〜+6 dB）、横軸は BGM の開始からの時刻。
 */
export const VolumeCurveEditor = ({
  item,
  playhead,
  onSeek,
}: {
  item: BgmUse;
  /** BGM の開始からの再生位置（範囲外なら undefined） */
  playhead?: number;
  onSeek?: (at: number) => void;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const duration = Math.max(1, item.duration);
  // 点は保存順のまま扱う（ドラッグ中に並びが変わっても同じ点を追える）。線は時刻順で描く
  const points = item.volumePoints;
  const ordered = sorted(points);
  const x = (at: number): number => PAD + (clamp(at, 0, duration) / duration) * (WIDTH - PAD * 2);
  const y = (db: number): number => PAD + ((DB_MAX - clamp(db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN)) * (HEIGHT - PAD * 2);
  const fromEvent = (event: { clientX: number; clientY: number }): Point => {
    const box = svgRef.current!.getBoundingClientRect();
    const rx = ((event.clientX - box.left) / box.width) * WIDTH;
    const ry = ((event.clientY - box.top) / box.height) * HEIGHT;
    const at = Math.round(clamp((rx - PAD) / (WIDTH - PAD * 2), 0, 1) * duration);
    const db = Math.round(clamp(DB_MAX - ((ry - PAD) / (HEIGHT - PAD * 2)) * (DB_MAX - DB_MIN), DB_MIN, DB_MAX) * 2) / 2;
    return { at, db };
  };
  const write = (label: string, next: Point[]): void =>
    useLongStore.getState().transact(label, (current) => ({
      ...current,
      bgm: current.bgm.map((entry) => (entry.id === item.id ? { ...entry, volumePoints: next } : entry)),
    }));

  const startDrag = (index: number) => (event: ReactPointerEvent<SVGCircleElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    setSelected(index);
    // ドラッグ開始時の並びを基準に、同じ番号の点だけを置き換える（ストアの点は直接書き換えない）
    const base = points.slice();
    let moved = false;
    const onMove = (move: PointerEvent): void => {
      const next = fromEvent(move);
      if (!moved) {
        useLongStore.getState().beginGesture('音量の点の移動');
        moved = true;
      }
      useLongStore.getState().live((current) => ({
        ...current,
        bgm: current.bgm.map((entry) =>
          entry.id === item.id ? { ...entry, volumePoints: base.map((point, i) => (i === index ? next : point)) } : entry,
        ),
      }));
    };
    // 再描画で要素が作り直されても追えるよう、移動と終了はウィンドウで受ける
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved) useLongStore.getState().endGesture();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const line = (() => {
    if (ordered.length === 0) return `M ${x(0)} ${y(0)} L ${x(duration)} ${y(0)}`;
    const parts = [`M ${x(0)} ${y(ordered[0]!.db)}`];
    for (const point of ordered) parts.push(`L ${x(point.at)} ${y(point.db)}`);
    parts.push(`L ${x(duration)} ${y(ordered[ordered.length - 1]!.db)}`);
    return parts.join(' ');
  })();
  const current = selected !== null ? points[selected] : undefined;

  return (
    <div className="lv-curve">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const point = fromEvent(event);
          write('音量の点の追加', [...points, point]);
          setSelected(points.length);
        }}
      >
        {[0, -12, -24].map((db) => (
          <g key={db}>
            <line x1={PAD} x2={WIDTH - PAD} y1={y(db)} y2={y(db)} className={db === 0 ? 'zero' : 'grid'} />
            <text x={WIDTH - PAD - 1} y={y(db) - 2} textAnchor="end">
              {db === 0 ? '0dB' : `${db}`}
            </text>
          </g>
        ))}
        {item.fadeIn > 0 ? <rect x={x(0)} y={PAD} width={x(item.fadeIn) - x(0)} height={HEIGHT - PAD * 2} className="fade" /> : null}
        {item.fadeOut > 0 ? <rect x={x(duration - item.fadeOut)} y={PAD} width={x(duration) - x(duration - item.fadeOut)} height={HEIGHT - PAD * 2} className="fade" /> : null}
        <path d={line} className="curve" />
        {playhead !== undefined && playhead >= 0 && playhead <= duration ? <line x1={x(playhead)} x2={x(playhead)} y1={0} y2={HEIGHT} className="head" /> : null}
        {points.map((point, index) => (
          <circle
            key={index}
            cx={x(point.at)}
            cy={y(point.db)}
            r={selected === index ? 5 : 4}
            className={selected === index ? 'pt on' : 'pt'}
            onPointerDown={startDrag(index)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              write('音量の点の削除', points.filter((_, i) => i !== index));
              setSelected(null);
            }}
          >
            <title>
              {formatTicks(point.at)} · {point.db > 0 ? '+' : ''}
              {point.db} dB（ダブルクリックで削除）
            </title>
          </circle>
        ))}
      </svg>
      <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
        {current ? (
          <>
            <span className="mono dim">{formatTicks(current.at)}</span>
            <NumberInput
              value={current.db}
              min={-60}
              max={12}
              step={0.5}
              digits={1}
              width={52}
              onChange={(db) => write('音量の点の変更', points.map((point, index) => (index === selected ? { ...point, db } : point)))}
            />
            dB
            {onSeek ? (
              <button type="button" className="sm ghost" onClick={() => onSeek(current.at)}>
                この点へ移動
              </button>
            ) : null}
            <button
              type="button"
              className="sm ghost danger"
              onClick={() => {
                write('音量の点の削除', points.filter((_, index) => index !== selected));
                setSelected(null);
              }}
            >
              点を削除
            </button>
          </>
        ) : (
          <span className="dim" style={{ fontSize: 10.5 }}>
            クリックで点を追加、ドラッグで移動、ダブルクリックで削除。点の間はなめらかに変わります。
          </span>
        )}
        <span className="sp" />
        {playhead !== undefined && playhead >= 0 && playhead <= duration ? (
          <button
            type="button"
            className="sm"
            title="再生位置に、今の線の値で点を置きます"
            onClick={() => {
              const point = { at: Math.round(playhead), db: Math.round(curveDbAt(points, playhead) * 2) / 2 };
              const next = [...points.filter((item) => item.at !== point.at), point];
              write('音量の点の追加', next);
              setSelected(next.length - 1);
            }}
          >
            再生位置に点
          </button>
        ) : null}
        {points.length > 0 ? (
          <button
            type="button"
            className="sm ghost"
            onClick={() => {
              write('音量の線を消す', []);
              setSelected(null);
            }}
          >
            すべて消す
          </button>
        ) : null}
      </div>
    </div>
  );
};
