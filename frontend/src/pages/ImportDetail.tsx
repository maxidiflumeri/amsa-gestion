import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Chip, Divider, LinearProgress, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import api from '../api/axios';
import { useNotify } from '../hooks/useNotify';
import {
    PageHeader,
    SectionCard,
    LoadingSkeleton,
    StatusChip,
    DataTableResponsive,
} from '../components/ui';
import type { StatusValue } from '../components/ui';
import type { DataTableColumn } from '../components/ui';

interface ImportError {
    id: number;
    rowNumber: number;
    errorMsg: string;
    rawRow: unknown;
    createdAt: string;
}

interface Remesa {
    id: number;
    numeroRemesa: string;
    nombre: string;
    categoria: string;
    estadoProceso: string;
    totalFilas: number;
    okFilas: number;
    errFilas: number;
    fechaVencimiento?: string | null;
    createdAt: string;
}

type ErrorRow = ImportError & Record<string, unknown>;

const estadoToStatus: Record<string, StatusValue> = {
    FINALIZADA: 'completed',
    ERROR: 'failed',
    FALLIDA: 'failed',
    PROCESANDO: 'running',
    VALIDANDO: 'pending',
};

export default function ImportDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const notify = useNotify();
    const [remesa, setRemesa] = useState<Remesa | null>(null);
    const [errors, setErrors] = useState<ImportError[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDetails = async () => {
            if (!id) return;
            try {
                setLoading(true);
                const resStatus = await api.get(`/import/remesas/${id}`);
                setRemesa(resStatus.data);

                if (resStatus.data?.errFilas > 0) {
                    const resErrors = await api.get(`/import/errores/${id}?pageSize=100`);
                    setErrors(resErrors.data.data);
                }
            } catch (err: any) {
                notify.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchDetails();
    }, [id]);

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
                    <StatusChip status="failed" label={String(row.errorMsg)} sx={{ height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal' } }} />
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

    const estadoStatus: StatusValue = remesa ? (estadoToStatus[remesa.estadoProceso] ?? 'neutral') : 'neutral';

    return (
        <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
            <PageHeader
                title={`Detalle de Importación #${id}`}
                breadcrumbs={[
                    { label: 'Importaciones', href: '/historial-importaciones' },
                    { label: `#${id}` },
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

            {loading && remesa && (
                <LinearProgress sx={{ mb: 2 }} />
            )}

            {remesa && (
                <SectionCard sx={{ mb: 3 }}>
                    <Box
                        display="flex"
                        justifyContent="space-between"
                        alignItems={{ xs: 'flex-start', sm: 'center' }}
                        flexDirection={{ xs: 'column', sm: 'row' }}
                        gap={2}
                        mb={2}
                    >
                        <Box>
                            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                <Typography variant="h6" component="span">Estado:</Typography>
                                <StatusChip status={estadoStatus} label={remesa.estadoProceso} />
                            </Box>
                            <Typography variant="caption" color="primary" fontWeight="bold" display="block">
                                #{remesa.numeroRemesa}
                            </Typography>
                        </Box>
                        <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                            <Typography variant="body1">
                                Categoría: <strong>{remesa.categoria}</strong>
                            </Typography>
                            {remesa.fechaVencimiento && (
                                <Typography variant="caption" color="text.secondary" display="block">
                                    Vencimiento Lote: {new Date(remesa.fechaVencimiento).toLocaleDateString()}
                                </Typography>
                            )}
                        </Box>
                    </Box>

                    <Divider sx={{ mb: 2 }} />

                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={{ xs: 2, sm: 4 }}
                    >
                        <Box>
                            <Typography variant="body2" color="text.secondary">Total Filas</Typography>
                            <Typography variant="h5">{remesa.totalFilas ?? 0}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="body2" color="success.main">Filas OK</Typography>
                            <Typography variant="h5" color="success.main">{remesa.okFilas ?? 0}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="body2" color="error.main">Filas Error</Typography>
                            <Typography variant="h5" color="error.main">{remesa.errFilas ?? 0}</Typography>
                        </Box>
                    </Stack>
                </SectionCard>
            )}

            {remesa && remesa.errFilas > 0 && (
                <SectionCard
                    title="Errores de fila"
                    noPadding
                    sx={{ position: 'relative' }}
                >
                    <DataTableResponsive<ErrorRow>
                        columns={errorColumns}
                        rows={errors as ErrorRow[]}
                        rowKey={(row) => String(row.id)}
                        emptyMessage="No hay errores registrados."
                    />
                </SectionCard>
            )}
        </Box>
    );
}
