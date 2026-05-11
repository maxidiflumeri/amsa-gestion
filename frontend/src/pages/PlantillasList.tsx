import React, { useCallback, useEffect, useState } from 'react'
import {
    Box,
    Chip,
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
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import ListAltIcon from '@mui/icons-material/ListAlt'
import BusinessIcon from '@mui/icons-material/Business'
import { useNavigate } from 'react-router-dom'
import api from '../api/axios'
import { useEmpresas } from '../hooks/useEmpresas'
import { useNotify } from '../hooks/useNotify'
import { useConfirm } from '../context/ConfirmContext'
import {
    PageHeader,
    DataTableResponsive,
    EmptyState,
    LoadingSkeleton,
} from '../components/ui'
import type { DataTableColumn } from '../components/ui'

interface Plantilla {
    id: number
    nombre: string
    categoria: string
    version: number
    activo: boolean
    separador: string
    tieneHeader: boolean
    mappingJson: Record<string, unknown>
    createdAt: string
}

type PlantillaRow = Plantilla & Record<string, unknown>

const PlantillasList: React.FC = () => {
    const theme = useTheme()
    const isMobile = useMediaQuery(theme.breakpoints.down('md'))
    const navigate = useNavigate()
    const notify = useNotify()
    const confirm = useConfirm()

    const { empresas, loading: loadingEmpresas } = useEmpresas()
    const [empresaId, setEmpresaId] = useState<number | ''>(1)

    const [plantillas, setPlantillas] = useState<Plantilla[]>([])
    const [loading, setLoading] = useState(false)

    const loadPlantillas = useCallback(async () => {
        if (!empresaId) return
        setLoading(true)
        try {
            const res = await api.get(`/import/plantillas/${empresaId}`)
            setPlantillas(res.data)
        } catch (err) {
            notify.error(err as Error)
        } finally {
            setLoading(false)
        }
    }, [empresaId])

    useEffect(() => {
        loadPlantillas()
    }, [loadPlantillas])

    const handleDelete = async (plantilla: Plantilla) => {
        const confirmed = await confirm({
            title: 'Eliminar plantilla',
            description: `¿Seguro que querés eliminar la plantilla "${plantilla.nombre}"? Esta acción no se puede deshacer.`,
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            confirmColor: 'error',
        })
        if (!confirmed) return

        try {
            await api.post(`/import/plantillas/${plantilla.id}/delete`)
            notify.success('Plantilla eliminada')
            await loadPlantillas()
        } catch (err) {
            notify.error(err as Error)
        }
    }

    const columns: DataTableColumn<PlantillaRow>[] = [
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
            key: 'categoria',
            label: 'Categoría',
            secondary: true,
            render: (row) => (
                <Chip
                    label={String(row.categoria)}
                    size="small"
                    color="primary"
                    variant="outlined"
                />
            ),
        },
        {
            key: 'version',
            label: 'Versión',
            render: (row) => (
                <Typography variant="body2">v{String(row.version)}</Typography>
            ),
        },
        {
            key: 'separador',
            label: 'Separador',
            render: (row) => {
                const sep = String(row.separador)
                if (sep === 'EXCEL') {
                    return <Chip label="Excel" size="small" color="success" variant="outlined" />
                }
                return <code>{sep === '\t' ? 'TAB' : sep}</code>
            },
        },
        {
            key: 'campos',
            label: 'Campos',
            render: (row) => {
                const mapping = row.mappingJson as Record<string, unknown>
                const colCount = mapping?.columns
                    ? Object.keys(mapping.columns as object).length
                    : 0
                const extraCount = mapping?.extras
                    ? Object.keys(mapping.extras as object).length
                    : 0
                return (
                    <Typography variant="body2">
                        {colCount}{extraCount > 0 ? ` + ${extraCount} extras` : ''}
                    </Typography>
                )
            },
        },
        {
            key: 'createdAt',
            label: 'Fecha',
            render: (row) => (
                <Typography variant="body2">
                    {new Date(String(row.createdAt)).toLocaleDateString()}
                </Typography>
            ),
        },
        {
            key: 'acciones',
            label: 'Acciones',
            align: 'right',
            hideInCard: false,
            render: (row) => {
                const p = row as unknown as Plantilla
                return (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                        <Tooltip title="Editar">
                            <IconButton
                                size="small"
                                color="primary"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    navigate(`/plantillas/${p.id}/editar`)
                                }}
                            >
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Eliminar">
                            <IconButton
                                size="small"
                                color="error"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleDelete(p)
                                }}
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                )
            },
        },
    ]

    const rows: PlantillaRow[] = plantillas.map((p) => ({ ...p } as PlantillaRow))
    const isFirstLoad = loading && plantillas.length === 0
    const isEmpty = !loading && empresaId !== '' && plantillas.length === 0

    return (
        <Box sx={{ p: 3 }}>
            <PageHeader
                title="Plantillas de importación"
                subtitle="Configurá cómo se mapean los archivos a la base de datos"
                actions={[
                    {
                        label: 'Nueva plantilla',
                        onClick: () => {
                            if (!empresaId) return
                            sessionStorage.setItem('plantillas_empresaId', String(empresaId))
                            navigate('/plantillas/nueva')
                        },
                        startIcon: <AddIcon />,
                        variant: 'contained',
                        disabled: !empresaId,
                    },
                ]}
            />

            {/* Barra de filtros */}
            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                    <BusinessIcon color="action" />
                    <TextField
                        select
                        label="Empresa"
                        size="small"
                        value={empresaId}
                        onChange={(e) => setEmpresaId(Number(e.target.value))}
                        disabled={loadingEmpresas}
                        sx={{ minWidth: 260 }}
                    >
                        {empresas.map((emp) => (
                            <MenuItem key={emp.id} value={emp.id}>
                                {emp.nombre}
                            </MenuItem>
                        ))}
                    </TextField>
                    {empresaId === '' && (
                        <Typography variant="body2" color="text.secondary">
                            Seleccioná una empresa para ver sus plantillas
                        </Typography>
                    )}
                </Stack>
            </Paper>

            {/* Tabla / estados */}
            {empresaId === '' ? (
                <Paper variant="outlined">
                    <EmptyState
                        title="Seleccioná una empresa"
                        description="Elegí una empresa en el selector de arriba para ver y gestionar sus plantillas de importación."
                        icon={<ListAltIcon />}
                    />
                </Paper>
            ) : (
                <Paper variant="outlined">
                    {isFirstLoad && (
                        <LoadingSkeleton variant="table" rows={4} columns={7} />
                    )}

                    {isEmpty && (
                        <EmptyState
                            title="Sin plantillas para esta empresa"
                            description="Esta empresa no tiene plantillas de importación. Creá la primera para comenzar."
                            icon={<ListAltIcon />}
                            action={{
                                label: 'Nueva plantilla',
                                onClick: () => {
                                    if (!empresaId) return
                                    sessionStorage.setItem('plantillas_empresaId', String(empresaId))
                                    navigate('/plantillas/nueva')
                                },
                            }}
                        />
                    )}

                    {!isFirstLoad && !isEmpty && (
                        <DataTableResponsive<PlantillaRow>
                            columns={columns}
                            rows={rows}
                            rowKey={(row) => String(row.id)}
                        />
                    )}
                </Paper>
            )}
        </Box>
    )
}

export default PlantillasList
