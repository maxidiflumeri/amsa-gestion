import React, { useState, useEffect } from 'react'
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Grid,
    TextField,
    Typography,
    Box,
    IconButton,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    useMediaQuery,
    useTheme,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import ClearIcon from '@mui/icons-material/Clear'
import { DataTableResponsive, EmptyState, LoadingSkeleton } from '../ui'
import type { DataTableColumn } from '../ui'
import api from '../../api/axios'
import { useNotify } from '../../hooks/useNotify'

interface BuscadorAvanzadoModalProps {
    open: boolean
    onClose: () => void
    onSelectDeudor: (id: number) => void
}

interface SearchParams {
    id: string
    nombre: string
    apellido: string
    documento: string
    empresa: string
    nroCliente: string
    email: string
    telefono: string
}

const initialParams: SearchParams = {
    id: '',
    nombre: '',
    apellido: '',
    documento: '',
    empresa: '',
    nroCliente: '',
    email: '',
    telefono: '',
}

type ResultRow = {
    id: number
    documento: string
    nombre: string
    apellido: string
    empresa?: { nombre?: string }
    camposAdicionales?: { nro_cliente?: string }
} & Record<string, unknown>

const resultColumns: DataTableColumn<ResultRow>[] = [
    { key: 'id', label: 'ID', width: 60, hideInCard: true },
    { key: 'documento', label: 'Documento', primary: true },
    {
        key: 'cliente',
        label: 'Cliente',
        secondary: true,
        render: (row) => `${row.nombre} ${row.apellido}`,
    },
    {
        key: 'empresa',
        label: 'Empresa',
        render: (row) => (row.empresa as any)?.nombre || '-',
    },
    {
        key: 'nroCliente',
        label: 'Nº Cli.',
        render: (row) => (row.camposAdicionales as any)?.nro_cliente || '-',
    },
]

const BuscadorAvanzadoModal: React.FC<BuscadorAvanzadoModalProps> = ({ open, onClose, onSelectDeudor }) => {
    const notify = useNotify()
    const theme = useTheme()
    const isMobile = useMediaQuery(theme.breakpoints.down('md'))

    const [params, setParams] = useState<SearchParams>(initialParams)
    const [resultados, setResultados] = useState<ResultRow[]>([])
    const [loading, setLoading] = useState(false)
    const [searched, setSearched] = useState(false)
    const [empresas, setEmpresas] = useState<any[]>([])

    useEffect(() => {
        if (open && empresas.length === 0) {
            api.get('/deudores/empresas')
                .then((res) => setEmpresas(res.data))
                .catch((err) => notify.error(err))
        }
    }, [open])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | any) => {
        setParams({ ...params, [e.target.name]: e.target.value })
    }

    const handleClear = () => {
        setParams(initialParams)
        setResultados([])
        setSearched(false)
    }

    const handleSearch = async () => {
        const payload: any = {}
        if (params.id) payload.id = Number(params.id)
        if (params.nombre) payload.nombre = params.nombre
        if (params.apellido) payload.apellido = params.apellido
        if (params.documento) payload.documento = params.documento
        if (params.empresa) payload.empresa = params.empresa
        if (params.nroCliente) payload.nroCliente = params.nroCliente
        if (params.email) payload.email = params.email
        if (params.telefono) payload.telefono = params.telefono

        if (Object.keys(payload).length === 0) return

        setLoading(true)
        setSearched(true)
        try {
            const res = await api.post('/deudores/advanced-search', payload)
            setResultados(res.data as ResultRow[])
        } catch (error) {
            notify.error(error as Error)
            setResultados([])
        } finally {
            setLoading(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch()
    }

    const isFormEmpty = Object.values(params).every((v) => v.trim() === '')

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
            <DialogTitle
                sx={{
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <Box display="flex" alignItems="center" gap={1}>
                    <SearchIcon />
                    Búsqueda Avanzada de Deudores
                </Box>
                <IconButton onClick={onClose} sx={{ color: 'primary.contrastText' }}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Ingresá uno o más criterios para buscar simultáneamente en toda la base de datos.
                </Typography>

                <Grid container spacing={2} sx={{ mt: 1, mb: 3 }}>
                    <Grid item xs={12} sm={6} md={4}>
                        <TextField fullWidth size="small" label="ID Deudor" name="id" value={params.id} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                        <TextField fullWidth size="small" label="Documento" name="documento" value={params.documento} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                        <TextField fullWidth size="small" label="Nombre" name="nombre" value={params.nombre} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                        <TextField fullWidth size="small" label="Apellido" name="apellido" value={params.apellido} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                        <TextField fullWidth size="small" label="Nº Cliente" name="nroCliente" value={params.nroCliente} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                        <FormControl fullWidth size="small">
                            <InputLabel id="empresa-search-label">Empresa</InputLabel>
                            <Select
                                labelId="empresa-search-label"
                                name="empresa"
                                value={params.empresa}
                                onChange={handleChange}
                                label="Empresa"
                            >
                                <MenuItem value=""><em>Todas</em></MenuItem>
                                {empresas.map((emp) => (
                                    <MenuItem key={emp.id} value={emp.nombre}>{emp.nombre}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                        <TextField fullWidth size="small" label="Teléfono" name="telefono" value={params.telefono} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                        <TextField fullWidth size="small" label="Email" name="email" value={params.email} onChange={handleChange} onKeyDown={handleKeyDown} autoComplete="off" />
                    </Grid>
                </Grid>

                {/* Zona de resultados */}
                <Box>
                    {loading ? (
                        <LoadingSkeleton variant="table" rows={5} columns={5} />
                    ) : searched ? (
                        resultados.length > 0 ? (
                            <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
                                <DataTableResponsive<ResultRow>
                                    columns={resultColumns}
                                    rows={resultados}
                                    rowKey={(row) => String(row.id)}
                                    onRowClick={(row) => {
                                        onSelectDeudor(row.id)
                                        onClose()
                                    }}
                                />
                            </Box>
                        ) : (
                            <EmptyState
                                title="Sin resultados"
                                description="No se encontraron deudores con esos criterios."
                            />
                        )
                    ) : null}
                </Box>
            </DialogContent>

            <DialogActions sx={{ p: 2 }}>
                <Button onClick={handleClear} color="inherit" startIcon={<ClearIcon />}>
                    Limpiar
                </Button>
                <Box flexGrow={1} />
                <Button onClick={onClose} color="inherit">
                    Cancelar
                </Button>
                <Button
                    onClick={handleSearch}
                    variant="contained"
                    color="primary"
                    startIcon={<SearchIcon />}
                    disabled={loading || isFormEmpty}
                >
                    Buscar
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default BuscadorAvanzadoModal
