import { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Divider,
    FormControl,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Typography,
} from '@mui/material';
import { neotelApi, type EstadoAgenteManual } from '../../api/neotel';

type SesionActual = {
    sesionId: number;
    usuarioNeotel: string;
    device: string;
    loginAt: string;
    estado: string;
    campañaActivaId: number | null;
} | null;

type EstadoActual = {
    estado: string;
    desde: string;
    motivoNombre: string | null;
    motivoPausaId: number | null;
} | null;

function formatHMS(ms: number): string {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function colorPorEstado(estado: string): 'success' | 'warning' | 'info' | 'default' | 'error' {
    switch (estado) {
        case 'DISPONIBLE':       return 'success';
        case 'EN_PAUSA':         return 'warning';
        case 'ADMINISTRATIVO':   return 'info';
        case 'EN_LLAMADA':       return 'info';
        case 'WRAP_UP':          return 'info';
        case 'OFFLINE':          return 'default';
        default:                 return 'default';
    }
}

type LogEntry = {
    ts: string;
    label: string;
    ok: boolean;
    body: unknown;
};

const ESTADOS: EstadoAgenteManual[] = ['DISPONIBLE', 'EN_PAUSA', 'ADMINISTRATIVO'];

export default function NeotelTestPage() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [campaignId, setCampaignId] = useState<string>('115');
    const [estado, setEstado] = useState<EstadoAgenteManual>('DISPONIBLE');
    const [motivoPausaId, setMotivoPausaId] = useState<string>('');

    const [sesion, setSesion] = useState<SesionActual>(null);
    const [estadoActual, setEstadoActual] = useState<EstadoActual>(null);
    const [now, setNow] = useState<number>(Date.now());
    const refreshRef = useRef<number | null>(null);

    function pushLog(label: string, ok: boolean, body: unknown) {
        setLogs((prev) => [
            { ts: new Date().toLocaleTimeString(), label, ok, body },
            ...prev,
        ]);
    }

    async function run(label: string, fn: () => Promise<unknown>) {
        try {
            const data = await fn();
            pushLog(label, true, data);
            // Refresco rápido tras cualquier acción que pueda afectar sesión/estado
            void refreshEstado();
            return data;
        } catch (err: any) {
            pushLog(label, false, err?.response?.data ?? err?.message ?? err);
        }
    }

    async function refreshEstado() {
        try {
            const [s, e] = await Promise.all([
                neotelApi.getSesionActual() as Promise<SesionActual>,
                neotelApi.getEstadoActual() as Promise<EstadoActual>,
            ]);
            setSesion(s);
            setEstadoActual(e);
        } catch {
            // Si falla (403, red, etc.) silenciamos — el log de las acciones manuales ya lo muestra
        }
    }

    // Tick de reloj client-side cada 1s
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);

    // Carga inicial + refresh contra backend cada 10s
    useEffect(() => {
        void refreshEstado();
        refreshRef.current = window.setInterval(refreshEstado, 10_000);
        return () => {
            if (refreshRef.current) window.clearInterval(refreshRef.current);
        };
    }, []);

    const loginMs   = sesion       ? now - new Date(sesion.loginAt).getTime()      : 0;
    const estadoMs  = estadoActual ? now - new Date(estadoActual.desde).getTime()  : 0;

    return (
        <Box sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} mb={2}>
                <Typography variant="h5">Neotel — Panel de prueba</Typography>
                <Chip label="TEMPORAL" color="warning" size="small" />
            </Stack>

            <Alert severity="info" sx={{ mb: 2 }}>
                Panel de debug para validar los endpoints de telefonía contra la API real
                de Neotel. Se quita cuando esté el softphone integrado. Las llamadas de
                audio (WebRTC) no se pueden testear desde acá — solo control vía HTTP.
            </Alert>

            <Card sx={{ mb: 2 }}>
                <CardContent>
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={3}
                        alignItems={{ xs: 'flex-start', sm: 'center' }}
                        flexWrap="wrap"
                        useFlexGap
                    >
                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                Sesión
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <Chip
                                    size="small"
                                    label={sesion ? 'CONECTADO' : 'DESCONECTADO'}
                                    color={sesion ? 'success' : 'default'}
                                />
                                {sesion && (
                                    <Typography variant="body2">
                                        {sesion.usuarioNeotel} · {sesion.device}
                                    </Typography>
                                )}
                            </Stack>
                        </Box>

                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                Tiempo logueado
                            </Typography>
                            <Typography
                                variant="h5"
                                fontFamily="monospace"
                                color={sesion ? 'text.primary' : 'text.disabled'}
                            >
                                {sesion ? formatHMS(loginMs) : '--:--:--'}
                            </Typography>
                        </Box>

                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                Estado actual
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <Chip
                                    size="small"
                                    label={estadoActual?.estado ?? '—'}
                                    color={
                                        estadoActual
                                            ? colorPorEstado(estadoActual.estado)
                                            : 'default'
                                    }
                                />
                                {estadoActual?.motivoNombre && (
                                    <Typography variant="body2" color="text.secondary">
                                        ({estadoActual.motivoNombre})
                                    </Typography>
                                )}
                            </Stack>
                        </Box>

                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                Tiempo en estado
                            </Typography>
                            <Typography
                                variant="h5"
                                fontFamily="monospace"
                                color={estadoActual ? 'text.primary' : 'text.disabled'}
                            >
                                {estadoActual ? formatHMS(estadoMs) : '--:--:--'}
                            </Typography>
                        </Box>

                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                Campaña
                            </Typography>
                            <Typography variant="body2">
                                {sesion?.campañaActivaId ?? '—'}
                            </Typography>
                        </Box>

                        <Box sx={{ ml: 'auto' }}>
                            <Button size="small" variant="text" onClick={refreshEstado}>
                                Refrescar
                            </Button>
                        </Box>
                    </Stack>
                </CardContent>
            </Card>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                {/* ─── Columna izquierda: acciones ─── */}
                <Stack spacing={2} sx={{ flex: 1 }}>
                    <Card>
                        <CardContent>
                            <Typography variant="subtitle1" gutterBottom>
                                Credenciales SIP
                            </Typography>
                            <Button
                                variant="outlined"
                                onClick={() =>
                                    run('GET /neotel/sip-credentials', () =>
                                        neotelApi.getSipCredentials(),
                                    )
                                }
                            >
                                Obtener credenciales SIP
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent>
                            <Typography variant="subtitle1" gutterBottom>
                                Sesión
                            </Typography>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                <Button
                                    variant="contained"
                                    onClick={() =>
                                        run('POST /neotel/sesion/login', () =>
                                            neotelApi.login(),
                                        )
                                    }
                                >
                                    Login
                                </Button>
                                <Button
                                    variant="outlined"
                                    color="error"
                                    onClick={() =>
                                        run('POST /neotel/sesion/logout', () =>
                                            neotelApi.logout(),
                                        )
                                    }
                                >
                                    Logout
                                </Button>
                                <Button
                                    variant="text"
                                    onClick={() =>
                                        run('GET /neotel/sesion/actual', () =>
                                            neotelApi.getSesionActual(),
                                        )
                                    }
                                >
                                    Ver sesión actual
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent>
                            <Typography variant="subtitle1" gutterBottom>
                                Estado
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                                <FormControl size="small" sx={{ minWidth: 200 }}>
                                    <InputLabel>Estado</InputLabel>
                                    <Select
                                        label="Estado"
                                        value={estado}
                                        onChange={(e) =>
                                            setEstado(e.target.value as EstadoAgenteManual)
                                        }
                                    >
                                        {ESTADOS.map((e) => (
                                            <MenuItem key={e} value={e}>
                                                {e}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                {estado === 'EN_PAUSA' && (
                                    <FormControl size="small" sx={{ minWidth: 120 }}>
                                        <InputLabel>Motivo ID</InputLabel>
                                        <Select
                                            label="Motivo ID"
                                            value={motivoPausaId}
                                            onChange={(e) =>
                                                setMotivoPausaId(String(e.target.value))
                                            }
                                        >
                                            <MenuItem value="">—</MenuItem>
                                            {[1, 2, 3, 4, 5].map((i) => (
                                                <MenuItem key={i} value={i}>
                                                    {i}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                )}
                                <Button
                                    variant="contained"
                                    onClick={() =>
                                        run('PUT /neotel/estado', () =>
                                            neotelApi.setEstado(
                                                estado,
                                                motivoPausaId
                                                    ? Number(motivoPausaId)
                                                    : undefined,
                                            ),
                                        )
                                    }
                                >
                                    Cambiar estado
                                </Button>
                            </Stack>
                            <Stack direction="row" spacing={1}>
                                <Button
                                    variant="text"
                                    onClick={() =>
                                        run('GET /neotel/estado/actual', () =>
                                            neotelApi.getEstadoActual(),
                                        )
                                    }
                                >
                                    Ver estado actual
                                </Button>
                                <Button
                                    variant="text"
                                    onClick={() =>
                                        run('GET /neotel/motivos-pausa', () =>
                                            neotelApi.listarMotivosPausa(),
                                        )
                                    }
                                >
                                    Listar motivos pausa
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent>
                            <Typography variant="subtitle1" gutterBottom>
                                Campañas
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                                <FormControl size="small" sx={{ minWidth: 120 }}>
                                    <InputLabel>Campaña ID</InputLabel>
                                    <Select
                                        label="Campaña ID"
                                        value={campaignId}
                                        onChange={(e) => setCampaignId(String(e.target.value))}
                                    >
                                        {[115, 116, 117].map((i) => (
                                            <MenuItem key={i} value={i}>
                                                {i}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <Button
                                    variant="contained"
                                    onClick={() =>
                                        run('POST /neotel/campaña/asignar', () =>
                                            neotelApi.asignarCampaña(Number(campaignId)),
                                        )
                                    }
                                >
                                    Asignar
                                </Button>
                                <Button
                                    variant="outlined"
                                    color="error"
                                    onClick={() =>
                                        run('POST /neotel/campaña/desasignar', () =>
                                            neotelApi.desasignarCampaña(),
                                        )
                                    }
                                >
                                    Desasignar
                                </Button>
                            </Stack>
                            <Button
                                variant="text"
                                onClick={() =>
                                    run('GET /neotel/campañas', () =>
                                        neotelApi.listarCampañas(),
                                    )
                                }
                            >
                                Listar campañas
                            </Button>
                        </CardContent>
                    </Card>

                    <Button
                        variant="text"
                        color="inherit"
                        onClick={() => setLogs([])}
                        disabled={logs.length === 0}
                    >
                        Limpiar log
                    </Button>
                </Stack>

                {/* ─── Columna derecha: log ─── */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Paper
                        variant="outlined"
                        sx={{
                            p: 2,
                            maxHeight: '80vh',
                            overflow: 'auto',
                            bgcolor: 'background.default',
                        }}
                    >
                        <Typography variant="subtitle1" gutterBottom>
                            Log de respuestas
                        </Typography>
                        {logs.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                Las respuestas aparecen acá. La más reciente arriba.
                            </Typography>
                        ) : (
                            logs.map((l, i) => (
                                <Box key={i} sx={{ mb: 2 }}>
                                    <Stack
                                        direction="row"
                                        spacing={1}
                                        alignItems="center"
                                        mb={0.5}
                                    >
                                        <Chip
                                            size="small"
                                            label={l.ok ? 'OK' : 'ERROR'}
                                            color={l.ok ? 'success' : 'error'}
                                        />
                                        <Typography variant="caption" color="text.secondary">
                                            {l.ts}
                                        </Typography>
                                        <Typography variant="body2" fontWeight={500}>
                                            {l.label}
                                        </Typography>
                                    </Stack>
                                    <Box
                                        component="pre"
                                        sx={{
                                            fontSize: 12,
                                            m: 0,
                                            p: 1,
                                            bgcolor: 'action.hover',
                                            borderRadius: 1,
                                            overflow: 'auto',
                                            maxHeight: 300,
                                        }}
                                    >
                                        {JSON.stringify(l.body, null, 2)}
                                    </Box>
                                    <Divider sx={{ mt: 1 }} />
                                </Box>
                            ))
                        )}
                    </Paper>
                </Box>
            </Stack>
        </Box>
    );
}
