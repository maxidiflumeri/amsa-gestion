import React, { useState } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import HeadsetMicIcon from '@mui/icons-material/HeadsetMic'
import SearchIcon from '@mui/icons-material/Search'
import { useNavigate } from 'react-router-dom'
import BuscadorAvanzadoModal from '../../components/deudores/BuscadorAvanzadoModal'
import { useAuth } from '../../context/AuthContext'

/**
 * Pantalla que la toolbar de Neotel muestra cuando el agente está conectado pero **sin llamada**
 * (el parámetro HOME de la campaña).
 *
 * Cumple dos funciones: confirmarle al operador que su sesión de AMSA Gestión está activa —que es
 * la duda razonable cuando la app corre adentro de otra pantalla— y dejarle buscar un caso a mano
 * para las llamadas salientes que no dispara el predictivo.
 */
const TelefoniaHome: React.FC = () => {
    const { usuario } = useAuth()
    const navigate = useNavigate()
    const [buscadorAbierto, setBuscadorAbierto] = useState(false)

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
            <Paper
                variant="outlined"
                sx={{ p: { xs: 3, sm: 4 }, maxWidth: 460, width: '100%', textAlign: 'center' }}
            >
                <Stack spacing={2} alignItems="center">
                    <HeadsetMicIcon sx={{ fontSize: 52, color: 'primary.main' }} />

                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                            Listo para atender
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Cuando entre una llamada, la ficha del caso se abre sola acá.
                        </Typography>
                    </Box>

                    <Typography variant="body2" color="text.secondary">
                        Sesión iniciada como <strong>{usuario?.nombre ?? '—'}</strong>
                    </Typography>

                    <Button
                        variant="outlined"
                        startIcon={<SearchIcon />}
                        onClick={() => setBuscadorAbierto(true)}
                    >
                        Buscar un caso
                    </Button>
                </Stack>
            </Paper>

            <BuscadorAvanzadoModal
                open={buscadorAbierto}
                onClose={() => setBuscadorAbierto(false)}
                onSelectDeudor={(id) => {
                    setBuscadorAbierto(false)
                    // `deudor` y no `id`: `id` es alias de la CLAVE de Neotel, así que el caso quedaba
                    // marcado como dudoso y le salía el cartel de "confirmá que es el correcto" a un
                    // caso que el operador acababa de elegir a mano.
                    navigate(`/telefonia/caso?deudor=${id}`)
                }}
            />
        </Box>
    )
}

export default TelefoniaHome
