import React, { useEffect, useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { useSocket } from '../../../context/SocketContext';
import { GRACIA_INDICADOR_MS } from '../../../utils/estadoCarga';

/**
 * Aviso en la barra superior de que el tiempo real no está llegando. No muestra nada si hay conexión
 * o no hay sesión, ni durante los primeros segundos de un corte (una reconexión normal no tiene que parpadear).
 */
const ConexionIndicador: React.FC = () => {
    const { estado, desconectadoDesde, inestable } = useSocket();
    const [, forzarRender] = useState(0);

    // "Conectado" un instante no cuenta si las conexiones se caen apenas se establecen (`inestable`).
    const sinConexion = estado === 'conectando' || estado === 'reconectando' || (estado === 'conectado' && inestable);

    // Cuando se cumple la gracia hay que volver a evaluar, aunque no cambie ningún estado.
    useEffect(() => {
        if (!sinConexion || desconectadoDesde === null) return;
        const restante = GRACIA_INDICADOR_MS - (Date.now() - desconectadoDesde);
        if (restante <= 0) return;
        const id = setTimeout(() => forzarRender((n) => n + 1), restante + 50);
        return () => clearTimeout(id);
    }, [sinConexion, desconectadoDesde]);

    if (!sinConexion || desconectadoDesde === null) return null;
    if (Date.now() - desconectadoDesde < GRACIA_INDICADOR_MS) return null;

    return (
        <Tooltip title="Sin conexión en tiempo real. Reintentando…">
            <Box
                role="status"
                aria-label="Sin conexión en tiempo real"
                sx={{ display: 'flex', alignItems: 'center', color: 'warning.main', px: 0.5 }}
            >
                <CloudOffIcon fontSize="small" />
            </Box>
        </Tooltip>
    );
};

export default ConexionIndicador;
