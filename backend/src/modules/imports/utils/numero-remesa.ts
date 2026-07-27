/**
 * Resolución del número de remesa.
 *
 * Si el operador escribió uno, se respeta tal cual. Si no, se genera el **correlativo** de la
 * empresa: último numérico + 1, conservando el ancho (`00001` → `00002`).
 *
 * Antes esto se resolvía en el frontend cayendo a `Date.now()`, que producía números como
 * `1784657478166` — el "número de remesa random" que reportaron los usuarios el 2026-07-27. Los
 * flujos que crean una remesa por día (Toyota 87, spec §B.1.3 B-D6) necesitan que el número sea
 * legible y ordenable.
 */

/** Ancho por defecto cuando la empresa todavía no tiene correlativos: `00001`. */
const ANCHO_DEFAULT = 5;

/**
 * @param numerosPrevios `numeroRemesa` de todas las remesas ya existentes de la empresa.
 * @param propuesto Número escrito por el operador (opcional).
 */
export function siguienteNumeroRemesa(
    numerosPrevios: Array<string | null | undefined>,
    propuesto?: string | null,
): string {
    const manual = (propuesto ?? '').trim();
    if (manual) return manual;

    let maxNumero = 0;
    let ancho = ANCHO_DEFAULT;

    for (const previo of numerosPrevios) {
        const raw = (previo ?? '').trim();
        // Solo cuentan los correlativos "de verdad". Los timestamps de las remesas viejas (13
        // dígitos) se ignoran a propósito: si entraran, el contador saltaría a 1784657478167 y
        // no habría vuelta atrás.
        if (!/^\d{1,6}$/.test(raw)) continue;
        const n = parseInt(raw, 10);
        if (n > maxNumero) {
            maxNumero = n;
            ancho = raw.length;
        }
    }

    return String(maxNumero + 1).padStart(ancho, '0');
}
