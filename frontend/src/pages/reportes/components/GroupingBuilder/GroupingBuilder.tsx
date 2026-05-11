import { useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  IconButton,
  FormControlLabel,
  Switch,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Stack,
  Alert,
  Collapse,
  Link,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import { Agrupacion, Total, Columna } from '../../../../types/reportes'
import { v4 as uuidv4 } from 'uuid'

interface GroupingBuilderProps {
  agrupaciones: Agrupacion[]
  totales: Total[]
  columnas: Columna[]
  onChange: (agrupaciones: Agrupacion[], totales: Total[]) => void
}

export default function GroupingBuilder({
  agrupaciones,
  totales,
  columnas,
  onChange,
}: GroupingBuilderProps) {
  const [selectedAgrupacion, setSelectedAgrupacion] = useState<string | null>(null)
  const [helpAgrupOpen, setHelpAgrupOpen] = useState(false)
  const [helpTotalOpen, setHelpTotalOpen] = useState(false)

  const handleAddAgrupacion = () => {
    if (columnas.length === 0) return

    const newAgrupacion: Agrupacion = {
      path: columnas[0].path,
      mostrarSubtotales: false,
      saltoPagina: false,
    }
    onChange([...agrupaciones, newAgrupacion], totales)
  }

  const handleRemoveAgrupacion = (index: number) => {
    const newAgrupaciones = agrupaciones.filter((_, i) => i !== index)
    onChange(newAgrupaciones, totales)
  }

  const handleUpdateAgrupacion = (index: number, field: keyof Agrupacion, value: any) => {
    const newAgrupaciones = [...agrupaciones]
    newAgrupaciones[index] = { ...newAgrupaciones[index], [field]: value }
    onChange(newAgrupaciones, totales)
  }

  const handleAddTotal = () => {
    const columnasNumericas = columnas.filter(c =>
      c.tipo === 'numero' || c.tipo === 'moneda' || c.path.includes('[sum]') || c.path.includes('[avg]')
    )

    if (columnasNumericas.length === 0) return

    const newTotal: Total = {
      path: columnasNumericas[0].path,
      funcion: 'sum',
      label: `Total ${columnasNumericas[0].label}`,
    }
    onChange(agrupaciones, [...totales, newTotal])
  }

  const handleRemoveTotal = (index: number) => {
    const newTotales = totales.filter((_, i) => i !== index)
    onChange(agrupaciones, newTotales)
  }

  const handleUpdateTotal = (index: number, field: keyof Total, value: any) => {
    const newTotales = [...totales]
    newTotales[index] = { ...newTotales[index], [field]: value }
    onChange(agrupaciones, newTotales)
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, height: 600 }}>
      <Paper sx={{ flex: 1, p: 2, overflow: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Agrupaciones</Typography>
          <Button
            startIcon={<AddIcon />}
            onClick={handleAddAgrupacion}
            disabled={columnas.length === 0}
            size="small"
          >
            Agregar
          </Button>
        </Box>

        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            Agrupan filas que comparten un mismo valor (ej: por empresa, por estado).{' '}
            <Link component="button" type="button" onClick={() => setHelpAgrupOpen(o => !o)} sx={{ verticalAlign: 'baseline' }}>
              {helpAgrupOpen ? 'Ocultar ejemplos' : 'Ver ejemplos'}
            </Link>
          </Typography>
          <Collapse in={helpAgrupOpen}>
            <Box sx={{ mt: 1.5, fontSize: 13, lineHeight: 1.6 }}>
              <Box>• Cada nivel agrega un encabezado de grupo en el reporte.</Box>
              <Box>• Si activás <b>"Mostrar subtotales"</b>, se calcula un total por grupo (usando los totales definidos al lado).</Box>
              <Box>• <b>"Salto de página (PDF)"</b> empieza cada grupo en una página nueva al exportar.</Box>
              <Box sx={{ mt: 1 }}><b>Ejemplo:</b> agrupar por <i>Empresa</i> → el reporte muestra un bloque por empresa con sus deudores y, si tildás subtotales, una fila "Total ACME" debajo.</Box>
              <Box sx={{ mt: 1 }}>Podés anidar varios niveles: <i>Empresa → Estado situación</i> agrupa primero por empresa y dentro de cada empresa, por estado.</Box>
            </Box>
          </Collapse>
        </Alert>

        {agrupaciones.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No hay agrupaciones. Las filas se mostrarán sin agrupar.
          </Typography>
        ) : (
          <List>
            {agrupaciones.map((agrupacion, index) => (
              <ListItem
                key={index}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  mb: 1,
                  flexDirection: 'column',
                  alignItems: 'stretch',
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', mb: 1 }}>
                  <Typography variant="body2" fontWeight="bold">
                    Nivel {index + 1}
                  </Typography>
                  <IconButton size="small" onClick={() => handleRemoveAgrupacion(index)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>

                <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                  <InputLabel>Campo</InputLabel>
                  <Select
                    value={agrupacion.path}
                    label="Campo"
                    onChange={e => handleUpdateAgrupacion(index, 'path', e.target.value)}
                  >
                    {columnas.map(col => (
                      <MenuItem key={col.id} value={col.path}>
                        {col.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControlLabel
                  control={
                    <Switch
                      checked={agrupacion.mostrarSubtotales || false}
                      onChange={e => handleUpdateAgrupacion(index, 'mostrarSubtotales', e.target.checked)}
                    />
                  }
                  label="Mostrar subtotales"
                />

                <FormControlLabel
                  control={
                    <Switch
                      checked={agrupacion.saltoPagina || false}
                      onChange={e => handleUpdateAgrupacion(index, 'saltoPagina', e.target.checked)}
                    />
                  }
                  label="Salto de página (PDF)"
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <Paper sx={{ flex: 1, p: 2, overflow: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Totales</Typography>
          <Button startIcon={<AddIcon />} onClick={handleAddTotal} size="small">
            Agregar
          </Button>
        </Box>

        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            Calculan un valor agregado al pie del reporte (suma, promedio, mínimo, máximo, cantidad).{' '}
            <Link component="button" type="button" onClick={() => setHelpTotalOpen(o => !o)} sx={{ verticalAlign: 'baseline' }}>
              {helpTotalOpen ? 'Ocultar ejemplos' : 'Ver ejemplos'}
            </Link>
          </Typography>
          <Collapse in={helpTotalOpen}>
            <Box sx={{ mt: 1.5, fontSize: 13, lineHeight: 1.6 }}>
              <Box>• <b>Suma</b>: total acumulado de la columna (ej: total adeudado).</Box>
              <Box>• <b>Promedio</b>: valor medio de la columna.</Box>
              <Box>• <b>Cantidad</b>: cuántas filas hay (no necesita columna numérica).</Box>
              <Box>• <b>Mínimo / Máximo</b>: el menor o mayor valor de la columna.</Box>
              <Box sx={{ mt: 1 }}><b>Ejemplo:</b> Suma de <i>Monto Total</i> → fila final "Total: $1.250.000".</Box>
              <Box sx={{ mt: 1 }}>Si tenés <b>agrupaciones con subtotales</b>, estos totales se calculan también por cada grupo.</Box>
            </Box>
          </Collapse>
        </Alert>

        {totales.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No hay totales configurados. El reporte no mostrará fila de total general.
          </Typography>
        ) : (
          <List>
            {totales.map((total, index) => (
              <ListItem
                key={index}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  mb: 1,
                  flexDirection: 'column',
                  alignItems: 'stretch',
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', mb: 1 }}>
                  <Chip label={total.funcion.toUpperCase()} size="small" color="primary" />
                  <IconButton size="small" onClick={() => handleRemoveTotal(index)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>

                <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                  <InputLabel>Columna</InputLabel>
                  <Select
                    value={total.path}
                    label="Columna"
                    onChange={e => handleUpdateTotal(index, 'path', e.target.value)}
                  >
                    {columnas.map(col => (
                      <MenuItem key={col.id} value={col.path}>
                        {col.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                  <InputLabel>Función</InputLabel>
                  <Select
                    value={total.funcion}
                    label="Función"
                    onChange={e => handleUpdateTotal(index, 'funcion', e.target.value as any)}
                  >
                    <MenuItem value="sum">Suma</MenuItem>
                    <MenuItem value="avg">Promedio</MenuItem>
                    <MenuItem value="count">Cantidad</MenuItem>
                    <MenuItem value="min">Mínimo</MenuItem>
                    <MenuItem value="max">Máximo</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small">
                  <InputLabel>Label (opcional)</InputLabel>
                  <Select
                    value={total.label || ''}
                    label="Label (opcional)"
                    onChange={e => handleUpdateTotal(index, 'label', e.target.value || undefined)}
                  >
                    <MenuItem value="">
                      <em>(Usar nombre de columna)</em>
                    </MenuItem>
                    {columnas.map(col => (
                      <MenuItem key={col.id} value={col.label}>
                        {col.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  )
}
