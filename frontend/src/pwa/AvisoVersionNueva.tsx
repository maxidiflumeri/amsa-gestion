import React from 'react';
import { Alert, Button, Snackbar } from '@mui/material';
import { usePwa } from './PwaContext';

/**
 * "Hay una versión nueva de Gestión": la publica el service worker cuando hay un deploy nuevo. Con "Actualizar" se
 * activa y la página se recarga; con "Más tarde" sigue la versión actual hasta la próxima vez que se abra.
 */
const AvisoVersionNueva: React.FC = () => {
    const { hayVersionNueva, actualizar, descartarVersionNueva } = usePwa();
    return (
        <Snackbar open={hayVersionNueva} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ bottom: { xs: 16, md: 24 } }}>
            <Alert
                severity="info"
                variant="filled"
                sx={{ alignItems: 'center', width: '100%' }}
                action={
                    <>
                        <Button color="inherit" size="small" onClick={descartarVersionNueva} sx={{ minHeight: 36 }}>
                            Más tarde
                        </Button>
                        <Button color="inherit" size="small" onClick={actualizar} sx={{ minHeight: 36, fontWeight: 700 }}>
                            Actualizar
                        </Button>
                    </>
                }
            >
                Hay una versión nueva de Gestión
            </Alert>
        </Snackbar>
    );
};

export default AvisoVersionNueva;
