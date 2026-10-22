import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Divider,
    FormControlLabel,
    Skeleton,
    Switch,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getPerfil, type PerfilDto } from '../../api/perfil';
import AvatarUsuario from '../../components/ui/AvatarUsuario';
import SelectorTema from '../../components/ui/SelectorTema';
import { PageHeader, SectionCard } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useMenuLateral } from '../../context/MenuLateralContext';
import { TODOS_LOS_PERMISOS } from '../../utils/permisosCatalogo';
import { cuandoRelativo, tiemposDeSesion } from '../../utils/sesion';
import { TECLA_MOD } from '../../utils/teclado';

const TOTAL_PERMISOS = TODOS_LOS_PERMISOS.reduce((n, s) => n + s.permisos.length, 0);

type Extra = { estado: 'cargando' } | { estado: 'error' } | { estado: 'listo'; perfil: PerfilDto };

/** Los permisos que la persona tiene, agrupados como en el catálogo. Una clave que no está en el catálogo va en "Otros". */
export function permisosAgrupados(permisos: string[]): Array<{ seccion: string; items: string[] }> {
    const tiene = new Set(permisos);
    const grupos = TODOS_LOS_PERMISOS.map((s) => ({ seccion: s.seccion, items: s.permisos.filter((p) => tiene.has(p.key)).map((p) => p.label) }))
        .filter((g) => g.items.length > 0);
    const conocidas = new Set(TODOS_LOS_PERMISOS.flatMap((s) => s.permisos.map((p) => p.key)));
    const otras = permisos.filter((p) => !conocidas.has(p));
    if (otras.length > 0) grupos.push({ seccion: 'Otros', items: otras });
    return grupos;
}

/** "Tu rol cambió desde que entraste (ahora es SUPERVISOR): se sumaron 2 permisos y se quitó 1." */
export function textoDelCambio(c: { sumados: number; quitados: number; rolNuevo: string | null }): string {
    const permisosDe = (n: number) => (n === 1 ? '1 permiso' : `${n} permisos`);
    const partes: string[] = [];
    if (c.sumados > 0) partes.push(`se ${c.sumados === 1 ? 'sumó' : 'sumaron'} ${permisosDe(c.sumados)}`);
    if (c.quitados > 0) {
        const cuantos = c.sumados > 0 ? String(c.quitados) : permisosDe(c.quitados);
        partes.push(`se ${c.quitados === 1 ? 'quitó' : 'quitaron'} ${cuantos}`);
    }
    const rol = c.rolNuevo ? ` (ahora es ${c.rolNuevo})` : '';
    return `Tu rol cambió desde que entraste${rol}${partes.length > 0 ? `: ${partes.join(' y ')}` : ''}.`;
}

const etiquetaDato = {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'text.secondary',
} as const;

const Dato: React.FC<{ etiqueta: string; children: React.ReactNode }> = ({ etiqueta, children }) => (
    <Box sx={(theme) => ({ bgcolor: alpha(theme.palette.text.primary, 0.035), borderRadius: '10px', px: 1.5, py: 1.25, minWidth: 0 })}>
        <Typography component="dt" sx={etiquetaDato}>{etiqueta}</Typography>
        <Typography component="dd" sx={{ m: 0, mt: 0.5, fontSize: '0.875rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
            {children}
        </Typography>
    </Box>
);

const SinCargar = () => (
    <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>Sin cargar</Box>
);

const fechaLarga = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
};

/**
 * «Mi perfil»: los datos propios (con legajo, DNI y fecha de alta, de `GET /auth/perfil`), lo que el rol deja hacer,
 * las preferencias de este navegador, la sesión y los atajos. Es de solo lectura salvo las preferencias: el nombre y
 * la foto los pisa Google en cada login, y el legajo y el DNI los carga quien administra los usuarios.
 */
const MiPerfil: React.FC = () => {
    const theme = useTheme();
    const escritorio = useMediaQuery(theme.breakpoints.up('md'));
    const navigate = useNavigate();
    const { usuario, token, logout, tienePermiso } = useAuth();
    const menuLateral = useMenuLateral();
    const [extra, setExtra] = useState<Extra>({ estado: 'cargando' });

    const cargar = useCallback(async () => {
        setExtra({ estado: 'cargando' });
        try {
            setExtra({ estado: 'listo', perfil: await getPerfil() });
        } catch {
            setExtra({ estado: 'error' });
        }
    }, []);

    // Una sola vez al abrir: en modo estricto el efecto corre dos veces y el perfil se pedía dos.
    const yaPedido = useRef(false);
    useEffect(() => {
        if (yaPedido.current) return;
        yaPedido.current = true;
        void cargar();
    }, [cargar]);

    const perfil = extra.estado === 'listo' ? extra.perfil : null;
    // Nombre, email y foto: lo del servidor es lo último, y lo de la sesión sirve mientras llega o si falla.
    const nombre = perfil?.nombre ?? usuario?.nombre ?? '';
    const email = perfil?.email ?? usuario?.email ?? '';
    const avatarUrl = perfil?.avatarUrl ?? usuario?.avatarUrl ?? null;
    // Rol y permisos: SIEMPRE los de la sesión, que son con los que el sistema decide (se arman al entrar). Los de la
    // base pueden haber cambiado desde entonces y no valen hasta volver a entrar: solo se usan para avisarlo.
    const rol = usuario?.rol ?? '';
    const permisos = useMemo(() => usuario?.permisos ?? [], [usuario]);
    const grupos = useMemo(() => permisosAgrupados(permisos), [permisos]);
    const cambio = useMemo(() => {
        if (!perfil) return null;
        const antes = new Set(permisos);
        const ahora = new Set(perfil.permisos);
        const sumados = perfil.permisos.filter((p) => !antes.has(p)).length;
        const quitados = permisos.filter((p) => !ahora.has(p)).length;
        const rolNuevo = perfil.rol !== rol ? perfil.rol : null;
        return sumados || quitados || rolNuevo ? { sumados, quitados, rolNuevo } : null;
    }, [perfil, permisos, rol]);
    const puedeBuscarCasos = tienePermiso('deudores.ver');
    const sesion = tiemposDeSesion(token);

    const datoExtra = (valor: (p: PerfilDto) => React.ReactNode) => {
        if (extra.estado === 'cargando') return <Skeleton width="60%" aria-label="Cargando" />;
        if (extra.estado === 'error') return <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>—</Box>;
        return valor(extra.perfil);
    };

    const cerrarSesion = () => {
        logout();
        navigate('/login');
    };

    return (
        <Box sx={{ width: '100%', maxWidth: 1120, mx: 'auto' }}>
            <PageHeader title="Mi perfil" subtitle="Tus datos, lo que tu rol te deja hacer y cómo ves la plataforma." />

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'flex-start' }}>
                <Box sx={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <SectionCard title="Tu cuenta">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                            <AvatarUsuario nombre={nombre} avatarUrl={avatarUrl} size={64} />
                            <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontSize: '1.125rem', fontWeight: 650, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{nombre}</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{email}</Typography>
                            </Box>
                        </Box>

                        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.25 }}>
                            <Dato etiqueta="Rol">{rol || <SinCargar />}</Dato>
                            <Dato etiqueta="Permisos">{`${permisos.length} de ${TOTAL_PERMISOS}`}</Dato>
                            <Dato etiqueta="Legajo">{datoExtra((p) => p.legajo || <SinCargar />)}</Dato>
                            <Dato etiqueta="DNI o CUIL">{datoExtra((p) => p.dni || <SinCargar />)}</Dato>
                            <Dato etiqueta="Fecha de alta">{datoExtra((p) => fechaLarga(p.fechaAlta) ?? <SinCargar />)}</Dato>
                        </Box>

                        {extra.estado === 'error' && (
                            <Alert
                                severity="warning"
                                sx={{ mt: 2 }}
                                action={<Button color="inherit" size="small" onClick={() => void cargar()} sx={{ minHeight: { xs: 44, md: 'auto' } }}>Reintentar</Button>}
                            >
                                No se pudieron traer el legajo, el DNI y la fecha de alta.
                            </Alert>
                        )}

                        <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 2, mb: 0, lineHeight: 1.5 }}>
                            El nombre y la foto vienen de tu cuenta de Google y se actualizan cada vez que entrás. El legajo y
                            el DNI los carga quien administra los usuarios; la fecha de alta la pone el sistema.
                        </Typography>
                    </SectionCard>

                    <SectionCard
                        title="Preferencias"
                        action={
                            <Box component="span" sx={(t) => ({ display: 'inline-block', mt: 0.75, mr: 1, px: 1, py: '3px', borderRadius: 999, fontSize: '0.71875rem', fontWeight: 600, color: 'text.secondary', bgcolor: alpha(t.palette.text.primary, 0.06) })}>
                                En este navegador
                            </Box>
                        }
                    >
                        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, mb: 1 }}>Tema</Typography>
                        <SelectorTema alto={34} />
                        <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 1, mb: 0 }}>
                            Sistema sigue lo que tengas configurado en la computadora o el celular.
                        </Typography>

                        {menuLateral && (
                            <>
                                <Divider sx={{ my: 2 }} />
                                <FormControlLabel
                                    labelPlacement="start"
                                    disabled={!escritorio}
                                    control={<Switch checked={menuLateral.colapsado} onChange={(e) => menuLateral.setColapsado(e.target.checked)} />}
                                    label={
                                        <Box>
                                            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>Menú lateral achicado</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {escritorio
                                                    ? 'Solo los íconos, con más lugar para la pantalla.'
                                                    : 'En el celular y la tablet el menú se abre con el botón de la barra.'}
                                            </Typography>
                                        </Box>
                                    }
                                    sx={{ m: 0, width: '100%', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}
                                />
                            </>
                        )}
                    </SectionCard>

                    <SectionCard title="Sesión">
                        <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                            {sesion.desde && <>Entraste <strong>{cuandoRelativo(sesion.desde)}</strong>. </>}
                            {sesion.vence ? (
                                <>La sesión vence <strong>{cuandoRelativo(sesion.vence)}</strong>: después hay que volver a entrar con Google.</>
                            ) : (
                                <>Cuando la sesión vence, hay que volver a entrar con Google.</>
                            )}
                        </Typography>
                        <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            startIcon={<LogOut size={16} strokeWidth={1.75} aria-hidden />}
                            onClick={cerrarSesion}
                            sx={{ mt: 2, minHeight: { xs: 44, md: 'auto' } }}
                        >
                            Cerrar sesión
                        </Button>
                    </SectionCard>
                </Box>

                <Box sx={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <SectionCard title="Lo que podés hacer">
                        {cambio && (
                            <Alert
                                severity="info"
                                sx={{ mb: 2 }}
                                action={
                                    <Button color="inherit" size="small" onClick={cerrarSesion} sx={{ minHeight: { xs: 44, md: 'auto' }, whiteSpace: 'nowrap' }}>
                                        Cerrar sesión
                                    </Button>
                                }
                            >
                                {textoDelCambio(cambio)} Para que se apliquen, cerrá sesión y volvé a entrar: hasta entonces
                                seguís con los permisos de abajo.
                            </Alert>
                        )}
                        <Typography variant="body2" sx={{ lineHeight: 1.6, mb: 2.5 }}>
                            {permisos.length === 0 ? (
                                <>Tu rol {rol && <strong>{rol}</strong>} todavía no tiene permisos.</>
                            ) : (
                                <>
                                    Tu rol <strong>{rol}</strong> te da <strong>{permisos.length} {permisos.length === 1 ? 'permiso' : 'permisos'}</strong>.
                                </>
                            )}{' '}
                            Lo que no ves en el menú o en una pantalla es porque tu rol no lo tiene: para cambiarlo, hablá con quien
                            administre los roles.
                        </Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '18px 24px' }}>
                            {grupos.map((g) => (
                                <Box key={g.seccion} component="section" aria-label={g.seccion} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <Typography component="div" sx={etiquetaDato}>{g.seccion}</Typography>
                                    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                        {g.items.map((item) => (
                                            <Box
                                                component="li"
                                                key={item}
                                                sx={(t) => ({
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 0.75,
                                                    px: 1.25,
                                                    py: 0.625,
                                                    borderRadius: 999,
                                                    fontSize: '0.78125rem',
                                                    fontWeight: 500,
                                                    bgcolor: alpha(t.palette.text.primary, 0.05),
                                                    '& svg': { color: 'success.main', flex: 'none' },
                                                })}
                                            >
                                                <Check size={13} strokeWidth={2.5} aria-hidden />
                                                {item}
                                            </Box>
                                        ))}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </SectionCard>

                    {/* Los atajos son de teclado: en el celular no aplican. */}
                    {escritorio && (
                        <SectionCard title="Atajos de teclado">
                            <Box
                                component="dl"
                                sx={(t) => ({
                                    m: 0,
                                    display: 'grid',
                                    gridTemplateColumns: 'auto minmax(0, 1fr)',
                                    gap: '12px 16px',
                                    alignItems: 'center',
                                    fontSize: '0.84375rem',
                                    '& dd': { m: 0, color: 'text.secondary' },
                                    '& kbd': {
                                        fontFamily: 'inherit',
                                        fontSize: '0.71875rem',
                                        fontWeight: 600,
                                        lineHeight: 1,
                                        px: 1,
                                        py: 0.625,
                                        borderRadius: '6px',
                                        border: `1px solid ${t.palette.divider}`,
                                        borderBottomWidth: 2,
                                        bgcolor: 'background.paper',
                                        color: 'text.primary',
                                    },
                                })}
                            >
                                <Box component="dt" sx={{ display: 'flex', gap: 0.5 }}><kbd>{TECLA_MOD}</kbd><kbd>K</kbd></Box>
                                <dd>{puedeBuscarCasos ? 'Buscar un caso o una pantalla' : 'Buscar una pantalla'}, desde cualquier pantalla</dd>
                                <Box component="dt" sx={{ display: 'flex', gap: 0.5 }}><kbd>↑</kbd><kbd>↓</kbd></Box>
                                <dd>Moverte entre los resultados del buscador</dd>
                                <Box component="dt" sx={{ display: 'flex', gap: 0.5 }}><kbd>Enter</kbd></Box>
                                <dd>Abrir el resultado marcado</dd>
                                <Box component="dt" sx={{ display: 'flex', gap: 0.5 }}><kbd>Esc</kbd></Box>
                                <dd>Cerrar el buscador o un diálogo</dd>
                            </Box>
                        </SectionCard>
                    )}
                </Box>
            </Box>
        </Box>
    );
};

export default MiPerfil;
