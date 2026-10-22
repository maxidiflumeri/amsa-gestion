import React, { useState } from 'react';
import {
    Box,
    Divider,
    IconButton,
    ListItemButton,
    Popover,
    Tooltip,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ChevronRight, LogOut, UserRound } from 'lucide-react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import AvatarUsuario from '../../ui/AvatarUsuario';
import SelectorTema from '../../ui/SelectorTema';

interface User {
    nombre: string;
    rol: string;
}

interface UserMenuProps {
    user: User;
}

const itemCuenta = {
    m: 0,
    width: '100%',
    // 44 px para el dedo en el celular y la tablet.
    height: { xs: 44, md: 40 },
    px: 1.25,
    gap: 1.5,
    borderRadius: '10px',
    fontSize: '0.875rem',
    fontWeight: 500,
} as const;

const tituloBloque = {
    px: 1.25,
    pt: 0.75,
    pb: 0.75,
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'text.secondary',
} as const;

/**
 * El menú de la cuenta: quién sos (foto de Google, nombre, email, rol), «Mi perfil», el tema y cerrar sesión.
 * Es un panel (`role="dialog"`) y no un `Menu`: adentro de un `role="menu"` el selector de tema no se alcanzaba con
 * el teclado, y acá se recorre todo con Tab.
 */
const UserMenu: React.FC<UserMenuProps> = ({ user }) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const { usuario, logout } = useAuth();
    const navigate = useNavigate();

    const open = Boolean(anchorEl);
    const cerrar = () => setAnchorEl(null);
    const nombre = usuario?.nombre ?? user.nombre;

    const handleLogout = () => {
        cerrar();
        logout();
        navigate('/login');
    };

    return (
        <>
            <Tooltip title="Tu cuenta">
                <IconButton
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                    aria-label="Tu cuenta"
                    aria-haspopup="dialog"
                    aria-expanded={open ? 'true' : undefined}
                    aria-controls={open ? 'menu-cuenta' : undefined}
                    sx={{ p: '3px', ml: 0.5 }}
                >
                    <AvatarUsuario
                        nombre={nombre}
                        avatarUrl={usuario?.avatarUrl}
                        size={34}
                        sx={(theme) => ({
                            transition: theme.transitions.create('box-shadow', { duration: theme.transitions.duration.shortest }),
                            boxShadow: open ? `0 0 0 2px ${theme.palette.background.marco}, 0 0 0 4px ${theme.palette.primary.main}` : 'none',
                        })}
                    />
                </IconButton>
            </Tooltip>

            <Popover
                id="menu-cuenta"
                open={open}
                anchorEl={anchorEl}
                onClose={cerrar}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                slotProps={{
                    paper: {
                        role: 'dialog',
                        'aria-label': 'Tu cuenta',
                        sx: (theme) => ({
                            mt: 1,
                            width: 'min(304px, calc(100vw - 24px))',
                            p: 1,
                            borderRadius: '16px',
                            border: 1,
                            borderColor: 'divider',
                            boxShadow: theme.palette.mode === 'dark'
                                ? `0 18px 44px -12px ${alpha(theme.palette.common.black, 0.75)}`
                                : `0 18px 44px -12px ${alpha(theme.palette.text.primary, 0.25)}, 0 2px 6px ${alpha(theme.palette.text.primary, 0.06)}`,
                        }),
                    },
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.25, pt: 1.25, pb: 1.5 }}>
                    <AvatarUsuario nombre={nombre} avatarUrl={usuario?.avatarUrl} size={44} />
                    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        <Typography variant="subtitle2" fontWeight={600} noWrap title={nombre}>
                            {nombre}
                        </Typography>
                        {usuario?.email && (
                            <Typography variant="caption" color="text.secondary" noWrap title={usuario.email} sx={{ fontSize: '0.78125rem' }}>
                                {usuario.email}
                            </Typography>
                        )}
                        <Box
                            component="span"
                            sx={(theme) => ({
                                alignSelf: 'flex-start',
                                mt: 0.5,
                                px: 1,
                                py: '2px',
                                borderRadius: 999,
                                fontSize: '0.6875rem',
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                                bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.11),
                                color: theme.palette.mode === 'dark' ? 'primary.light' : 'primary.dark',
                            })}
                        >
                            {user.rol}
                        </Box>
                    </Box>
                </Box>

                <Divider sx={{ mx: 0.5, mb: 0.5 }} />

                <ListItemButton component={RouterLink} to="/perfil" onClick={cerrar} sx={itemCuenta}>
                    <Box component="span" sx={{ display: 'flex', color: 'text.secondary' }}>
                        <UserRound size={18} strokeWidth={1.75} aria-hidden />
                    </Box>
                    <Box component="span" sx={{ flex: 1 }}>Mi perfil</Box>
                    <Box component="span" sx={{ display: 'flex', color: 'text.secondary' }}>
                        <ChevronRight size={16} aria-hidden />
                    </Box>
                </ListItemButton>

                <Divider sx={{ m: 0.5 }} />

                <Typography component="div" sx={tituloBloque}>
                    Apariencia
                </Typography>
                <Box sx={{ px: 0.75, pb: 0.75 }}>
                    <SelectorTema />
                </Box>

                <Divider sx={{ m: 0.5 }} />

                <ListItemButton
                    onClick={handleLogout}
                    sx={(theme) => ({
                        ...itemCuenta,
                        color: 'error.main',
                        '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.08) },
                    })}
                >
                    <LogOut size={18} strokeWidth={1.75} aria-hidden />
                    Cerrar sesión
                </ListItemButton>
            </Popover>
        </>
    );
};

export default UserMenu;
