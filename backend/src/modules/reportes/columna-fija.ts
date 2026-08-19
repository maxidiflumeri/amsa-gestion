/**
 * Una columna **fija** es la que no sale de los datos: no tiene `path`, y en todas las filas
 * imprime el mismo `valorFijo` —vacío si no se declara ninguno—.
 *
 * Existe porque los archivos que consumen otros sistemas tienen una estructura de columnas cerrada
 * y hay que respetarla aunque no haya dato para todas. La base predictiva de Neotel, por ejemplo,
 * espera ocho columnas de teléfono: si el caso tiene uno solo, las otras siete tienen que estar
 * igual, vacías. Sin esto la única salida era mapear siete veces el mismo campo para rellenar el
 * lugar, que devuelve el dato repetido en vez de una columna vacía.
 *
 * El marcador es el path vacío, no una bandera aparte: una columna o sale de un path o es fija, y
 * tenerlo en un solo lugar evita el estado imposible de las dos cosas a la vez.
 */
export function esColumnaFija(columna: { path?: string }): boolean {
  return !columna.path || columna.path.trim() === '';
}
