import React, { useState, useEffect } from 'react';
import { Box, Toolbar, useMediaQuery, useTheme } from '@mui/material';
import { Outlet } from 'react-router-dom';
import AppBarComponent from './AppBar';
import SideNav from './SideNav';
import { useAuth } from '../../../context/AuthContext';

const SIDEBAR_COLLAPSED_KEY = 'app_sidebar_collapsed';

function readCollapsed(): boolean {
    try {
        return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
}

const AppShell: React.FC = () => {
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
    const [mobileOpen, setMobileOpen] = useState(false);
    const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
    const { usuario } = useAuth();

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
        <Box sx={{ display: 'flex', minHeight: '100vh' }}>
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
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: 'background.default',
                }}
            >
                <Toolbar />
                <Box
                    sx={{
                        flexGrow: 1,
                        px: { xs: 2, sm: 3, md: 4 },
                        py: { xs: 2, sm: 3 },
                    }}
                >
                    <Outlet />
                </Box>
            </Box>
        </Box>
    );
};

export default AppShell;
