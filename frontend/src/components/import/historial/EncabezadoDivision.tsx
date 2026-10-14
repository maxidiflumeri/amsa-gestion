import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import type { GrupoHistorialDto } from '../../../types/importHistorial';
import { textoEncabezadoDivision, textoRetomarDivision } from '../../../utils/historialImportaciones';

interface Props {
    grupo: GrupoHistorialDto;
    /** Cuántas remesas de este tramo están en la página. */
    enPagina: number;
    /** El usuario puede retomar la división (permiso y dueño). */
    puedeRetomar: boolean;
    retomando: boolean;
    onRetomar: () => void;
}

/** Encabezado de una carga dividida: ocupa todo el ancho antes de su primera remesa (§6.3). Los números son de todo el grupo. */
export default function EncabezadoDivision({ grupo, enPagina, puedeRetomar, retomando, onRetomar }: Props) {
    const t = textoEncabezadoDivision(grupo, enPagina);
    return (
        <Box
            data-testid="encabezado-division"
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', py: 0.5, px: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}
        >
            <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={700} component="span">{t.titulo}</Typography>
                {t.resumen !== '' && (
                    <Typography variant="body2" component="span" color="text.secondary"> — {t.resumen}</Typography>
                )}
                {t.nota !== null && (
                    <Typography variant="caption" color="text.secondary" display="block"><em>{t.nota}</em></Typography>
                )}
                {t.eliminadas !== null && (
                    <Typography variant="caption" color="text.secondary" display="block"><em>{t.eliminadas}</em></Typography>
                )}
            </Box>
            {puedeRetomar && grupo.retomables >= 2 && (
                <Button size="small" variant="outlined" color="warning" startIcon={<ReplayIcon />} disabled={retomando} onClick={onRetomar}>
                    {textoRetomarDivision(grupo.retomables)}
                </Button>
            )}
        </Box>
    );
}
