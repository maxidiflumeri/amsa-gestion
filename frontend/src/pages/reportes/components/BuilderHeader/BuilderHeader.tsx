import { TextField, Autocomplete, MenuItem, Stack, FormControlLabel, Switch } from '@mui/material'
import { OpcionesFormato } from '../../../../types/reportes'
import { Plantilla } from '../../../../types/reportes'

type BuilderHeaderProps = {
  plantilla: Partial<Plantilla>
  empresas: { id: number; nombre: string }[]
  onPlantillaChange: (field: keyof Plantilla, value: any) => void
}

/**
 * Separadores de uso corriente. El valor guardado es el carácter real, así que agregar uno nuevo
 * acá alcanza — el exportador no tiene una lista cerrada.
 */
const SEPARADORES = [
  { value: '\t', label: 'Tabulación (TAB)' },
  { value: ';', label: 'Punto y coma  ;' },
  { value: ',', label: 'Coma  ,' },
  { value: '|', label: 'Pipe  |' },
  { value: ' ', label: 'Espacio' },
]

const SEPARADOR_DEFAULT: Record<string, string> = { txt: '\t', csv: ',' }

const BuilderHeader = ({ plantilla, empresas, onPlantillaChange }: BuilderHeaderProps) => {
  const empresaSeleccionada = empresas.find(e => e.id === plantilla.empresaId) || null

  const formato = plantilla.formatoSalida || 'xlsx'
  const separable = formato === 'txt' || formato === 'csv'
  const opciones = (plantilla.opcionesFormato || {}) as OpcionesFormato
  const opcionesDelFormato = (opciones as any)[formato] || {}
  const separador = opcionesDelFormato.separador ?? SEPARADOR_DEFAULT[formato]
  const incluirHeader = opcionesDelFormato.incluirHeader !== false
  // Un separador que no está en la lista igual se respeta: se muestra en el campo "otro".
  const esConocido = SEPARADORES.some(s => s.value === separador)

  // Las opciones se guardan por formato para que cambiar de TXT a CSV y volver no borre lo que
  // había configurado en el otro.
  const cambiarOpcion = (campo: string, valor: any) => {
    onPlantillaChange('opcionesFormato', {
      ...opciones,
      [formato]: { ...opcionesDelFormato, [campo]: valor },
    })
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
          label="Nombre de la plantilla"
          required
          fullWidth
          value={plantilla.nombre || ''}
          onChange={e => onPlantillaChange('nombre', e.target.value)}
          placeholder="Ej: Cartera por empresa"
        />
        <Autocomplete
          fullWidth
          options={empresas}
          getOptionLabel={option => option.nombre}
          value={empresaSeleccionada}
          onChange={(_, value) => onPlantillaChange('empresaId', value?.id || null)}
          renderInput={params => <TextField {...params} label="Empresa" placeholder="Todas" />}
        />
      </Stack>

      <TextField
        label="Descripción"
        multiline
        rows={2}
        fullWidth
        value={plantilla.descripcion || ''}
        onChange={e => onPlantillaChange('descripcion', e.target.value)}
        placeholder="Descripción opcional de la plantilla"
      />

      <TextField
        select
        label="Formato de salida"
        required
        sx={{ maxWidth: 220 }}
        value={plantilla.formatoSalida || 'xlsx'}
        onChange={e => onPlantillaChange('formatoSalida', e.target.value)}
      >
        <MenuItem value="xlsx">Excel (XLSX)</MenuItem>
        <MenuItem value="csv">CSV</MenuItem>
        <MenuItem value="txt">Texto plano (TXT)</MenuItem>
        <MenuItem value="pdf">PDF</MenuItem>
      </TextField>

      {separable && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <TextField
            select
            label="Separador de columnas"
            sx={{ maxWidth: 220 }}
            value={esConocido ? separador : 'otro'}
            onChange={e =>
              cambiarOpcion('separador', e.target.value === 'otro' ? '' : e.target.value)
            }
          >
            {SEPARADORES.map(s => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
            <MenuItem value="otro">Otro…</MenuItem>
          </TextField>

          {!esConocido && (
            <TextField
              label="Separador"
              sx={{ maxWidth: 140 }}
              value={separador ?? ''}
              onChange={e => cambiarOpcion('separador', e.target.value)}
              helperText="El carácter tal cual"
            />
          )}

          <FormControlLabel
            control={
              <Switch
                checked={incluirHeader}
                onChange={e => cambiarOpcion('incluirHeader', e.target.checked)}
              />
            }
            label="Incluir fila de encabezado"
          />
        </Stack>
      )}
    </Stack>
  )
}

export default BuilderHeader
