import React from 'react';
import {
    Alert,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import MergeIcon from '@mui/icons-material/Merge';
import UndoIcon from '@mui/icons-material/Undo';
import ReplayIcon from '@mui/icons-material/Replay';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { BotonCancelarCarga } from '../ImportProgress';
import type { HistorialItemDto } from '../../../types/importHistorial';
import type { EstadoCargaDto } from '../../../types/importProgreso';
import { plural } from '../../../utils/estadoCarga';
import { textoEliminar, type AccionesDeFila } from '../../../utils/historialImportaciones';

interface PropsAcciones {
    item: HistorialItemDto;
    acciones: AccionesDeFila;
    ocupado: boolean;
    onVer: () => void;
    onAplicarCarga: (dto: EstadoCargaDto) => void;
    onCambio: () => void;
    onRetomar: () => void;
    onConfirmar: () => void;
    onConsolidar: () => void;
    onRevertir: () => void;
    onEliminar: () => void;
}

/** Los botones de una fila. Qué se ofrece lo decide `accionesDeFila`; acá solo se dibuja. */
export function AccionesHistorial({ item, acciones, ocupado, onVer, onAplicarCarga, onCambio, onRetomar, onConfirmar, onConsolidar, onRevertir, onEliminar }: PropsAcciones) {
    const theme = useTheme();
    const esCelular = useMediaQuery(theme.breakpoints.down('md'));
    return (
        <Box>
            <Box display="flex" justifyContent="center" gap={0.5} flexWrap="wrap">
                <Tooltip title={item.carga.err > 0 ? 'Ver Detalles y Errores' : 'Ver Progreso/Detalles'}>
                    <IconButton color="primary" size="small" aria-label="Ver detalle" onClick={onVer}>
                        <VisibilityIcon />
                    </IconButton>
                </Tooltip>

                {acciones.cancelar && (
                    <BotonCancelarCarga carga={item.carga} variante="icono" onResultado={onAplicarCarga} onGrupoCambio={onCambio} />
                )}

                {acciones.retomar && (
                    <Tooltip title="Retomar: volver a encolar la misma remesa">
                        <span>
                            <IconButton color="warning" size="small" aria-label="Retomar" disabled={ocupado} onClick={onRetomar}>
                                <ReplayIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}

                {acciones.confirmar && (
                    <Tooltip title="Confirmar: mandar a la cola lo que no se pudo encolar">
                        <span>
                            <IconButton color="success" size="small" aria-label="Confirmar" disabled={ocupado} onClick={onConfirmar}>
                                <PlayArrowIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}

                {acciones.consolidar && (
                    <Tooltip title="Consolidar situacion de deudores de esta remesa">
                        <span>
                            <IconButton color="secondary" size="small" aria-label="Consolidar" onClick={onConsolidar}>
                                <MergeIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}

                {acciones.revertir.visible && (
                    <Tooltip title={acciones.revertir.motivo ?? 'Revertir esta acción masiva'}>
                        <span>
                            <IconButton color="warning" size="small" aria-label="Revertir" disabled={acciones.revertir.deshabilitado} onClick={onRevertir}>
                                <UndoIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}

                {acciones.eliminar.visible && (
                    <Tooltip title={acciones.eliminar.motivo ?? 'Eliminar importación'}>
                        <span>
                            <IconButton color="error" size="small" aria-label="Eliminar" disabled={acciones.eliminar.deshabilitado} onClick={onEliminar}>
                                <DeleteIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                )}
            </Box>
            {/* En una pantalla táctil un tooltip sobre un botón deshabilitado no se ve: el motivo va escrito. */}
            {esCelular && acciones.motivos.length > 0 && (
                <Box sx={{ mt: 0.5 }} data-testid="motivos-acciones">
                    {acciones.motivos.map((m) => (
                        <Typography key={m} variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: 'anywhere' }}>
                            {m}
                        </Typography>
                    ))}
                </Box>
            )}
        </Box>
    );
}

/** Texto con `**negrita**`. */
function conNegrita(texto: string): React.ReactNode[] {
    return texto.split('**').map((parte, i) => (i % 2 === 1 ? <strong key={i}>{parte}</strong> : <React.Fragment key={i}>{parte}</React.Fragment>));
}

interface PropsEliminar {
    item: HistorialItemDto | null;
    eliminando: boolean;
    /** La fila cambió de estado desde que se abrió el diálogo. */
    cambio?: boolean;
    onCancelar: () => void;
    onConfirmar: () => void;
}

/** El diálogo de eliminar dice qué se elimina de verdad (§6.4). */
export function DialogoEliminarImportacion({ item, eliminando, cambio = false, onCancelar, onConfirmar }: PropsEliminar) {
    const texto = item ? textoEliminar(item) : null;
    return (
        <Dialog open={item !== null} onClose={() => !eliminando && onCancelar()}>
            <DialogTitle>{texto?.titulo}</DialogTitle>
            <DialogContent>
                {cambio && (
                    <Alert severity="warning" sx={{ mb: 1.5 }}>
                        La importación cambió mientras tenías abierto este diálogo. Leé de nuevo qué se va a eliminar.
                    </Alert>
                )}
                {texto?.parrafos.map((p, i) => (
                    <DialogContentText key={i} sx={{ mt: i > 0 ? 1.5 : 0 }}>{conNegrita(p)}</DialogContentText>
                ))}
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancelar} disabled={eliminando}>Cancelar</Button>
                <Button onClick={onConfirmar} color="error" variant="contained" disabled={eliminando}>
                    {eliminando ? 'Eliminando...' : (texto?.confirmar ?? 'Eliminar')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

interface PropsConfirmar {
    item: HistorialItemDto | null;
    enviando: boolean;
    onVolver: () => void;
    onConfirmar: () => void;
}

/** «Confirmar las que no se pudieron encolar» (§6.4): el borrador ya se había confirmado; la vista previa no se vuelve a mostrar. */
export function DialogoConfirmarPendientes({ item, enviando, onVolver, onConfirmar }: PropsConfirmar) {
    const p = item?.pendienteDeEncolar ?? null;
    const abierto = item !== null && p !== null;
    const remesas = p?.remesas ?? [];
    const n = remesas.length;
    const origen = p?.origen ?? [];
    const origenPerdido = origen.some((o) => o.numeroRemesa == null);
    const yaCargado = p?.yaCargadoEn ?? [];
    const conCorte = item?.corte != null && item.corte !== '';
    const bloqueada = origenPerdido || (yaCargado.length > 0 && conCorte);
    const numerosYa = yaCargado.map((r) => r.numeroRemesa).join(', ');
    return (
        <Dialog open={abierto} onClose={() => !enviando && onVolver()} maxWidth="sm" fullWidth>
            <DialogTitle>{n > 1 ? `Confirmar las ${n} importaciones` : 'Confirmar la importación'}</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    {n > 1 ? `Estas ${n} importaciones se confirmaron` : 'Esta importación se confirmó'} y la cola de trabajos no respondió: no se cargó nada.
                    Al confirmar se mandan a la cola tal como se habían confirmado; la vista previa no se vuelve a mostrar.
                </DialogContentText>
                <Box component="ul" sx={{ mt: 1.5, mb: 0, pl: 2.5 }}>
                    {remesas.map((r) => (
                        <li key={r.remesaId}>
                            <Typography variant="body2">Remesa {r.numeroRemesa}{r.corte ? ` — ${r.corte}` : ''}</Typography>
                        </li>
                    ))}
                </Box>
                {origen.length > 0 && (
                    <Typography variant="body2" sx={{ mt: 1.5 }}>
                        <strong>Remesa de origen:</strong>{' '}
                        {origen.map((o) => (o.numeroRemesa == null ? 'una remesa que ya no existe' : `${o.numeroRemesa}${o.nombre ? ` (${o.nombre})` : ''}`)).join(', ')}.
                    </Typography>
                )}
                {yaCargado.length > 0 && (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        Este archivo ya figura en {yaCargado.length > 1 ? 'las remesas' : 'la remesa'} {numerosYa}, que se {plural(yaCargado.length, 'confirmó', 'confirmaron')} después.
                        Si confirmás {n > 1 ? 'estas' : 'esta'}, se carga otra vez.
                    </Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onVolver} disabled={enviando}>Volver</Button>
                <Button onClick={onConfirmar} variant="contained" color={yaCargado.length > 0 ? 'warning' : 'primary'} disabled={enviando || bloqueada}>
                    {yaCargado.length > 0 && !conCorte ? 'Confirmar igual' : 'Confirmar'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
