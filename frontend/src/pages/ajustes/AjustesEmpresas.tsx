import React, { useState, useEffect } from 'react'
import {
    Box,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Paper,
    Stack,
    TextField,
    Tooltip,
    useMediaQuery,
    useTheme,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import BusinessIcon from '@mui/icons-material/Business'
import api from '../../api/axios'
import {
    PageHeader,
    DataTableResponsive,
    EmptyState,
    LoadingSkeleton,
} from '../../components/ui'
import type { DataTableColumn } from '../../components/ui'
import { useNotify } from '../../hooks/useNotify'
import { useConfirm } from '../../context/ConfirmContext'

interface Empresa {
    id: number
    nombre: string
    cuit: string
}

type EmpresaRow = Empresa & Record<string, unknown>

const AjustesEmpresas: React.FC = () => {
    const theme = useTheme()
    const isMobile = useMediaQuery(theme.breakpoints.down('md'))
    const notify = useNotify()
    const confirm = useConfirm()

    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)
    const [editing, setEditing] = useState<Empresa | null>(null)
    const [saving, setSaving] = useState(false)
    const [formData, setFormData] = useState({ nombre: '', cuit: '' })

    const fetchEmpresas = async () => {
        try {
            const res = await api.get('/empresas')
            setEmpresas(res.data)
        } catch (error) {
            notify.error(error as Error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchEmpresas()
    }, [])

    const handleOpen = (empresa?: Empresa) => {
        if (empresa) {
            setEditing(empresa)
            setFormData({ nombre: empresa.nombre, cuit: empresa.cuit || '' })
        } else {
            setEditing(null)
            setFormData({ nombre: '', cuit: '' })
        }
        setOpen(true)
    }

    const handleClose = () => {
        setOpen(false)
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            if (editing) {
                await api.patch(`/empresas/${editing.id}`, formData)
                notify.success('Empresa actualizada correctamente')
            } else {
                await api.post('/empresas', formData)
                notify.success('Empresa creada correctamente')
            }
            setOpen(false)
            await fetchEmpresas()
        } catch (error) {
            notify.error(error as Error)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (empresa: Empresa) => {
        const confirmed = await confirm({
            title: 'Eliminar empresa',
            description: `¿Confirmás que querés eliminar la empresa "${empresa.nombre}"? Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            confirmColor: 'error',
        })

        if (!confirmed) return

        try {
            await api.delete(`/empresas/${empresa.id}`)
            notify.success('Empresa eliminada correctamente')
            await fetchEmpresas()
        } catch (error) {
            notify.error(error as Error)
        }
    }

    const columns: DataTableColumn<EmpresaRow>[] = [
        {
            key: 'nombre',
            label: 'Nombre',
            primary: true,
        },
        {
            key: 'cuit',
            label: 'CUIT',
            secondary: true,
        },
        {
            key: 'acciones',
            label: 'Acciones',
            align: 'right',
            hideInCard: false,
            render: (row) => (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                    <Tooltip title="Editar empresa">
                        <IconButton
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleOpen(row as unknown as Empresa)
                            }}
                            color="primary"
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Eliminar empresa">
                        <IconButton
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(row as unknown as Empresa)
                            }}
                            color="error"
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            ),
        },
    ]

    const rows: EmpresaRow[] = empresas.map((e) => ({ ...e } as EmpresaRow))

    const isFirstLoad = loading && empresas.length === 0
    const isEmpty = !loading && empresas.length === 0

    return (
        <Box sx={{ p: 3 }}>
            <PageHeader
                title="Empresas"
                subtitle="Administre las empresas y sus respectivos CUITs"
                actions={[
                    {
                        label: 'Nueva empresa',
                        onClick: () => handleOpen(),
                        startIcon: <AddIcon />,
                        variant: 'contained',
                    },
                ]}
            />

            <Paper variant="outlined">
                {isFirstLoad && <LoadingSkeleton variant="table" rows={5} columns={3} />}

                {isEmpty && (
                    <EmptyState
                        title="No hay empresas registradas"
                        description="Creá la primera empresa para comenzar a gestionar CUITs y asociar políticas."
                        icon={<BusinessIcon />}
                        action={{
                            label: 'Nueva empresa',
                            onClick: () => handleOpen(),
                        }}
                    />
                )}

                {!isFirstLoad && !isEmpty && (
                    <DataTableResponsive<EmpresaRow>
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => String(row.id)}
                    />
                )}
            </Paper>

            <Dialog
                open={open}
                onClose={handleClose}
                fullScreen={isMobile}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>
                    {editing ? 'Editar empresa' : 'Nueva empresa'}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={2.5} sx={{ pt: 1 }}>
                        <TextField
                            autoFocus
                            label="Nombre"
                            fullWidth
                            value={formData.nombre}
                            onChange={(e) =>
                                setFormData({ ...formData, nombre: e.target.value })
                            }
                        />
                        <TextField
                            label="CUIT"
                            fullWidth
                            value={formData.cuit}
                            onChange={(e) =>
                                setFormData({ ...formData, cuit: e.target.value })
                            }
                            placeholder="XX-XXXXXXXX-X"
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleClose} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSave}
                        variant="contained"
                        disabled={saving || !formData.nombre.trim()}
                    >
                        {saving ? 'Guardando...' : 'Guardar'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}

export default AjustesEmpresas
