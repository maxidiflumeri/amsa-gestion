import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    Divider,
    IconButton,
    Popover,
    Tab,
    Tabs,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import NotificacionItem from './NotificacionItem';
import ImportEnCursoItem from './ImportEnCursoItem';
import { useNotificaciones } from '../../../context/NotificacionesContext';
import { useSocket } from '../../../context/SocketContext';
import { listarNotificaciones, NotificacionDto } from '../../../api/notificaciones';

interface NotificacionesPopoverProps {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
}

const PAGE = 20;

const NotificacionesPopover: React.FC<NotificacionesPopoverProps> = ({
    anchorEl,
    open,
    onClose,
}) => {
    const theme = useTheme();
    const celular = useMediaQuery(theme.breakpoints.down('sm'));
    const { noLeidas, importsEnCurso, marcarLeida, marcarTodas, nonce, refrescar } = useNotificaciones();
    const { conectado } = useSocket();

    const [tab, setTab] = useState(0); // 0 = sin leer, 1 = leídas
    const [items, setItems] = useState<NotificacionDto[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const offsetRef = useRef(0);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    const cargar = useCallback(
        async (reset: boolean) => {
            const offset = reset ? 0 : offsetRef.current;
            setLoading(true);
            try {
                const resp = await listarNotificaciones({
                    soloNoLeidas: tab === 0,
                    soloLeidas: tab === 1,
                    limit: PAGE,
                    offset,
                });
                setTotal(resp.total);
                offsetRef.current = offset + resp.data.length;
                setItems((prev) => (reset ? resp.data : [...prev, ...resp.data]));
            } catch {
                // silencioso; el usuario puede reabrir
            } finally {
                setLoading(false);
            }
        },
        [tab],
    );

    // Recargar desde cero al abrir, cambiar de tab, o cuando hay novedades (nonce).
    useEffect(() => {
        if (!open) return;
        offsetRef.current = 0;
        cargar(true);
    }, [open, tab, nonce, cargar]);

    const hasMore = items.length < total;

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el || loading || !hasMore) return;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
            cargar(false);
        }
    };

    const handleMarcarLeida = async (id: number) => {
        await marcarLeida(id); // dispara nonce → recarga el tab actual
    };

    const handleMarcarTodas = async () => {
        await marcarTodas();
    };

    // Lo que cambia entre el popover (escritorio) y la pantalla completa (celular) es solo el marco y la cabecera.
    const cuerpo = (
        <>
            {/* Importaciones en curso (transitorio, fuera de los tabs) */}
            {importsEnCurso.length > 0 && (
                <>
                    <Divider />
                    <Box sx={{ px: 2, py: 1, bgcolor: theme.palette.action.hover }}>
                        <Typography
                            variant="caption"
                            fontWeight={700}
                            color="text.secondary"
                            sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
                        >
                            Importaciones en curso ({importsEnCurso.length})
                        </Typography>
                    </Box>
                    {/* Con su propio scroll y un tope de alto: con una carga dividida son cinco tarjetas o más y, sin
                        tope, aplastaban la lista de notificaciones a 0 px y no se podía scrollear (16/10/2026). */}
                    <Box
                        data-testid="campanita-en-curso"
                        sx={{ maxHeight: 'min(240px, 40vh)', overflowY: 'auto', flexShrink: 0 }}
                    >
                        {importsEnCurso.map((imp) => (
                            <ImportEnCursoItem
                                key={imp.remesaId}
                                carga={imp}
                                conectado={conectado}
                                hermanasEnCurso={imp.grupoId != null ? importsEnCurso.filter((i) => i.grupoId === imp.grupoId) : undefined}
                                onRefrescar={() => void refrescar()}
                                onNavegar={onClose}
                            />
                        ))}
                    </Box>
                    {!conectado && (
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', px: 2, py: 0.75 }}
                        >
                            Sin conexión en tiempo real — actualizando cada 15 s.
                        </Typography>
                    )}
                </>
            )}

            {/* Tabs */}
            <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                variant="fullWidth"
                sx={{ borderTop: `1px solid ${theme.palette.divider}`, minHeight: 40, flexShrink: 0 }}
            >
                <Tab label={`Sin leer${noLeidas > 0 ? ` (${noLeidas})` : ''}`} sx={{ minHeight: 40, fontSize: '0.8rem' }} />
                <Tab label="Leídas" sx={{ minHeight: 40, fontSize: '0.8rem' }} />
            </Tabs>
            <Divider />

            {/* Lista scrolleable: siempre conserva lugar, aunque haya muchas importaciones en curso arriba. */}
            <Box
                ref={scrollRef}
                onScroll={handleScroll}
                data-testid="campanita-lista"
                sx={{ overflowY: 'auto', flexGrow: 1, minHeight: 160 }}
            >
                {items.length === 0 && !loading && (
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
                            {tab === 0 ? 'No tenés notificaciones sin leer' : 'No hay notificaciones leídas'}
                        </Typography>
                    </Box>
                )}

                {items.map((n) => (
                    <NotificacionItem key={n.id} notificacion={n} onMarcarLeida={handleMarcarLeida} onNavegar={onClose} />
                ))}

                {loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                        <CircularProgress size={20} />
                    </Box>
                )}
            </Box>
        </>
    );

    if (celular) {
        return (
            <Dialog fullScreen open={open} onClose={onClose} aria-labelledby="notificaciones-titulo">
                <Box
                    sx={{
                        px: 2,
                        py: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        flexShrink: 0,
                        borderBottom: `1px solid ${theme.palette.divider}`,
                    }}
                >
                    <Typography id="notificaciones-titulo" variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1 }}>
                        Notificaciones
                    </Typography>
                    {noLeidas > 0 && (
                        <Button size="small" onClick={handleMarcarTodas} sx={{ fontSize: '0.75rem' }}>
                            Marcar todas
                        </Button>
                    )}
                    <IconButton aria-label="Cerrar" onClick={onClose} edge="end">
                        <CloseIcon />
                    </IconButton>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
                    {cuerpo}
                </Box>
            </Dialog>
        );
    }

    return (
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{
                sx: {
                    width: { xs: '100%', sm: 380 },
                    maxWidth: 'calc(100vw - 16px)',
                    maxHeight: 560,
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
                </Typography>
                {noLeidas > 0 && (
                    <Button size="small" onClick={handleMarcarTodas} sx={{ fontSize: '0.75rem' }}>
                        Marcar todas
                    </Button>
                )}
            </Box>

            {cuerpo}
        </Popover>
    );
};

export default NotificacionesPopover;
