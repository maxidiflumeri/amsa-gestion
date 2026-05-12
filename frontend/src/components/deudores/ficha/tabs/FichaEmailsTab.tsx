import React, { useCallback, useEffect, useState } from 'react'
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { emailApi } from '../../../../api/email'
import type { EnvioEmail, ReporteEstado } from '../../../../types/email'
import { useNotify } from '../../../../hooks/useNotify'

interface Props {
    deudorId: number
    refreshKey?: number
}

const formatFecha = (iso: string) => {
    try {
        return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
    } catch {
        return iso
    }
}

const estadoColor = (estado: string): 'default' | 'success' | 'error' | 'warning' | 'info' => {
    const e = estado.toUpperCase()
    if (e === 'ENVIADO' || e === 'DELIVERED' || e === 'OPENED') return 'success'
    if (e === 'ERROR' || e === 'BOUNCED' || e === 'FAILED') return 'error'
    if (e === 'PENDIENTE' || e === 'PENDING') return 'warning'
    return 'default'
}

const FichaEmailsTab: React.FC<Props> = ({ deudorId, refreshKey }) => {
    const notify = useNotify()
    const [envios, setEnvios] = useState<EnvioEmail[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedId, setExpandedId] = useState<number | null>(null)
    const [reportes, setReportes] = useState<Record<number, ReporteEstado[]>>({})
    const [refreshingId, setRefreshingId] = useState<number | null>(null)

    const cargar = useCallback(async () => {
        setLoading(true)
        try {
            const data = await emailApi.listarEnviosDeudor(deudorId)
            setEnvios(data)
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setLoading(false)
        }
    }, [deudorId])

    useEffect(() => {
        cargar()
    }, [cargar, refreshKey])

    const handleRefrescar = async (envio: EnvioEmail) => {
        setRefreshingId(envio.id)
        try {
            const data = await emailApi.estadoEnvio(envio.id)
            setReportes((prev) => ({ ...prev, [envio.id]: data.reportes }))
            setExpandedId(envio.id)
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setRefreshingId(null)
        }
    }

    if (loading) {
        return (
            <Stack alignItems="center" py={4}>
                <CircularProgress size={28} />
            </Stack>
        )
    }

    if (envios.length === 0) {
        return (
            <Box p={2}>
                <Alert severity="info">No hay emails enviados todavía.</Alert>
            </Box>
        )
    }

    return (
        <Box p={2}>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Fecha</TableCell>
                        <TableCell>Asunto</TableCell>
                        <TableCell>Destinatarios</TableCell>
                        <TableCell>Estado</TableCell>
                        <TableCell>Usuario</TableCell>
                        <TableCell align="right">Acciones</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {envios.map((e) => (
                        <React.Fragment key={e.id}>
                            <TableRow hover>
                                <TableCell>{formatFecha(e.creadoAt)}</TableCell>
                                <TableCell sx={{ maxWidth: 240 }}>
                                    <Typography variant="body2" noWrap title={e.asunto}>{e.asunto || '—'}</Typography>
                                </TableCell>
                                <TableCell sx={{ maxWidth: 240 }}>
                                    <Typography variant="body2" noWrap title={e.destinatarios}>{e.destinatarios}</Typography>
                                </TableCell>
                                <TableCell>
                                    <Chip size="small" label={e.estado} color={estadoColor(e.estado)} />
                                </TableCell>
                                <TableCell>
                                    <Typography variant="body2">{e.usuario?.nombre ?? `#${e.usuarioId}`}</Typography>
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="Ver detalle / variables">
                                        <IconButton
                                            size="small"
                                            onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                                        >
                                            <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Refrescar estado en Sender">
                                        <span>
                                            <IconButton size="small" onClick={() => handleRefrescar(e)} disabled={refreshingId === e.id}>
                                                {refreshingId === e.id ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                            {expandedId === e.id && (
                                <TableRow>
                                    <TableCell colSpan={6} sx={{ bgcolor: 'background.default' }}>
                                        <Stack spacing={1} p={1}>
                                            {e.error && (
                                                <Alert severity="error" sx={{ py: 0.5 }}>{e.error}</Alert>
                                            )}
                                            {Object.keys(e.variables || {}).length > 0 && (
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">Variables usadas</Typography>
                                                    <Stack direction="row" flexWrap="wrap" spacing={0.5} mt={0.5}>
                                                        {Object.entries(e.variables).map(([k, v]) => (
                                                            <Chip key={k} size="small" label={`${k}: ${v}`} variant="outlined" />
                                                        ))}
                                                    </Stack>
                                                </Box>
                                            )}
                                            {e.archivosNombres?.length > 0 && (
                                                <Typography variant="caption" color="text.secondary">
                                                    Adjuntos: {e.archivosNombres.join(', ')}
                                                </Typography>
                                            )}
                                            {reportes[e.id] && reportes[e.id].length > 0 && (
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">Reportes en Sender</Typography>
                                                    <Table size="small">
                                                        <TableHead>
                                                            <TableRow>
                                                                <TableCell>Destinatario</TableCell>
                                                                <TableCell>Estado</TableCell>
                                                                <TableCell>Enviado</TableCell>
                                                                <TableCell>Error</TableCell>
                                                            </TableRow>
                                                        </TableHead>
                                                        <TableBody>
                                                            {reportes[e.id].map((r) => (
                                                                <TableRow key={r.id}>
                                                                    <TableCell>{r.destinatario}</TableCell>
                                                                    <TableCell>
                                                                        <Chip size="small" label={r.estado} color={estadoColor(r.estado)} />
                                                                    </TableCell>
                                                                    <TableCell>{r.fechaEnvio ? formatFecha(r.fechaEnvio) : '—'}</TableCell>
                                                                    <TableCell>{r.error || '—'}</TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </Box>
                                            )}
                                            {reportes[e.id] && reportes[e.id].length === 0 && (
                                                <Typography variant="caption" color="text.disabled">
                                                    Sin reportes en Sender (¿envío falló antes de crearlos?)
                                                </Typography>
                                            )}
                                        </Stack>
                                    </TableCell>
                                </TableRow>
                            )}
                        </React.Fragment>
                    ))}
                </TableBody>
            </Table>
        </Box>
    )
}

export default FichaEmailsTab
