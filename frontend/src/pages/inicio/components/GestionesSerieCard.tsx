import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { MiDiaDto } from '../../../api/inicio';
import { SectionCard } from '../../../components/ui';
import { fmtNumber } from '../../dashboards/utils';
import { diaCorto, esFinDeSemana } from '../formato';
import BloqueEstado from './BloqueEstado';

interface Props {
    datos: MiDiaDto | null;
    cargando: boolean;
    onReintentar: () => void;
}

/** B5. 14 barras, con el fin de semana más tenue y hoy resaltado. */
const GestionesSerieCard: React.FC<Props> = ({ datos, cargando, onReintentar }) => {
    const theme = useTheme();
    const g = datos?.gestiones ?? null;
    const falla = !cargando && (!datos || datos.errores.includes('gestiones') || !g);

    let cuerpo: React.ReactNode;
    if (cargando && !datos) cuerpo = <BloqueEstado estado="cargando" forma="grafico" />;
    else if (falla || !g) cuerpo = <BloqueEstado estado="error" onReintentar={onReintentar} />;
    else if (g.serie.every((d) => d.gestiones === 0)) cuerpo = <BloqueEstado estado="vacio" vacio="Sin gestiones en las últimas dos semanas" />;
    else {
        const ultimo = g.serie.length - 1;
        cuerpo = (
            <Box sx={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 160 }}>
                    <BarChart data={g.serie} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                        <XAxis
                            dataKey="dia"
                            tickFormatter={diaCorto}
                            tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
                            stroke={theme.palette.divider}
                            tickLine={false}
                            interval="preserveStartEnd"
                            minTickGap={12}
                        />
                        <Tooltip
                            cursor={{ fill: alpha(theme.palette.text.primary, 0.06) }}
                            content={({ active, payload }) => {
                                const d = active ? (payload?.[0]?.payload as { dia: string; gestiones: number; casos: number } | undefined) : undefined;
                                if (!d) return null;
                                return (
                                    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.25, py: 0.75 }}>
                                        <Typography variant="caption" color="text.secondary" component="div">
                                            {diaCorto(d.dia)}
                                        </Typography>
                                        <Typography variant="body2" fontWeight={600}>
                                            {fmtNumber(d.gestiones)} {d.gestiones === 1 ? 'gestión' : 'gestiones'} · {fmtNumber(d.casos)} {d.casos === 1 ? 'caso' : 'casos'}
                                        </Typography>
                                    </Box>
                                );
                            }}
                        />
                        <Bar dataKey="gestiones" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                            {g.serie.map((d, i) => (
                                <Cell
                                    key={d.dia}
                                    fill={theme.palette.primary.main}
                                    fillOpacity={i === ultimo ? 1 : esFinDeSemana(d.dia) ? 0.3 : 0.6}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </Box>
        );
    }

    return (
        <SectionCard
            title="Tus gestiones, últimos 14 días"
            subtitle={g && !falla ? `Esta semana: ${fmtNumber(g.semana.gestiones)}${g.truncado ? '+' : ''} gestiones · ${fmtNumber(g.semana.casos)}${g.truncado ? '+' : ''} casos` : undefined}
        >
            {cuerpo}
        </SectionCard>
    );
};

export default GestionesSerieCard;
