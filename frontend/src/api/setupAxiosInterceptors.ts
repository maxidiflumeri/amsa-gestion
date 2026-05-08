import api from './axios';
import { AxiosError } from 'axios';

type NotifyErrorFn = (error: AxiosError | Error | string) => void;

let interceptorId: number | null = null;

export function setupAxiosInterceptors(notifyError: NotifyErrorFn): () => void {
    // Eject previous if exists to avoid duplicates
    if (interceptorId !== null) {
        api.interceptors.response.eject(interceptorId);
    }

    interceptorId = api.interceptors.response.use(
        (response) => response,
        (error: AxiosError) => {
            const status = error.response?.status;

            // Solo notificar 5xx y network errors. Los 4xx los manejan los catch de cada página.
            if (!error.response) {
                // Network error o timeout
                notifyError('Sin conexión con el servidor. Verificá tu red o el estado del servicio.');
            } else if (status && status >= 500) {
                notifyError(error);
            }

            return Promise.reject(error);
        },
    );

    return () => {
        if (interceptorId !== null) {
            api.interceptors.response.eject(interceptorId);
            interceptorId = null;
        }
    };
}
