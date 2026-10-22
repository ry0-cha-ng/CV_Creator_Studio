import type { ReactNode } from 'react';
import { annotationStyleOf } from '../shared/annotation-style';
import type { AnnotationStyle } from '../shared/schema/project';

const OPTIONS = [
  ['standard', '標準'],
  ['strong', '強調'],
  ['strong-dim', '強調＋減光'],
] as const;

/** 注釈の強さ。動画とカードで同じ値を読む。 */
export const AnnotationWeightField = ({
  style,
  onChange,
}: {
  style: AnnotationStyle | undefined;
  onChange: (style: AnnotationStyle) => void;
}): ReactNode => {
  const current = annotationStyleOf(style);
  return (
    <div className="gd-zoom-row">
      <span>注釈表示</span>
      <div className="gd-seg is-grid3" role="group" aria-label="注釈表示">
        {OPTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={id === current ? 'is-on' : ''}
            aria-pressed={id === current}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="gd-zoom-hint">赤とネイビーの縁。強調は線を太くし、減光は目印の周りだけを残します。</span>
    </div>
  );
};
