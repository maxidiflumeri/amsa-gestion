// src/components/deudores/DeudoresTable.tsx
import React, { useEffect, useState, useCallback } from 'react'
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    TextField,
    Typography,
    TablePagination
} from '@mui/material'
import api from '../../api/axios'

interface Deudor {
    id: number,
    empresaId: number,
    remesa: any
    documento: string
    nombre: string,
    camposAdicionales: any
    apellido: string
    montoTotal: number | null
    estadoSituacionId?: number
    estadoGestionId?: number
}

interface Props {
    selectedDeudorId: number | null
    setSelectedDeudorId: (id: number | null) => void
}

const DeudoresTable: React.FC<Props> = ({ selectedDeudorId, setSelectedDeudorId }) => {
    const [deudores, setDeudores] = useState<Deudor[]>([])
    const [filtro, setFiltro] = useState('')
    const [debouncedFiltro, setDebouncedFiltro] = useState('')
    
    // Paginación state
    const [page, setPage] = useState(0)
    const [rowsPerPage, setRowsPerPage] = useState(10)
    const [totalRows, setTotalRows] = useState(0)

    // Debounce del filtro manual
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedFiltro(filtro)
            setPage(0) // Volver a la primera página al cambiar el filtro
        }, 500)
        return () => clearTimeout(timer)
    }, [filtro])

    const fetchDeudores = useCallback(() => {
        api.get('/deudores', {
            params: {
                page: page + 1,
                limit: rowsPerPage,
                search: debouncedFiltro || undefined
            }
        })
        .then(res => {
            if (res.data && res.data.data) {
                setDeudores(res.data.data)
                setTotalRows(res.data.meta.total)
            } else if (Array.isArray(res.data)) {
                // Compatibilidad en caso de respuestas planas antiguas
                setDeudores(res.data)
                setTotalRows(res.data.length)
            }
        })
        .catch(err => console.error('Error cargando deudores:', err))
    }, [page, rowsPerPage, debouncedFiltro])

    useEffect(() => {
        fetchDeudores()
    }, [fetchDeudores])

    const handleChangePage = (event: unknown, newPage: number) => {
        setPage(newPage)
    }

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
        setRowsPerPage(parseInt(event.target.value, 10))
        setPage(0)
    }

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Lista de Deudores</Typography>
            <TextField
                fullWidth
                variant="outlined"
                label="Buscar por ID, nombre o documento"
                value={filtro}
                onChange={e => setFiltro(e.target.value)}
                sx={{ mb: 2 }}
            />
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Id Deudor</TableCell>
                            <TableCell>Id Empresa</TableCell>
                            <TableCell>Numero Cliente</TableCell>
                            <TableCell>Remesa</TableCell>
                            <TableCell>Documento</TableCell>
                            <TableCell>Nombre</TableCell>
                            <TableCell>Monto</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {deudores.map((d) => (
                            <TableRow
                                key={d.id}
                                hover
                                selected={selectedDeudorId === d.id}
                                onClick={() => setSelectedDeudorId(d.id)}
                                sx={{ cursor: 'pointer' }}
                            >
                                <TableCell>{d.id}</TableCell>
                                <TableCell>{d.empresaId}</TableCell>
                                <TableCell>{d.camposAdicionales?.nro_cliente || '-'}</TableCell>
                                <TableCell>{d.remesa?.numeroRemesa}</TableCell>
                                <TableCell>{d.documento}</TableCell>
                                <TableCell>{d.nombre} {d.apellido}</TableCell>
                                <TableCell>${d.montoTotal?.toLocaleString('es-AR') ?? '-'}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <TablePagination
                    rowsPerPageOptions={[10, 25, 50, 100]}
                    component="div"
                    count={totalRows}
                    rowsPerPage={rowsPerPage}
                    page={page}
                    onPageChange={handleChangePage}
                    onRowsPerPageChange={handleChangeRowsPerPage}
                    labelRowsPerPage="Filas por página"
                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count !== -1 ? count : `más de ${to}`}`}
                />
            </TableContainer>
        </Box>
    )
}

export default DeudoresTable