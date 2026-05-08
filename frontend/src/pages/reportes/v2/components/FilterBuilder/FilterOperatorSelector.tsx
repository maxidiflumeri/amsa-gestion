import { FormControl, InputLabel, Select, MenuItem } from '@mui/material'
import { getOperatorsForType } from './operatorMatrix'

type FilterOperatorSelectorProps = {
  tipoEscalar?: string
  value: string
  onChange: (operador: string) => void
}

const FilterOperatorSelector = ({ tipoEscalar, value, onChange }: FilterOperatorSelectorProps) => {
  const operators = getOperatorsForType(tipoEscalar)

  return (
    <FormControl fullWidth required>
      <InputLabel>Operador</InputLabel>
      <Select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        label="Operador"
      >
        {operators.map(op => (
          <MenuItem key={op.operador} value={op.operador}>
            {op.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

export default FilterOperatorSelector
