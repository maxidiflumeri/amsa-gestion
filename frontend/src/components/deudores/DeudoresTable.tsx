// src/components/deudores/DeudoresTable.tsx
import React, { useEffect, useState, useCallback } from 'react'
import { Box, TableContainer, TablePagination, TextField, Stack } from '@mui/material'
import { DataTableResponsive, EmptyState, LoadingSkeleton, SectionCard } from '../ui'
import type { DataTableColumn } from '../ui'
import api from '../../api/axios'
import { useNotify } from '../../hooks/useNotify'
import { mostrarDocumento } from '../../utils/documento'

interface Deudor {
    id: number
    empresaId: number
    remesa: any
    documento: string
    nombre: string
    nroCliente?: string | null
    camposAdicionales: any
    apellido: string
    montoTotal: number | null
    estadoSituacionId?: number
    estadoGestionId?: number
}

type DeudorRow = Deudor & Record<string, unknown>

interface Props {
    selectedDeudorId: number | null
    setSelectedDeudorId: (id: number | null) => void
    onDoubleClickRow?: () => void
}

const columns: DataTableColumn<DeudorRow>[] = [
    { key: 'id', label: 'ID', width: 70, hideInCard: true },
    {
        key: 'documento',
        label: 'Documento',
        primary: true,
        render: (row) => mostrarDocumento(row.documento as string),
    },
    {
        key: 'nombreApellido',
        label: 'Cliente',
        secondary: true,
        render: (row) => `${row.nombre} ${row.apellido}`,
    },
    { key: 'empresaId', label: 'Empresa ID' },
    {
        key: 'nro_cliente',
        label: 'Nº Cliente',
        render: (row) =>
            (row as any).nroCliente || (row.camposAdicionales as any)?.nro_cliente || '-',
    },
    {
        key: 'numeroRemesa',
        label: 'Remesa',
        render: (row) => (row.remesa as any)?.numeroRemesa || '-',
    },
    {
        key: 'montoTotal',
        label: 'Monto',
        align: 'right',
        render: (row) =>
            row.montoTotal != null
                ? `$${(row.montoTotal as number).toLocaleString('es-AR')}`
                : '-',
    },
]

const DeudoresTable: React.FC<Props> = ({ selectedDeudorId, setSelectedDeudorId, onDoubleClickRow }) => {
    const notify = useNotify()
    const [deudores, setDeudores] = useState<DeudorRow[]>([])
    const [filtro, setFiltro] = useState('')
    const [debouncedFiltro, setDebouncedFiltro] = useState('')
    const [firstLoad, setFirstLoad] = useState(true)
    const [loading, setLoading] = useState(true)

    const [page, setPage] = useState(0)
    const [rowsPerPage, setRowsPerPage] = useState(10)
    const [totalRows, setTotalRows] = useState(0)

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedFiltro(filtro)
            setPage(0)
        }, 500)
        return () => clearTimeout(timer)
    }, [filtro])

    const fetchDeudores = useCallback(() => {
        setLoading(true)
        api.get('/deudores', {
            params: {
                page: page + 1,
                limit: rowsPerPage,
                search: debouncedFiltro || undefined,
            },
        })
            .then((res) => {
                if (res.data && res.data.data) {
                    setDeudores(res.data.data as DeudorRow[])
                    setTotalRows(res.data.meta.total)
                } else if (Array.isArray(res.data)) {
                    setDeudores(res.data as DeudorRow[])
                    setTotalRows(res.data.length)
                }
            })
            .catch((err) => notify.error(err))
            .finally(() => {
                setLoading(false)
                setFirstLoad(false)
            })
    }, [page, rowsPerPage, debouncedFiltro])

    useEffect(() => {
        fetchDeudores()
    }, [fetchDeudores])

    const handleChangePage = (_: unknown, newPage: number) => setPage(newPage)

    const handleChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRowsPerPage(parseInt(e.target.value, 10))
        setPage(0)
    }

    // Wrapping para double-click: DataTableResponsive solo expone onRowClick,
    // manejamos doble click con un ref de tiempo
    const lastClickRef = React.useRef<{ id: number; time: number } | null>(null)

    const handleRowClick = (row: DeudorRow) => {
        const now = Date.now()
        if (
            lastClickRef.current &&
            lastClickRef.current.id === row.id &&
            now - lastClickRef.current.time < 400
        ) {
            // Doble click
            setSelectedDeudorId(row.id)
            onDoubleClickRow?.()
            lastClickRef.current = null
        } else {
            setSelectedDeudorId(row.id)
            lastClickRef.current = { id: row.id, time: now }
        }
    }

    return (
        <Box>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <TextField
                    fullWidth
                    variant="outlined"
                    label="Buscar por ID, nombre o documento"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                    size="small"
                />
            </Stack>

            <SectionCard noPadding>
                {firstLoad && loading ? (
                    <Box sx={{ p: 2 }}>
                        <LoadingSkeleton variant="table" rows={rowsPerPage} columns={7} />
                    </Box>
                ) : deudores.length === 0 ? (
                    <EmptyState
                        title="Sin deudores"
                        description={
                            debouncedFiltro
                                ? `No se encontraron deudores para "${debouncedFiltro}".`
                                : 'No hay deudores cargados en el sistema.'
                        }
                    />
                ) : (
                    <TableContainer>
                        <DataTableResponsive<DeudorRow>
                            columns={columns}
                            rows={deudores}
                            rowKey={(row) => String(row.id)}
                            onRowClick={handleRowClick}
                        />
                    </TableContainer>
                )}

                <TablePagination
                    rowsPerPageOptions={[10, 25, 50, 100]}
                    component="div"
                    count={totalRows}
                    rowsPerPage={rowsPerPage}
                    page={page}
                    onPageChange={handleChangePage}
                    onRowsPerPageChange={handleChangeRowsPerPage}
                    labelRowsPerPage="Filas por página"
                    labelDisplayedRows={({ from, to, count }) =>
                        `${from}–${to} de ${count !== -1 ? count : `más de ${to}`}`
                    }
                />
            </SectionCard>
        </Box>
    )
}

export default DeudoresTable
