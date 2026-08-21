import React, { useCallback, useEffect, useState } from 'react';
import {
    AccordionSummary,
    AccordionDetails,
    Accordion,
    Alert,
    Avatar,
    Box,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Link,
    MenuItem,
    Pagination,
    Stack,
    TextField,
    Typography,
    useTheme,
} from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import PhonelinkIcon from '@mui/icons-material/Phonelink';
import EmailIcon from '@mui/icons-material/Email';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import AdsClickIcon from '@mui/icons-material/AdsClick';
import ChatIcon from '@mui/icons-material/Chat';
import { timelineApi } from '../../api/timeline';
import type { TimelineCanal, TimelineEntry, TimelineResponse } from '../../types/timeline';
import { useNotify } from '../../hooks/useNotify';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { emailApi } from '../../api/email';
import type { EnvioEmail } from '../../types/email';

interface Props {
    deudorId: number | null;
}

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

const formatFecha = (iso: string) => {
    if (!iso) return '-';
    try {
        return new Intl.DateTimeFormat('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(iso));
    } catch {
        return iso;
    }
};

const truncate = (text?: string, max = 100) => {
    if (!text) return '';
    return text.length <= max ? text : text.substring(0, max) + '...';
};

const canalLabel = (canal: TimelineCanal) => {
    if (canal === 'whatsapp') return 'WhatsApp Web';
    if (canal === 'wapi') return 'WhatsApp Meta';
    if (canal === 'email') return 'Email';
    return canal;
};

const capitalize = (str: string) => (str ? str.charAt(0).toUpperCase() + str.slice(1) : '');

/**
 * Color del chip de estado.
 *
 * La lista de rojos estaba escrita contra los estados de WhatsApp (`failed`, `bounced`) y **no
 * cubría ninguno de los que escribe Sender para email**: `fallo` (manual-email.service) y `rebote` /
 * `queja` (ses-webhook.service). Un rebote —el dato accionable de toda la solapa— salía en gris
 * neutro, indistinguible de "desconocido".
 */
const estadoColor = (estado?: string): 'default' | 'success' | 'error' | 'warning' | 'info' => {
    if (!estado) return 'default';
    const e = estado.toLowerCase();
    if (['success', 'enviado', 'entregado', 'delivered', 'leido', 'read'].includes(e)) return 'success';
    if (['fallido', 'failed', 'error', 'bounced', 'fallo', 'rebote', 'bounce', 'queja', 'complaint'].includes(e)) return 'error';
    if (['pending', 'pendiente'].includes(e)) return 'warning';
    // No se mandó a propósito: no es un fallo, pero tampoco pasó nada. Naranja para que se note.
    if (['omitido', 'desuscripto', 'unsubscribed'].includes(e)) return 'warning';
    if (e === 'evento') return 'info';
    return 'default';
};

const useIconAndColor = (canal: TimelineCanal, tipo: string) => {
    const theme = useTheme();
    if (canal === 'whatsapp') return { icon: <PhonelinkIcon />, color: '#7B1FA2' };
    if (canal === 'email') {
        if (tipo === 'open') return { icon: <MarkEmailReadIcon />, color: theme.palette.info.main };
        if (tipo === 'click') return { icon: <AdsClickIcon />, color: '#ff9800' };
        return { icon: <EmailIcon />, color: theme.palette.info.main };
    }
    if (canal === 'wapi') return { icon: <WhatsAppIcon />, color: '#25D366' };
    return { icon: <ChatIcon />, color: theme.palette.text.secondary };
};

const TimelineItem: React.FC<{ entry: TimelineEntry }> = ({ entry }) => {
    const theme = useTheme();
    const { icon, color } = useIconAndColor(entry.canal, entry.tipo);
    const chipColor = estadoColor(entry.detalle?.estado);

    return (
        <Card
            sx={{
                mb: 1.5,
                borderLeft: `4px solid ${color}`,
                display: 'flex',
                alignItems: 'flex-start',
            }}
        >
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Avatar sx={{ bgcolor: color, width: 44, height: 44 }}>{icon}</Avatar>
            </Box>
            <CardContent sx={{ flex: 1, py: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                    <Typography variant="body1" fontWeight="bold">
                        {canalLabel(entry.canal)} · {capitalize(entry.tipo)}
                    </Typography>
                    <Chip
                        label={entry.detalle?.estado || 'desconocido'}
                        color={chipColor}
                        size="small"
                        sx={{ fontSize: '0.72rem' }}
                    />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    {formatFecha(entry.fecha)}
                </Typography>

                {entry.detalle?.asunto && (
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        <strong>Asunto:</strong> {truncate(entry.detalle.asunto)}
                    </Typography>
                )}
                {entry.detalle?.mensaje && (
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        <strong>Mensaje:</strong> {truncate(entry.detalle.mensaje)}
                    </Typography>
                )}
                {entry.detalle?.templateNombre && (
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        <strong>Template:</strong> {entry.detalle.templateNombre}
                    </Typography>
                )}
                {entry.detalle?.urlDestino && (
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        <strong>URL:</strong>{' '}
                        <Link href={entry.detalle.urlDestino} target="_blank" rel="noopener noreferrer">
                            {truncate(entry.detalle.urlDestino, 60)}
                        </Link>
                    </Typography>
                )}
                {entry.detalle?.error && (
                    <Typography variant="body2" sx={{ color: theme.palette.error.main, mb: 0.5 }}>
                        <strong>Error:</strong> {truncate(entry.detalle.error)}
                    </Typography>
                )}
                {entry.campaniaNombre && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Campaña: {entry.campaniaNombre}
                    </Typography>
                )}
            </CardContent>
        </Card>
    );
};

/**
 * Los envíos hechos **desde esta ficha**, con los valores que se usaron.
 *
 * `envio_email` es la única fuente que sabe **qué valores se mandaron** en cada variable, y era
 * invisible: los endpoints existían y no los llamaba nadie desde que Timeline reemplazó al tab de
 * "emails enviados". Cuando un mail sale con un dato mal, esto es lo único que lo explica.
 */
const EnviosDeLaFicha: React.FC<{ deudorId: number }> = ({ deudorId }) => {
    const [envios, setEnvios] = useState<EnvioEmail[]>([]);

    useEffect(() => {
        emailApi.listarEnviosDeudor(deudorId).then(setEnvios).catch(() => setEnvios([]));
    }, [deudorId]);

    if (envios.length === 0) return null;

    return (
        <Accordion sx={{ mb: 2 }} disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">
                    Enviados desde esta ficha ({envios.length}) — con los valores que se usaron
                </Typography>
            </AccordionSummary>
            <AccordionDetails>
                {envios.map((e) => (
                    <Box key={e.id} sx={{ mb: 1.5, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="body2" fontWeight={600}>{e.asunto || '(sin asunto)'}</Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                            {new Date(e.creadoAt).toLocaleString()} · {e.destinatarios}
                            {e.usuario?.nombre ? ` · ${e.usuario.nombre}` : ''}
                            {e.estado === 'ERROR' ? ' · falló' : ''}
                        </Typography>
                        {e.archivosNombres?.length > 0 && (
                            <Typography variant="caption" color="text.secondary" display="block">
                                Adjuntos: {e.archivosNombres.join(', ')}
                            </Typography>
                        )}
                        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                            {Object.entries(e.variables || {}).map(([k, v]) => (
                                <Chip
                                    key={k}
                                    size="small"
                                    variant="outlined"
                                    label={`${k}: ${v || '(vacío)'}`}
                                    color={v ? 'default' : 'warning'}
                                />
                            ))}
                        </Stack>
                    </Box>
                ))}
            </AccordionDetails>
        </Accordion>
    );
};

const TimelineDeudorTab: React.FC<Props> = ({ deudorId }) => {
    const notify = useNotify();
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<TimelineResponse | null>(null);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(5);
    const [canal, setCanal] = useState<'' | TimelineCanal>('');
    const [desde, setDesde] = useState<string>('');
    const [hasta, setHasta] = useState<string>('');

    const cargar = useCallback(async () => {
        if (!deudorId) {
            setData(null);
            return;
        }
        setLoading(true);
        try {
            const res = await timelineApi.porDeudor(deudorId, {
                page,
                size: pageSize,
                canal: canal || undefined,
                desde: desde ? new Date(desde).toISOString() : undefined,
                hasta: hasta ? new Date(hasta).toISOString() : undefined,
            });
            setData(res);
        } catch (err) {
            notify.error(err as Error);
        } finally {
            setLoading(false);
        }
    }, [deudorId, page, pageSize, canal, desde, hasta]);

    useEffect(() => {
        cargar();
    }, [cargar]);

    if (!deudorId) {
        return (
            <Box p={2}>
                <Alert severity="info">
                    Seleccioná un deudor en la lista para ver su timeline.
                </Alert>
            </Box>
        );
    }

    return (
        <Box p={2}>
            {deudorId != null && <EnviosDeLaFicha deudorId={deudorId} />}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} mb={2} alignItems={{ sm: 'center' }}>
                <TextField
                    size="small"
                    select
                    label="Canal"
                    value={canal}
                    onChange={(e) => { setCanal(e.target.value as any); setPage(0); }}
                    sx={{ minWidth: 160 }}
                >
                    <MenuItem value="">Todos</MenuItem>
                    <MenuItem value="email">Email</MenuItem>
                    <MenuItem value="whatsapp">WhatsApp Web</MenuItem>
                    <MenuItem value="wapi">WhatsApp Meta</MenuItem>
                </TextField>
                <TextField
                    size="small"
                    type="date"
                    label="Desde"
                    value={desde}
                    onChange={(e) => { setDesde(e.target.value); setPage(0); }}
                    InputLabelProps={{ shrink: true }}
                />
                <TextField
                    size="small"
                    type="date"
                    label="Hasta"
                    value={hasta}
                    onChange={(e) => { setHasta(e.target.value); setPage(0); }}
                    InputLabelProps={{ shrink: true }}
                />
                <TextField
                    size="small"
                    select
                    label="Por página"
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                    sx={{ minWidth: 110 }}
                >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                        <MenuItem key={n} value={n}>{n}</MenuItem>
                    ))}
                </TextField>
                {data && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                        {data.total} resultado{data.total === 1 ? '' : 's'}
                    </Typography>
                )}
            </Stack>

            {loading && (
                <Stack alignItems="center" py={4}>
                    <CircularProgress size={28} />
                </Stack>
            )}

            {!loading && data && data.deudor === null && (
                <Alert severity="info">
                    No se encontró historial en AMSA Sender para este deudor.
                </Alert>
            )}

            {!loading && data && data.deudor && data.data.length === 0 && (
                <Alert severity="info">Sin gestiones registradas con los filtros aplicados.</Alert>
            )}

            {!loading && data && data.data.length > 0 && (
                <>
                    {data.data.map((entry) => (
                        <TimelineItem key={entry.id} entry={entry} />
                    ))}
                    {data.totalPages > 1 && (
                        <Stack alignItems="center" mt={2}>
                            <Pagination
                                count={data.totalPages}
                                page={page + 1}
                                onChange={(_, p) => setPage(p - 1)}
                                size="small"
                            />
                        </Stack>
                    )}
                </>
            )}
        </Box>
    );
};

export default TimelineDeudorTab;
