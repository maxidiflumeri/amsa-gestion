import React, { useCallback, useEffect, useState } from 'react';
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Drawer,
    Grid,
    IconButton,
    Menu,
    MenuItem,
    Pagination,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { auditoriaApi } from '../../api/auditoria';
import type { QueryAuditoria, Transaccion } from '../../types/auditoria';
import AuditDiffView from './AuditDiffView';
import { useAuth } from '../../context/AuthContext';
import { useNotify } from '../../hooks/useNotify';

// Los nueve del enum `AuditModulo`. Faltaban TELEFONIA, EMAIL y DASHBOARDS: el sistema los registra
// y no se podían filtrar desde el desplegable.
const MODULOS = ['GESTION', 'IMPORT', 'REPORTES', 'DASHBOARDS', 'EMAIL', 'ADMIN', 'AUTH', 'TELEFONIA', 'SISTEMA'];
const ESTADOS = ['OK', 'FALLIDO'];
const SEVERIDADES = ['INFO', 'WARN', 'ERROR'];

const PAGE_SIZE = 50;

const downloadCSV = (items: Transaccion[]) => {
    const cols = ['id', 'createdAt', 'usuario', 'modulo', 'entidad', 'tipo', 'severidad', 'estado', 'resumen', 'ip'];
    const rows = items.map((it) => [
        it.id,
        it.createdAt,
        it.usuario?.nombre ?? 'Sistema',
        it.modulo,
        it.entidad,
        it.tipo,
        it.severidad,
        it.estado,
        (it.resumen ?? '').replace(/"/g, '""'),
        it.ip ?? '',
    ]);
    const csv = [cols.join(','), ...rows.map((r) => r.map((c) => `"${c ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

const AuditoriaBusqueda: React.FC = () => {
    const { tienePermiso } = useAuth();
    const [filters, setFilters] = useState<QueryAuditoria>({});
    /** Los filtros de la última búsqueda ejecutada: es lo que se exporta. */
    const [filtrosAplicados, setFiltrosAplicados] = useState<QueryAuditoria>({});
    const notify = useNotify();
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<Transaccion[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<Transaccion | null>(null);
    const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
    const [exporting, setExporting] = useState(false);

    const exportarServer = async (formato: 'xlsx' | 'csv' | 'pdf') => {
        setExportAnchor(null);
        setExporting(true);
        try {
            const blob = await auditoriaApi.exportar({ ...filtrosAplicados, formato });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.${formato}`;
            a.click();
            URL.revokeObjectURL(url);
        } finally {
            setExporting(false);
        }
    };

    const buscar = useCallback(async (extra?: Partial<QueryAuditoria>) => {
        setLoading(true);
        try {
            const params: QueryAuditoria = {
                ...filters,
                limit: PAGE_SIZE,
                offset: ((extra?.offset != null) ? extra.offset : (page - 1) * PAGE_SIZE),
                orderDir: 'desc',
            };
            const r = await auditoriaApi.listar(params);
            setItems(r.items);
            setTotal(r.total);
            // Lo que se exporta es lo que se buscó, no lo que haya quedado tipeado en el formulario:
            // antes, cambiar un filtro sin apretar Buscar hacía que el archivo saliera con el filtro
            // nuevo mientras la pantalla mostraba el viejo.
            setFiltrosAplicados(filters);
        } catch (e) {
            // Sin este catch, un 403 o un 500 dejaban la pantalla en blanco, indistinguible de
            // "no hay resultados".
            notify.error(e as Error);
            setItems([]);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [filters, page, notify]);

    useEffect(() => { buscar(); /* eslint-disable-next-line */ }, [page]);

    const handleSearch = () => { setPage(1); buscar({ offset: 0 }); };

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <Box>
            <Grid container spacing={2} mb={2}>
                <Grid item xs={12} md={2}>
                    <TextField fullWidth size="small" label="Desde" type="date" InputLabelProps={{ shrink: true }}
                        value={filters.desde ?? ''} onChange={(e) => setFilters({ ...filters, desde: e.target.value || undefined })} />
                </Grid>
                <Grid item xs={12} md={2}>
                    <TextField fullWidth size="small" label="Hasta" type="date" InputLabelProps={{ shrink: true }}
                        value={filters.hasta ?? ''} onChange={(e) => setFilters({ ...filters, hasta: e.target.value || undefined })} />
                </Grid>
                <Grid item xs={12} md={2}>
                    <TextField select fullWidth size="small" label="Módulo"
                        value={filters.modulo ?? ''} onChange={(e) => setFilters({ ...filters, modulo: e.target.value || undefined })}>
                        <MenuItem value="">(todos)</MenuItem>
                        {MODULOS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} md={2}>
                    <TextField select fullWidth size="small" label="Estado"
                        value={filters.estado ?? ''} onChange={(e) => setFilters({ ...filters, estado: e.target.value || undefined })}>
                        <MenuItem value="">(todos)</MenuItem>
                        {ESTADOS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} md={2}>
                    <TextField select fullWidth size="small" label="Severidad"
                        value={filters.severidad ?? ''} onChange={(e) => setFilters({ ...filters, severidad: e.target.value || undefined })}>
                        <MenuItem value="">(todas)</MenuItem>
                        {SEVERIDADES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </TextField>
                </Grid>
                <Grid item xs={12} md={2}>
                    <TextField fullWidth size="small" label="Entidad" value={filters.entidad ?? ''}
                        onChange={(e) => setFilters({ ...filters, entidad: e.target.value || undefined })} />
                </Grid>
                <Grid item xs={12} md={2}>
                    <TextField fullWidth size="small" label="Tipo" value={filters.tipo ?? ''}
                        onChange={(e) => setFilters({ ...filters, tipo: e.target.value || undefined })} />
                </Grid>
                <Grid item xs={12} md={2}>
                    <TextField fullWidth size="small" label="Deudor ID" type="number"
                        value={filters.deudorId ?? ''}
                        onChange={(e) => setFilters({ ...filters, deudorId: e.target.value ? Number(e.target.value) : undefined })} />
                </Grid>
                <Grid item xs={12} md={4}>
                    <TextField fullWidth size="small" label="Búsqueda libre (resumen, recurso, entidad, tipo)"
                        value={filters.q ?? ''} onChange={(e) => setFilters({ ...filters, q: e.target.value || undefined })} />
                </Grid>
                <Grid item xs={12} md={4}>
                    <Stack direction="row" spacing={1}>
                        <Button variant="contained" onClick={handleSearch}>Buscar</Button>
                        <Button variant="outlined" onClick={() => { setFilters({}); setPage(1); }}>Limpiar</Button>
                        {tienePermiso('auditoria.exportar') && (
                            <>
                                <Button
                                    startIcon={<FileDownloadIcon />}
                                    endIcon={<ArrowDropDownIcon />}
                                    variant="outlined"
                                    disabled={exporting}
                                    onClick={(e) => setExportAnchor(e.currentTarget)}
                                >
                                    {exporting ? 'Exportando…' : 'Exportar'}
                                </Button>
                                <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
                                    <MenuItem onClick={() => exportarServer('xlsx')}>Excel (.xlsx)</MenuItem>
                                    <MenuItem onClick={() => exportarServer('csv')}>CSV</MenuItem>
                                    <MenuItem onClick={() => exportarServer('pdf')}>PDF</MenuItem>
                                    <MenuItem onClick={() => { setExportAnchor(null); downloadCSV(items); }}>CSV (página actual)</MenuItem>
                                </Menu>
                            </>
                        )}
                    </Stack>
                </Grid>
            </Grid>

            {loading ? (
                <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
            ) : (
                <>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Fecha</TableCell>
                                <TableCell>Usuario</TableCell>
                                <TableCell>Módulo</TableCell>
                                <TableCell>Entidad</TableCell>
                                <TableCell>Tipo</TableCell>
                                <TableCell>Deudor</TableCell>
                                <TableCell>Estado</TableCell>
                                <TableCell>Resumen</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {items.map((it) => (
                                <TableRow key={it.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelected(it)}>
                                    <TableCell>{new Date(it.createdAt).toLocaleString()}</TableCell>
                                    <TableCell>{it.usuario?.nombre ?? 'Sistema'}</TableCell>
                                    <TableCell><Chip size="small" label={it.modulo} /></TableCell>
                                    <TableCell>{it.entidad}</TableCell>
                                    <TableCell>{it.tipo}</TableCell>
                                    <TableCell>
                                        {it.deudor
                                            ? `#${it.deudor.id} · ${it.deudor.nombre ?? ''} ${it.deudor.apellido ?? ''}`.trim()
                                            : '—'}
                                    </TableCell>
                                    <TableCell>
                                        <Chip size="small" label={it.estado} color={it.estado === 'FALLIDO' ? 'error' : 'default'} />
                                    </TableCell>
                                    <TableCell>{it.resumen ?? '—'}</TableCell>
                                </TableRow>
                            ))}
                            {items.length === 0 && (
                                <TableRow><TableCell colSpan={8} align="center"><Typography color="text.secondary" py={2}>Sin resultados</Typography></TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>

                    <Box display="flex" justifyContent="space-between" alignItems="center" mt={2}>
                        <Typography variant="caption" color="text.secondary">
                            {total.toLocaleString()} resultados
                        </Typography>
                        <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)} />
                    </Box>
                </>
            )}

            <Drawer anchor="right" open={!!selected} onClose={() => setSelected(null)} PaperProps={{ sx: { width: { xs: '100%', md: 640 } } }}>
                {selected && (
                    <Box p={2}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                            <Typography variant="h6">Transacción #{selected.id}</Typography>
                            <IconButton onClick={() => setSelected(null)}><CloseIcon /></IconButton>
                        </Stack>
                        <Stack spacing={1} mb={2}>
                            <Typography variant="body2"><strong>Fecha:</strong> {new Date(selected.createdAt).toLocaleString()}</Typography>
                            <Typography variant="body2"><strong>Usuario:</strong> {selected.usuario?.nombre ?? 'Sistema'} ({selected.usuario?.email ?? '—'})</Typography>
                            <Typography variant="body2"><strong>Módulo:</strong> {selected.modulo} / {selected.entidad} / {selected.tipo}</Typography>
                            <Typography variant="body2"><strong>Estado:</strong> {selected.estado} · <strong>Severidad:</strong> {selected.severidad}</Typography>
                            {selected.deudor && <Typography variant="body2"><strong>Deudor:</strong> {selected.deudor.nombre} {selected.deudor.apellido} ({selected.deudor.documento})</Typography>}
                            {selected.empresa && <Typography variant="body2"><strong>Empresa:</strong> {selected.empresa.nombre}</Typography>}
                            {selected.resumen && <Typography variant="body2"><strong>Resumen:</strong> {selected.resumen}</Typography>}
                            {selected.ip && <Typography variant="body2"><strong>IP:</strong> {selected.ip}</Typography>}
                        </Stack>
                        <AuditDiffView
                            before={selected.data?.before}
                            after={selected.data?.after}
                            extra={(() => {
                                const { before: _b, after: _a, ...rest } = selected.data ?? {};
                                return rest;
                            })()}
                        />
                    </Box>
                )}
            </Drawer>
        </Box>
    );
};

export default AuditoriaBusqueda;
