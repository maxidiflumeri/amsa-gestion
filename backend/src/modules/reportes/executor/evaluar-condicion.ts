import { BadRequestException } from '@nestjs/common';
import { esSoloFecha } from '../../../common/utils/dia-local';
import { parsearFechaFiltro } from '../validador/fecha-filtro';
import { TipoFecha, ventanaDelDia } from '../validador/fechas-negocio';
import { esOperadorSoportado, extremosDeRango } from '../validador/operadores';

/** Los límites `[desde, hasta]` de un valor de fecha: el día entero si es `YYYY-MM-DD`, el instante si no. */
function limitesDeFecha(esperado: unknown, tipo: TipoFecha): { desde: Date; hasta: Date } {
  const valida = parsearFechaFiltro(esperado);
  if (typeof valida === 'string' && esSoloFecha(valida)) return ventanaDelDia(valida, tipo);
  const instante = valida instanceof Date ? valida : new Date(valida);
  return { desde: instante, hasta: instante };
}

/**
 * Compara una fecha contra el valor del filtro por **día**, con la misma ventana que usa Prisma
 * para esa columna (calendario o instante). Antes un filtro de fecha en memoria comparaba un `Date`
 * contra un string (`false` siempre) y ni siquiera validaba el valor.
 */
function evaluarFecha(valor: unknown, operador: string, esperado: any, tipo: TipoFecha): boolean {
  if (operador === 'isNull') return valor === null || valor === undefined;
  if (operador === 'isNotNull') return valor !== null && valor !== undefined;
  if (!(valor instanceof Date)) return false;
  const t = valor.getTime();

  switch (operador) {
    case 'eq': {
      const { desde, hasta } = limitesDeFecha(esperado, tipo);
      return t >= desde.getTime() && t <= hasta.getTime();
    }
    case 'neq': {
      const { desde, hasta } = limitesDeFecha(esperado, tipo);
      return !(t >= desde.getTime() && t <= hasta.getTime());
    }
    case 'gt':
      return t > limitesDeFecha(esperado, tipo).hasta.getTime();
    case 'gte':
      return t >= limitesDeFecha(esperado, tipo).desde.getTime();
    case 'lt':
      return t < limitesDeFecha(esperado, tipo).desde.getTime();
    case 'lte':
      return t <= limitesDeFecha(esperado, tipo).hasta.getTime();
    case 'in':
    case 'notIn': {
      const lista: unknown[] = Array.isArray(esperado) ? esperado : [esperado];
      const esta = lista.some((e) => {
        const { desde, hasta } = limitesDeFecha(e, tipo);
        return t >= desde.getTime() && t <= hasta.getTime();
      });
      return operador === 'in' ? esta : !esta;
    }
    case 'between':
    case 'notBetween': {
      const extremos = extremosDeRango(esperado);
      if (!extremos) throw new BadRequestException('El filtro «entre» necesita dos valores (desde y hasta)');
      const dentro =
        (extremos.desde === undefined || t >= limitesDeFecha(extremos.desde, tipo).desde.getTime()) &&
        (extremos.hasta === undefined || t <= limitesDeFecha(extremos.hasta, tipo).hasta.getTime());
      return operador === 'between' ? dentro : !dentro;
    }
    default:
      throw new BadRequestException(`El operador ${operador} no se puede usar con una fecha`);
  }
}

/**
 * Evalúa en memoria un filtro que no se pudo expresar en el `where` de Prisma (los que llevan
 * agregadores o `[campo=valor]` en el path). Lo comparten el ejecutor sync y el streaming.
 *
 * Un operador desconocido **lanza**: antes devolvía `true`, o sea que el filtro no filtraba y el
 * reporte salía con todas las filas sin ningún error.
 *
 * `tipoFecha` viene del planner cuando el path termina en una fecha.
 */
export function evaluarCondicion(valor: any, operador: string, valorEsperado: any, tipoFecha?: TipoFecha): boolean {
  if (!esOperadorSoportado(operador)) {
    throw new BadRequestException(`El motor de reportes no soporta el operador: ${operador}`);
  }

  if (tipoFecha) {
    return evaluarFecha(valor, operador, valorEsperado, tipoFecha);
  }

  switch (operador) {
    case 'eq':
      return valor === valorEsperado;
    case 'neq':
      return valor !== valorEsperado;
    case 'gt':
      return valor > valorEsperado;
    case 'gte':
      return valor >= valorEsperado;
    case 'lt':
      return valor < valorEsperado;
    case 'lte':
      return valor <= valorEsperado;
    case 'in':
      return Array.isArray(valorEsperado) && valorEsperado.includes(valor);
    case 'notIn':
      return Array.isArray(valorEsperado) && !valorEsperado.includes(valor);
    case 'contains':
      return String(valor).toLowerCase().includes(String(valorEsperado).toLowerCase());
    case 'startsWith':
      return String(valor).toLowerCase().startsWith(String(valorEsperado).toLowerCase());
    case 'endsWith':
      return String(valor).toLowerCase().endsWith(String(valorEsperado).toLowerCase());
    case 'between':
    case 'notBetween': {
      const extremos = extremosDeRango(valorEsperado);
      if (!extremos) {
        throw new BadRequestException('El filtro «entre» / «fuera de» necesita dos valores (desde y hasta)');
      }
      // Un solo extremo es un rango abierto.
      const dentro =
        (extremos.desde === undefined || valor >= extremos.desde) &&
        (extremos.hasta === undefined || valor <= extremos.hasta);
      return operador === 'between' ? dentro : !dentro;
    }
    case 'isNull':
      return valor === null || valor === undefined;
    case 'isNotNull':
      return valor !== null && valor !== undefined;
  }
}
