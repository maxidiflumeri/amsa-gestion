import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { isAxiosError } from 'axios';
import { useAuth } from './AuthContext';
import { obtenerContador } from '../api/notificaciones';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)
    ?.replace(/\/api$/, '') ?? 'http://localhost:3001';

/** Espera entre intentos de recuperación tras un corte que socket.io no reintenta solo. */
const ESPERAS_RECUPERACION_MS = [2_000, 5_000, 15_000, 30_000];
/** Una conexión que dura más que esto se considera estable: la espera vuelve a empezar. */
const CONEXION_ESTABLE_MS = 10_000;
/** Una conexión que no sobrevive esto (el server la rechaza apenas la acepta) es un rebote, no una reconexión. */
const CONEXION_FUGAZ_MS = 3_000;

export type EstadoConexion = 'sin_sesion' | 'conectando' | 'conectado' | 'reconectando';

interface SocketContextValue {
    socket: Socket | null;
    conectado: boolean;
    estado: EstadoConexion;
    /** Sube en cada `connect`: el primero y cada reconexión. Es el disparador de la re-hidratación. */
    conexiones: number;
    /**
     * Epoch ms desde que se perdió la conexión. Se limpia cuando una conexión se sostiene unos segundos, no
     * en cada `connect`: un server que acepta y rechaza en cada intento no reinicia la cuenta. Null si no hay
     * sesión o la conexión es estable.
     */
    desconectadoDesde: number | null;
    /** true mientras las conexiones se caen apenas se establecen. `conectado` puede estar en true un instante. */
    inestable: boolean;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { token } = useAuth();
    const [socket, setSocket] = useState<Socket | null>(null);
    const [estado, setEstado] = useState<EstadoConexion>('sin_sesion');
    const [conexiones, setConexiones] = useState(0);
    const [desconectadoDesde, setDesconectadoDesde] = useState<number | null>(null);
    const [inestable, setInestable] = useState(false);

    useEffect(() => {
        if (!token) {
            setSocket(null);
            setEstado('sin_sesion');
            setDesconectadoDesde(null);
            setInestable(false);
            return;
        }

        let activo = true;
        let recuperando = false;
        let intento = 0;
        let conectadoEn: number | null = null;
        // Último momento en que se conectó, o se intentó conectar: separa los intentos que rebotan.
        let ultimaConexionEn = 0;
        let fallosVerificacion = 0;
        let timerEstable: ReturnType<typeof setTimeout> | null = null;
        const timers = new Set<ReturnType<typeof setTimeout>>();

        const nuevoSocket = io(`${BASE_URL}/rt`, {
            // Función: cada intento de conexión usa el token vigente, no el que había al crear el socket.
            auth: (cb) => cb({ token: localStorage.getItem('amsa_token') }),
            autoConnect: false,
            transports: ['websocket'],
        });

        const dormir = (ms: number) =>
            new Promise<void>((resolve) => {
                const t = setTimeout(() => {
                    timers.delete(t);
                    resolve();
                }, ms);
                timers.add(t);
            });

        const esperaVerificacion = () => {
            const espera = ESPERAS_RECUPERACION_MS[Math.min(fallosVerificacion, ESPERAS_RECUPERACION_MS.length - 1)];
            fallosVerificacion += 1;
            return espera;
        };

        const esperaEntreIntentos = () => {
            const espera = ESPERAS_RECUPERACION_MS[Math.min(intento, ESPERAS_RECUPERACION_MS.length - 1)];
            intento += 1;
            return espera;
        };

        /**
         * El server cerró la conexión (token vencido, usuario inactivo, error en el handshake) y
         * socket.io no reintenta solo. Se verifica la sesión con un pedido autenticado y barato:
         * 401 -> el interceptor de axios.ts ya mandó a /login; 200 -> se reconecta enseguida, salvo que
         * la conexión anterior haya rebotado hace poco (ahí se espera el escalón); error de red -> se
         * reintenta la verificación con espera creciente.
         */
        const recuperar = async () => {
            if (!activo || recuperando) return;
            recuperando = true;
            try {
                while (activo) {
                    try {
                        await obtenerContador();
                    } catch (e) {
                        if (isAxiosError(e) && e.response?.status === 401) return;
                        await dormir(esperaVerificacion());
                        continue;
                    }
                    fallosVerificacion = 0;
                    const restante = esperaEntreIntentos() - (Date.now() - ultimaConexionEn);
                    if (restante > 0) await dormir(restante);
                    if (activo && !nuevoSocket.connected) {
                        ultimaConexionEn = Date.now();
                        nuevoSocket.connect();
                    }
                    return;
                }
            } finally {
                recuperando = false;
            }
        };

        const marcarDesconectado = () => {
            setEstado('reconectando');
            setDesconectadoDesde((prev) => prev ?? Date.now());
        };

        nuevoSocket.on('connect', () => {
            if (!activo) return;
            conectadoEn = Date.now();
            ultimaConexionEn = conectadoEn;
            setEstado('conectado');
            setConexiones((n) => n + 1);
            // La pérdida solo se da por terminada si la conexión se sostiene: un server que acepta y rechaza
            // en cada intento no tiene que reiniciar la cuenta del indicador cada vez.
            if (timerEstable) clearTimeout(timerEstable);
            timerEstable = setTimeout(() => {
                if (!activo || !nuevoSocket.connected) return;
                setDesconectadoDesde(null);
                setInestable(false);
            }, CONEXION_FUGAZ_MS);
        });

        nuevoSocket.on('disconnect', (reason) => {
            if (!activo) return;
            if (timerEstable) clearTimeout(timerEstable);
            const vivio = conectadoEn !== null ? Date.now() - conectadoEn : null;
            if (vivio !== null && vivio > CONEXION_ESTABLE_MS) intento = 0;
            if (vivio !== null && vivio < CONEXION_FUGAZ_MS) setInestable(true);
            conectadoEn = null;
            // 'io client disconnect' es el logout o el desmontaje: no hay nada que recuperar.
            if (reason === 'io client disconnect') return;
            marcarDesconectado();
            if (reason === 'io server disconnect') void recuperar();
        });

        nuevoSocket.on('connect_error', () => {
            if (!activo) return;
            marcarDesconectado();
            // El server rechazó y socket.io abandonó: no va a reintentar solo.
            if (!nuevoSocket.active) void recuperar();
        });

        setSocket(nuevoSocket);
        setEstado('conectando');
        setDesconectadoDesde(Date.now());
        ultimaConexionEn = Date.now();
        nuevoSocket.connect();

        return () => {
            activo = false;
            if (timerEstable) clearTimeout(timerEstable);
            timers.forEach(clearTimeout);
            timers.clear();
            nuevoSocket.disconnect();
            setSocket(null);
        };
    }, [token]);

    const value = useMemo<SocketContextValue>(
        () => ({
            socket,
            conectado: estado === 'conectado',
            estado,
            conexiones,
            desconectadoDesde,
            inestable,
        }),
        [socket, estado, conexiones, desconectadoDesde, inestable],
    );

    return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = (): SocketContextValue => {
    const ctx = useContext(SocketContext);
    if (!ctx) throw new Error('useSocket debe usarse dentro de <SocketProvider>');
    return ctx;
};
