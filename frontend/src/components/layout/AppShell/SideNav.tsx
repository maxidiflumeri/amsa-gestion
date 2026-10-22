import React, { useEffect, useMemo, useState } from 'react';
import {
    Box,
    Collapse,
    Divider,
    Drawer,
    List,
    ListItemButton,
    ListSubheader,
    Menu,
    MenuItem,
    Toolbar,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import { keyframes } from '@emotion/react';
import { ChevronDown } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useNotificaciones } from '../../../context/NotificacionesContext';
import { textoChipImportaciones } from '../../../utils/campanita';
import IconoNav from './IconoNav';
import { filtrarItemsPorPermisos, navConfig, NavItem, rutaActiva, SeccionNav, TITULOS_SECCION } from './navConfig';

const DRAWER_WIDTH_EXPANDED = 256;
const DRAWER_WIDTH_COLLAPSED = 72;

const SECCIONES: Array<Exclude<SeccionNav, 'pie'>> = ['operacion', 'datos', 'configuracion'];

const latido = keyframes`
    0% { box-shadow: 0 0 0 0 var(--latido); }
    70% { box-shadow: 0 0 0 6px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
`;

/**
 * El punto de "hay importaciones en curso" del ítem Importación. Sale de la misma lista que el chip de la barra.
 * Es un componente aparte para que solo él se redibuje con cada evento de progreso, no el menú entero.
 */
const PuntoImportaciones: React.FC<{ colapsado: boolean }> = ({ colapsado }) => {
    const { importsEnCurso } = useNotificaciones();
    if (textoChipImportaciones(importsEnCurso) === null) return null;
    return (
        <>
            <Box
                aria-hidden
                data-testid="punto-importaciones"
                sx={(theme) => ({
                    '--latido': alpha(theme.palette.primary.main, 0.35),
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    flex: 'none',
                    bgcolor: 'primary.main',
                    animation: `${latido} 2s infinite`,
                    ...(colapsado && { position: 'absolute', top: 9, right: 9 }),
                })}
            />
            <Box component="span" sx={visuallyHidden}>Hay importaciones en curso</Box>
        </>
    );
};

/**
 * El estilo de un ítem del menú. `pildora`: el de la pantalla abierta (o, colapsado, el del grupo que la contiene).
 * `tactil`: el cajón del celular, con ítems de 44 px para el dedo (en la computadora, 40 y 34).
 */
function estiloItem(theme: Theme, o: { pildora: boolean; resaltado: boolean; colapsado: boolean; hijo?: boolean; tactil?: boolean }) {
    const oscuro = theme.palette.mode === 'dark';
    const fondoPildora = alpha(theme.palette.primary.main, oscuro ? 0.16 : 0.11);
    const textoPildora = oscuro ? theme.palette.primary.light : theme.palette.primary.dark;
    return {
        m: 0,
        width: o.colapsado ? 44 : '100%',
        height: o.colapsado || o.tactil ? 44 : o.hijo ? 34 : 40,
        minHeight: 0,
        mx: o.colapsado ? 'auto' : 0,
        px: o.colapsado ? 0 : 1.25,
        gap: 1.5,
        justifyContent: o.colapsado ? 'center' : 'flex-start',
        borderRadius: o.colapsado ? '12px' : o.hijo ? '8px' : '10px',
        fontSize: o.hijo ? '0.84375rem' : '0.875rem',
        fontWeight: o.pildora ? 600 : 500,
        letterSpacing: '-0.005em',
        color: o.pildora ? textoPildora : o.resaltado ? 'text.primary' : 'text.secondary',
        bgcolor: o.pildora ? fondoPildora : 'transparent',
        transition: theme.transitions.create(['background-color', 'color'], { duration: theme.transitions.duration.shortest }),
        '& svg': { color: o.pildora ? 'primary.main' : 'inherit' },
        '&:hover': { bgcolor: o.pildora ? fondoPildora : 'action.hover', color: o.pildora ? textoPildora : 'text.primary' },
        '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2, bgcolor: o.pildora ? fondoPildora : 'action.hover' },
    } as const;
}

const textoItem = { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' } as const;

interface ItemProps {
    item: NavItem;
    activa: string | null;
    colapsado: boolean;
    tactil: boolean;
    abierto: boolean;
    onAlternar: (grupo: NavItem, ancla: HTMLElement) => void;
    onIr: (path: string) => void;
}

const ItemNav: React.FC<ItemProps> = ({ item, activa, colapsado, tactil, abierto, onAlternar, onIr }) => {
    const theme = useTheme();
    const hijos = item.children ?? [];
    const esGrupo = hijos.length > 0;
    const activo = !esGrupo && item.path === activa;
    const conHijoActivo = esGrupo && hijos.some((c) => c.path === activa);

    const boton = (
        <ListItemButton
            onClick={(e) => (esGrupo ? onAlternar(item, e.currentTarget) : item.path && onIr(item.path))}
            aria-current={activo ? 'page' : undefined}
            aria-expanded={esGrupo ? abierto : undefined}
            aria-haspopup={esGrupo && colapsado ? 'menu' : undefined}
            sx={estiloItem(theme, { pildora: activo || (colapsado && conHijoActivo), resaltado: conHijoActivo, colapsado, tactil })}
        >
            <IconoNav nombre={item.icon} />
            {/* Colapsado el nombre queda oculto pero en el botón: así el lector también oye "hay importaciones en curso". */}
            <Box component="span" sx={colapsado ? visuallyHidden : textoItem}>{item.label}</Box>
            {item.indicador === 'importaciones' && <PuntoImportaciones colapsado={colapsado} />}
            {esGrupo && !colapsado && (
                <ChevronDown
                    size={16}
                    aria-hidden
                    style={{
                        flex: 'none',
                        opacity: 0.7,
                        transform: abierto ? 'rotate(180deg)' : 'none',
                        transition: theme.transitions.create('transform', { duration: theme.transitions.duration.shorter }),
                    }}
                />
            )}
        </ListItemButton>
    );

    return (
        <Box component="li" sx={{ listStyle: 'none', position: 'relative' }}>
            {colapsado ? (
                // Todos los ítems, también los grupos (antes solo los sueltos). Con el menú del grupo abierto, sin tooltip.
                // `describeChild` en el de Importación: el nombre sale del contenido, con el aviso de cargas en curso.
                <Tooltip title={esGrupo && abierto ? '' : item.label} placement="right" describeChild={!!item.indicador}>
                    {boton}
                </Tooltip>
            ) : (
                boton
            )}
            {esGrupo && !colapsado && (
                <Collapse in={abierto} timeout="auto" unmountOnExit>
                    <Box
                        component="ul"
                        sx={{ m: 0, mt: 0.25, mb: 0.75, ml: 2.5, pl: 1.25, borderLeft: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: '1px' }}
                    >
                        {hijos.map((hijo) => {
                            const hijoActivo = hijo.path === activa;
                            return (
                                <Box component="li" key={hijo.path ?? hijo.label} sx={{ listStyle: 'none' }}>
                                    <ListItemButton
                                        onClick={() => hijo.path && onIr(hijo.path)}
                                        aria-current={hijoActivo ? 'page' : undefined}
                                        sx={estiloItem(theme, { pildora: hijoActivo, resaltado: false, colapsado: false, hijo: true, tactil })}
                                    >
                                        <Box component="span" sx={textoItem}>{hijo.label}</Box>
                                    </ListItemButton>
                                </Box>
                            );
                        })}
                    </Box>
                </Collapse>
            )}
        </Box>
    );
};

const tituloSeccion = {
    px: 1.25,
    pt: 0.5,
    pb: 0.75,
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'text.secondary',
} as const;

interface SideNavProps {
    open: boolean;
    onClose: () => void;
    variant: 'permanent' | 'temporary';
    collapsed?: boolean;
}

const SideNav: React.FC<SideNavProps> = ({ open, onClose, variant, collapsed = false }) => {
    const theme = useTheme();
    const { tienePermiso } = useAuth();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const isCollapsed = variant === 'permanent' && collapsed;
    const width = isCollapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH_EXPANDED;

    const items = useMemo(() => filtrarItemsPorPermisos(navConfig, tienePermiso), [tienePermiso]);
    const activa = rutaActiva(pathname, items);
    const grupoDeLaActiva = items.find((i) => i.children?.some((c) => c.path === activa))?.label ?? null;

    // El grupo de la pantalla abierta arranca abierto (antes arrancaba cerrado y el menú no mostraba dónde estabas),
    // y se abre solo cuando se llega a una de sus pantallas por otro camino (un enlace, el buscador, amaIA).
    const [abiertos, setAbiertos] = useState<string[]>(() => (grupoDeLaActiva ? [grupoDeLaActiva] : []));
    useEffect(() => {
        if (grupoDeLaActiva) setAbiertos((prev) => (prev.includes(grupoDeLaActiva) ? prev : [...prev, grupoDeLaActiva]));
    }, [grupoDeLaActiva]);

    // Colapsado, un grupo despliega sus pantallas en un menú al costado (antes llevaba siempre a la primera).
    const [desplegado, setDesplegado] = useState<{ grupo: NavItem; ancla: HTMLElement } | null>(null);
    useEffect(() => {
        if (!isCollapsed) setDesplegado(null);
    }, [isCollapsed]);

    const ir = (path: string) => {
        setDesplegado(null);
        navigate(path);
        if (variant === 'temporary') onClose();
    };
    const alternar = (grupo: NavItem, ancla: HTMLElement) => {
        if (isCollapsed) {
            setDesplegado((d) => (d?.grupo.label === grupo.label ? null : { grupo, ancla }));
            return;
        }
        setAbiertos((prev) => (prev.includes(grupo.label) ? prev.filter((g) => g !== grupo.label) : [...prev, grupo.label]));
    };

    const renderItem = (item: NavItem) => (
        <ItemNav
            key={item.path ?? item.label}
            item={item}
            activa={activa}
            colapsado={isCollapsed}
            tactil={variant === 'temporary'}
            abierto={isCollapsed ? desplegado?.grupo.label === item.label : abiertos.includes(item.label)}
            onAlternar={alternar}
            onIr={ir}
        />
    );
    const pie = items.filter((i) => i.seccion === 'pie');
    const secciones = SECCIONES.map((s) => ({ seccion: s, items: items.filter((i) => (i.seccion ?? 'operacion') === s) })).filter((s) => s.items.length > 0);

    const drawerContent = (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Spacer para que los items queden debajo de la AppBar */}
            <Toolbar />

            <Box
                component="nav"
                aria-label="Menú principal"
                sx={{
                    flexGrow: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    px: isCollapsed ? 1.75 : 1.5,
                    pt: 0.5,
                    pb: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.75,
                }}
            >
                {secciones.map(({ seccion, items: deLaSeccion }, i) => (
                    <Box key={seccion}>
                        {isCollapsed ? (
                            i > 0 && <Divider sx={{ mx: 1, mb: 1.5 }} />
                        ) : (
                            <Typography component="div" id={`menu-seccion-${seccion}`} sx={tituloSeccion}>
                                {TITULOS_SECCION[seccion]}
                            </Typography>
                        )}
                        <List
                            disablePadding
                            aria-labelledby={isCollapsed ? undefined : `menu-seccion-${seccion}`}
                            aria-label={isCollapsed ? TITULOS_SECCION[seccion] : undefined}
                            sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}
                        >
                            {deLaSeccion.map(renderItem)}
                        </List>
                    </Box>
                ))}

                {pie.length > 0 && (
                    <Box sx={{ mt: 'auto' }}>
                        <Divider sx={{ mx: 1, mb: 1.25 }} />
                        <List disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                            {pie.map(renderItem)}
                        </List>
                    </Box>
                )}
            </Box>

            <Menu
                anchorEl={desplegado?.ancla ?? null}
                open={!!desplegado}
                onClose={() => setDesplegado(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { sx: { ml: 1, minWidth: 220, borderRadius: '14px' } } }}
                MenuListProps={{ 'aria-label': desplegado?.grupo.label, dense: true }}
            >
                {/* Solo visual: el menú ya se llama como el grupo (`aria-label`), y un `li` suelto no es hijo válido de un `menu`. */}
                <ListSubheader aria-hidden sx={{ ...tituloSeccion, lineHeight: 2.5, bgcolor: 'transparent' }}>{desplegado?.grupo.label}</ListSubheader>
                {(desplegado?.grupo.children ?? []).map((hijo) => (
                    <MenuItem
                        key={hijo.path ?? hijo.label}
                        selected={hijo.path === activa}
                        aria-current={hijo.path === activa ? 'page' : undefined}
                        onClick={() => hijo.path && ir(hijo.path)}
                        sx={{ mx: 0.75, borderRadius: '8px', fontSize: '0.84375rem' }}
                    >
                        {hijo.label}
                    </MenuItem>
                ))}
            </Menu>
        </Box>
    );

    const papel = {
        boxSizing: 'border-box',
        bgcolor: 'background.marco',
        border: 'none',
        overflowX: 'hidden',
    } as const;

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
                        ...papel,
                        width,
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
                    ...papel,
                    width: DRAWER_WIDTH_EXPANDED,
                },
            }}
        >
            {drawerContent}
        </Drawer>
    );
};

export { DRAWER_WIDTH_EXPANDED, DRAWER_WIDTH_COLLAPSED };
export default SideNav;
