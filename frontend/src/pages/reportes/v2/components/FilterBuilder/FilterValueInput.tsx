import { useState, useEffect } from 'react'
import { TextField, Autocomplete, FormControl, InputLabel, Select, MenuItem, Box, Chip } from '@mui/material'
import { getInputTypeForOperator } from './operatorMatrix'
import api from '../../../../../api/axios'

type FilterValueInputProps = {
  operador: string
  tipoEscalar?: string
  enumValues?: string[]
  value: any
  onChange: (value: any) => void
  label?: string
  disabled?: boolean
}

const FilterValueInput = ({
  operador,
  tipoEscalar,
  enumValues,
  value,
  onChange,
  label = 'Valor',
  disabled = false,
}: FilterValueInputProps) => {
  const inputType = getInputTypeForOperator(operador, tipoEscalar)
  const [parametros, setParametros] = useState<Array<{ clave: string; descripcion: string }>>([])

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

    return (
      <Box sx={{ display: 'flex', gap: 1 }}>
        {tipoEscalar === 'fecha' ? (
          <>
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
          </>
        ) : (
          <>
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
          </>
        )}
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
