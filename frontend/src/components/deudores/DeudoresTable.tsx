// src/components/deudores/DeudoresTable.tsx
import React, { useEffect, useState } from 'react'
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

    useEffect(() => {
        api.get('/deudores') // ⚠️ Ajustá si usás prefijo o proxy
            .then(res => setDeudores(res.data))
            .catch(err => console.error('Error cargando deudores:', err))
    }, [])

    const deudoresFiltrados = deudores.filter(d =>
        `${d.id} ${d.nombre} ${d.apellido} ${d.documento}`.toLowerCase().includes(filtro.toLowerCase())
    )

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Lista de Deudores</Typography>
            <TextField
                fullWidth
                variant="outlined"
                label="Buscar por nombre o documento"
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
                        {deudoresFiltrados.map((d) => (
                            <TableRow
                                key={d.id}
                                hover
                                selected={selectedDeudorId === d.id}
                                onClick={() => setSelectedDeudorId(d.id)}
                                sx={{ cursor: 'pointer' }}
                            >
                                <TableCell>{d.id}</TableCell>
                                <TableCell>{d.empresaId}</TableCell>
                                <TableCell>{d.camposAdicionales.nro_cliente || '-'}</TableCell>
                                <TableCell>{d.remesa.numeroRemesa}</TableCell>
                                <TableCell>{d.documento}</TableCell>
                                <TableCell>{d.nombre} {d.apellido}</TableCell>
                                <TableCell>${d.montoTotal?.toLocaleString('es-AR') ?? '-'}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    )
}

export default DeudoresTable