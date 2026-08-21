import React from 'react';
import { Box } from '@mui/material';
import { Outlet } from 'react-router-dom';
import AyudaContextual from '../../pages/ayuda/AyudaContextual';

/**
 * Layout para cuando la app corre **embebida en la toolbar de Neotel**.
 *
 * Es el `AppShell` sin barra superior ni menú lateral: adentro del iframe esos dos elementos solo
 * comen el espacio que el operador necesita para gestionar, y la navegación la hace la toolbar.
 *
 * Se usa en las rutas `/telefonia/*`, que son las que Neotel abre (ver `docs/neotel-toolbar-spec.md`).
 * Entrar a esas rutas desde una pestaña normal funciona igual: el operador ve la ficha sin menú.
 *
 * El botón de ayuda va **flotando en la esquina**, no en una barra: acá el alto útil es poco y una
 * barra propia se comería justo el espacio que el operador necesita con alguien en línea.
 */
const EmbeddedShell: React.FC = () => (
    <Box
        sx={{
            position: 'relative',
            minHeight: '100vh',
            bgcolor: 'background.default',
            // Padding chico: el alto útil dentro de la toolbar es poco y no sobra ni un renglón.
            px: { xs: 1, sm: 1.5 },
            py: 1,
        }}
    >
        <Box
            sx={{
                position: 'absolute',
                top: 4,
                right: 8,
                zIndex: (t) => t.zIndex.appBar,
                color: 'text.secondary',
            }}
        >
            <AyudaContextual enPestanaNueva />
        </Box>
        <Outlet />
    </Box>
);

export default EmbeddedShell;
