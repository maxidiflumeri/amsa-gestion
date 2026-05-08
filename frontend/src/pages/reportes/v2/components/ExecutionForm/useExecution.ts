import { useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import api from '../../../../../api/axios'
import { reportesV2Api, EstimacionV2 } from '../../../../../api/reportes-v2'

type UseExecutionReturn = {
  executing: boolean
  error: string | null
  success: boolean
  asyncInfo: { ejecucionId: number } | null
  estimacion: EstimacionV2 | null
  estimar: (plantillaId: number, filtrosVars: Record<string, any>) => Promise<EstimacionV2 | null>
  execute: (plantillaId: number, filtrosVars: Record<string, any>) => Promise<void>
  clearSuccess: () => void
  clearAsyncInfo: () => void
}

const useExecution = (): UseExecutionReturn => {
  const navigate = useNavigate()
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [asyncInfo, setAsyncInfo] = useState<{ ejecucionId: number } | null>(null)
  const [estimacion, setEstimacion] = useState<EstimacionV2 | null>(null)

  const estimar = async (
    plantillaId: number,
    filtrosVars: Record<string, any>,
  ): Promise<EstimacionV2 | null> => {
    try {
      const res = await reportesV2Api.estimar(plantillaId, filtrosVars)
      setEstimacion(res.data)
      return res.data
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo estimar el reporte')
      return null
    }
  }

  const execute = async (plantillaId: number, filtrosVars: Record<string, any>) => {
    setExecuting(true)
    setError(null)
    setSuccess(false)
    setAsyncInfo(null)

    try {
      const response = await api.post(
        `/reportes/v2/plantillas/${plantillaId}/ejecutar`,
        { filtrosVars },
        { responseType: 'blob' },
      )

      if (response.status === 202) {
        const data = response.data instanceof Blob ? await response.data.text() : response.data
        let parsed: any = data
        try {
          parsed = typeof data === 'string' ? JSON.parse(data) : data
        } catch {
          parsed = { ejecucionId: 0 }
        }
        setAsyncInfo({ ejecucionId: parsed.ejecucionId })
        setExecuting(false)
        setTimeout(() => navigate('/reportes/v2/ejecuciones'), 800)
        return
      }

      const contentDisposition = response.headers['content-disposition']
      let filename = `reporte_${Date.now()}.xlsx`

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i)
        if (filenameMatch) {
          filename = filenameMatch[1].replace(/"/g, '')
        }
      }

      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      setSuccess(true)
      setExecuting(false)
    } catch (err: any) {
      setExecuting(false)
      setSuccess(false)
      if (axios.isAxiosError(err) && err.response?.data) {
        if (err.response.data instanceof Blob) {
          const text = await err.response.data.text()
          try {
            const json = JSON.parse(text)
            setError(json.message || 'Error al ejecutar el reporte')
          } catch {
            setError('Error al ejecutar el reporte')
          }
        } else {
          setError(err.response.data.message || 'Error al ejecutar el reporte')
        }
      } else {
        setError('Error al ejecutar el reporte')
      }
    }
  }

  const clearSuccess = () => setSuccess(false)
  const clearAsyncInfo = () => setAsyncInfo(null)

  return {
    executing,
    error,
    success,
    asyncInfo,
    estimacion,
    estimar,
    execute,
    clearSuccess,
    clearAsyncInfo,
  }
}

export default useExecution
