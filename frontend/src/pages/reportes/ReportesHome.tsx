import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconButton,
  Box,
  Stack,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import BusinessIcon from '@mui/icons-material/Business'
import AssessmentIcon from '@mui/icons-material/Assessment'
import { Tooltip } from '@mui/material'
import api from '../../api/axios'
import { reportesApi } from '../../api/reportes'
import { Plantilla } from '../../types/reportes'
import { PageHeader, SectionCard, EmptyState, LoadingSkeleton, DataTableResponsive } from '../../components/ui'
import type { DataTableColumn } from '../../components/ui'
import { useNotify } from '../../hooks/useNotify'
import { useConfirm } from '../../context/ConfirmContext'
import ClonarPlantillaDialog, { type EmpresaOpt } from '../../components/plantillas/ClonarPlantillaDialog'
import CambiarEmpresaDialog from '../../components/plantillas/CambiarEmpresaDialog'

const ReportesHome = () => {
  const navigate = useNavigate()
  const notify = useNotify()
  const confirm = useConfirm()
  const [plantillas, setPlantillas] = useState<Plantilla[]>([])
  const [loading, setLoading] = useState(true)
  const [empresas, setEmpresas] = useState<EmpresaOpt[]>([])
  const [cloneTarget, setCloneTarget] = useState<Plantilla | null>(null)
  const [moveTarget, setMoveTarget] = useState<Plantilla | null>(null)

  useEffect(() => {
    loadPlantillas()
    api.get('/empresas')
      .then((res) => setEmpresas(res.data))
      .catch((err) => notify.error(err))
  }, [])

  const loadPlantillas = async () => {
    try {
      setLoading(true)
      const res = await reportesApi.listarPlantillas()
      const items: Plantilla[] = (res.data || []).slice().sort((a: any, b: any) => {
        const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime()
        const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime()
        return dateB - dateA
      })
      setPlantillas(items)
    } catch (err: any) {
      notify.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleClonar = async (data: { nombre: string; empresaId: number | null }) => {
    if (!cloneTarget?.id) return
    try {
      await reportesApi.duplicarPlantilla(cloneTarget.id, data)
      notify.success('Plantilla clonada')
      setCloneTarget(null)
      loadPlantillas()
    } catch (err: any) {
      notify.error(err)
    }
  }

  const handleCambiarEmpresa = async (empresaId: number | null) => {
    if (!moveTarget?.id) return
    try {
      await reportesApi.cambiarEmpresaPlantilla(moveTarget.id, empresaId)
      notify.success('Plantilla movida de empresa')
      setMoveTarget(null)
      loadPlantillas()
    } catch (err: any) {
      notify.error(err)
    }
  }

  const handleDelete = async (plantilla: Plantilla) => {
    if (!plantilla.id) return
    const ok = await confirm({
      title: 'Desactivar plantilla',
      description: `¿Estás seguro de desactivar "${plantilla.nombre}"?`,
      confirmLabel: 'Desactivar',
      confirmColor: 'error',
    })
    if (!ok) return
    try {
      await reportesApi.eliminarPlantilla(plantilla.id)
      notify.success('Plantilla desactivada')
      loadPlantillas()
    } catch (err: any) {
      notify.error(err)
    }
  }

  const columns: DataTableColumn<Plantilla>[] = [
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
      key: 'empresa',
      label: 'Empresa',
      hideInCard: true,
      render: (row) => (row as any).empresa?.nombre || (row as any).empresaId || 'Global',
    },
    {
      key: 'formato',
      label: 'Formato',
      hideInCard: true,
      render: (row) => row.formatoSalida.toUpperCase(),
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
          <IconButton
            size="small"
            onClick={() => navigate(`/reportes/${row.id}/ejecutar`)}
            title="Ejecutar"
          >
            <PlayArrowIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => navigate(`/reportes/${row.id}/editar`)}
            title="Editar"
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => setCloneTarget(row)}
            title="Clonar"
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
          <Tooltip
            title={
              ((row._count?.ejecuciones ?? 0) > 0)
                ? 'No se puede cambiar de empresa: la plantilla ya tiene ejecuciones'
                : 'Cambiar de empresa'
            }
          >
            <span>
              <IconButton
                size="small"
                color="warning"
                disabled={(row._count?.ejecuciones ?? 0) > 0}
                onClick={() => setMoveTarget(row)}
              >
                <BusinessIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton
            size="small"
            onClick={() => handleDelete(row)}
            title="Desactivar"
            color="error"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
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
            onClick: () => navigate('/reportes/nuevo'),
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
          description="Creá tu primera plantilla de reportes"
          action={{ label: 'Nueva plantilla', onClick: () => navigate('/reportes/nuevo') }}
        />
      ) : (
        <SectionCard noPadding>
          <DataTableResponsive
            columns={columns}
            rows={plantillas}
            rowKey={(row) => String(row.id)}
          />
        </SectionCard>
      )}

      <ClonarPlantillaDialog
        open={!!cloneTarget}
        onClose={() => setCloneTarget(null)}
        nombreActual={cloneTarget?.nombre ?? ''}
        empresaActualId={cloneTarget?.empresaId ?? null}
        empresas={empresas}
        permitirGlobal
        onConfirm={handleClonar}
      />
      <CambiarEmpresaDialog
        open={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        empresaActualId={moveTarget?.empresaId ?? null}
        empresas={empresas}
        permitirGlobal
        onConfirm={handleCambiarEmpresa}
      />
    </Box>
  )
}

export default ReportesHome
