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
import { useAuth } from '../../../context/AuthContext';
import { useEmpresas } from '../../../hooks/useEmpresas';
import type { Granularidad, SnapshotFiltros } from '../../../types/dashboards';
import { daysAgoIso, todayIso } from '../utils';

interface Remesa { id: number; nombre: string; empresaId: number; }
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

    // Cargar parametros una vez
    useEffect(() => {
        api.get('/parametros', { params: { grupo: 'situacion', activo: 'true' } })
            .then((r) => setSituaciones(r.data)).catch(() => null);
        api.get('/parametros', { params: { grupo: 'gestion', activo: 'true' } })
            .then((r) => setGestiones(r.data)).catch(() => null);
        api.get('/parametros', { params: { grupo: 'motivo_no_pago', activo: 'true' } })
            .then((r) => setMotivos(r.data)).catch(() => null);
    }, []);

    // Cargar remesas cuando cambia empresa
    useEffect(() => {
        if (!value.empresaId) {
            setRemesas([]);
            return;
        }
        api.get(`/import/remesas/empresa/${value.empresaId}`)
            .then((r) => setRemesas(r.data))
            .catch(() => setRemesas([]));
    }, [value.empresaId]);

    const update = (patch: Partial<SnapshotFiltros>) => onChange({ ...value, ...patch });

    const handleEmpresaChange = (empresaId: number | null) => {
        update({ empresaId, remesaId: null });
    };

    const handleReset = () => {
        const base: SnapshotFiltros = {
            ...DEFAULT_FILTROS,
            empresaId: verTodas ? null : value.empresaId ?? null,
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
                            {verTodas && <MenuItem value=""><em>Todas</em></MenuItem>}
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
                                <MenuItem key={r.id} value={r.id}>{r.nombre}</MenuItem>
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
