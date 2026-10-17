import React from 'react';
import { alpha, Box, Button, Stack, Typography } from '@mui/material';
import { useLocation } from 'react-router-dom';
import type { AccionIrA } from '../../types/asistente';

interface Props {
    accion: AccionIrA;
    /** false cuando el panel tapa la pantalla (celular o pantalla mediana): al llevarte, el panel se cierra. */
    panelQuedaAbierto: boolean;
    onAceptar: () => void;
    onRechazar: () => void;
}

/**
 * «¿Querés que te lleve a …?» Es la única forma en que el asistente mueve a alguien de pantalla, y siempre pregunta:
 * no navega solo (docs/asistente-spec.md §12.2).
 */
const TarjetaIrA: React.FC<Props> = ({ accion, panelQuedaAbierto, onAceptar, onRechazar }) => {
    const { pathname } = useLocation();
    const etiqueta = `«${accion.etiqueta}»`;
    const yaEstas = accion.resultado === null && pathname === accion.ruta;

    let contenido: React.ReactNode;
    if (accion.resultado === 'aceptada') {
        contenido = <Typography variant="body2">Te llevé a {etiqueta}.</Typography>;
    } else if (accion.resultado === 'rechazada') {
        contenido = <Typography variant="body2" color="text.secondary">Listo.</Typography>;
    } else if (yaEstas) {
        contenido = <Typography variant="body2">Ya estás en {etiqueta}.</Typography>;
    } else {
        contenido = (
            <>
                <Box>
                    <Typography variant="body2" fontWeight={600}>¿Querés que te lleve a {etiqueta}?</Typography>
                    <Typography variant="caption" color="text.secondary">
                        {panelQuedaAbierto ? 'Se abre en esta pestaña; el asistente queda abierto.' : 'Se abre en esta pestaña.'}
                    </Typography>
                </Box>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button size="small" variant="contained" color="secondary" onClick={onAceptar}>Sí, llevarme</Button>
                    <Button size="small" variant="outlined" color="inherit" onClick={onRechazar}>No, gracias</Button>
                </Stack>
            </>
        );
    }

    return (
        <Stack
            spacing={1.25}
            data-testid="tarjeta-ir-a"
            sx={{
                mt: 1.5,
                p: 1.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'secondary.main',
                bgcolor: (t) => alpha(t.palette.secondary.main, 0.08),
                minWidth: 0,
            }}
        >
            {contenido}
        </Stack>
    );
};

export default TarjetaIrA;
