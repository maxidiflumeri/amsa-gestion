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

/**
 * Número de remesa de una carga de MULTICLAVES: `MC-AAAAMMDD-HHmmss`, hora Argentina.
 *
 * No es numérico a propósito (D5 del spec): con el correlativo automático, la carga de claves
 * consumiría el número siguiente de la empresa y correría la numeración de las asignaciones de
 * Telecom. `MC-…` no matchea `/^\d{1,6}$/`, así que `siguienteNumeroRemesa` lo ignora para siempre.
 *
 * Con resolución de minuto, dos cargas en el mismo minuto (reintento tras un 400, "Atrás" y volver
 * a validar) chocaban contra la unique `(empresaId, numeroRemesa)` y el alta terminaba en un 500.
 * Con segundos el choque es mucho más improbable, pero `crearRemesaConNumeroSeguro` igual reintenta
 * con un sufijo si pasa: ningún camino puede terminar en 500 por esto.
 *
 * Argentina no tiene horario de verano desde 2009 (UTC-3 todo el año), así que alcanza con
 * `Intl.DateTimeFormat` sin necesitar una librería de zonas horarias.
 */
export function numeroRemesaMulticlaves(fecha: Date): string {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(fecha);
    const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
    return `MC-${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}
