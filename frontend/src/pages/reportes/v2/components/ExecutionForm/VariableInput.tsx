import { FiltroV2 } from '../../../../../types/reportes-v2'
import FilterValueInput from '../FilterBuilder/FilterValueInput'

type VariableInputProps = {
  filtro: FiltroV2
  value: any
  onChange: (value: any) => void
}

const VariableInput = ({ filtro, value, onChange }: VariableInputProps) => {
  return (
    <FilterValueInput
      operador={filtro.operador}
      value={value}
      onChange={onChange}
      label={filtro.labelVariable || filtro.path}
    />
  )
}

export default VariableInput
