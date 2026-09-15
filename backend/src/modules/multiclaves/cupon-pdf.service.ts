/**
 * Cupón de pago en PDF (3 talones), spec §7. Usa pdfmake con el mismo patrón que
 * `reportes/exportadores/pdf.exportador.ts`: `setFonts` con Roboto del paquete, `createPdf(doc).getBuffer()`.
 *
 * El código de barras es **Code 128 set C** (spec §7.3, corregido tras la auditoría de la fase 2 —
 * el diseño original con Interleaved 2 of 5 era una suposición sin evidencia; el cupón viejo
 * decodificado desde su fuente da Code 128-C, que es lo que ya leen Pago Fácil/Rapipago). Es
 * **siempre** el `codigoBarras` guardado de la clave — nunca se calcula uno acá — y se revalida
 * contra el importe, el convenio y el vencimiento antes de dibujarlo (§7.1): si no corresponde, se
 * corta con un 500 y no se dibuja nada. La geometría (módulo, alto, zona muda) la arma
 * `utils/codigo-barras-pdf.ts`, no `bwip-js` directamente — ver el comentario ahí.
 *
 * D6: la vista previa sale con marca de agua y SIN código de barras, para que nadie se lleve un
 * cupón cobrable sin que quede registrado el convenio (eso lo hace `CuponService`).
 */
import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { descomponerCodigoBarras, dvModulo10_31, formatoImporteCupon } from './utils/clave-pago';
import { importeEnLetras } from './utils/importe-en-letras';
import { construirBarraCode128 } from './utils/codigo-barras-pdf';

// `require`, no `import`: es un módulo `export =` y además así `jest.spyOn` puede mockear `pdfMake`
// si hiciera falta en algún test.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfMake = require('pdfmake');

const fontsDir = path.dirname(require.resolve('pdfmake/build/fonts/Roboto/Roboto-Regular.ttf'));
const FONTS = {
    Roboto: {
        normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
        bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
        italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
        bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
    },
};

/** Ruta del asset dentro del módulo. `nest-cli.json` tiene que copiarla a `dist` (spec §7.5). */
const LOGO_DEFAULT_PATH = path.join(__dirname, 'assets', 'logo-personal.png');

const MEDIOS_DE_PAGO_DEFAULT = ['PAGO FACIL', 'RAPIPAGO', 'BAPRO PAGOS', 'COBRO EXPRESS'];

/** Datos ya resueltos para dibujar un cupón. Ninguno se recalcula acá: el que llama (`CuponService`)
 * ya validó negocio (vencida, cancelado, etc.); esto solo dibuja y revalida el código de barras. */
export interface DatosCupon {
    importeCentavos: number;
    /** El `codigoBarras` guardado de la clave, 50 dígitos, tal cual — nunca se recalcula. */
    codigoBarras: string;
    /** `NRO_CONVENIO` de la clave (8 dígitos). Se usa para revalidar el código antes de dibujarlo. */
    nroConvenio: string;
    /** `YYYY-MM-DD`, el vencimiento REAL de la clave (no el impreso) — se usa para revalidar el
     * código antes de dibujarlo. Nunca se muestra en el cupón; lo que se imprime es `vtoImpreso`. */
    fechaVencimiento: string;
    /** [apellido, nombre] del deudor, ya unido y con espacios colapsados. */
    nombre: string;
    nroTramite: string;
    /** `DD/MM/AAAA`, ya calculado con D12 (`calcularVtoImpreso`). */
    vtoImpreso: string;
    /** `deudor.id`, para el talón del cliente. */
    referencia: string;
    leyendaTalonCedente: string;
    mediosDePago: string[];
    /** D6: sin código de barras y con marca de agua. */
    vistaPrevia: boolean;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Día calendario (`YYYY-MM-DD`) en el huso de Argentina, sin pasar por la hora local del proceso. */
function isoDiaAR(fecha: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(fecha);
}

/** `fechaVencimiento` es un `@db.Date`: el día del ISO ES el día que trajo el cedente (igual criterio
 * que `fechaDelCedente()` del frontend) — no se pasa por ninguna zona horaria. */
function isoDiaDelCedente(fecha: Date): string {
    return fecha.toISOString().slice(0, 10);
}

function sumarDiasIso(iso: string, dias: number): string {
    const d = new Date(`${iso}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

function isoADDMMAAAA(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

/**
 * D12: vencimiento **impreso** = `min(hoy + 7 días corridos, fechaVencimiento real)`, día de
 * Argentina. El código de barras sigue llevando siempre el vencimiento real (nunca este valor).
 *
 * @param hoy Inyectable para tests, igual que `parseMulticlaves(archivos, cfg, hoy)`.
 */
export function calcularVtoImpreso(fechaVencimiento: Date, hoy: Date = new Date()): string {
    const hoyIso = isoDiaAR(hoy);
    const candidatoIso = sumarDiasIso(hoyIso, 7);
    const vtoRealIso = isoDiaDelCedente(fechaVencimiento);
    const elegidoIso = candidatoIso < vtoRealIso ? candidatoIso : vtoRealIso;
    return isoADDMMAAAA(elegidoIso);
}

/**
 * D9: "vencida" = hoy (día de Argentina) > `fechaVencimiento` de la clave, sin corrimiento — el
 * vencimiento real nunca se extiende. Al día exacto del vencimiento todavía se puede generar/reimprimir.
 */
export function esClaveVencida(fechaVencimiento: Date, hoy: Date = new Date()): boolean {
    return isoDiaAR(hoy) > isoDiaDelCedente(fechaVencimiento);
}

/** Trunca a `max` y corta con "…" — heurística de "hasta 2 líneas" del §7.2 sin medir texto. */
function truncar(texto: string, max: number): string {
    const t = (texto ?? '').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

@Injectable()
export class CuponPdfService implements OnModuleInit {
    private readonly logger = new Logger(CuponPdfService.name);
    private logoDataUrl: string | null = null;

    onModuleInit(): void {
        const ruta = process.env.MULTICLAVES_LOGO_PATH || LOGO_DEFAULT_PATH;
        try {
            const buf = fs.readFileSync(ruta);
            this.logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
        } catch {
            // Nunca falla por el logo (D11): se loguea una vez y el cupón sale con el texto
            // "Personal" en su lugar.
            this.logger.warn(`Logo de Personal no encontrado en "${ruta}"; el cupón sale con el texto "Personal".`);
        }
    }

    /** Genera el PDF. Revalida el código de barras contra el importe y el convenio antes de dibujar
     * nada — nunca se imprime un código que no corresponde (defensa ante una edición manual de la
     * base). Lanza `InternalServerErrorException` si no revalida o si pdfmake/bwip-js fallan. */
    async generar(d: DatosCupon): Promise<Buffer> {
        const t0 = Date.now();
        this.revalidarCodigoBarras(d);

        try {
            const doc = this.armarDocumento(d);
            pdfMake.setFonts(FONTS);
            const raw: unknown = await pdfMake.createPdf(doc).getBuffer();
            const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
            this.logger.debug(
                `Cupón PDF generado (${d.vistaPrevia ? 'preview' : 'final'}) convenio=${d.nroConvenio} en ${Date.now() - t0}ms`,
            );
            return buffer;
        } catch (error: any) {
            this.logger.error(`Error generando el PDF del cupón (convenio ${d.nroConvenio})`, error?.stack);
            throw new InternalServerErrorException('No se pudo generar el PDF del cupón.');
        }
    }

    /** §7.1: recalcula el DV y decodifica el código para chequear que el importe, el convenio y el
     * vencimiento coincidan con los que se van a mostrar. Nunca se dibuja un código que no pasa esto.
     *
     * El vencimiento se compara acá porque es la única de las tres validaciones que la auditoría de
     * la fase 2 encontró faltante: `descomponerCodigoBarras` ya devolvía `vto`, pero nadie lo
     * comparaba contra `clave.fechaVencimiento` — un código con el vencimiento cambiado (DV
     * recalculado a mano) pasaba esta función igual. */
    private revalidarCodigoBarras(d: DatosCupon): void {
        const cb = d.codigoBarras;
        const decoded = /^\d{50}$/.test(cb) ? descomponerCodigoBarras(cb) : null;
        const dvCalculado = /^\d{50}$/.test(cb) ? dvModulo10_31(cb.slice(0, 49)) : null;

        const ok =
            decoded !== null &&
            dvCalculado === decoded.dv &&
            decoded.centavos === d.importeCentavos &&
            decoded.convenio === d.nroConvenio &&
            decoded.vto === d.fechaVencimiento;

        if (!ok) {
            this.logger.error(
                `Código de barras no revalida: convenio=${d.nroConvenio} importe=${d.importeCentavos} ` +
                `vencimiento=${d.fechaVencimiento} codigoBarras="${cb}"`,
            );
            throw new InternalServerErrorException(
                'El código de barras de la clave no coincide con su importe, convenio o vencimiento; no se generó el cupón.',
            );
        }
    }

    /** El SVG ya trae su propio ancho y alto en puntos EXACTOS (`utils/codigo-barras-pdf.ts`): se
     * pasan tal cual a pdfmake, sin recalcular — pasar un `width`/`height` que no coincida con el
     * viewBox del SVG es lo que hacía que pdfmake reescalara conservando el aspecto y el alto real
     * terminara siendo otro (el bug que encontró la auditoría). */
    private barraSvg(digitos: string): Content {
        const b = construirBarraCode128(digitos);
        return { svg: b.svg, width: b.anchoPt, height: b.altoPt } as unknown as Content;
    }

    private campo(label: string, valor: string, alinearValor: 'left' | 'right' = 'left'): Content {
        return {
            columns: [
                { text: label, width: 'auto', fontSize: 8, margin: [0, 3, 4, 0] },
                {
                    table: { widths: ['*'], body: [[{ text: valor, bold: true, fontSize: 8.5, alignment: alinearValor }]] },
                    width: '*',
                },
            ],
            margin: [0, 2, 0, 2],
        };
    }

    private talon(opts: {
        ancho: number;
        d: DatosCupon;
        conVto: boolean;
        conBarra: boolean;
        conReferencia: boolean;
        leyenda: string;
    }): Content {
        const { ancho, d, conVto, conBarra, conReferencia, leyenda } = opts;
        const importeTexto = formatoImporteCupon(d.importeCentavos);
        const nombreTruncado = truncar(d.nombre, 46);

        const stack: Content[] = [];

        if (this.logoDataUrl) {
            stack.push({ image: this.logoDataUrl, height: 22, width: 90, margin: [0, 0, 0, 4] });
        } else {
            stack.push({ text: 'Personal', italics: true, bold: true, fontSize: 18, color: '#9e9e9e', margin: [0, 0, 0, 4] });
        }

        stack.push(this.campo('Importe $', importeTexto, 'right'));
        stack.push(this.campo('Nombre y apellido', nombreTruncado));

        if (conVto) {
            stack.push({
                text: [
                    { text: 'Vto: ', fontSize: 8 },
                    { text: d.vtoImpreso, bold: true, fontSize: 8.5 },
                ],
                alignment: 'center',
                margin: [0, 2, 0, 2],
            });
        }

        stack.push(this.campo('Cliente n°', d.nroTramite));
        stack.push({
            text: `Son Pesos: ${importeEnLetras(d.importeCentavos)}`,
            bold: true,
            fontSize: 9,
            margin: [0, 4, 0, 6],
        });

        if (conBarra) {
            if (d.vistaPrevia) {
                stack.push({
                    table: { widths: ['*'], body: [[{ text: 'El código de barras se genera al confirmar', fontSize: 7, color: '#757575', alignment: 'center', margin: [0, 10, 0, 10] }]] },
                    layout: { fillColor: () => '#eeeeee', hLineColor: () => '#bdbdbd', vLineColor: () => '#bdbdbd' },
                });
            } else {
                stack.push(this.barraSvg(d.codigoBarras));
                stack.push({ text: d.codigoBarras, bold: true, fontSize: 9, margin: [0, 2, 0, 0] });
            }
        }

        if (conReferencia) {
            stack.push({ text: d.referencia, fontSize: 7.5, alignment: 'right', margin: [0, 22, 0, 0] });
        }

        stack.push({ text: leyenda, fontSize: 5, bold: true, margin: [0, 6, 0, 0] });

        return { width: ancho, stack } as unknown as Content;
    }

    private armarDocumento(d: DatosCupon): TDocumentDefinitions {
        // A4 (595.28pt) menos márgenes de 20pt a cada lado ≈ 555pt de ancho útil. pdfmake trata un
        // ancho de columna FIJO (no "%") como el ancho de contenido puro: el padding de la celda se
        // agrega ARRIBA de eso, no se descuenta (columnCalculator.js:56). Sin restar el padding acá,
        // la tabla se pasaba del margen derecho y el talón 3 quedaba cortado contra el borde de la
        // hoja. Se resta el padding de las 3 columnas (2 lados c/u) y se deja además un colchón de
        // 5pt por los bordes verticales entre talones.
        const ANCHO_HOJA = 555 - 5;
        const PADDING_CELDA = 4;
        const anchoUtil = ANCHO_HOJA - 3 * (PADDING_CELDA * 2);
        const a1 = Math.round(anchoUtil * 0.52);
        const a2 = Math.round(anchoUtil * 0.23);
        const a3 = anchoUtil - a1 - a2;
        const medios = d.mediosDePago.length ? d.mediosDePago : MEDIOS_DE_PAGO_DEFAULT;

        const content: Content[] = [
            {
                table: {
                    widths: [a1, a2, a3],
                    body: [[
                        this.talon({ ancho: a1, d, conVto: true, conBarra: true, conReferencia: false, leyenda: d.leyendaTalonCedente }),
                        this.talon({ ancho: a2, d, conVto: false, conBarra: false, conReferencia: false, leyenda: 'TALON P/EL BANCO - FIRMA, SELLO Y FECHA AL DORSO' }),
                        this.talon({ ancho: a3, d, conVto: false, conBarra: false, conReferencia: true, leyenda: 'TALON P/EL CLIENTE - FIRMA, SELLO Y FECHA AL DORSO' }),
                    ]],
                },
                layout: {
                    hLineWidth: (i: number) => (i === 0 ? 0.5 : 0),
                    vLineWidth: (i: number) => (i === 0 || i === 3 ? 0.5 : 1.5),
                    vLineColor: () => '#000000',
                    paddingLeft: () => PADDING_CELDA,
                    paddingRight: () => PADDING_CELDA,
                },
            },
            {
                canvas: [{ type: 'line', x1: 0, y1: 6, x2: ANCHO_HOJA, y2: 6, dash: { length: 8, space: 4 }, lineWidth: 1 }],
            },
            {
                text: `Usted podrá abonar este cupón en: ${medios.join(' / ')}`,
                bold: true,
                fontSize: 11,
                margin: [10, 40, 0, 0],
            },
        ];

        const doc: TDocumentDefinitions & { watermark?: Record<string, unknown> } = {
            pageSize: 'A4',
            pageMargins: [20, 20, 20, 20],
            defaultStyle: { font: 'Roboto' },
            content,
        };

        if (d.vistaPrevia) {
            doc.watermark = {
                text: 'VISTA PREVIA — NO VÁLIDO PARA PAGO',
                color: '#c62828',
                opacity: 0.25,
                bold: true,
                fontSize: 34,
            };
        }

        return doc;
    }
}
