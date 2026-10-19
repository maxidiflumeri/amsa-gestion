import React, { useState } from 'react';
import { alpha, Box, Button, CircularProgress, IconButton, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { AdjuntoPendiente } from '../../context/AsistenteContext';

interface Props {
    adjunto: AdjuntoPendiente;
    onQuitar: () => void;
    /** Solo si el servidor estaba ocupado (429 OCUPADO): vuelve a subir el mismo archivo. */
    onReintentar?: () => void;
    onPrimeraFila: (esEncabezado: boolean) => void;
}

/** «XLSX · ejemplo.xlsx · 9 columnas». Sirve también para el mensaje ya enviado (solo lectura). */
export const etiquetaAdjunto = (tipo: string, nombre: string, columnas: number) =>
    `${tipo.toUpperCase()} · ${nombre} · ${columnas} ${columnas === 1 ? 'columna' : 'columnas'}`;

/**
 * Un ejemplo adjunto en el compositor (docs/asistente-reportes-spec.md §16.1): progreso de subida, el error con el mensaje del
 * backend, y un menú para decir que la primera fila no es el encabezado o para quitarlo. Los avisos van debajo.
 */
const AdjuntoChip: React.FC<Props> = ({ adjunto, onQuitar, onReintentar, onPrimeraFila }) => {
    const [ancla, setAncla] = useState<HTMLElement | null>(null);
    const { estado, adjunto: datos } = adjunto;
    const error = estado === 'error';
    const subiendo = estado === 'subiendo';
    const texto = datos ? etiquetaAdjunto(datos.tipo, datos.nombre, datos.resumen.columnas) : adjunto.nombre;
    const conEncabezado = datos?.resumen.conEncabezado ?? true;

    return (
        <Box data-testid="adjunto-chip" data-estado={estado} sx={{ minWidth: 0 }}>
            <Stack
                direction="row"
                alignItems="center"
                spacing={0.75}
                sx={{
                    minWidth: 0,
                    pl: 1,
                    pr: 0.25,
                    py: 0.25,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: error ? 'error.main' : 'divider',
                    bgcolor: (t) => (error ? alpha(t.palette.error.main, 0.08) : 'background.paper'),
                }}
            >
                {subiendo ? (
                    <CircularProgress size={16} thickness={5} variant={adjunto.progreso > 0 && adjunto.progreso < 100 ? 'determinate' : 'indeterminate'} value={adjunto.progreso} aria-label="Subiendo" sx={{ flex: 'none' }} />
                ) : error ? (
                    <ErrorOutlineIcon color="error" sx={{ fontSize: 18, flex: 'none' }} />
                ) : (
                    <InsertDriveFileOutlinedIcon color="success" sx={{ fontSize: 18, flex: 'none' }} />
                )}
                <Typography variant="caption" fontWeight={600} sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                    {subiendo ? `Subiendo «${adjunto.nombre}»${adjunto.progreso > 0 ? ` · ${adjunto.progreso} %` : '…'}` : texto}
                </Typography>
                {!subiendo && (
                    <>
                        {error ? (
                            <Tooltip title="Quitar">
                                <IconButton size="small" aria-label={`Quitar ${adjunto.nombre}`} onClick={onQuitar}><CloseIcon fontSize="small" /></IconButton>
                            </Tooltip>
                        ) : (
                            <Tooltip title="Opciones del archivo">
                                <IconButton size="small" aria-label={`Opciones de ${adjunto.nombre}`} onClick={(e) => setAncla(e.currentTarget)}>
                                    <MoreVertIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                    </>
                )}
            </Stack>
            {error && adjunto.error && (
                <Typography variant="caption" color="error" role="alert" sx={{ display: 'block', mt: 0.25, overflowWrap: 'anywhere' }}>
                    {adjunto.error}
                    {adjunto.reintentable && onReintentar && <Button size="small" color="inherit" onClick={onReintentar} sx={{ ml: 1, py: 0, minWidth: 0 }}>Reintentar</Button>}
                </Typography>
            )}
            {datos?.avisos.map((a) => (
                <Stack key={a} direction="row" spacing={0.5} alignItems="flex-start" sx={{ mt: 0.25 }}>
                    <WarningAmberIcon color="warning" sx={{ fontSize: 14, mt: '2px', flex: 'none' }} />
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{a}</Typography>
                </Stack>
            ))}
            {datos && datos.resumen.encabezados.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, overflowWrap: 'anywhere' }}>
                    Columnas: {datos.resumen.encabezados.join(' · ')}{datos.resumen.columnas > datos.resumen.encabezados.length ? ' …' : ''}
                </Typography>
            )}
            <Menu anchorEl={ancla} open={!!ancla} onClose={() => setAncla(null)}>
                {/* El resumen no guarda la primera fila (privacidad): volver atrás no se puede, hay que subir el archivo de nuevo. */}
                {conEncabezado ? (
                    <MenuItem onClick={() => { setAncla(null); onPrimeraFila(false); }}>
                        <ListItemText primary="La primera fila no es el encabezado" />
                    </MenuItem>
                ) : (
                    <MenuItem disabled>
                        <ListItemText primary="Si la primera fila sí es el encabezado, volvé a subir el archivo" primaryTypographyProps={{ sx: { whiteSpace: 'normal' } }} />
                    </MenuItem>
                )}
                <MenuItem onClick={() => { setAncla(null); onQuitar(); }}>
                    <ListItemText primary="Quitar" />
                </MenuItem>
            </Menu>
        </Box>
    );
};

export default AdjuntoChip;
