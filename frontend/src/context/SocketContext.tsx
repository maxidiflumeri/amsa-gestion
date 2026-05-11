import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)
    ?.replace(/\/api$/, '') ?? 'http://localhost:3001';

interface SocketContextValue {
    socket: Socket | null;
    conectado: boolean;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { token } = useAuth();
    const socketRef = useRef<Socket | null>(null);
    const [conectado, setConectado] = useState(false);

    useEffect(() => {
        if (!token) {
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
                setConectado(false);
            }
            return;
        }

        const socket = io(`${BASE_URL}/rt`, {
            auth: { token },
            autoConnect: false,
            transports: ['websocket'],
        });

        socket.on('connect', () => {
            console.log('[Socket] Conectado al namespace /rt');
            setConectado(true);
        });

        socket.on('disconnect', (reason) => {
            console.log('[Socket] Desconectado:', reason);
            setConectado(false);
        });

        socket.connect();
        socketRef.current = socket;

        return () => {
            socket.disconnect();
            socketRef.current = null;
            setConectado(false);
        };
    }, [token]);

    const value = useMemo<SocketContextValue>(
        () => ({ socket: socketRef.current, conectado }),
        [conectado],
    );

    return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = (): SocketContextValue => {
    const ctx = useContext(SocketContext);
    if (!ctx) throw new Error('useSocket debe usarse dentro de <SocketProvider>');
    return ctx;
};
