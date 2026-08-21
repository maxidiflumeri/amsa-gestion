import React from 'react';
import { Box, Stack, Typography, useTheme } from '@mui/material';
import type { SnapshotFunnel } from '../../../types/dashboards';
import { fmtNumber, fmtPercent } from '../utils';

interface Props {
    data: SnapshotFunnel;
}

const FunnelGestion: React.FC<Props> = ({ data }) => {
    const theme = useTheme();
    const etapas = [
        { label: 'Asignados', value: data.asignados, color: theme.palette.primary.main },
        { label: 'Contactados', value: data.contactados, color: theme.palette.info.main },
        { label: 'Con promesa', value: data.conPromesa, color: theme.palette.warning.main },
        { label: 'Promesa cumplida', value: data.promesaCumplida, color: theme.palette.success.main },
    ];

    const base = Math.max(data.asignados, 1);

    return (
        <Stack spacing={1}>
            {etapas.map((e, i) => {
                const pct = (e.value / base) * 100;
                const widthPct = Math.max(pct, 4);
                return (
                    <Box key={i}>
                        <Stack direction="row" justifyContent="space-between" mb={0.5}>
                            <Typography variant="body2" color="text.secondary">{e.label}</Typography>
                            <Typography variant="body2" fontWeight={600}>
                                {fmtNumber(e.value)} <Typography component="span" variant="caption" color="text.secondary">({fmtPercent(pct)})</Typography>
                            </Typography>
                        </Stack>
                        <Box
                            sx={{
                                height: 28,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                overflow: 'hidden',
                                position: 'relative',
                            }}
                        >
                            <Box
                                sx={{
                                    width: `${widthPct}%`,
                                    height: '100%',
                                    bgcolor: e.color,
                                    transition: 'width 0.4s ease',
                                }}
                            />
                        </Box>
                    </Box>
                );
            })}
        </Stack>
    );
};

export default FunnelGestion;
