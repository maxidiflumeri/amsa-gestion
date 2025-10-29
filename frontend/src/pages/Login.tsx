// src/pages/Login.tsx
import React from 'react'
import { Box, Button, Container, TextField, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'

const Login = () => {
    const navigate = useNavigate()

    const handleLogin = () => {
        // en un sistema real, validar token, guardar en contexto, etc.
        navigate('/gestion')
    }

    return (
        <Container maxWidth="xs">
            <Box display="flex" flexDirection="column" alignItems="center" mt={8}>
                <Typography variant="h5" gutterBottom>
                    Iniciar sesión
                </Typography>
                <TextField fullWidth label="Usuario" margin="normal" />
                <TextField fullWidth label="Contraseña" type="password" margin="normal" />
                <Button variant="contained" color="primary" fullWidth onClick={handleLogin} sx={{ mt: 2 }}>
                    Entrar
                </Button>
            </Box>
        </Container>
    )
}

export default Login