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

// ─── Fechas calendario (sin hora) ───────────────────────────────────────────────
//
// La convención del repo para una fecha sin hora (promesa de pago, vencimiento de cuota) es "el día
// calendario guardado a las 00:00 UTC, que se lee por la parte de fecha del ISO". Compararla contra
// `hoy 00:00` o contra `now` en hora local la corre un día: 00:00Z son las 21:00 del día anterior en
// Argentina. Estas funciones comparan **días** (`YYYY-MM-DD`), no instantes. Ver docs/inicio-spec.md §2.1.

/** 'YYYY-MM-DD' del día local (TZ del proceso: America/Argentina/Buenos_Aires en el contenedor). */
export function ymdLocal(d: Date = new Date()): string {
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Suma n días calendario a un 'YYYY-MM-DD' (n puede ser negativo). Sin horas de por medio. */
export function sumarDiasYmd(ymd: string, n: number): string {
    const m = SOLO_FECHA.exec(String(ymd ?? '').trim());
    if (!m) throw new RangeError(`Fecha calendario inválida: ${ymd}`);
    const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(base + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** El instante con que se guarda una fecha calendario: 'YYYY-MM-DD' → 00:00:00.000Z de ese día. */
export function fechaCalendarioUtc(ymd: string): Date {
    if (!SOLO_FECHA.test(String(ymd ?? '').trim())) throw new RangeError(`Fecha calendario inválida: ${ymd}`);
    return new Date(`${ymd.trim()}T00:00:00.000Z`);
}

/**
 * El día calendario de una fecha guardada a las 00:00Z: su parte de fecha ISO.
 * Si la fecha llegó con hora (un ISO completo), toma igual la parte de fecha UTC.
 */
export function diaCalendario(d: Date): string {
    return d.toISOString().slice(0, 10);
}

// ─── Fechas relativas ("hoy", "hoy-90", "hoy+7") ────────────────────────────────
//
// Un filtro de un reporte puede pedir "hoy menos N días" en vez de una fecha fija, así la plantilla
// no queda vieja el mes siguiente. Se resuelve a `YYYY-MM-DD` en el momento de ejecutar, contra el día
// de hoy en hora de Argentina (el que el llamador pasa en `hoyYmd`, normalmente `ymdLocal()`).

/** N de 1 a 3650 días: diez años alcanzan para cualquier cartera. */
export const MAX_DIAS_RELATIVOS = 3650;

const FECHA_RELATIVA = /^hoy(?:([+-])(\d{1,4}))?$/;

/** ¿Es `hoy`, `hoy-N` o `hoy+N` con N entre 1 y 3650? (`hoy-0` y `hoy-3651` no lo son.) */
export function esFechaRelativa(valor: unknown): valor is string {
    if (typeof valor !== 'string') return false;
    const m = FECHA_RELATIVA.exec(valor.trim());
    if (!m) return false;
    if (m[2] === undefined) return true;
    const n = Number(m[2]);
    return n >= 1 && n <= MAX_DIAS_RELATIVOS;
}

/**
 * Resuelve una fecha relativa a `YYYY-MM-DD` a partir de `hoyYmd`. Un valor que no es relativo se
 * devuelve tal cual, así el llamador puede pasarle cualquier valor de fecha.
 */
export function resolverFechaRelativa<T>(valor: T, hoyYmd: string): T | string {
    if (!esFechaRelativa(valor)) return valor;
    const m = FECHA_RELATIVA.exec(valor.trim())!;
    if (m[2] === undefined) return sumarDiasYmd(hoyYmd, 0);
    const n = Number(m[2]);
    return sumarDiasYmd(hoyYmd, m[1] === '-' ? -n : n);
}

/** Días calendario de `desdeYmd` a `hastaYmd` (positivo si `hasta` es posterior). Sin horas de por medio. */
export function diasEntre(desdeYmd: string, hastaYmd: string): number {
    const a = SOLO_FECHA.exec(String(desdeYmd ?? '').trim());
    const b = SOLO_FECHA.exec(String(hastaYmd ?? '').trim());
    if (!a || !b) throw new RangeError(`Fecha calendario inválida: ${!a ? desdeYmd : hastaYmd}`);
    const utc = (m: RegExpExecArray) => {
        const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        // Un 2026-13-40 o un 2026-02-31 pasa el formato pero JS lo corre solo a otro día.
        if (t.getUTCMonth() !== Number(m[2]) - 1 || t.getUTCDate() !== Number(m[3])) {
            throw new RangeError(`Fecha calendario inválida: ${m[0]}`);
        }
        return t.getTime();
    };
    const ms = utc(b) - utc(a);
    return Math.round(ms / (24 * 60 * 60 * 1000));
}
