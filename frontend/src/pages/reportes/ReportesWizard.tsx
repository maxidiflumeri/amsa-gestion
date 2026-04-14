import React, { useState, useEffect } from 'react'
import {
  Box, Typography, Stepper, Step, StepLabel, Button, TextField, Select,
  MenuItem, FormControl, InputLabel, Autocomplete, Switch, FormControlLabel,
  Chip, Paper, Stack, Divider, IconButton, Checkbox, FormGroup, Dialog,
  DialogTitle, DialogContent, DialogActions
} from '@mui/material'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import DeleteIcon from '@mui/icons-material/Delete'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../api/axios'

interface Empresa {
  id: number
  nombre: string
}

interface Remesa {
  id: number
  nombre: string
  numeroRemesa: string
}

interface Fuente {
  id: string
  nombre: string
}

interface Parametro {
  clave: string
  descripcion: string
}

interface ColumnaDisponible {
  campo: string
  label: string
}

interface FormatoTelefono {
  id: number
  nombre: string
  patron: string
}

interface FiltrosFijos {
  empresaIds?: number[]
  remesasIds?: number[]
  situacionDesde?: string
  situacionHasta?: string
  situacionExcluir?: string[]
  gestionDesde?: string
  gestionHasta?: string
  gestionExcluir?: string[]
  montoDesde?: number
  montoHasta?: number
  montoExcluir?: string
  tieneTelefono?: boolean
  tieneEmail?: boolean
  tieneWhatsapp?: boolean
  camposAux?: Record<string, string>
}

interface FormData {
  nombre: string
  descripcion: string
  tipo: string
  fuente: string
  empresaId: number | null
  filtrosFijos: FiltrosFijos
  filtrosVars: string[]
  columnas: { campo: string; label: string }[]
  formatoSalida: string
  opcionesExcel?: { headerColor?: string; freezeRow?: boolean }
  opcionesCsv?: { separador?: string }
  opcionesPdf?: { landscape?: boolean }
  formatoTel?: string
}

const STEPS = ['Configuración General', 'Filtros', 'Columnas', 'Formato de Salida']

const ReportesWizard: React.FC = () => {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = Boolean(id)

  const [activeStep, setActiveStep] = useState(0)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [fuentes, setFuentes] = useState<Fuente[]>([])
  const [remesas, setRemesas] = useState<Remesa[]>([])
  const [situaciones, setSituaciones] = useState<Parametro[]>([])
  const [gestiones, setGestiones] = useState<Parametro[]>([])
  const [columnasDisponibles, setColumnasDisponibles] = useState<ColumnaDisponible[]>([])
  const [camposExtra, setCamposExtra] = useState<string[]>([])
  const [formatosTel, setFormatosTel] = useState<FormatoTelefono[]>([])
  const [filtrosActivos, setFiltrosActivos] = useState<Record<string, boolean>>({})
  const [nuevoFormatoDialog, setNuevoFormatoDialog] = useState(false)
  const [nuevoFormato, setNuevoFormato] = useState({ nombre: '', patron: '' })

  const [formData, setFormData] = useState<FormData>({
    nombre: '',
    descripcion: '',
    tipo: 'base',
    fuente: 'deudores',
    empresaId: null,
    filtrosFijos: {},
    filtrosVars: [],
    columnas: [],
    formatoSalida: 'xlsx',
    opcionesExcel: { headerColor: '#1565C0', freezeRow: true },
    opcionesCsv: { separador: ',' },
    opcionesPdf: { landscape: false },
    formatoTel: undefined
  })

  useEffect(() => {
    fetchEmpresas()
    fetchFuentes()
    fetchSituaciones()
    fetchGestiones()
    fetchFormatosTel()
    if (isEditing) {
      fetchPlantilla()
    }
  }, [])

  useEffect(() => {
    fetchRemesas(formData.empresaId || undefined)
    fetchCamposExtra(formData.empresaId || undefined)
  }, [formData.empresaId])

  useEffect(() => {
    if (formData.fuente) {
      fetchColumnasDisponibles(formData.fuente)
    }
  }, [formData.fuente])

  const fetchEmpresas = async () => {
    try {
      const res = await api.get('/empresas')
      setEmpresas(res.data)
    } catch (error) {
      console.error('Error fetching empresas:', error)
    }
  }

  const fetchCamposExtra = async (empresaId?: number) => {
    try {
      const url = empresaId ? `/reportes/campos-extra?empresaId=${empresaId}` : `/reportes/campos-extra`
      const res = await api.get(url)
      setCamposExtra(res.data)
    } catch (error) {
      console.error('Error fetching campos extra:', error)
    }
  }

  const fetchRemesas = async (empresaId?: number) => {
    try {
      const url = empresaId ? `/reportes/remesas?empresaId=${empresaId}` : `/reportes/remesas`
      const res = await api.get(url)
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

  const fetchColumnasDisponibles = async (fuenteId: string) => {
    try {
      const res = await api.get(`/reportes/columnas/${fuenteId}`)
      setColumnasDisponibles(res.data)
    } catch (error) {
      console.error('Error fetching columnas:', error)
    }
  }

  const fetchFuentes = async () => {
    try {
      const res = await api.get('/reportes/fuentes')
      setFuentes(res.data)
    } catch (error) {
      console.error('Error fetching fuentes:', error)
    }
  }

  const fetchFormatosTel = async () => {
    try {
      const res = await api.get('/reportes/formatos-tel')
      setFormatosTel(res.data)
    } catch (error) {
      console.error('Error fetching formatos telefono:', error)
    }
  }

  const fetchPlantilla = async () => {
    try {
      const res = await api.get(`/reportes/plantillas/${id}`)
      const plantilla = res.data
      const colsRaw = plantilla.columnas || []
      const colsNorm = colsRaw.map((c: any) => typeof c === 'string' ? { campo: c, label: c } : c)
      
      setFormData({
        nombre: plantilla.nombre,
        descripcion: plantilla.descripcion,
        tipo: plantilla.tipo,
        fuente: plantilla.fuente,
        empresaId: plantilla.empresaId,
        filtrosFijos: plantilla.filtrosFijos || {},
        filtrosVars: plantilla.filtrosVars || [],
        columnas: colsNorm,
        formatoSalida: plantilla.formatoSalida,
        opcionesExcel: plantilla.opcionesExcel || { headerColor: '#1565C0', freezeRow: true },
        opcionesCsv: (plantilla.filtrosFijos && plantilla.filtrosFijos.opcionesCsv) ? plantilla.filtrosFijos.opcionesCsv : { separador: ',' },
        opcionesPdf: plantilla.opcionesPdf || { landscape: false },
        formatoTel: (plantilla.filtrosFijos && plantilla.filtrosFijos.formatoTel) ? plantilla.filtrosFijos.formatoTel : undefined
      })

      const activos: Record<string, boolean> = {}
      Object.keys(plantilla.filtrosFijos || {}).forEach(key => {
        if (plantilla.filtrosFijos[key] !== undefined && plantilla.filtrosFijos[key] !== null) {
          activos[key] = true
        }
      })
      ;(plantilla.filtrosVars || []).forEach((key: string) => {
        activos[key] = true
      })
      setFiltrosActivos(activos)
    } catch (error) {
      console.error('Error fetching plantilla:', error)
    }
  }

  const handleNext = () => {
    setActiveStep((prev) => prev + 1)
  }

  const handleBack = () => {
    setActiveStep((prev) => prev - 1)
  }

  const handleSave = async () => {
    try {
      const payloadFiltros = { ...formData.filtrosFijos }
      if (formData.opcionesCsv) (payloadFiltros as any).opcionesCsv = formData.opcionesCsv
      if (formData.formatoTel) (payloadFiltros as any).formatoTel = formData.formatoTel

      const payload = {
        nombre: formData.nombre,
        descripcion: formData.descripcion,
        tipo: formData.tipo,
        fuente: formData.fuente,
        empresaId: formData.empresaId,
        filtrosFijos: payloadFiltros,
        filtrosVars: formData.filtrosVars,
        columnas: formData.columnas,
        formatoSalida: formData.formatoSalida,
        opcionesExcel: formData.opcionesExcel,
        opcionesPdf: formData.opcionesPdf
      }

      if (isEditing) {
        await api.patch(`/reportes/plantillas/${id}`, payload)
      } else {
        await api.post('/reportes/plantillas', payload)
      }
      navigate('/reportes')
    } catch (error) {
      console.error('Error saving plantilla:', error)
    }
  }

  const toggleFiltro = (filtro: string, enabled: boolean) => {
    setFiltrosActivos({ ...filtrosActivos, [filtro]: enabled })
    if (!enabled) {
      const newFiltros = { ...formData.filtrosFijos }
      delete newFiltros[filtro as keyof FiltrosFijos]
      setFormData({ ...formData, filtrosFijos: newFiltros })
      setFormData(prev => ({
        ...prev,
        filtrosVars: prev.filtrosVars.filter(f => f !== filtro)
      }))
    }
  }

  const toggleFiltroVariable = (filtro: string, isVariable: boolean) => {
    if (isVariable) {
      setFormData(prev => ({
        ...prev,
        filtrosVars: [...prev.filtrosVars, filtro]
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        filtrosVars: prev.filtrosVars.filter(f => f !== filtro)
      }))
    }
  }

  const toggleColumna = (col: ColumnaDisponible) => {
    if (formData.columnas.some(c => c.campo === col.campo)) {
      setFormData({
        ...formData,
        columnas: formData.columnas.filter(c => c.campo !== col.campo)
      })
    } else {
      setFormData({
        ...formData,
        columnas: [...formData.columnas, { campo: col.campo, label: col.label }]
      })
    }
  }

  const moveColumna = (index: number, direction: 'up' | 'down') => {
    const newColumnas = [...formData.columnas]
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex >= 0 && newIndex < newColumnas.length) {
      [newColumnas[index], newColumnas[newIndex]] = [newColumnas[newIndex], newColumnas[index]]
      setFormData({ ...formData, columnas: newColumnas })
    }
  }

  const crearFormatoTel = async () => {
    try {
      const res = await api.post('/reportes/formatos-tel', nuevoFormato)
      setFormatosTel([...formatosTel, res.data])
      setFormData({ ...formData, formatoTel: res.data.patron })
      setNuevoFormatoDialog(false)
      setNuevoFormato({ nombre: '', patron: '' })
    } catch (error) {
      console.error('Error creating formato telefono:', error)
    }
  }

  const renderStep = () => {
    switch (activeStep) {
      case 0:
        return (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField
              label="Nombre *"
              fullWidth
              value={formData.nombre}
              onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
            />
            <TextField
              label="Descripción"
              fullWidth
              multiline
              rows={3}
              value={formData.descripcion}
              onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
            />
            <FormControl fullWidth>
              <InputLabel>Tipo</InputLabel>
              <Select
                value={formData.tipo}
                label="Tipo"
                onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
              >
                <MenuItem value="base">Base de Datos</MenuItem>
                <MenuItem value="informe">Informe</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Fuente de Datos</InputLabel>
              <Select
                value={formData.fuente}
                label="Fuente de Datos"
                onChange={(e) => setFormData({ ...formData, fuente: e.target.value, columnas: [] })}
              >
                {fuentes.map((f) => (
                  <MenuItem key={f.id} value={f.id}>{f.nombre}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Autocomplete
              options={empresas}
              getOptionLabel={(e) => e.nombre}
              value={empresas.find(e => e.id === formData.empresaId) || null}
              onChange={(_, val) => setFormData({ ...formData, empresaId: val?.id || null })}
              renderInput={(params) => (
                <TextField {...params} label="Empresa (opcional - dejar vacío para plantilla global)" />
              )}
            />
          </Box>
        )

      case 1:
        return (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Configure los filtros que se aplicarán al generar el reporte. Puede marcar algunos como "Variables" para que el usuario los complete al ejecutar.
            </Typography>

            <Paper sx={{ p: 2 }}>
              <FormControlLabel
                control={<Switch checked={filtrosActivos.empresaIds || false} onChange={(e) => toggleFiltro('empresaIds', e.target.checked)} />}
                label="Filtrar por Empresas"
              />
              {filtrosActivos.empresaIds && (
                <Box sx={{ mt: 1, ml: 4 }}>
                  <FormControlLabel
                    control={<Checkbox checked={formData.filtrosVars.includes('empresaIds')} onChange={(e) => toggleFiltroVariable('empresaIds', e.target.checked)} />}
                    label="Variable (definir al ejecutar)"
                  />
                  {!formData.filtrosVars.includes('empresaIds') && (
                    <Autocomplete
                      multiple
                      options={empresas}
                      getOptionLabel={(e) => e.nombre}
                      value={empresas.filter(e => formData.filtrosFijos.empresaIds?.includes(e.id))}
                      onChange={(_, val) => setFormData({
                        ...formData,
                        filtrosFijos: { ...formData.filtrosFijos, empresaIds: val.map(v => v.id) }
                      })}
                      renderInput={(params) => <TextField {...params} label="Seleccionar Empresas" size="small" />}
                    />
                  )}
                </Box>
              )}
            </Paper>

            <Paper sx={{ p: 2 }}>
              <FormControlLabel
                control={<Switch checked={filtrosActivos.remesasIds || false} onChange={(e) => toggleFiltro('remesasIds', e.target.checked)} />}
                label="Filtrar por Remesas"
              />
              {filtrosActivos.remesasIds && (
                <Box sx={{ mt: 1, ml: 4 }}>
                  <FormControlLabel
                    control={<Checkbox checked={formData.filtrosVars.includes('remesasIds')} onChange={(e) => toggleFiltroVariable('remesasIds', e.target.checked)} />}
                    label="Variable (definir al ejecutar)"
                  />
                  {!formData.filtrosVars.includes('remesasIds') && (
                    <Autocomplete
                      multiple
                      options={remesas}
                      getOptionLabel={(r) => `${r.numeroRemesa} - ${r.nombre}`}
                      value={remesas.filter(r => formData.filtrosFijos.remesasIds?.includes(r.id))}
                      onChange={(_, val) => setFormData({
                        ...formData,
                        filtrosFijos: { ...formData.filtrosFijos, remesasIds: val.map(v => v.id) }
                      })}
                      renderInput={(params) => <TextField {...params} label="Seleccionar Remesas" size="small" />}
                    />
                  )}
                </Box>
              )}
            </Paper>

            <Paper sx={{ p: 2 }}>
              <FormControlLabel
                control={<Switch checked={filtrosActivos.situacionDesde || false} onChange={(e) => toggleFiltro('situacionDesde', e.target.checked)} />}
                label="Filtrar por Rango de Situación"
              />
              {filtrosActivos.situacionDesde && (
                <Box sx={{ mt: 1, ml: 4, display: 'grid', gap: 1 }}>
                  <FormControlLabel
                    control={<Checkbox checked={formData.filtrosVars.includes('situacionDesde')} onChange={(e) => toggleFiltroVariable('situacionDesde', e.target.checked)} />}
                    label="Variable (definir al ejecutar)"
                  />
                  {!formData.filtrosVars.includes('situacionDesde') && (
                    <>
                      <Autocomplete
                        options={situaciones}
                        getOptionLabel={(s) => `${s.clave} - ${s.descripcion}`}
                        value={situaciones.find(s => s.clave === formData.filtrosFijos.situacionDesde) || null}
                        onChange={(_, val) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, situacionDesde: val?.clave }
                        })}
                        renderInput={(params) => <TextField {...params} label="Desde" size="small" />}
                      />
                      <Autocomplete
                        options={situaciones}
                        getOptionLabel={(s) => `${s.clave} - ${s.descripcion}`}
                        value={situaciones.find(s => s.clave === formData.filtrosFijos.situacionHasta) || null}
                        onChange={(_, val) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, situacionHasta: val?.clave }
                        })}
                        renderInput={(params) => <TextField {...params} label="Hasta" size="small" />}
                      />
                      <Autocomplete
                        multiple
                        options={situaciones}
                        getOptionLabel={(s) => `${s.clave} - ${s.descripcion}`}
                        value={situaciones.filter(s => formData.filtrosFijos.situacionExcluir?.includes(s.clave))}
                        onChange={(_, val) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, situacionExcluir: val.map(v => v.clave) }
                        })}
                        renderInput={(params) => <TextField {...params} label="Excluir" size="small" />}
                      />
                    </>
                  )}
                </Box>
              )}
            </Paper>

            <Paper sx={{ p: 2 }}>
              <FormControlLabel
                control={<Switch checked={filtrosActivos.gestionDesde || false} onChange={(e) => toggleFiltro('gestionDesde', e.target.checked)} />}
                label="Filtrar por Rango de Gestión"
              />
              {filtrosActivos.gestionDesde && (
                <Box sx={{ mt: 1, ml: 4, display: 'grid', gap: 1 }}>
                  <FormControlLabel
                    control={<Checkbox checked={formData.filtrosVars.includes('gestionDesde')} onChange={(e) => toggleFiltroVariable('gestionDesde', e.target.checked)} />}
                    label="Variable (definir al ejecutar)"
                  />
                  {!formData.filtrosVars.includes('gestionDesde') && (
                    <>
                      <Autocomplete
                        options={gestiones}
                        getOptionLabel={(g) => `${g.clave} - ${g.descripcion}`}
                        value={gestiones.find(g => g.clave === formData.filtrosFijos.gestionDesde) || null}
                        onChange={(_, val) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, gestionDesde: val?.clave }
                        })}
                        renderInput={(params) => <TextField {...params} label="Desde" size="small" />}
                      />
                      <Autocomplete
                        options={gestiones}
                        getOptionLabel={(g) => `${g.clave} - ${g.descripcion}`}
                        value={gestiones.find(g => g.clave === formData.filtrosFijos.gestionHasta) || null}
                        onChange={(_, val) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, gestionHasta: val?.clave }
                        })}
                        renderInput={(params) => <TextField {...params} label="Hasta" size="small" />}
                      />
                      <Autocomplete
                        multiple
                        options={gestiones}
                        getOptionLabel={(g) => `${g.clave} - ${g.descripcion}`}
                        value={gestiones.filter(g => formData.filtrosFijos.gestionExcluir?.includes(g.clave))}
                        onChange={(_, val) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, gestionExcluir: val.map(v => v.clave) }
                        })}
                        renderInput={(params) => <TextField {...params} label="Excluir" size="small" />}
                      />
                    </>
                  )}
                </Box>
              )}
            </Paper>

            <Paper sx={{ p: 2 }}>
              <FormControlLabel
                control={<Switch checked={filtrosActivos.montoDesde || false} onChange={(e) => toggleFiltro('montoDesde', e.target.checked)} />}
                label="Filtrar por Rango de Monto"
              />
              {filtrosActivos.montoDesde && (
                <Box sx={{ mt: 1, ml: 4, display: 'grid', gap: 1 }}>
                  <FormControlLabel
                    control={<Checkbox checked={formData.filtrosVars.includes('montoDesde')} onChange={(e) => toggleFiltroVariable('montoDesde', e.target.checked)} />}
                    label="Variable (definir al ejecutar)"
                  />
                  {!formData.filtrosVars.includes('montoDesde') && (
                    <>
                      <TextField
                        label="Desde"
                        type="number"
                        size="small"
                        value={formData.filtrosFijos.montoDesde || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, montoDesde: parseFloat(e.target.value) || 0 }
                        })}
                      />
                      <TextField
                        label="Hasta"
                        type="number"
                        size="small"
                        value={formData.filtrosFijos.montoHasta || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, montoHasta: parseFloat(e.target.value) || 0 }
                        })}
                      />
                      <TextField
                        label="Excluir (ej: 0)"
                        size="small"
                        value={formData.filtrosFijos.montoExcluir || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          filtrosFijos: { ...formData.filtrosFijos, montoExcluir: e.target.value }
                        })}
                      />
                    </>
                  )}
                </Box>
              )}
            </Paper>

            <Paper sx={{ p: 2 }}>
              <FormControlLabel
                control={<Switch checked={filtrosActivos.tieneTelefono || false} onChange={(e) => toggleFiltro('tieneTelefono', e.target.checked)} />}
                label="Solo deudores con Teléfono"
              />
              {filtrosActivos.tieneTelefono && (
                <Box sx={{ mt: 1, ml: 4 }}>
                  <FormControlLabel
                    control={<Checkbox checked={formData.filtrosVars.includes('tieneTelefono')} onChange={(e) => toggleFiltroVariable('tieneTelefono', e.target.checked)} />}
                    label="Variable (definir al ejecutar)"
                  />
                  {!formData.filtrosVars.includes('tieneTelefono') && (
                    <FormControlLabel
                      control={<Switch checked={formData.filtrosFijos.tieneTelefono || false} onChange={(e) => setFormData({
                        ...formData,
                        filtrosFijos: { ...formData.filtrosFijos, tieneTelefono: e.target.checked }
                      })} />}
                      label="Activar filtro"
                    />
                  )}
                </Box>
              )}
            </Paper>

            <Paper sx={{ p: 2 }}>
              <FormControlLabel
                control={<Switch checked={filtrosActivos.tieneEmail || false} onChange={(e) => toggleFiltro('tieneEmail', e.target.checked)} />}
                label="Solo deudores con Email"
              />
              {filtrosActivos.tieneEmail && (
                <Box sx={{ mt: 1, ml: 4 }}>
                  <FormControlLabel
                    control={<Checkbox checked={formData.filtrosVars.includes('tieneEmail')} onChange={(e) => toggleFiltroVariable('tieneEmail', e.target.checked)} />}
                    label="Variable (definir al ejecutar)"
                  />
                  {!formData.filtrosVars.includes('tieneEmail') && (
                    <FormControlLabel
                      control={<Switch checked={formData.filtrosFijos.tieneEmail || false} onChange={(e) => setFormData({
                        ...formData,
                        filtrosFijos: { ...formData.filtrosFijos, tieneEmail: e.target.checked }
                      })} />}
                      label="Activar filtro"
                    />
                  )}
                </Box>
              )}
            </Paper>

            <Paper sx={{ p: 2 }}>
              <FormControlLabel
                control={<Switch checked={filtrosActivos.tieneWhatsapp || false} onChange={(e) => toggleFiltro('tieneWhatsapp', e.target.checked)} />}
                label="Solo deudores con WhatsApp"
              />
              {filtrosActivos.tieneWhatsapp && (
                <Box sx={{ mt: 1, ml: 4 }}>
                  <FormControlLabel
                    control={<Checkbox checked={formData.filtrosVars.includes('tieneWhatsapp')} onChange={(e) => toggleFiltroVariable('tieneWhatsapp', e.target.checked)} />}
                    label="Variable (definir al ejecutar)"
                  />
                  {!formData.filtrosVars.includes('tieneWhatsapp') && (
                    <FormControlLabel
                      control={<Switch checked={formData.filtrosFijos.tieneWhatsapp || false} onChange={(e) => setFormData({
                        ...formData,
                        filtrosFijos: { ...formData.filtrosFijos, tieneWhatsapp: e.target.checked }
                      })} />}
                      label="Activar filtro"
                    />
                  )}
                </Box>
              )}
            </Paper>

            {camposExtra.length > 0 && (
              <Paper sx={{ p: 2, mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Filtros por Datos Adicionales</Typography>
                <Divider sx={{ mb: 2 }} />
                <Box sx={{ display: 'grid', gap: 2 }}>
                  {camposExtra.map(ce => (
                    <FormControlLabel
                      key={ce}
                      control={
                        <Switch
                          checked={formData.filtrosVars.includes(`extra.${ce}`)}
                          onChange={(e) => toggleFiltroVariable(`extra.${ce}`, e.target.checked)}
                        />
                      }
                      label={`Activar filtro para: ${ce} (Variable al ejecutar)`}
                    />
                  ))}
                </Box>
              </Paper>
            )}
          </Box>
        )

      case 2:
        return (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Seleccione las columnas que desea incluir en el reporte y defina su orden.
            </Typography>

            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Columnas Disponibles</Typography>
              <Divider sx={{ mb: 2 }} />
              <FormGroup>
                {[...columnasDisponibles, ...camposExtra.map(c => ({ campo: `extra.${c}`, label: `Extra: ${c}` }))].map(col => {
                  const isChecked = formData.columnas.some(c => c.campo === col.campo)
                  return (
                    <Box key={col.campo} sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 2 }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={isChecked}
                            onChange={() => toggleColumna(col)}
                          />
                        }
                        label={col.label}
                        sx={{ minWidth: '220px' }}
                      />
                      {isChecked && (
                        <TextField
                          size="small"
                          label="Cabecera (nombre de salida)"
                          value={formData.columnas.find(c => c.campo === col.campo)?.label || col.label}
                          onChange={(e) => {
                            const newCols = formData.columnas.map(c => 
                              c.campo === col.campo ? { ...c, label: e.target.value } : c
                            )
                            setFormData({ ...formData, columnas: newCols })
                          }}
                          sx={{ flex: 1 }}
                        />
                      )}
                    </Box>
                  )
                })}
              </FormGroup>
            </Paper>

            {formData.columnas.length > 0 && (
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Orden de Columnas</Typography>
                <Divider sx={{ mb: 2 }} />
                <Stack spacing={1}>
                  {formData.columnas.map((colSelection, index) => {
                    return (
                      <Box key={colSelection.campo} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip label={index + 1} size="small" />
                        <Typography sx={{ flex: 1 }}>{colSelection.label} <Typography component="span" variant="caption" color="text.secondary">({colSelection.campo})</Typography></Typography>
                        <IconButton size="small" onClick={() => moveColumna(index, 'up')} disabled={index === 0}>
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={() => moveColumna(index, 'down')} disabled={index === formData.columnas.length - 1}>
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => toggleColumna(colSelection)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )
                  })}
                </Stack>
              </Paper>
            )}
          </Box>
        )

      case 3:
        return (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Formato de Salida</InputLabel>
              <Select
                value={formData.formatoSalida}
                label="Formato de Salida"
                onChange={(e) => setFormData({ ...formData, formatoSalida: e.target.value })}
              >
                <MenuItem value="xlsx">Excel (.xlsx)</MenuItem>
                <MenuItem value="csv">CSV (.csv)</MenuItem>
                <MenuItem value="txt">Texto Plano (.txt)</MenuItem>
                <MenuItem value="pdf">PDF (.pdf)</MenuItem>
              </Select>
            </FormControl>

            {formData.formatoSalida === 'xlsx' && (
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Opciones de Excel</Typography>
                <Divider sx={{ mb: 2 }} />
                <Box sx={{ display: 'grid', gap: 2 }}>
                  <TextField
                    label="Color del Encabezado"
                    type="color"
                    value={formData.opcionesExcel?.headerColor || '#1565C0'}
                    onChange={(e) => setFormData({
                      ...formData,
                      opcionesExcel: { ...formData.opcionesExcel, headerColor: e.target.value }
                    })}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={formData.opcionesExcel?.freezeRow || false}
                        onChange={(e) => setFormData({
                          ...formData,
                          opcionesExcel: { ...formData.opcionesExcel, freezeRow: e.target.checked }
                        })}
                      />
                    }
                    label="Congelar primera fila"
                  />
                </Box>
              </Paper>
            )}

            {(formData.formatoSalida === 'csv' || formData.formatoSalida === 'txt') && (
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Opciones de Archivo Plano</Typography>
                <Divider sx={{ mb: 2 }} />
                <FormControl fullWidth size="small">
                  <InputLabel>Separador de Campos</InputLabel>
                  <Select
                    value={formData.opcionesCsv?.separador || ','}
                    label="Separador de Campos"
                    onChange={(e) => setFormData({
                      ...formData,
                      opcionesCsv: { ...formData.opcionesCsv, separador: e.target.value }
                    })}
                  >
                    <MenuItem value=",">Coma (,)</MenuItem>
                    <MenuItem value=";">Punto y coma (;)</MenuItem>
                    <MenuItem value="|">Pipe (|)</MenuItem>
                    <MenuItem value="tab">Tabulación (TAB)</MenuItem>
                  </Select>
                </FormControl>
              </Paper>
            )}

            {formData.formatoSalida === 'pdf' && (
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Opciones de PDF</Typography>
                <Divider sx={{ mb: 2 }} />
                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.opcionesPdf?.landscape || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        opcionesPdf: { landscape: e.target.checked }
                      })}
                    />
                  }
                  label="Orientación Horizontal"
                />
              </Paper>
            )}

            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Formato de Teléfono (opcional)</Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={1}>
                <Autocomplete
                  options={formatosTel}
                  getOptionLabel={(f) => `${f.nombre} - ${f.patron}`}
                  value={formatosTel.find(f => f.patron === formData.formatoTel) || null}
                  onChange={(_, val) => setFormData({ ...formData, formatoTel: val?.patron })}
                  renderInput={(params) => <TextField {...params} label="Seleccionar formato" />}
                />
                <Button size="small" onClick={() => setNuevoFormatoDialog(true)}>
                  Crear nuevo formato
                </Button>
              </Stack>
            </Paper>
          </Box>
        )

      default:
        return null
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
          {isEditing ? 'Editar Plantilla' : 'Nueva Plantilla de Reporte'}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Configure los parámetros de su plantilla de reporte personalizado.
        </Typography>
        <Divider sx={{ mt: 2 }} />
      </Box>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ mb: 3 }}>
        {renderStep()}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button
          disabled={activeStep === 0}
          onClick={handleBack}
        >
          Atrás
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={() => navigate('/reportes')}>
            Cancelar
          </Button>
          {activeStep === STEPS.length - 1 ? (
            <Button variant="contained" onClick={handleSave}>
              Guardar
            </Button>
          ) : (
            <Button variant="contained" onClick={handleNext}>
              Siguiente
            </Button>
          )}
        </Box>
      </Box>

      <Dialog open={nuevoFormatoDialog} onClose={() => setNuevoFormatoDialog(false)}>
        <DialogTitle>Nuevo Formato de Teléfono</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField
              label="Nombre"
              fullWidth
              value={nuevoFormato.nombre}
              onChange={(e) => setNuevoFormato({ ...nuevoFormato, nombre: e.target.value })}
            />
            <TextField
              label="Formato (ej: +54 9 {numero})"
              fullWidth
              size="small"
              value={nuevoFormato.patron}
              onChange={(e) => setNuevoFormato({ ...nuevoFormato, patron: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNuevoFormatoDialog(false)}>Cancelar</Button>
          <Button onClick={crearFormatoTel} variant="contained">Crear</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ReportesWizard
