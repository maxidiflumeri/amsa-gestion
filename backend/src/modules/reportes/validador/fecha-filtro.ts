/**
 * Valores de fecha de un filtro. Se aceptan **tres** formas y nada más:
 *
 * - `YYYY-MM-DD` (lo que manda el input de fecha del navegador), con un día que exista en el calendario;
 * - un ISO completo con hora (`2026-07-31T03:00:00.000Z`);
 * - un `Date` ya válido.
 *
 * Antes cualquier otra cosa pasaba por `new Date(valor)`: `"hoy-90"` daba 1990-01-01 y `"2026-02-31"`
 * se corría solo a marzo, sin avisar. El reporte salía con otro rango y nadie se enteraba.
 */

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_COMPLETO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Se lanza desde el coercer del planner; quien conoce el nombre del filtro la traduce a 400. */
export class FechaInvalidaError extends Error {
  constructor(public readonly valor: unknown) {
    super(`Fecha inválida: ${String(valor)}`);
    this.name = 'FechaInvalidaError';
  }
}

function diaExiste(anio: number, mes: number, dia: number): boolean {
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * Devuelve el valor listo para usar: el mismo string si era `YYYY-MM-DD` (el planner lo abre al día
 * completo en hora local), o un `Date` si era un ISO con hora. Lanza {@link FechaInvalidaError} si no
 * es ninguna de las formas aceptadas.
 */
export function parsearFechaFiltro(valor: unknown): string | Date {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) throw new FechaInvalidaError(valor);
    return valor;
  }
  if (typeof valor !== 'string') throw new FechaInvalidaError(valor);

  const texto = valor.trim();

  const soloFecha = SOLO_FECHA.exec(texto);
  if (soloFecha) {
    if (!diaExiste(Number(soloFecha[1]), Number(soloFecha[2]), Number(soloFecha[3]))) {
      throw new FechaInvalidaError(valor);
    }
    return texto;
  }

  const iso = ISO_COMPLETO.exec(texto);
  if (iso) {
    const hora = Number(iso[4]);
    const minuto = Number(iso[5]);
    const segundo = iso[6] === undefined ? 0 : Number(iso[6]);
    const fecha = new Date(texto);
    if (
      diaExiste(Number(iso[1]), Number(iso[2]), Number(iso[3])) &&
      hora < 24 && minuto < 60 && segundo < 60 &&
      !Number.isNaN(fecha.getTime())
    ) {
      return fecha;
    }
  }

  throw new FechaInvalidaError(valor);
}

/** Aplica {@link parsearFechaFiltro} a un valor o a cada elemento de una lista. Vacíos pasan tal cual. */
export function validarFechasFiltro(valor: unknown): void {
  const vacio = (v: unknown) => v === null || v === undefined || v === '';
  if (Array.isArray(valor)) {
    for (const v of valor) if (!vacio(v)) parsearFechaFiltro(v);
    return;
  }
  if (!vacio(valor)) parsearFechaFiltro(valor);
}

/**
 * El valor **no** va en el mensaje: el `LoggingInterceptor` loguea `err.message` y lo escrito en un
 * filtro puede ser cualquier cosa. La persona ya sabe qué escribió; lo que necesita es el formato.
 */
export function mensajeFechaInvalida(etiqueta: string): string {
  return `Fecha inválida en el filtro «${etiqueta}». Usá el formato AAAA-MM-DD`;
}
