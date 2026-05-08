import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Container,
  Paper,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Button,
  Breadcrumbs,
  Link,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { reportesV2Api } from '../../../api/reportes-v2'
import { PlantillaV2 } from '../../../types/reportes-v2'
import ExecutionForm from './components/ExecutionForm/ExecutionForm'

const ReportesV2Ejecutar = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [plantilla, setPlantilla] = useState<PlantillaV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        setError(err.response?.data?.message || 'Error al cargar la plantilla')
      } finally {
        setLoading(false)
      }
    }

    loadPlantilla()
  }, [id, navigate])

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      </Container>
    )
  }

  if (error || !plantilla) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Alert severity="error">{error || 'Plantilla no encontrada'}</Alert>
        <Box sx={{ mt: 2 }}>
          <Button variant="outlined" onClick={() => navigate('/reportes/v2')}>
            Volver a reportes
          </Button>
        </Box>
      </Container>
    )
  }

  const filtrosVariables = plantilla.definicion.filtros?.filter(f => f.variable) || []

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link
          component="button"
          variant="body2"
          onClick={() => navigate('/reportes/v2')}
          sx={{ cursor: 'pointer' }}
        >
          Reportes
        </Link>
        <Typography variant="body2" color="text.primary">
          Ejecutar
        </Typography>
      </Breadcrumbs>

      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/reportes/v2')}
          size="small"
        >
          Volver
        </Button>
      </Box>

      <Paper sx={{ p: 4 }}>
        <Typography variant="h4" gutterBottom>
          {plantilla.nombre}
        </Typography>

        {plantilla.descripcion && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {plantilla.descripcion}
          </Typography>
        )}

        <ExecutionForm plantillaId={plantilla.id!} filtrosVariables={filtrosVariables} />
      </Paper>
    </Container>
  )
}

export default ReportesV2Ejecutar
