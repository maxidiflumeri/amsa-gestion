import { TextField, Autocomplete, MenuItem, Stack, FormControlLabel, Switch, Box, Button, Typography } from '@mui/material'
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

type OpcionSoloLectura = { clave: string; texto: string; campos: string[] }

/**
 * Opciones del formato que este editor no ofrece cambiar pero que la plantilla tiene (las arma el asistente o vienen de antes).
 * Se conservan al guardar; sin este recuadro serían configuración invisible (docs/asistente-reportes-spec.md §16.4).
 * Cada una se puede quitar: vuelve al comportamiento de siempre del formato.
 */
function opcionesSoloLectura(formato: string, o: Record<string, any>): OpcionSoloLectura[] {
  const lista: OpcionSoloLectura[] = []
  if (formato === 'txt' && Array.isArray(o.anchoFijo) && o.anchoFijo.length > 0) {
    const anchos: number[] = o.anchoFijo
    const aDerecha = Array.isArray(o.alineacion) ? o.alineacion.filter((a: string) => a === 'derecha').length : 0
    const conCeros = Array.isArray(o.relleno) ? o.relleno.filter((r: string) => r === '0').length : 0
    const detalle = [
      `anchos ${anchos.join(', ')}`,
      aDerecha > 0 ? `${aDerecha} alineada${aDerecha === 1 ? '' : 's'} a la derecha` : null,
      conCeros > 0 ? `${conCeros} rellena${conCeros === 1 ? '' : 's'} con ceros` : null,
    ].filter(Boolean).join(' · ')
    lista.push({ clave: 'anchoFijo', texto: `Ancho fijo: ${anchos.length} ${anchos.length === 1 ? 'columna' : 'columnas'} (${detalle})`, campos: ['anchoFijo', 'alineacion', 'relleno'] })
  }
  if (o.encoding === 'latin1') lista.push({ clave: 'encoding', texto: 'Codificación latin1', campos: ['encoding'] })
  if (o.bom === false) lista.push({ clave: 'bom', texto: 'Sin BOM', campos: ['bom'] })
  if ((formato === 'txt' || formato === 'csv') && o.lineEnding === '\n') lista.push({ clave: 'lineEnding', texto: 'Fin de línea \\n', campos: ['lineEnding'] })
  return lista
}

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

  const soloLectura = opcionesSoloLectura(formato, opcionesDelFormato)
  const quitarOpcion = (campos: string[]) => {
    const resto = { ...opcionesDelFormato }
    campos.forEach(c => delete resto[c])
    onPlantillaChange('opcionesFormato', { ...opciones, [formato]: resto })
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

      {soloLectura.length > 0 && (
        <Box
          role="group"
          aria-label="Opciones que no se editan acá"
          data-testid="opciones-solo-lectura"
          sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 1.5, minWidth: 0 }}
        >
          <Typography variant="subtitle2">Opciones que no se editan acá</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Se guardan con la plantilla tal cual. Quitar una vuelve al comportamiento de siempre del formato.
          </Typography>
          <Stack spacing={0.5}>
            {soloLectura.map(op => (
              <Stack key={op.clave} direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{op.texto}</Typography>
                <Button size="small" color="inherit" onClick={() => quitarOpcion(op.campos)} aria-label={`Quitar: ${op.texto}`} sx={{ flex: 'none' }}>
                  Quitar
                </Button>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}

export default BuilderHeader
