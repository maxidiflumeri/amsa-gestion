import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardsApi } from '../../../api/dashboards';
import type { SnapshotFiltros, SnapshotResponse } from '../../../types/dashboards';

interface State {
    data: SnapshotResponse | null;
    loading: boolean;
    error: string | null;
}

export function useTableroSnapshot(filtros: SnapshotFiltros | null, debounceMs = 400) {
    const [state, setState] = useState<State>({ data: null, loading: false, error: null });
    const timerRef = useRef<number | null>(null);
    const reqIdRef = useRef(0);

    const fetchNow = useCallback(async (f: SnapshotFiltros) => {
        const myReq = ++reqIdRef.current;
        setState((s) => ({ ...s, loading: true, error: null }));
        try {
            const data = await dashboardsApi.snapshot(f);
            if (myReq !== reqIdRef.current) return;
            setState({ data, loading: false, error: null });
        } catch (e: any) {
            if (myReq !== reqIdRef.current) return;
            const msg = e?.response?.data?.message ?? e?.message ?? 'Error al cargar el tablero';
            setState((s) => ({ data: s.data, loading: false, error: String(msg) }));
        }
    }, []);

    useEffect(() => {
        if (!filtros || filtros.empresaId == null) {
            reqIdRef.current++;
            setState({ data: null, loading: false, error: null });
            return;
        }
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => fetchNow(filtros), debounceMs);
        return () => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
        };
    }, [filtros, debounceMs, fetchNow]);

    const refresh = useCallback(() => {
        if (filtros && filtros.empresaId != null) fetchNow(filtros);
    }, [filtros, fetchNow]);

    return { ...state, refresh };
}
