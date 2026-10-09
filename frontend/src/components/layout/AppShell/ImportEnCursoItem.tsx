import React from 'react';
import { Box, LinearProgress, Typography, Chip, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { EstadoCargaDto } from '../../../types/importProgreso';
import { barraIndeterminada, esperaAbreviada, etiquetaFase, formatearNumero } from '../../../utils/estadoCarga';

interface ImportEnCursoItemProps {
    carga: EstadoCargaDto;
}

const chipSx = { height: 18, fontSize: '0.65rem' } as const;

const ImportEnCursoItem: React.FC<ImportEnCursoItemProps> = ({ carga }) => {
    const theme = useTheme();
    const indeterminada = barraIndeterminada(carga);
    const fase = etiquetaFase(carga);
    const espera = carga.fase === 'PROCESANDO' ? esperaAbreviada(carga) : null;

    return (
        <Box
            sx={{
                px: 2,
                py: 1.5,
                borderBottom: `1px solid ${theme.palette.divider}`,
                '&:last-child': { borderBottom: 'none' },
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                    {carga.tipo} · Remesa {carga.numeroRemesa}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 1, flexShrink: 0, maxWidth: 110 }}>
                    {carga.usuarioNombre}
                </Typography>
            </Box>

            <LinearProgress
                variant={indeterminada ? 'indeterminate' : 'determinate'}
                value={indeterminada ? undefined : carga.progreso}
                sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
            />

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                    {fase.principal}
                    {!indeterminada ? ` · ${carga.progreso}%` : ''}
                    {espera ? ` · ${espera}` : ''}
                </Typography>
                <Chip label={`Procesadas: ${formatearNumero(carga.procesadas)}`} size="small" variant="outlined" sx={chipSx} />
                <Chip label={`OK: ${formatearNumero(carga.ok)}`} size="small" color="success" variant="outlined" sx={chipSx} />
                {carga.err > 0 && (
                    <Chip label={`Err: ${formatearNumero(carga.err)}`} size="small" color="error" variant="outlined" sx={chipSx} />
                )}
                {carga.totalEsperado > 0 && (
                    <Chip label={`Total: ${formatearNumero(carga.totalEsperado)}`} size="small" variant="outlined" sx={chipSx} />
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Typography
                    component={RouterLink}
                    to={`/historial-importaciones/${carga.remesaId}`}
                    variant="caption"
                    color="primary.main"
                    sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                >
                    Ver detalle
                </Typography>
            </Box>

            {fase.secundario && (
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 0.25, display: 'block', overflowWrap: 'anywhere' }}
                >
                    {fase.secundario}
                </Typography>
            )}
        </Box>
    );
};

export default ImportEnCursoItem;
