/**
 * Las opciones de formato se guardan por formato: `{ txt: {...}, csv: {...}, xlsx: {...} }`, porque
 * una plantilla puede cambiar de formato de salida sin perder lo que tenía configurado en el otro.
 * Cada exportador, en cambio, recibe **solo las suyas** (`OpcionesTxt`, `OpcionesCsv`, …).
 *
 * Sin esta traducción se le pasaba el objeto entero al exportador, que buscaba `opciones.separador`
 * en el envoltorio y no lo encontraba nunca: toda opción configurada se ignoraba en silencio.
 */
export function opcionesDelFormato(opcionesFormato: any, formato: string): any {
  if (!opcionesFormato || typeof opcionesFormato !== 'object') return undefined;
  return opcionesFormato[formato];
}
