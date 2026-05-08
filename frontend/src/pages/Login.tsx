// src/pages/Login.tsx
import React, { useState } from 'react';
import {
    Box,
    Button,
    Container,
    Stack,
    TextField,
    Typography,
    useTheme,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { SectionCard } from '../components/ui';
import { useNotify } from '../hooks/useNotify';
import logoAmsa from '../assets/logo-amsa-gestion.png';

const Login: React.FC = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const notify = useNotify();

    const [usuario, setUsuario] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!usuario.trim() || !password.trim()) {
            notify.warning('Completá usuario y contraseña.');
            return;
        }

        setLoading(true);
        try {
            // TODO: llamar API real de autenticación
            // const response = await authApi.login({ usuario, password });
            // guardar token en contexto/store
            navigate('/');
        } catch (err) {
            notify.error(err as Error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'background.default',
                px: 2,
            }}
        >
            <Container maxWidth="xs" disableGutters>
                <SectionCard>
                    <Box
                        component="form"
                        onSubmit={handleSubmit}
                        noValidate
                    >
                        <Stack spacing={3} alignItems="center">
                            {/* Logo */}
                            <Box
                                component="img"
                                src={logoAmsa}
                                alt="AMSA Gestión"
                                sx={{
                                    height: 56,
                                    objectFit: 'contain',
                                    mt: 1,
                                    // Invertir el logo en dark mode si es necesario
                                    filter:
                                        theme.palette.mode === 'dark'
                                            ? 'brightness(0) invert(1)'
                                            : 'none',
                                }}
                            />

                            <Box sx={{ width: '100%', textAlign: 'center' }}>
                                <Typography variant="h5" fontWeight={700} gutterBottom>
                                    Iniciar sesión
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Ingresá tus credenciales para continuar
                                </Typography>
                            </Box>

                            <Stack spacing={2} sx={{ width: '100%' }}>
                                <TextField
                                    label="Usuario"
                                    value={usuario}
                                    onChange={(e) => setUsuario(e.target.value)}
                                    fullWidth
                                    required
                                    autoComplete="username"
                                    autoFocus
                                    disabled={loading}
                                    inputProps={{ maxLength: 100 }}
                                />
                                <TextField
                                    label="Contraseña"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    fullWidth
                                    required
                                    autoComplete="current-password"
                                    disabled={loading}
                                    inputProps={{ maxLength: 100 }}
                                />
                            </Stack>

                            <Button
                                type="submit"
                                variant="contained"
                                color="primary"
                                fullWidth
                                size="large"
                                disabled={loading || !usuario.trim() || !password.trim()}
                            >
                                {loading ? 'Ingresando…' : 'Entrar'}
                            </Button>
                        </Stack>
                    </Box>
                </SectionCard>
            </Container>
        </Box>
    );
};

export default Login;
