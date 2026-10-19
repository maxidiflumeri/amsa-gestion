/**
 * Los operadores de filtro que el motor sabe resolver, tanto en la consulta a la base (planner) como
 * en memoria (post-procesado). Es la única lista: el DTO, el validador de plantillas y los dos
 * resolvers salen de acá, así un operador que el motor no implementa no puede colarse en una
 * plantilla —antes se descartaba el filtro y el reporte salía con la cartera entera—.
 *
 * `rangoClaves` figuraba en el tipo del frontend y en el spec original pero **nunca se implementó**
 * (el editor tampoco lo ofrecía): dejó de ser un operador válido.
 */
export const OPERADORES_SOPORTADOS = [
  'eq', 'neq', 'in', 'notIn', 'contains', 'startsWith', 'endsWith',
  'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'isNull', 'isNotNull',
] as const;

export type OperadorSoportado = (typeof OPERADORES_SOPORTADOS)[number];

export function esOperadorSoportado(operador: unknown): operador is OperadorSoportado {
  return typeof operador === 'string' && (OPERADORES_SOPORTADOS as readonly string[]).includes(operador);
}

/** Operadores que se aplican sobre un rango `[desde, hasta]`. */
export function esOperadorDeRango(operador: string): boolean {
  return operador === 'between' || operador === 'notBetween';
}

/** Operadores que no llevan valor. */
export function esOperadorSinValor(operador: string): boolean {
  return operador === 'isNull' || operador === 'isNotNull';
}

/** Vacío para un filtro: sin valor, texto vacío, lista vacía o lista de puros vacíos. */
export function esValorVacio(valor: unknown): boolean {
  if (valor === undefined || valor === null || valor === '') return true;
  if (Array.isArray(valor)) {
    return valor.length === 0 || valor.every((v) => v === undefined || v === null || v === '');
  }
  return false;
}

/**
 * Los dos extremos de un rango `[desde, hasta]`, con `undefined` donde falta uno (`null`, `''` o
 * ausente). Un solo extremo es un rango **abierto**: `Entre [desde, vacío]` es "desde en adelante".
 * Devuelve `null` si el valor no es una lista de dos (el llamador responde 400).
 */
export function extremosDeRango(valor: unknown): { desde?: any; hasta?: any } | null {
  if (!Array.isArray(valor) || valor.length !== 2) return null;
  const limpio = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : v);
  return { desde: limpio(valor[0]), hasta: limpio(valor[1]) };
}
