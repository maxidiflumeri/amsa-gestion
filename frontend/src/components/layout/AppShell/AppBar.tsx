import React from 'react';
import {
    AppBar as MuiAppBar,
    Box,
    IconButton,
    Toolbar,
    Tooltip,
    useTheme,
} from '@mui/material';
import { Menu, PanelLeft } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import UserMenu from './UserMenu';
import NotificacionesBell from './NotificacionesBell';
import ConexionIndicador from './ConexionIndicador';
import BuscadorGlobal from './BuscadorGlobal';
import LogoAmsa from './LogoAmsa';
import AyudaContextual from '../../../pages/ayuda/AyudaContextual';
import AsistenteBoton from '../../asistente/AsistenteBoton';

interface AppBarProps {
    onMenuClick: () => void;
    isDesktop: boolean;
    collapsed: boolean;
    user: { nombre: string; rol: string };
}

/**
 * La barra de arriba. Comparte el fondo con el menú lateral (`background.marco`): las dos forman el marco y la
 * pantalla va en el panel redondeado de `AppShell`. Las migas de pan ya no van acá: van arriba del contenido.
 */
const AppBarComponent: React.FC<AppBarProps> = ({
    onMenuClick,
    isDesktop,
    collapsed,
    user,
}) => {
    const theme = useTheme();

    const tooltipTitle = isDesktop
        ? collapsed
            ? 'Expandir menú'
            : 'Colapsar menú'
        : 'Abrir menú';

    return (
        <MuiAppBar
            position="fixed"
            color="inherit"
            elevation={0}
            sx={{
                zIndex: theme.zIndex.drawer + 2,
                width: '100%',
                bgcolor: 'background.marco',
            }}
        >
            <Toolbar sx={{ gap: { xs: 0.5, sm: 1 }, pl: { xs: 1, sm: 1.5 }, pr: { xs: 1, sm: 2 } }}>
                {/* Colapsar / expandir el menú en la computadora; abrirlo en el celular */}
                <Tooltip title={tooltipTitle}>
                    <IconButton
                        aria-label={tooltipTitle}
                        onClick={onMenuClick}
                        sx={{ color: 'text.secondary', flex: 'none', width: 40, height: 40 }}
                    >
                        {isDesktop ? <PanelLeft size={20} strokeWidth={1.75} aria-hidden /> : <Menu size={20} strokeWidth={1.75} aria-hidden />}
                    </IconButton>
                </Tooltip>

                <Box
                    component={RouterLink}
                    to="/"
                    aria-label="AMSA Gestión, ir a Inicio"
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.25,
                        flex: 'none',
                        textDecoration: 'none',
                        color: 'inherit',
                        mr: { xs: 0.5, md: 2 },
                        borderRadius: '8px',
                        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                    }}
                >
                    <LogoAmsa size={32} />
                    <Box
                        component="span"
                        sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'baseline', gap: 0.75, fontSize: '1rem', letterSpacing: '-0.015em', whiteSpace: 'nowrap' }}
                    >
                        <Box component="span" sx={{ fontWeight: 700 }}>AMSA</Box>
                        <Box component="span" sx={{ fontWeight: 500, color: 'text.secondary' }}>Gestión</Box>
                    </Box>
                </Box>

                <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', justifyContent: { xs: 'flex-end', md: 'center' }, px: { md: 2 } }}>
                    <BuscadorGlobal />
                </Box>

                <AsistenteBoton />
                <AyudaContextual />
                <ConexionIndicador />
                <NotificacionesBell />
                <UserMenu user={user} />
            </Toolbar>
        </MuiAppBar>
    );
};

export default AppBarComponent;
