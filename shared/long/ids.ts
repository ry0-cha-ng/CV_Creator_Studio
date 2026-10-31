/** 横動画のID。テストでは決定的な生成器を差し込む。 */
export type IdFactory = (prefix: string) => string;

export const randomId: IdFactory = (prefix) => {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid.replace(/-/g, '').slice(0, 12)}`;
};

export const sequentialIds = (namespace = ''): IdFactory => {
  let counter = 0;
  return (prefix) => {
    counter += 1;
    return `${prefix}-${namespace}${String(counter).padStart(4, '0')}`;
  };
};

/**
 * オブジェクトを深くコピーし、map にある文字列値（ID）を置き換える。
 * 複製時に内部参照を新IDへ付け替えるために使う。
 */
export const remapIds = <T>(value: T, map: ReadonlyMap<string, string>): T => {
  const walk = (input: unknown): unknown => {
    if (typeof input === 'string') return map.get(input) ?? input;
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input as Record<string, unknown>)) out[key] = walk(item);
      return out;
    }
    return input;
  };
  return walk(value) as T;
};
