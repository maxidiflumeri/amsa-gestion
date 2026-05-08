import { useEffect, useState, useReducer } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Container, Grid, Snackbar, Alert, Tabs, Tab, Paper } from '@mui/material'
import { v4 as uuidv4 } from 'uuid'
import { PlantillaV2, ColumnaV2, NodoCatalogo, FiltroV2 } from '../../../types/reportes-v2'
import { reportesV2Api } from '../../../api/reportes-v2'
import api from '../../../api/axios'
import BuilderHeader from './components/BuilderHeader/BuilderHeader'
import BuilderShell from './components/BuilderShell'
import FieldExplorer from './components/FieldExplorer/FieldExplorer'
import ColumnCanvas from './components/ColumnCanvas/ColumnCanvas'
import PropertiesPanel from './components/PropertiesPanel/PropertiesPanel'
import FilterBuilder from './components/FilterBuilder/FilterBuilder'
import PreviewPanel from './components/Preview/PreviewPanel'
import { validatePlantilla, ValidationError } from './utils/validatePlantilla'

type BuilderState = {
  plantilla: Partial<PlantillaV2>
  catalogo: NodoCatalogo[]
  empresas: { id: number; nombre: string }[]
  loading: boolean
  catalogoLoading: boolean
  saving: boolean
  error: string | null
  hasChanges: boolean
  currentTab: number
  validationErrors: ValidationError[]
}

type BuilderAction =
  | { type: 'SET_PLANTILLA'; payload: Partial<PlantillaV2> }
  | { type: 'SET_CATALOGO'; payload: NodoCatalogo[] }
  | { type: 'SET_EMPRESAS'; payload: any[] }
  | { type: 'UPDATE_FIELD'; field: keyof PlantillaV2; value: any }
  | { type: 'SET_COLUMNAS'; columnas: ColumnaV2[] }
  | { type: 'ADD_COLUMNA'; columna: ColumnaV2 }
  | { type: 'UPDATE_COLUMNA'; id: string; field: keyof ColumnaV2; value: any }
  | { type: 'REMOVE_COLUMNA'; id: string }
  | { type: 'SET_FILTROS'; filtros: FiltroV2[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_CATALOGO_LOADING'; loading: boolean }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_TAB'; tab: number }
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
    case 'MARK_CHANGES':
      return { ...state, hasChanges: action.hasChanges }
    case 'SET_VALIDATION_ERRORS':
      return { ...state, validationErrors: action.errors }
    default:
      return state
  }
}

const ReportesV2Builder = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(builderReducer, initialState)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [catalogoRes, empresasRes] = await Promise.all([
          reportesV2Api.catalogo('deudor', 3),
          api.get('/empresas'),
        ])

        dispatch({ type: 'SET_CATALOGO', payload: catalogoRes.data })
        dispatch({ type: 'SET_EMPRESAS', payload: empresasRes.data })

        if (id) {
          dispatch({ type: 'SET_LOADING', loading: true })
          const plantillaRes = await reportesV2Api.obtenerPlantilla(parseInt(id))
          dispatch({ type: 'SET_PLANTILLA', payload: plantillaRes.data })
          dispatch({ type: 'SET_LOADING', loading: false })
        }
      } catch (error: any) {
        dispatch({ type: 'SET_ERROR', error: error.response?.data?.message || 'Error al cargar datos' })
        dispatch({ type: 'SET_CATALOGO_LOADING', loading: false })
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

  const handlePlantillaChange = (field: keyof PlantillaV2, value: any) => {
    dispatch({ type: 'UPDATE_FIELD', field, value })
  }

  const handleAddColumn = (path: string, label: string, tipo?: string) => {
    const newColumn: ColumnaV2 = {
      id: uuidv4(),
      path,
      label,
      tipo: tipo as any,
    }
    dispatch({ type: 'ADD_COLUMNA', columna: newColumn })
  }

  const handleColumnasChange = (columnas: ColumnaV2[]) => {
    dispatch({ type: 'SET_COLUMNAS', columnas })
  }

  const handleColumnChange = (id: string, field: keyof ColumnaV2, value: any) => {
    dispatch({ type: 'UPDATE_COLUMNA', id, field, value })
  }

  const handleRemoveColumn = (id: string) => {
    dispatch({ type: 'REMOVE_COLUMNA', id })
  }

  const handleFiltrosChange = (filtros: FiltroV2[]) => {
    dispatch({ type: 'SET_FILTROS', filtros })
  }

  useEffect(() => {
    const errors = validatePlantilla(state.plantilla)
    dispatch({ type: 'SET_VALIDATION_ERRORS', errors })
  }, [state.plantilla])

  const handleSave = async () => {
    const errors = validatePlantilla(state.plantilla)
    const hasErrors = errors.some(e => e.type === 'error')

    if (hasErrors) {
      dispatch({ type: 'SET_ERROR', error: 'Hay errores de validación. Por favor, corregílos antes de guardar.' })
      return
    }

    try {
      dispatch({ type: 'SET_SAVING', saving: true })

      if (id) {
        await reportesV2Api.actualizarPlantilla(parseInt(id), state.plantilla)
      } else {
        await reportesV2Api.crearPlantilla(state.plantilla as Omit<PlantillaV2, 'id'>)
      }

      dispatch({ type: 'MARK_CHANGES', hasChanges: false })
      navigate('/reportes/v2')
    } catch (error: any) {
      dispatch({ type: 'SET_ERROR', error: error.response?.data?.message || 'Error al guardar la plantilla' })
    } finally {
      dispatch({ type: 'SET_SAVING', saving: false })
    }
  }

  const handleCancel = () => {
    if (state.hasChanges) {
      if (window.confirm('Hay cambios sin guardar. ¿Desea salir de todos modos?')) {
        navigate('/reportes/v2')
      }
    } else {
      navigate('/reportes/v2')
    }
  }

  const selectedColumn = state.plantilla.definicion?.columnas.find(
    c => c.id === (state as any).selectedColumnId
  ) || null

  const hasErrors = state.validationErrors.some(e => e.type === 'error')

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {state.validationErrors.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {state.validationErrors.map((err, idx) => (
            <Alert key={idx} severity={err.type} sx={{ mb: 1 }}>
              {err.message}
            </Alert>
          ))}
        </Box>
      )}

      <BuilderHeader
        plantilla={state.plantilla}
        empresas={state.empresas}
        onPlantillaChange={handlePlantillaChange}
        onSave={handleSave}
        onCancel={handleCancel}
        loading={state.saving}
        disabled={hasErrors}
      />

      <BuilderShell
        columnas={state.plantilla.definicion?.columnas || []}
        onColumnasChange={handleColumnasChange}
        onAddColumn={handleAddColumn}
      >
        {({ isDragActive, selectedId, onSelectColumn }) => (
          <Box>
            {state.currentTab === 0 && (
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} md={3}>
                  <Box sx={{ height: 600 }}>
                    <FieldExplorer
                      catalogo={state.catalogo}
                      loading={state.catalogoLoading}
                      onAddColumn={handleAddColumn}
                    />
                  </Box>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Box sx={{ height: 600 }}>
                    <ColumnCanvas
                      columnas={state.plantilla.definicion?.columnas || []}
                      selectedId={selectedId}
                      isDragActive={isDragActive}
                      onSelect={onSelectColumn}
                      onRemove={handleRemoveColumn}
                    />
                  </Box>
                </Grid>

                <Grid item xs={12} md={3}>
                  <Box sx={{ height: 600 }}>
                    <PropertiesPanel
                      columna={state.plantilla.definicion?.columnas.find(c => c.id === selectedId) || null}
                      onColumnChange={(field, value) => {
                        if (selectedId) {
                          handleColumnChange(selectedId, field, value)
                        }
                      }}
                    />
                  </Box>
                </Grid>
              </Grid>
            )}

            {state.currentTab === 1 && (
              <Box sx={{ mb: 2 }}>
                <FilterBuilder
                  filtros={state.plantilla.definicion?.filtros || []}
                  catalogo={state.catalogo}
                  onChange={handleFiltrosChange}
                />
              </Box>
            )}

            {state.currentTab === 2 && (
              <Box sx={{ mb: 2 }}>
                <PreviewPanel definicion={state.plantilla.definicion!} />
              </Box>
            )}

            <Paper sx={{ p: 2 }}>
              <Tabs value={state.currentTab} onChange={(_, val) => dispatch({ type: 'SET_TAB', tab: val })}>
                <Tab label="Columnas" />
                <Tab label="Filtros" />
                <Tab label="Preview" />
                <Tab label="Agrupaciones (Fase 5)" disabled />
              </Tabs>
            </Paper>
          </Box>
        )}
      </BuilderShell>

      <Snackbar
        open={!!state.error}
        autoHideDuration={6000}
        onClose={() => dispatch({ type: 'SET_ERROR', error: null })}
      >
        <Alert severity="error" onClose={() => dispatch({ type: 'SET_ERROR', error: null })}>
          {state.error}
        </Alert>
      </Snackbar>
    </Container>
  )
}

export default ReportesV2Builder
