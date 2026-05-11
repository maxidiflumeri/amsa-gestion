import { TextField, Autocomplete, MenuItem, Stack } from '@mui/material'
import { Plantilla } from '../../../../types/reportes'

type BuilderHeaderProps = {
  plantilla: Partial<Plantilla>
  empresas: { id: number; nombre: string }[]
  onPlantillaChange: (field: keyof Plantilla, value: any) => void
}

const BuilderHeader = ({ plantilla, empresas, onPlantillaChange }: BuilderHeaderProps) => {
  const empresaSeleccionada = empresas.find(e => e.id === plantilla.empresaId) || null

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
    </Stack>
  )
}

export default BuilderHeader
