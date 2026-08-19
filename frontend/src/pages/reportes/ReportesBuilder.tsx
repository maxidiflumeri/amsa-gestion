import { useEffect, useReducer } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Grid, Alert, Tabs, Tab, Paper, Button } from '@mui/material'
import { v4 as uuidv4 } from 'uuid'
import SaveIcon from '@mui/icons-material/Save'
import CloseIcon from '@mui/icons-material/Close'
import { Plantilla, Columna, NodoCatalogo, Filtro, Agrupacion, Total } from '../../types/reportes'
import { reportesApi } from '../../api/reportes'
import api from '../../api/axios'
import { PageHeader, SectionCard, LoadingSkeleton } from '../../components/ui'
import { useNotify } from '../../hooks/useNotify'
import { useConfirm } from '../../context/ConfirmContext'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import BuilderHeader from './components/BuilderHeader/BuilderHeader'
import BuilderShell from './components/BuilderShell'
import FieldExplorer from './components/FieldExplorer/FieldExplorer'
import ColumnCanvas from './components/ColumnCanvas/ColumnCanvas'
import PropertiesPanel from './components/PropertiesPanel/PropertiesPanel'
import FilterBuilder from './components/FilterBuilder/FilterBuilder'
import GroupingBuilder from './components/GroupingBuilder/GroupingBuilder'
import PreviewPanel from './components/Preview/PreviewPanel'
import { validatePlantilla, ValidationError } from './utils/validatePlantilla'

type BuilderState = {
  plantilla: Partial<Plantilla>
  catalogo: NodoCatalogo[]
  empresas: { id: number; nombre: string }[]
  loading: boolean
  catalogoLoading: boolean
  saving: boolean
  error: string | null
  hasChanges: boolean
  currentTab: number
  mobileSubTab: number
  validationErrors: ValidationError[]
}

type BuilderAction =
  | { type: 'SET_PLANTILLA'; payload: Partial<Plantilla> }
  | { type: 'SET_CATALOGO'; payload: NodoCatalogo[] }
  | { type: 'SET_EMPRESAS'; payload: any[] }
  | { type: 'UPDATE_FIELD'; field: keyof Plantilla; value: any }
  | { type: 'SET_COLUMNAS'; columnas: Columna[] }
  | { type: 'ADD_COLUMNA'; columna: Columna }
  | { type: 'UPDATE_COLUMNA'; id: string; field: keyof Columna; value: any }
  | { type: 'REMOVE_COLUMNA'; id: string }
  | { type: 'SET_FILTROS'; filtros: Filtro[] }
  | { type: 'SET_AGRUPACIONES_TOTALES'; agrupaciones: Agrupacion[]; totales: Total[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_CATALOGO_LOADING'; loading: boolean }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_TAB'; tab: number }
  | { type: 'SET_MOBILE_SUB_TAB'; tab: number }
  | { type: 'MARK_CHANGES'; hasChanges: boolean }
  | { type: 'SET_VALIDATION_ERRORS'; errors: ValidationError[] }

const initialState: BuilderState = {
  plantilla: {
    nombre: '',
    descripcion: '',
    raiz: 'deudor',
    empresaId: null,
    formatoSalida: 'xlsx',
    definicion: {
      columnas: [],
      filtros: [],
      ordenamientos: [],
      agrupaciones: [],
      totales: [],
      cardinalidadDefault: 'concatenar',
    },
  },
  catalogo: [],
  empresas: [],
  loading: false,
  catalogoLoading: true,
  saving: false,
  error: null,
  hasChanges: false,
  currentTab: 0,
  mobileSubTab: 0,
  validationErrors: [],
}

const builderReducer = (state: BuilderState, action: BuilderAction): BuilderState => {
  switch (action.type) {
    case 'SET_PLANTILLA':
      return { ...state, plantilla: action.payload, hasChanges: false }
    case 'SET_CATALOGO':
      return { ...state, catalogo: action.payload, catalogoLoading: false }
    case 'SET_EMPRESAS':
      return { ...state, empresas: action.payload }
    case 'UPDATE_FIELD':
      return {
        ...state,
        plantilla: { ...state.plantilla, [action.field]: action.value },
        hasChanges: true,
      }
    case 'SET_COLUMNAS':
      return {
        ...state,
        plantilla: {
          ...state.plantilla,
          definicion: { ...state.plantilla.definicion!, columnas: action.columnas },
        },
        hasChanges: true,
      }
    case 'ADD_COLUMNA':
      return {
        ...state,
        plantilla: {
          ...state.plantilla,
          definicion: {
            ...state.plantilla.definicion!,
            columnas: [...(state.plantilla.definicion?.columnas || []), action.columna],
          },
        },
        hasChanges: true,
      }
    case 'UPDATE_COLUMNA':
      return {
        ...state,
        plantilla: {
          ...state.plantilla,
          definicion: {
            ...state.plantilla.definicion!,
            columnas: state.plantilla.definicion!.columnas.map(c =>
              c.id === action.id ? { ...c, [action.field]: action.value } : c
            ),
          },
        },
        hasChanges: true,
      }
    case 'REMOVE_COLUMNA':
      return {
        ...state,
        plantilla: {
          ...state.plantilla,
          definicion: {
            ...state.plantilla.definicion!,
            columnas: state.plantilla.definicion!.columnas.filter(c => c.id !== action.id),
          },
        },
        hasChanges: true,
      }
    case 'SET_FILTROS':
      return {
        ...state,
        plantilla: {
          ...state.plantilla,
          definicion: { ...state.plantilla.definicion!, filtros: action.filtros },
        },
        hasChanges: true,
      }
    case 'SET_AGRUPACIONES_TOTALES':
      return {
        ...state,
        plantilla: {
          ...state.plantilla,
          definicion: {
            ...state.plantilla.definicion!,
            agrupaciones: action.agrupaciones,
            totales: action.totales,
          },
        },
        hasChanges: true,
      }
    case 'SET_LOADING':
      return { ...state, loading: action.loading }
    case 'SET_CATALOGO_LOADING':
      return { ...state, catalogoLoading: action.loading }
    case 'SET_SAVING':
      return { ...state, saving: action.saving }
    case 'SET_ERROR':
      return { ...state, error: action.error }
    case 'SET_TAB':
      return { ...state, currentTab: action.tab }
    case 'SET_MOBILE_SUB_TAB':
      return { ...state, mobileSubTab: action.tab }
    case 'MARK_CHANGES':
      return { ...state, hasChanges: action.hasChanges }
    case 'SET_VALIDATION_ERRORS':
      return { ...state, validationErrors: action.errors }
    default:
      return state
  }
}

const ReportesBuilder = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const notify = useNotify()
  const confirm = useConfirm()
  const { isMobile } = useBreakpoint()
  const [state, dispatch] = useReducer(builderReducer, initialState)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [catalogoRes, empresasRes] = await Promise.all([
          reportesApi.catalogo('deudor', 3),
          api.get('/empresas'),
        ])

        dispatch({ type: 'SET_CATALOGO', payload: catalogoRes.data })
        dispatch({ type: 'SET_EMPRESAS', payload: empresasRes.data })

        if (id) {
          dispatch({ type: 'SET_LOADING', loading: true })
          const plantillaRes = await reportesApi.obtenerPlantilla(parseInt(id))
          dispatch({ type: 'SET_PLANTILLA', payload: plantillaRes.data })
          dispatch({ type: 'SET_LOADING', loading: false })
        }
      } catch (error: any) {
        notify.error(error)
        dispatch({ type: 'SET_CATALOGO_LOADING', loading: false })
        dispatch({ type: 'SET_LOADING', loading: false })
      }
    }

    loadData()
  }, [id])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.hasChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [state.hasChanges])

  const handlePlantillaChange = (field: keyof Plantilla, value: any) => {
    dispatch({ type: 'UPDATE_FIELD', field, value })
  }

  const handleAddColumn = (path: string, label: string, tipo?: string) => {
    const newColumn: Columna = {
      id: uuidv4(),
      path,
      label,
      tipo: tipo as any,
    }
    dispatch({ type: 'ADD_COLUMNA', columna: newColumn })
  }

  /**
   * Columna fija: sin path, no sale de los datos. Se usa para respetar la estructura de columnas
   * que espera el sistema destino cuando no hay dato para todas — la base de Neotel pide ocho
   * columnas de teléfono aunque el caso tenga uno solo.
   */
  const handleAddFixedColumn = () => {
    const fijas = (state.plantilla.definicion?.columnas || []).filter(c => !c.path).length
    const newColumn: Columna = {
      id: uuidv4(),
      path: '',
      label: `columna${fijas + 1}`,
      tipo: 'texto',
      valorFijo: '',
    }
    dispatch({ type: 'ADD_COLUMNA', columna: newColumn })
  }

  const handleColumnasChange = (columnas: Columna[]) => {
    dispatch({ type: 'SET_COLUMNAS', columnas })
  }

  const handleColumnChange = (id: string, field: keyof Columna, value: any) => {
    dispatch({ type: 'UPDATE_COLUMNA', id, field, value })
  }

  const handleRemoveColumn = (id: string) => {
    dispatch({ type: 'REMOVE_COLUMNA', id })
  }

  const handleFiltrosChange = (filtros: Filtro[]) => {
    dispatch({ type: 'SET_FILTROS', filtros })
  }

  const handleAgrupacionesTotalesChange = (agrupaciones: Agrupacion[], totales: Total[]) => {
    dispatch({ type: 'SET_AGRUPACIONES_TOTALES', agrupaciones, totales })
  }

  useEffect(() => {
    const errors = validatePlantilla(state.plantilla)
    dispatch({ type: 'SET_VALIDATION_ERRORS', errors })
  }, [state.plantilla])

  const handleSave = async () => {
    const errors = validatePlantilla(state.plantilla)
    const hasErrors = errors.some(e => e.type === 'error')

    if (hasErrors) {
      notify.warning('Hay errores de validación. Por favor, corregílos antes de guardar.')
      return
    }

    try {
      dispatch({ type: 'SET_SAVING', saving: true })

      if (id) {
        await reportesApi.actualizarPlantilla(parseInt(id), state.plantilla)
      } else {
        await reportesApi.crearPlantilla(state.plantilla as Omit<Plantilla, 'id'>)
      }

      dispatch({ type: 'MARK_CHANGES', hasChanges: false })
      notify.success('Plantilla guardada')
      navigate('/reportes')
    } catch (error: any) {
      notify.error(error)
    } finally {
      dispatch({ type: 'SET_SAVING', saving: false })
    }
  }

  const handleCancel = async () => {
    if (state.hasChanges) {
      const ok = await confirm({
        title: 'Cambios sin guardar',
        description: 'Hay cambios sin guardar. ¿Querés salir igual?',
        confirmLabel: 'Salir',
        cancelLabel: 'Seguir editando',
        confirmColor: 'warning',
      })
      if (!ok) return
    }
    navigate('/reportes')
  }

  const hasErrors = state.validationErrors.some(e => e.type === 'error')

  const isInitialLoading = state.loading && !state.plantilla.nombre

  if (isInitialLoading) {
    return (
      <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
        <LoadingSkeleton variant="form" />
      </Box>
    )
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 3 }}>
      <PageHeader
        title={id ? state.plantilla.nombre || 'Editar plantilla' : 'Nueva plantilla'}
        breadcrumbs={[
          { label: 'Reportes', href: '/reportes' },
          { label: id ? 'Editar' : 'Nueva' },
        ]}
        actions={[
          {
            label: 'Cancelar',
            onClick: handleCancel,
            variant: 'outlined',
            startIcon: <CloseIcon />,
          },
          {
            label: state.saving ? 'Guardando...' : 'Guardar',
            onClick: handleSave,
            variant: 'contained',
            disabled: state.saving || hasErrors,
            startIcon: <SaveIcon />,
          },
        ]}
      />

      {state.validationErrors.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {state.validationErrors.map((err, idx) => (
            <Alert key={idx} severity={err.type} sx={{ mb: 1 }}>
              {err.message}
            </Alert>
          ))}
        </Box>
      )}

      <SectionCard title="Detalles" sx={{ mb: 2 }}>
        <BuilderHeader
          plantilla={state.plantilla}
          empresas={state.empresas}
          onPlantillaChange={handlePlantillaChange}
        />
      </SectionCard>

      <BuilderShell
        columnas={state.plantilla.definicion?.columnas || []}
        onColumnasChange={handleColumnasChange}
        onAddColumn={handleAddColumn}
      >
        {({ isDragActive, selectedId, onSelectColumn }) => (
          <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Paper
              elevation={2}
              sx={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                mb: 2,
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Tabs
                value={state.currentTab}
                onChange={(_, val) => dispatch({ type: 'SET_TAB', tab: val })}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab label="Columnas" />
                <Tab label="Filtros" />
                <Tab label="Agrupaciones y Totales" />
                <Tab label="Preview" />
              </Tabs>
            </Paper>

            {state.currentTab === 0 && (
              isMobile ? (
                <Box>
                  <Tabs
                    value={state.mobileSubTab}
                    onChange={(_, val) => dispatch({ type: 'SET_MOBILE_SUB_TAB', tab: val })}
                    variant="fullWidth"
                    sx={{ mb: 2 }}
                  >
                    <Tab label="Campos" />
                    <Tab label="Canvas" />
                    <Tab label="Propiedades" disabled={!selectedId} />
                  </Tabs>

                  {state.mobileSubTab === 0 && (
                    <Box sx={{ minHeight: 400 }}>
                      <FieldExplorer
                        catalogo={state.catalogo}
                        loading={state.catalogoLoading}
                        empresaId={state.plantilla.empresaId}
                        onAddColumn={handleAddColumn}
                      />
                    </Box>
                  )}
                  {state.mobileSubTab === 1 && (
                    <Box sx={{ minHeight: 400 }}>
                      <ColumnCanvas
                        columnas={state.plantilla.definicion?.columnas || []}
                        selectedId={selectedId}
                        isDragActive={isDragActive}
                        onSelect={onSelectColumn}
                        onRemove={handleRemoveColumn}
                        onAddFixed={handleAddFixedColumn}
                      />
                    </Box>
                  )}
                  {state.mobileSubTab === 2 && (
                    <Box sx={{ minHeight: 400 }}>
                      <PropertiesPanel
                        columna={state.plantilla.definicion?.columnas.find(c => c.id === selectedId) || null}
                        onColumnChange={(field, value) => {
                          if (selectedId) handleColumnChange(selectedId, field, value)
                        }}
                      />
                    </Box>
                  )}
                </Box>
              ) : (
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={12} md={3}>
                    <Box sx={{ height: 'calc(100vh - 280px)', minHeight: 400 }}>
                      <FieldExplorer
                        catalogo={state.catalogo}
                        loading={state.catalogoLoading}
                        empresaId={state.plantilla.empresaId}
                        onAddColumn={handleAddColumn}
                      />
                    </Box>
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Box sx={{ height: 'calc(100vh - 280px)', minHeight: 400 }}>
                      <ColumnCanvas
                        columnas={state.plantilla.definicion?.columnas || []}
                        selectedId={selectedId}
                        isDragActive={isDragActive}
                        onSelect={onSelectColumn}
                        onRemove={handleRemoveColumn}
                        onAddFixed={handleAddFixedColumn}
                      />
                    </Box>
                  </Grid>

                  <Grid item xs={12} md={3}>
                    <Box sx={{ height: 'calc(100vh - 280px)', minHeight: 400 }}>
                      <PropertiesPanel
                        columna={state.plantilla.definicion?.columnas.find(c => c.id === selectedId) || null}
                        onColumnChange={(field, value) => {
                          if (selectedId) handleColumnChange(selectedId, field, value)
                        }}
                      />
                    </Box>
                  </Grid>
                </Grid>
              )
            )}

            {state.currentTab === 1 && (
              <Box sx={{ mb: 2 }}>
                <FilterBuilder
                  filtros={state.plantilla.definicion?.filtros || []}
                  catalogo={state.catalogo}
                  empresaId={state.plantilla.empresaId}
                  onChange={handleFiltrosChange}
                />
              </Box>
            )}

            {state.currentTab === 2 && (
              <Box sx={{ mb: 2 }}>
                <GroupingBuilder
                  agrupaciones={state.plantilla.definicion?.agrupaciones || []}
                  totales={state.plantilla.definicion?.totales || []}
                  columnas={state.plantilla.definicion?.columnas || []}
                  onChange={handleAgrupacionesTotalesChange}
                />
              </Box>
            )}

            {state.currentTab === 3 && (
              <Box sx={{ mb: 2 }}>
                <PreviewPanel definicion={state.plantilla.definicion!} />
              </Box>
            )}
          </Box>
        )}
      </BuilderShell>
    </Box>
  )
}

export default ReportesBuilder
