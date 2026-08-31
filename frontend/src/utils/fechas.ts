/**
 * Fechas del cedente: vencimientos, fin de gestión, emisión de una factura.
 *
 * Son **un día, no un instante**. El archivo dice `2026-10-26` y eso es lo que la operación tiene
 * que ver. Guardadas en una columna `DateTime` quedan a medianoche, y `toLocaleDateString()` las
 * convierte a la zona del navegador: en Argentina (-03) `2026-10-26T00:00:00.000Z` se muestra como
 * el **25**. Eso es el "se carga un día menos" que reportó la operación — el dato guardado está
 * bien, lo que estaba mal era mostrarlo.
 *
 * Por eso se formatea la parte de fecha del ISO tal cual, sin pasar por la zona local. Funciona
 * con las dos formas que hay guardadas en la base: medianoche UTC (`00:00Z`, el archivo cargado sin
 * transform de fecha) y medianoche local (`03:00Z`, el que pasó por `toDate`), porque en las dos el
 * día del ISO es el que trae el archivo.
 *
 * **No usar para timestamps** —creado, comentado, llamado—: esos sí son instantes y van con la hora
 * local del que mira.
 */
export function fechaDelCedente(valor: string | Date | null | undefined): string {
    if (!valor) return '';

    const iso = valor instanceof Date ? valor.toISOString() : String(valor);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;

    // Cualquier otro formato: se cae al render de siempre en vez de mostrar vacío.
    const d = new Date(valor as any);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR');
}
