import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import { Columna, Ordenamiento } from '../../../../types/reportes'

/**
 * Orden de las filas del reporte.
 *
 * El motor lo soporta desde siempre (`definicion.ordenamientos`) y el armador no lo exponía: la
 * plantilla se guardaba con la lista vacía y el reporte salía en el orden que devolviera la base.
 *
 * El orden de la lista importa: se ordena por el primer criterio y los siguientes desempatan.
 */
interface SortBuilderProps {
  ordenamientos: Ordenamiento[]
  columnas: Columna[]
  onChange: (ordenamientos: Ordenamiento[]) => void
}

export default function SortBuilder({ ordenamientos, columnas, onChange }: SortBuilderProps) {
  const usados = new Set(ordenamientos.map((o) => o.path))
  const disponibles = columnas.filter((c) => !usados.has(c.path))

  const agregar = () => {
    if (disponibles.length === 0) return
    onChange([...ordenamientos, { path: disponibles[0].path, direccion: 'asc' }])
  }

  const actualizar = (i: number, patch: Partial<Ordenamiento>) => {
    onChange(ordenamientos.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  }

  const quitar = (i: number) => onChange(ordenamientos.filter((_, idx) => idx !== i))

  const mover = (i: number, delta: number) => {
    const destino = i + delta
    if (destino < 0 || destino >= ordenamientos.length) return
    const copia = [...ordenamientos]
    ;[copia[i], copia[destino]] = [copia[destino], copia[i]]
    onChange(copia)
  }

  const etiqueta = (path: string) => columnas.find((c) => c.path === path)?.label || path

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          Orden de las filas
        </Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={agregar}
          disabled={disponibles.length === 0}
        >
          Agregar
        </Button>
      </Stack>

      {columnas.length === 0 ? (
        <Alert severity="info">Agregá columnas antes de definir el orden.</Alert>
      ) : ordenamientos.length === 0 ? (
        <Alert severity="info">
          Sin orden definido, las filas salen como las devuelve la base. Agregá un criterio para que el
          reporte salga siempre igual.
        </Alert>
      ) : (
        <>
          <List dense>
            {ordenamientos.map((o, i) => (
              <ListItem key={o.path} disableGutters sx={{ gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ width: 20 }}>
                  {i + 1}º
                </Typography>

                <FormControl size="small" sx={{ minWidth: 200, flexGrow: 1 }}>
                  <InputLabel>Columna</InputLabel>
                  <Select
                    label="Columna"
                    value={o.path}
                    onChange={(e) => actualizar(i, { path: e.target.value })}
                  >
                    {/* La propia más las que no estén ya usadas: ordenar dos veces por lo mismo no hace nada. */}
                    {columnas
                      .filter((c) => c.path === o.path || !usados.has(c.path))
                      .map((c) => (
                        <MenuItem key={c.path} value={c.path}>
                          {c.label || c.path}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Dirección</InputLabel>
                  <Select
                    label="Dirección"
                    value={o.direccion}
                    onChange={(e) => actualizar(i, { direccion: e.target.value as 'asc' | 'desc' })}
                  >
                    <MenuItem value="asc">Ascendente (A→Z, menor a mayor)</MenuItem>
                    <MenuItem value="desc">Descendente (Z→A, mayor a menor)</MenuItem>
                  </Select>
                </FormControl>

                <IconButton size="small" onClick={() => mover(i, -1)} disabled={i === 0} title="Subir">
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => mover(i, 1)}
                  disabled={i === ordenamientos.length - 1}
                  title="Bajar"
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => quitar(i)} title="Quitar">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </ListItem>
            ))}
          </List>

          {ordenamientos.length > 1 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Se ordena por <strong>{etiqueta(ordenamientos[0].path)}</strong>; los siguientes
                desempatan.
              </Typography>
            </Box>
          )}
        </>
      )}
    </Paper>
  )
}
