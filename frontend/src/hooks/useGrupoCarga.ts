import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { obtenerGrupo } from '../api/imports';
import { useSocket } from '../context/SocketContext';
import type { EstadoCargaDto } from '../types/importProgreso';
import { POLL_MS, SILENCIO_MS, esEstadoCarga, fusionarEstadoCarga } from '../utils/estadoCarga';

const EVENTOS_IMPORT = ['import:iniciada', 'import:progreso', 'import:finalizada'] as const;
/** 404 seguidos antes de dar por perdido el grupo (un solo 404 no alcanza: puede ser transitorio). */
const CONFIRMACIONES_404 = 3;
const REINTENTO_404_MS = 3_000;
/** Y que entre el primer 404 y el último haya pasado al menos esto: tres respuestas simultáneas no son tres confirmaciones. */
const VENTANA_404_MS = 6_000;

interface UseGrupoCarga {
    /** Las remesas del grupo por `grupoOrden`. Puede traer menos que `total` si alguna se eliminó. */
    remesas: EstadoCargaDto[];
    /** `grupoTotal`: cuántas remesas se confirmaron juntas. 0 hasta la primera respuesta. */
    total: number;
    /** true hasta la primera respuesta (buena o mala). */
    cargando: boolean;
    /** El servidor no encuentra el grupo en varias consultas seguidas. */
    noExiste: boolean;
    refrescar: () => Promise<void>;
}

function ordenar(mapa: Map<number, EstadoCargaDto>): EstadoCargaDto[] {
    return [...mapa.values()].sort(
        (a, b) => (a.grupoOrden ?? Number.MAX_SAFE_INTEGER) - (b.grupoOrden ?? Number.MAX_SAFE_INTEGER) || a.remesaId - b.remesaId,
    );
}

/**
 * Estado en vivo de una carga dividida (docs/imports-progreso-realtime-spec.md §10.8.3). Mismas reglas que
 * `useEstadoCarga`: el socket avisa; si un aviso se pierde, se recupera por HTTP (al conectar, al volver a la
 * pestaña, al volver la red y por polling mientras alguna remesa no termina). Cada evento es una foto completa y
 * se fusiona por `rev`, remesa por remesa.
 */
export function useGrupoCarga(grupoId: string | null): UseGrupoCarga {
    const { socket, conectado, conexiones } = useSocket();
    const [mapa, setMapa] = useState<Map<number, EstadoCargaDto>>(() => new Map());
    const [total, setTotal] = useState(0);
    const [cargando, setCargando] = useState<boolean>(grupoId !== null);
    const [noExiste, setNoExiste] = useState(false);

    const grupoIdRef = useRef<string | null>(grupoId);
    const conectadoRef = useRef(conectado);
    const ultimaNovedadRef = useRef(Date.now());
    const conexionesPrevRef = useRef(conexiones);
    const fallos404Ref = useRef(0);
    const primer404Ref = useRef(0);
    const timerReintentoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    conectadoRef.current = conectado;

    const refrescar = useCallback(async () => {
        const id = grupoIdRef.current;
        if (id === null) return;
        try {
            const respuesta = await obtenerGrupo(id);
            if (grupoIdRef.current !== id || !Array.isArray(respuesta?.remesas)) return;
            setMapa((prev) => {
                // Las que la respuesta ya no trae se eliminaron; de las demás manda la de mayor `rev`.
                const siguiente = new Map<number, EstadoCargaDto>();
                for (const dto of respuesta.remesas) {
                    if (!esEstadoCarga(dto)) continue;
                    siguiente.set(dto.remesaId, fusionarEstadoCarga(prev.get(dto.remesaId) ?? null, dto));
                }
                return siguiente;
            });
            setTotal(typeof respuesta.total === 'number' ? respuesta.total : respuesta.remesas.length);
            ultimaNovedadRef.current = Date.now();
            fallos404Ref.current = 0;
            primer404Ref.current = 0;
            if (timerReintentoRef.current) clearTimeout(timerReintentoRef.current);
            timerReintentoRef.current = null;
            setNoExiste(false);
        } catch (e) {
            if (grupoIdRef.current === id && isAxiosError(e) && e.response?.status === 404) {
                if (fallos404Ref.current === 0) primer404Ref.current = Date.now();
                fallos404Ref.current += 1;
                if (fallos404Ref.current >= CONFIRMACIONES_404 && Date.now() - primer404Ref.current >= VENTANA_404_MS) {
                    setNoExiste(true);
                } else {
                    if (timerReintentoRef.current) clearTimeout(timerReintentoRef.current);
                    timerReintentoRef.current = setTimeout(() => void refrescar(), REINTENTO_404_MS);
                }
            }
            // Offline o 5xx: no se toca nada; el próximo tick vuelve a intentar.
        } finally {
            if (grupoIdRef.current === id) setCargando(false);
        }
    }, []);

    // Al montar o cambiar de grupo: empezar de cero y consultar.
    useEffect(() => {
        grupoIdRef.current = grupoId;
        setMapa(new Map());
        setTotal(0);
        setNoExiste(false);
        fallos404Ref.current = 0;
        primer404Ref.current = 0;
        setCargando(grupoId !== null);
        ultimaNovedadRef.current = Date.now();
        if (grupoId !== null) void refrescar();
        return () => {
            if (timerReintentoRef.current) clearTimeout(timerReintentoRef.current);
        };
    }, [grupoId, refrescar]);

    // Eventos de socket de las remesas del grupo: cada uno es una foto completa. El evento trae `grupoId`
    // (el tracker lo arma con el valor real); lo que no pasa esEstadoCarga o es de otro grupo se ignora.
    useEffect(() => {
        if (!socket || grupoId === null) return;
        const onEvento = (data: unknown) => {
            if (!esEstadoCarga(data) || data.grupoId !== grupoId) return;
            setMapa((prev) => {
                const actual = prev.get(data.remesaId) ?? null;
                const fusionado = fusionarEstadoCarga(actual, data);
                if (fusionado === actual) return prev;
                const siguiente = new Map(prev);
                siguiente.set(data.remesaId, fusionado);
                return siguiente;
            });
            ultimaNovedadRef.current = Date.now();
        };
        EVENTOS_IMPORT.forEach((ev) => socket.on(ev, onEvento));
        return () => {
            EVENTOS_IMPORT.forEach((ev) => socket.off(ev, onEvento));
        };
    }, [socket, grupoId]);

    // Cada conexión (la primera y cada reconexión) puede haber dejado eventos sin recibir.
    useEffect(() => {
        if (conexiones === conexionesPrevRef.current) return;
        conexionesPrevRef.current = conexiones;
        void refrescar();
    }, [conexiones, refrescar]);

    // Volver a la pestaña o recuperar la red.
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') void refrescar();
        };
        const onOnline = () => void refrescar();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [refrescar]);

    // Polling de respaldo: mientras alguna remesa no terminó (o todavía no se sabe cuáles son). Mismas reglas
    // que `useEstadoCarga`: 10 s con el socket caído, o si lleva 30 s callado. No se corta por errores de red.
    const remesas = ordenar(mapa);
    const todasTerminales = remesas.length > 0 && remesas.every((r) => r.terminal);
    const hayQuePollear = grupoId !== null && !noExiste && !todasTerminales;
    useEffect(() => {
        if (!hayQuePollear) return;
        const id = setInterval(() => {
            if (document.hidden) return;
            const silencio = Date.now() - ultimaNovedadRef.current;
            if (!conectadoRef.current || silencio >= SILENCIO_MS) void refrescar();
        }, POLL_MS);
        return () => clearInterval(id);
    }, [hayQuePollear, refrescar]);

    // Al cambiar de grupo, por un render el estado todavía es el del anterior: no se entrega.
    const delGrupo = remesas.filter((r) => r.grupoId === grupoId);
    return { remesas: delGrupo, total, cargando, noExiste, refrescar };
}
