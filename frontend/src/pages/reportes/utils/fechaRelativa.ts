// Fechas relativas a hoy en los filtros (docs/asistente-reportes-spec.md §11.1, E1): "hoy", "hoy-90", "hoy+7".
// Se guardan como texto; el motor las resuelve al ejecutar, en hora de Argentina, así que el filtro no se vence con los días.

const PATRON = /^hoy([+-]\d{1,4})?$/

/** Los días de corrimiento (negativo = antes de hoy), o null si no es una fecha relativa. */
export function parseFechaRelativa(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = PATRON.exec(v.trim())
  if (!m) return null
  return m[1] ? parseInt(m[1], 10) : 0
}

export const esFechaRelativa = (v: unknown): boolean => parseFechaRelativa(v) !== null

/** El texto guardado para un corrimiento: 0 → "hoy", -90 → "hoy-90", 7 → "hoy+7". */
export function armarFechaRelativa(dias: number): string {
  if (!Number.isFinite(dias) || dias === 0) return 'hoy'
  const n = Math.min(3650, Math.abs(Math.trunc(dias)))
  return n === 0 ? 'hoy' : `hoy${dias < 0 ? '-' : '+'}${n}`
}

/** "hoy", "hace 90 días", "hace 1 día", "dentro de 7 días". Un valor que no es relativo se devuelve igual. */
export function describirFechaRelativa(v: unknown): string {
  const dias = parseFechaRelativa(v)
  if (dias === null) return String(v ?? '')
  if (dias === 0) return 'hoy'
  const n = Math.abs(dias)
  const unidad = n === 1 ? 'día' : 'días'
  return dias < 0 ? `hace ${n} ${unidad}` : `dentro de ${n} ${unidad}`
}

/** La fecha que corresponde hoy a ese valor, como DD/MM/YYYY (la del navegador: quien arma reportes está en Argentina). */
export function resolverFechaRelativa(v: unknown, hoy: Date = new Date()): string | null {
  const dias = parseFechaRelativa(v)
  if (dias === null) return null
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + dias)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
