import React, { useCallback, useEffect, useState } from 'react'
import {
    Box,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { SectionCard } from '../ui'
import { fechaDelCedente } from '../../utils/fechas'
import { multiclavesApi, ResumenLoteMulticlaves, TramiteSinCaso } from '../../api/multiclaves'
import { useNotify } from '../../hooks/useNotify'

// El importe llega como string (Decimal, spec §4.1): se convierte a number solo para mostrarlo acá,
// nunca para guardarlo ni compararlo — eso hubiera perdido precisión antes de esta pantalla.
const formatoMoneda = (v: string | null) =>
    v == null ? '—' : Number(v).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })

/**
 * Resumen de una carga MULTICLAVES en el detalle de la importación (spec §5.7). Todo se calcula
 * con queries al abrir la pantalla — "con caso" cambia solo cuando llega el CA.
 */
export default function MulticlavesLoteResumen({ remesaId }: { remesaId: number }) {
    const notify = useNotify()
    const [resumen, setResumen] = useState<ResumenLoteMulticlaves | null>(null)
    const [loading, setLoading] = useState(true)
    const [dialogoAbierto, setDialogoAbierto] = useState(false)

    useEffect(() => {
        let activo = true
        setLoading(true)
        multiclavesApi
            .resumenLote(remesaId)
            .then((r) => { if (activo) setResumen(r) })
            .catch((err) => notify.error(err))
            .finally(() => { if (activo) setLoading(false) })
        return () => { activo = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remesaId])

    if (loading || !resumen) return null

    return (
        <SectionCard title="Claves de pago" sx={{ mb: 3 }}>
            <Box display="flex" flexWrap="wrap" gap={1} mb={resumen.avisos.length ? 2 : 0}>
                <Chip label={`${resumen.claves.toLocaleString('es-AR')} claves`} size="small" variant="outlined" />
                <Chip label={`${resumen.vigentes.toLocaleString('es-AR')} vigentes`} color="success" size="small" variant="outlined" />
                {resumen.reemplazadasEnEsta > 0 && (
                    <Chip label={`${resumen.reemplazadasEnEsta.toLocaleString('es-AR')} ya reemplazadas`} size="small" variant="outlined" />
                )}
                {resumen.reemplazadasPorEsta > 0 && (
                    <Chip label={`reemplazó ${resumen.reemplazadasPorEsta.toLocaleString('es-AR')} anteriores`} color="warning" size="small" variant="outlined" />
                )}
                {resumen.soloTotal > 0 && (
                    <Chip
                        label={`${resumen.soloTotal.toLocaleString('es-AR')} solo TOTAL`}
                        size="small"
                        variant="outlined"
                        title="Trajeron una única clave, sin la de quita"
                    />
                )}
                <Chip label={`${resumen.conCaso.toLocaleString('es-AR')} con caso`} color="info" size="small" variant="outlined" />
                {resumen.sinCaso > 0 && (
                    <Chip
                        label={`${resumen.sinCaso.toLocaleString('es-AR')} sin caso`}
                        size="small"
                        onClick={() => setDialogoAbierto(true)}
                        sx={{ cursor: 'pointer' }}
                    />
                )}
            </Box>
            {resumen.avisos.length > 0 && (
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {resumen.avisos.map((a) => (
                        <li key={a.codigo}>
                            <Typography variant="caption" color="text.secondary">
                                {a.codigo}: {a.cantidad.toLocaleString('es-AR')} caso(s)
                            </Typography>
                        </li>
                    ))}
                </Box>
            )}

            <DialogoSinCaso
                remesaId={remesaId}
                open={dialogoAbierto}
                onClose={() => setDialogoAbierto(false)}
            />
        </SectionCard>
    )
}

function DialogoSinCaso({ remesaId, open, onClose }: { remesaId: number; open: boolean; onClose: () => void }) {
    const notify = useNotify()
    const [items, setItems] = useState<TramiteSinCaso[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(25)
    const [loading, setLoading] = useState(false)

    const cargar = useCallback(() => {
        setLoading(true)
        multiclavesApi
            .sinCaso(remesaId, page + 1, pageSize)
            .then((r) => { setItems(r.items); setTotal(r.total) })
            .catch((err) => notify.error(err))
            .finally(() => setLoading(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remesaId, page, pageSize])

    useEffect(() => {
        if (open) cargar()
    }, [open, cargar])

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Trámites sin caso todavía
                <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Las claves se cargaron igual y quedan guardadas para estos números de cliente. Todavía
                    no se ven desde la ficha — eso se habilita cuando se pueda generar el cupón.
                </Typography>
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Trámite</TableCell>
                                <TableCell align="right">Saldo total</TableCell>
                                <TableCell align="right">Con quita</TableCell>
                                <TableCell align="right">Vencimiento</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {!loading && items.map((it) => (
                                <TableRow key={it.nroTramite} hover>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>{it.nroTramite}</TableCell>
                                    <TableCell align="right">{formatoMoneda(it.importeTotal)}</TableCell>
                                    <TableCell align="right">{formatoMoneda(it.importeQuita)}</TableCell>
                                    <TableCell align="right">{fechaDelCedente(it.fechaVencimiento)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
                <TablePagination
                    component="div"
                    count={total}
                    page={page}
                    onPageChange={(_, p) => setPage(p)}
                    rowsPerPage={pageSize}
                    onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
                    rowsPerPageOptions={[10, 25, 50, 100]}
                />
            </DialogContent>
        </Dialog>
    )
}
