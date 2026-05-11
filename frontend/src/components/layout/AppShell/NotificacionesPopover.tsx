import React from 'react';
import {
    Box,
    Button,
    Divider,
    Popover,
    Typography,
    useTheme,
} from '@mui/material';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import NotificacionItem from './NotificacionItem';
import ImportEnCursoItem from './ImportEnCursoItem';
import { useNotificaciones } from '../../../context/NotificacionesContext';

interface NotificacionesPopoverProps {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
}

const NotificacionesPopover: React.FC<NotificacionesPopoverProps> = ({
    anchorEl,
    open,
    onClose,
}) => {
    const theme = useTheme();
    const { notificaciones, noLeidas, importsEnCurso, marcarLeida, marcarTodas } =
        useNotificaciones();

    const handleMarcarLeida = async (id: number) => {
        await marcarLeida(id);
    };

    const handleMarcarTodas = async () => {
        await marcarTodas();
    };

    const hayContenido = notificaciones.length > 0 || importsEnCurso.length > 0;

    return (
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{
                sx: {
                    width: 360,
                    maxHeight: 520,
                    display: 'flex',
                    flexDirection: 'column',
                    mt: 1,
                    borderRadius: 2,
                    boxShadow: theme.shadows[8],
                },
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    px: 2,
                    py: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                }}
            >
                <Typography variant="subtitle1" fontWeight={700}>
                    Notificaciones
                    {noLeidas > 0 && (
                        <Typography
                            component="span"
                            variant="caption"
                            sx={{
                                ml: 1,
                                bgcolor: 'primary.main',
                                color: 'primary.contrastText',
                                borderRadius: '10px',
                                px: 0.75,
                                py: 0.2,
                                fontWeight: 700,
                            }}
                        >
                            {noLeidas}
                        </Typography>
                    )}
                </Typography>
                {noLeidas > 0 && (
                    <Button size="small" onClick={handleMarcarTodas} sx={{ fontSize: '0.75rem' }}>
                        Marcar todas
                    </Button>
                )}
            </Box>

            <Divider />

            {/* Contenido scrolleable */}
            <Box sx={{ overflowY: 'auto', flexGrow: 1 }}>
                {!hayContenido && (
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            py: 5,
                            gap: 1.5,
                            color: 'text.secondary',
                        }}
                    >
                        <NotificationsOffIcon sx={{ fontSize: 40, opacity: 0.4 }} />
                        <Typography variant="body2" color="text.secondary">
                            Sin notificaciones
                        </Typography>
                    </Box>
                )}

                {importsEnCurso.length > 0 && (
                    <>
                        <Box sx={{ px: 2, py: 1, bgcolor: theme.palette.action.hover }}>
                            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Importaciones en curso ({importsEnCurso.length})
                            </Typography>
                        </Box>
                        {importsEnCurso.map((imp) => (
                            <ImportEnCursoItem
                                key={imp.remesaId}
                                remesaId={imp.remesaId}
                                tipo={imp.tipo}
                                progreso={imp.progreso}
                                okFilas={imp.okFilas}
                                errFilas={imp.errFilas}
                                totalFilas={imp.totalFilas}
                                usuarioNombre={imp.usuarioNombre}
                                estadoProceso={imp.estadoProceso}
                            />
                        ))}
                    </>
                )}

                {notificaciones.length > 0 && (
                    <>
                        {importsEnCurso.length > 0 && <Divider />}
                        <Box sx={{ px: 2, py: 1, bgcolor: theme.palette.action.hover }}>
                            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Historial
                            </Typography>
                        </Box>
                        {notificaciones.map((n) => (
                            <NotificacionItem
                                key={n.id}
                                notificacion={n}
                                onMarcarLeida={handleMarcarLeida}
                            />
                        ))}
                    </>
                )}
            </Box>
        </Popover>
    );
};

export default NotificacionesPopover;
