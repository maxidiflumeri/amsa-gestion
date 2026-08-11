import React, { useCallback, useEffect, useState } from 'react'
import { Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

/**
 * Pantalla que se muestra cuando la app corre **embebida en la Toolbar de Neotel** y el operador no
 * tiene sesión abierta en AMSA Gestión.
 *
 * ### Por qué no se muestra el login normal acá adentro
 *
 * El login es con Google Identity Services, y **GIS no funciona de forma confiable dentro de un
 * iframe de otro dominio**: Google renderiza su botón en un iframe propio y el flujo actual (FedCM)
 * exige que el contenedor declare `allow="identity-credentials-get"` — un atributo que pone Neotel
 * al armar el iframe, no nosotros. Lo más probable es que el operador vea el botón, lo apriete y no
 * pase nada, sin ningún error que explique por qué.
 *
 * Por eso el login se hace en una **pestaña aparte**, que es un contexto de primer nivel donde
 * Google funciona siempre. Al volver, el iframe ya tiene la sesión.
 *
 * ### Cómo se entera el iframe de que el operador se logueó
 *
 * La pestaña nueva y el iframe son el mismo origen, así que comparten `localStorage`. Cuando el
 * login guarda el token, el navegador dispara un evento `storage` en los demás contextos: acá se
 * escucha y se recarga solo. El operador no tiene que volver a tocar nada.
 *
 * El botón "Ya inicié sesión" queda igual como salida manual, por si el evento no llega (algunos
 * navegadores lo suprimen en contextos particionados).
 */

const RUTA_LOGIN = '/login'

const SesionRequeridaEmbebido: React.FC = () => {
    const [esperando, setEsperando] = useState(false)

    const recargar = useCallback(() => {
        window.location.reload()
    }, [])

    useEffect(() => {
        const alCambiarStorage = (e: StorageEvent) => {
            // Solo importa la aparición del token; el resto de las claves no cambia nada acá.
            if (e.key === 'amsa_token' && e.newValue) recargar()
        }
        window.addEventListener('storage', alCambiarStorage)
        return () => window.removeEventListener('storage', alCambiarStorage)
    }, [recargar])

    const abrirLogin = () => {
        setEsperando(true)
        // `noopener` deja la pestaña independiente; la sesión igual viaja por localStorage.
        window.open(RUTA_LOGIN, '_blank', 'noopener')
    }

    return (
        <Box
            sx={{
                minHeight: '70vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 2,
            }}
        >
            <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, maxWidth: 440, width: '100%' }}>
                <Stack spacing={2.5} alignItems="center" textAlign="center">
                    <LockOpenIcon sx={{ fontSize: 48, color: 'primary.main' }} />

                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            Iniciá sesión en AMSA Gestión
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                            Se abre en una pestaña nueva. Cuando entres con tu cuenta de Google, volvé
                            acá: la ficha del caso aparece sola.
                        </Typography>
                    </Box>

                    <Button
                        variant="contained"
                        startIcon={<OpenInNewIcon />}
                        onClick={abrirLogin}
                        size="large"
                    >
                        Iniciar sesión
                    </Button>

                    {esperando && (
                        <Stack direction="row" spacing={1} alignItems="center">
                            <CircularProgress size={16} />
                            <Typography variant="body2" color="text.secondary">
                                Esperando que inicies sesión…
                            </Typography>
                        </Stack>
                    )}

                    <Button size="small" onClick={recargar}>
                        Ya inicié sesión
                    </Button>

                    <Typography variant="caption" color="text.disabled">
                        Una vez que entres, no hace falta repetirlo: la sesión queda abierta para toda
                        la jornada.
                    </Typography>
                </Stack>
            </Paper>
        </Box>
    )
}

export default SesionRequeridaEmbebido
