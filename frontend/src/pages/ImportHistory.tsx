import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    InputAdornment,
    LinearProgress,
    MenuItem,
    Select,
    Stack,
    TablePagination,
    TextField,
    Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import InboxIcon from '@mui/icons-material/Inbox';
import SearchIcon from '@mui/icons-material/Search';
import api from '../api/axios';
import { confirmarPendientes, eliminarRemesa, retomarGrupo, retomarRemesa } from '../api/imports';
import { useEmpresas } from '../hooks/useEmpresas';
import { useNotify } from '../hooks/useNotify';
import { useHistorialImportaciones } from '../hooks/useHistorialImportaciones';
import { useImportacionesEnCurso } from '../hooks/useImportacionesEnCurso';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { PageHeader, SectionCard, EmptyState, LoadingSkeleton, DataTableResponsive } from '../components/ui';
import type { DataTableColumn } from '../components/ui';
import ConsolidacionModal from '../components/consolidacion/ConsolidacionModal';
import { AccionesHistorial, DialogoConfirmarPendientes, DialogoEliminarImportacion } from '../components/import/historial/AccionesHistorial';
import { CeldaEstado, CeldaFilas, CeldaImportacion } from '../components/import/historial/CeldasHistorial';
import EncabezadoDivision from '../components/import/historial/EncabezadoDivision';
import type { HistorialItemDto } from '../types/importHistorial';
import { TEXTO_RETOMAR_UNA, TEXTO_RETOMAR_VARIAS, TEXTO_REVERSION_SIN_RESPUESTA, codigoDeError, plural, respuestaPerdida } from '../utils/estadoCarga';
import { accionesDeFila, inicioDeBloque, ordenarParaMostrar, textoEliminar, tramoDeBloque } from '../utils/historialImportaciones';

type FilaHistorial = HistorialItemDto & Record<string, unknown>;

interface Politica {
    id: number;
    nombre: string;
    activa: boolean;
}

const TAMANOS_DE_PAGINA = [25, 50, 100];
const ESPERA_BUSQUEDA_MS = 400;

export default function ImportHistory() {
    const navigate = useNavigate();
    const notify = useNotify();
    const confirm = useConfirm();
    const { usuario, tienePermiso } = useAuth();
    const { empresas, loading: loadingEmpresas } = useEmpresas();
    const [empresaId, setEmpresaId] = useState<number | ''>(1);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [textoBusqueda, setTextoBusqueda] = useState('');
    const [q, setQ] = useState('');
    const { items, grupos, total, cargando, refrescando, error, refrescar, aplicarCarga, quitar } = useHistorialImportaciones({
        empresaId: empresaId === '' ? null : empresaId,
        page,
        pageSize,
        q,
    });
    const enCurso = useImportacionesEnCurso();
    const [politicas, setPoliticas] = useState<Politica[]>([]);
    const [itemAEliminar, setItemAEliminar] = useState<HistorialItemDto | null>(null);
    const [eliminando, setEliminando] = useState(false);
    const [itemAConfirmar, setItemAConfirmar] = useState<HistorialItemDto | null>(null);
    const [confirmando, setConfirmando] = useState(false);
    const [consolidarRemesaId, setConsolidarRemesaId] = useState<number | null>(null);
    const [revertirId, setRevertirId] = useState<number | null>(null);
    const [revirtiendo, setRevirtiendo] = useState(false);
    /** Remesas con una acción en vuelo: un segundo clic seguido no manda un segundo pedido. */
    const [ocupadas, setOcupadas] = useState<ReadonlySet<number>>(new Set());
    const ocupadasRef = useRef<Set<number>>(new Set());
    const [retomandoGrupo, setRetomandoGrupo] = useState<string | null>(null);

    const marcarOcupada = (ids: number[]): boolean => {
        if (ids.some((id) => ocupadasRef.current.has(id))) return false;
        ids.forEach((id) => ocupadasRef.current.add(id));
        setOcupadas(new Set(ocupadasRef.current));
        return true;
    };
    const liberar = (ids: number[]) => {
        ids.forEach((id) => ocupadasRef.current.delete(id));
        setOcupadas(new Set(ocupadasRef.current));
    };

    // La búsqueda se aplica al dejar de escribir y vuelve a la primera página.
    useEffect(() => {
        const t = setTimeout(() => {
            setQ((actual) => {
                const nuevo = textoBusqueda.trim();
                if (nuevo !== actual) setPage(1);
                return nuevo;
            });
        }, ESPERA_BUSQUEDA_MS);
        return () => clearTimeout(t);
    }, [textoBusqueda]);

    const cargarPoliticas = async (eid: number) => {
        try {
            const { data } = await api.get(`/politicas?empresaId=${eid}`);
            setPoliticas((data || []).filter((p: Politica) => p.activa));
        } catch {
            setPoliticas([]);
        }
    };
    useEffect(() => {
        if (empresaId) void cargarPoliticas(Number(empresaId));
    }, [empresaId]);

    const alCambiarEmpresa = (id: number) => {
        setEmpresaId(id);
        setPage(1);
    };

    const handleAsociarPolitica = async (remesaId: number, politicaId: number | null) => {
        try {
            await api.put(`/import/remesas/${remesaId}/politica`, { politicaId });
            await refrescar();
        } catch (err) {
            notify.error(err as Error);
        }
    };

    /** Una acción que falló: el mensaje del backend y una lectura nueva, porque la fila puede no ser ya lo que se veía. */
    const falloDeAccion = useCallback((err: unknown) => {
        notify.error(err as Error);
        void refrescar();
    }, [notify, refrescar]);

    const handleRetomar = async (item: HistorialItemDto) => {
        // Se marca antes de preguntar: un segundo clic mientras la confirmación está abierta no abre otra.
        if (!marcarOcupada([item.id])) return;
        try {
            const acepta = await confirm(TEXTO_RETOMAR_UNA);
            if (!acepta) return;
            const r = await retomarRemesa(item.id);
            aplicarCarga(r.carga);
            void refrescar();
        } catch (err) {
            falloDeAccion(err);
        } finally {
            liberar([item.id]);
        }
    };

    const handleRetomarGrupo = async (grupoId: string) => {
        if (retomandoGrupo !== null) return;
        const acepta = await confirm(TEXTO_RETOMAR_VARIAS);
        if (!acepta) return;
        setRetomandoGrupo(grupoId);
        try {
            const r = await retomarGrupo(grupoId);
            r.cargas.forEach(aplicarCarga);
            for (const o of r.omitidas ?? []) notify.warning(`Remesa ${o.numeroRemesa}: ${o.motivo}`);
            if ((r.noEncoladas ?? []).length > 0) {
                notify.warning(`No se pudo mandar a la cola: ${(r.noEncoladas ?? []).map((x) => x.numeroRemesa).join(', ')}. Siguen sin cargarse.`);
            }
            void refrescar();
        } catch (err) {
            if (codigoDeError(err) === 'NINGUNA_RETOMABLE') {
                const omitidas = (err as { response?: { data?: { omitidas?: Array<{ numeroRemesa: string; motivo: string }> } } }).response?.data?.omitidas ?? [];
                for (const o of omitidas) notify.warning(`Remesa ${o.numeroRemesa}: ${o.motivo}`);
            }
            falloDeAccion(err);
        } finally {
            setRetomandoGrupo(null);
        }
    };

    const handleConfirmarPendientes = async () => {
        const item = itemAConfirmar;
        const pendiente = item?.pendienteDeEncolar ?? null;
        if (!item || !pendiente) return;
        const ids = pendiente.remesas.map((r) => r.remesaId);
        if (!marcarOcupada(ids)) return;
        setConfirmando(true);
        try {
            const r = await confirmarPendientes(ids);
            r.cargas.forEach(aplicarCarga);
            notify.success('Importación encolada');
            if ((r.noEncoladas ?? []).length > 0) {
                notify.warning(`No se pudo mandar a la cola: ${(r.noEncoladas ?? []).map((x) => x.numeroRemesa).join(', ')}. Siguen pendientes.`);
            }
            setItemAConfirmar(null);
            void refrescar();
        } catch (err) {
            setItemAConfirmar(null);
            falloDeAccion(err);
        } finally {
            setConfirmando(false);
            liberar(ids);
        }
    };

    const handleEliminarConfirmado = async () => {
        // La fila viva, no la del clic: es la que el diálogo está mostrando ahora, y su `rev` le dice al servidor qué
        // se está eliminando (si cambió desde entonces, responde 409 en vez de borrar otra cosa).
        const item = itemAEliminarVivo;
        if (!item || !marcarOcupada([item.id])) return;
        setEliminando(true);
        try {
            await eliminarRemesa(item.id, item.carga?.rev);
            quitar(item.id);
            notify.success('Importación eliminada correctamente');
            void refrescar();
        } catch (err) {
            falloDeAccion(err);
        } finally {
            setEliminando(false);
            setItemAEliminar(null);
            liberar([item.id]);
        }
    };

    const handleRevertirConfirmado = async () => {
        if (!revertirId) return;
        setRevirtiendo(true);
        try {
            // `silencioso`: el aviso de un corte lo da esta pantalla, con su propio texto (el interceptor global diría solo «Sin conexión»).
            const { data } = await api.post(`/import/remesas/${revertirId}/revertir-acciones`, undefined, { silencioso: true });
            notify.success(
                data?.yaRevertida
                    ? 'La acción ya estaba revertida'
                    : `Acción revertida (${data.deudoresRevertidos} deudores, ${data.contactosRestaurados} contactos restaurados, ${data.comentariosBorrados} comentarios borrados)`,
            );
            void refrescar();
        } catch (err) {
            // Sin respuesta (o un corte del proxy) la reversión puede seguir corriendo en el servidor: no se ofrece reintentar a ciegas.
            notify.error(respuestaPerdida(err) ? TEXTO_REVERSION_SIN_RESPUESTA : (err as Error));
            void refrescar();
        } finally {
            setRevirtiendo(false);
            setRevertirId(null);
        }
    };

    const filas = useMemo(() => ordenarParaMostrar(items) as FilaHistorial[], [items]);
    const enLaPagina = useMemo(() => new Set(items.map((i) => i.id)), [items]);
    const fuera = enCurso.filter((c) => c.empresaId === empresaId && !enLaPagina.has(c.remesaId));

    const encabezadoAntesDe = (row: FilaHistorial, idx: number): React.ReactNode | null => {
        if (!inicioDeBloque(filas, idx)) return null;
        const gid = row.carga.grupoId;
        const grupo = gid != null ? grupos[gid] : undefined;
        if (gid == null || !grupo) return null;
        const puede = tienePermiso('importacion.ejecutar') && (usuario?.id === grupo.usuarioId || tienePermiso('importacion.ver_progreso_otros'));
        return (
            <EncabezadoDivision
                grupo={grupo}
                enPagina={tramoDeBloque(filas, idx).length}
                puedeRetomar={puede}
                retomando={retomandoGrupo === gid}
                onRetomar={() => void handleRetomarGrupo(gid)}
            />
        );
    };

    const columns: DataTableColumn<FilaHistorial>[] = [
        { key: 'nombre', label: 'Importación', primary: true, render: (row) => <CeldaImportacion item={row} /> },
        { key: 'categoria', label: 'Categoría', secondary: true, render: (row) => String(row.categoria ?? '—') },
        { key: 'estado', label: 'Estado', render: (row) => <CeldaEstado item={row} /> },
        { key: 'filas', label: 'Filas', align: 'right', hideInCard: false, render: (row) => <CeldaFilas item={row} /> },
        {
            key: 'createdAt',
            label: 'Fecha',
            align: 'right',
            hideInCard: true,
            render: (row) => {
                const d = new Date(String(row.createdAt));
                return (
                    <Box textAlign="right">
                        <Typography variant="body2">{d.toLocaleDateString()}</Typography>
                        <Typography variant="caption" color="text.secondary">{d.toLocaleTimeString()}</Typography>
                    </Box>
                );
            },
        },
        {
            key: 'politica',
            label: 'Política',
            render: (row) => (
                <Select
                    size="small"
                    displayEmpty
                    value={row.politicaId ?? ''}
                    onChange={(e) => void handleAsociarPolitica(row.id, e.target.value === '' ? null : Number(e.target.value))}
                    sx={{ fontSize: '0.75rem', minWidth: 140 }}
                >
                    <MenuItem value=""><em>Sin política</em></MenuItem>
                    {politicas.map((p) => (
                        <MenuItem key={p.id} value={p.id}>{p.nombre}</MenuItem>
                    ))}
                </Select>
            ),
        },
        {
            key: 'acciones',
            label: 'Acciones',
            align: 'center',
            render: (row) => (
                <AccionesHistorial
                    item={row}
                    acciones={accionesDeFila(row, usuario?.id, tienePermiso)}
                    ocupado={ocupadas.has(row.id)}
                    onVer={() => navigate(`/historial-importaciones/${row.id}`)}
                    onAplicarCarga={aplicarCarga}
                    onCambio={() => void refrescar()}
                    onRetomar={() => void handleRetomar(row)}
                    onConfirmar={() => setItemAConfirmar(row)}
                    onConsolidar={() => setConsolidarRemesaId(row.id)}
                    onRevertir={() => setRevertirId(row.id)}
                    onEliminar={() => setItemAEliminar(row)}
                />
            ),
        },
    ];

    const primeraCarga = cargando && items.length === 0;
    // El diálogo de eliminar muestra la fila tal como está ahora, no como estaba al hacer clic.
    const itemAEliminarVivo = itemAEliminar ? (items.find((i) => i.id === itemAEliminar.id) ?? itemAEliminar) : null;

    return (
        <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
            <DialogoEliminarImportacion
                item={itemAEliminarVivo}
                cambio={itemAEliminarVivo != null && itemAEliminar != null && textoEliminar(itemAEliminarVivo).titulo !== textoEliminar(itemAEliminar).titulo}
                eliminando={eliminando}
                onCancelar={() => setItemAEliminar(null)}
                onConfirmar={() => void handleEliminarConfirmado()}
            />
            <DialogoConfirmarPendientes
                item={itemAConfirmar}
                enviando={confirmando}
                onVolver={() => setItemAConfirmar(null)}
                onConfirmar={() => void handleConfirmarPendientes()}
            />

            <Dialog open={revertirId !== null} onClose={() => !revirtiendo && setRevertirId(null)}>
                <DialogTitle>Revertir acción masiva</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Se deshacen los cambios de esta acción masiva volviendo a los valores previos (según el
                        snapshot): se restauran contactos eliminados, se borran los comentarios agregados y se
                        revierten los campos modificados. Si algún deudor se editó a mano después, esos cambios se pisan.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRevertirId(null)} disabled={revirtiendo}>Cancelar</Button>
                    <Button onClick={() => void handleRevertirConfirmado()} color="warning" variant="contained" disabled={revirtiendo}>
                        {revirtiendo ? 'Revirtiendo...' : 'Revertir'}
                    </Button>
                </DialogActions>
            </Dialog>

            <PageHeader
                title="Historial de importaciones"
                actions={[
                    {
                        label: 'Actualizar',
                        onClick: () => void refrescar(),
                        variant: 'outlined',
                        startIcon: <RefreshIcon />,
                        disabled: cargando || refrescando || !empresaId,
                    },
                ]}
            />

            <SectionCard sx={{ mb: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                        select
                        label="Empresa"
                        size="small"
                        value={empresaId}
                        onChange={(e) => alCambiarEmpresa(Number(e.target.value))}
                        disabled={loadingEmpresas}
                        sx={{ minWidth: 220 }}
                    >
                        {empresas.map((emp) => (
                            <MenuItem key={emp.id} value={emp.id}>{emp.nombre}</MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        label="Buscar por número o nombre"
                        size="small"
                        value={textoBusqueda}
                        onChange={(e) => setTextoBusqueda(e.target.value.slice(0, 60))}
                        sx={{ minWidth: 260 }}
                        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                    />
                </Stack>
            </SectionCard>

            {q !== '' && (
                <Alert
                    severity="info"
                    sx={{ mb: 2 }}
                    action={<Button color="inherit" size="small" onClick={() => { setTextoBusqueda(''); setQ(''); setPage(1); }}>Quitar</Button>}
                >
                    Buscando «{q}»
                </Alert>
            )}

            {fuera.length > 0 && (
                <Alert
                    severity="info"
                    sx={{ mb: 2 }}
                    action={<Button color="inherit" size="small" onClick={() => { setTextoBusqueda(''); setQ(''); setPage(1); }}>Ir al principio</Button>}
                >
                    Hay {fuera.length} {plural(fuera.length, 'importación', 'importaciones')} en curso que no {plural(fuera.length, 'está', 'están')} en esta página: {fuera.map((c) => `#${c.numeroRemesa}`).join(', ')}.
                </Alert>
            )}

            <SectionCard noPadding sx={{ position: 'relative' }}>
                {refrescando && (
                    <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, borderRadius: '8px 8px 0 0' }} />
                )}

                {primeraCarga ? (
                    <Box sx={{ p: 2 }}>
                        <LoadingSkeleton variant="table" rows={6} columns={8} />
                    </Box>
                ) : error && items.length === 0 ? (
                    <Box sx={{ p: 2 }}>
                        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void refrescar()}>Reintentar</Button>}>
                            No se pudo cargar el historial
                        </Alert>
                    </Box>
                ) : items.length === 0 ? (
                    <EmptyState
                        icon={<InboxIcon />}
                        title="Sin importaciones"
                        description={q !== '' ? 'Ninguna importación coincide con la búsqueda.' : 'No hay importaciones registradas para la empresa seleccionada.'}
                        action={{ label: 'Actualizar', onClick: () => void refrescar() }}
                    />
                ) : (
                    <>
                        <DataTableResponsive<FilaHistorial>
                            columns={columns}
                            rows={filas}
                            rowKey={(row) => String(row.id)}
                            encabezadoAntesDe={encabezadoAntesDe}
                        />
                        <TablePagination
                            component="div"
                            count={total}
                            page={Math.max(0, page - 1)}
                            onPageChange={(_e, nueva) => setPage(nueva + 1)}
                            rowsPerPage={pageSize}
                            rowsPerPageOptions={TAMANOS_DE_PAGINA}
                            onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                            labelRowsPerPage="Por página:"
                            labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                        />
                    </>
                )}
            </SectionCard>

            {consolidarRemesaId !== null && (
                <ConsolidacionModal
                    open={consolidarRemesaId !== null}
                    scope={{ tipo: 'REMESA', remesaId: consolidarRemesaId }}
                    onClose={() => setConsolidarRemesaId(null)}
                />
            )}
        </Box>
    );
}
