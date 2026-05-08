import { Box, Paper, Typography, TextField, MenuItem, Stack } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import { ColumnaV2 } from '../../../../../types/reportes-v2'
import CardinalitySelector from './CardinalitySelector'

type PropertiesPanelProps = {
  columna: ColumnaV2 | null
  onColumnChange: (field: keyof ColumnaV2, value: any) => void
}

const PropertiesPanel = ({ columna, onColumnChange }: PropertiesPanelProps) => {
  if (!columna) {
    return (
      <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <SettingsIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3, color: 'text.secondary' }} />
        <Typography variant="h6" color="text.secondary" gutterBottom>
          Seleccioná una columna
        </Typography>
        <Typography variant="body2" color="text.secondary" align="center">
          Hacé click en una columna del canvas para editar sus propiedades
        </Typography>
      </Paper>
    )
  }

  const showFormatoField = columna.tipo === 'fecha' || columna.tipo === 'numero' || columna.tipo === 'moneda'
  const showCardinalityField = true

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" gutterBottom>
        Propiedades de columna
      </Typography>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        <Stack spacing={2}>
          <TextField
            label="Etiqueta"
            fullWidth
            required
            value={columna.label}
            onChange={e => onColumnChange('label', e.target.value)}
            helperText="Nombre que aparecerá en el reporte"
          />

          <TextField
            label="Path"
            fullWidth
            disabled
            value={columna.path}
            helperText="Ruta técnica del campo"
            size="small"
          />

          <TextField
            select
            label="Tipo de dato"
            fullWidth
            value={columna.tipo || 'texto'}
            onChange={e => onColumnChange('tipo', e.target.value)}
          >
            <MenuItem value="texto">Texto</MenuItem>
            <MenuItem value="numero">Número</MenuItem>
            <MenuItem value="fecha">Fecha</MenuItem>
            <MenuItem value="boolean">Booleano</MenuItem>
            <MenuItem value="moneda">Moneda</MenuItem>
          </TextField>

          {showFormatoField && (
            <TextField
              label="Formato"
              fullWidth
              value={columna.formato || ''}
              onChange={e => onColumnChange('formato', e.target.value)}
              placeholder={
                columna.tipo === 'fecha'
                  ? 'DD/MM/YYYY'
                  : columna.tipo === 'moneda'
                  ? '$#,##0.00'
                  : '#,##0.00'
              }
              helperText={
                columna.tipo === 'fecha'
                  ? 'Ej: DD/MM/YYYY, YYYY-MM-DD'
                  : 'Ej: $#,##0.00, #,##0.00'
              }
            />
          )}

          <TextField
            label="Ancho (px)"
            type="number"
            fullWidth
            value={columna.ancho || ''}
            onChange={e => onColumnChange('ancho', e.target.value ? parseInt(e.target.value) : undefined)}
            helperText="Ancho opcional de la columna en pixels"
          />

          {showCardinalityField && (
            <CardinalitySelector
              value={columna.cardinalidad}
              onChange={value => onColumnChange('cardinalidad', value)}
            />
          )}

          {columna.cardinalidad === 'concatenar' && (
            <TextField
              label="Separador para concatenar"
              fullWidth
              value={columna.separadorConcat || ', '}
              onChange={e => onColumnChange('separadorConcat', e.target.value)}
              helperText="Texto que separa los valores concatenados"
            />
          )}
        </Stack>
      </Box>
    </Paper>
  )
}

export default PropertiesPanel
