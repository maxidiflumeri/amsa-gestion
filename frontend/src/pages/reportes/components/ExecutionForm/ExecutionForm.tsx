import { useState, useEffect } from 'react'
import {
  Box,
  Button,
  Typography,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { Filtro } from '../../../../types/reportes'
import { useNotify } from '../../../../hooks/useNotify'
import VariableInput from './VariableInput'
import useExecution from './useExecution'

type ExecutionFormProps = {
  plantillaId: number
  filtrosVariables: Filtro[]
}

const ExecutionForm = ({ plantillaId, filtrosVariables }: ExecutionFormProps) => {
  const notify = useNotify()
  const {
    executing,
    error,
    success,
    asyncInfo,
    execute,
    estimar,
    clearSuccess,
  } = useExecution()

  useEffect(() => {
    if (success) {
      notify.success('Reporte generado exitosamente')
      clearSuccess()
    }
  }, [success])
  const [valores, setValores] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {}
    filtrosVariables.forEach((filtro) => {
      if (filtro.valorPorDefecto !== undefined) {
        initial[filtro.id] = filtro.valorPorDefecto
      }
    })
    return initial
  })
  const [confirmAsync, setConfirmAsync] = useState<{
    open: boolean
    total: number
    pendingFiltros: Record<string, any> | null
  }>({ open: false, total: 0, pendingFiltros: null })
  const [estimating, setEstimating] = useState(false)

  const handleChange = (filtroId: string, value: any) => {
    setValores((prev) => ({ ...prev, [filtroId]: value }))
  }

  const isVacio = (v: any): boolean => {
    if (v === undefined || v === null || v === '') return true
    if (Array.isArray(v)) {
      if (v.length === 0) return true
      return v.every(x => x === undefined || x === null || x === '')
    }
    return false
  }

  const buildFiltrosVars = (): Record<string, any> | null => {
    const filtrosVars: Record<string, any> = {}

    for (const filtro of filtrosVariables) {
      const valor = valores[filtro.id]
      const requiresValue =
        filtro.operador !== 'isNull' && filtro.operador !== 'isNotNull'

      if (
        filtro.obligatorio &&
        requiresValue &&
        filtro.valorPorDefecto === undefined &&
        isVacio(valor)
      ) {
        return null
      }

      if (!isVacio(valor)) {
        filtrosVars[filtro.id] = valor
      }
    }

    return filtrosVars
  }

  const handleExecute = async () => {
    const filtrosVars = buildFiltrosVars()
    if (filtrosVars === null) return

    setEstimating(true)
    const est = await estimar(plantillaId, filtrosVars)
    setEstimating(false)

    if (!est) return

    if (est.modoSugerido === 'async') {
      setConfirmAsync({
        open: true,
        total: est.totalEstimado,
        pendingFiltros: filtrosVars,
      })
      return
    }

    await execute(plantillaId, filtrosVars)
  }

  const handleConfirmAsync = async () => {
    const filtros = confirmAsync.pendingFiltros
    setConfirmAsync({ open: false, total: 0, pendingFiltros: null })
    if (filtros) {
      await execute(plantillaId, filtros)
    }
  }

  const canExecute = filtrosVariables.every((filtro) => {
    const requiresValue =
      filtro.operador !== 'isNull' && filtro.operador !== 'isNotNull'
    if (!requiresValue) return true
    if (!filtro.obligatorio) return true
    if (filtro.valorPorDefecto !== undefined) return true

    return !isVacio(valores[filtro.id])
  })

  const busy = executing || estimating

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {filtrosVariables.length === 0 ? (
        <Alert severity="info">
          Esta plantilla no requiere parámetros. Hacé click en "Ejecutar" para
          generar el reporte.
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="h6" gutterBottom>
            Parámetros del reporte
          </Typography>
          {filtrosVariables.map((filtro) => (
            <VariableInput
              key={filtro.id}
              filtro={filtro}
              value={valores[filtro.id]}
              onChange={(val) => handleChange(filtro.id, val)}
            />
          ))}
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {asyncInfo && (
        <Alert severity="info">
          Ejecución encolada (#{asyncInfo.ejecucionId}). Te avisaremos cuando
          esté lista. Redirigiendo a Mis ejecuciones...
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          size="large"
          startIcon={busy ? <CircularProgress size={20} /> : <PlayArrowIcon />}
          onClick={handleExecute}
          disabled={busy || !canExecute}
        >
          {executing
            ? 'Ejecutando...'
            : estimating
              ? 'Estimando...'
              : 'Ejecutar'}
        </Button>
      </Box>

      <Dialog
        open={confirmAsync.open}
        onClose={() =>
          setConfirmAsync({ open: false, total: 0, pendingFiltros: null })
        }
      >
        <DialogTitle>Procesamiento en segundo plano</DialogTitle>
        <DialogContent>
          <DialogContentText>
            El reporte tiene aproximadamente <b>{confirmAsync.total}</b> filas y
            se procesará en segundo plano. Te avisaremos cuando esté listo y
            podrás descargarlo desde "Mis ejecuciones".
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() =>
              setConfirmAsync({ open: false, total: 0, pendingFiltros: null })
            }
          >
            Cancelar
          </Button>
          <Button variant="contained" onClick={handleConfirmAsync}>
            Encolar
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  )
}

export default ExecutionForm
