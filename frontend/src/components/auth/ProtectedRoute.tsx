import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CircularProgress, Box } from '@mui/material';
import { useAuth } from '../../context/AuthContext';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

/**
 * Ruta protegida: requiere autenticación.
 * Redirige a /login si el usuario no está autenticado.
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
    const { usuario, cargando } = useAuth();
    const location = useLocation();

    if (cargando) {
        return (
            <Box
                sx={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    if (!usuario) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return <>{children}</>;
};

export default ProtectedRoute;
