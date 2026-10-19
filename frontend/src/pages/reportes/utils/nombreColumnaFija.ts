/**
 * El primer `columnaN` que no usa ninguna columna. Contar las fijas y sumar uno repetía un nombre si
 * se borraba una del medio (`columna1`, `columna3` → `columna3` otra vez), y dos columnas con el mismo
 * nombre no se pueden guardar.
 */
export function nombreColumnaFijaLibre(labelsUsados: string[]): string {
  const usados = new Set(labelsUsados)
  let n = 1
  while (usados.has(`columna${n}`)) n++
  return `columna${n}`
}
