const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sameNumber = (left: number, right: number): boolean =>
  Object.is(left, right) || Math.abs(left - right) < 1e-9;

const formatPaths = (paths: string[]): string => {
  const shown = paths.slice(0, 6);
  const rest = paths.length - shown.length;
  return rest > 0 ? `${shown.join('、')}、他${rest}件` : shown.join('、');
};

/**
 * 保存前後で、送った値が欠落・改変されていないかを調べる。
 * updatedAt の更新と、未指定項目へのスキーマ既定値の追加は差分にしない。
 */
export const persistenceMismatches = (sent: unknown, received: unknown): string[] => {
  const mismatches: string[] = [];
  const walk = (left: unknown, right: unknown, path: string): void => {
    if (path === 'updatedAt' || path.endsWith('.updatedAt')) return;
    if (Object.is(left, right)) return;
    if (typeof left === 'number' && typeof right === 'number' && sameNumber(left, right)) return;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        mismatches.push(path);
        return;
      }
      left.forEach((item, index) => walk(item, right[index], `${path}[${index}]`));
      return;
    }
    if (isRecord(left) && isRecord(right)) {
      for (const key of Object.keys(left)) {
        if (left[key] === undefined) continue;
        const next = path ? `${path}.${key}` : key;
        if (!Object.prototype.hasOwnProperty.call(right, key) || right[key] === undefined) {
          mismatches.push(next);
          continue;
        }
        walk(left[key], right[key], next);
      }
      return;
    }
    mismatches.push(path);
  };
  walk(sent, received, '');
  return mismatches;
};

export const persistenceMismatchMessage = (paths: string[], keptOnScreen: boolean): string => {
  const detail = formatPaths(paths);
  return keptOnScreen
    ? `保存結果に編集が反映されていません（${detail}）。画面上の編集は残しています。`
    : `保存結果に編集が反映されていません（${detail}）。ファイルは更新していません。`;
};

export class ProjectPersistenceError extends Error {
  readonly paths: string[];

  constructor(paths: string[]) {
    super(persistenceMismatchMessage(paths, false));
    this.name = 'ProjectPersistenceError';
    this.paths = paths;
  }
}

export const assertProjectPersisted = (sent: unknown, received: unknown): void => {
  const paths = persistenceMismatches(sent, received);
  if (paths.length > 0) throw new ProjectPersistenceError(paths);
};
