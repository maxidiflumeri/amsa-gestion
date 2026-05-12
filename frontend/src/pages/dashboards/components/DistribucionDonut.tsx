import React, { useMemo } from 'react';
import { Box, useTheme } from '@mui/material';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { DistribucionItem } from '../../../types/dashboards';
import { fmtNumber, fmtPercent, getChartPalette } from '../utils';
import EmptyState from '../../../components/ui/EmptyState';

interface Props {
    data: DistribucionItem[];
    height?: number;
    topN?: number;
    donut?: boolean;
    onSliceClick?: (item: DistribucionItem) => void;
}

const DistribucionDonut: React.FC<Props> = ({ data, height = 260, topN = 6, donut = true, onSliceClick }) => {
    const theme = useTheme();
    const palette = getChartPalette(theme);

    const chartData = useMemo(() => {
        if (!data?.length) return [];
        const sorted = [...data].sort((a, b) => b.cantidad - a.cantidad);
        if (sorted.length <= topN) return sorted;
        const head = sorted.slice(0, topN);
        const tail = sorted.slice(topN);
        const otros = tail.reduce(
            (acc, r) => ({
                ...acc,
                cantidad: acc.cantidad + r.cantidad,
                porcentaje: acc.porcentaje + r.porcentaje,
            }),
            { id: null, clave: 'OTROS', label: 'Otros', categoria: null, cantidad: 0, porcentaje: 0 } as DistribucionItem,
        );
        return [...head, otros];
    }, [data, topN]);

    if (!chartData.length || chartData.every((c) => c.cantidad === 0)) {
        return (
            <Box height={height} display="flex" alignItems="center" justifyContent="center">
                <EmptyState title="Sin datos" description="No hay registros para mostrar." />
            </Box>
        );
    }

    return (
        <Box height={height}>
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={chartData}
                        dataKey="cantidad"
                        nameKey="label"
                        innerRadius={donut ? 55 : 0}
                        outerRadius={90}
                        paddingAngle={2}
                        onClick={(payload: any) => {
                            if (!onSliceClick) return;
                            const item = payload?.payload as DistribucionItem | undefined;
                            if (item && item.clave !== 'OTROS') onSliceClick(item);
                        }}
                        style={onSliceClick ? { cursor: 'pointer' } : undefined}
                    >
                        {chartData.map((_, i) => (
                            <Cell key={i} fill={palette[i % palette.length]} />
                        ))}
                    </Pie>
                    <Tooltip
                        formatter={(value: any, _name: any, payload: any) => {
                            const pct = payload?.payload?.porcentaje ?? 0;
                            return [`${fmtNumber(Number(value))} (${fmtPercent(pct)})`, payload?.payload?.label ?? ''];
                        }}
                    />
                    <Legend
                        verticalAlign="middle"
                        align="right"
                        layout="vertical"
                        formatter={(_v: any, _e: any, idx: number) => {
                            const item = chartData[idx];
                            if (!item) return '';
                            return `${item.label} (${fmtPercent(item.porcentaje, 0)})`;
                        }}
                        wrapperStyle={{ fontSize: 12, maxWidth: '50%' }}
                    />
                </PieChart>
            </ResponsiveContainer>
        </Box>
    );
};

export default DistribucionDonut;
