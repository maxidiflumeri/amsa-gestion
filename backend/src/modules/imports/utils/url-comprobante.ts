// utils/url-comprobante.ts
//
// Normalización del link al comprobante que manda el cedente.
//
// Telecom y Telecom Personal traen en el archivo de detalle (MA) la URL de cada factura en el
// portal del cliente. En la ficha se muestra como un link que abre una pestaña nueva, así que lo
// que se guarda tiene que ser una URL de verdad: si el cedente manda un `NI`, un `-` o un texto
// cualquiera, renderizarlo como link es peor que no mostrar nada.
//
// Solo se aceptan `http` y `https` a propósito. Un `javascript:` en un `href` que se abre desde la
// ficha del deudor es un XSS con los datos del cedente como vector de entrada.

/** Largo máximo razonable de una URL; más que eso es un campo mal mapeado, no un link. */
const LARGO_MAX = 2048;

/**
 * Devuelve la URL si sirve como link, o `null` si no.
 *
 * `null` es "la fila no trae link", que es distinto de "trae uno vacío": el processor usa esa
 * diferencia para no pisar con nada un link ya cargado.
 */
export function urlComprobanteValida(valor: unknown): string | null {
    if (valor == null) return null;
    const s = String(valor).trim();
    if (!s || s.length > LARGO_MAX) return null;

    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
    } catch {
        return null;
    }
}
