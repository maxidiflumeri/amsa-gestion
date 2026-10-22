import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Box,
    Button,
    ButtonBase,
    CircularProgress,
    Dialog,
    DialogTitle,
    IconButton,
    InputBase,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import { CornerDownLeft, FileSearch, Search, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import { mostrarDocumento } from '../../../utils/documento';
import { linkCaso } from '../../../utils/linkCaso';
import BuscadorAvanzadoModal from '../../deudores/BuscadorAvanzadoModal';
import IconoNav from './IconoNav';
import { filtrarItemsPorPermisos, navConfig, pantallasDelMenu } from './navConfig';

/** Desde cuántas letras se buscan casos (las pantallas se filtran desde la primera). */
export const MIN_LETRAS_CASOS = 2;
export const CASOS_POR_BUSQUEDA = 6;
const ESPERA_MS = 300;

/** En una Mac el atajo se muestra con ⌘ (funciona con las dos teclas en cualquier sistema). */
const esMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const ATAJO = esMac ? '⌘ K' : 'Ctrl K';

/** Sin tildes ni mayúsculas: "parametros" encuentra "Parámetros". */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Una pantalla coincide si lo escrito empieza una de sus palabras ("usu" → Usuarios, "mis ej" → Mis ejecuciones).
 * Por el medio no: un apellido como "Ríos" encontraba Usuarios, quedaba primero y Enter llevaba ahí en vez del caso.
 */
export const empiezaPalabra = (texto: string, q: string) => ` ${normalizar(texto)}`.includes(` ${q}`);

/** Lo que devuelve `GET /deudores?search=` por cada caso (con `include: { empresa, remesa }`). */
interface CasoEncontrado {
    id: number;
    nombre?: string | null;
    apellido?: string | null;
    documento?: string | null;
    empresa?: { nombre?: string | null } | null;
    remesa?: { numeroRemesa?: string | number | null } | null;
}

type Opcion =
    | { tipo: 'pantalla'; clave: string; titulo: string; detalle: string | null; icono?: string; path: string }
    | { tipo: 'caso'; clave: string; titulo: string; detalle: string; id: number }
    | { tipo: 'avanzada'; clave: string; titulo: string; detalle: string };

type EstadoCasos =
    | { estado: 'inactivo' }
    | { estado: 'cargando' }
    | { estado: 'error' }
    | { estado: 'listo'; items: CasoEncontrado[]; total: number };

function nombreDelCaso(c: CasoEncontrado): string {
    const nombre = [c.nombre, c.apellido].filter((x) => x && String(x).trim()).join(' ').trim();
    return nombre || `Caso ${c.id}`;
}

function detalleDelCaso(c: CasoEncontrado): string {
    const documento = mostrarDocumento(c.documento);
    // `mostrarDocumento` ya dice "Sin DNI" para el relleno `SIN-DNI-…`: sin el prefijo, no "DNI Sin DNI".
    const partes = [documento === 'Sin DNI' ? documento : `DNI ${documento}`];
    if (c.empresa?.nombre) partes.push(c.empresa.nombre);
    if (c.remesa?.numeroRemesa != null && c.remesa.numeroRemesa !== '') partes.push(`Remesa ${c.remesa.numeroRemesa}`);
    partes.push(`ID ${c.id}`);
    return partes.join(' · ');
}

const ID_LISTA = 'buscador-global-lista';
const idOpcion = (i: number) => `buscador-global-opcion-${i}`;

interface DialogoProps {
    onCerrar: () => void;
    onAvanzada: () => void;
}

/** El diálogo en sí. Se monta al abrirse, así cada vez arranca vacío. */
const DialogoBuscador: React.FC<DialogoProps> = ({ onCerrar, onAvanzada }) => {
    const theme = useTheme();
    const navigate = useNavigate();
    const { tienePermiso } = useAuth();
    const puedeCasos = tienePermiso('deudores.ver');
    const [texto, setTexto] = useState('');
    const [activo, setActivo] = useState(0);
    const [casos, setCasos] = useState<EstadoCasos>({ estado: 'inactivo' });
    const [intento, setIntento] = useState(0);
    const entradaRef = useRef<HTMLInputElement | null>(null);

    // El foco va al campo cuando el diálogo ya se montó. `autoFocus` solo no alcanza: si al abrir había algo enfocado
    // (el botón de la barra, el contenido), en modo estricto el FocusTrap de MUI se lo devuelve y después enfoca el
    // contenedor. Con letra de 16 px, iOS no hace zoom al enfocarlo.
    useEffect(() => {
        const id = window.setTimeout(() => entradaRef.current?.focus(), 0);
        return () => window.clearTimeout(id);
    }, []);

    // Con el buscador abierto, Ctrl+K vuelve al campo (si no, el navegador manda el foco a su barra de direcciones).
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
            e.preventDefault();
            entradaRef.current?.focus();
            entradaRef.current?.select();
        };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, []);

    const termino = texto.trim();
    const buscaCasos = puedeCasos && termino.length >= MIN_LETRAS_CASOS;

    // La misma búsqueda que el buscador de Gestión: nombre o apellido (parcial), documento (entero) o ID.
    useEffect(() => {
        if (!buscaCasos) {
            setCasos({ estado: 'inactivo' });
            return;
        }
        setCasos({ estado: 'cargando' });
        const control = new AbortController();
        const espera = setTimeout(async () => {
            try {
                // `silencioso`: un pedido cancelado por seguir escribiendo no tiene respuesta, y el interceptor lo
                // mostraría como "Sin conexión". Los errores se cuentan acá adentro.
                const res = await api.get('/deudores', {
                    params: { page: 1, limit: CASOS_POR_BUSQUEDA, search: termino },
                    signal: control.signal,
                    silencioso: true,
                });
                const items: CasoEncontrado[] = Array.isArray(res.data?.data) ? res.data.data : [];
                setCasos({ estado: 'listo', items, total: Number(res.data?.meta?.total ?? items.length) });
            } catch {
                if (!control.signal.aborted) setCasos({ estado: 'error' });
            }
        }, ESPERA_MS);
        return () => {
            clearTimeout(espera);
            control.abort();
        };
    }, [buscaCasos, termino, intento]);

    const pantallas = useMemo(() => pantallasDelMenu(filtrarItemsPorPermisos(navConfig, tienePermiso)), [tienePermiso]);
    const q = normalizar(texto);
    const pantallasQueCoinciden = useMemo(() => {
        if (!q) return pantallas;
        const coinciden = pantallas.filter(({ item, grupo }) => empiezaPalabra(item.label, q) || (!!grupo && empiezaPalabra(grupo.label, q)));
        // Primero las que empiezan con lo escrito.
        return [...coinciden].sort((a, b) => Number(!normalizar(a.item.label).startsWith(q)) - Number(!normalizar(b.item.label).startsWith(q)));
    }, [pantallas, q]);

    const deCasos: Opcion[] = casos.estado === 'listo'
        ? casos.items.map((c) => ({ tipo: 'caso', clave: `c:${c.id}`, titulo: nombreDelCaso(c), detalle: detalleDelCaso(c), id: c.id }))
        : [];
    const dePantallas: Opcion[] = pantallasQueCoinciden.map(({ item, grupo }) => ({
        tipo: 'pantalla',
        clave: `p:${item.path}`,
        titulo: item.label,
        detalle: grupo?.label ?? null,
        icono: (grupo ?? item).icon,
        path: item.path!,
    }));
    const deMas: Opcion[] = puedeCasos
        ? [{ tipo: 'avanzada', clave: 'avanzada', titulo: 'Búsqueda avanzada', detalle: 'Por número de cliente, teléfono, mail o empresa' }]
        : [];
    // Las pantallas van primero porque salen al instante: si los casos llegaran arriba, lo marcado se correría.
    const grupos = [
        { id: 'pantallas', titulo: 'Pantallas', opciones: dePantallas },
        { id: 'casos', titulo: 'Casos', opciones: deCasos },
        { id: 'mas', titulo: 'Más', opciones: deMas },
    ].filter((g) => g.opciones.length > 0);
    const opciones = grupos.flatMap((g) => g.opciones);
    const indice = opciones.length === 0 ? -1 : Math.min(activo, opciones.length - 1);

    useEffect(() => {
        if (indice < 0) return;
        const el = document.getElementById(idOpcion(indice));
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }, [indice]);

    const elegir = (op: Opcion) => {
        if (op.tipo === 'avanzada') {
            onAvanzada();
            return;
        }
        onCerrar();
        navigate(op.tipo === 'caso' ? linkCaso(op.id) : op.path);
    };

    const alTeclear = (e: React.KeyboardEvent) => {
        const n = opciones.length;
        if (e.key === 'ArrowDown' && n > 0) {
            e.preventDefault();
            setActivo((indice + 1) % n);
        } else if (e.key === 'ArrowUp' && n > 0) {
            e.preventDefault();
            setActivo((indice - 1 + n) % n);
        } else if (e.key === 'Enter' && indice >= 0) {
            e.preventDefault();
            const op = opciones[indice];
            // Con los casos todavía buscándose, un Enter apurado no abre la búsqueda avanzada en lugar del caso.
            if (op.tipo === 'avanzada' && casos.estado === 'cargando') return;
            elegir(op);
        }
    };

    let estado: React.ReactNode = null;
    if (!termino) {
        estado = puedeCasos
            ? 'Escribí el nombre, el apellido, el DNI completo o el ID de un caso, o el nombre de una pantalla.'
            : 'Escribí el nombre de una pantalla.';
    } else if (puedeCasos && termino.length < MIN_LETRAS_CASOS) {
        estado = 'Seguí escribiendo para buscar casos.';
    } else if (casos.estado === 'cargando') {
        estado = (
            <>
                <CircularProgress size={12} sx={{ mr: 1, verticalAlign: 'middle' }} />
                Buscando casos…
            </>
        );
    } else if (casos.estado === 'error') {
        estado = (
            <>
                No se pudo buscar casos.
                <Button size="small" onClick={() => setIntento((n) => n + 1)} sx={{ ml: 1, py: 0, minWidth: 0 }}>
                    Reintentar
                </Button>
            </>
        );
    } else if (casos.estado === 'listo' && casos.items.length === 0) {
        estado = 'Ningún caso coincide. El DNI se busca completo; por número de cliente o teléfono, usá la búsqueda avanzada.';
    } else if (casos.estado === 'listo' && casos.total > casos.items.length) {
        estado = `Se muestran ${casos.items.length} de ${casos.total.toLocaleString('es-AR')} casos: seguí escribiendo para afinar.`;
    } else if (opciones.length === 0) {
        estado = `Ninguna pantalla coincide con «${termino}».`;
    }

    const marcado = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1);
    let n = -1;

    return (
        <Dialog
            open
            onClose={onCerrar}
            fullWidth
            maxWidth="sm"
            aria-labelledby="buscador-global-titulo"
            sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
            PaperProps={{
                sx: {
                    mt: { xs: 1.5, sm: '12vh' },
                    mx: { xs: 1.5, sm: 4 },
                    width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' },
                    borderRadius: '16px',
                    overflow: 'hidden',
                },
            }}
        >
            <DialogTitle id="buscador-global-titulo" sx={visuallyHidden}>
                Buscar en AMSA Gestión
            </DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, borderBottom: 1, borderColor: 'divider', color: 'text.secondary' }}>
                <Search size={20} strokeWidth={1.75} aria-hidden />
                <InputBase
                    inputRef={entradaRef}
                    autoFocus
                    fullWidth
                    value={texto}
                    onChange={(e) => {
                        setTexto(e.target.value);
                        setActivo(0);
                    }}
                    onKeyDown={alTeclear}
                    placeholder={puedeCasos ? 'Buscar un caso o una pantalla' : 'Buscar una pantalla'}
                    inputProps={{
                        role: 'combobox',
                        'aria-label': puedeCasos ? 'Buscar un caso o una pantalla' : 'Buscar una pantalla',
                        'aria-expanded': opciones.length > 0,
                        'aria-controls': ID_LISTA,
                        'aria-autocomplete': 'list',
                        'aria-activedescendant': indice >= 0 ? idOpcion(indice) : undefined,
                        autoComplete: 'off',
                        spellCheck: false,
                    }}
                    sx={{ py: 1.75, fontSize: '1rem', color: 'text.primary' }}
                />
            </Box>

            <Typography
                role="status"
                variant="caption"
                component="div"
                color="text.secondary"
                sx={{ px: 2.5, pt: 1.25, pb: estado ? 0.5 : 0, minHeight: estado ? undefined : 0 }}
            >
                {estado}
            </Typography>

            <Box id={ID_LISTA} role="listbox" aria-label="Resultados" sx={{ maxHeight: { xs: '60vh', sm: '50vh' }, overflowY: 'auto', py: 1 }}>
                {grupos.map((g) => (
                    <Box key={g.id} role="group" aria-labelledby={`buscador-global-grupo-${g.id}`} sx={{ mb: 0.5 }}>
                        <Typography
                            id={`buscador-global-grupo-${g.id}`}
                            role="presentation"
                            component="div"
                            sx={{ px: 2.5, pt: 1, pb: 0.5, fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}
                        >
                            {g.titulo}
                        </Typography>
                        {g.opciones.map((op) => {
                            n += 1;
                            const i = n;
                            const sel = i === indice;
                            return (
                                <Box
                                    key={op.clave}
                                    id={idOpcion(i)}
                                    role="option"
                                    aria-selected={sel}
                                    data-tipo={op.tipo}
                                    onMouseMove={() => i !== indice && setActivo(i)}
                                    onClick={() => elegir(op)}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1.5,
                                        mx: 1,
                                        px: 1.5,
                                        py: 0.875,
                                        borderRadius: '10px',
                                        cursor: 'pointer',
                                        bgcolor: sel ? marcado : 'transparent',
                                    }}
                                >
                                    <Box
                                        sx={{
                                            width: 32,
                                            height: 32,
                                            flex: 'none',
                                            borderRadius: '8px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            bgcolor: 'action.hover',
                                            color: sel ? 'primary.main' : 'text.secondary',
                                        }}
                                    >
                                        {op.tipo === 'pantalla' && <IconoNav nombre={op.icono} size={18} />}
                                        {op.tipo === 'caso' && <UserRound size={18} strokeWidth={1.75} aria-hidden />}
                                        {op.tipo === 'avanzada' && <FileSearch size={18} strokeWidth={1.75} aria-hidden />}
                                    </Box>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography variant="body2" fontWeight={500} noWrap>
                                            {op.titulo}
                                        </Typography>
                                        {op.detalle && (
                                            <Typography variant="caption" component="div" color="text.secondary" noWrap>
                                                {op.detalle}
                                            </Typography>
                                        )}
                                    </Box>
                                    {sel && (
                                        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
                                            <CornerDownLeft size={16} strokeWidth={1.75} aria-hidden />
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}
                    </Box>
                ))}
            </Box>

            <Box
                aria-hidden
                sx={{ display: { xs: 'none', sm: 'flex' }, gap: 2, px: 2.5, py: 1, borderTop: 1, borderColor: 'divider', color: 'text.secondary', fontSize: '0.75rem' }}
            >
                <span>↑ ↓ para moverte</span>
                <span>Enter para abrir</span>
                <span>Esc para cerrar</span>
            </Box>
        </Dialog>
    );
};

/**
 * Hay algo modal abierto (un diálogo, la ayuda "?", amaIA en pantallas chicas, un menú o un Select desplegado): el atajo
 * no le abre el buscador encima. Los cajones que quedan montados cerrados (`keepMounted`) llevan `MuiModal-hidden`.
 */
const hayOtroModal = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.MuiModal-root, [role="dialog"]')).some((m) => {
        const raiz = m.closest<HTMLElement>('.MuiModal-root') ?? m;
        return !raiz.classList.contains('MuiModal-hidden') && raiz.style.visibility !== 'hidden';
    });

/**
 * El buscador de la barra superior: pantallas del menú (según los permisos) y casos, con la misma búsqueda que
 * Gestión (`GET /deudores?search=`). Se abre con un clic o con Ctrl+K / Cmd+K desde cualquier pantalla.
 * Para número de cliente, teléfono o mail lleva a la búsqueda avanzada de siempre.
 */
const BuscadorGlobal: React.FC = () => {
    const theme = useTheme();
    // Debajo de `md` va solo el ícono: en una tablet la barra no tiene lugar para el campo y el chip de importaciones.
    const chico = useMediaQuery(theme.breakpoints.down('md'));
    const navigate = useNavigate();
    const { tienePermiso } = useAuth();
    const puedeCasos = tienePermiso('deudores.ver');
    const [abierto, setAbierto] = useState(false);
    const [avanzada, setAvanzada] = useState(false);
    const etiqueta = puedeCasos ? 'Buscar un caso o una pantalla' : 'Buscar una pantalla';

    useEffect(() => {
        if (abierto || avanzada) return;
        const alTeclear = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
            if (hayOtroModal()) return;
            e.preventDefault();
            setAbierto(true);
        };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, [abierto, avanzada]);

    const abrir = () => setAbierto(true);

    return (
        <>
            {chico ? (
                <Tooltip title="Buscar">
                    <IconButton onClick={abrir} aria-label={etiqueta} aria-keyshortcuts="Control+K Meta+K" sx={{ color: 'text.secondary', width: 40, height: 40 }}>
                        <Search size={20} strokeWidth={1.75} aria-hidden />
                    </IconButton>
                </Tooltip>
            ) : (
                <ButtonBase
                    onClick={abrir}
                    aria-label={etiqueta}
                    aria-keyshortcuts="Control+K Meta+K"
                    sx={{
                        width: '100%',
                        maxWidth: { md: 560 },
                        height: 40,
                        justifyContent: 'flex-start',
                        gap: 1.25,
                        px: 1.5,
                        borderRadius: '12px',
                        border: 1,
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                        color: 'text.secondary',
                        transition: theme.transitions.create('border-color', { duration: theme.transitions.duration.shortest }),
                        '&:hover': { borderColor: 'primary.main' },
                        '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                    }}
                >
                    <Search size={18} strokeWidth={1.75} aria-hidden />
                    <Typography variant="body2" color="inherit" noWrap sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        {etiqueta}
                    </Typography>
                    <Box
                        component="kbd"
                        aria-hidden
                        sx={{
                            flex: 'none',
                            fontFamily: 'inherit',
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            lineHeight: 1,
                            px: 0.875,
                            py: 0.625,
                            borderRadius: '6px',
                            border: 1,
                            borderColor: 'divider',
                            bgcolor: 'background.default',
                            color: 'text.secondary',
                        }}
                    >
                        {ATAJO}
                    </Box>
                </ButtonBase>
            )}

            {abierto && (
                <DialogoBuscador
                    onCerrar={() => setAbierto(false)}
                    onAvanzada={() => {
                        setAbierto(false);
                        setAvanzada(true);
                    }}
                />
            )}
            {puedeCasos && (
                <BuscadorAvanzadoModal
                    open={avanzada}
                    onClose={() => setAvanzada(false)}
                    onSelectDeudor={(id) => {
                        setAvanzada(false);
                        navigate(linkCaso(id));
                    }}
                />
            )}
        </>
    );
};

export default BuscadorGlobal;
