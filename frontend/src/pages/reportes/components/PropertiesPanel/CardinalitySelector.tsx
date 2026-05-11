import { FormControl, InputLabel, Select, MenuItem, FormHelperText } from '@mui/material'

type CardinalitySelectorProps = {
  value?: 'expandir' | 'concatenar' | 'primero' | 'ultimo'
  onChange: (value: 'expandir' | 'concatenar' | 'primero' | 'ultimo' | undefined) => void
  disabled?: boolean
}

const CardinalitySelector = ({ value, onChange, disabled }: CardinalitySelectorProps) => {
  return (
    <FormControl fullWidth disabled={disabled}>
      <InputLabel>Cardinalidad</InputLabel>
      <Select
        value={value || 'default'}
        onChange={e => onChange(e.target.value === 'default' ? undefined : e.target.value as any)}
        label="Cardinalidad"
      >
        <MenuItem value="default">Usar default de la plantilla</MenuItem>
        <MenuItem value="expandir">Expandir (nueva fila por cada valor)</MenuItem>
        <MenuItem value="concatenar">Concatenar (todos en una celda)</MenuItem>
        <MenuItem value="primero">Primero (solo el primer valor)</MenuItem>
        <MenuItem value="ultimo">Último (solo el último valor)</MenuItem>
      </Select>
      <FormHelperText>
        {value === 'expandir' && 'Cada valor genera una fila nueva'}
        {value === 'concatenar' && 'Todos los valores en una celda separados'}
        {value === 'primero' && 'Solo el primer valor encontrado'}
        {value === 'ultimo' && 'Solo el último valor encontrado'}
        {!value && 'Usa la cardinalidad por defecto de la plantilla'}
      </FormHelperText>
    </FormControl>
  )
}

export default CardinalitySelector
