import React, { useEffect } from 'react';
import { CssBaseline } from '@mui/material';
import { SnackbarProvider } from 'notistack';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ColorModeProvider } from './ColorModeContext';
import { ConfirmProvider } from './ConfirmContext';
import { PageMetaProvider } from './PageMetaContext';
import { AuthProvider } from './AuthContext';
import { SocketProvider } from './SocketContext';
import { NotificacionesProvider } from './NotificacionesContext';
import { setupAxiosInterceptors } from '../api/setupAxiosInterceptors';
import { useNotify } from '../hooks/useNotify';

/**
 * Componente interno con acceso a useNotify (ya dentro de SnackbarProvider).
 * Registra el interceptor global de errores axios.
 */
const AxiosInterceptorSetup: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const notify = useNotify();

    useEffect(() => {
        const cleanup = setupAxiosInterceptors((error) => notify.error(error as never));
        return cleanup;
    }, []);

    return <>{children}</>;
};

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
            <ColorModeProvider>
                <CssBaseline />
                <SnackbarProvider
                    maxSnack={4}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    autoHideDuration={4000}
                >
                    <ConfirmProvider>
                        <PageMetaProvider>
                            <BrowserRouter>
                                <AuthProvider>
                                    <SocketProvider>
                                        <NotificacionesProvider>
                                            <AxiosInterceptorSetup>
                                                {children}
                                            </AxiosInterceptorSetup>
                                        </NotificacionesProvider>
                                    </SocketProvider>
                                </AuthProvider>
                            </BrowserRouter>
                        </PageMetaProvider>
                    </ConfirmProvider>
                </SnackbarProvider>
            </ColorModeProvider>
        </GoogleOAuthProvider>
    );
};
