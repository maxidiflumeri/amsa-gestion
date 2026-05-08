import { useState } from 'react'
import axios from 'axios'
import api from '../../../../../api/axios'

type UseExecutionReturn = {
  executing: boolean
  error: string | null
  success: boolean
  execute: (plantillaId: number, filtrosVars: Record<string, any>) => Promise<void>
  clearSuccess: () => void
}

const useExecution = (): UseExecutionReturn => {
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const execute = async (plantillaId: number, filtrosVars: Record<string, any>) => {
    setExecuting(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await api.post(
        `/reportes/v2/plantillas/${plantillaId}/ejecutar`,
        { filtrosVars },
        { responseType: 'blob' }
      )

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

  return { executing, error, success, execute, clearSuccess }
}

export default useExecution
