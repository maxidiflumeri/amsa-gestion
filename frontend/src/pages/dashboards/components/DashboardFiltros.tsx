import React, { useEffect, useMemo, useState } from 'react';
import {
    Box,
    Button,
    Checkbox,
    Chip,
    FormControl,
    Grid,
    InputLabel,
    ListItemText,
    MenuItem,
    OutlinedInput,
    Paper,
    Select,
    Stack,
    TextField,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import api from '../../../api/axios';
import { etiquetaRemesa } from '../../../utils/remesa';
import { useAuth } from '../../../context/AuthContext';
import { useEmpresas } from '../../../hooks/useEmpresas';
import type { Granularidad, SnapshotFiltros } from '../../../types/dashboards';
import { daysAgoIso, todayIso } from '../utils';

/** Espejo de `RANGO_MAX_DIAS` en backend/src/modules/dashboards/codigos.constants.ts. */
const RANGO_MAX_DIAS = 366;

interface Remesa { id: number; nombre: string; numeroRemesa?: string | null; createdAt?: string; empresaId: number; }
interface Parametro { id: number; clave: string; descripcion: string; grupo: string; }

interface Props {
    value: SnapshotFiltros;
    onChange: (next: SnapshotFiltros) => void;
    onRefresh: () => void;
    loading?: boolean;
}

const ITEM_HEIGHT = 48;
const MenuProps = {
    PaperProps: {
        style: { maxHeight: ITEM_HEIGHT * 6.5, width: 300 },
    },
};

export const DEFAULT_FILTROS: SnapshotFiltros = {
    empresaId: null,
    remesaId: null,
    desde: daysAgoIso(30),
    hasta: todayIso(),
    situacionIds: [],
    gestionIds: [],
    motivoIds: [],
};

const DashboardFiltros: React.FC<Props> = ({ value, onChange, onRefresh, loading }) => {
    const { tienePermiso } = useAuth();
    const verTodas = tienePermiso('dashboards.ver_todas_empresas');
    const { empresas } = useEmpresas();

    const [remesas, setRemesas] = useState<Remesa[]>([]);
    const [situaciones, setSituaciones] = useState<Parametro[]>([]);
    const [gestiones, setGestiones] = useState<Parametro[]>([]);
    const [motivos, setMotivos] = useState<Parametro[]>([]);

    // Los códigos son por empresa: sin `empresaId` el combo ofrecía todo el catálogo y se podía
    // filtrar por un código que esa cartera no usa, quedándose en cero sin ningún aviso.
    useEffect(() => {
        if (!value.empresaId) {
            setSituaciones([]);
            setGestiones([]);
            setMotivos([]);
            return;
        }
        const comunes = { empresaId: value.empresaId, activo: 'true' };
        api.get('/parametros', { params: { ...comunes, grupo: 'situacion' } })
            .then((r) => setSituaciones(r.data)).catch(() => null);
        api.get('/parametros', { params: { ...comunes, grupo: 'gestion' } })
            .then((r) => setGestiones(r.data)).catch(() => null);
        api.get('/parametros', { params: { ...comunes, grupo: 'motivo_no_pago' } })
            .then((r) => setMotivos(r.data)).catch(() => null);
    }, [value.empresaId]);

    // Cargar remesas cuando cambia empresa
    useEffect(() => {
        if (!value.empresaId) {
            setRemesas([]);
            return;
        }
        // Solo las remesas que tienen cartera cargada: filtrar el tablero por una remesa de PAGOS o
        // ACTUALIZACIONES devuelve 0 casos, porque los deudores cuelgan de la remesa donde se crearon.
        api.get(`/import/remesas/empresa/${value.empresaId}`, { params: { conDeudores: 'true' } })
            .then((r) => setRemesas(r.data))
            .catch(() => setRemesas([]));
    }, [value.empresaId]);

    // El tope lo valida el backend, pero recién al calcular: sin esto el usuario escribía el rango y
    // recibía un error rojo del servidor donde alcanzaba con avisarle en el campo.
    const rangoExcedido = useMemo(() => {
        if (!value.desde || !value.hasta) return false;
        const dias = (new Date(value.hasta).getTime() - new Date(value.desde).getTime()) / 86_400_000;
        return Number.isFinite(dias) && dias > RANGO_MAX_DIAS;
    }, [value.desde, value.hasta]);

    const update = (patch: Partial<SnapshotFiltros>) => onChange({ ...value, ...patch });

    const handleEmpresaChange = (empresaId: number | null) => {
        // Los códigos elegidos son de la empresa anterior: dejarlos puestos deja el tablero en cero.
        update({ empresaId, remesaId: null, situacionIds: [], gestionIds: [], motivoIds: [] });
    };

    const handleReset = () => {
        // Se conserva la empresa: sin ella el tablero no se calcula, así que "Limpiar" dejaba la
        // pantalla en blanco justamente a quien podía elegir entre varias.
        const base: SnapshotFiltros = {
            ...DEFAULT_FILTROS,
            empresaId: value.empresaId ?? null,
        };
        onChange(base);
    };

    const renderChipMulti = (selected: number[], options: Parametro[]) => (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {selected.slice(0, 3).map((id) => {
                const o = options.find((p) => p.id === id);
                return <Chip key={id} label={o?.descripcion ?? id} size="small" />;
            })}
            {selected.length > 3 && <Chip label={`+${selected.length - 3}`} size="small" />}
        </Box>
    );

    const granularidades: Granularidad[] = ['dia', 'semana', 'mes'];

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 2,
                mb: 2,
                position: 'sticky',
                top: 0,
                zIndex: 5,
                borderRadius: 2,
                bgcolor: 'background.paper',
            }}
        >
            <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth size="small" disabled={!verTodas && empresas.length <= 1}>
                        <InputLabel>Empresa</InputLabel>
                        <Select
                            label="Empresa"
                            value={value.empresaId ?? ''}
                            onChange={(e) => handleEmpresaChange(e.target.value === '' ? null : Number(e.target.value))}
                        >
                            {/*
                              No hay opción "Todas": el snapshot no se calcula sin empresa, así que
                              elegirla dejaba el tablero en blanco con el cartel de "seleccioná una
                              empresa" y sin explicar por qué.
                            */}
                            {empresas.map((e) => (
                                <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth size="small" disabled={!value.empresaId}>
                        <InputLabel>Remesa</InputLabel>
                        <Select
                            label="Remesa"
                            value={value.remesaId ?? ''}
                            onChange={(e) => update({ remesaId: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                            <MenuItem value=""><em>Todas las remesas</em></MenuItem>
                            {remesas.map((r) => (
                                <MenuItem key={r.id} value={r.id}>{etiquetaRemesa(r)}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={6} sm={3} md={2}>
                    <TextField
                        type="date"
                        size="small"
                        fullWidth
                        label="Desde"
                        InputLabelProps={{ shrink: true }}
                        value={value.desde}
                        error={rangoExcedido}
                        onChange={(e) => update({ desde: e.target.value })}
                    />
                </Grid>
                <Grid item xs={6} sm={3} md={2}>
                    <TextField
                        type="date"
                        size="small"
                        fullWidth
                        label="Hasta"
                        InputLabelProps={{ shrink: true }}
                        value={value.hasta}
                        error={rangoExcedido}
                        helperText={rangoExcedido ? `Máximo ${RANGO_MAX_DIAS} días` : undefined}
                        onChange={(e) => update({ hasta: e.target.value })}
                    />
                </Grid>

                <Grid item xs={12} sm={12} md={2}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Granularidad</InputLabel>
                        <Select
                            label="Granularidad"
                            value={value.granularidad ?? ''}
                            onChange={(e) => update({ granularidad: e.target.value === '' ? undefined : (e.target.value as Granularidad) })}
                        >
                            <MenuItem value=""><em>Auto</em></MenuItem>
                            {granularidades.map((g) => (
                                <MenuItem key={g} value={g}>{g}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={4}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Estado situación</InputLabel>
                        <Select
                            multiple
                            label="Estado situación"
                            value={value.situacionIds ?? []}
                            onChange={(e) => update({ situacionIds: e.target.value as number[] })}
                            input={<OutlinedInput label="Estado situación" />}
                            renderValue={(sel) => renderChipMulti(sel as number[], situaciones)}
                            MenuProps={MenuProps}
                        >
                            {situaciones.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    <Checkbox checked={(value.situacionIds ?? []).includes(p.id)} />
                                    <ListItemText primary={p.descripcion} secondary={p.clave} />
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={4}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Estado gestión</InputLabel>
                        <Select
                            multiple
                            label="Estado gestión"
                            value={value.gestionIds ?? []}
                            onChange={(e) => update({ gestionIds: e.target.value as number[] })}
                            input={<OutlinedInput label="Estado gestión" />}
                            renderValue={(sel) => renderChipMulti(sel as number[], gestiones)}
                            MenuProps={MenuProps}
                        >
                            {gestiones.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    <Checkbox checked={(value.gestionIds ?? []).includes(p.id)} />
                                    <ListItemText primary={p.descripcion} secondary={p.clave} />
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Motivo no pago</InputLabel>
                        <Select
                            multiple
                            label="Motivo no pago"
                            value={value.motivoIds ?? []}
                            onChange={(e) => update({ motivoIds: e.target.value as number[] })}
                            input={<OutlinedInput label="Motivo no pago" />}
                            renderValue={(sel) => renderChipMulti(sel as number[], motivos)}
                            MenuProps={MenuProps}
                        >
                            {motivos.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    <Checkbox checked={(value.motivoIds ?? []).includes(p.id)} />
                                    <ListItemText primary={p.descripcion} secondary={p.clave} />
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} sm={6} md={1}>
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={handleReset}
                            startIcon={<RestartAltIcon />}
                        >
                            Limpiar
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            onClick={onRefresh}
                            disabled={loading}
                            startIcon={<RefreshIcon />}
                        >
                            Refrescar
                        </Button>
                    </Stack>
                </Grid>
            </Grid>
        </Paper>
    );
};

export default DashboardFiltros;
