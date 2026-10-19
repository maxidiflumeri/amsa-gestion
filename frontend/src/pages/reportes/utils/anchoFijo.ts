import { Columna, OpcionesFormato } from '../../../types/reportes'

/** Lo que entra una columna nueva en un TXT de ancho fijo: 10 caracteres, a la izquierda, con espacios (se ve en el recuadro de opciones). */
export const ANCHO_NUEVA = 10

/**
 * El ancho fijo, la alineación y el relleno van **por posición**: el i-ésimo valor es de la i-ésima columna. Cuando se agrega,
 * se quita o se reordena una columna, los tres arreglos tienen que moverse con ella; si no, quedan corridos y el archivo sale
 * con campos del ancho (o con el relleno) de otra columna, sin ningún aviso.
 *
 * Solo se reacomoda si el arreglo tenía un valor por cada columna de antes (si no, no hay forma de saber de quién es cada uno
 * y la validación avisa). Devuelve las mismas opciones si no hay nada que mover.
 */
export function acompanarColumnas(
  opciones: OpcionesFormato | undefined,
  antes: Columna[],
  despues: Columna[],
): OpcionesFormato | undefined {
  const txt = opciones?.txt
  if (!opciones || !txt?.anchoFijo || txt.anchoFijo.length !== antes.length) return opciones
  const posicion = new Map(antes.map((c, i) => [c.id, i]))
  const mover = <T,>(valores: T[] | undefined, porDefecto: T): T[] | undefined =>
    valores && valores.length === antes.length
      ? despues.map(c => {
          const i = posicion.get(c.id)
          return i === undefined ? porDefecto : valores[i]
        })
      : valores
  return {
    ...opciones,
    txt: {
      ...txt,
      anchoFijo: mover(txt.anchoFijo, ANCHO_NUEVA),
      alineacion: mover(txt.alineacion, 'izquierda' as const),
      relleno: mover(txt.relleno, ' ' as const),
    },
  }
}
