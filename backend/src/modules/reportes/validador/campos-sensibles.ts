/**
 * Lo que un reporte **no puede** tocar, aunque exista en el modelo de Prisma.
 *
 * `POST /reportes/preview` pide solo `reportes.ver`, que tienen todos los operadores: sin esta lista
 * se podían pedir como columna `comentarios.usuario.agenteTelefonia.sipPasswordEnc`,
 * `comentarios.usuario.dni` o `remesa.usuarioCreador.googleId`. Se aplica a columnas, filtros,
 * ordenamientos, agrupaciones y totales, al guardar y al ejecutar.
 */

/**
 * Modelos que **no se pueden atravesar**: credenciales, sesiones de agentes de telefonía y todo lo
 * del asistente de IA (conversaciones de otras personas).
 */
export const MODELOS_BLOQUEADOS = new Set<string>([
  'agente_telefonia',
  'sesion_agente_neotel',
  'campaña_sesion_neotel',
  'estado_agente_evento',
  'neotel_evento_log',
  'rol',
  'Notificacion',
  'asistente_config',
  'asistente_funcion',
  'asistente_conversacion',
  'asistente_mensaje',
  'asistente_llamada',
]);

/**
 * De `usuario` solo se ve quién es. No el DNI, el legajo, el rol ni las relaciones (que llevan a
 * credenciales y sesiones). Es lo mismo que muestra el catálogo (`CAMPOS_VISIBLES_POR_MODELO`) más
 * el `id`.
 */
export const CAMPOS_PERMITIDOS_POR_MODELO: Record<string, string[]> = {
  usuario: ['id', 'nombre', 'email'],
};

/** Cualquier campo con este nombre, en cualquier modelo. */
export const NOMBRE_SENSIBLE = /pass|secret|token|hash|enc$|apiKey|googleId/i;

/** ¿Se puede usar `campo` de `modelo` (nombre del modelo del DMMF) en un reporte? */
export function campoPermitido(modelo: string, campo: string): boolean {
  if (NOMBRE_SENSIBLE.test(campo)) return false;
  const permitidos = CAMPOS_PERMITIDOS_POR_MODELO[modelo];
  return !permitidos || permitidos.includes(campo);
}

/** ¿Se puede entrar al modelo `modelo` desde una relación? */
export function modeloPermitido(modelo: string): boolean {
  return !MODELOS_BLOQUEADOS.has(modelo);
}
