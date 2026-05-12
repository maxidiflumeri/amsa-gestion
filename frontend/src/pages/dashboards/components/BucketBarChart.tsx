import React from 'react';
import { Box, useTheme } from '@mui/material';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BucketItem } from '../../../types/dashboards';
import EmptyState from '../../../components/ui/EmptyState';
import { fmtNumber, fmtMoneyShort, fmtPercent } from '../utils';

interface Props {
    data: BucketItem[];
    height?: number;
    mostrarSuma?: boolean;
    onBarClick?: (item: BucketItem) => void;
}

const BucketBarChart: React.FC<Props> = ({ data, height = 220, mostrarSuma, onBarClick }) => {
    const theme = useTheme();
    if (!data?.length || data.every((d) => d.cantidad === 0)) {
        return (
            <Box height={height} display="flex" alignItems="center" justifyContent="center">
                <EmptyState title="Sin datos" />
            </Box>
        );
    }
    return (
        <Box height={height}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis dataKey="rango" tick={{ fontSize: 12 }} stroke={theme.palette.text.secondary} />
                    <YAxis tick={{ fontSize: 12 }} stroke={theme.palette.text.secondary} />
                    <Tooltip
                        formatter={(value: any, _name: any, payload: any) => {
                            const pct = payload?.payload?.porcentaje ?? 0;
                            const suma = payload?.payload?.suma;
                            const cantText = `${fmtNumber(Number(value))} (${fmtPercent(pct)})`;
                            if (mostrarSuma && suma != null) {
                                return [`${cantText} — ${fmtMoneyShort(suma)}`, 'Cantidad'];
                            }
                            return [cantText, 'Cantidad'];
                        }}
                    />
                    <Bar
                        dataKey="cantidad"
                        fill={theme.palette.primary.main}
                        radius={[4, 4, 0, 0]}
                        onClick={(payload: any) => {
                            if (!onBarClick) return;
                            const item = (payload?.payload ?? payload) as BucketItem | undefined;
                            if (item) onBarClick(item);
                        }}
                        style={onBarClick ? { cursor: 'pointer' } : undefined}
                    />
                </BarChart>
            </ResponsiveContainer>
        </Box>
    );
};

export default BucketBarChart;
