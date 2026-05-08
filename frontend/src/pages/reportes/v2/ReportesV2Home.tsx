import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Chip,
  IconButton,
  Box,
  Stack,
  Button,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import AssessmentIcon from '@mui/icons-material/Assessment'
import { reportesV2Api } from '../../../api/reportes-v2'
import api from '../../../api/axios'
import { PlantillaUnificada, PlantillaV2 } from '../../../types/reportes-v2'
import { PageHeader, SectionCard, EmptyState, LoadingSkeleton, DataTableResponsive } from '../../../components/ui'
import type { DataTableColumn } from '../../../components/ui'
import { useNotify } from '../../../hooks/useNotify'
import { useConfirm } from '../../../context/ConfirmContext'

const ReportesV2Home = () => {
  const navigate = useNavigate()
  const notify = useNotify()
  const confirm = useConfirm()
  const [plantillas, setPlantillas] = useState<PlantillaUnificada[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPlantillas()
  }, [])

  const loadPlantillas = async () => {
    try {
      setLoading(true)

      const [v1Res, v2Res] = await Promise.all([
        api.get('/reportes/plantillas').catch(() => ({ data: [] })),
        reportesV2Api.listarPlantillas().catch(() => ({ data: [] })),
      ])

      const v1Plantillas: PlantillaUnificada[] = (v1Res.data || []).map((p: any) => ({
        ...p,
        _version: 'v1' as const,
      }))

      const v2Plantillas: PlantillaUnificada[] = (v2Res.data || []).map((p: PlantillaV2) => ({
        ...p,
        _version: 'v2' as const,
      }))

      const merged = [...v1Plantillas, ...v2Plantillas].sort((a, b) => {
        const dateA = new Date((a as any).updatedAt || (a as any).createdAt || 0).getTime()
        const dateB = new Date((b as any).updatedAt || (b as any).createdAt || 0).getTime()
        return dateB - dateA
      })

      setPlantillas(merged)
    } catch (err: any) {
      notify.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleDuplicate = async (plantilla: PlantillaUnificada) => {
    if (plantilla._version === 'v2' && plantilla.id) {
      try {
        await reportesV2Api.duplicarPlantilla(plantilla.id)
        notify.success('Plantilla duplicada')
        loadPlantillas()
      } catch (err: any) {
        notify.error(err)
      }
    }
  }

  const handleDelete = async (plantilla: PlantillaUnificada) => {
    if (plantilla._version === 'v2' && plantilla.id) {
      const ok = await confirm({
        title: 'Desactivar plantilla',
        description: `¿Estás seguro de desactivar "${plantilla.nombre}"?`,
        confirmLabel: 'Desactivar',
        confirmColor: 'error',
      })
      if (!ok) return
      try {
        await reportesV2Api.eliminarPlantilla(plantilla.id)
        notify.success('Plantilla desactivada')
        loadPlantillas()
      } catch (err: any) {
        notify.error(err)
      }
    }
  }

  const columns: DataTableColumn<PlantillaUnificada>[] = [
    {
      key: 'nombre',
      label: 'Nombre',
      primary: true,
      render: (row) => row.nombre || '-',
    },
    {
      key: 'descripcion',
      label: 'Descripción',
      secondary: true,
      render: (row) => (row as any).descripcion || '-',
    },
    {
      key: '_version',
      label: 'Versión',
      render: (row) => (
        <Chip
          label={row._version.toUpperCase()}
          size="small"
          color={row._version === 'v2' ? 'success' : 'primary'}
        />
      ),
    },
    {
      key: 'empresa',
      label: 'Empresa',
      hideInCard: true,
      render: (row) => (row as any).empresa?.nombre || (row as any).empresaId || 'Global',
    },
    {
      key: 'formato',
      label: 'Formato',
      hideInCard: true,
      render: (row) =>
        row._version === 'v2'
          ? (row as PlantillaV2).formatoSalida.toUpperCase()
          : 'XLSX',
    },
    {
      key: 'updatedAt',
      label: 'Última modificación',
      hideInCard: true,
      render: (row) =>
        (row as any).updatedAt
          ? new Date((row as any).updatedAt).toLocaleDateString()
          : '-',
    },
    {
      key: 'acciones',
      label: 'Acciones',
      align: 'right',
      render: (row) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          {row._version === 'v2' ? (
            <>
              <IconButton
                size="small"
                onClick={() => navigate(`/reportes/v2/${row.id}/ejecutar`)}
                title="Ejecutar"
              >
                <PlayArrowIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => navigate(`/reportes/v2/${row.id}/editar`)}
                title="Editar"
              >
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => handleDuplicate(row)}
                title="Duplicar"
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => handleDelete(row)}
                title="Desactivar"
                color="error"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton
                size="small"
                onClick={() => navigate(`/reportes/${row.id}/ejecutar`)}
                title="Ejecutar (v1)"
              >
                <PlayArrowIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => navigate(`/reportes/${row.id}/editar`)}
                title="Editar (v1)"
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </>
          )}
        </Stack>
      ),
    },
  ]

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
      <PageHeader
        title="Reportes dinámicos"
        actions={[
          {
            label: 'Nueva plantilla',
            onClick: () => navigate('/reportes/v2/nuevo'),
            startIcon: <AddIcon />,
            variant: 'contained',
          },
        ]}
      />

      {loading && plantillas.length === 0 ? (
        <SectionCard>
          <LoadingSkeleton variant="table" rows={5} />
        </SectionCard>
      ) : plantillas.length === 0 ? (
        <EmptyState
          icon={<AssessmentIcon />}
          title="No hay plantillas"
          description="Creá tu primera plantilla v2"
          action={{ label: 'Nueva plantilla', onClick: () => navigate('/reportes/v2/nuevo') }}
        />
      ) : (
        <SectionCard noPadding>
          <DataTableResponsive
            columns={columns}
            rows={plantillas}
            rowKey={(row) => `${row._version}-${row.id}`}
          />
        </SectionCard>
      )}
    </Box>
  )
}

export default ReportesV2Home
