import React, { useState, useEffect, useRef } from 'react';
import { Box, Toolbar, useMediaQuery, useTheme } from '@mui/material';
import { Outlet, useLocation } from 'react-router-dom';
import AppBarComponent from './AppBar';
import SideNav from './SideNav';
import { vuelveArriba } from './navConfig';
import { useAuth } from '../../../context/AuthContext';
import { AsistenteProvider } from '../../../context/AsistenteContext';
import AsistentePanel from '../../asistente/AsistentePanel';

const SIDEBAR_COLLAPSED_KEY = 'app_sidebar_collapsed';

function readCollapsed(): boolean {
    try {
        return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * La estructura de la app: la barra superior y el menú lateral forman un marco (`background.marco`), y la pantalla va
 * en un panel con las esquinas de arriba redondeadas. Desde `md` el que se desplaza es el panel, no la ventana: así la
 * barra y el menú quedan quietos, y lo que es `position: sticky; top: 0` en una pantalla se pega al borde del panel.
 * Debajo de `md` (celular, tablet) el panel ocupa todo el ancho, sin esquinas, y se desplaza la página como siempre: con
 * un scroll interno, Chrome y Safari dejan de esconder la barra de direcciones y se pierde el tirar-para-recargar.
 */
const AppShell: React.FC = () => {
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
    const [mobileOpen, setMobileOpen] = useState(false);
    const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
    const { usuario } = useAuth();
    const { pathname } = useLocation();
    const panelRef = useRef<HTMLElement | null>(null);

    const user = {
        nombre: usuario?.nombre ?? 'Usuario',
        rol: usuario?.rol ?? '-',
    };

    useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
        } catch {
            /* ignore */
        }
    }, [collapsed]);

    // Otra pantalla arranca desde arriba: el panel en la computadora, la página en el celular (ver `vuelveArriba`).
    const rutaAnterior = useRef(pathname);
    useEffect(() => {
        const anterior = rutaAnterior.current;
        rutaAnterior.current = pathname;
        if (!vuelveArriba(anterior, pathname)) return;
        if (panelRef.current) panelRef.current.scrollTop = 0;
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }, [pathname]);

    // Elegida una pantalla desde el marco (el menú, el buscador, el logo, la campanita), el foco pasa al contenido: si
    // no, se queda en el marco, que no se desplaza, y AvPág o las flechas no mueven nada. Solo desde el marco (o sin
    // foco): un campo con autoFocus de la pantalla nueva, o la conversación de amaIA, se quedan con el foco.
    useEffect(() => {
        const activo = document.activeElement;
        const desdeElMarco = !activo || activo === document.body || !!activo.closest('nav[aria-label="Menú principal"], .MuiAppBar-root');
        if (desdeElMarco && panelRef.current) panelRef.current.focus({ preventScroll: true });
    }, [pathname]);

    const handleMenuClick = () => {
        if (isDesktop) {
            setCollapsed((prev) => !prev);
        } else {
            setMobileOpen((prev) => !prev);
        }
    };

    const handleDrawerClose = () => {
        setMobileOpen(false);
    };

    return (
        <AsistenteProvider>
            <Box
                sx={{
                    display: 'flex',
                    // Solo debajo de `md`: arriba manda el alto. Con los dos, en un celular horizontal de 900 px o más
                    // 100vh (barra del navegador escondida) le gana a 100dvh y el final de la pantalla queda afuera.
                    minHeight: { xs: '100vh', md: 0 },
                    height: { md: '100vh' },
                    '@supports (height: 100dvh)': { height: { md: '100dvh' } },
                    overflow: { md: 'hidden' },
                    bgcolor: 'background.marco',
                }}
            >
                {/* AppBar */}
                <AppBarComponent
                    onMenuClick={handleMenuClick}
                    isDesktop={isDesktop}
                    collapsed={collapsed}
                    user={user}
                />

                {/* Side navigation */}
                <SideNav
                    open={isDesktop ? true : mobileOpen}
                    onClose={handleDrawerClose}
                    variant={isDesktop ? 'permanent' : 'temporary'}
                    collapsed={collapsed}
                />

                {/* Main content */}
                <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <Toolbar />
                    <Box
                        component="main"
                        ref={panelRef}
                        tabIndex={-1}
                        sx={{
                            outline: 'none',
                            flexGrow: 1,
                            minHeight: { md: 0 },
                            overflow: { md: 'auto' },
                            overscrollBehavior: { md: 'contain' },
                            bgcolor: 'background.default',
                            mr: { md: 1.5 },
                            border: { md: 1 },
                            borderBottom: { md: 0 },
                            borderColor: { md: 'divider' },
                            borderTopLeftRadius: { md: '16px' },
                            borderTopRightRadius: { md: '16px' },
                            px: { xs: 2, sm: 3, md: 4 },
                            py: { xs: 2, sm: 3 },
                        }}
                    >
                        <Outlet />
                    </Box>
                </Box>

                {/* El asistente vive acá y no en la barra: la conversación tiene que sobrevivir a «Sí, llevarme». */}
                <AsistentePanel />
            </Box>
        </AsistenteProvider>
    );
};

export default AppShell;
