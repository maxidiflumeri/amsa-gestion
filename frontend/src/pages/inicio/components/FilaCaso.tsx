import React from 'react';
import { Avatar, Box, Chip, Stack, Typography } from '@mui/material';
import ButtonBase from '@mui/material/ButtonBase';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { linkCaso } from '../../../utils/linkCaso';
import { iniciales } from '../formato';

interface Props {
    deudorId: number;
    nombre: string;
    empresa: string;
    /** Primera línea gris: documento y de qué se trata. */
    meta: string;
    /** Segunda línea gris, opcional (el último texto de la gestión). */
    detalle?: string;
    /** El lado derecho: baja debajo del nombre en pantallas angostas. */
    derecha?: React.ReactNode;
}

const estiloFila = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' },
    gap: { xs: 0.75, sm: 1.5 },
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    px: 1,
    py: 1.25,
    borderRadius: 1.5,
} as const;

const ContenidoFila: React.FC<Props> = ({ nombre, empresa, meta, detalle, derecha }) => (
    <>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
            <Avatar sx={{ width: 32, height: 32, fontSize: 12, fontWeight: 700, bgcolor: 'action.selected', color: 'text.primary', flex: 'none' }}>
                {iniciales(nombre)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                        {nombre}
                    </Typography>
                    <Chip label={empresa} size="small" variant="outlined" sx={{ height: 20, fontSize: 11, flex: 'none', maxWidth: 120 }} />
                </Stack>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {meta}
                </Typography>
                {detalle && (
                    <Typography variant="caption" color="text.disabled" noWrap component="div">
                        {detalle}
                    </Typography>
                )}
            </Box>
        </Stack>
        {derecha && (
            <Stack
                direction={{ xs: 'row', sm: 'column' }}
                spacing={0.5}
                alignItems={{ xs: 'center', sm: 'flex-end' }}
                sx={{ pl: { xs: 6, sm: 0 }, flexWrap: 'wrap' }}
            >
                {derecha}
            </Stack>
        )}
    </>
);

/**
 * La fila común de "Retomá donde quedaste" y de la agenda: toda ella es un enlace al caso. Sin `deudores.ver` no enlaza,
 * porque Gestión no se le abre (la agenda puede verse solo con `promesas.ver`).
 */
const FilaCaso: React.FC<Props> = (props) => {
    const { tienePermiso } = useAuth();
    if (!tienePermiso('deudores.ver')) {
        return (
            <Box sx={estiloFila} data-testid="fila-caso-sin-enlace">
                <ContenidoFila {...props} />
            </Box>
        );
    }
    return (
        <ButtonBase component={RouterLink} to={linkCaso(props.deudorId)} sx={{ ...estiloFila, '&:hover': { bgcolor: 'action.hover' } }}>
            <ContenidoFila {...props} />
        </ButtonBase>
    );
};

export default FilaCaso;
