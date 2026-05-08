import { useState } from 'react'
import { Box, Button, Typography, CircularProgress, Alert, Snackbar } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { FiltroV2 } from '../../../../../types/reportes-v2'
import VariableInput from './VariableInput'
import useExecution from './useExecution'

type ExecutionFormProps = {
  plantillaId: number
  filtrosVariables: FiltroV2[]
}

const ExecutionForm = ({ plantillaId, filtrosVariables }: ExecutionFormProps) => {
  const { executing, error, success, execute, clearSuccess } = useExecution()
  const [valores, setValores] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {}
    filtrosVariables.forEach(filtro => {
      if (filtro.valorPorDefecto !== undefined) {
        initial[filtro.id] = filtro.valorPorDefecto
      }
    })
    return initial
  })

  const handleChange = (filtroId: string, value: any) => {
    setValores(prev => ({ ...prev, [filtroId]: value }))
  }

  const handleExecute = async () => {
    const filtrosVars: Record<string, any> = {}

    for (const filtro of filtrosVariables) {
      const valor = valores[filtro.id]
      const requiresValue = filtro.operador !== 'isNull' && filtro.operador !== 'isNotNull'

      if (requiresValue && filtro.valorPorDefecto === undefined) {
        if (valor === undefined || valor === '' || (Array.isArray(valor) && valor.length === 0)) {
          return
        }
      }

      filtrosVars[filtro.id] = valor
    }

    await execute(plantillaId, filtrosVars)
  }

  const canExecute = filtrosVariables.every(filtro => {
    const requiresValue = filtro.operador !== 'isNull' && filtro.operador !== 'isNotNull'
    if (!requiresValue) return true
    if (filtro.valorPorDefecto !== undefined) return true

    const valor = valores[filtro.id]
    return valor !== undefined && valor !== '' && (!Array.isArray(valor) || valor.length > 0)
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {filtrosVariables.length === 0 ? (
        <Alert severity="info">
          Esta plantilla no requiere parámetros. Hacé click en "Ejecutar" para generar el reporte.
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="h6" gutterBottom>
            Parámetros del reporte
          </Typography>
          {filtrosVariables.map(filtro => (
            <VariableInput
              key={filtro.id}
              filtro={filtro}
              value={valores[filtro.id]}
              onChange={val => handleChange(filtro.id, val)}
            />
          ))}
        </Box>
      )}

      {error && (
        <Alert severity="error">{error}</Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          size="large"
          startIcon={executing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
          onClick={handleExecute}
          disabled={executing || !canExecute}
        >
          {executing ? 'Ejecutando...' : 'Ejecutar'}
        </Button>
      </Box>

      <Snackbar
        open={success}
        autoHideDuration={3000}
        onClose={clearSuccess}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={clearSuccess}>
          Reporte generado exitosamente
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default ExecutionForm
