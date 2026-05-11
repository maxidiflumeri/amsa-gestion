import { useEffect, useMemo, useState } from 'react'
import { Autocomplete, TextField, Chip, Box, Typography } from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import { NodoCatalogo } from '../../../../types/reportes'
import { reportesApi } from '../../../../api/reportes'

type FlatPath = {
  path: string
  label: string
  tipoEscalar?: string
  enumValues?: string[]
  destacado?: boolean
}

const FEATURED_PATHS = new Set<string>([
  'documento',
  'nombre',
  'apellido',
  'montoTotal',
  'fechaVencimiento',
  'empresa.nombre',
  'remesa.nombre',
  'remesa.numeroRemesa',
  'estadoSituacion.descripcion',
  'estadoGestion.descripcion',
  'motivoNoPago.descripcion',
])

const flattenCatalogo = (
  nodos: NodoCatalogo[],
  parentPath = '',
  parentLabel = '',
): FlatPath[] => {
  const result: FlatPath[] = []

  for (const nodo of nodos) {
    if (nodo.oculto) continue

    const currentPath = parentPath ? `${parentPath}.${nodo.nombre}` : nodo.nombre
    const currentLabel = parentLabel ? `${parentLabel} > ${nodo.label}` : nodo.label

    if (nodo.tipo === 'escalar') {
      result.push({
        path: currentPath,
        label: currentLabel,
        tipoEscalar: nodo.tipoEscalar,
        enumValues: nodo.enumValues,
      })
    } else if (nodo.tipo === 'relacion-1-1' && nodo.hijos) {
      result.push(...flattenCatalogo(nodo.hijos, currentPath, currentLabel))
    } else if (nodo.tipo === 'relacion-1-n' && nodo.hijos) {
      result.push({
        path: `${currentPath}[count]`,
        label: `${currentLabel} > Cantidad`,
        tipoEscalar: 'numero',
      })

      result.push(...flattenCatalogo(nodo.hijos, currentPath, currentLabel))
    }
  }

  return result
}

const findJsonNodos = (
  nodos: NodoCatalogo[],
  parentPath = '',
  parentLabel = '',
): Array<{ path: string; label: string }> => {
  const result: Array<{ path: string; label: string }> = []
  for (const nodo of nodos) {
    if (nodo.oculto) continue
    const currentPath = parentPath ? `${parentPath}.${nodo.nombre}` : nodo.nombre
    const currentLabel = parentLabel ? `${parentLabel} > ${nodo.label}` : nodo.label
    if (nodo.tipo === 'json') {
      result.push({ path: currentPath, label: currentLabel })
    } else if (
      (nodo.tipo === 'relacion-1-1' || nodo.tipo === 'relacion-1-n') &&
      nodo.hijos
    ) {
      result.push(...findJsonNodos(nodo.hijos, currentPath, currentLabel))
    }
  }
  return result
}

type FilterPathSelectorProps = {
  catalogo: NodoCatalogo[]
  empresaId?: number | null
  value: string
  onChange: (path: string, tipoEscalar?: string, enumValues?: string[]) => void
}

const FilterPathSelector = ({ catalogo, empresaId, value, onChange }: FilterPathSelectorProps) => {
  const [jsonKeys, setJsonKeys] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setJsonKeys(null)
    reportesApi
      .camposAdicionalesKeys(empresaId ?? undefined)
      .then(({ data }) => {
        if (!cancelled) setJsonKeys(data.keys)
      })
      .catch(() => {
        if (!cancelled) setJsonKeys([])
      })
    return () => {
      cancelled = true
    }
  }, [empresaId])

  const flatPaths = useMemo<FlatPath[]>(() => {
    const base = flattenCatalogo(catalogo)
    const jsonNodes = findJsonNodos(catalogo)
    const jsonPaths: FlatPath[] = []
    if (jsonKeys && jsonKeys.length > 0) {
      for (const jn of jsonNodes) {
        for (const key of jsonKeys) {
          jsonPaths.push({
            path: `${jn.path}.${key}`,
            label: `${jn.label} > ${key}`,
            tipoEscalar: 'texto',
          })
        }
      }
    }
    const all = [...base, ...jsonPaths]
    for (const p of all) {
      if (FEATURED_PATHS.has(p.path)) p.destacado = true
    }
    return all.sort((a, b) => {
      if (!!a.destacado !== !!b.destacado) return a.destacado ? -1 : 1
      return a.label.localeCompare(b.label, 'es', { sensitivity: 'base' })
    })
  }, [catalogo, jsonKeys])

  const selectedPath = flatPaths.find(p => p.path === value) || null

  return (
    <Autocomplete
      fullWidth
      options={flatPaths}
      groupBy={option => (option.destacado ? 'Destacados' : 'Todos los campos')}
      getOptionLabel={option => option.label}
      value={selectedPath}
      onChange={(_, newValue) => {
        if (newValue) {
          onChange(newValue.path, newValue.tipoEscalar, newValue.enumValues)
        }
      }}
      renderInput={params => <TextField {...params} label="Campo a filtrar" required />}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option.path}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            {option.destacado && (
              <StarIcon fontSize="small" sx={{ color: 'warning.main', mt: 0.25 }} />
            )}
            <Box>
              <Typography variant="body2">{option.label}</Typography>
              <Chip
                label={option.path}
                size="small"
                sx={{ mt: 0.5, fontSize: '0.7rem', height: 18 }}
              />
            </Box>
          </Box>
        </Box>
      )}
    />
  )
}

export default FilterPathSelector
