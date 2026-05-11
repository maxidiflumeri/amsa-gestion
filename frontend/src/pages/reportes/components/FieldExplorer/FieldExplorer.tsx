import { useState, useMemo, useEffect } from 'react'
import { Box, TextField, Paper, Typography, CircularProgress, Collapse, IconButton, Chip, Divider, Tooltip } from '@mui/material'
import { LoadingSkeleton } from '../../../../components/ui'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import StarIcon from '@mui/icons-material/Star'
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'
import DataObjectIcon from '@mui/icons-material/DataObject'
import { NodoCatalogo } from '../../../../types/reportes'
import { reportesApi } from '../../../../api/reportes'
import FieldNode from './FieldNode'

const FEATURED_PATHS = [
  'documento',
  'nombre',
  'apellido',
  'montoTotal',
  'fechaVencimiento',
  'empresa.nombre',
  'estadoSituacion.descripcion',
  'estadoGestion.descripcion',
]

const findNodeByPath = (nodos: NodoCatalogo[], path: string): NodoCatalogo | null => {
  for (const n of nodos) {
    if (n.path === path) return n
    if (n.hijos) {
      const found = findNodeByPath(n.hijos, path)
      if (found) return found
    }
  }
  return null
}

type JsonState = {
  keys: Record<string, NodoCatalogo[]>
  loading: Record<string, boolean>
  error: Record<string, string | null>
  request: (path: string) => void
}

type FieldExplorerProps = {
  catalogo: NodoCatalogo[]
  loading: boolean
  empresaId?: number | null
  onAddColumn: (path: string, label: string, tipo?: string) => void
}

type TreeBranchProps = {
  nodo: NodoCatalogo
  level: number
  expandedAll: boolean
  forceSignal: { tick: number; value: boolean } | null
  jsonState: JsonState
  onAddColumn: FieldExplorerProps['onAddColumn']
}

const TreeBranch = ({ nodo, level, expandedAll, forceSignal, jsonState, onAddColumn }: TreeBranchProps) => {
  const [open, setOpen] = useState(level === 0)

  useEffect(() => {
    if (forceSignal) {
      setOpen(forceSignal.value)
    }
  }, [forceSignal?.tick])

  const isJson = nodo.tipo === 'json'
  const showOpen = expandedAll || open

  useEffect(() => {
    if (isJson && showOpen && !jsonState.keys[nodo.path] && !jsonState.loading[nodo.path]) {
      jsonState.request(nodo.path)
    }
  }, [isJson, showOpen, nodo.path])

  if (nodo.oculto) return null

  const isEscalar = nodo.tipo === 'escalar'
  const isRelacion1N = nodo.tipo === 'relacion-1-n'
  const tieneHijos = nodo.hijos && nodo.hijos.length > 0

  if (isEscalar && !tieneHijos) {
    return (
      <Box sx={{ pl: level * 2 }}>
        <FieldNode
          nodo={nodo}
          onDoubleClick={() => onAddColumn(nodo.path, nodo.label, nodo.tipoEscalar)}
        />
      </Box>
    )
  }

  const hijosJson = isJson ? jsonState.keys[nodo.path] : undefined
  const cargandoJson = isJson && jsonState.loading[nodo.path]
  const errorJson = isJson ? jsonState.error[nodo.path] : null

  return (
    <Box>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          py: 0.5,
          px: 1,
          pl: level * 2 + 1,
          cursor: 'pointer',
          borderRadius: 0.5,
          userSelect: 'none',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <IconButton size="small" sx={{ p: 0.25, mr: 0.5 }}>
          {showOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        </IconButton>
        {isJson && (
          <DataObjectIcon fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />
        )}
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {nodo.label}
        </Typography>
        {isRelacion1N && (
          <Chip label="1:N" size="small" color="info" sx={{ ml: 1, height: 18, fontSize: '0.65rem' }} />
        )}
        {isJson && (
          <Chip label="JSON" size="small" color="default" sx={{ ml: 1, height: 18, fontSize: '0.65rem' }} />
        )}
      </Box>
      <Collapse in={showOpen} timeout="auto" unmountOnExit={false}>
        {isJson ? (
          <>
            {cargandoJson && (
              <Box sx={{ pl: (level + 1) * 2 + 1, py: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={12} />
                <Typography variant="caption" color="text.secondary">Cargando campos...</Typography>
              </Box>
            )}
            {errorJson && !cargandoJson && (
              <Typography variant="caption" color="error" sx={{ pl: (level + 1) * 2 + 1, display: 'block' }}>
                {errorJson}
              </Typography>
            )}
            {!cargandoJson && hijosJson && hijosJson.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ pl: (level + 1) * 2 + 1, display: 'block', fontStyle: 'italic' }}>
                Sin campos adicionales detectados
              </Typography>
            )}
            {hijosJson?.map(hijo => (
              <TreeBranch
                key={hijo.path}
                nodo={hijo}
                level={level + 1}
                expandedAll={expandedAll}
                forceSignal={forceSignal}
                jsonState={jsonState}
                onAddColumn={onAddColumn}
              />
            ))}
          </>
        ) : (
          nodo.hijos?.map(hijo => (
            <TreeBranch
              key={hijo.path}
              nodo={hijo}
              level={level + 1}
              expandedAll={expandedAll}
              forceSignal={forceSignal}
              jsonState={jsonState}
              onAddColumn={onAddColumn}
            />
          ))
        )}
      </Collapse>
    </Box>
  )
}

const filterCatalogo = (nodos: NodoCatalogo[], term: string): NodoCatalogo[] => {
  if (!term) return nodos
  const lower = term.toLowerCase()
  const result: NodoCatalogo[] = []
  for (const n of nodos) {
    if (n.oculto) continue
    const matches = n.label.toLowerCase().includes(lower) || n.path.toLowerCase().includes(lower)
    const hijosFiltrados = n.hijos ? filterCatalogo(n.hijos, term) : []
    if (matches || hijosFiltrados.length > 0) {
      result.push({
        ...n,
        hijos: hijosFiltrados.length > 0 ? hijosFiltrados : n.hijos,
      })
    }
  }
  return result
}

const FieldExplorer = ({ catalogo, loading, empresaId, onAddColumn }: FieldExplorerProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [forceSignal, setForceSignal] = useState<{ tick: number; value: boolean } | null>(null)
  const [jsonKeys, setJsonKeys] = useState<Record<string, NodoCatalogo[]>>({})
  const [jsonLoading, setJsonLoading] = useState<Record<string, boolean>>({})
  const [jsonError, setJsonError] = useState<Record<string, string | null>>({})

  useEffect(() => {
    setJsonKeys({})
    setJsonLoading({})
    setJsonError({})
  }, [empresaId])

  const requestJsonKeys = async (path: string) => {
    setJsonLoading(s => ({ ...s, [path]: true }))
    setJsonError(s => ({ ...s, [path]: null }))
    try {
      const { data } = await reportesApi.camposAdicionalesKeys(empresaId ?? undefined)
      const hijos: NodoCatalogo[] = data.keys.map(key => ({
        path: `${path}.${key}`,
        nombre: key,
        label: key,
        tipo: 'escalar',
        tipoEscalar: 'texto',
        filtrosPermitidos: ['eq', 'neq', 'contains', 'startsWith', 'endsWith', 'in', 'notIn', 'isNull', 'isNotNull'],
      }))
      setJsonKeys(s => ({ ...s, [path]: hijos }))
    } catch (err: any) {
      setJsonError(s => ({ ...s, [path]: 'Error al cargar campos' }))
    } finally {
      setJsonLoading(s => ({ ...s, [path]: false }))
    }
  }

  const jsonState: JsonState = {
    keys: jsonKeys,
    loading: jsonLoading,
    error: jsonError,
    request: requestJsonKeys,
  }

  const toggleAll = () =>
    setForceSignal(s => ({ tick: (s?.tick ?? 0) + 1, value: !(s?.value ?? false) }))

  const allExpanded = forceSignal?.value === true

  const filtered = useMemo(() => filterCatalogo(catalogo, searchTerm), [catalogo, searchTerm])

  const featuredNodes = useMemo(() => {
    if (searchTerm) return []
    return FEATURED_PATHS
      .map(p => findNodeByPath(catalogo, p))
      .filter((n): n is NodoCatalogo => !!n && n.tipo === 'escalar')
  }, [catalogo, searchTerm])

  if (loading) {
    return (
      <Paper sx={{ p: 2, height: '100%' }}>
        <LoadingSkeleton variant="list" rows={6} />
      </Paper>
    )
  }

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" gutterBottom>
        Explorador de campos
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
        <TextField
          size="small"
          placeholder="Buscar campo..."
          fullWidth
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <Tooltip title={allExpanded ? 'Colapsar todo' : 'Expandir todo'}>
          <span>
            <IconButton size="small" onClick={toggleAll} disabled={!!searchTerm}>
              {allExpanded ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {featuredNodes.length > 0 && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5, px: 1 }}>
              <StarIcon fontSize="small" sx={{ color: 'warning.main', mr: 0.5 }} />
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Campos destacados
              </Typography>
            </Box>
            {featuredNodes.map(nodo => (
              <Box key={`featured-${nodo.path}`} sx={{ pl: 1 }}>
                <FieldNode
                  nodo={nodo}
                  onDoubleClick={() => onAddColumn(nodo.path, nodo.label, nodo.tipoEscalar)}
                />
              </Box>
            ))}
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, px: 1 }}>
              Todos los campos
            </Typography>
          </>
        )}
        {filtered.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No se encontraron campos
          </Typography>
        ) : (
          filtered.map(nodo => (
            <TreeBranch
              key={nodo.path}
              nodo={nodo}
              level={0}
              expandedAll={!!searchTerm}
              forceSignal={forceSignal}
              jsonState={jsonState}
              onAddColumn={onAddColumn}
            />
          ))
        )}
      </Box>
    </Paper>
  )
}

export default FieldExplorer
