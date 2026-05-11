import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box,
    Chip,
    Divider,
    Grid,
    LinearProgress,
    Typography,
    useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import TableRowsIcon from '@mui/icons-material/TableRows';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import SpeedIcon from '@mui/icons-material/Speed';
import {
    PieChart,
    Pie,
    Cell,
    Tooltip,
    ResponsiveContainer,
    Legend,
    Label,
} from 'recharts';
import api from '../api/axios';
import { useNotify } from '../hooks/useNotify';
import { useSocket } from '../context/SocketContext';
import {
    PageHeader,
    SectionCard,
    LoadingSkeleton,
    StatusChip,
    DataTableResponsive,
    EmptyState,
} from '../components/ui';
import type { StatusValue } from '../components/ui';
import type { DataTableColumn } from '../components/ui';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ImportError {
    id: number;
    rowNumber: number;
    errorMsg: string;
    rawRow: unknown;
    createdAt: string;
}

interface EmpresaRef { id: number; nombre: string }
interface PlantillaRef { id: number; nombre: string; categoria: string }
interface UsuarioRef { id: number; nombre: string; email: string }
interface PoliticaRef { id: number; nombre: string }
interface JobRef {
    id: number;
    estado: string;
    progreso: number;
    createdAt: string;
    finishedAt: string | null;
}

interface RemesaDetalle {
    id: number;
    numeroRemesa: string;
    nombre: string;
    categoria: string | null;
    estadoProceso: string;
    totalFilas: number;
    okFilas: number;
    errFilas: number;
    fechaVencimiento: string | null;
    createdAt: string;
    updatedAt: string;
    empresa: EmpresaRef | null;
    plantilla: PlantillaRef | null;
    usuarioCreador: UsuarioRef | null;
    politica: PoliticaRef | null;
    jobimport: JobRef | null;
    duracionMs: number | null;
    tasaExitoPct: number | null;
}

type ErrorRow = ImportError & Record<string, unknown>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ESTADO_TO_STATUS: Record<string, StatusValue> = {
    FINALIZADA: 'completed',
    ERROR: 'failed',
    FALLIDA: 'failed',
    PROCESANDO: 'running',
    VALIDANDO: 'pending',
    PENDIENTE: 'pending',
};

const EN_PROGRESO = new Set(['PENDIENTE', 'VALIDANDO', 'PROCESANDO']);

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDuracion(ms: number | null): string {
    if (ms === null || ms <= 0) return '—';
    const seg = Math.round(ms / 1000);
    if (seg < 60) return `${seg}s`;
    const min = Math.floor(seg / 60);
    const rem = seg % 60;
    return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function tasaColor(pct: number | null, success: string, warning: string, error: string): string {
    if (pct === null) return 'inherit';
    if (pct >= 95) return success;
    if (pct >= 80) return warning;
    return error;
}

// ─── Sub-componentes internos ─────────────────────────────────────────────────

interface StatCardProps {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    valueColor?: string;
}

function StatCard({ label, value, icon, valueColor }: StatCardProps) {
    return (
        <SectionCard sx={{ p: 0, height: '100%' }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" p={2}>
                <Box>
                    <Typography variant="body2" color="text.secondary" mb={0.5}>
                        {label}
                    </Typography>
                    <Typography variant="h4" fontWeight={700} color={valueColor ?? 'text.primary'}>
                        {value}
                    </Typography>
                </Box>
                <Box sx={{ color: valueColor ?? 'text.disabled', opacity: 0.7 }}>
                    {icon}
                </Box>
            </Box>
        </SectionCard>
    );
}

interface InfoRowProps {
    label: string;
    value: React.ReactNode;
    last?: boolean;
}

function InfoRow({ label, value, last }: InfoRowProps) {
    return (
        <>
            <Box display="flex" justifyContent="space-between" alignItems="flex-start" py={1.5} gap={2}>
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {label}
                </Typography>
                <Box sx={{ textAlign: 'right' }}>{value}</Box>
            </Box>
            {!last && <Divider />}
        </>
    );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ImportDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const notify = useNotify();
    const theme = useTheme();
    const { socket } = useSocket();

    const [remesa, setRemesa] = useState<RemesaDetalle | null>(null);
    const [errors, setErrors] = useState<ImportError[]>([]);
    const [loading, setLoading] = useState(true);

    const notifyRef = useRef(notify);
    useEffect(() => { notifyRef.current = notify; }, [notify]);

    const fetchAll = useCallback(async (silencioso = false) => {
        if (!id) return;
        try {
            if (!silencioso) setLoading(true);
            const { data } = await api.get<RemesaDetalle>(`/import/remesas/${id}`);
            setRemesa(data);
            if (data.errFilas > 0) {
                const res = await api.get(`/import/errores/${id}?pageSize=100`);
                setErrors(res.data.data);
            }
        } catch (err) {
            if (!silencioso) notifyRef.current.error(err as Error);
        } finally {
            if (!silencioso) setLoading(false);
        }
    }, [id]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    useEffect(() => {
        if (!socket || !id) return;
        const remesaId = Number(id);

        const onProgreso = (payload: { remesaId: number; progreso: number; okFilas: number; errFilas: number; totalFilas: number; estadoProceso: string }) => {
            if (payload.remesaId !== remesaId) return;
            setRemesa((prev) => prev ? {
                ...prev,
                okFilas: payload.okFilas,
                errFilas: payload.errFilas,
                totalFilas: payload.totalFilas ?? prev.totalFilas,
                estadoProceso: payload.estadoProceso ?? prev.estadoProceso,
                tasaExitoPct: (payload.totalFilas ?? prev.totalFilas) > 0
                    ? Math.round((payload.okFilas / (payload.totalFilas ?? prev.totalFilas)) * 100)
                    : null,
                jobimport: prev.jobimport
                    ? { ...prev.jobimport, progreso: payload.progreso }
                    : prev.jobimport,
            } : prev);
        };

        const onFinalizada = (payload: { remesaId: number }) => {
            if (payload.remesaId !== remesaId) return;
            fetchAll(true);
        };

        socket.on('import:progreso', onProgreso);
        socket.on('import:finalizada', onFinalizada);

        return () => {
            socket.off('import:progreso', onProgreso);
            socket.off('import:finalizada', onFinalizada);
        };
    }, [socket, id, fetchAll]);

    const errorColumns: DataTableColumn<ErrorRow>[] = [
        {
            key: 'rowNumber',
            label: 'Fila #',
            render: (row) => String(row.rowNumber),
        },
        {
            key: 'errorMsg',
            label: 'Mensaje de error',
            primary: true,
            render: (row) => (
                <Box sx={{ maxWidth: 320, wordBreak: 'break-word' }}>
                    <StatusChip
                        status="failed"
                        label={String(row.errorMsg)}
                        sx={{ height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal' } }}
                    />
                </Box>
            ),
        },
        {
            key: 'rawRow',
            label: 'Fila original (JSON)',
            secondary: true,
            render: (row) => (
                <Typography
                    variant="caption"
                    sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}
                >
                    {JSON.stringify(row.rawRow)}
                </Typography>
            ),
        },
    ];

    const estadoStatus: StatusValue = remesa
        ? (ESTADO_TO_STATUS[remesa.estadoProceso] ?? 'neutral')
        : 'neutral';

    const enProgreso = remesa ? EN_PROGRESO.has(remesa.estadoProceso) : false;
    const progreso = remesa?.jobimport?.progreso ?? 0;

    const successColor = theme.palette.success.main;
    const errorColor = theme.palette.error.main;
    const warningColor = theme.palette.warning.main;

    const pieData = remesa && remesa.totalFilas > 0
        ? [
            { name: 'OK', value: remesa.okFilas },
            { name: 'Error', value: remesa.errFilas },
        ]
        : null;

    const finalizadaOFallida = remesa?.estadoProceso === 'FINALIZADA' || remesa?.estadoProceso === 'FALLIDA';
    const fechaFin = finalizadaOFallida
        ? (remesa?.jobimport?.finishedAt ?? remesa?.updatedAt ?? null)
        : null;

    return (
        <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
            {/* A) Header */}
            <PageHeader
                title={`Importación #${remesa?.numeroRemesa ?? id}`}
                breadcrumbs={[
                    { label: 'Importaciones', href: '/historial-importaciones' },
                    { label: `#${remesa?.numeroRemesa ?? id}` },
                ]}
                actions={[
                    {
                        label: 'Volver',
                        onClick: () => navigate(-1),
                        variant: 'text',
                        startIcon: <ArrowBackIcon />,
                    },
                ]}
            />

            {loading && !remesa && (
                <SectionCard sx={{ mb: 3 }}>
                    <LoadingSkeleton variant="detail" />
                </SectionCard>
            )}

            {loading && remesa && <LinearProgress sx={{ mb: 2 }} />}

            {remesa && (
                <>
                    {/* B) Hero card */}
                    <SectionCard sx={{ mb: 3 }}>
                        <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems={{ xs: 'flex-start', sm: 'center' }}
                            flexDirection={{ xs: 'column', sm: 'row' }}
                            gap={2}
                        >
                            <Box>
                                <Typography variant="h5" fontWeight={700} mb={0.5}>
                                    {remesa.nombre}
                                </Typography>
                                <Typography
                                    variant="body2"
                                    color="text.secondary"
                                    mb={1}
                                    sx={{ letterSpacing: 0.5 }}
                                >
                                    #{remesa.numeroRemesa}
                                </Typography>
                                <Box display="flex" flexWrap="wrap" gap={1}>
                                    {remesa.empresa && (
                                        <Chip
                                            label={remesa.empresa.nombre}
                                            size="small"
                                            variant="outlined"
                                            color="primary"
                                        />
                                    )}
                                    {remesa.plantilla && (
                                        <Chip
                                            label={`${remesa.plantilla.nombre} · ${remesa.plantilla.categoria}`}
                                            size="small"
                                            variant="outlined"
                                        />
                                    )}
                                </Box>
                            </Box>
                            <StatusChip
                                status={estadoStatus}
                                label={remesa.estadoProceso}
                                sx={{ fontSize: '0.95rem', px: 1.5, py: 0.5 }}
                            />
                        </Box>
                        {enProgreso && (
                            <Box mt={2}>
                                <LinearProgress
                                    variant="determinate"
                                    value={progreso}
                                    sx={{ borderRadius: 1, height: 8 }}
                                />
                                <Typography variant="caption" color="text.secondary" mt={0.5} display="block">
                                    {progreso}% completado
                                </Typography>
                            </Box>
                        )}
                    </SectionCard>

                    {/* C) Stat cards */}
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                        <Grid item xs={12} sm={6} md={3}>
                            <StatCard
                                label="Total filas"
                                value={remesa.totalFilas}
                                icon={<TableRowsIcon sx={{ fontSize: 36 }} />}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={3}>
                            <StatCard
                                label="Filas OK"
                                value={remesa.okFilas}
                                icon={<CheckCircleOutlineIcon sx={{ fontSize: 36 }} />}
                                valueColor={successColor}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={3}>
                            <StatCard
                                label="Filas con error"
                                value={remesa.errFilas}
                                icon={<ErrorOutlineIcon sx={{ fontSize: 36 }} />}
                                valueColor={remesa.errFilas > 0 ? errorColor : 'text.primary'}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={3}>
                            <StatCard
                                label="Tasa de éxito"
                                value={remesa.tasaExitoPct !== null ? `${remesa.tasaExitoPct}%` : '—'}
                                icon={<SpeedIcon sx={{ fontSize: 36 }} />}
                                valueColor={tasaColor(remesa.tasaExitoPct, successColor, warningColor, errorColor)}
                            />
                        </Grid>
                    </Grid>

                    {/* D + E) Donut + Info en fila */}
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                        {/* D) Donut chart */}
                        <Grid item xs={12} md={5}>
                            <SectionCard title="Distribución de filas" sx={{ height: '100%' }}>
                                {pieData ? (
                                    <Box>
                                        <ResponsiveContainer width="100%" height={280}>
                                            <PieChart>
                                                <Pie
                                                    data={pieData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={70}
                                                    outerRadius={110}
                                                    paddingAngle={2}
                                                    dataKey="value"
                                                    label={false}
                                                >
                                                    <Cell fill={successColor} />
                                                    <Cell fill={errorColor} />
                                                    <Label
                                                        position="center"
                                                        content={({ viewBox }) => {
                                                            const vb = viewBox as { cx?: number; cy?: number } | undefined;
                                                            if (!vb?.cx || !vb?.cy) return null;
                                                            return (
                                                                <g>
                                                                    <text
                                                                        x={vb.cx}
                                                                        y={vb.cy - 8}
                                                                        textAnchor="middle"
                                                                        fill={theme.palette.text.primary}
                                                                        style={{ fontSize: 26, fontWeight: 700 }}
                                                                    >
                                                                        {remesa.totalFilas}
                                                                    </text>
                                                                    <text
                                                                        x={vb.cx}
                                                                        y={vb.cy + 14}
                                                                        textAnchor="middle"
                                                                        fill={theme.palette.text.secondary}
                                                                        style={{ fontSize: 12 }}
                                                                    >
                                                                        filas
                                                                    </text>
                                                                </g>
                                                            );
                                                        }}
                                                    />
                                                </Pie>
                                                <Tooltip
                                                    formatter={(value) => {
                                                        const num = typeof value === 'number' ? value : 0;
                                                        const pct = remesa.totalFilas > 0
                                                            ? Math.round((num / remesa.totalFilas) * 100)
                                                            : 0;
                                                        return `${num} (${pct}%)`;
                                                    }}
                                                    contentStyle={{
                                                        background: theme.palette.background.paper,
                                                        border: `1px solid ${theme.palette.divider}`,
                                                        borderRadius: 8,
                                                    }}
                                                />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </Box>
                                ) : (
                                    <EmptyState
                                        title="Sin filas procesadas"
                                        description="No hay datos de distribución para mostrar."
                                    />
                                )}
                            </SectionCard>
                        </Grid>

                        {/* E) Info general */}
                        <Grid item xs={12} md={7}>
                            <SectionCard title="Información general" sx={{ height: '100%' }}>
                                <InfoRow
                                    label="Empresa"
                                    value={
                                        <Typography variant="body2" fontWeight={600}>
                                            {remesa.empresa?.nombre ?? '—'}
                                        </Typography>
                                    }
                                />
                                <InfoRow
                                    label="Plantilla"
                                    value={
                                        <Box display="flex" alignItems="center" gap={1} justifyContent="flex-end" flexWrap="wrap">
                                            <Typography variant="body2" fontWeight={600}>
                                                {remesa.plantilla?.nombre ?? '—'}
                                            </Typography>
                                            {remesa.plantilla?.categoria && (
                                                <Chip
                                                    label={remesa.plantilla.categoria}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            )}
                                        </Box>
                                    }
                                />
                                <InfoRow
                                    label="Usuario creador"
                                    value={
                                        <Box textAlign="right">
                                            <Typography variant="body2" fontWeight={600}>
                                                {remesa.usuarioCreador?.nombre ?? '—'}
                                            </Typography>
                                            {remesa.usuarioCreador?.email && (
                                                <Typography variant="caption" color="text.secondary">
                                                    {remesa.usuarioCreador.email}
                                                </Typography>
                                            )}
                                        </Box>
                                    }
                                />
                                <InfoRow
                                    label="Fecha de inicio"
                                    value={
                                        <Typography variant="body2" fontWeight={600}>
                                            {formatDate(remesa.createdAt)}
                                        </Typography>
                                    }
                                />
                                <InfoRow
                                    label="Fecha de finalización"
                                    value={
                                        <Typography variant="body2" fontWeight={600}>
                                            {fechaFin ? formatDate(fechaFin) : (enProgreso ? 'En curso' : '—')}
                                        </Typography>
                                    }
                                />
                                <InfoRow
                                    label="Duración"
                                    value={
                                        <Typography variant="body2" fontWeight={600}>
                                            {formatDuracion(remesa.duracionMs)}
                                        </Typography>
                                    }
                                />
                                <InfoRow
                                    label="Política aplicada"
                                    value={
                                        <Typography variant="body2" fontWeight={600}>
                                            {remesa.politica?.nombre ?? 'Sin política'}
                                        </Typography>
                                    }
                                />
                                <InfoRow
                                    label="Vencimiento del lote"
                                    value={
                                        <Typography variant="body2" fontWeight={600}>
                                            {remesa.fechaVencimiento
                                                ? new Date(remesa.fechaVencimiento).toLocaleDateString('es-AR')
                                                : '—'}
                                        </Typography>
                                    }
                                    last
                                />
                            </SectionCard>
                        </Grid>
                    </Grid>

                    {/* F) Tabla de errores */}
                    {remesa.errFilas > 0 && (
                        <SectionCard title="Errores de fila" noPadding>
                            <DataTableResponsive<ErrorRow>
                                columns={errorColumns}
                                rows={errors as ErrorRow[]}
                                rowKey={(row) => String(row.id)}
                                emptyMessage="No hay errores registrados."
                            />
                        </SectionCard>
                    )}
                </>
            )}
        </Box>
    );
}
