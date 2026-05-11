import React from 'react';
import {
    AppBar as MuiAppBar,
    Box,
    Breadcrumbs,
    IconButton,
    Link,
    Toolbar,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import logo from '../../../assets/logo-amsa-gestion.png';
import UserMenu from './UserMenu';
import NotificacionesBell from './NotificacionesBell';
import { usePageMeta } from '../../../context/PageMetaContext';
import { Link as RouterLink } from 'react-router-dom';

interface AppBarProps {
    onMenuClick: () => void;
    isDesktop: boolean;
    collapsed: boolean;
    user: { nombre: string; rol: string };
}

const AppBarComponent: React.FC<AppBarProps> = ({
    onMenuClick,
    isDesktop,
    collapsed,
    user,
}) => {
    const theme = useTheme();
    const { title, breadcrumbs } = usePageMeta();

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
                borderBottom: `1px solid ${theme.palette.divider}`,
                bgcolor: theme.palette.background.paper,
            }}
        >
            <Toolbar sx={{ gap: 1 }}>
                {/* Hamburguesa toggle (siempre visible) */}
                <Tooltip title={tooltipTitle}>
                    <IconButton
                        edge="start"
                        color="inherit"
                        aria-label={tooltipTitle}
                        onClick={onMenuClick}
                        sx={{ mr: 0.5 }}
                    >
                        <MenuIcon />
                    </IconButton>
                </Tooltip>

                {/* Logo + brand siempre visible */}
                <Box
                    component={RouterLink}
                    to="/"
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        textDecoration: 'none',
                        color: 'inherit',
                        mr: { xs: 1, md: 3 },
                    }}
                >
                    <img src={logo} alt="AMSA Gestión" style={{ height: 36 }} />
                    <Typography
                        variant="subtitle1"
                        fontWeight={700}
                        noWrap
                        sx={{ display: { xs: 'none', sm: 'block' } }}
                    >
                        AMSA Gestión
                    </Typography>
                </Box>

                {/* Breadcrumb / título de página */}
                <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                    {breadcrumbs.length > 0 ? (
                        <Breadcrumbs
                            separator={<NavigateNextIcon fontSize="small" />}
                            aria-label="breadcrumb"
                            sx={{ '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}
                        >
                            {breadcrumbs.map((crumb, index) =>
                                crumb.href && index < breadcrumbs.length - 1 ? (
                                    <Link
                                        key={crumb.href}
                                        component={RouterLink}
                                        to={crumb.href}
                                        color="inherit"
                                        variant="body2"
                                        underline="hover"
                                        noWrap
                                    >
                                        {crumb.label}
                                    </Link>
                                ) : (
                                    <Typography
                                        key={index}
                                        variant="body2"
                                        color={index === breadcrumbs.length - 1 ? 'text.primary' : 'text.secondary'}
                                        fontWeight={index === breadcrumbs.length - 1 ? 600 : 400}
                                        noWrap
                                    >
                                        {crumb.label}
                                    </Typography>
                                ),
                            )}
                        </Breadcrumbs>
                    ) : (
                        <Typography variant="subtitle1" fontWeight={500} color="text.secondary" noWrap>
                            {title}
                        </Typography>
                    )}
                </Box>

                <NotificacionesBell />
                <UserMenu user={user} />
            </Toolbar>
        </MuiAppBar>
    );
};

export default AppBarComponent;
