import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Typography, Divider, Select, MenuItem, FormControl, InputLabel, Chip, Paper,
  Switch, Tooltip, Stack, FormControlLabel, Checkbox, Tabs, Tab,
  List, ListItemButton, ListItemText, Collapse, CircularProgress, Alert, Autocomplete,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import BusinessIcon from '@mui/icons-material/Business'
import api from '../../api/axios'

// ── Tipos ────────────────────────────────────────────────────────────────────
interface Parametro {
  id: number
  grupo: string
  clave: string
  descripcion: string
  categoria: string | null
  esGlobal: boolean
  activo: boolean
}

interface Empresa {
  id: number
  nombre: string
}

// ── Constantes ───────────────────────────────────────────────────────────────
const GRUPOS = [
  { value: 'gestion', label: 'Gestión' },
  { value: 'situacion', label: 'Situación' },
  { value: 'motivo_no_pago', label: 'Motivo No Pago' },
]

const CATEGORIAS_POR_GRUPO: Record<string, string[]> = {
  gestion: ['CONTACTO', 'SIN_CONTACTO', 'DATO_INCORRECTO', 'PROMESA', 'PAGO', 'CONVENIO', 'NEGATIVA', 'RECLAMO', 'DERIVACION', 'ADMIN'],
  situacion: ['SIN_CONTACTO', 'CONTACTADO', 'PROMESA', 'CONVENIO', 'PAGANDO', 'CANCELADO', 'NEGATIVA', 'BAJA'],
  motivo_no_pago: ['ECONOMICO', 'DESCONOCE', 'DISPUTA', 'FACTURACION', 'MEDIO_PAGO', 'ACUERDO', 'BAJA'],
}

const GRUPO_COLOR: Record<string, 'primary' | 'info' | 'warning'> = {
  gestion: 'primary',
  situacion: 'info',
  motivo_no_pago: 'warning',
}

const GRUPO_LABEL: Record<string, string> = {
  gestion: 'Gestión',
  situacion: 'Situación',
  motivo_no_pago: 'Motivo No Pago',
}

const FORM_VACIO = { grupo: 'gestion', clave: '', descripcion: '', categoria: '', esGlobal: true, activo: true }

// ── Tab Panel helper ─────────────────────────────────────────────────────────
function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null
}

// ════════════════════════════════════════════════════════════════════════════
const AjustesParametros: React.FC = () => {
  const [tab, setTab] = useState(0)
  const [parametros, setParametros] = useState<Parametro[]>([])
  const [loading, setLoading] = useState(true)

  // Pestaña Códigos
  const [grupoSel, setGrupoSel] = useState<string>('gestion')
  const [categoriaSel, setCategoriaSel] = useState<string | null>(null)
  const [filterTexto, setFilterTexto] = useState('')
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Parametro | null>(null)
  const [formData, setFormData] = useState(FORM_VACIO)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Pestaña Asignación
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaSel, setEmpresaSel] = useState<number | ''>('')
  const [asignados, setAsignados] = useState<Set<number>>(new Set())
  const [asignadosPrev, setAsignadosPrev] = useState<Set<number>>(new Set())
  const [loadingAsig, setLoadingAsig] = useState(false)
  const [savingAsig, setSavingAsig] = useState(false)
  const [asigMsg, setAsigMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [filterAsig, setFilterAsig] = useState('')

  // ── Carga inicial ──────────────────────────────────────────────────────────
  const fetchParametros = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/parametros')
      setParametros(res.data)
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }, [])

  const fetchEmpresas = useCallback(async () => {
    try {
      const res = await api.get('/empresas')
      setEmpresas(res.data?.data || res.data || [])
    } catch { /* silencioso */ }
  }, [])

  useEffect(() => { fetchParametros() }, [fetchParametros])
  useEffect(() => { if (tab === 1) fetchEmpresas() }, [tab, fetchEmpresas])

  // ── Lógica pestaña Códigos ─────────────────────────────────────────────────
  const toggleCat = (cat: string) => setOpenCats(p => ({ ...p, [cat]: !p[cat] }))

  const codigosFiltrados = parametros.filter(p => {
    if (p.grupo !== grupoSel) return false
    if (categoriaSel && p.categoria !== categoriaSel) return false
    if (filterTexto) {
      const t = filterTexto.toLowerCase()
      return p.clave.toLowerCase().includes(t) || p.descripcion.toLowerCase().includes(t)
    }
    return true
  })

  const categorias = CATEGORIAS_POR_GRUPO[grupoSel] || []

  const handleOpenForm = (p?: Parametro) => {
    setErrorMsg('')
    if (p) {
      setEditing(p)
      setFormData({ grupo: p.grupo, clave: p.clave, descripcion: p.descripcion, categoria: p.categoria || '', esGlobal: p.esGlobal, activo: p.activo })
    } else {
      setEditing(null)
      setFormData({ ...FORM_VACIO, grupo: grupoSel, categoria: categoriaSel || '' })
    }
    setOpen(true)
  }

  const handleSave = async () => {
    if (!formData.grupo || !formData.clave || !formData.descripcion) {
      setErrorMsg('Grupo, clave y descripción son obligatorios')
      return
    }
    setSaving(true)
    setErrorMsg('')
    try {
      const payload = { ...formData, categoria: formData.categoria || null }
      if (editing) await api.patch(`/parametros/${editing.id}`, payload)
      else await api.post('/parametros', payload)
      setOpen(false)
      fetchParametros()
    } catch (e: any) {
      setErrorMsg(e.response?.data?.message || 'Error al guardar')
    } finally { setSaving(false) }
  }

  const handleToggleActivo = async (p: Parametro) => {
    try {
      await api.patch(`/parametros/${p.id}/activo`)
      setParametros(prev => prev.map(x => x.id === p.id ? { ...x, activo: !x.activo } : x))
    } catch { /* silencioso */ }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('¿Eliminar este parámetro?')) return
    try {
      await api.delete(`/parametros/${id}`)
      fetchParametros()
    } catch (e: any) {
      alert(e.response?.data?.message || 'No se puede eliminar, puede estar en uso.')
    }
  }

  // ── Lógica pestaña Asignación ──────────────────────────────────────────────
  const cargarAsignados = async (empresaId: number) => {
    setLoadingAsig(true)
    setAsigMsg(null)
    try {
      const res = await api.get(`/parametros?empresaId=${empresaId}`)
      const ids = new Set<number>((res.data as Parametro[]).map(p => p.id))
      setAsignados(new Set(ids))
      setAsignadosPrev(new Set(ids))
    } catch { /* silencioso */ }
    finally { setLoadingAsig(false) }
  }

  const handleEmpresaChange = (id: number) => {
    setEmpresaSel(id)
    setFilterAsig('')
    cargarAsignados(id)
  }

  const toggleAsignado = (id: number) => {
    setAsignados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGrupoCompleto = (grupo: string, marcar: boolean) => {
    const ids = parametros.filter(p => p.grupo === grupo).map(p => p.id)
    setAsignados(prev => {
      const next = new Set(prev)
      ids.forEach(id => marcar ? next.add(id) : next.delete(id))
      return next
    })
  }

  const toggleCategoriaCompleta = (grupo: string, cat: string, marcar: boolean) => {
    const ids = parametros.filter(p => p.grupo === grupo && p.categoria === cat).map(p => p.id)
    setAsignados(prev => {
      const next = new Set(prev)
      ids.forEach(id => marcar ? next.add(id) : next.delete(id))
      return next
    })
  }

  const hayDiferencias = () => {
    for (const id of asignados) { if (!asignadosPrev.has(id)) return true }
    for (const id of asignadosPrev) { if (!asignados.has(id)) return true }
    return false
  }

  const handleGuardarAsignacion = async () => {
    if (!empresaSel) return
    setSavingAsig(true)
    setAsigMsg(null)
    try {
      // Para cada parámetro que cambió, actualizar la asignación
      const agregados = [...asignados].filter(id => !asignadosPrev.has(id))
      const removidos = [...asignadosPrev].filter(id => !asignados.has(id))

      // Usamos el endpoint de empresa_parametro de forma individual
      // POST /parametros/:id/empresas recibe todos los empresaIds del parametro
      // Es más eficiente hacerlo via un endpoint bulk que no existe aún
      // Por ahora: para cada parametro que cambió su asignación, recalculamos
      const paramsCambiados = new Set([...agregados, ...removidos])

      for (const paramId of paramsCambiados) {
        // obtener todas las empresas que ya tienen este parametro
        const paramActual = await api.get(`/parametros/${paramId}`)
        const empresasActuales: number[] = (paramActual.data.empresas || []).map((ep: any) => ep.empresaId)

        let nuevasEmpresas: number[]
        if (asignados.has(paramId)) {
          // agregar empresaSel si no está
          nuevasEmpresas = empresasActuales.includes(empresaSel as number)
            ? empresasActuales
            : [...empresasActuales, empresaSel as number]
        } else {
          // quitar empresaSel
          nuevasEmpresas = empresasActuales.filter(id => id !== empresaSel)
        }
        await api.post(`/parametros/${paramId}/empresas`, { empresaIds: nuevasEmpresas })
      }

      setAsignadosPrev(new Set(asignados))
      setAsigMsg({ type: 'success', text: `Asignación guardada correctamente (${paramsCambiados.size} cambios)` })
    } catch (e: any) {
      setAsigMsg({ type: 'error', text: e.response?.data?.message || 'Error al guardar asignación' })
    } finally { setSavingAsig(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h4" fontWeight="bold" gutterBottom>Parámetros / Códigos</Typography>
        <Typography variant="body1" color="text.secondary">
          Administre los códigos de gestión, situación y motivo de no pago, y su asignación por empresa.
        </Typography>
        <Divider sx={{ mt: 2 }} />
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Catálogo de códigos" />
        <Tab label="Asignación por empresa" icon={<BusinessIcon fontSize="small" />} iconPosition="start" />
      </Tabs>

      {/* ── TAB 0: Catálogo ── */}
      <TabPanel value={tab} index={0}>
        <Box sx={{ display: 'flex', gap: 2, height: 'calc(100vh - 280px)', minHeight: 500 }}>

          {/* Panel izquierdo: navegación */}
          <Paper sx={{ width: 220, flexShrink: 0, overflow: 'auto', p: 1 }}>
            {GRUPOS.map(g => (
              <Box key={g.value}>
                <ListItemButton
                  selected={grupoSel === g.value && !categoriaSel}
                  onClick={() => { setGrupoSel(g.value); setCategoriaSel(null); setFilterTexto('') }}
                  sx={{ borderRadius: 1, mb: 0.5 }}
                >
                  <ListItemText
                    primary={<Typography fontWeight="bold" variant="body2">{g.label}</Typography>}
                    secondary={`${parametros.filter(p => p.grupo === g.value).length} códigos`}
                  />
                  <IconButton size="small" onClick={e => { e.stopPropagation(); toggleCat(g.value) }}>
                    {openCats[g.value] ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                  </IconButton>
                </ListItemButton>
                <Collapse in={openCats[g.value] ?? true}>
                  <List dense disablePadding sx={{ pl: 2 }}>
                    {(CATEGORIAS_POR_GRUPO[g.value] || []).map(cat => (
                      <ListItemButton
                        key={cat}
                        selected={grupoSel === g.value && categoriaSel === cat}
                        onClick={() => { setGrupoSel(g.value); setCategoriaSel(cat); setFilterTexto('') }}
                        sx={{ borderRadius: 1, mb: 0.25 }}
                      >
                        <ListItemText
                          primary={<Typography variant="caption">{cat}</Typography>}
                          secondary={
                            <Typography variant="caption" color="text.disabled">
                              {parametros.filter(p => p.grupo === g.value && p.categoria === cat).length}
                            </Typography>
                          }
                        />
                      </ListItemButton>
                    ))}
                  </List>
                </Collapse>
              </Box>
            ))}
          </Paper>

          {/* Panel derecho: tabla */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => handleOpenForm()}>
                Nuevo código
              </Button>
              <TextField
                size="small"
                placeholder="Buscar clave o descripción..."
                value={filterTexto}
                onChange={e => setFilterTexto(e.target.value)}
                sx={{ flex: 1, maxWidth: 320 }}
              />
              <Typography variant="body2" color="text.secondary">
                {codigosFiltrados.length} resultado{codigosFiltrados.length !== 1 ? 's' : ''}
                {categoriaSel ? ` en ${categoriaSel}` : ` en ${GRUPO_LABEL[grupoSel] || grupoSel}`}
              </Typography>
            </Box>

            <TableContainer component={Paper} sx={{ flex: 1, overflow: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold', width: 120 }}>Clave</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Descripción</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: 150 }}>Categoría</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: 90 }} align="center">Activo</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: 80 }} align="right">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} align="center"><CircularProgress size={24} /></TableCell></TableRow>
                  ) : codigosFiltrados.length === 0 ? (
                    <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.disabled' }}>Sin resultados</TableCell></TableRow>
                  ) : (
                    codigosFiltrados.map(p => (
                      <TableRow key={p.id} sx={{ opacity: p.activo ? 1 : 0.4 }}>
                        <TableCell>
                          <Typography variant="body2" fontFamily="monospace" fontWeight="bold">
                            {p.clave}
                          </Typography>
                        </TableCell>
                        <TableCell>{p.descripcion}</TableCell>
                        <TableCell>
                          {p.categoria
                            ? <Chip label={p.categoria} size="small" variant="outlined" />
                            : <Typography variant="body2" color="text.disabled">—</Typography>}
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title={p.activo ? 'Desactivar' : 'Activar'}>
                            <Switch size="small" checked={p.activo} onChange={() => handleToggleActivo(p)} color="success" />
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right">
                          <IconButton size="small" color="primary" onClick={() => handleOpenForm(p)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => handleDelete(p.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Box>
      </TabPanel>

      {/* ── TAB 1: Asignación por empresa ── */}
      <TabPanel value={tab} index={1}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
          <Autocomplete
            sx={{ minWidth: 300 }}
            size="small"
            options={empresas}
            getOptionLabel={e => e.nombre}
            value={empresas.find(e => e.id === empresaSel) ?? null}
            onChange={(_, val) => val ? handleEmpresaChange(val.id) : setEmpresaSel('')}
            renderInput={params => <TextField {...params} label="Buscar empresa..." />}
            noOptionsText="Sin resultados"
          />

          {empresaSel !== '' && (
            <TextField
              size="small"
              placeholder="Filtrar códigos..."
              value={filterAsig}
              onChange={e => setFilterAsig(e.target.value)}
              sx={{ minWidth: 220 }}
            />
          )}

          {empresaSel !== '' && (
            <Button
              variant="contained"
              disabled={!hayDiferencias() || savingAsig}
              onClick={handleGuardarAsignacion}
            >
              {savingAsig ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          )}

          {hayDiferencias() && (
            <Typography variant="body2" color="warning.main">Hay cambios sin guardar</Typography>
          )}
        </Box>

        {asigMsg && (
          <Alert severity={asigMsg.type} sx={{ mb: 2 }} onClose={() => setAsigMsg(null)}>
            {asigMsg.text}
          </Alert>
        )}

        {empresaSel === '' ? (
          <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
            <BusinessIcon sx={{ fontSize: 48, mb: 1 }} />
            <Typography>Seleccioná una empresa para ver y editar sus códigos asignados</Typography>
          </Box>
        ) : loadingAsig ? (
          <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 2 }}>
            {GRUPOS.map(g => {
              const paramsGrupo = parametros.filter(p => {
                if (p.grupo !== g.value) return false
                if (!filterAsig) return true
                const t = filterAsig.toLowerCase()
                return p.descripcion.toLowerCase().includes(t) || p.clave.toLowerCase().includes(t)
              })
              const todosGrupoMarcados = paramsGrupo.length > 0 && paramsGrupo.every(p => asignados.has(p.id))
              return (
                <Paper key={g.value} sx={{ flex: 1, p: 2, overflow: 'auto', maxHeight: 'calc(100vh - 340px)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Chip label={g.label} color={GRUPO_COLOR[g.value]} size="small" />
                    <Button
                      size="small"
                      onClick={() => toggleGrupoCompleto(g.value, !todosGrupoMarcados)}
                    >
                      {todosGrupoMarcados ? 'Desmarcar todos' : 'Marcar todos'}
                    </Button>
                  </Box>
                  <Divider sx={{ mb: 1 }} />
                  {(CATEGORIAS_POR_GRUPO[g.value] || []).map(cat => {
                    const paramsCat = paramsGrupo.filter(p => p.categoria === cat)
                    if (paramsCat.length === 0) return null
                    const todosCatMarcados = paramsCat.every(p => asignados.has(p.id))
                    return (
                      <Box key={cat} sx={{ mb: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textTransform: 'uppercase' }}>
                            {cat}
                          </Typography>
                          <Button size="small" sx={{ py: 0, fontSize: 11 }}
                            onClick={() => toggleCategoriaCompleta(g.value, cat, !todosCatMarcados)}
                          >
                            {todosCatMarcados ? 'Desmarcar' : 'Marcar'}
                          </Button>
                        </Box>
                        {paramsCat.map(p => (
                          <FormControlLabel
                            key={p.id}
                            sx={{ display: 'flex', ml: 0, mr: 0 }}
                            control={
                              <Checkbox
                                size="small"
                                checked={asignados.has(p.id)}
                                onChange={() => toggleAsignado(p.id)}
                              />
                            }
                            label={
                              <Tooltip title={p.clave} placement="right">
                                <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                  {p.descripcion}
                                </Typography>
                              </Tooltip>
                            }
                          />
                        ))}
                      </Box>
                    )
                  })}
                </Paper>
              )
            })}
          </Box>
        )}
      </TabPanel>

      {/* ── Dialog crear/editar ── */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Editar código' : 'Nuevo código'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Grupo *</InputLabel>
              <Select value={formData.grupo} label="Grupo *"
                onChange={e => setFormData({ ...formData, grupo: e.target.value, categoria: '' })}>
                {GRUPOS.map(g => <MenuItem key={g.value} value={g.value}>{g.label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label="Clave *" fullWidth value={formData.clave}
              onChange={e => setFormData({ ...formData, clave: e.target.value.toUpperCase() })}
              placeholder="Ej: GES-001"
              helperText="Formato recomendado: GES-XXX / SIT-XXX / MNP-XXX"
            />
            <TextField
              label="Descripción *" fullWidth value={formData.descripcion}
              onChange={e => setFormData({ ...formData, descripcion: e.target.value })}
            />
            <FormControl fullWidth>
              <InputLabel>Categoría</InputLabel>
              <Select value={formData.categoria} label="Categoría"
                onChange={e => setFormData({ ...formData, categoria: e.target.value })}>
                <MenuItem value=""><em>Sin categoría</em></MenuItem>
                {(CATEGORIAS_POR_GRUPO[formData.grupo] || []).map(c => (
                  <MenuItem key={c} value={c}>{c}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box sx={{ display: 'flex', gap: 3 }}>
              <FormControlLabel
                control={<Checkbox checked={formData.esGlobal} onChange={e => setFormData({ ...formData, esGlobal: e.target.checked })} />}
                label="Global (todas las empresas)"
              />
              <FormControlLabel
                control={<Checkbox checked={formData.activo} onChange={e => setFormData({ ...formData, activo: e.target.checked })} />}
                label="Activo"
              />
            </Box>
            {errorMsg && <Typography color="error" variant="body2">{errorMsg}</Typography>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleSave} variant="contained" disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default AjustesParametros
