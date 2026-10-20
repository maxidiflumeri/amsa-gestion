import React, { useId, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Collapse, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { DetalleRespuesta as Detalle, NodoDetalle } from '../../types/asistente';
import {
    anchoBarra, colorDeBarra, enParalelo, etiquetaNodo, formatearEntero, formatearMs, formatearUsd, lineaNavegador, nombreModelo,
    textoMotivo, tiempoParaLector,
} from './formatoDetalle';

/**
 * El detalle de una respuesta: los pasos que hizo el asistente, cuánto tardó y cuánto costó cada uno
 * (docs/asistente-detalle-spec.md §12). Solo lo dibuja quien tiene `asistente.ver_detalle`: el servidor no manda la clave a los demás.
 */

const OCULTO = {
    border: 0, clip: 'rect(0 0 0 0)', height: '1px', margin: '-1px', overflow: 'hidden', padding: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px',
} as const;

/** «≈» delante de lo que salió de un reparto, con el aviso para el lector de pantalla. */
const Aprox: React.FC = () => (
    <>
        <span aria-hidden>≈ </span>
        <Box component="span" sx={OCULTO}>aproximado </Box>
    </>
);

const costoDe = (n: NodoDetalle): string => formatearUsd(n.costoUsd);

/** Lo que dice el lector de pantalla de una fila: «Llamada 1, 6,1 segundos, USD 0,017». */
function etiquetaLector(n: NodoDetalle): string {
    const partes = [etiquetaNodo(n).replace(/≈\s*/g, 'aproximadamente ')];
    partes.push(n.sinTiempoPropio ? 'sin tiempo propio' : tiempoParaLector(n.ms));
    const costo = costoDe(n);
    if (costo) partes.push(`${n.estimado ? 'aproximadamente ' : ''}${costo}`);
    return partes.join(', ');
}

/** Las líneas chicas de debajo de la etiqueta: lo que hizo una herramienta, lo que leyó una espera, lo que devolvió. */
function lineasDe(n: NodoDetalle, padre: NodoDetalle | undefined, llamadaSiguiente: number | undefined): { texto: string; color?: string }[] {
    const lineas: { texto: string; color?: string }[] = [];
    if (n.tipo === 'herramienta') {
        const partes: string[] = [];
        if (n.descripcion) partes.push(n.descripcion);
        if (typeof n.tokensResultado === 'number') {
            partes.push(`≈ ${formatearEntero(n.tokensResultado)} tokens a la llamada ${llamadaSiguiente ?? 'siguiente'}`);
        }
        if (partes.length > 0) lineas.push({ texto: partes.join(' · '), color: n.estado === 'error' ? 'error.main' : n.estado === 'aviso' ? 'warning.main' : undefined });
    }
    if (n.tipo === 'espera') {
        const partes: string[] = [];
        if (typeof n.tokens === 'number') {
            const cache = padre?.uso?.cacheLectura;
            partes.push(`lee ${formatearEntero(n.tokens)} tokens`);
            if (typeof cache === 'number' && n.tokens > 0) partes.push(`${Math.round((cache / n.tokens) * 100)} % de caché`);
        }
        if (typeof n.msConexion === 'number') partes.push(`conexión a los ${formatearMs(n.msConexion)}`);
        if (typeof n.msPrimerEvento === 'number') partes.push(`primer dato a los ${formatearMs(n.msPrimerEvento)}`);
        if (partes.length > 0) lineas.push({ texto: partes.join(' · ') });
    }
    if (n.tipo === 'llamada' && n.sinDesglose) lineas.push({ texto: 'Esta llamada no se pudo desglosar en tramos.' });
    // Un detalle reconstruido (parcial) no tiene la fila de la espera: el tiempo queda en la llamada.
    if (n.tipo === 'razonamiento' && n.sinTiempoPropio) {
        const conEspera = (padre?.hijos ?? []).some((h) => h.tipo === 'espera');
        lineas.push({ texto: conEspera ? 'Su tiempo está dentro de la espera.' : 'Su tiempo está dentro de la llamada.' });
    }
    if (n.cortado) lineas.push({ texto: 'Quedó cortado a mitad.', color: 'warning.main' });
    return lineas;
}

interface NodoProps {
    nodo: NodoDetalle;
    padre?: NodoDetalle;
    paralelo: boolean;
    llamadaSiguiente?: number;
    totalMs: number;
}

/** Una fila del árbol: etiqueta, tiempo y costo, sus líneas chicas, la barra de la cascada y, si tiene, sus hijos. */
const Fila: React.FC<NodoProps> = ({ nodo, padre, paralelo, llamadaSiguiente, totalMs }) => {
    const hijos = Array.isArray(nodo.hijos) ? nodo.hijos : [];
    const [abierto, setAbierto] = useState(nodo.tipo === 'llamada' || nodo.tipo === 'herramienta');
    const idHijos = useId();
    const etiqueta = etiquetaNodo(nodo) + (paralelo ? ' · en paralelo' : '');
    const costo = costoDe(nodo);
    const { izquierda, ancho } = anchoBarra(nodo, totalMs);
    const lineas = lineasDe(nodo, padre, llamadaSiguiente);
    const paralelos = enParalelo(hijos);
    const siguientesLlamadas = hijos.map((_, i) => hijos.slice(i + 1).find((h) => h.tipo === 'llamada')?.numero);

    const textoEtiqueta = (
        <Typography component="span" variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left' }}>{etiqueta}</Typography>
    );

    return (
        <Box component="li" aria-label={etiquetaLector(nodo) + (paralelo ? ', en paralelo' : '')} sx={{ listStyle: 'none', minWidth: 0, py: 0.5 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', columnGap: 1, alignItems: 'baseline', minWidth: 0 }}>
                {hijos.length > 0 ? (
                    <ButtonBase
                        onClick={() => setAbierto((a) => !a)}
                        aria-expanded={abierto}
                        aria-controls={idHijos}
                        sx={{ justifyContent: 'flex-start', alignItems: 'flex-start', gap: 0.25, minWidth: 0, textAlign: 'left', borderRadius: 0.5 }}
                    >
                        {abierto ? <ExpandMoreIcon fontSize="small" aria-hidden /> : <ChevronRightIcon fontSize="small" aria-hidden />}
                        {textoEtiqueta}
                    </ButtonBase>
                ) : (
                    <Box sx={{ minWidth: 0, pl: 2.75 }}>{textoEtiqueta}</Box>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', textAlign: 'right', minWidth: 48 }}>
                    {nodo.sinTiempoPropio ? '—' : formatearMs(nodo.ms)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', textAlign: 'right', minWidth: 64 }}>
                    {costo && (<>{nodo.estimado && <Aprox />}{costo}</>)}
                </Typography>
            </Box>
            {lineas.map((l) => (
                <Typography key={l.texto} variant="caption" color={l.color ?? 'text.secondary'} sx={{ display: 'block', pl: 2.75, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {l.texto}
                </Typography>
            ))}
            <Box aria-hidden sx={{ position: 'relative', height: 4, mt: 0.5, ml: 2.75, borderRadius: 1, bgcolor: 'action.hover', minWidth: 0 }}>
                <Box
                    sx={{
                        position: 'absolute', top: 0, bottom: 0, left: `${izquierda}%`, width: `${ancho}%`, minWidth: '2px', borderRadius: 1,
                        bgcolor: colorDeBarra(nodo.tipo), ...(nodo.cortado ? { border: '1px solid', borderColor: 'warning.main' } : {}),
                    }}
                />
            </Box>
            {hijos.length > 0 && (
                <Collapse in={abierto} unmountOnExit>
                    <Box component="ul" id={idHijos} sx={{ m: 0, p: 0, pl: 1.5, minWidth: 0 }}>
                        {hijos.map((h, i) => (
                            <Fila key={`${h.tipo}-${i}`} nodo={h} padre={nodo} paralelo={paralelos[i]} llamadaSiguiente={siguientesLlamadas[i]} totalMs={totalMs} />
                        ))}
                    </Box>
                </Collapse>
            )}
        </Box>
    );
};

interface Props {
    detalle: Detalle;
    abiertoInicial?: boolean;
}

const DetalleRespuesta: React.FC<Props> = ({ detalle, abiertoInicial = false }) => {
    const [abierto, setAbierto] = useState(abiertoInicial);
    const idCuerpo = useId();
    const nodos = Array.isArray(detalle.nodos) ? detalle.nodos : [];
    const total = formatearMs(detalle.totalMs);
    const costo = formatearUsd(detalle.costoUsd);
    const motivo = textoMotivo(detalle.estado, detalle.motivo, detalle.totalMs);
    const colorMotivo = detalle.motivo === null ? 'text.secondary'
        : detalle.estado === 'error' ? 'error.main'
            : detalle.estado === 'cortado' || detalle.estado === 'rechazado' ? 'warning.main' : 'text.secondary';
    const paralelos = enParalelo(nodos);
    const siguientesLlamadas = nodos.map((_, i) => nodos.slice(i + 1).find((h) => h.tipo === 'llamada')?.numero);
    const navegador = lineaNavegador(detalle.navegador);

    return (
        <Box sx={{ mt: 1, minWidth: 0 }} data-testid="detalle-respuesta">
            <Button
                size="small"
                variant="text"
                onClick={() => setAbierto((a) => !a)}
                aria-expanded={abierto}
                aria-controls={idCuerpo}
                startIcon={abierto ? <ExpandMoreIcon /> : <ChevronRightIcon />}
                sx={{ textTransform: 'none', textAlign: 'left', justifyContent: 'flex-start', maxWidth: '100%', minWidth: 0 }}
            >
                {`Ver detalle${detalle.parcial ? ' (parcial)' : ''} · ${total}${costo ? ` · ${costo}` : ''}`}
            </Button>
            <Collapse in={abierto} unmountOnExit>
                <Box id={idCuerpo} sx={{ mt: 0.5, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                        {`Total ${total}${costo ? ` · ${costo}` : ''} · ${nombreModelo(detalle.modelo)} · `}
                        <Box component="span" sx={{ color: colorMotivo }}>{motivo}</Box>
                    </Typography>
                    <Stack spacing={0.5} sx={{ my: 0.5 }}>
                        {detalle.parcial && (
                            <Alert severity="info" sx={{ py: 0, minWidth: 0 }}>
                                Detalle parcial: solo las llamadas al modelo. Pasa con las respuestas de antes de que se midieran los pasos, o si no se pudo guardar el detalle.
                            </Alert>
                        )}
                        {detalle.incompleto && <Alert severity="info" sx={{ py: 0, minWidth: 0 }}>Falta una parte del detalle: no se pudo medir todo.</Alert>}
                        {detalle.recortado && <Alert severity="info" sx={{ py: 0, minWidth: 0 }}>El detalle es muy largo: se muestran los primeros pasos.</Alert>}
                        {detalle.motivo === 'respuesta_vacia' && <Alert severity="info" sx={{ py: 0, minWidth: 0 }}>El modelo no devolvió texto: se mostró el aviso de reemplazo.</Alert>}
                    </Stack>
                    <Box component="ul" sx={{ m: 0, p: 0, minWidth: 0 }}>
                        {nodos.map((n, i) => (
                            <Fila key={`${n.tipo}-${i}`} nodo={n} paralelo={paralelos[i]} llamadaSiguiente={siguientesLlamadas[i]} totalMs={detalle.totalMs} />
                        ))}
                    </Box>
                    {navegador && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>{navegador}</Typography>
                    )}
                </Box>
            </Collapse>
        </Box>
    );
};

export default DetalleRespuesta;
