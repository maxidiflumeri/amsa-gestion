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
    obtenerImportsEnCurso,
    marcarLeida as apiMarcarLeida,
    marcarTodas as apiMarcarTodas,
} from '../api/notificaciones';
import { useSocket } from './SocketContext';
import { useNotify } from '../hooks/useNotify';

interface ImportProgreso {
    remesaId: number;
    tipo: string;
    totalFilas: number;
    progreso: number;
    okFilas: number;
    errFilas: number;
    estadoProceso: string;
    usuarioId: number;
    usuarioNombre: string;
    startedAt: string;
}

interface NotificacionesContextValue {
    /** Cantidad real de notificaciones sin leer (badge). */
    noLeidas: number;
    importsEnCurso: ImportProgreso[];
    /** Cambia cada vez que hay novedades (notif nueva, marcar leída/todas). El popover lo observa para recargar su lista paginada. */
    nonce: number;
    marcarLeida: (id: number) => Promise<void>;
    marcarTodas: () => Promise<void>;
    refrescar: () => Promise<void>;
}

const NotificacionesContext = createContext<NotificacionesContextValue | null>(null);

interface SocketImportIniciada {
    remesaId: number;
    tipo: string;
    totalFilas: number;
    usuarioId: number;
    usuarioNombre: string;
    startedAt: string;
}

interface SocketImportProgreso {
    remesaId: number;
    progreso: number;
    okFilas: number;
    errFilas: number;
    totalFilas: number;
    estadoProceso: string;
    usuarioId: number;
    usuarioNombre: string;
}

interface SocketImportFinalizada {
    remesaId: number;
    okFilas: number;
    errFilas: number;
    totalFilas: number;
    durationMs: number;
    estadoProceso: string;
}

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

export const NotificacionesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { socket } = useSocket();
    const notify = useNotify();

    const [noLeidas, setNoLeidas] = useState(0);
    const [importsEnCurso, setImportsEnCurso] = useState<ImportProgreso[]>([]);
    const [nonce, setNonce] = useState(0);
    const hidratadoRef = useRef(false);

    const hidratar = useCallback(async () => {
        const hayToken = !!localStorage.getItem('amsa_token');
        if (!hayToken) return;
        try {
            // El contador (badge) y la lista paginada (popover) salen del backend.
            // Acá solo hidratamos el contador y las importaciones en curso.
            const [contador, imports] = await Promise.all([
                obtenerContador(),
                obtenerImportsEnCurso(),
            ]);
            setNoLeidas(contador.noLeidas);
            setImportsEnCurso(imports.map((imp) => ({ ...imp })));
            hidratadoRef.current = true;
        } catch {
            // Error silencioso en hidratación — se reintentará en próxima conexión
        }
    }, []);

    useEffect(() => {
        hidratar();
    }, [hidratar]);

    useEffect(() => {
        if (!socket) return;

        const onNotificacionNueva = (data: SocketNotificacionNueva) => {
            setNoLeidas((prev) => prev + 1);
            setNonce((n) => n + 1);
            if (hidratadoRef.current) {
                notify.info(data.titulo);
            }
        };

        const onContador = (data: SocketContador) => {
            setNoLeidas(data.noLeidas);
        };

        const onImportIniciada = (data: SocketImportIniciada) => {
            setImportsEnCurso((prev) => {
                const existe = prev.some((i) => i.remesaId === data.remesaId);
                if (existe) return prev;
                return [
                    ...prev,
                    {
                        remesaId: data.remesaId,
                        tipo: data.tipo,
                        totalFilas: data.totalFilas,
                        progreso: 0,
                        okFilas: 0,
                        errFilas: 0,
                        estadoProceso: 'PROCESANDO',
                        usuarioId: data.usuarioId,
                        usuarioNombre: data.usuarioNombre,
                        startedAt: data.startedAt,
                    },
                ];
            });
        };

        const onImportProgreso = (data: SocketImportProgreso) => {
            setImportsEnCurso((prev) =>
                prev.map((imp) =>
                    imp.remesaId === data.remesaId
                        ? {
                              ...imp,
                              progreso: data.progreso,
                              okFilas: data.okFilas,
                              errFilas: data.errFilas,
                              totalFilas: data.totalFilas,
                              estadoProceso: data.estadoProceso,
                          }
                        : imp,
                ),
            );
        };

        const onImportFinalizada = (data: SocketImportFinalizada) => {
            setImportsEnCurso((prev) => prev.filter((imp) => imp.remesaId !== data.remesaId));
        };

        socket.on('notificacion:nueva', onNotificacionNueva);
        socket.on('notificacion:contador', onContador);
        socket.on('import:iniciada', onImportIniciada);
        socket.on('import:progreso', onImportProgreso);
        socket.on('import:finalizada', onImportFinalizada);

        return () => {
            socket.off('notificacion:nueva', onNotificacionNueva);
            socket.off('notificacion:contador', onContador);
            socket.off('import:iniciada', onImportIniciada);
            socket.off('import:progreso', onImportProgreso);
            socket.off('import:finalizada', onImportFinalizada);
        };
    }, [socket, notify]);

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
