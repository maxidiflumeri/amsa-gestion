import React, { useEffect, useState } from 'react'
import { Box, Typography, CircularProgress, Paper, Chip, Stack } from '@mui/material'
import PolicyIcon from '@mui/icons-material/Policy'
import RichTextEditor from '../common/RichTextEditor'
import api from '../../api/axios'

interface Props {
    deudorId: number | null
}

const PoliticaTab: React.FC<Props> = ({ deudorId }) => {
    const [politica, setPolitica] = useState<any>(null)
    const [remesa, setRemesa] = useState<any>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!deudorId) return
        setLoading(true)
        api.get(`/deudores/${deudorId}`)
            .then(r => {
                setRemesa(r.data?.remesa || null)
                setPolitica(r.data?.remesa?.politica || null)
            })
            .finally(() => setLoading(false))
    }, [deudorId])

    if (!deudorId) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                <Typography color="text.secondary" fontStyle="italic">
                    Seleccioná un deudor para ver la política de gestión.
                </Typography>
            </Box>
        )
    }

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                <CircularProgress />
            </Box>
        )
    }

    if (!politica) {
        return (
            <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height={300} gap={2}>
                <PolicyIcon sx={{ fontSize: 56, color: 'text.disabled' }} />
                <Typography color="text.secondary" fontStyle="italic">
                    La remesa <strong>{remesa?.numeroRemesa || '-'}</strong> no tiene una política de gestión asignada.
                </Typography>
                <Typography variant="caption" color="text.disabled">
                    Podés asociarla desde Ajustes → Políticas o desde el Historial de Importaciones.
                </Typography>
            </Box>
        )
    }

    return (
        <Box sx={{ maxWidth: 900, mx: 'auto', py: 2, px: { xs: 1, md: 0 } }}>
            <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
                {/* Header */}
                <Stack direction="row" alignItems="center" spacing={2} mb={1}>
                    <PolicyIcon color="primary" />
                    <Typography variant="h5" fontWeight="bold">{politica.nombre}</Typography>
                    <Chip
                        label={politica.activa ? 'Activa' : 'Inactiva'}
                        color={politica.activa ? 'success' : 'default'}
                        size="small"
                        variant="outlined"
                    />
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" mb={3}>
                    Remesa: <strong>{remesa?.numeroRemesa}</strong>
                </Typography>

                {/* Campos estructurados */}
                {(politica.formasDePago || politica.tipoAtencion) && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3}>
                        {politica.formasDePago && (
                            <Box flex={1} sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>
                                <Typography variant="overline" color="text.secondary" fontWeight="bold" display="block">
                                    FORMAS DE PAGO
                                </Typography>
                                <Typography variant="body2">{politica.formasDePago}</Typography>
                            </Box>
                        )}
                        {politica.tipoAtencion && (
                            <Box flex={1} sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>
                                <Typography variant="overline" color="text.secondary" fontWeight="bold" display="block">
                                    TIPO DE ATENCIÓN
                                </Typography>
                                <Typography variant="body2">{politica.tipoAtencion}</Typography>
                            </Box>
                        )}
                    </Stack>
                )}

                {/* Contenido rich text */}
                {politica.descripcion && (
                    <>
                        <Typography variant="overline" color="text.secondary" fontWeight="bold" display="block" mb={1}>
                            DESCRIPCIÓN / METODOLOGÍA
                        </Typography>
                        <RichTextEditor
                            value={politica.descripcion}
                            onChange={() => {}}
                            readOnly
                            minHeight={150}
                        />
                    </>
                )}

                {/* Datos extra JSON */}
                {politica.datosExtra && Object.keys(politica.datosExtra).length > 0 && (
                    <Box mt={3}>
                        <Typography variant="overline" color="text.secondary" fontWeight="bold" display="block" mb={1}>
                            INFORMACIÓN ADICIONAL
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={2}>
                            {Object.entries(politica.datosExtra as Record<string, any>).map(([k, v]) => (
                                <Box key={k} sx={{ bgcolor: 'action.hover', borderRadius: 2, px: 2, py: 1 }}>
                                    <Typography variant="caption" color="text.secondary" display="block" fontWeight="bold">
                                        {k.replace(/_/g, ' ').toUpperCase()}
                                    </Typography>
                                    <Typography variant="body2">{String(v)}</Typography>
                                </Box>
                            ))}
                        </Stack>
                    </Box>
                )}
            </Paper>
        </Box>
    )
}

export default PoliticaTab
