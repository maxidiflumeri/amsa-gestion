import React from 'react';
import { Box, LinearProgress, Typography, Chip, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

interface ImportEnCursoItemProps {
    remesaId: number;
    tipo: string;
    progreso: number;
    okFilas: number;
    errFilas: number;
    totalFilas: number;
    usuarioNombre: string;
    estadoProceso: string;
}

const ImportEnCursoItem: React.FC<ImportEnCursoItemProps> = ({
    remesaId,
    tipo,
    progreso,
    okFilas,
    errFilas,
    totalFilas,
    usuarioNombre,
    estadoProceso,
}) => {
    const theme = useTheme();

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
                <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 180 }}>
                    {tipo}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 1 }}>
                    {usuarioNombre}
                </Typography>
            </Box>

            <LinearProgress
                variant="determinate"
                value={progreso}
                sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
            />

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                    {progreso}%
                </Typography>
                <Chip
                    label={`OK: ${okFilas}`}
                    size="small"
                    color="success"
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.65rem' }}
                />
                {errFilas > 0 && (
                    <Chip
                        label={`Err: ${errFilas}`}
                        size="small"
                        color="error"
                        variant="outlined"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                    />
                )}
                <Chip
                    label={`Total: ${totalFilas}`}
                    size="small"
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.65rem' }}
                />
                <Box sx={{ flexGrow: 1 }} />
                <Typography
                    component={RouterLink}
                    to={`/historial-importaciones/${remesaId}`}
                    variant="caption"
                    color="primary.main"
                    sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                >
                    Ver detalle
                </Typography>
            </Box>

            {estadoProceso !== 'PROCESANDO' && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
                    {estadoProceso}
                </Typography>
            )}
        </Box>
    );
};

export default ImportEnCursoItem;
