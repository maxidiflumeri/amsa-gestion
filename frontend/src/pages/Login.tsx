import React, { useState } from 'react';
import {
    Box,
    CircularProgress,
    Container,
    Divider,
    Stack,
    Typography,
    useTheme,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import { SectionCard } from '../components/ui';
import { useNotify } from '../hooks/useNotify';
import { useAuth } from '../context/AuthContext';
import logoAmsa from '../assets/logo-amsa-gestion.png';

const Login: React.FC = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const notify = useNotify();
    const { login } = useAuth();
    const [loading, setLoading] = useState(false);
    const isDark = theme.palette.mode === 'dark';

    const handleLoginSuccess = async (credentialResponse: CredentialResponse) => {
        const idToken = credentialResponse.credential;
        if (!idToken) {
            notify.error('No se recibió el token de Google');
            return;
        }
        setLoading(true);
        try {
            await login(idToken);
            navigate('/');
        } catch (err: any) {
            const mensaje =
                err?.response?.data?.message ||
                err?.message ||
                'Error al iniciar sesión con Google';
            notify.error(mensaje);
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
                    <Stack spacing={3} alignItems="center" sx={{ p: 1 }}>
                        <Box
                            component="img"
                            src={logoAmsa}
                            alt="AMSA Gestión"
                            sx={{
                                height: 56,
                                objectFit: 'contain',
                                mt: 1,
                            }}
                        />

                        <Box sx={{ width: '100%', textAlign: 'center' }}>
                            <Typography variant="h5" fontWeight={700} gutterBottom>
                                Iniciar sesión
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Usá tu cuenta de Google corporativa para acceder
                            </Typography>
                        </Box>

                        <Divider sx={{ width: '100%' }} />

                        <Box sx={{ display: 'flex', justifyContent: 'center', minHeight: 44 }}>
                            {loading ? (
                                <CircularProgress size={36} />
                            ) : (
                                <GoogleLogin
                                    onSuccess={handleLoginSuccess}
                                    onError={() => notify.error('Error en el login con Google')}
                                    theme={isDark ? 'filled_black' : 'outline'}
                                    size="large"
                                    shape="pill"
                                    text="signin_with"
                                    locale="es"
                                />
                            )}
                        </Box>

                        <Typography variant="caption" color="text.disabled" textAlign="center">
                            Solo usuarios autorizados por el administrador pueden acceder.
                        </Typography>
                    </Stack>
                </SectionCard>
            </Container>
        </Box>
    );
};

export default Login;
