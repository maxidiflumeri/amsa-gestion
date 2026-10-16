import React from 'react';
import { Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';

export type FormaEsqueleto = 'lista' | 'grafico' | 'tile';

interface Props {
    estado: 'cargando' | 'error' | 'vacio';
    /** Qué forma tiene el esqueleto mientras carga. */
    forma?: FormaEsqueleto;
    filas?: number;
    onReintentar?: () => void;
    /** El texto del estado vacío. */
    vacio?: string;
    /** Un botón opcional debajo del texto del estado vacío. */
    accionVacio?: { etiqueta: string; onClick: () => void };
}

/** Los tres estados de un bloque que no tiene datos para mostrar: cargando, error (distinto del vacío) y vacío. */
const BloqueEstado: React.FC<Props> = ({ estado, forma = 'lista', filas = 4, onReintentar, vacio, accionVacio }) => {
    if (estado === 'cargando') {
        if (forma === 'grafico') return <Skeleton variant="rounded" height={160} role="progressbar" aria-label="Cargando" />;
        if (forma === 'tile') {
            return (
                <Stack spacing={0.5} role="progressbar" aria-label="Cargando">
                    <Skeleton variant="text" width="45%" height={44} />
                    <Skeleton variant="text" width="80%" />
                </Stack>
            );
        }
        return (
            <Stack spacing={1.5} role="progressbar" aria-label="Cargando">
                {Array.from({ length: filas }, (_, i) => (
                    <Stack key={i} direction="row" spacing={1.5} alignItems="center">
                        <Skeleton variant="circular" width={32} height={32} sx={{ flex: 'none' }} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Skeleton variant="text" width="55%" />
                            <Skeleton variant="text" width="35%" />
                        </Box>
                    </Stack>
                ))}
            </Stack>
        );
    }

    if (estado === 'error') {
        return (
            <Stack spacing={1} alignItems="flex-start" role="alert" sx={{ py: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'error.main' }}>
                    <ErrorOutlineIcon fontSize="small" />
                    <Typography variant="body2" color="text.primary">No se pudo cargar este bloque.</Typography>
                </Stack>
                {onReintentar && (
                    <Button size="small" onClick={onReintentar}>
                        Reintentar
                    </Button>
                )}
            </Stack>
        );
    }

    return (
        <Stack spacing={1.5} alignItems="center" sx={{ py: 3, px: 2, textAlign: 'center' }}>
            <Box sx={{ color: 'text.disabled', display: 'flex' }}>
                <InboxOutlinedIcon />
            </Box>
            <Typography variant="body2" color="text.secondary">
                {vacio}
            </Typography>
            {accionVacio && (
                <Button size="small" variant="outlined" onClick={accionVacio.onClick}>
                    {accionVacio.etiqueta}
                </Button>
            )}
        </Stack>
    );
};

export default BloqueEstado;
