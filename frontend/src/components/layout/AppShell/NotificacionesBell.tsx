import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, IconButton, Tooltip } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useLocation } from 'react-router-dom';
import { useNotificaciones } from '../../../context/NotificacionesContext';
import ChipImportaciones from './ChipImportaciones';
import NotificacionesPopover from './NotificacionesPopover';

const NotificacionesBell: React.FC = () => {
    const { noLeidas } = useNotificaciones();
    const [abierta, setAbierta] = useState(false);
    const botonRef = useRef<HTMLButtonElement | null>(null);
    const { pathname } = useLocation();

    const abrir = useCallback(() => setAbierta(true), []);
    const cerrar = useCallback(() => setAbierta(false), []);

    // Cambiar de página cierra la campanita (también el "atrás" del navegador, que cambia la ruta): D2.
    useEffect(() => {
        setAbierta(false);
    }, [pathname]);

    return (
        <>
            <ChipImportaciones />
            <Tooltip title="Notificaciones">
                <IconButton
                    ref={botonRef}
                    onClick={abrir}
                    size="small"
                    aria-label="Notificaciones"
                    color="inherit"
                >
                    <Badge
                        badgeContent={noLeidas}
                        color="error"
                        max={99}
                        sx={{ '& .MuiBadge-badge': { fontSize: '0.65rem', minWidth: 18, height: 18 } }}
                    >
                        <NotificationsIcon />
                    </Badge>
                </IconButton>
            </Tooltip>

            <NotificacionesPopover
                anchorEl={botonRef.current}
                open={abierta}
                onClose={cerrar}
            />
        </>
    );
};

export default NotificacionesBell;
