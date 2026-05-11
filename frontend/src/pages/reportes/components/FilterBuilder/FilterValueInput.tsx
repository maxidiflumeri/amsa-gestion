import { useState, useEffect, useMemo } from 'react'
import { TextField, Autocomplete, FormControl, InputLabel, Select, MenuItem, Box, Chip, CircularProgress } from '@mui/material'
import { getInputTypeForOperator } from './operatorMatrix'
import api from '../../../../api/axios'

type FilterValueInputProps = {
  operador: string
  tipoEscalar?: string
  enumValues?: string[]
  path?: string
  value: any
  onChange: (value: any) => void
  label?: string
  disabled?: boolean
}

type SpecialSource =
  | { kind: 'empresa' }
  | { kind: 'parametro'; grupo: 'situacion' | 'gestion' | 'motivo_no_pago'; field: 'descripcion' | 'clave' }
  | null

const detectSpecialSource = (path?: string): SpecialSource => {
  if (!path) return null
  const lower = path.toLowerCase()

  if (lower === 'empresaid' || lower === 'empresa.id' || lower === 'empresa.nombre') {
    return { kind: 'empresa' }
  }

  const parametroMatch = (prefix: string, grupo: 'situacion' | 'gestion' | 'motivo_no_pago') => {
    if (lower === `${prefix}.descripcion`) return { kind: 'parametro' as const, grupo, field: 'descripcion' as const }
    if (lower === `${prefix}.clave`) return { kind: 'parametro' as const, grupo, field: 'clave' as const }
    return null
  }

  return (
    parametroMatch('estadosituacion', 'situacion') ||
    parametroMatch('estadogestion', 'gestion') ||
    parametroMatch('motivonopago', 'motivo_no_pago')
  )
}

const FilterValueInput = ({
  operador,
  tipoEscalar,
  enumValues,
  path,
  value,
  onChange,
  label = 'Valor',
  disabled = false,
}: FilterValueInputProps) => {
  const inputType = getInputTypeForOperator(operador, tipoEscalar)
  const [parametros, setParametros] = useState<Array<{ clave: string; descripcion: string }>>([])

  const specialSource = useMemo(() => detectSpecialSource(path), [path])

  const [empresaOptions, setEmpresaOptions] = useState<Array<{ id: number; nombre: string }>>([])
  const [grupoOptions, setGrupoOptions] = useState<Array<{ clave: string; descripcion: string }>>([])
  const [loadingSpecial, setLoadingSpecial] = useState(false)

  useEffect(() => {
    if (tipoEscalar === 'enum' && !enumValues) {
      const fetchParametros = async () => {
        try {
          const res = await api.get('/parametros?activo=true')
          setParametros(res.data)
        } catch (error) {
          console.error('Error al cargar parámetros:', error)
        }
      }
      fetchParametros()
    }
  }, [tipoEscalar, enumValues])

  useEffect(() => {
    let cancelled = false
    if (!specialSource) return
    setLoadingSpecial(true)
    if (specialSource.kind === 'empresa') {
      api.get('/import/empresas')
        .then(res => { if (!cancelled) setEmpresaOptions(res.data) })
        .catch(() => { if (!cancelled) setEmpresaOptions([]) })
        .finally(() => { if (!cancelled) setLoadingSpecial(false) })
    } else {
      api.get(`/parametros?grupo=${specialSource.grupo}&activo=true`)
        .then(res => { if (!cancelled) setGrupoOptions(res.data) })
        .catch(() => { if (!cancelled) setGrupoOptions([]) })
        .finally(() => { if (!cancelled) setLoadingSpecial(false) })
    }
    return () => { cancelled = true }
  }, [specialSource?.kind, (specialSource as any)?.grupo])

  if (inputType === 'none') {
    return (
      <TextField
        fullWidth
        label={label}
        value="(sin valor)"
        disabled
        helperText="Este operador no requiere valor"
      />
    )
  }

  if (specialSource && specialSource.kind === 'parametro' && (operador === 'between' || operador === 'notBetween')) {
    const valueOf = (p: { clave: string; descripcion: string }) =>
      specialSource.field === 'clave' ? p.clave : p.descripcion
    const [desde, hasta] = Array.isArray(value) ? value : [undefined, undefined]
    const selectedDesde = grupoOptions.find(p => valueOf(p) === desde) || null
    const selectedHasta = grupoOptions.find(p => valueOf(p) === hasta) || null

    return (
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Autocomplete
          fullWidth
          options={grupoOptions}
          getOptionLabel={o => `${o.descripcion} (${o.clave})`}
          value={selectedDesde}
          onChange={(_, newValue) => onChange([newValue ? valueOf(newValue) : undefined, hasta])}
          disabled={disabled}
          loading={loadingSpecial}
          renderInput={params => (
            <TextField {...params} label="Desde" required={!disabled} />
          )}
        />
        <Autocomplete
          fullWidth
          options={grupoOptions}
          getOptionLabel={o => `${o.descripcion} (${o.clave})`}
          value={selectedHasta}
          onChange={(_, newValue) => onChange([desde, newValue ? valueOf(newValue) : undefined])}
          disabled={disabled}
          loading={loadingSpecial}
          renderInput={params => (
            <TextField {...params} label="Hasta" required={!disabled} />
          )}
        />
      </Box>
    )
  }

  if (specialSource && (operador === 'eq' || operador === 'neq' || operador === 'in' || operador === 'notIn')) {
    const isMulti = operador === 'in' || operador === 'notIn'

    if (specialSource.kind === 'empresa') {
      const isIdField = path?.toLowerCase() === 'empresaid' || path?.toLowerCase() === 'empresa.id'

      if (isMulti) {
        const selected = Array.isArray(value)
          ? empresaOptions.filter(e => isIdField ? value.includes(e.id) : value.includes(e.nombre))
          : []
        return (
          <Autocomplete
            multiple
            fullWidth
            options={empresaOptions}
            getOptionLabel={o => o.nombre}
            value={selected}
            onChange={(_, newValue) => onChange(newValue.map(e => isIdField ? e.id : e.nombre))}
            disabled={disabled}
            loading={loadingSpecial}
            renderInput={params => (
              <TextField
                {...params}
                label={label}
                required={!disabled && selected.length === 0}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingSpecial ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderTags={(tagValue, getTagProps) =>
              tagValue.map((option, index) => (
                <Chip label={option.nombre} {...getTagProps({ index })} key={option.id} size="small" />
              ))
            }
          />
        )
      }

      const selected = empresaOptions.find(e => isIdField ? e.id === value : e.nombre === value) || null
      return (
        <Autocomplete
          fullWidth
          options={empresaOptions}
          getOptionLabel={o => o.nombre}
          value={selected}
          onChange={(_, newValue) => onChange(newValue ? (isIdField ? newValue.id : newValue.nombre) : undefined)}
          disabled={disabled}
          loading={loadingSpecial}
          renderInput={params => (
            <TextField
              {...params}
              label={label}
              required={!disabled}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loadingSpecial ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
      )
    }

    // parametro
    const valueOf = (p: { clave: string; descripcion: string }) =>
      specialSource.field === 'clave' ? p.clave : p.descripcion

    if (isMulti) {
      const selected = Array.isArray(value)
        ? grupoOptions.filter(p => value.includes(valueOf(p)))
        : []
      return (
        <Autocomplete
          multiple
          fullWidth
          options={grupoOptions}
          getOptionLabel={o => `${o.descripcion} (${o.clave})`}
          value={selected}
          onChange={(_, newValue) => onChange(newValue.map(valueOf))}
          disabled={disabled}
          loading={loadingSpecial}
          renderInput={params => (
            <TextField
              {...params}
              label={label}
              required={!disabled && selected.length === 0}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loadingSpecial ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          renderTags={(tagValue, getTagProps) =>
            tagValue.map((option, index) => (
              <Chip label={option.descripcion} {...getTagProps({ index })} key={option.clave} size="small" />
            ))
          }
        />
      )
    }

    const selected = grupoOptions.find(p => valueOf(p) === value) || null
    return (
      <Autocomplete
        fullWidth
        options={grupoOptions}
        getOptionLabel={o => `${o.descripcion} (${o.clave})`}
        value={selected}
        onChange={(_, newValue) => onChange(newValue ? valueOf(newValue) : undefined)}
        disabled={disabled}
        loading={loadingSpecial}
        renderInput={params => (
          <TextField
            {...params}
            label={label}
            required={!disabled}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loadingSpecial ? <CircularProgress size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />
    )
  }

  if (inputType === 'text') {
    return (
      <TextField
        fullWidth
        label={label}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        required={!disabled}
      />
    )
  }

  if (inputType === 'number') {
    return (
      <TextField
        fullWidth
        type="number"
        label={label}
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
        disabled={disabled}
        required={!disabled}
      />
    )
  }

  if (inputType === 'date') {
    return (
      <TextField
        fullWidth
        type="date"
        label={label}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        required={!disabled}
        InputLabelProps={{ shrink: true }}
      />
    )
  }

  if (inputType === 'range') {
    const [desde, hasta] = Array.isArray(value) ? value : [undefined, undefined]

    if (tipoEscalar === 'fecha') {
      return (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            fullWidth
            type="date"
            label="Desde"
            value={desde || ''}
            onChange={e => onChange([e.target.value, hasta])}
            disabled={disabled}
            required={!disabled}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            fullWidth
            type="date"
            label="Hasta"
            value={hasta || ''}
            onChange={e => onChange([desde, e.target.value])}
            disabled={disabled}
            required={!disabled}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
      )
    }

    if (tipoEscalar === 'numero') {
      return (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            fullWidth
            type="number"
            label="Desde"
            value={desde ?? ''}
            onChange={e => onChange([e.target.value ? parseFloat(e.target.value) : undefined, hasta])}
            disabled={disabled}
            required={!disabled}
          />
          <TextField
            fullWidth
            type="number"
            label="Hasta"
            value={hasta ?? ''}
            onChange={e => onChange([desde, e.target.value ? parseFloat(e.target.value) : undefined])}
            disabled={disabled}
            required={!disabled}
          />
        </Box>
      )
    }

    return (
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          label="Desde"
          value={desde ?? ''}
          onChange={e => onChange([e.target.value, hasta])}
          disabled={disabled}
          required={!disabled}
        />
        <TextField
          fullWidth
          label="Hasta"
          value={hasta ?? ''}
          onChange={e => onChange([desde, e.target.value])}
          disabled={disabled}
          required={!disabled}
        />
      </Box>
    )
  }

  if (inputType === 'select-single') {
    if (tipoEscalar === 'boolean') {
      return (
        <FormControl fullWidth required={!disabled}>
          <InputLabel>{label}</InputLabel>
          <Select
            value={value ?? ''}
            onChange={e => onChange(e.target.value === 'true')}
            disabled={disabled}
            label={label}
          >
            <MenuItem value="true">Sí</MenuItem>
            <MenuItem value="false">No</MenuItem>
          </Select>
        </FormControl>
      )
    }

    const options = enumValues || parametros.map(p => p.clave)

    return (
      <FormControl fullWidth required={!disabled}>
        <InputLabel>{label}</InputLabel>
        <Select
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          label={label}
        >
          {options.map(opt => (
            <MenuItem key={opt} value={opt}>
              {opt}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    )
  }

  if (inputType === 'select-multi') {
    const options = enumValues || parametros.map(p => p.clave)
    const selectedValues = Array.isArray(value) ? value : []

    return (
      <Autocomplete
        multiple
        fullWidth
        options={options}
        value={selectedValues}
        onChange={(_, newValue) => onChange(newValue)}
        disabled={disabled}
        renderInput={params => <TextField {...params} label={label} required={!disabled && selectedValues.length === 0} />}
        renderTags={(tagValue, getTagProps) =>
          tagValue.map((option, index) => (
            <Chip label={option} {...getTagProps({ index })} key={option} size="small" />
          ))
        }
      />
    )
  }

  return null
}

export default FilterValueInput
