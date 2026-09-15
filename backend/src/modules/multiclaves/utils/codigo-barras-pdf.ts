/**
 * Geometría del código de barras del cupón, en **Code 128 set C** (spec §7.3, corregido tras la
 * auditoría de la fase 2: el diseño original asumía Interleaved 2 of 5 sin evidencia — el auditor
 * decodificó el cupón viejo (`46992372.pdf`) desde los contornos de su fuente de código de barras
 * (`TT17E6t00`) y es Code 128-C: Start C (105), 25 símbolos de datos, checksum mod 103 y Stop. Es lo
 * que ya leen hoy Pago Fácil/Rapipago, así que es lo que hay que replicar).
 *
 * No se usa el `svg` que arma `bwip-js` con `toSVG()`: pdfmake ajusta ese SVG a un `width`/`height`
 * dados **conservando la relación de aspecto del SVG**, así que pasarle un `height` no alcanza para
 * forzar el alto real del código — el aspecto ya viene fijado por el viewBox de bwip-js. Acá se arma
 * un SVG propio, con el ancho del módulo y el alto en **puntos exactos** calculados a mano a partir
 * de `bwip-js` `raw()` (que da los anchos en módulos, sin geometría), así el alto pedido es el alto
 * que sale de verdad.
 */
import type * as BwipJs from 'bwip-js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs: typeof BwipJs = require('bwip-js');

const PT_POR_MM = 72 / 25.4;

/**
 * Módulo angosto de 6/600 de pulgada (0,254 mm): cae en un número entero de puntos a 300 y a 600 dpi,
 * así la impresora no redondea cada barra distinto. Con 0,25 mm justos, a 300 dpi el redondeo podía
 * comerse hasta un tercio del módulo. El cupón viejo mide 0,221 mm; no bajar de 0,20 mm (spec §7.3).
 */
export const MODULO_MM = 25.4 * 6 / 600;
/** Objetivo: alto ≥ 12 mm (el cupón viejo mide ~7,75 mm de la fuente, pero el piso pedido es 12 mm). */
export const ALTO_MM = 14;
/** Objetivo: zona muda ≥ 10 módulos (≥ 2,5 mm) a cada lado, sin bordes ni texto adentro. */
export const QUIETA_MODULOS = 10;

export interface BarraCode128 {
    /** El `<svg>…</svg>` completo, con las barras ya en puntos y la zona muda incluida en el ancho. */
    svg: string;
    /** Ancho total del SVG (zona muda + barras + zona muda), en puntos. */
    anchoPt: number;
    /** Alto de las barras, en puntos. */
    altoPt: number;
    /** Ancho de un módulo, en puntos. */
    moduloPt: number;
    /** Cantidad total de módulos que ocupan las barras (sin la zona muda). */
    totalModulos: number;
}

/**
 * Arma el SVG del código de barras Code 128 set C para una cadena de dígitos de largo par (los
 * `SEC_COD_BARRA` del archivo son 50). No valida el contenido — quien llama (`CuponPdfService`) ya
 * revalidó el código completo (DV, importe, convenio, vencimiento) antes de pedir el dibujo.
 *
 * Usa `bwip-js` **solo** para calcular la secuencia de anchos de barra/espacio (`raw()`, en módulos
 * enteros) — la geometría final (módulo en mm, alto, zona muda) la decide este archivo, no bwip-js.
 */
export function construirBarraCode128(digitos: string): BarraCode128 {
    if (!/^\d+$/.test(digitos) || digitos.length % 2 !== 0 || digitos.length === 0) {
        throw new Error(`construirBarraCode128: se esperan dígitos en cantidad par y no vacía, recibido "${digitos}"`);
    }

    const raw = bwipjs.raw({ bcid: 'code128', text: digitos, parsefnc: false } as BwipJs.RenderOptions) as unknown as Array<{ sbs: number[] }>;
    const sbs = raw[0].sbs;

    const moduloPt = MODULO_MM * PT_POR_MM;
    const altoPt = ALTO_MM * PT_POR_MM;
    const quietaPt = QUIETA_MODULOS * moduloPt;

    const totalModulos = sbs.reduce((a, b) => a + b, 0);
    const anchoBarrasPt = totalModulos * moduloPt;
    const anchoPt = quietaPt * 2 + anchoBarrasPt;

    // El patrón siempre arranca en barra (índices pares = barra, impares = espacio) — convención
    // estándar de códigos de barras: la zona muda (blanco) rodea al patrón, nunca es parte de `sbs`.
    let x = quietaPt;
    const rects: string[] = [];
    sbs.forEach((anchoModulos, i) => {
        const w = anchoModulos * moduloPt;
        if (i % 2 === 0) {
            rects.push(`<rect x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${altoPt.toFixed(3)}" fill="#000000"/>`);
        }
        x += w;
    });

    const svg = `<svg viewBox="0 0 ${anchoPt.toFixed(3)} ${altoPt.toFixed(3)}" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>`;

    return { svg, anchoPt, altoPt, moduloPt, totalModulos };
}
