import React, { useState } from 'react';
import {
    Avatar,
    Box,
    Divider,
    IconButton,
    ListItemIcon,
    Menu,
    MenuItem,
    Tooltip,
    Typography,
} from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import { useColorMode } from '../../../context/ColorModeContext';
import { useAuth } from '../../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

interface User {
    nombre: string;
    rol: string;
}

interface UserMenuProps {
    user: User;
}

function getInitials(nombre: string): string {
    return nombre
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase();
}

const UserMenu: React.FC<UserMenuProps> = ({ user }) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const { mode, toggleColorMode } = useColorMode();
    const { logout } = useAuth();
    const navigate = useNavigate();

    const open = Boolean(anchorEl);
    const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };
    const handleClose = () => setAnchorEl(null);

    const handleLogout = () => {
        handleClose();
        logout();
        navigate('/login');
    };

    return (
        <>
            <Tooltip title="Cuenta">
                <IconButton
                    onClick={handleOpen}
                    size="small"
                    aria-controls={open ? 'user-menu' : undefined}
                    aria-haspopup="true"
                    aria-expanded={open ? 'true' : undefined}
                >
                    <Avatar
                        sx={{
                            width: 34,
                            height: 34,
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                        }}
                    >
                        {getInitials(user.nombre)}
                    </Avatar>
                </IconButton>
            </Tooltip>

            <Menu
                id="user-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                PaperProps={{ sx: { minWidth: 200, mt: 1 } }}
            >
                <Box sx={{ px: 2, py: 1.5 }}>
                    <Typography variant="subtitle2" fontWeight={600} noWrap>
                        {user.nombre}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                        {user.rol}
                    </Typography>
                </Box>

                <Divider />

                <MenuItem onClick={handleClose}>
                    <ListItemIcon>
                        <PersonIcon fontSize="small" />
                    </ListItemIcon>
                    Mi perfil
                </MenuItem>

                <MenuItem
                    onClick={() => {
                        toggleColorMode();
                        handleClose();
                    }}
                >
                    <ListItemIcon>
                        {mode === 'dark' ? (
                            <LightModeIcon fontSize="small" />
                        ) : (
                            <DarkModeIcon fontSize="small" />
                        )}
                    </ListItemIcon>
                    {mode === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                </MenuItem>

                <Divider />

                <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
                    <ListItemIcon>
                        <LogoutIcon fontSize="small" sx={{ color: 'error.main' }} />
                    </ListItemIcon>
                    Cerrar sesión
                </MenuItem>
            </Menu>
        </>
    );
};

export default UserMenu;
