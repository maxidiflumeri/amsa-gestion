import React, { useMemo, useState } from 'react';
import { Alert, Box, Chip, Grid, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import { PageContainer, PageHeader, SectionCard } from '../../components/ui';
import DashboardFiltros, { DEFAULT_FILTROS } from './components/DashboardFiltros';
import KpiGrid from './components/KpiGrid';
import DistribucionDonut from './components/DistribucionDonut';
import BucketBarChart from './components/BucketBarChart';
import { SerieGestiones, SeriePagos } from './components/SeriePagos';
import FunnelGestion from './components/FunnelGestion';
import TopDeudoresTable from './components/TopDeudoresTable';
import ExportarMenu from './components/ExportarMenu';
import DrillDownDialog from './components/DrillDownDialog';
import { useTableroSnapshot } from './hooks/useTableroSnapshot';
import type { SnapshotFiltros, BucketItem, DistribucionItem } from '../../types/dashboards';
import type { DimensionDrillDown } from '../../api/dashboards';
import { fmtNumber } from './utils';

interface DrillState {
    dimension: DimensionDrillDown;
    valor: string;
    titulo: string;
}

const TableroRemesa: React.FC = () => {
    const [filtros, setFiltros] = useState<SnapshotFiltros>(() => ({ ...DEFAULT_FILTROS }));
    const [drill, setDrill] = useState<DrillState | null>(null);

    const { data, loading, error, refresh } = useTableroSnapshot(filtros);

    const generadoEn = useMemo(() => {
        if (!data?.meta?.generadoEn) return '';
        return new Date(data.meta.generadoEn).toLocaleString('es-AR');
    }, [data]);

    const openDistribucionDrill = (dimension: DimensionDrillDown, item: DistribucionItem) => {
        setDrill({
            dimension,
            valor: item.id == null ? 'null' : String(item.id),
            titulo: `${dimension} · ${item.label}`,
        });
    };

    const openBucketDrill = (dimension: 'mora' | 'deuda', item: BucketItem) => {
        setDrill({
            dimension,
            valor: item.rango,
            titulo: `${dimension} · ${item.rango}`,
        });
    };

    return (
        <PageContainer>
            <PageHeader
                title="Tablero de remesa"
                subtitle="Métricas, distribuciones y evolución de la cartera filtrada"
            />

            <DashboardFiltros value={filtros} onChange={setFiltros} onRefresh={refresh} loading={loading} />

            {loading && <LinearProgress sx={{ mb: 2 }} />}

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {filtros.empresaId == null && !loading && (
                <Paper
                    variant="outlined"
                    sx={{
                        p: 6,
                        textAlign: 'center',
                        bgcolor: 'background.default',
                        borderStyle: 'dashed',
                    }}
                >
                    <BusinessIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 1 }} />
                    <Typography variant="h6" gutterBottom>
                        Seleccioná una empresa para ver el tablero
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Para evitar consultas pesadas en carteras grandes, el tablero se genera recién cuando elegís una empresa (y opcionalmente una remesa o rango de fechas).
                    </Typography>
                </Paper>
            )}

            {data && (
                <Stack spacing={3}>
                    <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
                        <Typography variant="body2" color="text.secondary">
                            {data.meta.empresaNombre ?? 'Todas las empresas'}
                            {data.meta.remesaNombre ? ` · ${data.meta.remesaNombre}` : ''}
                        </Typography>
                        <Chip
                            label={`${fmtNumber(data.meta.totalDeudoresFiltrados)} casos filtrados`}
                            size="small"
                            color="primary"
                            variant="outlined"
                        />
                        <Box flex={1} />
                        <Typography variant="caption" color="text.secondary">
                            Generado: {generadoEn}
                        </Typography>
                        <ExportarMenu
                            filtros={filtros}
                            nombreTablero={data.meta.remesaNombre || data.meta.empresaNombre || 'tablero'}
                            disabled={loading}
                        />
                    </Stack>

                    <KpiGrid kpis={data.kpis} />

                    <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                            <SectionCard title="Por estado de situación">
                                <DistribucionDonut
                                    data={data.distribuciones.porSituacion}
                                    onSliceClick={(it) => openDistribucionDrill('situacion', it)}
                                />
                            </SectionCard>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <SectionCard title="Por estado de gestión">
                                <DistribucionDonut
                                    data={data.distribuciones.porGestion}
                                    onSliceClick={(it) => openDistribucionDrill('gestion', it)}
                                />
                            </SectionCard>
                        </Grid>

                        <Grid item xs={12} md={6}>
                            <SectionCard title="Por motivo de no pago">
                                <DistribucionDonut
                                    data={data.distribuciones.porMotivo}
                                    onSliceClick={(it) => openDistribucionDrill('motivo', it)}
                                />
                            </SectionCard>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <SectionCard title="Funnel de gestión">
                                <FunnelGestion data={data.funnel} />
                            </SectionCard>
                        </Grid>

                        <Grid item xs={12} md={6}>
                            <SectionCard title="Distribución por rango de mora">
                                <BucketBarChart
                                    data={data.distribuciones.porMora}
                                    onBarClick={(it) => openBucketDrill('mora', it)}
                                />
                            </SectionCard>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <SectionCard title="Distribución por rango de deuda">
                                <BucketBarChart
                                    data={data.distribuciones.porDeuda}
                                    mostrarSuma
                                    onBarClick={(it) => openBucketDrill('deuda', it)}
                                />
                            </SectionCard>
                        </Grid>

                        <Grid item xs={12}>
                            <SectionCard
                                title={`Pagos por ${data.series.granularidad}`}
                                subtitle="Importes y cantidad en el período"
                            >
                                <SeriePagos data={data.series.pagosPorPeriodo} />
                            </SectionCard>
                        </Grid>

                        <Grid item xs={12} md={6}>
                            <SectionCard title={`Gestiones por ${data.series.granularidad}`}>
                                <SerieGestiones data={data.series.gestionesPorPeriodo} />
                            </SectionCard>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <SectionCard title="Top motivos de no pago">
                                {data.top.motivos.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary">Sin datos.</Typography>
                                ) : (
                                    <Stack spacing={1}>
                                        {data.top.motivos.map((m) => (
                                            <Stack key={m.id} direction="row" justifyContent="space-between" alignItems="center">
                                                <Typography variant="body2">{m.label}</Typography>
                                                <Stack direction="row" spacing={1} alignItems="center">
                                                    <Typography variant="body2" fontWeight={600}>{fmtNumber(m.cantidad)}</Typography>
                                                    <Chip label={`${m.porcentaje.toFixed(1)}%`} size="small" />
                                                </Stack>
                                            </Stack>
                                        ))}
                                    </Stack>
                                )}
                            </SectionCard>
                        </Grid>

                        <Grid item xs={12}>
                            <SectionCard title="Top 10 deudores por monto">
                                <TopDeudoresTable deudores={data.top.deudores} />
                            </SectionCard>
                        </Grid>
                    </Grid>
                </Stack>
            )}

            <DrillDownDialog
                open={Boolean(drill)}
                onClose={() => setDrill(null)}
                filtros={filtros}
                dimension={drill?.dimension ?? null}
                valor={drill?.valor ?? null}
                titulo={drill?.titulo}
            />
        </PageContainer>
    );
};

export default TableroRemesa;
