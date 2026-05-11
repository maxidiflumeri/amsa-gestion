import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api/axios';

export interface UsuarioAuth {
    id: number;
    nombre: string;
    email: string;
    avatarUrl?: string | null;
    rol: string;
    permisos: string[];
}

interface AuthContextValue {
    usuario: UsuarioAuth | null;
    token: string | null;
    cargando: boolean;
    login: (idToken: string) => Promise<void>;
    logout: () => void;
    tienePermiso: (key: string) => boolean;
    tieneAlguno: (...keys: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [usuario, setUsuario] = useState<UsuarioAuth | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);

    // Inicializar desde localStorage
    useEffect(() => {
        try {
            const storedToken = localStorage.getItem('amsa_token');
            const storedUser = localStorage.getItem('amsa_usuario');
            if (storedToken && storedUser) {
                setToken(storedToken);
                setUsuario(JSON.parse(storedUser));
            }
        } catch {
            localStorage.removeItem('amsa_token');
            localStorage.removeItem('amsa_usuario');
        } finally {
            setCargando(false);
        }
    }, []);

    const login = useCallback(async (idToken: string) => {
        const { data } = await api.post<{ token: string; usuario: UsuarioAuth }>('/auth/google', { idToken });
        localStorage.setItem('amsa_token', data.token);
        localStorage.setItem('amsa_usuario', JSON.stringify(data.usuario));
        setToken(data.token);
        setUsuario(data.usuario);
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem('amsa_token');
        localStorage.removeItem('amsa_usuario');
        setToken(null);
        setUsuario(null);
    }, []);

    const tienePermiso = useCallback(
        (key: string) => {
            if (!usuario) return false;
            return usuario.permisos.includes(key);
        },
        [usuario],
    );

    const tieneAlguno = useCallback(
        (...keys: string[]) => {
            if (!usuario) return false;
            return keys.some((k) => usuario.permisos.includes(k));
        },
        [usuario],
    );

    const value = useMemo<AuthContextValue>(
        () => ({ usuario, token, cargando, login, logout, tienePermiso, tieneAlguno }),
        [usuario, token, cargando, login, logout, tienePermiso, tieneAlguno],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
    return ctx;
};
