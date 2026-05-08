import { FiltroV2 } from '../../../../../types/reportes-v2'
import FilterValueInput from '../FilterBuilder/FilterValueInput'

type VariableInputProps = {
  filtro: FiltroV2
  value: any
  onChange: (value: any) => void
}

const VariableInput = ({ filtro, value, onChange }: VariableInputProps) => {
  const baseLabel = filtro.labelVariable || filtro.path
  const label = filtro.obligatorio ? `${baseLabel} *` : `${baseLabel} (opcional)`
  return (
    <FilterValueInput
      operador={filtro.operador}
      tipoEscalar={filtro.tipoEscalar}
      enumValues={filtro.enumValues}
      path={filtro.path}
      value={value}
      onChange={onChange}
      label={label}
    />
  )
}

export default VariableInput
