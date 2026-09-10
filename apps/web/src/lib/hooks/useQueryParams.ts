import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const EMPTY: Record<string, never> = {};

/** Read/write URL search params as a flat string record (used by filter bars + pagination). */
export function useQueryParams<T extends Record<string, string | undefined>>(defaults: Partial<T> = EMPTY as Partial<T>) {
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => {
    const out: Record<string, string | undefined> = { ...defaults };
    sp.forEach((v, k) => {
      out[k] = v;
    });
    return out as T;
  }, [sp, defaults]);
  const set = useCallback(
    (patch: Partial<Record<keyof T, string | number | undefined | null>>, resetPage = true) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );
  const reset = useCallback(() => setSp(new URLSearchParams(), { replace: true }), [setSp]);
  return { params, set, reset, page: Number(params.page ?? 1) || 1 };
}
