import React, { useState, useEffect } from 'react';
import {
    Box,
    Collapse,
    Drawer,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Toolbar,
    Tooltip,
    useTheme,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

// Nav icons
import AssignmentIcon from '@mui/icons-material/Assignment';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import HistoryIcon from '@mui/icons-material/History';
import DescriptionIcon from '@mui/icons-material/Description';
import TableChartIcon from '@mui/icons-material/TableChart';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';
import BarChartIcon from '@mui/icons-material/BarChart';
import SettingsIcon from '@mui/icons-material/Settings';
import BusinessIcon from '@mui/icons-material/Business';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import PolicyIcon from '@mui/icons-material/Policy';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import ShieldIcon from '@mui/icons-material/Shield';
import PeopleIcon from '@mui/icons-material/People';
import TuneIcon from '@mui/icons-material/Tune';
import FactCheckIcon from '@mui/icons-material/FactCheck';

import { navConfig, NavItem } from './navConfig';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';

const DRAWER_WIDTH_EXPANDED = 240;
const DRAWER_WIDTH_COLLAPSED = 72;

const iconMap: Record<string, React.ReactNode> = {
    Assignment: <AssignmentIcon />,
    UploadFile: <UploadFileIcon />,
    History: <HistoryIcon />,
    Description: <DescriptionIcon />,
    TableChart: <TableChartIcon />,
    AutoGraph: <AutoGraphIcon />,
    BarChart: <BarChartIcon />,
    Settings: <SettingsIcon />,
    Business: <BusinessIcon />,
    SettingsInputComponent: <SettingsInputComponentIcon />,
    Policy: <PolicyIcon />,
    AdminPanelSettings: <AdminPanelSettingsIcon />,
    Shield: <ShieldIcon />,
    People: <PeopleIcon />,
    Tune: <TuneIcon />,
    FactCheck: <FactCheckIcon />,
};

function getIcon(name: string): React.ReactNode {
    return iconMap[name] ?? <AssignmentIcon />;
}

interface NavItemRowProps {
    item: NavItem;
    depth?: number;
    collapsed?: boolean;
    forceOpen?: boolean;
}

const NavItemRow: React.FC<NavItemRowProps> = ({ item, depth = 0, collapsed = false, forceOpen = false }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);

    const hasChildren = !!item.children && item.children.length > 0;
    const isActive = item.path ? location.pathname === item.path : false;
    const childActive = hasChildren && item.children!.some((c) => c.path === location.pathname);

    useEffect(() => {
        if (forceOpen) setOpen(false);
    }, [forceOpen]);

    const handleClick = () => {
        if (collapsed) {
            // En modo colapsado, ir directo al primer hijo si existe (no se expande)
            if (hasChildren && item.children![0].path) {
                navigate(item.children![0].path);
            } else if (item.path) {
                navigate(item.path);
            }
            return;
        }
        if (hasChildren) {
            setOpen((prev) => !prev);
        } else if (item.path) {
            navigate(item.path);
        }
    };

    const button = (
        <ListItemButton
            onClick={handleClick}
            selected={isActive || (collapsed && childActive)}
            sx={{
                pl: collapsed ? 0 : depth === 0 ? 2 : 3.5,
                justifyContent: collapsed ? 'center' : 'flex-start',
                minHeight: 44,
            }}
            aria-current={isActive ? 'page' : undefined}
        >
            <ListItemIcon
                sx={{
                    minWidth: collapsed ? 0 : 36,
                    mr: collapsed ? 0 : 0,
                    color: isActive || (collapsed && childActive) ? 'primary.main' : 'text.secondary',
                    justifyContent: 'center',
                }}
            >
                {getIcon(item.icon)}
            </ListItemIcon>
            {!collapsed && (
                <>
                    <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{
                            variant: 'body2',
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? 'primary.main' : 'text.primary',
                            noWrap: true,
                        }}
                    />
                    {hasChildren && (open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)}
                </>
            )}
        </ListItemButton>
    );

    return (
        <>
            <ListItem disablePadding>
                {collapsed ? (
                    <Tooltip title={item.label} placement="right" arrow>
                        <Box sx={{ width: '100%' }}>{button}</Box>
                    </Tooltip>
                ) : (
                    button
                )}
            </ListItem>

            {hasChildren && !collapsed && (
                <Collapse in={open} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding>
                        {item.children!.map((child) => (
                            <NavItemRow key={child.path ?? child.label} item={child} depth={depth + 1} collapsed={collapsed} />
                        ))}
                    </List>
                </Collapse>
            )}
        </>
    );
};

interface SideNavProps {
    open: boolean;
    onClose: () => void;
    variant: 'permanent' | 'temporary';
    collapsed?: boolean;
}

function filtrarItemsPorPermisos(items: NavItem[], tienePermiso: (k: string) => boolean): NavItem[] {
    return items
        .filter((item) => {
            if (!item.requiredPermissions || item.requiredPermissions.length === 0) return true;
            return item.requiredPermissions.some((p) => tienePermiso(p));
        })
        .map((item) => ({
            ...item,
            children: item.children
                ? filtrarItemsPorPermisos(item.children, tienePermiso)
                : undefined,
        }))
        .filter((item) => !item.children || item.children.length > 0 || item.path);
}

const SideNav: React.FC<SideNavProps> = ({ open, onClose, variant, collapsed = false }) => {
    const theme = useTheme();
    const { tienePermiso } = useAuth();
    const isCollapsed = variant === 'permanent' && collapsed;
    const width = isCollapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH_EXPANDED;

    const itemsFiltrados = filtrarItemsPorPermisos(navConfig, tienePermiso);

    const drawerContent = (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Spacer para que los items queden debajo de la AppBar */}
            <Toolbar />


            <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden', pt: 1 }}>
                <List disablePadding>
                    {itemsFiltrados.map((item) => (
                        <NavItemRow
                            key={item.path ?? item.label}
                            item={item}
                            collapsed={isCollapsed}
                            forceOpen={isCollapsed}
                        />
                    ))}
                </List>
            </Box>
        </Box>
    );

    if (variant === 'permanent') {
        return (
            <Drawer
                variant="permanent"
                open
                sx={{
                    width,
                    flexShrink: 0,
                    transition: theme.transitions.create('width', {
                        easing: theme.transitions.easing.sharp,
                        duration: theme.transitions.duration.enteringScreen,
                    }),
                    '& .MuiDrawer-paper': {
                        width,
                        boxSizing: 'border-box',
                        overflowX: 'hidden',
                        transition: theme.transitions.create('width', {
                            easing: theme.transitions.easing.sharp,
                            duration: theme.transitions.duration.enteringScreen,
                        }),
                    },
                }}
            >
                {drawerContent}
            </Drawer>
        );
    }

    return (
        <Drawer
            variant="temporary"
            open={open}
            onClose={onClose}
            ModalProps={{ keepMounted: true }}
            sx={{
                '& .MuiDrawer-paper': {
                    width: DRAWER_WIDTH_EXPANDED,
                    boxSizing: 'border-box',
                },
            }}
        >
            {drawerContent}
        </Drawer>
    );
};

export { DRAWER_WIDTH_EXPANDED, DRAWER_WIDTH_COLLAPSED };
export default SideNav;
