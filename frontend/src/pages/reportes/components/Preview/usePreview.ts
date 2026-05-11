import { useState, useEffect, useRef } from 'react'
import { Definicion } from '../../../../types/reportes'
import { reportesApi } from '../../../../api/reportes'

type PreviewResult = {
  columnas: any[]
  filas: any[]
  total: number
}

type UsePreviewReturn = {
  data: PreviewResult | null
  loading: boolean
  error: string | null
  refresh: () => void
}

const usePreview = (definicion: Definicion, debounceMs = 600): UsePreviewReturn => {
  const [data, setData] = useState<PreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const definicionRef = useRef<string>('')

  const fetchPreview = async () => {
    if (definicion.columnas.length === 0) {
      setData(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const filtrosVars: Record<string, any> = {}

      definicion.filtros?.forEach(filtro => {
        if (filtro.variable && filtro.valorPorDefecto !== undefined) {
          filtrosVars[filtro.id] = filtro.valorPorDefecto
        }
      })

      const res = await reportesApi.preview({
        definicion,
        filtrosVars,
        raiz: 'deudor',
      })

      setData(res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al cargar el preview')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const refresh = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    fetchPreview()
  }

  useEffect(() => {
    const newDefinicionStr = JSON.stringify(definicion)

    if (newDefinicionStr === definicionRef.current) return

    definicionRef.current = newDefinicionStr

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      fetchPreview()
    }, debounceMs)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [definicion])

  return { data, loading, error, refresh }
}

export default usePreview
