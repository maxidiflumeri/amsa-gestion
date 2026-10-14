import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { getReversion } from '../api/imports';
import { useSocket } from '../context/SocketContext';
import type { ReversionAccionDto, ReversionResumenDto } from '../types/reversionAccion';
import { esReversionResumen, fusionarReversion, reversionActiva } from '../utils/reversionAccion';

const EVENTO_PROGRESO = 'accion:revertir:progreso';
const EVENTO_TERMINADA = 'accion:revertir:terminada';
/** Cada cuánto se vuelve a leer mientras la reversión está en cola o corriendo: los eventos solo llegan al dueño y a quien ve todas las importaciones. */
const INTERVALO_CONSULTA_MS = 10_000;

interface UseReversionAccion {
    /** Qué cubre revertir y cómo va la reversión. null mientras no llegó, o si no se pudo leer. */
    dto: ReversionAccionDto | null;
    cargando: boolean;
    /** El backend no conoce el endpoint (anterior a C3b, 404): no hay reversión por job y la pantalla usa el camino de C3a. */
    noSoportado: boolean;
    /** La última lectura falló por otra causa (red, 5xx). */
    error: unknown;
    recargar: () => Promise<void>;
    /** Aplica lo que devolvió el POST de pedir la reversión. */
    aplicar: (dto: ReversionAccionDto) => void;
}

/**
 * La reversión de una acción masiva (docs/imports-progreso-c3-spec.md §17.6). Lee `GET /import/remesas/:id/reversion` al
 * abrir y sigue los eventos `accion:revertir:progreso` y `accion:revertir:terminada` de esa remesa. Con `remesaId` null no
 * hace nada. Mientras corre, consulta cada 10 s y al volver a la pestaña. Al terminar la reversión vuelve a leer: trae `accionRevertidaEn` y lo que ya no se puede revertir.
 */
export function useReversionAccion(remesaId: number | null): UseReversionAccion {
    const { socket, conexiones } = useSocket();
    const [dto, setDto] = useState<ReversionAccionDto | null>(null);
    const [cargando, setCargando] = useState<boolean>(remesaId !== null);
    const [noSoportado, setNoSoportado] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const remesaIdRef = useRef(remesaId);
    remesaIdRef.current = remesaId;
    const conexionesPrevRef = useRef(conexiones);

    const leer = useCallback(async (id: number): Promise<void> => {
        try {
            const r = await getReversion(id);
            if (remesaIdRef.current !== id) return;
            setDto((previo) => (previo && previo.reversion && r.reversion ? { ...r, reversion: fusionarReversion(previo.reversion, r.reversion) } : r));
            setNoSoportado(false);
            setError(null);
        } catch (err) {
            if (remesaIdRef.current !== id) return;
            if (isAxiosError(err) && err.response?.status === 404) setNoSoportado(true);
            else setError(err);
        } finally {
            if (remesaIdRef.current === id) setCargando(false);
        }
    }, []);

    const recargar = useCallback(async () => {
        if (remesaIdRef.current !== null) await leer(remesaIdRef.current);
    }, [leer]);

    // Al abrir y al cambiar de remesa: de cero.
    useEffect(() => {
        setDto(null);
        setNoSoportado(false);
        setError(null);
        setCargando(remesaId !== null);
        if (remesaId !== null) void leer(remesaId);
    }, [remesaId, leer]);

    // Los eventos de esta remesa. El payload es solo el resumen de la reversión: la cobertura no cambia con él.
    useEffect(() => {
        if (!socket || remesaId === null) return;
        const alLlegar = (terminada: boolean) => (data: unknown) => {
            if (!esReversionResumen(data) || data.remesaId !== remesaIdRef.current) return;
            const nueva: ReversionResumenDto = data;
            setDto((previo) => (previo ? { ...previo, reversion: fusionarReversion(previo.reversion, nueva) } : previo));
            if (terminada) void leer(nueva.remesaId);
        };
        const onProgreso = alLlegar(false);
        const onTerminada = alLlegar(true);
        socket.on(EVENTO_PROGRESO, onProgreso);
        socket.on(EVENTO_TERMINADA, onTerminada);
        return () => {
            socket.off(EVENTO_PROGRESO, onProgreso);
            socket.off(EVENTO_TERMINADA, onTerminada);
        };
    }, [socket, remesaId, leer]);

    // Una reconexión pudo dejar eventos sin recibir.
    useEffect(() => {
        if (conexiones === conexionesPrevRef.current) return;
        conexionesPrevRef.current = conexiones;
        if (remesaIdRef.current !== null) void leer(remesaIdRef.current);
    }, [conexiones, leer]);

    // Volver a la pestaña o recuperar la red.
    useEffect(() => {
        if (remesaId === null) return;
        const onVisible = () => {
            if (document.visibilityState === 'visible' && remesaIdRef.current !== null) void leer(remesaIdRef.current);
        };
        const onOnline = () => {
            if (remesaIdRef.current !== null) void leer(remesaIdRef.current);
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [remesaId, leer]);

    // Mientras la reversión está en cola o corriendo, consulta aunque el socket no traiga nada (quien mira sin ser el dueño nunca recibe los eventos).
    const activa = reversionActiva(dto?.reversion);
    useEffect(() => {
        if (remesaId === null || !activa) return;
        const intervalo = setInterval(() => {
            if (document.hidden || remesaIdRef.current === null) return;
            void leer(remesaIdRef.current);
        }, INTERVALO_CONSULTA_MS);
        return () => clearInterval(intervalo);
    }, [remesaId, activa, leer]);

    const aplicar = useCallback((nuevo: ReversionAccionDto) => {
        if (nuevo.remesaId !== remesaIdRef.current) return;
        setDto((previo) => (previo && previo.reversion && nuevo.reversion ? { ...nuevo, reversion: fusionarReversion(previo.reversion, nuevo.reversion) } : nuevo));
        setNoSoportado(false);
    }, []);

    return { dto, cargando, noSoportado, error, recargar, aplicar };
}
