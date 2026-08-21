import React from 'react';
import { Box, useTheme } from '@mui/material';
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SeriePagoItem, SerieGestionItem } from '../../../types/dashboards';
import EmptyState from '../../../components/ui/EmptyState';
import { fmtMoneyShort, fmtNumber } from '../utils';

interface SeriePagosProps {
    data: SeriePagoItem[];
    height?: number;
}

export const SeriePagos: React.FC<SeriePagosProps> = ({ data, height = 280 }) => {
    const theme = useTheme();
    if (!data?.length) {
        return (
            <Box height={height} display="flex" alignItems="center" justifyContent="center">
                <EmptyState title="Sin pagos" description="No hay pagos en el período." />
            </Box>
        );
    }
    return (
        <Box height={height}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="gradPagos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={theme.palette.success.main} stopOpacity={0.6} />
                            <stop offset="95%" stopColor={theme.palette.success.main} stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis dataKey="fecha" tick={{ fontSize: 11 }} stroke={theme.palette.text.secondary} />
                    <YAxis
                        yAxisId="importe"
                        tick={{ fontSize: 11 }}
                        stroke={theme.palette.text.secondary}
                        tickFormatter={(v) => fmtMoneyShort(Number(v))}
                    />
                    {/*
                      Eje propio para la cantidad: el backend siempre la calculó y el tooltip ya tenía
                      su rama, pero no había ninguna serie que la dibujara. Sin un segundo eje, un mes
                      de $8M y 40 pagos deja la línea de cantidad pegada al piso.
                    */}
                    <YAxis
                        yAxisId="cantidad"
                        orientation="right"
                        tick={{ fontSize: 11 }}
                        stroke={theme.palette.text.secondary}
                        tickFormatter={(v) => fmtNumber(Number(v))}
                        allowDecimals={false}
                    />
                    <Tooltip
                        formatter={(value: any, name: any) => {
                            if (name === 'importe') return [fmtMoneyShort(Number(value)), 'Pagos'];
                            return [fmtNumber(Number(value)), 'Cantidad'];
                        }}
                    />
                    <Area
                        yAxisId="importe"
                        type="monotone"
                        dataKey="importe"
                        stroke={theme.palette.success.main}
                        fill="url(#gradPagos)"
                        strokeWidth={2}
                    />
                    <Line
                        yAxisId="cantidad"
                        type="monotone"
                        dataKey="cantidad"
                        stroke={theme.palette.info.main}
                        strokeWidth={2}
                        dot={false}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </Box>
    );
};

interface SerieGestionesProps {
    data: SerieGestionItem[];
    height?: number;
}

export const SerieGestiones: React.FC<SerieGestionesProps> = ({ data, height = 220 }) => {
    const theme = useTheme();
    if (!data?.length) {
        return (
            <Box height={height} display="flex" alignItems="center" justifyContent="center">
                <EmptyState title="Sin gestiones" description="No hay actividad en el período." />
            </Box>
        );
    }
    return (
        <Box height={height}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis dataKey="fecha" tick={{ fontSize: 11 }} stroke={theme.palette.text.secondary} />
                    <YAxis tick={{ fontSize: 11 }} stroke={theme.palette.text.secondary} />
                    <Tooltip formatter={(value: any) => [fmtNumber(Number(value)), 'Gestiones']} />
                    <Line type="monotone" dataKey="cantidad" stroke={theme.palette.primary.main} strokeWidth={2} dot={false} />
                </LineChart>
            </ResponsiveContainer>
        </Box>
    );
};
