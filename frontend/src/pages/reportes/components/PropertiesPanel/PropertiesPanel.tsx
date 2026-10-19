import { useEffect, useState } from 'react'
import { Box, Paper, Typography, TextField, MenuItem, Stack, Alert } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import { Columna, FormatoTelefono, NodoCatalogo } from '../../../../types/reportes'
import { reportesApi } from '../../../../api/reportes'
import { EmptyState } from '../../../../components/ui'
import CardinalitySelector from './CardinalitySelector'
import { buscarNodoPorPath, tieneModificadores } from '../../utils/catalogoPath'

type PropertiesPanelProps = {
  columna: Columna | null
  onColumnChange: (field: keyof Columna, value: any) => void
  /** Para saber si el campo de la columna es una fecha (la única que admite «Días desde la fecha»). */
  catalogo?: NodoCatalogo[]
}

// "Predeterminado" no es un valor: la columna no trae la propiedad y el motor usa su formato de siempre.
const POR_DEFECTO = '__defecto'
const SIN_SEPARADOR = '__ninguno'

const PropertiesPanel = ({ columna, onColumnChange, catalogo = [] }: PropertiesPanelProps) => {
  const [formatosTelefono, setFormatosTelefono] = useState<FormatoTelefono[]>([])

  useEffect(() => {
    if (columna?.tipo === 'telefono' && formatosTelefono.length === 0) {
      reportesApi
        .formatosTelefono()
        .then(res => setFormatosTelefono(res.data.filter(f => f.activo !== false)))
        .catch(() => setFormatosTelefono([]))
    }
  }, [columna?.tipo])

  if (!columna) {
    return (
      <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <EmptyState
          icon={<SettingsIcon />}
          title="Seleccioná una columna"
          description="Hacé click en una columna del canvas para editar sus propiedades"
        />
      </Paper>
    )
  }

  const showFormatoField = columna.tipo === 'fecha' || columna.tipo === 'numero' || columna.tipo === 'moneda'
  // Los decimales y separadores son del tipo Número (E3); «Moneda» no los toma.
  const esNumerica = columna.tipo === 'numero'
  // «Días desde la fecha» solo tiene sentido sobre una fecha. Una columna que ya es de ese tipo la conserva aunque el catálogo no cargue.
  const esFecha =
    columna.tipo === 'fecha' ||
    columna.tipo === 'dias' ||
    buscarNodoPorPath(catalogo, columna.path)?.tipoEscalar === 'fecha'
  const conExpresion = tieneModificadores(columna.path)
  const showCardinalityField = true
  // Sin path la columna no sale de los datos: no hay tipo, formato ni cardinalidad que configurar.
  const esFija = !columna.path

  const etiqueta = (
    <TextField
      label="Etiqueta"
      fullWidth
      required
      value={columna.label}
      onChange={e => onColumnChange('label', e.target.value)}
      helperText="Nombre que aparecerá en el reporte"
    />
  )

  if (esFija) {
    return (
      <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Typography variant="h6" gutterBottom>
          Propiedades de columna
        </Typography>

        <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
          <Stack spacing={2}>
            {etiqueta}

            <TextField
              label="Valor fijo"
              fullWidth
              value={columna.valorFijo || ''}
              onChange={e => onColumnChange('valorFijo', e.target.value)}
              helperText="El mismo texto en todas las filas. Dejalo vacío para una columna vacía."
            />

            <Typography variant="caption" color="text.secondary">
              Esta columna no sale de los datos. Sirve para respetar la estructura que espera el
              sistema destino cuando no hay dato para todas las columnas.
            </Typography>
          </Stack>
        </Box>
      </Paper>
    )
  }

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" gutterBottom>
        Propiedades de columna
      </Typography>

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        <Stack spacing={2}>
          {etiqueta}

          <TextField
            label="Path"
            fullWidth
            disabled
            value={columna.path}
            helperText="Ruta técnica del campo"
            size="small"
          />

          {conExpresion && (
            <Alert severity="info" data-testid="ayuda-expresion">
              Este campo lo armó el asistente con una expresión que el explorador no ofrece (por ejemplo, el 2.º teléfono).
              Podés renombrarlo o borrarlo; para cambiarle el campo, borrala y agregá otra.
            </Alert>
          )}

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
            <MenuItem value="telefono">Teléfono</MenuItem>
            <MenuItem value="dias" disabled={!esFecha}>Días desde la fecha</MenuItem>
          </TextField>

          {columna.tipo === 'dias' && (
            <Typography variant="caption" color="text.secondary">
              Muestra cuántos días pasaron entre la fecha y hoy. Si la fecha es futura, el número es negativo.
            </Typography>
          )}
          {!esFecha && (
            <Typography variant="caption" color="text.secondary">
              «Días desde la fecha» se habilita solo con campos de fecha.
            </Typography>
          )}

          {columna.tipo === 'telefono' && (
            <TextField
              select
              label="Formato de teléfono"
              fullWidth
              value={columna.formatoTelefonoId ?? ''}
              onChange={e =>
                onColumnChange(
                  'formatoTelefonoId',
                  e.target.value === '' ? undefined : Number(e.target.value),
                )
              }
              helperText={
                formatosTelefono.length === 0
                  ? 'No hay formatos cargados.'
                  : 'Placeholders: {numero} (área + abonado) · {area} · {abonado} · {15} (solo si es celular)'
              }
            >
              <MenuItem value="">
                <em>Sin formato (crudo)</em>
              </MenuItem>
              {formatosTelefono.map(f => (
                <MenuItem key={f.id} value={f.id}>
                  {f.nombre} — <code style={{ marginLeft: 4 }}>{f.patron}</code>
                </MenuItem>
              ))}
            </TextField>
          )}

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

          {esNumerica && (
            <>
              <TextField
                label="Decimales"
                type="number"
                fullWidth
                value={columna.decimales ?? ''}
                onChange={e =>
                  onColumnChange('decimales', e.target.value === '' ? undefined : Math.min(4, Math.max(0, parseInt(e.target.value, 10) || 0)))
                }
                inputProps={{ min: 0, max: 4 }}
                helperText="De 0 a 4. Vacío: el número sale como está guardado o con el formato de siempre."
              />
              <TextField
                select
                label="Separador decimal"
                fullWidth
                value={columna.separadorDecimal ?? POR_DEFECTO}
                onChange={e => onColumnChange('separadorDecimal', e.target.value === POR_DEFECTO ? undefined : e.target.value)}
              >
                <MenuItem value={POR_DEFECTO}>Predeterminado</MenuItem>
                <MenuItem value=",">Coma  ,</MenuItem>
                <MenuItem value=".">Punto  .</MenuItem>
              </TextField>
              <TextField
                select
                label="Separador de miles"
                fullWidth
                value={columna.separadorMiles === undefined ? POR_DEFECTO : columna.separadorMiles === '' ? SIN_SEPARADOR : columna.separadorMiles}
                onChange={e =>
                  onColumnChange('separadorMiles', e.target.value === POR_DEFECTO ? undefined : e.target.value === SIN_SEPARADOR ? '' : e.target.value)
                }
              >
                <MenuItem value={POR_DEFECTO}>Predeterminado</MenuItem>
                <MenuItem value=".">Punto  .</MenuItem>
                <MenuItem value=",">Coma  ,</MenuItem>
                <MenuItem value={SIN_SEPARADOR}>Sin separador</MenuItem>
              </TextField>
            </>
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
