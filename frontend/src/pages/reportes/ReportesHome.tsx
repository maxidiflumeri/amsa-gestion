import React, { useState, useEffect } from 'react'
import {
  Box, Typography, Divider, Card, CardContent, CardActions,
  IconButton, Chip, Stack, Fab, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Button, Grid
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { useNavigate } from 'react-router-dom'
import api from '../../api/axios'

interface Plantilla {
  id: number
  nombre: string
  descripcion: string
  tipo: string
  fuente: string
  formatoSalida: string
  empresaId?: number
  activo: boolean
  empresa?: { nombre: string }
}

const ReportesHome: React.FC = () => {
  const navigate = useNavigate()
  const [plantillas, setPlantillas] = useState<Plantilla[]>([])
  const [deleteDialog, setDeleteDialog] = useState<number | null>(null)

  const fetchPlantillas = async () => {
    try {
      const res = await api.get('/reportes/plantillas')
      setPlantillas(res.data)
    } catch (error) {
      console.error('Error fetching plantillas:', error)
    }
  }

  useEffect(() => {
    fetchPlantillas()
  }, [])

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/reportes/plantillas/${id}`)
      setDeleteDialog(null)
      fetchPlantillas()
    } catch (error) {
      console.error('Error deleting plantilla:', error)
    }
  }

  const getTipoColor = (tipo: string): 'default' | 'primary' | 'secondary' | 'success' => {
    switch (tipo) {
      case 'base': return 'primary'
      case 'informe': return 'secondary'
      case 'estadistico': return 'success'
      default: return 'default'
    }
  }

  const getFormatoColor = (formato: string): 'default' | 'info' | 'success' | 'warning' => {
    switch (formato) {
      case 'xlsx': return 'success'
      case 'csv': return 'info'
      case 'pdf': return 'warning'
      default: return 'default'
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
          Mis Plantillas de Reportes
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Administre y ejecute plantillas de reportes personalizados.
        </Typography>
        <Divider sx={{ mt: 2 }} />
      </Box>

      <Grid container spacing={2}>
        {plantillas.map((plantilla) => (
          <Grid item xs={12} sm={6} md={4} key={plantilla.id}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography variant="h6" gutterBottom>
                  {plantilla.nombre}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, minHeight: 40 }}>
                  {plantilla.descripcion || 'Sin descripción'}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                  <Chip label={plantilla.tipo} size="small" color={getTipoColor(plantilla.tipo)} />
                  <Chip label={plantilla.formatoSalida.toUpperCase()} size="small" color={getFormatoColor(plantilla.formatoSalida)} />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {plantilla.empresa ? plantilla.empresa.nombre : 'Global'}
                </Typography>
              </CardContent>
              <CardActions sx={{ justifyContent: 'flex-end', px: 2, pb: 2 }}>
                <IconButton
                  size="small"
                  color="success"
                  onClick={() => navigate(`/reportes/${plantilla.id}/ejecutar`)}
                  title="Ejecutar"
                >
                  <PlayArrowIcon />
                </IconButton>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => navigate(`/reportes/${plantilla.id}/editar`)}
                  title="Editar"
                >
                  <EditIcon />
                </IconButton>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setDeleteDialog(plantilla.id)}
                  title="Eliminar"
                >
                  <DeleteIcon />
                </IconButton>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {plantillas.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8, color: 'text.disabled' }}>
          <Typography variant="h6">No hay plantillas creadas</Typography>
          <Typography variant="body2">Haga clic en el botón + para crear su primera plantilla</Typography>
        </Box>
      )}

      <Fab
        color="primary"
        aria-label="nueva plantilla"
        sx={{ position: 'fixed', bottom: 24, right: 24 }}
        onClick={() => navigate('/reportes/nueva')}
      >
        <AddIcon />
      </Fab>

      <Dialog
        open={deleteDialog !== null}
        onClose={() => setDeleteDialog(null)}
      >
        <DialogTitle>Confirmar eliminación</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ¿Está seguro que desea eliminar esta plantilla? Esta acción no se puede deshacer.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(null)}>Cancelar</Button>
          <Button onClick={() => deleteDialog && handleDelete(deleteDialog)} color="error" variant="contained">
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ReportesHome
