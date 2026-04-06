import React, { useState, useEffect } from 'react'
import {
    Box,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    IconButton,
    TextField,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Typography,
    Paper,
    Divider,
    MenuItem,
    Chip,
    Snackbar,
    Alert,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'
import BlockIcon from '@mui/icons-material/Block'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import api from '../../api/axios'
import RichTextEditor from '../../components/common/RichTextEditor'

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

const EMPTY_FORM = { nombre: '', descripcion: '', formasDePago: '', tipoAtencion: '' }

const AjustesPoliticas: React.FC = () => {
    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [empresaId, setEmpresaId] = useState<number | ''>('')
    const [politicas, setPoliticas] = useState<Politica[]>([])
    const [loading, setLoading] = useState(false)

    const [openModal, setOpenModal] = useState(false)
    const [editando, setEditando] = useState<Politica | null>(null)
    const [form, setForm] = useState({ ...EMPTY_FORM })
    const [saving, setSaving] = useState(false)

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' })

    useEffect(() => {
        api.get('/deudores/empresas').then(r => setEmpresas(r.data || []))
    }, [])

    useEffect(() => {
        if (!empresaId) { setPoliticas([]); return }
        setLoading(true)
        api.get(`/politicas?empresaId=${empresaId}`)
            .then(r => setPoliticas(r.data || []))
            .finally(() => setLoading(false))
    }, [empresaId])

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

    const handleGuardar = async () => {
        if (!empresaId || !form.nombre.trim()) return
        setSaving(true)
        try {
            const payload = { empresaId, ...form }
            if (editando) {
                await api.put(`/politicas/${editando.id}`, payload)
            } else {
                await api.post('/politicas', payload)
            }
            setSnackbar({ open: true, message: editando ? 'Política actualizada' : 'Política creada', severity: 'success' })
            setOpenModal(false)
            const r = await api.get(`/politicas?empresaId=${empresaId}`)
            setPoliticas(r.data || [])
        } catch (err: any) {
            setSnackbar({ open: true, message: err.response?.data?.message || 'Error al guardar', severity: 'error' })
        } finally {
            setSaving(false)
        }
    }

    const handleToggleActiva = async (politica: Politica) => {
        try {
            await api.put(`/politicas/${politica.id}`, { activa: !politica.activa })
            const r = await api.get(`/politicas?empresaId=${empresaId}`)
            setPoliticas(r.data || [])
            setSnackbar({ open: true, message: politica.activa ? 'Política desactivada' : 'Política activada', severity: 'success' })
        } catch {
            setSnackbar({ open: true, message: 'Error al actualizar', severity: 'error' })
        }
    }

    return (
        <Box>
            <Typography variant="h5" fontWeight="bold" mb={3}>Políticas de Gestión</Typography>

            <Paper sx={{ p: 2, mb: 3 }}>
                <TextField
                    select label="Empresa" size="small" value={empresaId}
                    onChange={e => setEmpresaId(Number(e.target.value))}
                    sx={{ minWidth: 260 }}
                >
                    {empresas.map(e => <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>)}
                </TextField>
            </Paper>

            {empresaId !== '' && (
                <>
                    <Box display="flex" justifyContent="flex-end" mb={2}>
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleAbrir()}>
                            Nueva Política
                        </Button>
                    </Box>
                    <TableContainer component={Paper}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Nombre</TableCell>
                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Descripción</TableCell>
                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Formas de Pago</TableCell>
                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Tipo Atención</TableCell>
                                    <TableCell sx={{ bgcolor: 'action.hover' }}>Estado</TableCell>
                                    <TableCell sx={{ bgcolor: 'action.hover' }}></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {loading ? (
                                    <TableRow><TableCell colSpan={6} align="center">Cargando...</TableCell></TableRow>
                                ) : politicas.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} align="center">
                                            <Typography variant="body2" color="text.secondary" fontStyle="italic" py={2}>
                                                No hay políticas para esta empresa
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                ) : politicas.map(p => (
                                    <TableRow key={p.id} hover>
                                        <TableCell sx={{ fontWeight: 'bold' }}>{p.nombre}</TableCell>
                                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {p.descripcion || '-'}
                                        </TableCell>
                                        <TableCell>{p.formasDePago || '-'}</TableCell>
                                        <TableCell>{p.tipoAtencion || '-'}</TableCell>
                                        <TableCell>
                                            <Chip
                                                label={p.activa ? 'Activa' : 'Inactiva'}
                                                color={p.activa ? 'success' : 'default'}
                                                size="small"
                                                variant="outlined"
                                            />
                                        </TableCell>
                                        <TableCell align="right">
                                            <IconButton size="small" onClick={() => handleAbrir(p)} title="Editar">
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton
                                                size="small"
                                                color={p.activa ? 'error' : 'success'}
                                                onClick={() => handleToggleActiva(p)}
                                                title={p.activa ? 'Desactivar' : 'Activar'}
                                            >
                                                {p.activa ? <BlockIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />}
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}

            <Dialog open={openModal} onClose={() => setOpenModal(false)} fullWidth maxWidth="sm">
                <DialogTitle>{editando ? 'Editar Política' : 'Nueva Política'}</DialogTitle>
                <Divider />
                <DialogContent>
                    <Box display="flex" flexDirection="column" gap={2} mt={1}>
                        <TextField
                            label="Nombre *" fullWidth size="small"
                            value={form.nombre}
                            onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                        />
                        <Box>
                            <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                Descripción / Metodología
                            </Typography>
                            <RichTextEditor
                                value={form.descripcion}
                                onChange={html => setForm(f => ({ ...f, descripcion: html }))}
                                minHeight={180}
                            />
                        </Box>
                        <TextField
                            label="Formas de Pago" fullWidth size="small" multiline rows={2}
                            value={form.formasDePago}
                            onChange={e => setForm(f => ({ ...f, formasDePago: e.target.value }))}
                        />
                        <TextField
                            label="Tipo de Atención" fullWidth size="small" multiline rows={2}
                            value={form.tipoAtencion}
                            onChange={e => setForm(f => ({ ...f, tipoAtencion: e.target.value }))}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenModal(false)}>Cancelar</Button>
                    <Button
                        variant="contained"
                        onClick={handleGuardar}
                        disabled={saving || !form.nombre.trim()}
                    >
                        {saving ? 'Guardando...' : 'Guardar'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    )
}

export default AjustesPoliticas
