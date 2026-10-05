import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    obtenerContador,
    marcarLeida as apiMarcarLeida,
    marcarTodas as apiMarcarTodas,
} from '../api/notificaciones';
import { obtenerCargasEnCurso } from '../api/imports';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { useNotify } from '../hooks/useNotify';
import type { EstadoCargaDto } from '../types/importProgreso';
import {
    POLL_LISTA_MS,
    SILENCIO_MS,
    esEstadoCarga,
    fusionarEstadoCarga,
    resultadoEsAdvertencia,
} from '../utils/estadoCarga';

interface NotificacionesContextValue {
    /** Cantidad real de notificaciones sin leer (badge). */
    noLeidas: number;
    /** Cargas encoladas o procesando, ordenadas como las manda el servidor. */
    importsEnCurso: EstadoCargaDto[];
    /** Cambia cada vez que hay novedades (notif nueva, marcar leída/todas). El popover lo observa para recargar su lista paginada. */
    nonce: number;
    marcarLeida: (id: number) => Promise<void>;
    marcarTodas: () => Promise<void>;
    refrescar: () => Promise<void>;
}

const NotificacionesContext = createContext<NotificacionesContextValue | null>(null);

interface SocketNotificacionNueva {
    id: number;
    tipo: string;
    titulo: string;
    mensaje: string;
    payload?: Record<string, unknown> | null;
    rutaAccion?: string | null;
    creadoEn: string;
}

interface SocketContador {
    noLeidas: number;
}

const EVENTOS_ENCURSO = ['import:iniciada', 'import:progreso'] as const;

/**
 * La lista del servidor reemplaza a la local, fusionando por `rev`, con dos excepciones:
 *  - se conservan las cargas que llegaron por socket DESPUÉS de iniciar el pedido (una respuesta lenta
 *    no puede borrar una carga recién encolada);
 *  - no se resucita una carga que ya terminó por socket mientras el pedido estaba en vuelo.
 */
function aplicarListaServidor(
    local: EstadoCargaDto[],
    servidor: unknown,
    inicioPedido: number,
    recibidoEn: Map<number, number>,
    terminadas: Map<number, number>,
): EstadoCargaDto[] {
    const lista = Array.isArray(servidor) ? servidor.filter(esEstadoCarga) : [];
    const resultado: EstadoCargaDto[] = [];
    for (const s of lista) {
        const revTerminal = terminadas.get(s.remesaId);
        if (revTerminal !== undefined && s.rev <= revTerminal) continue;
        const previa = local.find((l) => l.remesaId === s.remesaId) ?? null;
        resultado.push(fusionarEstadoCarga(previa, s));
    }
    for (const l of local) {
        const yaEsta = resultado.some((r) => r.remesaId === l.remesaId);
        const llegoDespues = (recibidoEn.get(l.remesaId) ?? 0) >= inicioPedido;
        if (!yaEsta && llegoDespues) resultado.push(l);
    }
    return resultado;
}

export const NotificacionesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { token, tienePermiso } = useAuth();
    const { socket, conectado, conexiones } = useSocket();
    const notify = useNotify();

    const [noLeidas, setNoLeidas] = useState(0);
    const [importsEnCurso, setImportsEnCurso] = useState<EstadoCargaDto[]>([]);
    const [nonce, setNonce] = useState(0);
    const hidratadoRef = useRef(false);

    // Dependencias inestables o que cambian seguido: se leen por ref para no re-registrar handlers ni intervalos.
    const notifyRef = useRef(notify);
    notifyRef.current = notify;
    const conectadoRef = useRef(conectado);
    conectadoRef.current = conectado;
    const hayCargasRef = useRef(false);
    hayCargasRef.current = importsEnCurso.length > 0;
    const conexionesPrevRef = useRef(conexiones);
    const ultimaNovedadRef = useRef(Date.now());
    /** Cuándo llegó por socket el último estado de cada remesa. */
    const recibidoEnRef = useRef(new Map<number, number>());
    /** `rev` del estado terminal de las remesas que terminaron por socket. */
    const terminadasRef = useRef(new Map<number, number>());
    /** Permiso de la sección de importaciones: sin él, `/import/en-curso` da 403 y el guard audita cada intento. */
    const puedeVerImportsRef = useRef(false);
    puedeVerImportsRef.current = tienePermiso('importacion.ver_historial');
    /** Número de pedido: una respuesta más vieja que la última aplicada se descarta (llegan desordenadas). */
    const pedidoRef = useRef(0);
    const ultimoAplicadoRef = useRef(0);

    const hidratar = useCallback(async () => {
        const hayToken = !!localStorage.getItem('amsa_token');
        if (!hayToken) return;
        const inicio = Date.now();
        const pedido = ++pedidoRef.current;
        // Independientes: que falle (o no corresponda pedir) una no arrastra a la otra. El contador y la lista
        // paginada (popover) salen del backend; acá se hidratan el contador y las importaciones en curso.
        const [contador, cargas] = await Promise.allSettled([
            obtenerContador(),
            puedeVerImportsRef.current ? obtenerCargasEnCurso() : Promise.resolve<EstadoCargaDto[] | null>(null),
        ]);
        if (contador.status === 'fulfilled') {
            setNoLeidas(contador.value.noLeidas);
            hidratadoRef.current = true;
        }
        if (cargas.status === 'fulfilled' && cargas.value !== null && pedido > ultimoAplicadoRef.current) {
            ultimoAplicadoRef.current = pedido;
            const lista = cargas.value;
            setImportsEnCurso((prev) =>
                aplicarListaServidor(prev, lista, inicio, recibidoEnRef.current, terminadasRef.current),
            );
            ultimaNovedadRef.current = Date.now();
        }
        // Offline o error de servidor: se reintenta con la próxima conexión, al volver a la pestaña o por polling.
    }, []);

    // Al montar con sesión y cada vez que cambia el token (login sin recargar). Sin sesión se limpia todo.
    useEffect(() => {
        if (!token) {
            hidratadoRef.current = false;
            setNoLeidas(0);
            setImportsEnCurso([]);
            recibidoEnRef.current.clear();
            terminadasRef.current.clear();
            return;
        }
        void hidratar();
    }, [token, hidratar]);

    // Cada conexión del socket (la primera y cada reconexión) puede haber dejado eventos sin recibir.
    useEffect(() => {
        if (conexiones === conexionesPrevRef.current) return;
        conexionesPrevRef.current = conexiones;
        void hidratar();
    }, [conexiones, hidratar]);

    // Volver a la pestaña o recuperar la red.
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') void hidratar();
        };
        const onOnline = () => void hidratar();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [hidratar]);

    // Polling de respaldo: solo si hay alguna carga en la lista (con la lista vacía, lo que empiece con el
    // socket caído aparece al reconectar), y solo si el socket está caído o lleva 30 s callado.
    useEffect(() => {
        const id = setInterval(() => {
            if (!hayCargasRef.current || document.hidden) return;
            const silencio = Date.now() - ultimaNovedadRef.current;
            if (!conectadoRef.current || silencio >= SILENCIO_MS) void hidratar();
        }, POLL_LISTA_MS);
        return () => clearInterval(id);
    }, [hidratar]);

    useEffect(() => {
        if (!socket) return;

        const onNotificacionNueva = (data: SocketNotificacionNueva) => {
            setNoLeidas((prev) => prev + 1);
            setNonce((n) => n + 1);
            if (!hidratadoRef.current) return;
            // Severidad: un error es error; un resultado que no es limpio es advertencia; el resto, info.
            if (data.tipo === 'IMPORTACION_ERROR') {
                notifyRef.current.error(data.titulo);
            } else if (resultadoEsAdvertencia(data.payload?.resultado)) {
                notifyRef.current.warning(data.titulo);
            } else {
                notifyRef.current.info(data.titulo);
            }
        };

        const onContador = (data: SocketContador) => {
            setNoLeidas(data.noLeidas);
        };

        // iniciada y progreso: upsert (agrega la remesa si no estaba); si el estado ya no está en curso, la saca.
        const onEstadoEnCurso = (data: unknown) => {
            if (!esEstadoCarga(data)) return;
            const ahora = Date.now();
            ultimaNovedadRef.current = ahora;
            const revTerminal = terminadasRef.current.get(data.remesaId);
            if (revTerminal !== undefined && data.rev <= revTerminal) return;
            recibidoEnRef.current.set(data.remesaId, ahora);
            setImportsEnCurso((prev) => {
                if (!data.enCurso) return prev.filter((i) => i.remesaId !== data.remesaId);
                const existe = prev.some((i) => i.remesaId === data.remesaId);
                if (!existe) return [...prev, data];
                return prev.map((i) => (i.remesaId === data.remesaId ? fusionarEstadoCarga(i, data) : i));
            });
        };

        const onImportFinalizada = (data: unknown) => {
            if (!esEstadoCarga(data)) return;
            ultimaNovedadRef.current = Date.now();
            recibidoEnRef.current.set(data.remesaId, Date.now());
            terminadasRef.current.set(data.remesaId, data.rev);
            setImportsEnCurso((prev) => prev.filter((i) => i.remesaId !== data.remesaId));
        };

        socket.on('notificacion:nueva', onNotificacionNueva);
        socket.on('notificacion:contador', onContador);
        EVENTOS_ENCURSO.forEach((ev) => socket.on(ev, onEstadoEnCurso));
        socket.on('import:finalizada', onImportFinalizada);

        return () => {
            socket.off('notificacion:nueva', onNotificacionNueva);
            socket.off('notificacion:contador', onContador);
            EVENTOS_ENCURSO.forEach((ev) => socket.off(ev, onEstadoEnCurso));
            socket.off('import:finalizada', onImportFinalizada);
        };
    }, [socket]);

    const marcarLeida = useCallback(async (id: number) => {
        await apiMarcarLeida(id);
        setNoLeidas((prev) => Math.max(0, prev - 1));
        setNonce((n) => n + 1);
    }, []);

    const marcarTodas = useCallback(async () => {
        await apiMarcarTodas();
        setNoLeidas(0);
        setNonce((n) => n + 1);
    }, []);

    const refrescar = useCallback(async () => {
        await hidratar();
        setNonce((n) => n + 1);
    }, [hidratar]);

    const value = useMemo<NotificacionesContextValue>(
        () => ({ noLeidas, importsEnCurso, nonce, marcarLeida, marcarTodas, refrescar }),
        [noLeidas, importsEnCurso, nonce, marcarLeida, marcarTodas, refrescar],
    );

    return (
        <NotificacionesContext.Provider value={value}>{children}</NotificacionesContext.Provider>
    );
};

export const useNotificaciones = (): NotificacionesContextValue => {
    const ctx = useContext(NotificacionesContext);
    if (!ctx) throw new Error('useNotificaciones debe usarse dentro de <NotificacionesProvider>');
    return ctx;
};
