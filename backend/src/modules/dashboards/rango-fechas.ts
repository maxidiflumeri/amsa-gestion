// modules/dashboards/rango-fechas.ts
import { BadRequestException } from '@nestjs/common';

/**
 * Rango de fechas de los filtros del tablero, normalizado a **días completos en hora local**.
 *
 * El front manda `YYYY-MM-DD` (lo que escribe el operador en los inputs de fecha), y `new Date('2026-07-31')`
 * lo interpreta como **medianoche UTC**. En Argentina (UTC−3) eso equivale a las **21:00 del día
 * anterior**, así que el rango quedaba corrido tres horas hacia atrás en las dos puntas:
 *
 *   - `hasta`: todo lo del último día del rango quedaba **afuera**. Un pago registrado el 31/07 a las
 *     00:00 AR es `2026-07-31T03:00:00Z` > `2026-07-31T00:00:00Z`.
 *   - `desde`: entraban de más las **últimas 3 horas del día anterior** al inicio del rango.
 *
 * Es lo que hacía que el tablero mostrara "Pagos del período $0" y "Mora promedio —" para una remesa
 * que sí tenía 16 pagos registrados el último día del rango.
 *
 * Estas funciones interpretan la fecha en la zona del servidor y devuelven el día completo:
 * `desde` a las 00:00:00.000 y `hasta` a las 23:59:59.999.
 */

/** `YYYY-MM-DD`, lo que mandan los inputs de fecha del navegador. */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

function parsear(valor: string, finDelDia: boolean): Date {
    const m = SOLO_FECHA.exec(String(valor ?? '').trim());
    if (m) {
        const [, a, mes, d] = m;
        return finDelDia
            ? new Date(Number(a), Number(mes) - 1, Number(d), 23, 59, 59, 999)
            : new Date(Number(a), Number(mes) - 1, Number(d), 0, 0, 0, 0);
    }
    // Si viene con hora (ISO completo), se respeta tal cual: el llamador ya eligió el instante.
    return new Date(valor);
}

/** Comienzo del día (00:00:00.000 local) de la fecha `desde`. */
export function inicioDelDia(valor: string): Date {
    return parsear(valor, false);
}

/** Fin del día (23:59:59.999 local) de la fecha `hasta`. */
export function finDelDia(valor: string): Date {
    return parsear(valor, true);
}

/**
 * Normaliza y valida el rango de los filtros del tablero.
 * @throws BadRequestException si alguna fecha es inválida o si `desde` es posterior a `hasta`.
 */
export function resolverRango(dtoDesde: string, dtoHasta: string): { desde: Date; hasta: Date } {
    const desde = inicioDelDia(dtoDesde);
    const hasta = finDelDia(dtoHasta);
    if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
        throw new BadRequestException('Fechas inválidas');
    }
    if (desde > hasta) {
        throw new BadRequestException('"desde" debe ser <= "hasta"');
    }
    return { desde, hasta };
}
