import React from 'react';
import { Box, Typography, type SxProps, type Theme } from '@mui/material';
import { SectionCard } from '../ui';
import type { EstadoCargaDto } from '../../types/importProgreso';
import { lineasDeResumen } from '../../utils/resumenCategoria';

interface Props {
    carga: EstadoCargaDto;
    /** Con varias remesas en el Resultado, el título dice de cuál es. */
    titulo?: string;
    sx?: SxProps<Theme>;
}

/**
 * "Qué hizo la carga": lo que informó el processor al cerrar (docs/imports-progreso-c3-spec.md §6.1). No se monta si la carga
 * no terminó, no trae `resumenCategoria` (en curso, anterior a C3a, interrumpida, o un backend anterior) o no tiene nada que decir.
 */
export default function ResumenDeCarga({ carga, titulo = 'Qué hizo la carga', sx }: Props) {
    if (carga.terminal !== true) return null;
    const lineas = lineasDeResumen(carga.resumenCategoria, carga);
    if (lineas.length === 0) return null;
    return (
        <SectionCard title={titulo} sx={[{ width: '100%', textAlign: 'left' }, ...(Array.isArray(sx) ? sx : [sx])]} data-testid="resumen-de-carga">
            <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {lineas.map((l, i) => (
                    <Typography
                        key={i}
                        component="li"
                        variant="body2"
                        sx={{ overflowWrap: 'anywhere', color: l.tono === 'aviso' ? 'warning.main' : 'text.primary', fontWeight: l.tono === 'aviso' ? 600 : 400 }}
                        data-tono={l.tono}
                    >
                        {l.texto}
                    </Typography>
                ))}
            </Box>
        </SectionCard>
    );
}
