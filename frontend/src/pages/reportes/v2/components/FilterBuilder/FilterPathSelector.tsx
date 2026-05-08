import { Autocomplete, TextField, Chip, Box, Typography } from '@mui/material'
import { NodoCatalogo } from '../../../../../types/reportes-v2'

type FlatPath = {
  path: string
  label: string
  tipoEscalar?: string
  enumValues?: string[]
}

const flattenCatalogo = (nodos: NodoCatalogo[], parentPath = '', parentLabel = ''): FlatPath[] => {
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

type FilterPathSelectorProps = {
  catalogo: NodoCatalogo[]
  value: string
  onChange: (path: string, tipoEscalar?: string, enumValues?: string[]) => void
}

const FilterPathSelector = ({ catalogo, value, onChange }: FilterPathSelectorProps) => {
  const flatPaths = flattenCatalogo(catalogo)

  const selectedPath = flatPaths.find(p => p.path === value) || null

  return (
    <Autocomplete
      fullWidth
      options={flatPaths}
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
          <Box>
            <Typography variant="body2">{option.label}</Typography>
            <Chip
              label={option.path}
              size="small"
              sx={{ mt: 0.5, fontSize: '0.7rem', height: 18 }}
            />
          </Box>
        </Box>
      )}
    />
  )
}

export default FilterPathSelector
