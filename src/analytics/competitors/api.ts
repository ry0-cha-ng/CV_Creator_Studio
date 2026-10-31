import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompetitorResult } from '../../../shared/schema/competitor';

/**
 * 競合タブの読み込み結果をキー単位で持つ。変更したら関係するキーの頭だけ invalidate して、
 * 画面にある該当の読み込みだけを取り直す（全体を読み直さない）。
 */
type Entry = { data: unknown; at: number };

const cache = new Map<string, Entry>();
const listeners = new Set<(prefixes: string[]) => void>();

export type ResourceKey = 'overview' | 'detail' | 'videos' | 'jots' | 'matrix' | 'tags' | 'options';

export const invalidate = (...prefixes: ResourceKey[]): void => {
  for (const key of [...cache.keys()]) {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) cache.delete(key);
  }
  for (const listener of listeners) listener(prefixes);
};

export const keyOf = (prefix: ResourceKey, params?: unknown): string =>
  params === undefined ? prefix : `${prefix}:${JSON.stringify(params)}`;

export type Resource<T> = {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
};

export const useResource = <T,>(key: string | null, load: () => Promise<CompetitorResult<T>>): Resource<T> => {
  const cached = key ? (cache.get(key)?.data as T | undefined) : undefined;
  const [data, setData] = useState<T | null>(cached ?? null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(key) && cached === undefined);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!key) return;
    const prefix = key.split(':')[0];
    const listener = (prefixes: string[]) => {
      if (prefixes.includes(prefix)) setTick((value) => value + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);

  useEffect(() => {
    if (!key) {
      setData(null);
      setLoading(false);
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setData(hit.data as T);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void loadRef.current().then(
      (result) => {
        if (!alive) return;
        if (result.ok) {
          cache.set(key, { data: result.data, at: Date.now() });
          setData(result.data);
          setError('');
        } else {
          setError(result.message);
        }
        setLoading(false);
      },
      (reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : '読み込めませんでした');
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => {
    if (key) cache.delete(key);
    setTick((value) => value + 1);
  }, [key]);

  return { data, error, loading, reload };
};

/** 書き込み系。成功したら関係するキーを無効にし、失敗は message を返す。 */
export const mutate = async <T,>(
  call: Promise<CompetitorResult<T>>,
  affects: ResourceKey[],
): Promise<{ ok: true; data: T } | { ok: false; message: string }> => {
  try {
    const result = await call;
    if (!result.ok) return { ok: false, message: result.message };
    invalidate(...affects);
    return { ok: true, data: result.data };
  } catch (reason) {
    return { ok: false, message: reason instanceof Error ? reason.message : '保存できませんでした' };
  }
};
