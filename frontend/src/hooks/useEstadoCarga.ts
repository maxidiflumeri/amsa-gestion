import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { obtenerEstadoCarga } from '../api/imports';
import { useSocket } from '../context/SocketContext';
import type { EstadoCargaDto } from '../types/importProgreso';
import { POLL_MS, SILENCIO_MS, esEstadoCarga, fusionarEstadoCarga } from '../utils/estadoCarga';

/** 404 seguidos antes de dar por perdida una remesa (un solo 404 no alcanza: puede ser transitorio). */
const CONFIRMACIONES_404 = 3;
const REINTENTO_404_MS = 3_000;
/** Y que entre el primer 404 y el último haya pasado al menos esto: tres respuestas simultáneas no son tres confirmaciones. */
const VENTANA_404_MS = 6_000;

const EVENTOS_IMPORT = ['import:iniciada', 'import:progreso', 'import:finalizada'] as const;

interface UseEstadoCarga {
    estado: EstadoCargaDto | null;
    /** true hasta la primera respuesta (buena o mala) de una remesa nueva. */
    cargando: boolean;
    /** La remesa se borró (404): se corta el polling. */
    noExiste: boolean;
    refrescar: () => Promise<void>;
    /** Aplica un estado que ya se tiene (por ejemplo, la `carga` que devolvió el POST de ejecutar). */
    aplicar: (dto: EstadoCargaDto) => void;
}

interface OpcionesEstadoCarga {
    /**
     * Seguir consultando hasta el estado terminal, sin mirar `rev` ni `enCurso`. Lo usa el paso
     * "Importando" del wizard: ahí la remesa puede estar todavía como borrador (el encolado se confirma
     * después de montar la pantalla) y el polling no puede apagarse por eso. Sin esta opción (el detalle),
     * se consulta solo mientras `estado === null || estado.enCurso`.
     */
    seguirHastaTerminal?: boolean;
}

/**
 * Estado en vivo de una carga. El socket avisa; si un aviso se pierde, se recupera por HTTP
 * (al conectar, al volver a la pestaña, al volver la red y por polling mientras la carga no termina).
 * Docs: imports-progreso-realtime-spec.md §8.8.3.
 */
export function useEstadoCarga(
    remesaId: number | null,
    opciones: OpcionesEstadoCarga = {},
): UseEstadoCarga {
    const { seguirHastaTerminal = false } = opciones;
    const { socket, conectado, conexiones } = useSocket();
    const [estado, setEstado] = useState<EstadoCargaDto | null>(null);
    const [cargando, setCargando] = useState<boolean>(remesaId !== null);
    const [noExiste, setNoExiste] = useState(false);

    // Lo que los intervalos y los handlers leen sin volver a registrarse.
    const remesaIdRef = useRef<number | null>(remesaId);
    const conectadoRef = useRef(conectado);
    const ultimaNovedadRef = useRef(Date.now());
    const conexionesPrevRef = useRef(conexiones);
    const fallos404Ref = useRef(0);
    const primer404Ref = useRef(0);
    const timerReintentoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    conectadoRef.current = conectado;

    const refrescar = useCallback(async () => {
        const id = remesaIdRef.current;
        if (id === null) return;
        try {
            const dto = await obtenerEstadoCarga(id);
            if (remesaIdRef.current !== id || !esEstadoCarga(dto)) return;
            setEstado((prev) => fusionarEstadoCarga(prev, dto));
            ultimaNovedadRef.current = Date.now();
            // Una respuesta buena deshace cualquier 404 anterior.
            fallos404Ref.current = 0;
            primer404Ref.current = 0;
            setNoExiste(false);
        } catch (e) {
            if (remesaIdRef.current === id && isAxiosError(e) && e.response?.status === 404) {
                // No se concluye con un solo 404: se vuelve a consultar y recién a la tercera se da por perdida.
                if (fallos404Ref.current === 0) primer404Ref.current = Date.now();
                fallos404Ref.current += 1;
                if (
                    fallos404Ref.current >= CONFIRMACIONES_404 &&
                    Date.now() - primer404Ref.current >= VENTANA_404_MS
                ) {
                    setNoExiste(true);
                } else {
                    if (timerReintentoRef.current) clearTimeout(timerReintentoRef.current);
                    timerReintentoRef.current = setTimeout(() => void refrescar(), REINTENTO_404_MS);
                }
            }
            // Offline o 5xx: no se toca nada; el próximo tick vuelve a intentar.
        } finally {
            if (remesaIdRef.current === id) setCargando(false);
        }
    }, []);

    const aplicar = useCallback((dto: EstadoCargaDto) => {
        if (!esEstadoCarga(dto) || dto.remesaId !== remesaIdRef.current) return;
        setEstado((prev) => fusionarEstadoCarga(prev, dto));
        ultimaNovedadRef.current = Date.now();
    }, []);

    // Al montar o cambiar de remesa: empezar de cero y consultar.
    useEffect(() => {
        remesaIdRef.current = remesaId;
        setEstado(null);
        setNoExiste(false);
        fallos404Ref.current = 0;
        primer404Ref.current = 0;
        setCargando(remesaId !== null);
        ultimaNovedadRef.current = Date.now();
        if (remesaId !== null) void refrescar();
        return () => {
            if (timerReintentoRef.current) clearTimeout(timerReintentoRef.current);
        };
    }, [remesaId, refrescar]);

    // Eventos de socket: cada uno es una foto completa. Lo que no pasa esEstadoCarga se ignora.
    useEffect(() => {
        if (!socket || remesaId === null) return;
        const onEvento = (data: unknown) => {
            if (!esEstadoCarga(data) || data.remesaId !== remesaId) return;
            setEstado((prev) => fusionarEstadoCarga(prev, data));
            ultimaNovedadRef.current = Date.now();
        };
        EVENTOS_IMPORT.forEach((ev) => socket.on(ev, onEvento));
        return () => {
            EVENTOS_IMPORT.forEach((ev) => socket.off(ev, onEvento));
        };
    }, [socket, remesaId]);

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

    // Polling de respaldo: mientras la carga no terminó. Con `seguirHastaTerminal` no importa si todavía
    // figura como borrador; sin eso, solo mientras está en curso (un borrador, o una remesa heredada
    // quieta, es una sola consulta). No se corta por errores de red ni de servidor.
    const terminal = estado?.terminal === true;
    const sigueVigente = seguirHastaTerminal || estado === null || estado.enCurso;
    const hayQuePollear = remesaId !== null && !noExiste && !terminal && sigueVigente;
    useEffect(() => {
        if (!hayQuePollear) return;
        const id = setInterval(() => {
            if (document.hidden) return;
            const silencio = Date.now() - ultimaNovedadRef.current;
            if (!conectadoRef.current || silencio >= SILENCIO_MS) void refrescar();
        }, POLL_MS);
        return () => clearInterval(id);
    }, [hayQuePollear, refrescar]);

    // Al cambiar de remesa, por un render el estado todavía es el de la anterior: no se entrega.
    const estadoActual = estado !== null && estado.remesaId === remesaId ? estado : null;
    return { estado: estadoActual, cargando, noExiste, refrescar, aplicar };
}
