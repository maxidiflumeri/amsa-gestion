/**
 * Fechas de filtros que vienen como `YYYY-MM-DD`, normalizadas a **días completos en hora local**.
 *
 * Los inputs de fecha del navegador mandan `YYYY-MM-DD` pelado, y `new Date('2026-07-31')` lo
 * interpreta como **medianoche UTC**. En Argentina (UTC−3) eso son las **21:00 del día anterior**, así
 * que cualquier rango queda corrido tres horas hacia atrás en las dos puntas:
 *
 *   - `hasta`: se pierde **todo el último día**. Un pago del 31/07 a las 00:00 AR es
 *     `2026-07-31T03:00:00Z`, posterior a `2026-07-31T00:00:00Z`.
 *   - `desde`: entran de más las **últimas 3 horas del día anterior**.
 *
 * Vive en `common` porque el mismo error apareció en dos lugares distintos: los filtros del tablero
 * y los de los reportes.
 */

/** `YYYY-MM-DD`, lo que mandan los inputs de fecha del navegador. */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿Es una fecha sin hora? Si trae hora, el llamador ya eligió el instante y no hay nada que ajustar. */
export function esSoloFecha(valor: unknown): boolean {
    return typeof valor === 'string' && SOLO_FECHA.test(valor.trim());
}

function parsear(valor: string, finDelDia: boolean): Date {
    const m = SOLO_FECHA.exec(String(valor ?? '').trim());
    if (m) {
        const [, a, mes, d] = m;
        return finDelDia
            ? new Date(Number(a), Number(mes) - 1, Number(d), 23, 59, 59, 999)
            : new Date(Number(a), Number(mes) - 1, Number(d), 0, 0, 0, 0);
    }
    return new Date(valor);
}

/** Comienzo del día (00:00:00.000 local). */
export function inicioDelDia(valor: string): Date {
    return parsear(valor, false);
}

/** Fin del día (23:59:59.999 local). */
export function finDelDia(valor: string): Date {
    return parsear(valor, true);
}
