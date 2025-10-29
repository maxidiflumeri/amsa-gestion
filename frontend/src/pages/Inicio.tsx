// src/pages/Inicio.tsx
import React from 'react'
import { Typography, Box } from '@mui/material'

const Inicio = () => {
    return (
        <Box textAlign="center" mt={10}>
            <Typography variant="h4" gutterBottom>
                Bienvenido a AMSA Cobranzas
            </Typography>
            <Typography variant="body1">
                Seleccioná una opción del menú lateral para comenzar.
            </Typography>
        </Box>
    )
}

export default Inicio