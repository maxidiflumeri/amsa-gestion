import React, { useEffect, useRef, useState } from 'react';
import {
    alpha, Alert, Box, Button, Chip, CircularProgress, Collapse, Link as MuiLink, Stack, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { asistenteApi } from '../../api/asistente';
import type { EstadoMapeo, FilaMapeo, TarjetaPropuesta as Tarjeta, VistaPreviaPropuesta } from '../../types/asistente';
import Markdown from '../../pages/ayuda/Markdown';

interface Props {
    propuesta: Tarjeta;
    /** La tarjeta se escribió en esta sesión (no viene del historial): si es la vigente, pide sola la vista previa. */
    enVivo: boolean;
    /** Hay una respuesta escribiéndose: los botones y las sugerencias esperan. */
    ocupado: boolean;
    onAbrir: (p: Tarjeta) => void;
    onAjustar: () => void;
    onSugerencia: (texto: string) => void;
}

const FORMATOS: Record<Tarjeta['formato'], string> = { xlsx: 'Excel', csv: 'CSV', txt: 'TXT', pdf: 'PDF' };
const FILAS_VISIBLES = 5;
const MAX_AVISOS = 3;

const entero = (n: number) => n.toLocaleString('es-AR');

const ESTADOS: Record<EstadoMapeo, { nombre: string; color: 'success' | 'warning' | 'info' | 'disabled'; icono: React.ElementType }> = {
    exacta: { nombre: 'Encontrada', color: 'success', icono: CheckCircleIcon },
    aproximada: { nombre: 'Aproximada', color: 'warning', icono: WarningAmberIcon },
    sin_campo: { nombre: 'Sin campo', color: 'disabled', icono: RemoveCircleOutlineIcon },
    agregada: { nombre: 'Agregada', color: 'info', icono: AddCircleOutlineIcon },
};

const IconoEstado: React.FC<{ estado: EstadoMapeo }> = ({ estado }) => {
    const { icono: Icono, color, nombre } = ESTADOS[estado];
    return <Icono color={color} titleAccess={nombre} sx={{ fontSize: 18, flex: 'none' }} />;
};

/** «Sale de» con el formato en un chip chico. */
const SaleDe: React.FC<{ fila: FilaMapeo }> = ({ fila }) => (
    <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" color={fila.estado === 'sin_campo' ? 'text.disabled' : 'text.primary'} sx={{ overflowWrap: 'anywhere' }}>{fila.saleDe}</Typography>
        {fila.formato && <Chip size="small" variant="outlined" label={fila.formato} sx={{ mt: 0.25, height: 20, maxWidth: '100%', '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }} />}
    </Box>
);

const Mapeo: React.FC<{ filas: FilaMapeo[]; lista: boolean }> = ({ filas, lista }) => {
    const [todas, setTodas] = useState(false);
    const hayMas = filas.length > FILAS_VISIBLES + 1;
    const visibles = hayMas && !todas ? filas.slice(0, FILAS_VISIBLES) : filas;
    const ocultas = filas.length - FILAS_VISIBLES;

    const nombreDe = (f: FilaMapeo) => f.columnaEjemplo ?? f.label;
    const detalle = (f: FilaMapeo) => (f.estado === 'aproximada' && f.nota
        ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{f.nota}</Typography>
        : null);

    return (
        <Box sx={{ minWidth: 0 }}>
            {lista ? (
                <Stack component="ul" spacing={1} data-testid="mapeo-lista" sx={{ listStyle: 'none', m: 0, p: 0, minWidth: 0 }}>
                    {visibles.map((f, i) => (
                        <Stack component="li" key={`${i}-${f.label}`} direction="row" spacing={1} data-estado={f.estado} sx={{ minWidth: 0 }}>
                            <Box sx={{ pt: '2px' }}><IconoEstado estado={f.estado} /></Box>
                            <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                    <strong>{nombreDe(f)}</strong> → {f.saleDe}
                                </Typography>
                                {f.formato && <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{f.formato}</Typography>}
                                {detalle(f)}
                            </Box>
                        </Stack>
                    ))}
                </Stack>
            ) : (
                <TableContainer>
                    <Table size="small" aria-label="Tu columna y de dónde sale" data-testid="mapeo-tabla" sx={{ tableLayout: 'fixed' }}>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ width: '42%', px: 0.5 }}>Tu columna</TableCell>
                                <TableCell sx={{ px: 0.5 }}>Sale de</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {visibles.map((f, i) => (
                                <TableRow key={`${i}-${f.label}`} data-estado={f.estado}>
                                    <TableCell sx={{ px: 0.5, verticalAlign: 'top' }}>
                                        <Stack direction="row" spacing={0.75} alignItems="flex-start" sx={{ minWidth: 0 }}>
                                            <Tooltip title={f.estado === 'aproximada' && f.nota ? f.nota : ESTADOS[f.estado].nombre}>
                                                <Box sx={{ pt: '2px', display: 'flex' }}><IconoEstado estado={f.estado} /></Box>
                                            </Tooltip>
                                            <Typography variant="body2" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>{nombreDe(f)}</Typography>
                                        </Stack>
                                    </TableCell>
                                    <TableCell sx={{ px: 0.5, verticalAlign: 'top' }}><SaleDe fila={f} />{detalle(f)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
            {hayMas && (
                <Button size="small" onClick={() => setTodas((t) => !t)} aria-expanded={todas} sx={{ mt: 0.5 }}>
                    {todas ? 'Ver menos columnas' : `y ${ocultas} columnas más`}
                </Button>
            )}
        </Box>
    );
};

/** Las filas de muestra, ya enmascaradas por el backend. Scroll horizontal propio: la tabla no ensancha el panel. */
const TablaVistaPrevia: React.FC<{ vista: VistaPreviaPropuesta }> = ({ vista }) => (
    <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, maxWidth: '100%' }} data-testid="vista-previa-tabla">
        <Table size="small" aria-label="Vista previa de la propuesta" sx={{ minWidth: 'max-content' }}>
            <TableHead>
                <TableRow>{vista.columnas.map((c) => <TableCell key={c} sx={{ whiteSpace: 'nowrap', fontSize: '0.7rem', color: 'text.secondary', bgcolor: 'action.hover' }}>{c}</TableCell>)}</TableRow>
            </TableHead>
            <TableBody>
                {vista.filas.map((fila, i) => (
                    <TableRow key={i}>
                        {vista.columnas.map((c) => <TableCell key={c} sx={{ whiteSpace: 'nowrap', fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums' }}>{fila[c] ?? ''}</TableCell>)}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </TableContainer>
);

/**
 * La propuesta del asistente (docs/asistente-reportes-spec.md §16.2, maqueta v2). Muestra cómo quedó cada columna, los filtros, el
 * formato y una vista previa con los datos enmascarados. No guarda nada: «Abrir en el editor» lleva a revisarla y guardarla.
 * Una versión vieja se achica a una línea.
 */
const TarjetaPropuesta: React.FC<Props> = ({ propuesta: p, enVivo, ocupado, onAbrir, onAjustar, onSugerencia }) => {
    const theme = useTheme();
    const celular = useMediaQuery(theme.breakpoints.down('sm'));
    const [vista, setVista] = useState<VistaPreviaPropuesta | null>(null);
    const [cargandoVista, setCargandoVista] = useState(false);
    const [fallo, setFallo] = useState(false);
    const [verAvisos, setVerAvisos] = useState(false);
    const pedida = useRef(false);

    const pedirVista = () => {
        if (pedida.current) return;
        pedida.current = true;
        setCargandoVista(true);
        setFallo(false);
        asistenteApi.vistaPrevia(p.propuestaId, FILAS_VISIBLES)
            .then((v) => setVista(v))
            .catch(() => setFallo(true))
            .finally(() => { setCargandoVista(false); pedida.current = false; });
    };

    // La vigente de esta sesión pide la vista previa sola. Las demás (y todo lo que viene del historial) esperan al botón:
    // mirar una conversación vieja no debería pegarle a la base.
    const automatica = enVivo && p.vigente;
    useEffect(() => {
        if (automatica && !vista) pedirVista();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [automatica, p.propuestaId]);

    if (!p.vigente) {
        return (
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" data-testid="tarjeta-propuesta-vieja" sx={{ mt: 1.25, minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>Versión {p.version} · «{p.nombre}»</Typography>
                <Button size="small" onClick={() => onAbrir(p)} disabled={ocupado}>{p.estado === 'guardada' ? 'Ver la plantilla' : 'Abrir esta versión'}</Button>
            </Stack>
        );
    }

    const sinFiltros = p.filtros.length === 0;
    const casos = vista?.casos ?? p.casos;
    const avisos = verAvisos ? p.avisos : p.avisos.slice(0, MAX_AVISOS);
    const formato = [FORMATOS[p.formato], ...p.opciones].join(' · ');

    return (
        <Box data-testid="tarjeta-propuesta" data-propuesta={p.propuestaId} sx={{ mt: 1.25, minWidth: 0 }}>
            {p.version > 1 && <Typography variant="caption" color="text.secondary">Versión {p.version}</Typography>}
            <Typography variant="subtitle2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{p.nombre}</Typography>
            {p.descripcion && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{p.descripcion}</Typography>}
            {p.mensaje.trim() !== '' && <Box sx={{ mt: 0.75 }}><Markdown texto={p.mensaje} compacto /></Box>}

            <Box sx={{ mt: 1 }}><Mapeo filas={p.mapeo} lista={celular} /></Box>

            <Box sx={{ mt: 1.25 }}>
                {sinFiltros ? (
                    <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />} sx={{ py: 0 }}>Sin filtros: trae todas las carteras</Alert>
                ) : (
                    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}><strong>Filtros:</strong> {p.filtros.join(' · ')}</Typography>
                )}
                {p.orden.length > 0 && <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mt: 0.5 }}><strong>Orden:</strong> {p.orden.join(' · ')}</Typography>}
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mt: 0.5 }}><strong>Formato:</strong> {formato}</Typography>
            </Box>

            <Box sx={{ mt: 1.25, minWidth: 0 }}>
                {vista && !vista.error && vista.filas.length > 0 && <TablaVistaPrevia vista={vista} />}
                {cargandoVista && (
                    <Stack direction="row" spacing={1} alignItems="center" role="status"><CircularProgress size={14} /><Typography variant="caption" color="text.secondary">Armando la vista previa…</Typography></Stack>
                )}
                {vista?.error && <Typography variant="caption" color="text.secondary" role="status">{vista.error === 'TIMEOUT' ? 'La vista previa tardó demasiado.' : 'No se pudo armar la vista previa.'}</Typography>}
                {fallo && <Typography variant="caption" color="text.secondary" role="status">No se pudo armar la vista previa.</Typography>}
                {!vista && !cargandoVista && (
                    <Button size="small" variant="outlined" color="inherit" onClick={pedirVista}>{fallo ? 'Reintentar la vista previa' : 'Ver vista previa'}</Button>
                )}
                {vista && !cargandoVista && (vista.error || vista.filas.length === 0) && (
                    <Button size="small" variant="outlined" color="inherit" sx={{ ml: vista.error ? 1 : 0 }} onClick={() => { setVista(null); pedirVista(); }}>Volver a pedirla</Button>
                )}
                <Typography variant="body2" sx={{ mt: 0.75 }} data-testid="casos">
                    {casos === null ? 'No se pudo contar los casos a tiempo.' : (
                        <>La consulta completa trae <strong>{entero(casos)}</strong> casos{p.casosAproximado ? ' (aprox.)' : ''}</>
                    )}
                </Typography>
            </Box>

            {p.avisos.length > 0 && (
                <Stack spacing={0.75} sx={{ mt: 1.25 }}>
                    {avisos.map((a, i) => <Alert key={`${i}-${a}`} severity="warning" sx={{ py: 0, minWidth: 0, '& .MuiAlert-message': { overflowWrap: 'anywhere' } }}>{a}</Alert>)}
                    {p.avisos.length > MAX_AVISOS && (
                        <MuiLink component="button" type="button" variant="caption" onClick={() => setVerAvisos((v) => !v)} sx={{ alignSelf: 'flex-start' }}>
                            {verAvisos ? 'Ver menos avisos' : `Ver ${p.avisos.length - MAX_AVISOS} más`}
                        </MuiLink>
                    )}
                </Stack>
            )}

            <Stack
                spacing={1.25}
                data-testid="tarjeta-propuesta-accion"
                sx={{ mt: 1.5, p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'secondary.main', bgcolor: (t) => alpha(t.palette.secondary.main, 0.08), minWidth: 0 }}
            >
                {p.estado === 'guardada' ? (
                    <>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Guardada como «{p.nombre}»</Typography>
                        <Box><Button size="small" variant="contained" color="secondary" onClick={() => onAbrir(p)} disabled={ocupado}>Ver la plantilla</Button></Box>
                    </>
                ) : (
                    <>
                        <Box>
                            <Typography variant="body2" fontWeight={600}>
                                {p.estado === 'abierta' ? 'La abriste en el editor' : '¿La abro en el editor para que la revises y la guardes?'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">No guardo nada sin tu confirmación. En el editor podés cambiar lo que quieras.</Typography>
                        </Box>
                        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                            <Button size="small" variant="contained" color="secondary" onClick={() => onAbrir(p)} disabled={ocupado}>
                                {p.estado === 'abierta' ? 'Abrir de nuevo' : 'Abrir en el editor'}
                            </Button>
                            <Button size="small" variant="outlined" color="inherit" onClick={onAjustar} disabled={ocupado}>Ajustar algo antes</Button>
                        </Stack>
                    </>
                )}
            </Stack>

            <Collapse in={p.sugerencias.length > 0} unmountOnExit>
                <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} data-testid="sugerencias-propuesta" sx={{ mt: 1 }}>
                    {p.sugerencias.map((s) => (
                        <Chip key={s} label={s} size="small" variant="outlined" disabled={ocupado} onClick={() => onSugerencia(s)} sx={{ height: 'auto', maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }} />
                    ))}
                </Stack>
            </Collapse>
        </Box>
    );
};

export default TarjetaPropuesta;
