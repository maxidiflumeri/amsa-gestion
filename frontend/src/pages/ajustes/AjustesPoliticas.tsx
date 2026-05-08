import React, { useState, useEffect } from 'react'
import {
    Box,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Divider,
    IconButton,
    MenuItem,
    Paper,
    Stack,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'
import BlockIcon from '@mui/icons-material/Block'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PolicyIcon from '@mui/icons-material/Policy'
import BusinessIcon from '@mui/icons-material/Business'
import api from '../../api/axios'
import RichTextEditor from '../../components/common/RichTextEditor'
import {
    PageHeader,
    DataTableResponsive,
    EmptyState,
    LoadingSkeleton,
    StatusChip,
} from '../../components/ui'
import type { DataTableColumn } from '../../components/ui'
import { useNotify } from '../../hooks/useNotify'
import { useConfirm } from '../../context/ConfirmContext'

interface Empresa {
    id: number
    nombre: string
}

interface Politica {
    id: number
    empresaId: number
    nombre: string
    descripcion?: string
    formasDePago?: string
    tipoAtencion?: string
    activa: boolean
}

type PoliticaRow = Politica & Record<string, unknown>

const EMPTY_FORM = { nombre: '', descripcion: '', formasDePago: '', tipoAtencion: '' }

/** Extrae texto plano de HTML para mostrar en celda truncada. */
function stripHtml(html: string): string {
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    return tmp.textContent || tmp.innerText || ''
}

const AjustesPoliticas: React.FC = () => {
    const theme = useTheme()
    const isMobile = useMediaQuery(theme.breakpoints.down('md'))
    const notify = useNotify()
    const confirm = useConfirm()

    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [empresaId, setEmpresaId] = useState<number | ''>('')
    const [politicas, setPoliticas] = useState<Politica[]>([])
    const [loading, setLoading] = useState(false)

    const [openModal, setOpenModal] = useState(false)
    const [editando, setEditando] = useState<Politica | null>(null)
    const [form, setForm] = useState({ ...EMPTY_FORM })
    const [saving, setSaving] = useState(false)

    // Carga inicial de empresas
    useEffect(() => {
        api.get('/deudores/empresas')
            .then(r => setEmpresas(r.data || []))
            .catch(err => notify.error(err))
    }, [])

    // Carga políticas cuando cambia empresa
    useEffect(() => {
        if (!empresaId) {
            setPoliticas([])
            return
        }
        setLoading(true)
        api.get(`/politicas?empresaId=${empresaId}`)
            .then(r => setPoliticas(r.data || []))
            .catch(err => notify.error(err))
            .finally(() => setLoading(false))
    }, [empresaId])

    const fetchPoliticas = async () => {
        if (!empresaId) return
        const r = await api.get(`/politicas?empresaId=${empresaId}`)
        setPoliticas(r.data || [])
    }

    const handleAbrir = (politica?: Politica) => {
        setEditando(politica || null)
        setForm(politica ? {
            nombre: politica.nombre,
            descripcion: politica.descripcion || '',
            formasDePago: politica.formasDePago || '',
            tipoAtencion: politica.tipoAtencion || '',
        } : { ...EMPTY_FORM })
        setOpenModal(true)
    }

    const handleCerrar = () => {
        setOpenModal(false)
    }

    const handleGuardar = async () => {
        if (!empresaId || !form.nombre.trim()) return
        setSaving(true)
        try {
            const payload = { empresaId, ...form }
            if (editando) {
                await api.put(`/politicas/${editando.id}`, payload)
                notify.success('Política actualizada correctamente')
            } else {
                await api.post('/politicas', payload)
                notify.success('Política creada correctamente')
            }
            setOpenModal(false)
            await fetchPoliticas()
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setSaving(false)
        }
    }

    const handleToggleActiva = async (politica: Politica) => {
        const accion = politica.activa ? 'desactivar' : 'activar'
        const confirmed = await confirm({
            title: `${politica.activa ? 'Desactivar' : 'Activar'} política`,
            description: `¿Confirmás que querés ${accion} la política "${politica.nombre}"?`,
            confirmLabel: politica.activa ? 'Desactivar' : 'Activar',
            cancelLabel: 'Cancelar',
            confirmColor: politica.activa ? 'error' : 'success',
        })
        if (!confirmed) return

        try {
            await api.put(`/politicas/${politica.id}`, { activa: !politica.activa })
            notify.success(politica.activa ? 'Política desactivada' : 'Política activada')
            await fetchPoliticas()
        } catch (err) {
            notify.error(err as Error)
        }
    }

    const columns: DataTableColumn<PoliticaRow>[] = [
        {
            key: 'nombre',
            label: 'Nombre',
            primary: true,
            render: (row) => (
                <Typography variant="body2" fontWeight={600}>
                    {String(row.nombre)}
                </Typography>
            ),
        },
        {
            key: 'descripcion',
            label: 'Descripción',
            secondary: true,
            render: (row) => {
                const texto = stripHtml(String(row.descripcion || ''))
                return (
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {texto || '—'}
                    </Typography>
                )
            },
        },
        {
            key: 'formasDePago',
            label: 'Formas de pago',
            render: (row) => (
                <Typography variant="body2">
                    {String(row.formasDePago || '—')}
                </Typography>
            ),
        },
        {
            key: 'tipoAtencion',
            label: 'Tipo de atención',
            render: (row) => (
                <Typography variant="body2">
                    {String(row.tipoAtencion || '—')}
                </Typography>
            ),
        },
        {
            key: 'activa',
            label: 'Estado',
            render: (row) => (
                <StatusChip
                    status={row.activa ? 'success' : 'neutral'}
                    label={row.activa ? 'Activa' : 'Inactiva'}
                />
            ),
        },
        {
            key: 'acciones',
            label: 'Acciones',
            align: 'right',
            hideInCard: false,
            render: (row) => {
                const p = row as unknown as Politica
                return (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                        <Tooltip title="Editar política">
                            <IconButton
                                size="small"
                                color="primary"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleAbrir(p)
                                }}
                            >
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={p.activa ? 'Desactivar' : 'Activar'}>
                            <IconButton
                                size="small"
                                color={p.activa ? 'error' : 'success'}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleToggleActiva(p)
                                }}
                            >
                                {p.activa
                                    ? <BlockIcon fontSize="small" />
                                    : <CheckCircleIcon fontSize="small" />
                                }
                            </IconButton>
                        </Tooltip>
                    </Box>
                )
            },
        },
    ]

    const rows: PoliticaRow[] = politicas.map(p => ({ ...p } as PoliticaRow))

    // Solo skeleton en primera carga (loading AND lista vacía)
    const isFirstLoad = loading && politicas.length === 0
    const isEmpty = !loading && empresaId !== '' && politicas.length === 0

    return (
        <Box sx={{ p: 3 }}>
            <PageHeader
                title="Políticas de gestión"
                subtitle="Configurá las políticas de gestión por empresa"
                actions={[
                    {
                        label: 'Nueva política',
                        onClick: () => handleAbrir(),
                        startIcon: <AddIcon />,
                        variant: 'contained',
                        disabled: !empresaId,
                    },
                ]}
            />

            {/* Barra de filtros: selector de empresa */}
            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                    <BusinessIcon color="action" />
                    <TextField
                        select
                        label="Empresa"
                        size="small"
                        value={empresaId}
                        onChange={e => setEmpresaId(Number(e.target.value))}
                        sx={{ minWidth: 260 }}
                    >
                        {empresas.map(e => (
                            <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>
                        ))}
                    </TextField>
                    {empresaId === '' && (
                        <Typography variant="body2" color="text.secondary">
                            Seleccioná una empresa para ver sus políticas
                        </Typography>
                    )}
                </Stack>
            </Paper>

            {/* Tabla / estados */}
            {empresaId === '' ? (
                <Paper variant="outlined">
                    <EmptyState
                        title="Seleccioná una empresa"
                        description="Elegí una empresa en el selector de arriba para ver y gestionar sus políticas de gestión."
                        icon={<PolicyIcon />}
                    />
                </Paper>
            ) : (
                <Paper variant="outlined">
                    {isFirstLoad && (
                        <LoadingSkeleton variant="table" rows={4} columns={6} />
                    )}

                    {isEmpty && (
                        <EmptyState
                            title="Sin políticas para esta empresa"
                            description="Esta empresa no tiene políticas de gestión. Creá la primera para comenzar."
                            icon={<PolicyIcon />}
                            action={{
                                label: 'Nueva política',
                                onClick: () => handleAbrir(),
                            }}
                        />
                    )}

                    {!isFirstLoad && !isEmpty && (
                        <DataTableResponsive<PoliticaRow>
                            columns={columns}
                            rows={rows}
                            rowKey={(row) => String(row.id)}
                        />
                    )}
                </Paper>
            )}

            {/* Modal crear/editar */}
            <Dialog
                open={openModal}
                onClose={handleCerrar}
                fullScreen={isMobile}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>
                    {editando ? 'Editar política' : 'Nueva política'}
                </DialogTitle>
                <Divider />
                <DialogContent>
                    <Stack spacing={2.5} sx={{ pt: 1 }}>
                        <TextField
                            autoFocus
                            label="Nombre *"
                            fullWidth
                            size="small"
                            value={form.nombre}
                            onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                        />
                        <Box>
                            <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                Descripción / Metodología
                            </Typography>
                            <Box sx={{ minHeight: isMobile ? 140 : 180 }}>
                                <RichTextEditor
                                    value={form.descripcion}
                                    onChange={html => setForm(f => ({ ...f, descripcion: html }))}
                                    minHeight={isMobile ? 140 : 180}
                                />
                            </Box>
                        </Box>
                        <TextField
                            label="Formas de pago"
                            fullWidth
                            size="small"
                            multiline
                            rows={2}
                            value={form.formasDePago}
                            onChange={e => setForm(f => ({ ...f, formasDePago: e.target.value }))}
                        />
                        <TextField
                            label="Tipo de atención"
                            fullWidth
                            size="small"
                            multiline
                            rows={2}
                            value={form.tipoAtencion}
                            onChange={e => setForm(f => ({ ...f, tipoAtencion: e.target.value }))}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCerrar} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleGuardar}
                        disabled={saving || !form.nombre.trim()}
                    >
                        {saving ? 'Guardando...' : 'Guardar'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default AjustesPoliticas
