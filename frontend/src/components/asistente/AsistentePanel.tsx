import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    Alert, Box, Button, Chip, CircularProgress, Divider, Drawer, IconButton, ListItemText, ListSubheader, Menu, MenuItem,
    Stack, TextField, Toolbar, Tooltip, Typography, alpha, useMediaQuery, useTheme,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import { useAsistente, type MensajeVista } from '../../context/AsistenteContext';
import { useAuth } from '../../context/AuthContext';
import { usePageMeta } from '../../context/PageMetaContext';
import type { AccionIrA } from '../../types/asistente';
import MensajeBurbuja from './MensajeBurbuja';
import VisorAyudaInline from './VisorAyudaInline';
import { sugerenciasPara } from './sugerencias';

/**
 * Ancho del panel en escritorio. A partir de `xl` (1536 px) empuja la pantalla (no la tapa); por debajo, la tapa con un fondo:
 * con menos de 1536 px, al contenido le quedarían menos de ~1100 px y las pantallas eligen su diseño por el ancho de la ventana.
 */
const ANCHO = 420;
const MAX_CARACTERES = 2000;
const CONTADOR_DESDE = 1800;

const AsistentePanel: React.FC = () => {
    const theme = useTheme();
    const asistente = useAsistente();
    const { tienePermiso } = useAuth();
    const { title } = usePageMeta();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const celular = useMediaQuery(theme.breakpoints.down('sm'));
    const empuja = useMediaQuery(theme.breakpoints.up('xl'));

    const { disponible, abierto, cerrar, mensajes, enviando, bloqueo, aviso, conversaciones } = asistente;

    const [texto, setTexto] = useState('');
    const [visorSlug, setVisorSlug] = useState<string | null>(null);
    const [menuAncla, setMenuAncla] = useState<HTMLElement | null>(null);
    const entradaRef = useRef<HTMLTextAreaElement | null>(null);
    const chatRef = useRef<HTMLDivElement | null>(null);
    const pegadoAbajo = useRef(true);

    // Foco al compositor al abrir. El panel está montado aunque esté cerrado (visibility), así que se espera a que se muestre.
    useEffect(() => {
        if (!abierto) return;
        const t = setTimeout(() => entradaRef.current?.focus(), 120);
        return () => clearTimeout(t);
    }, [abierto]);

    // Sigue el final del chat mientras se escribe, salvo que la persona haya subido a releer.
    useLayoutEffect(() => {
        const el = chatRef.current;
        if (el && pegadoAbajo.current) el.scrollTop = el.scrollHeight;
    }, [mensajes, visorSlug, aviso, bloqueo]);

    const alScroll = useCallback(() => {
        const el = chatRef.current;
        if (el) pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }, []);

    const mandar = useCallback(async (valor: string) => {
        const pregunta = valor.trim();
        if (!pregunta || enviando || bloqueo) return;
        pegadoAbajo.current = true;
        setVisorSlug(null);
        setTexto('');
        const r = await asistente.enviar(pregunta);
        // El servidor no la aceptó (tope, límite, otra pestaña): lo escrito vuelve al compositor para no perderlo.
        if (r === 'rechazado') setTexto((actual) => (actual === '' ? pregunta : actual));
    }, [asistente, enviando, bloqueo]);

    if (!disponible) return null;

    const panelQuedaAbierto = empuja;
    const alNavegarAfuera = () => { if (!panelQuedaAbierto) cerrar(); };

    const responder = (m: MensajeVista, a: AccionIrA, resultado: 'aceptada' | 'rechazada') => {
        asistente.responderAccion(m.id, a, resultado);
        if (resultado === 'aceptada') alNavegarAfuera();
    };

    const abrirDocumentacion = (slug: string) => {
        navigate(`/ayuda/${slug}`);
        alNavegarAfuera();
    };

    const sugerencias = sugerenciasPara(pathname, tienePermiso);
    const ultimo = mensajes[mensajes.length - 1];
    const puedeEscribir = !bloqueo;
    const restantes = texto.length;

    const abrirMenu = (e: React.MouseEvent<HTMLElement>) => {
        setMenuAncla(e.currentTarget);
        void asistente.cargarConversaciones();
    };

    const contenido = (
        <Box
            sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, bgcolor: 'background.paper' }}
            onKeyDown={(e) => { if (e.key === 'Escape' && !menuAncla) cerrar(); }}
            role="complementary"
            aria-label="Asistente"
        >
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ width: 30, height: 30, borderRadius: 2.5, display: 'grid', placeItems: 'center', flex: 'none', color: 'secondary.main', bgcolor: (t) => alpha(t.palette.secondary.main, 0.14) }}>
                    <AutoAwesomeIcon fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="subtitle1" fontWeight={700} lineHeight={1.2} noWrap>Asistente</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>Ayuda de uso de la plataforma</Typography>
                </Box>
                <Tooltip title="Más opciones">
                    <IconButton size="small" onClick={abrirMenu} aria-label="Más opciones"><MoreVertIcon fontSize="small" /></IconButton>
                </Tooltip>
                <IconButton size="small" onClick={cerrar} aria-label="Cerrar el asistente"><CloseIcon fontSize="small" /></IconButton>
            </Stack>

            {title && (
                <Box sx={{ px: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Chip size="small" variant="outlined" label={`Estás en: ${title}`} sx={{ maxWidth: '100%' }} />
                </Box>
            )}

            <Menu anchorEl={menuAncla} open={!!menuAncla} onClose={() => setMenuAncla(null)}>
                <MenuItem onClick={() => { setMenuAncla(null); setVisorSlug(null); asistente.nuevaConversacion(); }}>Nueva conversación</MenuItem>
                <Divider />
                <ListSubheader sx={{ lineHeight: '32px' }}>Conversaciones anteriores</ListSubheader>
                {conversaciones === null && <MenuItem disabled><CircularProgress size={16} sx={{ mr: 1 }} />Cargando…</MenuItem>}
                {conversaciones !== null && conversaciones.length === 0 && <MenuItem disabled>Todavía no hay ninguna</MenuItem>}
                {(conversaciones ?? []).map((c) => (
                    <MenuItem key={c.id} onClick={() => { setMenuAncla(null); setVisorSlug(null); void asistente.abrirConversacion(c.id); }} sx={{ maxWidth: 'min(320px, 80vw)' }}>
                        <ListItemText primary={c.titulo} primaryTypographyProps={{ noWrap: true }} secondary={new Date(c.updatedAt).toLocaleDateString('es-AR')} />
                    </MenuItem>
                ))}
            </Menu>

            {visorSlug && (
                <VisorAyudaInline
                    slug={visorSlug}
                    onVolver={() => setVisorSlug(null)}
                    onCambiar={setVisorSlug}
                    onAbrirDocumentacion={abrirDocumentacion}
                />
            )}

            <Box
                ref={chatRef}
                onScroll={alScroll}
                // Región viva fija: el lector de pantalla anuncia la respuesta cuando termina (la burbuja que se escribe va en aria-busy).
                aria-live="polite"
                data-testid="chat-asistente"
                sx={{ display: visorSlug ? 'none' : 'flex', flexDirection: 'column', gap: 1.5, flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', p: 2 }}
            >
                {mensajes.length === 0 ? (
                    <Stack spacing={1.5}>
                        <Typography variant="body1" fontWeight={600}>Hola, ¿en qué te ayudo?</Typography>
                        <Typography variant="body2" color="text.secondary">Preguntame cómo se hace algo o dónde está cada cosa. Respondo con la Documentación de la plataforma.</Typography>
                        <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} data-testid="sugerencias">
                            {sugerencias.map((s) => (
                                <Chip key={s} label={s} variant="outlined" size="small" disabled={!puedeEscribir || enviando} onClick={() => void mandar(s)} sx={{ height: 'auto', maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }} />
                            ))}
                        </Stack>
                    </Stack>
                ) : (
                    mensajes.map((m) => (
                        <MensajeBurbuja
                            key={m.clave}
                            mensaje={m}
                            panelQuedaAbierto={panelQuedaAbierto}
                            puedeReintentar={m === ultimo && !enviando && !bloqueo}
                            onAbrirAyuda={setVisorSlug}
                            onResponderAccion={responder}
                            onCalificar={(id, valor, comentario) => void asistente.calificar(id, valor, comentario)}
                            onReintentar={asistente.reintentar}
                            onActualizar={asistente.actualizarConversacion}
                        />
                    ))
                )}
            </Box>

            {!visorSlug && (bloqueo || aviso) && (
            <Stack spacing={1} sx={{ px: 2, pt: 1 }}>
                {bloqueo && (
                    <Alert
                        severity={bloqueo.tipo === 'pausa' ? 'warning' : 'info'}
                        action={<Button color="inherit" size="small" onClick={asistente.volverAProbar}>Volver a probar</Button>}
                    >
                        {bloqueo.mensaje}
                    </Alert>
                )}
                {aviso && (
                    <Alert
                        severity="warning"
                        action={aviso.tipo !== 'turno' ? <Button color="inherit" size="small" onClick={() => { asistente.nuevaConversacion(); }}>Nueva conversación</Button> : undefined}
                    >
                        {aviso.mensaje}
                    </Alert>
                )}
            </Stack>
            )}

            <Box sx={{ px: 2, pt: 1, pb: 1, display: visorSlug ? 'none' : undefined }}>
                <Stack direction="row" spacing={1} alignItems="flex-end">
                    <TextField
                        inputRef={entradaRef}
                        value={texto}
                        onChange={(e) => setTexto(e.target.value.slice(0, MAX_CARACTERES))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                void mandar(texto);
                            }
                        }}
                        placeholder="Preguntá cómo hacer algo…"
                        multiline
                        minRows={1}
                        maxRows={5}
                        size="small"
                        fullWidth
                        disabled={!puedeEscribir}
                        inputProps={{ 'aria-label': 'Tu pregunta', maxLength: MAX_CARACTERES }}
                        sx={{ minWidth: 0 }}
                    />
                    {enviando ? (
                        <Button variant="outlined" color="inherit" startIcon={<StopIcon />} onClick={asistente.detener} sx={{ flex: 'none' }}>Detener</Button>
                    ) : (
                        <Tooltip title="Enviar">
                            <span>
                                <IconButton color="secondary" aria-label="Enviar" onClick={() => void mandar(texto)} disabled={!puedeEscribir || texto.trim() === ''} sx={{ flex: 'none' }}>
                                    <SendIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                    )}
                </Stack>
                {restantes >= CONTADOR_DESDE && (
                    <Typography variant="caption" color={restantes >= MAX_CARACTERES ? 'error' : 'text.secondary'} sx={{ display: 'block', textAlign: 'right' }}>
                        {restantes}/{MAX_CARACTERES}
                    </Typography>
                )}
            </Box>
            <Typography variant="caption" color="text.secondary" align="center" sx={{ px: 2, pb: 1.5 }}>
                Responde con la documentación de la plataforma y nunca hace cambios sin que confirmes.
            </Typography>
        </Box>
    );

    return (
        <>
            {/* Reserva el lugar del panel a la derecha: la pantalla se corre en vez de quedar tapada. */}
            {empuja && (
                <Box
                    aria-hidden
                    sx={{
                        flex: 'none',
                        width: abierto ? ANCHO : 0,
                        transition: theme.transitions.create('width', { duration: theme.transitions.duration.shorter }),
                    }}
                />
            )}
            <Drawer
                anchor="right"
                variant={empuja ? 'persistent' : 'temporary'}
                open={abierto}
                onClose={cerrar}
                ModalProps={{ keepMounted: true }}
                PaperProps={{ sx: { width: celular ? '100%' : ANCHO, maxWidth: '100%', borderLeft: '1px solid', borderColor: 'divider', backgroundImage: 'none' } }}
            >
                {/* El panel fijo queda debajo de la barra superior; el modal la tapa y no la necesita. */}
                {empuja && <Toolbar />}
                {contenido}
            </Drawer>
        </>
    );
};

export default AsistentePanel;
