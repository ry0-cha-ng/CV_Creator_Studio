import { useEffect, useState, type ReactNode } from 'react';
import { applyAspect, rectProblem, type Size } from '../../shared/long/geometry';
import type { Aspect, NormRect } from '../../shared/long/schema';

export const Field = ({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) => (
  <div className={`lv-field ${wide ? 'wide' : ''}`}>
    <span>{label}</span>
    <div>{children}</div>
  </div>
);

export const Section = ({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) => (
  <div className="lv-sec">
    <h4>
      {title}
      {right ? <span className="sp" /> : null}
      {right}
    </h4>
    {children}
  </div>
);

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <span className="seg">
      {options.map(([key, label]) => (
        <button key={String(key)} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </span>
  );
}

/** 数値入力（確定時に反映。範囲外・非数は戻す） */
export const NumberInput = ({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  width = 64,
  digits = 3,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
  digits?: number;
}) => {
  const [text, setText] = useState(String(Number(value.toFixed(digits))));
  useEffect(() => setText(String(Number(value.toFixed(digits)))), [value, digits]);
  const commit = (): void => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
      setText(String(Number(value.toFixed(digits))));
      return;
    }
    onChange(parsed);
  };
  return (
    <input
      className="mono"
      type="number"
      step={step}
      value={text}
      style={{ width }}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
};

const ASPECTS: Array<[string, Aspect, string]> = [
  ['source', 'source', '元素材比'],
  ['16:9', { w: 16, h: 9 }, '16:9'],
  ['4:3', { w: 4, h: 3 }, '4:3'],
  ['1:1', { w: 1, h: 1 }, '1:1'],
  ['9:16', { w: 9, h: 16 }, '9:16'],
  ['4:1', { w: 4, h: 1 }, '4:1'],
  ['free', 'free', '自由'],
];

export const aspectKey = (aspect: Aspect): string =>
  typeof aspect === 'string' ? aspect : ASPECTS.find(([, value]) => typeof value !== 'string' && value.w / value.h === aspect.w / aspect.h)?.[0] ?? `${aspect.w}:${aspect.h}`;

/** 比率の選択（数値比も入力できる） */
export const AspectPicker = ({ value, onChange }: { value: Aspect; onChange: (aspect: Aspect) => void }) => {
  const key = aspectKey(value);
  const [custom, setCustom] = useState(typeof value === 'string' ? '' : `${value.w}:${value.h}`);
  return (
    <div>
      {ASPECTS.map(([id, aspect, label]) => (
        <button key={id} type="button" className="chip" aria-pressed={key === id} onClick={() => onChange(aspect)}>
          {label}
        </button>
      ))}
      <input
        style={{ width: 64, marginLeft: 4 }}
        placeholder="数値 例 21:9"
        value={custom}
        onChange={(event) => setCustom(event.target.value)}
        onBlur={() => {
          const match = /^\s*(\d+(?:\.\d+)?)\s*[:：x×/]\s*(\d+(?:\.\d+)?)\s*$/.exec(custom);
          if (match && Number(match[1]) > 0 && Number(match[2]) > 0) onChange({ w: Number(match[1]), h: Number(match[2]) });
        }}
      />
    </div>
  );
};

/** 矩形の数値入力（実寸 px 表示） */
export const RectInputs = ({
  rect,
  size,
  onChange,
  ratio,
}: {
  rect: NormRect;
  size: Size;
  onChange: (rect: NormRect) => void;
  ratio: number | null;
}) => {
  const set = (key: keyof NormRect, px: number): void => {
    const next = { ...rect, [key]: px / (key === 'x' || key === 'w' ? size.w : size.h) };
    if (ratio && key === 'w') next.h = (next.w * size.w) / ratio / size.h;
    if (ratio && key === 'h') next.w = (next.h * size.h * ratio) / size.w;
    onChange(ratio ? applyAspect(next, ratio, size) : next);
  };
  const problem = rectProblem(rect);
  return (
    <div>
      <div className="grid4">
        {(['x', 'y', 'w', 'h'] as const).map((key) => (
          <label key={key} className="row" style={{ gap: 3 }}>
            <span className="dim mono">{key}</span>
            <NumberInput value={Math.round(rect[key] * (key === 'x' || key === 'w' ? size.w : size.h))} step={1} digits={0} width={58} onChange={(value) => set(key, value)} />
          </label>
        ))}
      </div>
      {problem ? <div className="diag error">{problem}</div> : null}
    </div>
  );
};
