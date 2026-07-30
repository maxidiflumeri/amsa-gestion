// utils/fecha-cedente.ts

/**
 * Parseo de las fechas que mandan los cedentes en los archivos de texto.
 *
 * Todas vienen en formato día/mes/año, pero **sin garantía de cero a la izquierda** y a veces con
 * la hora pegada atrás. En el paquete de Toyota TCFA conviven los cuatro formatos en el mismo
 * archivo:
 *
 *   29/5/2026 00:00:00   ·   1/12/2025 00:00:00   ·   13/5/2020 00:00:00   ·   21/11/2024 00:00:00
 *
 * Un regex de ancho fijo (`\d{2}/\d{2}/\d{4}`) falla en la mayoría y, si el llamador cae a
 * `new Date()` como default, el vencimiento de la cuota queda con la fecha del día del import:
 * un error silencioso que rompe cualquier reporte de mora.
 *
 * Devuelve `null` en vez de una fecha inventada cuando no puede parsear: que decida el llamador.
 */

/** `D/M/YYYY` o `DD/MM/YYYY`, con hora opcional detrás (se ignora). */
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/;

/**
 * Parsea una fecha `D/M/YYYY [HH:mm[:ss]]` a `Date` local a medianoche.
 *
 * Valida que el día y el mes existan de verdad: `31/2/2026` devuelve `null` en vez de deslizarse
 * al 3 de marzo como haría el constructor de `Date`.
 */
export function parseFechaCedente(raw: unknown): Date | null {
    const s = raw == null ? '' : String(raw).trim();
    if (!s) return null;

    const m = DMY.exec(s);
    if (!m) return null;

    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const anio = Number(m[3]);

    const d = new Date(anio, mes - 1, dia);
    // Si el día no existe en ese mes, Date lo corre al mes siguiente: lo detectamos comparando.
    if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
    return d;
}
