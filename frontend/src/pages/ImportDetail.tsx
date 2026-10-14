import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fechaDelCedente } from '../utils/fechas';
import { Link as RouterLink, useParams, useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    Divider,
    Grid,
    LinearProgress,
    Typography,
    useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
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
import { obtenerGrupo, retomarRemesa } from '../api/imports';
import type { OrigenDeCargaDto } from '../types/importHistorial';
import ErroresDeCarga from '../components/import/ErroresDeCarga';
import { useNotify } from '../hooks/useNotify';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useSocket } from '../context/SocketContext';
import type { EstadoCargaDto } from '../types/importProgreso';
import { useEstadoCarga } from '../hooks/useEstadoCarga';
import { useGrupoCarga } from '../hooks/useGrupoCarga';
import { useUltimosErrores } from '../hooks/useUltimosErrores';
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
import MulticlavesLoteResumen from '../components/import/MulticlavesLoteResumen';
import ResumenDeCarga from '../components/import/ResumenDeCarga';
import AvisosCarga from '../components/import/AvisosCarga';
import TarjetaProgreso from '../components/import/progreso/TarjetaProgreso';
import { BotonCancelarCarga } from '../components/import/ImportProgress';
import {
    cancelacionLlegoTarde,
    casosActualizados,
    casosNuevos,
    datosDeGrupo,
    descartadasFueraDeCorte,
    descartadasPorFiltro,
    esRetomable,
    estaCancelada,
    etiquetaDeEstado,
    etiquetaFase,
    formatearNumero,
    motivoNoRetomablePorCorte,
    presentarResultado,
    puedeGestionarCarga,
    textoCancelacionTardia,
    TEXTO_RETOMAR_UNA,
} from '../utils/estadoCarga';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface EmpresaRef { id: number; nombre: string }
interface PlantillaRef { id: number; nombre: string; categoria: string }
interface UsuarioRef { id: number; nombre: string; email: string }
interface PoliticaRef { id: number; nombre: string }
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
    tasaExitoPct: number | null;
    /** Corte de la división que le tocó. Un backend anterior no lo manda. */
    corte?: string | null;
    /** Remesas de origen con las que se confirmó. Un backend anterior no lo manda. */
    origen?: OrigenDeCargaDto[] | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ESTADO_TO_STATUS: Record<string, StatusValue> = {
    FINALIZADA: 'completed',
    ERROR: 'failed',
    FALLIDA: 'failed',
    PROCESANDO: 'running',
    VALIDANDO: 'pending',
    PENDIENTE: 'pending',
};

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
    const confirm = useConfirm();
    const { usuario, tienePermiso } = useAuth();
    const theme = useTheme();
    const { conectado } = useSocket();
    // Todo lo que se mueve (estado, contadores, fechas, resultado) sale de acá; la remesa de abajo es lo fijo.
    const { estado: carga, cargando: cargandoCarga, noExiste, aplicar, refrescar } = useEstadoCarga(id ? Number(id) : null);
    // Los últimos 5 errores solo mientras corre: terminada, la tabla de abajo ya los muestra todos.
    const ultimos = useUltimosErrores(carga, carga?.enCurso === true);

    const [remesa, setRemesa] = useState<RemesaDetalle | null>(null);
    const [loading, setLoading] = useState(true);
    const [noEncontrada, setNoEncontrada] = useState(false);

    const notifyRef = useRef(notify);
    useEffect(() => { notifyRef.current = notify; }, [notify]);

    // Para ignorar la respuesta de una remesa anterior si se cambió de `id` mientras el pedido estaba en vuelo.
    const idActualRef = useRef(id);
    idActualRef.current = id;

    const fetchAll = useCallback(async (silencioso = false) => {
        if (!id) return;
        try {
            if (!silencioso) setLoading(true);
            const { data } = await api.get<RemesaDetalle>(`/import/remesas/${id}`);
            if (idActualRef.current !== id) return;
            setRemesa(data);
            setNoEncontrada(false);
        } catch (err) {
            // Una remesa borrada no es un error para mostrar en un toast: la pantalla lo dice.
            if (idActualRef.current !== id) return;
            if (isAxiosError(err) && err.response?.status === 404) setNoEncontrada(true);
            else if (!silencioso) notifyRef.current.error(err as Error);
        } finally {
            if (!silencioso) setLoading(false);
        }
    }, [id]);

    // Al cambiar de remesa no se arrastra nada de la anterior (ni sus totales ni un "no existe").
    useEffect(() => {
        setRemesa(null);
        setNoEncontrada(false);
        void fetchAll();
    }, [fetchAll]);

    // Cuando la carga termina estando la pantalla abierta, se vuelve a pedir la remesa una vez.
    const terminal = carga?.terminal ?? null;
    const terminalPrevRef = useRef<boolean | null>(null);
    useEffect(() => {
        if (terminalPrevRef.current === false && terminal === true) fetchAll(true);
        terminalPrevRef.current = terminal;
    }, [terminal, fetchAll]);

    // Las remesas hermanas de una carga dividida (§10.8.6): se piden al abrir, cuando cambia el grupo y cuando la
    // carga termina, para que los chips no queden con un estado viejo.
    const grupoActual = carga ? datosDeGrupo(carga) : null;
    const grupoIdActual = grupoActual?.grupoId ?? null;
    const [hermanas, setHermanas] = useState<EstadoCargaDto[]>([]);
    const cargarHermanas = useCallback(async () => {
        if (grupoIdActual === null) {
            setHermanas([]);
            return;
        }
        try {
            const r = await obtenerGrupo(grupoIdActual);
            if (idActualRef.current === id) setHermanas(Array.isArray(r.remesas) ? r.remesas : []);
        } catch {
            // Consulta de fondo: sin los chips la pantalla sigue sirviendo.
        }
    }, [grupoIdActual, id]);
    useEffect(() => {
        void cargarHermanas();
    }, [cargarHermanas, terminal]);
    // Mientras esta remesa corre, las que terminan son otras: la división se sigue en vivo (socket y, si calla, por
    // consulta) para que la barra del grupo y los chips no queden con la foto de cuando se abrió la pantalla.
    const grupoVivo = useGrupoCarga(carga?.enCurso ? grupoIdActual : null);
    const hermanasVistas = carga?.enCurso && grupoVivo.remesas.length > 0 ? grupoVivo.remesas : hermanas;
    const refrescarHermanas = () => {
        void cargarHermanas();
        if (carga?.enCurso) void grupoVivo.refrescar();
    };

    // Retomar (§10.8.5): vuelve a encolar la misma remesa. La `carga` que devuelve el pedido pasa de terminal a en
    // curso: el hook la aplica y vuelve a seguirla solo.
    const [retomando, setRetomando] = useState(false);
    const [vueltas, setVueltas] = useState(0);
    const handleRetomar = async () => {
        if (!carga || retomando) return;
        const acepta = await confirm(TEXTO_RETOMAR_UNA);
        if (!acepta) return;
        setRetomando(true);
        try {
            const r = await retomarRemesa(carga.remesaId);
            // Lo que se pidió en la corrida anterior (avisos de la lectura) ya no vale: la tarjeta de errores arranca de cero.
            setVueltas((v) => v + 1);
            aplicar(r.carga);
            void cargarHermanas();
        } catch (err) {
            notify.error(err as Error);
            // El pedido pudo haber surtido efecto (o la carga cambió): se muestra el estado real.
            void refrescar();
        } finally {
            setRetomando(false);
        }
    };

    // Lo que se muestra: con la carga en vivo (en curso o terminada) manda `carga`; mientras no llega,
    // o si es un borrador, lo que dice la remesa.
    const usarCarga = carga !== null && (carga.enCurso || carga.terminal);
    const totalFilas = usarCarga
        ? (carga.terminal ? carga.procesadas : carga.totalEsperado)
        : (remesa?.totalFilas ?? 0);
    const okFilas = usarCarga ? carga.ok : (remesa?.okFilas ?? 0);
    const errFilas = usarCarga ? carga.err : (remesa?.errFilas ?? 0);
    const tasaExitoPct = usarCarga
        ? (carga.procesadas > 0 && carga.resultado !== 'FALLIDA' ? Math.round((carga.ok / carga.procesadas) * 100) : null)
        : (remesa?.tasaExitoPct ?? null);

    const enCurso = carga?.enCurso === true;

    const esMulticlaves = remesa?.categoria === 'MULTICLAVES';

    // Chip de estado: con la carga, la misma etiqueta que el Historial (§16.5); sin ella (una remesa heredada), el `estadoProceso` de la remesa.
    let chipEstado: { status: StatusValue; label: string } | null = null;
    if (carga) {
        const e = etiquetaDeEstado(carga);
        chipEstado = { status: e.status, label: e.etiqueta };
    } else if (remesa && !cargandoCarga) {
        chipEstado = { status: ESTADO_TO_STATUS[remesa.estadoProceso] ?? 'neutral', label: remesa.estadoProceso };
    }

    const fase = carga ? etiquetaFase(carga) : null;
    const resultadoPresentado =
        carga?.terminal &&
        (carga.resultado === 'FALLIDA' || estaCancelada(carga) || carga.resultado === 'CON_ADVERTENCIAS' || carga.resultado === 'SIN_FILAS')
            ? presentarResultado(carga)
            : null;
    const esBorrador = carga !== null && !carga.enCurso && !carga.terminal;
    // Lo que no entra en las cuatro tarjetas: solo se muestra lo que corresponda. Vale para cargas en curso y terminadas.
    const resumenCasos: string[] = [];
    if (carga && (carga.enCurso || carga.terminal)) {
        const nuevos = casosNuevos(carga);
        const actualizados = casosActualizados(carga);
        const porFiltro = descartadasPorFiltro(carga);
        const fuera = descartadasFueraDeCorte(carga);
        if (nuevos !== null) resumenCasos.push(`Casos nuevos: ${formatearNumero(nuevos)}`);
        if (actualizados !== null) resumenCasos.push(`Casos actualizados: ${formatearNumero(actualizados)}`);
        // Sin `fueraDeCorte` (la remesa no tiene corte, o es anterior a la Fase B) el número puede incluir filas de
        // otros cortes: el rótulo es el neutro. El desglose en dos partes, solo cuando `fueraDeCorte` es un número.
        if (porFiltro > 0) {
            resumenCasos.push(
                carga.fueraDeCorte == null
                    ? `Descartadas: ${formatearNumero(porFiltro)}`
                    : `Descartadas por el filtro de la plantilla: ${formatearNumero(porFiltro)}`,
            );
        }
        if (fuera > 0) {
            resumenCasos.push(`De otros cortes de la división: ${formatearNumero(fuera)} (no se cargan en esta remesa)`);
        }
    }

    const successColor = theme.palette.success.main;
    const errorColor = theme.palette.error.main;
    const warningColor = theme.palette.warning.main;

    const pieData = totalFilas > 0
        ? [
            { name: 'OK', value: okFilas },
            { name: 'Error', value: errFilas },
        ]
        : null;

    // Una remesa heredada (sin fila de progreso) no tiene fecha de fin: se usa la última modificación.
    const fechaInicio = carga?.startedAt ?? remesa?.createdAt ?? null;
    const fechaFin = carga?.terminal ? (carga.finishedAt ?? remesa?.updatedAt ?? null) : null;

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

            {(noEncontrada || noExiste) && !remesa && (
                <Alert
                    severity="warning"
                    sx={{ mb: 3 }}
                    action={
                        <Button color="inherit" size="small" onClick={() => navigate('/historial-importaciones')}>
                            Ir al historial
                        </Button>
                    }
                >
                    La importación #{id} no existe. Puede haberse eliminado.
                </Alert>
            )}

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
                                {grupoActual && (
                                    <Box mb={1}>
                                        <Typography variant="body2" color="text.secondary">
                                            {grupoActual.orden != null && grupoActual.total != null
                                                ? `Remesa ${grupoActual.orden} de ${grupoActual.total} de una carga dividida`
                                                : 'Remesa de una carga dividida'}
                                        </Typography>
                                        {hermanasVistas.length > 1 && (
                                            <Box display="flex" flexWrap="wrap" gap={0.5} mt={0.5}>
                                                {hermanasVistas.map((h) => {
                                                    const est = etiquetaDeEstado(h);
                                                    return (
                                                        <Chip
                                                            key={h.remesaId}
                                                            component={RouterLink}
                                                            to={`/historial-importaciones/${h.remesaId}`}
                                                            clickable
                                                            size="small"
                                                            label={`#${h.numeroRemesa} · ${est.etiqueta}`}
                                                            color={est.color}
                                                            variant={String(h.remesaId) === id ? 'filled' : 'outlined'}
                                                        />
                                                    );
                                                })}
                                            </Box>
                                        )}
                                    </Box>
                                )}
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
                            {chipEstado && (
                                <StatusChip
                                    status={chipEstado.status}
                                    label={chipEstado.label}
                                    sx={{ fontSize: '0.95rem', px: 1.5, py: 0.5 }}
                                />
                            )}
                        </Box>
                        {esBorrador && fase?.secundario && (
                            <Typography variant="body2" color="text.secondary" mt={2}>
                                {fase.secundario}
                            </Typography>
                        )}
                        {carga?.enCurso && (
                            <Box mt={2}>
                                <TarjetaProgreso
                                    variante="detalle"
                                    carga={carga}
                                    conectado={conectado}
                                    grupo={hermanasVistas}
                                    totalGrupo={grupoVivo.total || (grupoActual?.total ?? undefined)}
                                    ultimos={ultimos}
                                    acciones={
                                        <BotonCancelarCarga carga={carga} onResultado={aplicar} onGrupoCambio={refrescarHermanas} alineacion="flex-start" grupo={hermanasVistas} />
                                    }
                                />
                            </Box>
                        )}
                        {carga && !carga.enCurso && carga.intentos > 1 && (
                            <Box mt={2}>
                                <AvisosCarga estado={carga} conectado={conectado} />
                            </Box>
                        )}
                        {carga && esRetomable(carga) && puedeGestionarCarga(carga, usuario?.id, tienePermiso) && (
                            <Box mt={2}>
                                <Button
                                    variant="contained"
                                    color="warning"
                                    startIcon={<PlayArrowIcon />}
                                    onClick={() => void handleRetomar()}
                                    disabled={retomando}
                                >
                                    Retomar
                                </Button>
                            </Box>
                        )}
                        {carga && !esRetomable(carga) && motivoNoRetomablePorCorte(carga) !== null && (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, overflowWrap: 'anywhere' }}>
                                {motivoNoRetomablePorCorte(carga)}
                            </Typography>
                        )}
                    </SectionCard>

                    {carga && cancelacionLlegoTarde(carga) && (
                        <Alert severity="info" sx={{ mb: 3 }}>
                            {textoCancelacionTardia(carga.resultado)}
                        </Alert>
                    )}

                    {resultadoPresentado && (
                        <Alert severity={resultadoPresentado.severidad} sx={{ mb: 3, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
                            <AlertTitle>{resultadoPresentado.titulo}</AlertTitle>
                            {resultadoPresentado.detalle}
                        </Alert>
                    )}

                    {carga && carga.terminal === true && (
                        <ResumenDeCarga carga={carga} sx={{ mb: 3 }} />
                    )}

                    {/* Claves de pago (solo MULTICLAVES) */}
                    {remesa.categoria === 'MULTICLAVES' && <MulticlavesLoteResumen remesaId={remesa.id} />}

                    {/* C) Stat cards. Un borrador no cargó nada: solo se muestra el total de la vista previa. */}
                    {esBorrador ? (
                        <Grid container spacing={2} sx={{ mb: 3 }}>
                            <Grid item xs={12} sm={6} md={3}>
                                <StatCard
                                    label={esMulticlaves ? 'Trámites en la vista previa' : 'Filas en la vista previa'}
                                    value={totalFilas > 0 ? formatearNumero(totalFilas) : '—'}
                                    icon={<TableRowsIcon sx={{ fontSize: 36 }} />}
                                />
                            </Grid>
                        </Grid>
                    ) : (
                        <>
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                        <Grid item xs={12} sm={6} md={3}>
                            <StatCard
                                label={esMulticlaves ? 'Total trámites' : 'Total filas'}
                                value={formatearNumero(totalFilas)}
                                icon={<TableRowsIcon sx={{ fontSize: 36 }} />}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={3}>
                            <StatCard
                                label={esMulticlaves ? 'Trámites OK' : 'Filas OK'}
                                value={formatearNumero(okFilas)}
                                icon={<CheckCircleOutlineIcon sx={{ fontSize: 36 }} />}
                                valueColor={successColor}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={3}>
                            <StatCard
                                label={esMulticlaves ? 'Trámites con error' : 'Filas con error'}
                                value={formatearNumero(errFilas)}
                                icon={<ErrorOutlineIcon sx={{ fontSize: 36 }} />}
                                valueColor={errFilas > 0 ? errorColor : 'text.primary'}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6} md={3}>
                            <StatCard
                                label="Tasa de éxito"
                                value={tasaExitoPct !== null ? `${tasaExitoPct}%` : '—'}
                                icon={<SpeedIcon sx={{ fontSize: 36 }} />}
                                valueColor={tasaColor(tasaExitoPct, successColor, warningColor, errorColor)}
                            />
                        </Grid>
                    </Grid>
                    {resumenCasos.length > 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, overflowWrap: 'anywhere' }}>
                            {resumenCasos.join(' · ')}
                        </Typography>
                    )}

                        </>
                    )}

                    {/* D + E) Donut + Info en fila */}
                    <Grid container spacing={2} sx={{ mb: 3 }}>
                        {/* D) Donut chart (un borrador no tiene distribución: no cargó nada) */}
                        {!esBorrador && (
                        <Grid item xs={12} md={5}>
                            <SectionCard title={esMulticlaves ? 'Distribución de trámites' : 'Distribución de filas'} sx={{ height: '100%' }}>
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
                                                                        {formatearNumero(totalFilas)}
                                                                    </text>
                                                                    <text
                                                                        x={vb.cx}
                                                                        y={vb.cy + 14}
                                                                        textAnchor="middle"
                                                                        fill={theme.palette.text.secondary}
                                                                        style={{ fontSize: 12 }}
                                                                    >
                                                                        {esMulticlaves ? 'trámites' : 'filas'}
                                                                    </text>
                                                                </g>
                                                            );
                                                        }}
                                                    />
                                                </Pie>
                                                <Tooltip
                                                    formatter={(value) => {
                                                        const num = typeof value === 'number' ? value : 0;
                                                        const pct = totalFilas > 0
                                                            ? Math.round((num / totalFilas) * 100)
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

                        )}

                        {/* E) Info general */}
                        <Grid item xs={12} md={esBorrador ? 12 : 7}>
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
                                            {formatDate(fechaInicio)}
                                        </Typography>
                                    }
                                />
                                <InfoRow
                                    label="Fecha de finalización"
                                    value={
                                        <Typography variant="body2" fontWeight={600}>
                                            {fechaFin ? formatDate(fechaFin) : (enCurso ? 'En curso' : '—')}
                                        </Typography>
                                    }
                                />
                                <InfoRow
                                    label="Duración"
                                    value={
                                        <Typography variant="body2" fontWeight={600}>
                                            {formatDuracion(carga?.duracionMs ?? null)}
                                        </Typography>
                                    }
                                />
                                {remesa.corte != null && remesa.corte !== '' && (
                                    <InfoRow
                                        label="Corte"
                                        value={<Typography variant="body2" fontWeight={600}>{remesa.corte}</Typography>}
                                    />
                                )}
                                {Array.isArray(remesa.origen) && remesa.origen.length > 0 && (
                                    <InfoRow
                                        label="Remesas de origen"
                                        value={
                                            <Box textAlign="right">
                                                {remesa.origen.map((o) => (
                                                    <Typography key={o.remesaId} variant="body2" fontWeight={600}>
                                                        {o.numeroRemesa == null ? 'una remesa eliminada' : `${o.numeroRemesa}${o.nombre ? ` · ${o.nombre}` : ''}`}
                                                    </Typography>
                                                ))}
                                            </Box>
                                        }
                                    />
                                )}
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
                                                ? fechaDelCedente(remesa.fechaVencimiento)
                                                : '—'}
                                        </Typography>
                                    }
                                    last
                                />
                            </SectionCard>
                        </Grid>
                    </Grid>

                    {/* F) Errores y avisos de la carga */}
                    {carga && (
                        <ErroresDeCarga
                            key={`${remesa.id}-${vueltas}`}
                            remesaId={remesa.id}
                            numeroRemesa={remesa.numeroRemesa}
                            carga={carga}
                            esMulticlaves={esMulticlaves}
                        />
                    )}
                </>
            )}
        </Box>
    );
}
