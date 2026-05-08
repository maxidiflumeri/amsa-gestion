import { TextField, Autocomplete, MenuItem, Stack, Button, Paper, Box } from '@mui/material'
import { PlantillaV2 } from '../../../../../types/reportes-v2'

type BuilderHeaderProps = {
  plantilla: Partial<PlantillaV2>
  empresas: { id: number; nombre: string }[]
  onPlantillaChange: (field: keyof PlantillaV2, value: any) => void
  onSave: () => void
  onCancel: () => void
  loading: boolean
  disabled?: boolean
}

const BuilderHeader = ({ plantilla, empresas, onPlantillaChange, onSave, onCancel, loading, disabled = false }: BuilderHeaderProps) => {
  const empresaSeleccionada = empresas.find(e => e.id === plantilla.empresaId) || null

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
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

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <TextField
            select
            label="Formato de salida"
            required
            sx={{ minWidth: 200 }}
            value={plantilla.formatoSalida || 'xlsx'}
            onChange={e => onPlantillaChange('formatoSalida', e.target.value)}
          >
            <MenuItem value="xlsx">Excel (XLSX)</MenuItem>
            <MenuItem value="csv">CSV</MenuItem>
            <MenuItem value="txt">Texto plano (TXT)</MenuItem>
            <MenuItem value="pdf">PDF</MenuItem>
          </TextField>

          <Box sx={{ flexGrow: 1 }} />

          <Stack direction="row" spacing={2}>
            <Button variant="outlined" onClick={onCancel} disabled={loading}>
              Cancelar
            </Button>
            <Button variant="contained" onClick={onSave} disabled={loading || disabled}>
              {loading ? 'Guardando...' : 'Guardar plantilla'}
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Paper>
  )
}

export default BuilderHeader
