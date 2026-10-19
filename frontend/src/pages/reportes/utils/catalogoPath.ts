import { NodoCatalogo } from '../../../types/reportes'

/** Un path sin sus modificadores: `contactos[tipo=telefono][1].valor` → `contactos.valor`. */
export const sinModificadores = (path: string): string => path.replace(/\[[^\]]*\]/g, '')

/** El path lleva una expresión (`[1]`, `[tipo=telefono]`, `[count]`) que el explorador de campos no ofrece: la arma el asistente o se escribió a mano. */
export const tieneModificadores = (path: string): boolean => /\[[^\]]*\]/.test(path)

/** Busca en el catálogo el nodo de un path, ignorando los modificadores. Null si el catálogo todavía no cargó o el campo no está. */
export function buscarNodoPorPath(catalogo: NodoCatalogo[], path: string): NodoCatalogo | null {
  const buscado = sinModificadores(path)
  const recorrer = (nodos: NodoCatalogo[]): NodoCatalogo | null => {
    for (const n of nodos) {
      if (sinModificadores(n.path) === buscado) return n
      if (n.hijos) {
        const hallado = recorrer(n.hijos)
        if (hallado) return hallado
      }
    }
    return null
  }
  return recorrer(catalogo)
}
