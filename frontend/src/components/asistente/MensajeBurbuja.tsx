import React, { useState } from 'react';
import { alpha, Alert, Box, Button, Chip, IconButton, Link as MuiLink, Stack, TextField, Tooltip, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ThumbDownOutlinedIcon from '@mui/icons-material/ThumbDownOutlined';
import type { MensajeVista } from '../../context/AsistenteContext';
import type { AccionIrA } from '../../types/asistente';
import Markdown from '../../pages/ayuda/Markdown';
import { buscarPagina } from '../../pages/ayuda/contenido';
import TarjetaIrA from './TarjetaIrA';

interface Props {
    mensaje: MensajeVista;
    panelQuedaAbierto: boolean;
    /** Solo el último mensaje con error ofrece «Reintentar». */
    puedeReintentar: boolean;
    onAbrirAyuda: (slug: string) => void;
    onResponderAccion: (mensaje: MensajeVista, accion: AccionIrA, resultado: 'aceptada' | 'rechazada') => void;
    onCalificar: (mensajeId: number, valor: 1 | -1 | 0, comentario?: string) => void;
    onReintentar: () => void;
    /** Recarga la conversación: la respuesta que quedó «escribiéndose» en el servidor puede haber terminado. */
    onActualizar: () => void;
}

/** `/ayuda/gestion/pagos-y-promesas#algo` → `gestion/pagos-y-promesas`, solo si esa página existe. */
function slugConocido(href: string): string | null {
    if (!href.startsWith('/ayuda/')) return null;
    const slug = href.slice('/ayuda/'.length).split(/[?#]/)[0].replace(/\/$/, '');
    return buscarPagina(slug) ? slug : null;
}

const MensajeBurbuja: React.FC<Props> = ({ mensaje, panelQuedaAbierto, puedeReintentar, onAbrirAyuda, onResponderAccion, onCalificar, onReintentar, onActualizar }) => {
    const [pidiendoComentario, setPidiendoComentario] = useState(false);
    const [comentario, setComentario] = useState('');
    const [comentarioEnviado, setComentarioEnviado] = useState(false);

    if (mensaje.rol === 'usuario') {
        return (
            <Box
                sx={{
                    alignSelf: 'flex-end',
                    maxWidth: '92%',
                    minWidth: 0,
                    px: 1.5,
                    py: 1,
                    borderRadius: '14px 14px 4px 14px',
                    border: '1px solid',
                    borderColor: (t) => alpha(t.palette.primary.main, 0.3),
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                }}
            >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{mensaje.texto}</Typography>
            </Box>
        );
    }

    const escribiendo = mensaje.estado === 'en_curso';
    // Una conversación abierta cuya última respuesta el servidor todavía tiene en curso: acá no hay nada llegando por el stream.
    const enOtraPestania = escribiendo && !!mensaje.recuperada;
    const terminado = mensaje.estado === 'ok' || mensaje.estado === 'cortado';
    const puedeCalificar = terminado && mensaje.id > 0;
    const sinTexto = mensaje.texto.trim() === '';

    const enlace = (href: string, hijos: React.ReactNode) => {
        const slug = slugConocido(href);
        // Solo las páginas de la Documentación que existen son clicables. Un enlace inventado queda como texto.
        if (!slug) return <span>{hijos}</span>;
        return (
            <MuiLink component="button" type="button" onClick={() => onAbrirAyuda(slug)} sx={{ verticalAlign: 'baseline', textAlign: 'left', overflowWrap: 'anywhere' }}>
                {hijos}
            </MuiLink>
        );
    };

    const votarNegativo = () => {
        if (mensaje.calificacion === -1) {
            setPidiendoComentario(false);
            onCalificar(mensaje.id, 0);
            return;
        }
        setComentarioEnviado(false);
        setPidiendoComentario(true);
        onCalificar(mensaje.id, -1);
    };
    const votarPositivo = () => {
        setPidiendoComentario(false);
        onCalificar(mensaje.id, mensaje.calificacion === 1 ? 0 : 1);
    };
    const enviarComentario = () => {
        const texto = comentario.trim();
        if (texto) onCalificar(mensaje.id, -1, texto);
        setPidiendoComentario(false);
        setComentarioEnviado(!!texto);
        setComentario('');
    };

    return (
        <Box
            sx={{
                alignSelf: 'flex-start',
                maxWidth: '100%',
                minWidth: 0,
                width: '100%',
                px: 1.5,
                py: 1.25,
                borderRadius: '14px 14px 14px 4px',
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'action.hover',
            }}
            aria-busy={escribiendo}
            data-testid="burbuja-asistente"
        >
            {escribiendo && !enOtraPestania && sinTexto && (
                <Typography variant="body2" color="text.secondary" role="status">
                    {mensaje.actividad ?? 'Pensando…'}
                </Typography>
            )}
            {!sinTexto && <Markdown texto={mensaje.texto} compacto onEnlace={enlace} />}
            {enOtraPestania && (
                <Alert
                    severity="info"
                    sx={{ mt: sinTexto ? 0 : 1, minWidth: 0 }}
                    action={<Button color="inherit" size="small" onClick={onActualizar}>Actualizar</Button>}
                >
                    Esta respuesta todavía se está escribiendo
                </Alert>
            )}
            {escribiendo && !sinTexto && mensaje.actividad && (
                <Typography variant="caption" color="text.secondary" role="status" sx={{ display: 'block', mt: 0.5 }}>
                    {mensaje.actividad}
                </Typography>
            )}
            {mensaje.detenido && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: sinTexto ? 0 : 0.75 }}>
                    Detuviste la respuesta.
                </Typography>
            )}

            {mensaje.estado === 'error' && (
                <Alert
                    severity="error"
                    sx={{ mt: sinTexto ? 0 : 1, minWidth: 0 }}
                    action={puedeReintentar && !mensaje.errorDeTope ? <Button color="inherit" size="small" onClick={onReintentar}>Reintentar</Button> : undefined}
                >
                    {mensaje.errorTexto ?? 'No se pudo completar la respuesta.'}
                </Alert>
            )}

            {!escribiendo && mensaje.fuentes.length > 0 && (
                <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} sx={{ mt: 1 }}>
                    {mensaje.fuentes.map((f) => (
                        <Chip
                            key={f.slug}
                            size="small"
                            variant="outlined"
                            color="primary"
                            icon={<MenuBookIcon />}
                            label={`Ayuda · ${f.titulo}`}
                            onClick={() => onAbrirAyuda(f.slug)}
                            sx={{ maxWidth: '100%' }}
                        />
                    ))}
                </Stack>
            )}

            {!escribiendo && mensaje.acciones.map((a) => (
                <TarjetaIrA
                    key={a.id}
                    accion={a}
                    panelQuedaAbierto={panelQuedaAbierto}
                    onAceptar={() => onResponderAccion(mensaje, a, 'aceptada')}
                    onRechazar={() => onResponderAccion(mensaje, a, 'rechazada')}
                />
            ))}

            {puedeCalificar && (
                <Box sx={{ mt: 1 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                        <Tooltip title="Me sirvió">
                            <IconButton size="small" aria-label="Me sirvió" aria-pressed={mensaje.calificacion === 1} onClick={votarPositivo}>
                                {mensaje.calificacion === 1 ? <ThumbUpIcon fontSize="small" color="primary" /> : <ThumbUpOutlinedIcon fontSize="small" />}
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="No me sirvió">
                            <IconButton size="small" aria-label="No me sirvió" aria-pressed={mensaje.calificacion === -1} onClick={votarNegativo}>
                                {mensaje.calificacion === -1 ? <ThumbDownIcon fontSize="small" color="error" /> : <ThumbDownOutlinedIcon fontSize="small" />}
                            </IconButton>
                        </Tooltip>
                        {comentarioEnviado && <Typography variant="caption" color="text.secondary">Gracias por avisar.</Typography>}
                    </Stack>
                    {pidiendoComentario && (
                        <Stack spacing={1} sx={{ mt: 0.5 }}>
                            <TextField
                                size="small"
                                multiline
                                maxRows={4}
                                label="¿Qué faltó?"
                                value={comentario}
                                onChange={(e) => setComentario(e.target.value)}
                                inputProps={{ maxLength: 500 }}
                                fullWidth
                            />
                            <Stack direction="row" spacing={1}>
                                <Button size="small" variant="contained" onClick={enviarComentario} disabled={comentario.trim() === ''}>Enviar</Button>
                                <Button size="small" onClick={() => setPidiendoComentario(false)}>Ahora no</Button>
                            </Stack>
                        </Stack>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default MensajeBurbuja;
