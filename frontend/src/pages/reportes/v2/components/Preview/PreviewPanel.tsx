import { Box, Button, Typography, Paper, CircularProgress, Alert, Chip } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { DefinicionV2 } from '../../../../../types/reportes-v2'
import usePreview from './usePreview'
import PreviewTable from './PreviewTable'

type PreviewPanelProps = {
  definicion: DefinicionV2
}

const PreviewPanel = ({ definicion }: PreviewPanelProps) => {
  const { data, loading, error, refresh } = usePreview(definicion, 600)

  const hasVariableSinDefault = definicion.filtros?.some(
    f => f.variable && f.valorPorDefecto === undefined
  )

  if (definicion.columnas.length === 0) {
    return (
      <Paper sx={{ p: 6, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          Agregá columnas para ver el preview
        </Typography>
      </Paper>
    )
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Preview</Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={refresh}
          disabled={loading}
          size="small"
        >
          Refrescar
        </Button>
      </Box>

      {hasVariableSinDefault && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Algunos filtros son variables sin valor por defecto. El preview se calcula sin esos filtros.
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!loading && data && (
        <>
          <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
            <Chip
              label={`Mostrando ${data.filas.length} de ${data.total} filas`}
              size="small"
              color="primary"
              variant="outlined"
            />
          </Box>
          <PreviewTable columnas={data.columnas} filas={data.filas} />
        </>
      )}
    </Paper>
  )
}

export default PreviewPanel
