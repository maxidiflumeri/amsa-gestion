import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

export type ProgresoPayload = {
  ejecucionId: number
  progreso: number
  filasProcesadas: number
  totalFilas?: number | null
  fase: string
}

export type CompletadoPayload = {
  ejecucionId: number
  archivoTamano: number | null
  totalFilas: number | null
  duracionMs: number
}

export type FallidoPayload = {
  ejecucionId: number
  error: string
}

type Handlers = {
  onProgreso?: (p: ProgresoPayload) => void
  onCompletado?: (p: CompletadoPayload) => void
  onFallido?: (p: FallidoPayload) => void
}

function getSocketBaseUrl(): string {
  const apiUrl =
    (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001/api'
  return apiUrl.replace(/\/api\/?$/, '')
}

function getUsuarioId(): number | null {
  try {
    const raw = localStorage.getItem('usuario')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.id) return parsed.id
  } catch {
    /* ignore */
  }
  return null
}

export function useReportesV2Socket(handlers: Handlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const usuarioId = getUsuarioId()
    if (!usuarioId) return

    const socket: Socket = io(`${getSocketBaseUrl()}/reportes-v2`, {
      transports: ['websocket', 'polling'],
      auth: { usuarioId },
      query: { usuarioId },
    })

    socket.on('ejecucion:progreso', (p: ProgresoPayload) => {
      handlersRef.current.onProgreso?.(p)
    })
    socket.on('ejecucion:completado', (p: CompletadoPayload) => {
      handlersRef.current.onCompletado?.(p)
    })
    socket.on('ejecucion:fallido', (p: FallidoPayload) => {
      handlersRef.current.onFallido?.(p)
    })

    return () => {
      socket.disconnect()
    }
  }, [])
}
