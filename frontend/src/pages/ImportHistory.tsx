import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    IconButton,
    LinearProgress,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import InboxIcon from '@mui/icons-material/Inbox';
import api from '../api/axios';
import { useEmpresas } from '../hooks/useEmpresas';
import { useNotify } from '../hooks/useNotify';
import {
    PageHeader,
    SectionCard,
    EmptyState,
    LoadingSkeleton,
    StatusChip,
    DataTableResponsive,
} from '../components/ui';
import type { StatusValue } from '../components/ui';
import type { DataTableColumn } from '../components/ui';

interface Remesa {
    id: number;
    nombre: string;
    numeroRemesa: string;
    categoria: string;
    archivoOriginal: string;
    estadoProceso: string;
    totalFilas: number;
    okFilas: number;
    errFilas: number;
    createdAt: string;
    politicaId?: number | null;
}

type RemesaRow = Remesa & Record<string, unknown>;

interface Politica {
    id: number;
    nombre: string;
    activa: boolean;
}

const estadoToStatus: Record<string, StatusValue> = {
    FINALIZADA: 'completed',
    ERROR: 'failed',
    FALLIDA: 'failed',
    PROCESANDO: 'running',
    VALIDANDO: 'pending',
};

export default function ImportHistory() {
    const navigate = useNavigate();
    const notify = useNotify();
    const { empresas, loading: loadingEmpresas } = useEmpresas();
    const [empresaId, setEmpresaId] = useState<number | ''>(1);
    const [remesas, setRemesas] = useState<Remesa[]>([]);
    const [loading, setLoading] = useState(true);
    const [politicas, setPoliticas] = useState<Politica[]>([]);

    const loadHistory = async () => {
        if (!empresaId) return;
        try {
            setLoading(true);
            const { data } = await api.get(`/import/remesas/empresa/${empresaId}`);
            setRemesas(data);
        } catch (err: any) {
            notify.error(err);
        } finally {
            setLoading(false);
        }
    };

    const loadPoliticas = async (eid: number) => {
        try {
            const { data } = await api.get(`/politicas?empresaId=${eid}`);
            setPoliticas((data || []).filter((p: Politica) => p.activa));
        } catch {
            setPoliticas([]);
        }
    };

    const handleAsociarPolitica = async (remesaId: number, politicaId: number | null) => {
        try {
            await api.put(`/import/remesas/${remesaId}/politica`, { politicaId });
            setRemesas(prev => prev.map(r => r.id === remesaId ? { ...r, politicaId } : r));
        } catch (err: any) {
            notify.error(err);
        }
    };

    useEffect(() => {
        if (empresaId) {
            loadHistory();
            loadPoliticas(Number(empresaId));
        }
    }, [empresaId]);

    const isFirstLoad = loading && remesas.length === 0;
    const isRefreshing = loading && remesas.length > 0;

    const columns: DataTableColumn<RemesaRow>[] = [
        {
            key: 'id',
            label: 'ID',
            hideInCard: true,
            render: (row) => String(row.id),
        },
        {
            key: 'nombre',
            label: 'Nombre / Archivo',
            primary: true,
            render: (row) => (
                <Box>
                    <Typography variant="body2" fontWeight={500}>{row.nombre}</Typography>
                    <Box display="flex" gap={1} alignItems="center">
                        <Typography variant="caption" color="primary" fontWeight="bold">
                            #{row.numeroRemesa}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {String(row.archivoOriginal ?? '').split(/[_\\/]/).pop() || 'Archivo desconocido'}
                        </Typography>
                    </Box>
                </Box>
            ),
        },
        {
            key: 'categoria',
            label: 'Categoría',
            secondary: true,
            render: (row) => String(row.categoria ?? '—'),
        },
        {
            key: 'estadoProceso',
            label: 'Estado',
            render: (row) => {
                const estado = String(row.estadoProceso ?? '');
                const status: StatusValue = estadoToStatus[estado] ?? 'neutral';
                return <StatusChip status={status} label={estado} />;
            },
        },
        {
            key: 'stats',
            label: 'Total / OK / Err',
            align: 'right',
            hideInCard: true,
            render: (row) =>
                row.estadoProceso === 'FINALIZADA' ? (
                    <Typography variant="body2">
                        {String(row.totalFilas)}{' '}
                        /{' '}
                        <Typography component="span" color="success.main" variant="body2">
                            {String(row.okFilas)}
                        </Typography>
                        {' '}
                        /{' '}
                        <Typography component="span" color="error.main" variant="body2">
                            {String(row.errFilas)}
                        </Typography>
                    </Typography>
                ) : (
                    <Typography variant="body2" color="text.secondary">-</Typography>
                ),
        },
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
                    onChange={e =>
                        handleAsociarPolitica(
                            row.id as number,
                            e.target.value === '' ? null : Number(e.target.value),
                        )
                    }
                    sx={{ fontSize: '0.75rem', minWidth: 140 }}
                >
                    <MenuItem value=""><em>Sin política</em></MenuItem>
                    {politicas.map(p => (
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
                <Tooltip title={Number(row.errFilas) > 0 ? 'Ver Detalles y Errores' : 'Ver Progreso/Detalles'}>
                    <IconButton
                        color="primary"
                        size="small"
                        onClick={() => navigate(`/historial-importaciones/${row.id}`)}
                    >
                        <VisibilityIcon />
                    </IconButton>
                </Tooltip>
            ),
        },
    ];

    return (
        <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
            <PageHeader
                title="Historial de importaciones"
                actions={[
                    {
                        label: 'Actualizar',
                        onClick: loadHistory,
                        variant: 'outlined',
                        startIcon: <RefreshIcon />,
                        disabled: loading || !empresaId,
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
                        onChange={(e) => setEmpresaId(e.target.value as number)}
                        disabled={loadingEmpresas}
                        sx={{ minWidth: 220 }}
                    >
                        {empresas.map((emp) => (
                            <MenuItem key={emp.id} value={emp.id}>
                                {emp.nombre}
                            </MenuItem>
                        ))}
                    </TextField>
                </Stack>
            </SectionCard>

            <SectionCard noPadding sx={{ position: 'relative' }}>
                {isRefreshing && (
                    <LinearProgress
                        sx={{ position: 'absolute', top: 0, left: 0, right: 0, borderRadius: '8px 8px 0 0' }}
                    />
                )}

                {isFirstLoad ? (
                    <Box sx={{ p: 2 }}>
                        <LoadingSkeleton variant="table" rows={6} columns={8} />
                    </Box>
                ) : remesas.length === 0 ? (
                    <EmptyState
                        icon={<InboxIcon />}
                        title="Sin importaciones"
                        description="No hay importaciones registradas para la empresa seleccionada."
                        action={{ label: 'Actualizar', onClick: loadHistory }}
                    />
                ) : (
                    <DataTableResponsive<RemesaRow>
                        columns={columns}
                        rows={remesas as RemesaRow[]}
                        rowKey={(row) => String(row.id)}
                    />
                )}
            </SectionCard>
        </Box>
    );
}
