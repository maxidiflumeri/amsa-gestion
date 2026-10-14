import React from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { StatusChip } from '../ui';
import type { ReversionResumenDto } from '../../types/reversionAccion';
import { etiquetaDeReversion, lineasDeReversionTerminada } from '../../utils/reversionAccion';

interface Props {
    reversion: ReversionResumenDto;
    /** `fila`: lo mínimo para la tabla del Historial. `detalle`: además, qué dejó la reversión. */
    variante?: 'fila' | 'detalle';
}

/** El estado de la reversión de una acción masiva: chip, barra mientras corre y el motivo si no terminó (docs/imports-progreso-c3-spec.md §17.6). */
export default function ReversionEstado({ reversion, variante = 'fila' }: Props) {
    const e = etiquetaDeReversion(reversion);
    const enCola = reversion.estado === 'EN_COLA';
    const revirtiendo = reversion.estado === 'REVIRTIENDO';
    const lineas = variante === 'detalle' && reversion.estado === 'TERMINADA' ? lineasDeReversionTerminada(reversion) : [];
    return (
        <Box sx={{ minWidth: 0 }} data-testid="reversion-estado">
            <StatusChip status={e.status} label={e.etiqueta} />
            {(enCola || revirtiendo) && (
                <LinearProgress
                    variant={revirtiendo ? 'determinate' : 'indeterminate'}
                    value={revirtiendo && Number.isFinite(reversion.porcentaje) ? Math.min(100, Math.max(0, reversion.porcentaje)) : 0}
                    sx={{ mt: 0.75, height: 4, borderRadius: 2, maxWidth: variante === 'detalle' ? 320 : 160 }}
                />
            )}
            {e.detalle !== null && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {e.detalle}
                </Typography>
            )}
            {lineas.map((l) => (
                <Typography key={l.texto} variant="body2" color={l.aviso ? 'warning.main' : 'text.secondary'} sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {l.texto}
                </Typography>
            ))}
        </Box>
    );
}
