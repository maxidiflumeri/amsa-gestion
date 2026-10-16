import React from 'react';
import { Box, LinearProgress, Tooltip, Typography } from '@mui/material';
import { StatusChip } from '../../ui';
import type { HistorialItemDto } from '../../../types/importHistorial';
import { barraIndeterminada, formatearNumero, motivoNoRetomablePorCorte, plural } from '../../../utils/estadoCarga';
import { estadoParaHistorial } from '../../../utils/historialImportaciones';
import ReversionEstado from '../ReversionEstado';

/** Columna «Importación»: nombre, número, corte, lugar en la división y nombre del archivo si se guardó. */
export function CeldaImportacion({ item }: { item: HistorialItemDto }) {
    const c = item.carga;
    const archivos = Array.isArray(item.archivos) ? item.archivos.filter((a) => typeof a === 'string' && a !== '') : [];
    const nombreArchivo = archivos.length === 0 ? null : archivos.length === 1 ? archivos[0] : `${archivos[0]} y ${archivos.length - 1} ${plural(archivos.length - 1, 'más', 'más')}`;
    return (
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{item.nombre}</Typography>
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                <Typography variant="caption" color="primary" fontWeight="bold">#{item.numeroRemesa}</Typography>
                {item.corte != null && item.corte !== '' && (
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{item.corte}</Typography>
                )}
            </Box>
            {c.grupoId != null && c.grupoOrden != null && c.grupoTotal != null && (
                <Typography variant="caption" color="text.secondary" display="block">
                    Remesa {c.grupoOrden} de {c.grupoTotal} de una carga dividida
                </Typography>
            )}
            {nombreArchivo !== null && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: 'anywhere' }}>
                    {nombreArchivo}
                </Typography>
            )}
        </Box>
    );
}

/** Columna "Estado": el chip con el estado real, su segunda línea, la barra si está en curso y por qué no se puede retomar. */
export function CeldaEstado({ item }: { item: HistorialItemDto }) {
    const e = estadoParaHistorial(item);
    const c = item.carga;
    const porCorte = c.terminal ? motivoNoRetomablePorCorte(c) : null;
    const chip = <StatusChip status={e.status} label={e.etiqueta} />;
    return (
        <Box sx={{ minWidth: 0 }}>
            {e.tooltip !== null ? <Tooltip title={e.tooltip}><span>{chip}</span></Tooltip> : chip}
            {c.enCurso && (
                <LinearProgress
                    variant={barraIndeterminada(c) ? 'indeterminate' : 'determinate'}
                    value={Number.isFinite(c.progreso) ? c.progreso : 0}
                    sx={{ mt: 0.75, height: 4, borderRadius: 2, maxWidth: 160 }}
                />
            )}
            {e.secundaria !== null && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {e.secundaria}
                </Typography>
            )}
            {porCorte !== null && (
                <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {porCorte}
                </Typography>
            )}
            {item.reversion != null && (
                <Box sx={{ mt: 0.75 }}>
                    <ReversionEstado reversion={item.reversion} variante="fila" />
                </Box>
            )}
        </Box>
    );
}

/** Columna «Filas»: procesadas / ok / con error de una carga terminada; «—» en cualquier otro caso. */
export function CeldaFilas({ item }: { item: HistorialItemDto }) {
    const c = item.carga;
    if (!c.terminal) return <Typography variant="body2" color="text.secondary">—</Typography>;
    const multiclaves = item.categoria === 'MULTICLAVES';
    const piso = c.resultado === 'FALLIDA' && c.cancelada !== true && c.interrumpidaPorReinicio !== true;
    const titulo = `${multiclaves ? 'Trámites: total / válidos / rechazados' : 'Filas: total / OK / con error'}${piso ? '. En una carga fallida son un piso.' : ''}`;
    return (
        <Tooltip title={titulo}>
            <Typography variant="body2" component="span">
                {formatearNumero(c.procesadas)} /{' '}
                <Typography component="span" color="success.main" variant="body2">{formatearNumero(c.ok)}</Typography> /{' '}
                <Typography component="span" color="error.main" variant="body2">{formatearNumero(c.err)}</Typography>
            </Typography>
        </Tooltip>
    );
}
