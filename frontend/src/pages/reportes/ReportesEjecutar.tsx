import React, { useState, useEffect } from 'react'
import {
  Box, Typography, Divider, Paper, Button, TextField, CircularProgress,
  Stack, Chip, Autocomplete, FormControlLabel, Switch
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../api/axios'

interface Plantilla {
  id: number
  nombre: string
  descripcion: string
  tipo: string
  fuente: string
  filtrosFijos: any
  filtrosVars: string[]
  columnas: string[]
  formatoSalida: string
}

interface Empresa {
  id: number
  nombre: string
}

interface Remesa {
  id: number
  nombre: string
  numeroRemesa: string
}

interface Parametro {
  clave: string
  descripcion: string
}

const ReportesEjecutar: React.FC = () => {
  const { id } = useParams()
  const navigate = useNavigate()

  const [plantilla, setPlantilla] = useState<Plantilla | null>(null)
  const [loading, setLoading] = useState(true)
  const [ejecutando, setEjecutando] = useState(false)
  const [filtrosVariables, setFiltrosVariables] = useState<any>({})

  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [remesas, setRemesas] = useState<Remesa[]>([])
  const [situaciones, setSituaciones] = useState<Parametro[]>([])
  const [gestiones, setGestiones] = useState<Parametro[]>([])

  useEffect(() => {
    fetchPlantilla()
    fetchEmpresas()
    fetchRemesas()
    fetchSituaciones()
    fetchGestiones()
  }, [id])

  useEffect(() => {
    if (filtrosVariables.empresaIds) {
      fetchRemesas(filtrosVariables.empresaIds)
    }
  }, [filtrosVariables.empresaIds])

  const fetchPlantilla = async () => {
    try {
      const res = await api.get(`/reportes/plantillas/${id}`)
      setPlantilla(res.data)
    } catch (error) {
      console.error('Error fetching plantilla:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchEmpresas = async () => {
    try {
      const res = await api.get('/empresas')
      setEmpresas(res.data)
    } catch (error) {
      console.error('Error fetching empresas:', error)
    }
  }

  const fetchRemesas = async (empresaIds?: number[]) => {
    try {
      const qs = empresaIds?.length ? `?empresaId=${empresaIds[0]}` : ''
      const res = await api.get(`/reportes/remesas${qs}`)
      setRemesas(res.data)
    } catch (error) {
      console.error('Error fetching remesas:', error)
    }
  }

  const fetchSituaciones = async () => {
    try {
      const res = await api.get('/parametros?grupo=situacion&activo=true')
      setSituaciones(res.data)
    } catch (error) {
      console.error('Error fetching situaciones:', error)
    }
  }

  const fetchGestiones = async () => {
    try {
      const res = await api.get('/parametros?grupo=gestion&activo=true')
      setGestiones(res.data)
    } catch (error) {
      console.error('Error fetching gestiones:', error)
    }
  }

  const handleEjecutar = async () => {
    setEjecutando(true)
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/reportes/plantillas/${id}/ejecutar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          filtrosVars: filtrosVariables
        })
      })

      if (!response.ok) throw new Error('Error al generar el reporte')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reporte_${plantilla?.nombre}_${new Date().getTime()}.${plantilla?.formatoSalida}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Error ejecutando reporte:', error)
      alert('Error al generar el reporte')
    } finally {
      setEjecutando(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!plantilla) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Plantilla no encontrada</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
          Ejecutar Reporte
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {plantilla.nombre}
        </Typography>
        <Divider sx={{ mt: 2 }} />
      </Box>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Información del Reporte</Typography>
        <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Descripción</Typography>
            <Typography>{plantilla.descripcion || 'Sin descripción'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Tipo</Typography>
            <Box sx={{ mt: 0.5 }}>
              <Chip label={plantilla.tipo} size="small" color="primary" />
            </Box>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Formato de Salida</Typography>
            <Box sx={{ mt: 0.5 }}>
              <Chip label={plantilla.formatoSalida.toUpperCase()} size="small" color="success" />
            </Box>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Columnas</Typography>
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
              {plantilla.columnas.map((col: any) => {
                const isObj = typeof col === 'object' && col !== null;
                const campo = isObj ? col.campo : col;
                const label = isObj ? (col.label || col.campo) : col;
                return <Chip key={campo} label={label} size="small" variant="outlined" />;
              })}
            </Stack>
          </Box>
        </Box>
      </Paper>

      {plantilla.filtrosVars.length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Filtros Variables</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Configure los filtros para este reporte:
          </Typography>
          <Box sx={{ display: 'grid', gap: 2 }}>
            {plantilla.filtrosVars.includes('empresaIds') && (
              <Autocomplete
                multiple
                options={empresas}
                getOptionLabel={(e) => e.nombre}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                onChange={(_, val) => setFiltrosVariables({
                  ...filtrosVariables,
                  empresaIds: val.map(v => v.id)
                })}
                renderInput={(params) => <TextField {...params} label="Empresas" />}
              />
            )}

            {plantilla.filtrosVars.includes('remesasIds') && (
              <Autocomplete
                multiple
                options={remesas}
                getOptionLabel={(r) => `${r.numeroRemesa} - ${r.nombre}`}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                onChange={(_, val) => setFiltrosVariables({
                  ...filtrosVariables,
                  remesasIds: val.map(v => v.id)
                })}
                renderInput={(params) => <TextField {...params} label="Remesas" />}
              />
            )}

            {plantilla.filtrosVars.includes('situacionDesde') && (
              <>
                <Autocomplete
                  options={situaciones}
                  getOptionLabel={(s) => `${s.clave} - ${s.descripcion}`}
                  isOptionEqualToValue={(option, value) => option.clave === value.clave}
                  onChange={(_, val) => setFiltrosVariables({
                    ...filtrosVariables,
                    situacionDesde: val?.clave
                  })}
                  renderInput={(params) => <TextField {...params} label="Situación Desde" />}
                />
                <Autocomplete
                  options={situaciones}
                  getOptionLabel={(s) => `${s.clave} - ${s.descripcion}`}
                  isOptionEqualToValue={(option, value) => option.clave === value.clave}
                  onChange={(_, val) => setFiltrosVariables({
                    ...filtrosVariables,
                    situacionHasta: val?.clave
                  })}
                  renderInput={(params) => <TextField {...params} label="Situación Hasta" />}
                />
                <Autocomplete
                  multiple
                  options={situaciones}
                  getOptionLabel={(s) => `${s.clave} - ${s.descripcion}`}
                  isOptionEqualToValue={(option, value) => option.clave === value.clave}
                  onChange={(_, val) => setFiltrosVariables({
                    ...filtrosVariables,
                    situacionExcluir: val.map(v => v.clave)
                  })}
                  renderInput={(params) => <TextField {...params} label="Situaciones a Excluir" />}
                />
              </>
            )}

            {plantilla.filtrosVars.includes('gestionDesde') && (
              <>
                <Autocomplete
                  options={gestiones}
                  getOptionLabel={(g) => `${g.clave} - ${g.descripcion}`}
                  isOptionEqualToValue={(option, value) => option.clave === value.clave}
                  onChange={(_, val) => setFiltrosVariables({
                    ...filtrosVariables,
                    gestionDesde: val?.clave
                  })}
                  renderInput={(params) => <TextField {...params} label="Gestión Desde" />}
                />
                <Autocomplete
                  options={gestiones}
                  getOptionLabel={(g) => `${g.clave} - ${g.descripcion}`}
                  isOptionEqualToValue={(option, value) => option.clave === value.clave}
                  onChange={(_, val) => setFiltrosVariables({
                    ...filtrosVariables,
                    gestionHasta: val?.clave
                  })}
                  renderInput={(params) => <TextField {...params} label="Gestión Hasta" />}
                />
                <Autocomplete
                  multiple
                  options={gestiones}
                  getOptionLabel={(g) => `${g.clave} - ${g.descripcion}`}
                  isOptionEqualToValue={(option, value) => option.clave === value.clave}
                  onChange={(_, val) => setFiltrosVariables({
                    ...filtrosVariables,
                    gestionExcluir: val.map(v => v.clave)
                  })}
                  renderInput={(params) => <TextField {...params} label="Gestiones a Excluir" />}
                />
              </>
            )}

            {plantilla.filtrosVars.includes('montoDesde') && (
              <>
                <TextField
                  label="Monto Desde"
                  type="number"
                  value={filtrosVariables.montoDesde || ''}
                  onChange={(e) => setFiltrosVariables({
                    ...filtrosVariables,
                    montoDesde: parseFloat(e.target.value) || 0
                  })}
                />
                <TextField
                  label="Monto Hasta"
                  type="number"
                  value={filtrosVariables.montoHasta || ''}
                  onChange={(e) => setFiltrosVariables({
                    ...filtrosVariables,
                    montoHasta: parseFloat(e.target.value) || 0
                  })}
                />
                <TextField
                  label="Montos a Excluir (ej: 0)"
                  value={filtrosVariables.montoExcluir || ''}
                  onChange={(e) => setFiltrosVariables({
                    ...filtrosVariables,
                    montoExcluir: e.target.value
                  })}
                />
              </>
            )}

            {plantilla.filtrosVars.includes('tieneTelefono') && (
              <FormControlLabel
                control={
                  <Switch
                    checked={filtrosVariables.tieneTelefono || false}
                    onChange={(e) => setFiltrosVariables({
                      ...filtrosVariables,
                      tieneTelefono: e.target.checked
                    })}
                  />
                }
                label="Solo deudores con Teléfono"
              />
            )}

            {plantilla.filtrosVars.includes('tieneEmail') && (
              <FormControlLabel
                control={
                  <Switch
                    checked={filtrosVariables.tieneEmail || false}
                    onChange={(e) => setFiltrosVariables({
                      ...filtrosVariables,
                      tieneEmail: e.target.checked
                    })}
                  />
                }
                label="Solo deudores con Email"
              />
            )}

            {plantilla.filtrosVars.includes('tieneWhatsapp') && (
              <FormControlLabel
                control={
                  <Switch
                    checked={filtrosVariables.tieneWhatsapp || false}
                    onChange={(e) => setFiltrosVariables({
                      ...filtrosVariables,
                      tieneWhatsapp: e.target.checked
                    })}
                  />
                }
                label="Solo deudores con WhatsApp"
              />
            )}
            {plantilla.filtrosVars.filter((v: string) => v.startsWith('extra.')).length > 0 && (
              <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
                <Typography variant="subtitle2" color="text.secondary">Filtros de Datos Adicionales</Typography>
                {plantilla.filtrosVars.filter((v: string) => v.startsWith('extra.')).map((v: string) => {
                  const campo = v.split('.')[1]
                  return (
                    <TextField
                      key={v}
                      label={`Coincidencias en: ${campo}`}
                      value={(filtrosVariables as any).camposAux?.[campo] || ''}
                      onChange={(e) => setFiltrosVariables({
                        ...filtrosVariables,
                        camposAux: {
                          ...((filtrosVariables as any).camposAux || {}),
                          [campo]: e.target.value
                        }
                      })}
                      size="small"
                    />
                  )
                })}
              </Box>
            )}
          </Box>
        </Paper>
      )}

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate('/reportes')}>
          Volver
        </Button>
        <Button
          variant="contained"
          startIcon={ejecutando ? <CircularProgress size={20} /> : <DownloadIcon />}
          onClick={handleEjecutar}
          disabled={ejecutando}
        >
          {ejecutando ? 'Generando...' : 'Generar y Descargar'}
        </Button>
      </Box>
    </Box>
  )
}

export default ReportesEjecutar
