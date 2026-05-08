import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  FormControlLabel,
  Switch,
  TextField,
} from '@mui/material'
import { useBreakpoint } from '../../../../../hooks/useBreakpoint'
import { v4 as uuidv4 } from 'uuid'
import { FiltroV2, NodoCatalogo } from '../../../../../types/reportes-v2'
import FilterPathSelector from './FilterPathSelector'
import FilterOperatorSelector from './FilterOperatorSelector'
import FilterValueInput from './FilterValueInput'

const findInCatalogo = (
  nodos: NodoCatalogo[],
  targetPath: string,
  parentPath = '',
): { tipoEscalar?: string; enumValues?: string[] } | null => {
  for (const nodo of nodos) {
    const currentPath = parentPath ? `${parentPath}.${nodo.nombre}` : nodo.nombre
    if (currentPath === targetPath) {
      return { tipoEscalar: nodo.tipoEscalar, enumValues: nodo.enumValues }
    }
    if (nodo.hijos) {
      const found = findInCatalogo(nodo.hijos, targetPath, currentPath)
      if (found) return found
    }
  }
  // Match [count] paths
  if (targetPath.endsWith('[count]')) {
    return { tipoEscalar: 'numero' }
  }
  return null
}

type FilterEditorProps = {
  open: boolean
  filtro: FiltroV2 | null
  catalogo: NodoCatalogo[]
  empresaId?: number | null
  onSave: (filtro: FiltroV2) => void
  onDelete?: () => void
  onClose: () => void
}

const FilterEditor = ({ open, filtro, catalogo, empresaId, onSave, onDelete, onClose }: FilterEditorProps) => {
  const { isMobile } = useBreakpoint()
  const [path, setPath] = useState('')
  const [tipoEscalar, setTipoEscalar] = useState<string | undefined>()
  const [enumValues, setEnumValues] = useState<string[] | undefined>()
  const [operador, setOperador] = useState('')
  const [valor, setValor] = useState<any>(undefined)
  const [variable, setVariable] = useState(false)
  const [labelVariable, setLabelVariable] = useState('')
  const [valorPorDefecto, setValorPorDefecto] = useState<any>(undefined)
  const [obligatorio, setObligatorio] = useState(false)

  useEffect(() => {
    if (filtro) {
      setPath(filtro.path)
      let resolvedTipo = filtro.tipoEscalar
      let resolvedEnum = filtro.enumValues
      if (!resolvedTipo && filtro.path) {
        const fromCat = findInCatalogo(catalogo, filtro.path)
        if (fromCat) {
          resolvedTipo = fromCat.tipoEscalar
          resolvedEnum = fromCat.enumValues
        }
      }
      setTipoEscalar(resolvedTipo)
      setEnumValues(resolvedEnum)
      setOperador(filtro.operador)
      setValor(filtro.valor)
      setVariable(filtro.variable || false)
      setLabelVariable(filtro.labelVariable || '')
      setValorPorDefecto(filtro.valorPorDefecto)
      setObligatorio(filtro.obligatorio || false)
    } else {
      setPath('')
      setTipoEscalar(undefined)
      setEnumValues(undefined)
      setOperador('')
      setValor(undefined)
      setVariable(false)
      setLabelVariable('')
      setValorPorDefecto(undefined)
      setObligatorio(false)
    }
  }, [filtro, open])

  const handlePathChange = (newPath: string, newTipo?: string, newEnumValues?: string[]) => {
    setPath(newPath)
    setTipoEscalar(newTipo)
    setEnumValues(newEnumValues)
    setOperador('')
    setValor(undefined)
  }

  const handleSave = () => {
    if (!path || !operador) return

    const requiresValue = operador !== 'isNull' && operador !== 'isNotNull'

    if (!variable && requiresValue && (valor === undefined || valor === '' || (Array.isArray(valor) && valor.length === 0))) {
      return
    }

    const newFiltro: FiltroV2 = {
      id: filtro?.id || uuidv4(),
      path,
      operador: operador as any,
      valor: !variable && requiresValue ? valor : undefined,
      variable,
      labelVariable: variable ? labelVariable : undefined,
      valorPorDefecto: variable ? valorPorDefecto : undefined,
      obligatorio: variable ? obligatorio : undefined,
      tipoEscalar,
      enumValues,
    }

    onSave(newFiltro)
    onClose()
  }

  const requiresValue = operador !== 'isNull' && operador !== 'isNotNull'
  const canSave = path && operador && (variable || !requiresValue || (valor !== undefined && valor !== '' && (!Array.isArray(valor) || valor.length > 0))) && (!variable || labelVariable.trim())

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle>{filtro ? 'Editar filtro' : 'Agregar filtro'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <FilterPathSelector
            catalogo={catalogo}
            empresaId={empresaId}
            value={path}
            onChange={handlePathChange}
          />

          {path && (
            <FilterOperatorSelector
              tipoEscalar={tipoEscalar}
              value={operador}
              onChange={setOperador}
            />
          )}

          {path && operador && (
            <>
              <FormControlLabel
                control={
                  <Switch
                    checked={variable}
                    onChange={e => setVariable(e.target.checked)}
                  />
                }
                label="Variable al ejecutar"
              />

              {variable ? (
                <>
                  <TextField
                    fullWidth
                    label="Label para el usuario"
                    value={labelVariable}
                    onChange={e => setLabelVariable(e.target.value)}
                    required
                    helperText="Texto que verá el usuario al ejecutar el reporte"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={obligatorio}
                        onChange={e => setObligatorio(e.target.checked)}
                      />
                    }
                    label="Obligatorio al ejecutar"
                  />
                  <FilterValueInput
                    operador={operador}
                    tipoEscalar={tipoEscalar}
                    enumValues={enumValues}
                    path={path}
                    value={valorPorDefecto}
                    onChange={setValorPorDefecto}
                    label="Valor por defecto (opcional)"
                  />
                </>
              ) : (
                <FilterValueInput
                  operador={operador}
                  tipoEscalar={tipoEscalar}
                  enumValues={enumValues}
                  path={path}
                  value={valor}
                  onChange={setValor}
                />
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {filtro && onDelete && (
          <Button onClick={onDelete} color="error" sx={{ mr: 'auto' }}>
            Eliminar
          </Button>
        )}
        <Button onClick={onClose}>Cancelar</Button>
        <Button onClick={handleSave} variant="contained" disabled={!canSave}>
          Guardar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default FilterEditor
