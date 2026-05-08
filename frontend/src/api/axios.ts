// src/api/axios.ts
import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

// Interceptor de request: agrega token y headers de usuario
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    try {
        const raw = localStorage.getItem('usuario');
        if (raw) {
            const usuario = JSON.parse(raw);
            if (usuario?.id) {
                config.headers['x-usuario-id'] = String(usuario.id);
            }
            if (usuario?.empresaId) {
                config.headers['x-empresa-id'] = String(usuario.empresaId);
            }
        }
    } catch {
        /* ignore */
    }
    return config;
});

// Interceptor de respuesta: redirige en 401/403.
// Los errores 5xx y network errors se manejan en setupAxiosInterceptors.ts
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('usuario');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    },
);

export default api;
