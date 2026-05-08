import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Container,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Box,
  CircularProgress,
  Alert,
  Stack,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { reportesV2Api } from '../../../api/reportes-v2'
import api from '../../../api/axios'
import { PlantillaUnificada, PlantillaV2 } from '../../../types/reportes-v2'

const ReportesV2Home = () => {
  const navigate = useNavigate()
  const [plantillas, setPlantillas] = useState<PlantillaUnificada[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      setError(err.response?.data?.message || 'Error al cargar plantillas')
    } finally {
      setLoading(false)
    }
  }

  const handleDuplicate = async (plantilla: PlantillaUnificada) => {
    if (plantilla._version === 'v2' && plantilla.id) {
      try {
        await reportesV2Api.duplicarPlantilla(plantilla.id)
        loadPlantillas()
      } catch (err: any) {
        setError(err.response?.data?.message || 'Error al duplicar plantilla')
      }
    }
  }

  const handleDelete = async (plantilla: PlantillaUnificada) => {
    if (plantilla._version === 'v2' && plantilla.id) {
      if (window.confirm(`¿Está seguro de desactivar la plantilla "${plantilla.nombre}"?`)) {
        try {
          await reportesV2Api.eliminarPlantilla(plantilla.id)
          loadPlantillas()
        } catch (err: any) {
          setError(err.response?.data?.message || 'Error al eliminar plantilla')
        }
      }
    }
  }

  if (loading) {
    return (
      <Container sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    )
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Typography variant="h4">Reportes dinámicos</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/reportes/v2/nuevo')}
        >
          Nueva plantilla v2
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Nombre</TableCell>
              <TableCell>Descripción</TableCell>
              <TableCell>Versión</TableCell>
              <TableCell>Empresa</TableCell>
              <TableCell>Formato</TableCell>
              <TableCell>Última modificación</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plantillas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                    No hay plantillas creadas. Crea tu primera plantilla v2.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              plantillas.map(plantilla => (
                <TableRow key={`${plantilla._version}-${plantilla.id}`}>
                  <TableCell>{plantilla.nombre}</TableCell>
                  <TableCell>{plantilla.descripcion || '-'}</TableCell>
                  <TableCell>
                    <Chip
                      label={plantilla._version.toUpperCase()}
                      size="small"
                      color={plantilla._version === 'v2' ? 'success' : 'primary'}
                    />
                  </TableCell>
                  <TableCell>
                    {(plantilla as any).empresa?.nombre || (plantilla as any).empresaId || 'Global'}
                  </TableCell>
                  <TableCell>
                    {plantilla._version === 'v2'
                      ? (plantilla as PlantillaV2).formatoSalida.toUpperCase()
                      : 'XLSX'}
                  </TableCell>
                  <TableCell>
                    {(plantilla as any).updatedAt
                      ? new Date((plantilla as any).updatedAt).toLocaleDateString()
                      : '-'}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      {plantilla._version === 'v2' ? (
                        <>
                          <IconButton
                            size="small"
                            disabled
                            title="Disponible en Fase 4"
                          >
                            <PlayArrowIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/reportes/v2/${plantilla.id}/editar`)}
                            title="Editar"
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => handleDuplicate(plantilla)}
                            title="Duplicar"
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => handleDelete(plantilla)}
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
                            onClick={() => navigate(`/reportes/${plantilla.id}/ejecutar`)}
                            title="Ejecutar (v1)"
                          >
                            <PlayArrowIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/reportes/${plantilla.id}/editar`)}
                            title="Editar (v1)"
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  )
}

export default ReportesV2Home
