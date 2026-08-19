import { Box, Typography } from '@mui/material'
import { Filtro } from '../../../../types/reportes'
import FilterValueInput from '../FilterBuilder/FilterValueInput'

type VariableInputProps = {
  filtro: Filtro
  value: any
  onChange: (value: any) => void
}

/**
 * Los operadores de rango se dibujan como dos campos "Desde" / "Hasta", y esos dos rótulos son
 * fijos: el nombre que el autor le puso al parámetro no entra en ninguno de los dos. Con más de un
 * rango en la misma plantilla —una remesa que incluye y otra que omite, por ejemplo— quedaban
 * cuatro cajas iguales y no había forma de saber cuál era cuál. Para esos se muestra el nombre
 * arriba del par.
 */
const OPERADORES_RANGO = ['between', 'notBetween']

const VariableInput = ({ filtro, value, onChange }: VariableInputProps) => {
  const baseLabel = filtro.labelVariable || filtro.path
  const sufijo = filtro.obligatorio ? ' *' : ' (opcional)'
  const label = `${baseLabel}${sufijo}`

  const input = (
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

  if (!OPERADORES_RANGO.includes(filtro.operador)) return input

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {label}
      </Typography>
      {input}
    </Box>
  )
}

export default VariableInput
