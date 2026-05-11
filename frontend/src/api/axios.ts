// src/api/axios.ts
import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
});

// Interceptor de request: agrega JWT Bearer
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('amsa_token') || localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Interceptor de respuesta: redirige en 401
// Los errores 5xx y network errors se manejan en setupAxiosInterceptors.ts
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error.response?.status;
        if (status === 401) {
            localStorage.removeItem('amsa_token');
            localStorage.removeItem('amsa_usuario');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    },
);

export default api;
