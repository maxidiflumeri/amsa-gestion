import React from 'react';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { Variacion } from '../formato';
import BloqueEstado from './BloqueEstado';
import Sparkline from './Sparkline';

/** La variación como chip: verde con ▲, rojo con ▼, gris con "=". Sin base o con base 0 no hay chip (lo dice la leyenda). */
export const DeltaChip: React.FC<{ variacion: Variacion }> = ({ variacion }) => {
    const theme = useTheme();
    if (variacion.tipo === 'sin-base' || variacion.tipo === 'base-cero') return null;
    const tono =
        variacion.tipo === 'sube' ? theme.palette.success.main : variacion.tipo === 'baja' ? theme.palette.error.main : theme.palette.text.secondary;
    const texto = variacion.tipo === 'sube' ? `▲ ${variacion.porcentaje} %` : variacion.tipo === 'baja' ? `▼ ${variacion.porcentaje} %` : '=';
    return (
        <Chip
            size="small"
            label={texto}
            sx={{ height: 22, fontWeight: 700, color: tono, bgcolor: alpha(tono, 0.14), flexShrink: 0, '& .MuiChip-label': { px: 1 } }}
        />
    );
};

interface Props {
    titulo: string;
    estado: 'ok' | 'cargando' | 'error';
    onReintentar?: () => void;
    valor?: string;
    unidad?: string;
    delta?: Variacion;
    /** El renglón gris de abajo. */
    leyenda?: string;
    serie?: number[];
    /** Un elemento extra al pie (el botón "Ver" de "Vencen hoy"). */
    accion?: React.ReactNode;
    /** Un texto corto a la derecha del pie (el importe de "Vencen hoy"). */
    pie?: string;
}

/** Un indicador de "Tu día": valor, variación, leyenda y, si hay, una línea de 7 días. */
const KpiTile: React.FC<Props> = ({ titulo, estado, onReintentar, valor, unidad, delta, leyenda, serie, accion, pie }) => (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary" fontWeight={500} sx={{ mb: 0.5 }}>
            {titulo}
        </Typography>
        {estado !== 'ok' ? (
            <BloqueEstado estado={estado === 'cargando' ? 'cargando' : 'error'} forma="tile" onReintentar={onReintentar} />
        ) : (
            <>
                <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ minWidth: 0 }}>
                    <Typography component="div" fontWeight={700} sx={{ fontSize: 28, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
                        {valor}
                    </Typography>
                    {unidad && (
                        <Typography variant="body2" color="text.secondary" noWrap>
                            {unidad}
                        </Typography>
                    )}
                </Stack>
                <Stack direction="row" alignItems="center" justifyContent="space-between" useFlexGap flexWrap="wrap" sx={{ minHeight: 30, mt: 0.5, gap: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, flexShrink: 0 }}>
                        {delta && <DeltaChip variacion={delta} />}
                        {pie && (
                            <Typography variant="body2" fontWeight={600} noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {pie}
                            </Typography>
                        )}
                        {accion}
                    </Stack>
                    {serie && <Sparkline valores={serie} />}
                </Stack>
                {leyenda && (
                    <Box sx={{ mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                            {leyenda}
                        </Typography>
                    </Box>
                )}
            </>
        )}
    </Paper>
);

export default KpiTile;
