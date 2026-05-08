import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Box,
  IconButton,
  Tooltip,
  LinearProgress,
  TextField,
  MenuItem,
  Pagination,
  Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import CancelIcon from '@mui/icons-material/Cancel'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import InboxIcon from '@mui/icons-material/Inbox'
import {
  reportesV2Api,
  EjecucionV2,
  EstadoEjecucionV2,
} from '../../../api/reportes-v2'
import { useReportesV2Socket } from './hooks/useReportesV2Socket'
import { PageHeader, SectionCard, EmptyState, StatusChip, DataTableResponsive } from '../../../components/ui'
import type { StatusValue } from '../../../components/ui'
import type { DataTableColumn } from '../../../components/ui'
import { useNotify } from '../../../hooks/useNotify'
import { useConfirm } from '../../../context/ConfirmContext'

const ESTADOS: EstadoEjecucionV2[] = [
  'PENDIENTE',
  'EJECUTANDO',
  'FINALIZADA',
  'FALLIDA',
  'CANCELADA',
]

const estadoToStatus: Record<EstadoEjecucionV2, StatusValue> = {
  PENDIENTE: 'pending',
  EJECUTANDO: 'running',
  FINALIZADA: 'completed',
  FALLIDA: 'failed',
  CANCELADA: 'warning',
}

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function formatFecha(s: string | null | undefined): string {
  if (!s) return '-'
  try {
    return new Date(s).toLocaleString()
  } catch {
    return s
  }
}

const REFRESH_MS = 30_000

const ReportesV2Ejecuciones = () => {
  const notify = useNotify()
  const confirm = useConfirm()
  const [items, setItems] = useState<EjecucionV2[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [estado, setEstado] = useState<EstadoEjecucionV2 | ''>('')

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  )

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await reportesV2Api.listarEjecuciones({
        page,
        pageSize,
        estado: estado || undefined,
      })
      setItems(res.data.items)
      setTotal(res.data.total)
    } catch (err: any) {
      notify.error(err)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, estado])

  useEffect(() => {
    cargar()
  }, [cargar])

  useEffect(() => {
    const t = setInterval(cargar, REFRESH_MS)
    return () => clearInterval(t)
  }, [cargar])

  useReportesV2Socket({
    onProgreso: (p) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === p.ejecucionId
            ? {
                ...it,
                progreso: p.progreso,
                filasProcesadas: p.filasProcesadas,
                totalFilas: p.totalFilas ?? it.totalFilas,
                estado: 'EJECUTANDO',
              }
            : it,
        ),
      )
    },
    onCompletado: (p) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === p.ejecucionId
            ? {
                ...it,
                estado: 'FINALIZADA',
                progreso: 100,
                archivoTamano: p.archivoTamano,
                totalFilas: p.totalFilas,
                duracionMs: p.duracionMs,
              }
            : it,
        ),
      )
      notify.success(`Reporte #${p.ejecucionId} finalizado.`)
    },
    onFallido: (p) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === p.ejecucionId
            ? { ...it, estado: 'FALLIDA', errorMsg: p.error }
            : it,
        ),
      )
      notify.error(`Reporte #${p.ejecucionId} falló: ${p.error}`)
    },
  })

  const handleDescargar = async (item: EjecucionV2) => {
    try {
      const res = await reportesV2Api.descargarEjecucion(item.id)
      const ext = item.formato || 'bin'
      const filename = `${item.plantilla?.nombre || 'reporte'}_${item.id}.${ext}`
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      notify.success('Descarga iniciada')
    } catch (err: any) {
      notify.error(err)
    }
  }

  const handleCancelar = async (id: number) => {
    try {
      await reportesV2Api.cancelarEjecucion(id)
      notify.info(`Cancelación solicitada para #${id}`)
      cargar()
    } catch (err: any) {
      notify.error(err)
    }
  }

  const handleEliminar = async (id: number) => {
    const ok = await confirm({
      title: 'Eliminar ejecución',
      description: `¿Eliminar ejecución #${id}? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      confirmColor: 'error',
    })
    if (!ok) return
    try {
      await reportesV2Api.eliminarEjecucion(id)
      notify.success(`Ejecución #${id} eliminada`)
      cargar()
    } catch (err: any) {
      notify.error(err)
    }
  }

  const columns: DataTableColumn<EjecucionV2>[] = [
    {
      key: 'id',
      label: 'ID',
      render: (row) => String(row.id),
    },
    {
      key: 'plantilla',
      label: 'Plantilla',
      primary: true,
      render: (row) => row.plantilla?.nombre || `#${row.plantillaId}`,
    },
    {
      key: 'createdAt',
      label: 'Fecha',
      secondary: true,
      render: (row) => formatFecha(row.createdAt),
    },
    {
      key: 'estado',
      label: 'Estado',
      render: (row) => (
        <StatusChip
          status={estadoToStatus[row.estado]}
          label={row.estado}
        />
      ),
    },
    {
      key: 'progreso',
      label: 'Progreso',
      hideInCard: true,
      render: (row) =>
        row.estado === 'EJECUTANDO' || row.estado === 'PENDIENTE' ? (
          <Box>
            <LinearProgress
              variant={row.estado === 'PENDIENTE' ? 'indeterminate' : 'determinate'}
              value={row.progreso}
            />
            <Typography variant="caption" color="text.secondary">
              {row.filasProcesadas}
              {row.totalFilas ? ` / ${row.totalFilas}` : ''} ({row.progreso}%)
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {row.estado === 'FINALIZADA' ? 'Completo' : '-'}
          </Typography>
        ),
    },
    {
      key: 'formato',
      label: 'Formato',
      hideInCard: true,
      render: (row) => row.formato || row.plantilla?.formatoSalida || '-',
    },
    {
      key: 'totalFilas',
      label: 'Filas',
      align: 'right',
      hideInCard: true,
      render: (row) => String(row.totalFilas ?? '-'),
    },
    {
      key: 'archivoTamano',
      label: 'Tamaño',
      align: 'right',
      hideInCard: true,
      render: (row) => formatBytes(row.archivoTamano),
    },
    {
      key: 'acciones',
      label: 'Acciones',
      align: 'right',
      render: (row) => (
        <>
          <Tooltip title="Descargar">
            <span>
              <IconButton
                size="small"
                disabled={row.estado !== 'FINALIZADA'}
                onClick={() => handleDescargar(row)}
              >
                <DownloadIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Cancelar">
            <span>
              <IconButton
                size="small"
                disabled={row.estado !== 'PENDIENTE' && row.estado !== 'EJECUTANDO'}
                onClick={() => handleCancelar(row.id)}
              >
                <CancelIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Eliminar">
            <span>
              <IconButton
                size="small"
                disabled={row.estado === 'PENDIENTE' || row.estado === 'EJECUTANDO'}
                onClick={() => handleEliminar(row.id)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </>
      ),
    },
  ]

  const isRefreshing = loading && items.length > 0

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
      <PageHeader
        title="Mis ejecuciones"
        breadcrumbs={[
          { label: 'Reportes', href: '/reportes/v2' },
          { label: 'Ejecuciones' },
        ]}
        actions={[
          {
            label: 'Refrescar',
            onClick: cargar,
            startIcon: <RefreshIcon />,
            variant: 'outlined',
          },
        ]}
      />

      <SectionCard sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            select
            label="Estado"
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value as EstadoEjecucionV2 | '')
              setPage(1)
            }}
            size="small"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">Todos</MenuItem>
            {ESTADOS.map((e) => (
              <MenuItem key={e} value={e}>
                {e}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </SectionCard>

      <SectionCard noPadding sx={{ position: 'relative' }}>
        {isRefreshing && (
          <LinearProgress
            sx={{ position: 'absolute', top: 0, left: 0, right: 0, borderRadius: '8px 8px 0 0' }}
          />
        )}

        {loading && items.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <EmptyState
              icon={<InboxIcon />}
              title="No hay ejecuciones"
              description="Cuando ejecutes una plantilla aparecerá acá"
            />
          </Box>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<InboxIcon />}
            title="No hay ejecuciones"
            description="Cuando ejecutes una plantilla aparecerá acá"
          />
        ) : (
          <>
            <DataTableResponsive
              columns={columns}
              rows={items}
              rowKey={(row) => String(row.id)}
            />
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                color="primary"
              />
            </Box>
          </>
        )}
      </SectionCard>
    </Box>
  )
}

export default ReportesV2Ejecuciones
