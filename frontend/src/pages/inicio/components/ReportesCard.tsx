import React, { useCallback, useState } from 'react';
import { Box, Button, Chip, LinearProgress, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import type { EjecucionResumenDto, MiDiaDto } from '../../../api/inicio';
import { reportesApi } from '../../../api/reportes';
import { SectionCard } from '../../../components/ui';
import { useNotify } from '../../../hooks/useNotify';
import { fmtNumber } from '../../dashboards/utils';
import { useReportesSocket } from '../../reportes/hooks/useReportesSocket';
import { haceCuanto } from '../formato';
import BloqueEstado from './BloqueEstado';

interface Props {
    datos: MiDiaDto | null;
    cargando: boolean;
    onReintentar: () => void;
    recargar: () => Promise<void>;
}

const activa = (e: EjecucionResumenDto) => e.estado === 'EJECUTANDO' || e.estado === 'PENDIENTE';

/**
 * Se monta solo mientras hay un reporte corriendo: así Inicio no abre el socket `/reportes` en cada visita.
 * Con `progreso` actualiza el % local; con `completado` o `fallido` vuelve a pedir `mi-dia`.
 */
const EscuchaReportes: React.FC<{ onProgreso: (id: number, pct: number) => void; recargar: () => Promise<void> }> = ({ onProgreso, recargar }) => {
    useReportesSocket({
        onProgreso: (p) => onProgreso(p.ejecucionId, p.progreso),
        onCompletado: () => void recargar(),
        onFallido: () => void recargar(),
    });
    return null;
};

/** B10. Tus últimas 5 ejecuciones de los últimos 7 días. */
const ReportesCard: React.FC<Props> = ({ datos, cargando, onReintentar, recargar }) => {
    const notify = useNotify();
    const navigate = useNavigate();
    const [progresos, setProgresos] = useState<Record<number, number>>({});
    const [descargando, setDescargando] = useState<number | null>(null);
    const lista = datos?.reportes ?? null;

    const alProgreso = useCallback((id: number, pct: number) => setProgresos((p) => ({ ...p, [id]: pct })), []);

    const descargar = async (e: EjecucionResumenDto) => {
        setDescargando(e.id);
        try {
            const res = await reportesApi.descargarEjecucion(e.id);
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${e.plantilla || 'reporte'}_${e.id}.${e.formato || 'bin'}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            notify.success('Descarga iniciada');
        } catch (err) {
            notify.error(err as Error);
        } finally {
            setDescargando(null);
        }
    };

    let cuerpo: React.ReactNode;
    if (cargando && !datos) cuerpo = <BloqueEstado estado="cargando" filas={3} />;
    else if (!datos || datos.errores.includes('reportes') || !lista) cuerpo = <BloqueEstado estado="error" onReintentar={onReintentar} />;
    else if (lista.length === 0) {
        cuerpo = <BloqueEstado estado="vacio" vacio="No ejecutaste reportes en los últimos 7 días" accionVacio={{ etiqueta: 'Ir a Reportes', onClick: () => navigate('/reportes') }} />;
    } else {
        cuerpo = (
            <>
                {lista.some(activa) && <EscuchaReportes onProgreso={alProgreso} recargar={recargar} />}
                <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {lista.map((e) => {
                        const pct = Math.max(0, Math.min(100, Math.round(progresos[e.id] ?? e.progreso)));
                        const detalle = [e.formato?.toUpperCase(), e.totalFilas !== null ? `${fmtNumber(e.totalFilas)} filas` : null, haceCuanto(e.terminadaEn ?? e.creadaEn)].filter(Boolean).join(' · ');
                        return (
                            <Stack component="li" key={e.id} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="body2" fontWeight={600} noWrap>
                                        {e.plantilla}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                                        {detalle}
                                    </Typography>
                                </Box>
                                {e.estado === 'FINALIZADA' && e.descargable && (
                                    <Button size="small" variant="outlined" disabled={descargando === e.id} onClick={() => void descargar(e)} sx={{ flex: 'none' }}>
                                        Descargar
                                    </Button>
                                )}
                                {e.estado === 'FINALIZADA' && !e.descargable && <Chip label="Finalizada" size="small" color="success" sx={{ height: 22 }} />}
                                {activa(e) && (
                                    <Stack spacing={0.25} sx={{ width: 90, flex: 'none' }}>
                                        <LinearProgress variant="determinate" value={pct} aria-label={`Progreso del reporte ${e.id}`} />
                                        <Typography variant="caption" color="text.secondary" align="right">
                                            {pct} %
                                        </Typography>
                                    </Stack>
                                )}
                                {e.estado === 'FALLIDA' && <Chip label="Fallida" size="small" color="error" sx={{ height: 22 }} />}
                                {e.estado === 'CANCELADA' && <Chip label="Cancelada" size="small" variant="outlined" sx={{ height: 22 }} />}
                            </Stack>
                        );
                    })}
                </Stack>
            </>
        );
    }

    return (
        <SectionCard
            title="Tus reportes"
            action={
                <Link component={RouterLink} to="/reportes/ejecuciones" variant="body2" underline="hover" sx={{ pr: 1, pt: 0.5, display: 'inline-block' }}>
                    Reportes
                </Link>
            }
        >
            {cuerpo}
        </SectionCard>
    );
};

export default ReportesCard;
