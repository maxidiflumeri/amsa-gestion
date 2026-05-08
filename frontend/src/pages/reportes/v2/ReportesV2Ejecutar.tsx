import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Button } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import { reportesV2Api } from '../../../api/reportes-v2'
import { PlantillaV2 } from '../../../types/reportes-v2'
import { PageHeader, SectionCard, EmptyState, LoadingSkeleton } from '../../../components/ui'
import { useNotify } from '../../../hooks/useNotify'
import ExecutionForm from './components/ExecutionForm/ExecutionForm'

const ReportesV2Ejecutar = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const notify = useNotify()
  const [plantilla, setPlantilla] = useState<PlantillaV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) {
      navigate('/reportes/v2')
      return
    }

    const loadPlantilla = async () => {
      try {
        const res = await reportesV2Api.obtenerPlantilla(parseInt(id))
        setPlantilla(res.data)
      } catch (err: any) {
        notify.error(err)
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }

    loadPlantilla()
  }, [id, navigate])

  if (loading) {
    return (
      <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
        <LoadingSkeleton variant="form" />
      </Box>
    )
  }

  if (notFound || !plantilla) {
    return (
      <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
        <EmptyState
          icon={<ErrorOutlineIcon />}
          title="Plantilla no encontrada"
          action={{ label: 'Volver', onClick: () => navigate('/reportes/v2') }}
        />
      </Box>
    )
  }

  const filtrosVariables = plantilla.definicion.filtros?.filter(f => f.variable) || []

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
      <PageHeader
        title={plantilla.nombre}
        subtitle={plantilla.descripcion}
        breadcrumbs={[
          { label: 'Reportes', href: '/reportes/v2' },
          { label: 'Ejecutar' },
        ]}
      />

      <SectionCard>
        <ExecutionForm plantillaId={plantilla.id!} filtrosVariables={filtrosVariables} />
      </SectionCard>
    </Box>
  )
}

export default ReportesV2Ejecutar
