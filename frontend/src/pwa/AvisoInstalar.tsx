import React from 'react';
import { Box, Button, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Smartphone } from 'lucide-react';
import { usePwa } from './PwaContext';

/**
 * "Instalá Gestión en este celular", en el Inicio y solo debajo de `md`, igual que en AMSA Sender. En Android (Chrome)
 * abre la instalación; en el iPhone, que no tiene ese evento, explica cómo agregarla desde Compartir. No aparece si ya
 * está instalada (o abierta como app) ni durante 14 días después de "Ahora no".
 */
const AvisoInstalar: React.FC = () => {
    const theme = useTheme();
    const celular = useMediaQuery(theme.breakpoints.down('md'));
    const { puedeInstalar, instalar, descartarInstalar, esIos, esStandalone, instalarDescartado } = usePwa();
    const iosSinInstalar = esIos && !esStandalone && !instalarDescartado;
    if (!celular || (!puedeInstalar && !iosSinInstalar)) return null;

    return (
        <Paper
            component="section"
            aria-label="Instalar Gestión"
            variant="outlined"
            data-testid="aviso-instalar"
            sx={{ borderRadius: '14px', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, borderColor: 'primary.main' }}
        >
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <Box sx={{ color: 'primary.main', mt: 0.25, flex: 'none' }}>
                    <Smartphone size={22} strokeWidth={1.75} aria-hidden />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                    <Typography component="h2" sx={{ fontSize: 15, fontWeight: 650 }}>
                        Instalá Gestión en este celular
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {puedeInstalar
                            ? 'Se abre como una app, desde su ícono y sin la barra del navegador.'
                            : 'En el iPhone: tocá Compartir y después «Agregar a inicio». Se abre como una app, desde su ícono.'}
                    </Typography>
                </Box>
            </Box>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', '& .MuiButton-root': { minHeight: 44 } }}>
                <Button color="inherit" onClick={descartarInstalar}>
                    Ahora no
                </Button>
                {puedeInstalar && (
                    <Button variant="contained" onClick={() => void instalar()}>
                        Instalar
                    </Button>
                )}
            </Stack>
        </Paper>
    );
};

export default AvisoInstalar;
