import React from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { Paso } from '../../types/asistente';

interface Props {
    pasos: Paso[];
    /** El turno sigue en curso: al final de la lista va una fila con spinner con lo que está haciendo ahora. */
    corriendo?: boolean;
    actividad?: string | null;
}

const ICONO: Record<Paso['estado'], { icono: React.ElementType; color: 'success' | 'warning' | 'error'; nombre: string }> = {
    ok: { icono: CheckCircleIcon, color: 'success', nombre: 'Listo' },
    aviso: { icono: WarningAmberIcon, color: 'warning', nombre: 'Con aviso' },
    error: { icono: ErrorOutlineIcon, color: 'error', nombre: 'Con error' },
};

/**
 * Lo que hizo el asistente antes de mostrar la propuesta (docs/asistente-reportes-spec.md §6.2, §16.2). Los textos los arma
 * el backend, nunca el modelo, y no llevan valores. El estado va con un icono y también como texto para el lector de pantalla.
 */
const PasosTurno: React.FC<Props> = ({ pasos, corriendo = false, actividad }) => {
    if (pasos.length === 0 && !corriendo) return null;
    return (
        <Stack component="ul" spacing={0.75} data-testid="pasos-turno" sx={{ listStyle: 'none', m: 0, mb: 1, p: 0, minWidth: 0 }}>
            {pasos.map((p, i) => {
                const { icono: Icono, color, nombre } = ICONO[p.estado];
                return (
                    <Stack component="li" key={`${i}-${p.texto}`} direction="row" spacing={1} alignItems="flex-start" data-estado={p.estado} sx={{ minWidth: 0 }}>
                        <Icono color={color} sx={{ fontSize: 18, mt: '2px', flex: 'none' }} />
                        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                            <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{nombre}: </Box>
                            {p.texto}
                        </Typography>
                    </Stack>
                );
            })}
            {corriendo && (
                <Stack component="li" direction="row" spacing={1} alignItems="center" role="status" sx={{ minWidth: 0 }}>
                    <CircularProgress size={16} thickness={5} aria-hidden sx={{ flex: 'none', mx: '1px' }} />
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{actividad ?? 'Pensando…'}</Typography>
                </Stack>
            )}
        </Stack>
    );
};

export default PasosTurno;
