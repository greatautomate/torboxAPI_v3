import { useCallback, useMemo, useState } from 'react';
import { useQueryParams } from '../../lib/hooks/useQueryParams';

export type Params = Record<string, string | undefined>;
export interface FilterState {
  params: Params;
  set: (patch: Record<string, string | number | undefined | null>, resetPage?: boolean) => void;
  reset: () => void;
  page: number;
  limit: number;
}

/** URL-backed filters (page-level) or local-state filters (embedded tables). */
export function useFilters(embedded: boolean, defaultLimit = 50): FilterState {
  const url = useQueryParams<Params>();
  const [local, setLocal] = useState<Params>({});
  const setLocalPatch = useCallback((patch: Record<string, string | number | undefined | null>, resetPage = true) => {
    setLocal((prev) => {
      const next: Params = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '') delete next[k];
        else next[k] = String(v);
      }
      if (resetPage && !('page' in patch)) delete next.page;
      return next;
    });
  }, []);
  const resetLocal = useCallback(() => setLocal({}), []);
  return useMemo(() => {
    const params = embedded ? local : url.params;
    return {
      params,
      set: embedded ? setLocalPatch : url.set,
      reset: embedded ? resetLocal : url.reset,
      page: Number(params.page ?? 1) || 1,
      limit: Number(params.limit ?? defaultLimit) || defaultLimit,
    };
  }, [embedded, local, url.params, url.set, url.reset, setLocalPatch, resetLocal, defaultLimit]);
}
