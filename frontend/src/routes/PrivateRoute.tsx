import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CircularProgress, Box } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import { estaEmbebido } from '../utils/embebido';
import SesionRequeridaEmbebido from '../components/auth/SesionRequeridaEmbebido';

const PrivateRoute = ({ children }: { children: JSX.Element }) => {
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
        // Dentro de la Toolbar de Neotel no se puede mostrar el login: el botón de Google no
        // funciona en un iframe de otro dominio. Se manda a iniciar sesión en una pestaña aparte.
        if (estaEmbebido()) {
            return <SesionRequeridaEmbebido />;
        }
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return children;
};

export default PrivateRoute;
