import { useState } from 'react'
import { Box, MenuItem, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import {
  armarFechaRelativa,
  describirFechaRelativa,
  esFechaRelativa,
  parseFechaRelativa,
  resolverFechaRelativa,
} from '../../utils/fechaRelativa'

type CampoFechaProps = {
  label: string
  value: any
  onChange: (value: any) => void
  disabled?: boolean
  required?: boolean
}

/**
 * Una fecha de filtro: fija (el calendario de siempre) o relativa a hoy («hace 90 días»). La relativa se guarda como
 * `hoy-90` y se resuelve al ejecutar, así que un filtro de mora no se vence con el paso de los días
 * (docs/asistente-reportes-spec.md §11.1). Debajo se muestra a qué fecha corresponde hoy.
 */
const CampoFecha = ({ label, value, onChange, disabled = false, required = false }: CampoFechaProps) => {
  const relativa = esFechaRelativa(value)
  const dias = parseFechaRelativa(value)
  // "hoy" no recuerda si era antes o después: el signo elegido se guarda aparte.
  const [signo, setSigno] = useState<'-' | '+'>(dias !== null && dias > 0 ? '+' : '-')
  const cantidad = dias === null ? '' : String(Math.abs(dias))

  const cambiarCantidad = (texto: string) => {
    const n = texto === '' ? 0 : Math.min(3650, Math.max(0, parseInt(texto, 10) || 0))
    onChange(armarFechaRelativa(signo === '-' ? -n : n))
  }
  const cambiarSigno = (nuevo: '-' | '+') => {
    setSigno(nuevo)
    const n = Math.abs(dias ?? 0)
    onChange(armarFechaRelativa(nuevo === '-' ? -n : n))
  }

  const resuelta = relativa ? resolverFechaRelativa(value) : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={relativa ? 'relativa' : 'fija'}
        disabled={disabled}
        aria-label={`${label}: tipo de fecha`}
        onChange={(_, modo) => {
          if (modo === 'relativa' && !relativa) onChange('hoy')
          else if (modo === 'fija' && relativa) onChange('')
        }}
      >
        <ToggleButton value="fija">Fecha fija</ToggleButton>
        <ToggleButton value="relativa">Relativa a hoy</ToggleButton>
      </ToggleButtonGroup>

      {relativa ? (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            type="number"
            label={`${label} · días`}
            value={cantidad}
            onChange={e => cambiarCantidad(e.target.value)}
            disabled={disabled}
            required={required}
            inputProps={{ min: 0, max: 3650 }}
            sx={{ flex: '1 1 110px', minWidth: 0 }}
            helperText={resuelta ? `${describirFechaRelativa(value)}: ${resuelta}` : undefined}
          />
          <TextField
            select
            label="Cuándo"
            value={signo}
            onChange={e => cambiarSigno(e.target.value as '-' | '+')}
            disabled={disabled}
            sx={{ flex: '1 1 140px', minWidth: 0 }}
          >
            <MenuItem value="-">antes de hoy</MenuItem>
            <MenuItem value="+">después de hoy</MenuItem>
          </TextField>
        </Box>
      ) : (
        <TextField
          fullWidth
          type="date"
          label={label}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          InputLabelProps={{ shrink: true }}
        />
      )}
    </Box>
  )
}

export default CampoFecha
