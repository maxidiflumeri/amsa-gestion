import React, { useState } from 'react';
import { Badge, IconButton, Tooltip } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useNotificaciones } from '../../../context/NotificacionesContext';
import NotificacionesPopover from './NotificacionesPopover';

const NotificacionesBell: React.FC = () => {
    const { noLeidas } = useNotificaciones();
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

    const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    return (
        <>
            <Tooltip title="Notificaciones">
                <IconButton
                    onClick={handleOpen}
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
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleClose}
            />
        </>
    );
};

export default NotificacionesBell;
