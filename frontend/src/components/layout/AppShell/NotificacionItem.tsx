import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import AssessmentIcon from '@mui/icons-material/Assessment';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useNavigate } from 'react-router-dom';
import { fechaRelativa } from '../../../utils/fechaRelativa';
import { NotificacionDto } from '../../../api/notificaciones';

interface NotificacionItemProps {
    notificacion: NotificacionDto;
    onMarcarLeida: (id: number) => void;
}

function iconoPorTipo(tipo: string): React.ReactElement {
    switch (tipo) {
        case 'IMPORTACION_FINALIZADA':
            return <CheckCircleOutlineIcon fontSize="small" color="success" />;
        case 'IMPORTACION_ERROR':
            return <ErrorOutlineIcon fontSize="small" color="error" />;
        case 'IMPORTACION_INICIADA':
            return <NotificationsIcon fontSize="small" color="primary" />;
        case 'REPORTE_LISTO':
            return <AssessmentIcon fontSize="small" color="primary" />;
        case 'REPORTE_ERROR':
            return <ErrorOutlineIcon fontSize="small" color="error" />;
        case 'CONVENIO_VENCIDO':
            return <WarningAmberIcon fontSize="small" color="warning" />;
        default:
            return <NotificationsIcon fontSize="small" color="action" />;
    }
}

const NotificacionItem: React.FC<NotificacionItemProps> = ({ notificacion, onMarcarLeida }) => {
    const theme = useTheme();
    const navigate = useNavigate();

    const handleClick = () => {
        if (!notificacion.leida) {
            onMarcarLeida(notificacion.id);
        }
        if (notificacion.rutaAccion) {
            navigate(notificacion.rutaAccion);
        }
    };

    return (
        <Box
            onClick={handleClick}
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                px: 2,
                py: 1.5,
                cursor: notificacion.rutaAccion ? 'pointer' : 'default',
                bgcolor: notificacion.leida ? 'transparent' : theme.palette.action.hover,
                borderBottom: `1px solid ${theme.palette.divider}`,
                '&:last-child': { borderBottom: 'none' },
                '&:hover': {
                    bgcolor: theme.palette.action.selected,
                },
                transition: 'background-color 0.15s',
            }}
        >
            <Box sx={{ mt: 0.25, flexShrink: 0 }}>{iconoPorTipo(notificacion.tipo)}</Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography
                    variant="body2"
                    fontWeight={notificacion.leida ? 400 : 600}
                    noWrap
                >
                    {notificacion.titulo}
                </Typography>
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', whiteSpace: 'normal', lineHeight: 1.4 }}
                >
                    {notificacion.mensaje}
                </Typography>
                <Typography variant="caption" color="text.disabled" sx={{ mt: 0.25, display: 'block' }}>
                    {fechaRelativa(notificacion.creadoEn)}
                </Typography>
            </Box>
            {!notificacion.leida && (
                <Box
                    sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: 'primary.main',
                        flexShrink: 0,
                        mt: 0.75,
                    }}
                />
            )}
        </Box>
    );
};

export default NotificacionItem;
