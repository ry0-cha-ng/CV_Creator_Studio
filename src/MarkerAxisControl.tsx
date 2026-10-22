import { useState, type ReactNode } from 'react';
import { markerFrameSpan, markerNormalizedFromPixel, markerPixel } from '../shared/aim-marker';

const formatPixel = (pixel: number): string => String(Math.round(pixel * 100) / 100);

/** 動画フレーム上のマーカー位置。スライダーと、左上からのピクセル数値。 */
export const MarkerAxisControl = ({
  axis,
  value,
  onChange,
}: {
  axis: 'x' | 'y';
  value: number;
  onChange: (normalized: number) => void;
}): ReactNode => {
  const span = markerFrameSpan(axis);
  const label = axis === 'x' ? 'マーカー X' : 'マーカー Y';
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatPixel(markerPixel(value, axis));
  return (
    <label className="is-axis">
      {label}
      <span className="marker-axis">
        <span className="marker-range">
          <input
            type="range"
            min={0}
            max={1}
            step={1 / span}
            aria-label={label}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <span className="marker-range-tick" title="中央" aria-hidden="true" />
        </span>
        <span className="marker-pixel">
          <input
            type="number"
            min={0}
            max={span}
            step={0.01}
            inputMode="decimal"
            aria-label={`${label}（左上から px）`}
            value={shown}
            onFocus={() => setDraft(formatPixel(markerPixel(value, axis)))}
            onChange={(event) => {
              const text = event.target.value;
              setDraft(text);
              if (text.trim() === '' || text === '-' || text === '.' || text === '-.') return;
              const pixel = Number(text);
              if (!Number.isFinite(pixel)) return;
              onChange(markerNormalizedFromPixel(pixel, axis));
            }}
            onBlur={() => setDraft(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          px
        </span>
      </span>
    </label>
  );
};
