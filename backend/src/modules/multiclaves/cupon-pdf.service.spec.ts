import * as zlib from 'zlib';
import { Test } from '@nestjs/testing';
import { dvModulo10_31 } from './utils/clave-pago';
// `require`, no `import * as`: es el mismo módulo (por el cache de Node/Jest) que usa
// `codigo-barras-pdf.ts` internamente, así que `jest.spyOn` sí puede pisar `raw` (ver comentario en
// cupon-pdf.service.ts / codigo-barras-pdf.ts).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js');
import { CuponPdfService, DatosCupon, calcularVtoImpreso, esClaveVencida } from './cupon-pdf.service';

// Fixture real del spec (§9.1, ya validado en clave-pago.spec.ts): convenio 96332206,
// importe 19.880,01 (1988001 centavos), vencimiento real 2026-10-27.
const CODIGO_BARRAS_VALIDO = '49800019880012710202600000000000096332206000000007';

function datosValidos(overrides: Partial<DatosCupon> = {}): DatosCupon {
    return {
        importeCentavos: 1988001,
        codigoBarras: CODIGO_BARRAS_VALIDO,
        nroConvenio: '96332206',
        fechaVencimiento: '2026-10-27',
        nombre: 'PEREZ JUAN',
        nroTramite: '1841012140',
        vtoImpreso: '20/10/2026',
        referencia: '123',
        leyendaTalonCedente: 'TALON PARA Telecom Personal Argentina S.A. - FIRMA, SELLO Y FECHA AL DORSO',
        mediosDePago: ['PAGO FACIL', 'RAPIPAGO', 'BAPRO PAGOS', 'COBRO EXPRESS'],
        vistaPrevia: false,
        ...overrides,
    };
}

// ─── Decodificador independiente de Code 128, leyendo el content stream del PDF ────────────────
//
// No usa bwip-js para nada: parsea los operadores de dibujo del PDF (`re`/`f`) para encontrar los
// rectángulos que forman las barras, mide sus anchos en puntos y decodifica Code 128 con la tabla
// estándar de 107 símbolos. Es la única forma de probar que lo que el PDF **dibuja de verdad**
// coincide con el `SEC_COD_BARRA` — decodificar con bwip-js hubiera sido un ida y vuelta de la
// misma librería contra sí misma (el error que señaló la auditoría).
//
// Patrón de streams/CTM adaptado del lector independiente que dejó el auditor
// (`scratchpad/audit/pdfbars.js`).

interface Rect { x0: number; x1: number; y0: number; y1: number; }

function extraerStreams(buf: Buffer): Array<{ dict: string; data: Buffer | null }> {
    const s = buf.toString('latin1');
    const re = /(\d+) 0 obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
    const out: Array<{ dict: string; data: Buffer | null }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
        const st = m.index + m[0].length;
        const en = s.indexOf('endstream', st);
        const raw = buf.slice(st, en);
        let data: Buffer | null = null;
        if (/FlateDecode/.test(m[2])) {
            try {
                data = zlib.inflateSync(raw);
            } catch {
                try {
                    data = zlib.inflateSync(raw.slice(0, raw.length - 1));
                } catch {
                    data = null;
                }
            }
        } else {
            data = raw;
        }
        out.push({ dict: m[2], data });
    }
    return out;
}

type Matriz = [number, number, number, number, number, number];
function mul(a: Matriz, b: Matriz): Matriz {
    return [
        a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
        a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
        a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
    ];
}
function tx(M: Matriz, x: number, y: number): [number, number] {
    return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

/** Rellenos (`m/l/re ... f`) del content stream, con su bbox ya en coordenadas de página (aplicada
 * la CTM). `svg-to-pdfkit` (lo que usa pdfmake para insertar el SVG del código de barras) convierte
 * cada `<rect>` en un path `m l l l h f`, NO en un operador `re` directo — sin soportar `m`/`l` acá
 * no se encuentra ninguna barra, aunque el contenido esté perfectamente bien dibujado. */
function extraerRellenos(texto: string): Rect[] {
    const toks = texto.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s/[\]()<>]+|[^\s[\]()<>/]+/g) ?? [];
    let st: number[] = [];
    let M: Matriz = [1, 0, 0, 1, 0, 0];
    const stack: Matriz[] = [];
    let path: Array<[number, number]>[] = [];
    let cur: Array<[number, number]> | null = null;
    const fills: Rect[] = [];

    for (const t of toks) {
        if (/^-?[\d.]+$/.test(t)) { st.push(Number(t)); continue; }
        switch (t) {
            case 'q': stack.push([...M]); break;
            case 'Q': M = stack.pop() ?? M; break;
            case 'cm': { const a = st.slice(-6) as Matriz; M = mul(a, M); break; }
            case 'm': { const [x, y] = st.slice(-2); cur = [tx(M, x, y)]; path.push(cur); break; }
            case 'l': { const [x, y] = st.slice(-2); if (!cur) { cur = []; path.push(cur); } cur.push(tx(M, x, y)); break; }
            case 'c': { const a = st.slice(-6); if (!cur) { cur = []; path.push(cur); } cur.push(tx(M, a[4], a[5])); break; }
            case 're': {
                const [x, y, w, h] = st.slice(-4);
                path.push([tx(M, x, y), tx(M, x + w, y), tx(M, x + w, y + h), tx(M, x, y + h)]);
                break;
            }
            case 'f': case 'F': case 'f*': case 'B': case 'b':
                for (const p of path) {
                    const xs = p.map((q) => q[0]); const ys = p.map((q) => q[1]);
                    fills.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
                }
                path = [];
                cur = null;
                break;
            case 'n': path = []; cur = null; break;
        }
        if (!/^-?[\d.]+$/.test(t) && t !== '[' && t !== ']') st = [];
    }
    return fills;
}

const C128 = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

interface CodigoLeido {
    decodificado: string;
    start: number;
    stop: number;
    checksumCalculado: number;
    checksumLeido: number;
    moduloPt: number;
    moduloMm: number;
    altoPt: number;
    altoMm: number;
    zonaQuietaIzqMm: number;
    zonaQuietaDerMm: number | null;
}

const PT_A_MM = 25.4 / 72;

/** Lee el PDF generado, encuentra las barras (rellenos angostos y altos) y decodifica Code 128 con
 * la tabla estándar — sin usar bwip-js en ningún paso. */
function leerCode128DelPdf(buffer: Buffer): CodigoLeido {
    let fills: Rect[] = [];
    for (const s of extraerStreams(buffer)) {
        if (!s.data) continue;
        if (/Subtype\s*\/Image|FontFile|Length1|DescendantFonts/.test(s.dict)) continue;
        const texto = s.data.toString('latin1');
        if (!/\b(re|m|l)\b/.test(texto)) continue;
        fills = fills.concat(extraerRellenos(texto));
    }

    // El talón tiene sus propias líneas verticales delgadas y altas (los separadores entre
    // talones, ~1.5pt de ancho por ~240pt de alto): el mismo filtro "angosto y alto" que detecta
    // las barras del código también las detecta a ELLAS. Sin agrupar por fila (mismo y0/y1) y
    // quedarse con el grupo más numeroso, esas líneas se mezclaban con las barras reales del
    // código al ordenar por x y arruinaban la decodificación en el documento completo (con un solo
    // SVG en la página, sin nada más alrededor, este bug no se notaba).
    const candidatas = fills.filter((b) => b.x1 - b.x0 < 5 && b.y1 - b.y0 > 10);
    if (!candidatas.length) throw new Error('No se encontraron barras en el PDF (¿el cupón salió sin código?)');

    const porFila = new Map<string, Rect[]>();
    for (const b of candidatas) {
        const k = `${b.y0.toFixed(1)}_${b.y1.toFixed(1)}`;
        const lista = porFila.get(k) ?? [];
        lista.push(b);
        porFila.set(k, lista);
    }
    const filas = [...porFila.values()].sort((a, b) => b.length - a.length);
    const barras = filas[0].sort((a, b) => a.x0 - b.x0);
    const otrasLineas: Rect[] = filas.slice(1).flat();

    const merged: Rect[] = [];
    for (const b of barras) {
        const last = merged[merged.length - 1];
        if (last && b.x0 <= last.x1 + 1e-3) last.x1 = Math.max(last.x1, b.x1);
        else merged.push({ ...b });
    }

    const widths = merged.map((b) => b.x1 - b.x0);
    const spaces: number[] = [];
    for (let i = 1; i < merged.length; i++) spaces.push(merged[i].x0 - merged[i - 1].x1);
    const elems: number[] = [];
    for (let i = 0; i < merged.length; i++) { elems.push(widths[i]); if (i < spaces.length) elems.push(spaces[i]); }

    const moduloPt = Math.min(...elems);
    const moduleCounts = elems.map((e) => Math.max(1, Math.round(e / moduloPt)));

    const syms: string[] = [];
    let i = 0;
    while (i < moduleCounts.length) {
        const restante = moduleCounts.length - i;
        const take = restante === 7 ? 7 : 6;
        syms.push(moduleCounts.slice(i, i + take).join(''));
        i += take;
    }
    const vals = syms.map((s) => C128.indexOf(s));

    const start = vals[0];
    const stop = vals[vals.length - 1];
    const checksumLeido = vals[vals.length - 2];
    const dataVals = vals.slice(1, -2);
    let sum = start;
    dataVals.forEach((v, k) => { sum += v * (k + 1); });
    const checksumCalculado = sum % 103;
    const decodificado = dataVals.map((v) => String(v).padStart(2, '0')).join('');

    const x0 = merged[0].x0, x1 = merged[merged.length - 1].x1;
    const y0 = merged[0].y0, y1 = merged[0].y1;

    const otros = fills
        .filter((b) => !(b.x1 - b.x0 < 5 && b.y1 - b.y0 > 10))
        .concat(otrasLineas)
        .filter((b) => b.y1 > y0 && b.y0 < y1);
    const izq = otros.filter((b) => b.x1 <= x0 + 0.01).sort((a, b) => b.x1 - a.x1)[0];
    const der = otros.filter((b) => b.x0 >= x1 - 0.01).sort((a, b) => a.x0 - b.x0)[0];

    return {
        decodificado,
        start,
        stop,
        checksumCalculado,
        checksumLeido,
        moduloPt,
        moduloMm: moduloPt * PT_A_MM,
        altoPt: y1 - y0,
        altoMm: (y1 - y0) * PT_A_MM,
        zonaQuietaIzqMm: (izq ? x0 - izq.x1 : x0) * PT_A_MM,
        zonaQuietaDerMm: der ? (der.x0 - x1) * PT_A_MM : null,
    };
}

describe('CuponPdfService', () => {
    let service: CuponPdfService;

    beforeEach(async () => {
        const module = await Test.createTestingModule({ providers: [CuponPdfService] }).compile();
        service = module.get(CuponPdfService);
        service.onModuleInit(); // el placeholder de assets/ existe en el repo
    });

    it('genera un buffer que empieza con %PDF', async () => {
        const buffer = await service.generar(datosValidos());
        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer.length).toBeGreaterThan(0);
        expect(buffer.toString('ascii', 0, 4)).toBe('%PDF');
    });

    it('un código de barras que no revalida (importe alterado) lanza sin dibujar nada', async () => {
        await expect(
            service.generar(datosValidos({ importeCentavos: 1988002 })),
        ).rejects.toThrow();
    });

    it('un código de barras que no revalida (convenio distinto al de la clave) lanza', async () => {
        await expect(
            service.generar(datosValidos({ nroConvenio: '99999999' })),
        ).rejects.toThrow();
    });

    it('un DV alterado en el código de barras lanza', async () => {
        const alterado = CODIGO_BARRAS_VALIDO.slice(0, -1) + '9'; // último dígito (DV) cambiado
        await expect(
            service.generar(datosValidos({ codigoBarras: alterado })),
        ).rejects.toThrow();
    });

    it('un código con el vencimiento cambiado y el DV RECALCULADO (para que siga siendo válido en sí mismo) igual lanza, porque no coincide con clave.fechaVencimiento', async () => {
        // Reproduce el hallazgo de la auditoría: cambiar el vto (posiciones 13-21) a 28/10/2026 y
        // recalcular el DV deja un código "internamente consistente" (DV correcto para SU propio
        // contenido), pero que ya no es el vencimiento real de la clave. Antes de este fix,
        // `revalidarCodigoBarras` no comparaba `decoded.vto` contra nada y este código pasaba.
        const sinDv = CODIGO_BARRAS_VALIDO.slice(0, 49);
        const vtoAlterado = sinDv.slice(0, 13) + '28102026' + sinDv.slice(21);
        const dvNuevo = dvModulo10_31(vtoAlterado);
        const codigoConVtoAlterado = vtoAlterado + String(dvNuevo);

        // Verificación de la propia trampa: el código alterado es válido "en sí mismo" (DV ok).
        expect(dvModulo10_31(codigoConVtoAlterado.slice(0, 49))).toBe(Number(codigoConVtoAlterado.slice(49)));

        await expect(
            service.generar(datosValidos({ codigoBarras: codigoConVtoAlterado })), // fechaVencimiento sigue en 2026-10-27
        ).rejects.toThrow();
    });

    it('vistaPrevia: true no llama a bwip-js (D6: sin código de barras)', async () => {
        const spy = jest.spyOn(bwipjs, 'raw');
        await service.generar(datosValidos({ vistaPrevia: true }));
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('vistaPrevia: false SÍ llama a bwip-js (raw, no toSVG) para calcular el patrón de barras', async () => {
        const spy = jest.spyOn(bwipjs, 'raw');
        await service.generar(datosValidos({ vistaPrevia: false }));
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatchObject({ bcid: 'code128' });
        spy.mockRestore();
    });

    it('sin logo, genera igual (con el texto de reemplazo) y loguea warn una sola vez', async () => {
        const logger = (service as any).logger;
        const warnSpy = jest.spyOn(logger, 'warn');
        (service as any).logoDataUrl = null;

        // Simula que el archivo no existe: se llama onModuleInit apuntando a una ruta inexistente.
        const original = process.env.MULTICLAVES_LOGO_PATH;
        process.env.MULTICLAVES_LOGO_PATH = '/no/existe/logo.png';
        service.onModuleInit();
        process.env.MULTICLAVES_LOGO_PATH = original;

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const buffer = await service.generar(datosValidos());
        expect(buffer.toString('ascii', 0, 4)).toBe('%PDF');
    });
});

describe('Code 128 real, medido leyendo el PDF generado (sin bwip-js en la verificación)', () => {
    let service: CuponPdfService;

    beforeEach(async () => {
        const module = await Test.createTestingModule({ providers: [CuponPdfService] }).compile();
        service = module.get(CuponPdfService);
        service.onModuleInit();
    });

    it('decodifica exactamente el SEC_COD_BARRA de la clave, con Start C, Stop y checksum válidos', async () => {
        const buffer = await service.generar(datosValidos());
        const leido = leerCode128DelPdf(buffer);
        expect(leido.start).toBe(105); // Start C
        expect(leido.stop).toBe(106); // Stop
        expect(leido.checksumCalculado).toBe(leido.checksumLeido);
        expect(leido.decodificado).toBe(CODIGO_BARRAS_VALIDO);
    });

    it('el módulo mide ~0,25mm (objetivo del spec §7.3, nunca menos de 0,20mm)', async () => {
        const buffer = await service.generar(datosValidos());
        const leido = leerCode128DelPdf(buffer);
        expect(leido.moduloMm).toBeGreaterThanOrEqual(0.20);
        expect(leido.moduloMm).toBeCloseTo(0.25, 1);
    });

    it('el alto del código es >= 12mm (piso pedido por el spec §7.3)', async () => {
        const buffer = await service.generar(datosValidos());
        const leido = leerCode128DelPdf(buffer);
        expect(leido.altoMm).toBeGreaterThanOrEqual(12);
    });

    it('la zona muda es >= 2,5mm (10 módulos) a cada lado, sin bordes ni texto adentro', async () => {
        const buffer = await service.generar(datosValidos());
        const leido = leerCode128DelPdf(buffer);
        expect(leido.zonaQuietaIzqMm).toBeGreaterThanOrEqual(2.5);
        // Puede no haber nada a la derecha dentro de la columna (el talón es más ancho que el
        // código con su zona muda incluida) — en ese caso no hay objeto que la invada, es más
        // ancha todavía que el mínimo. `zonaQuietaDerMm === null` es ese caso "sin nada cerca".
        if (leido.zonaQuietaDerMm !== null) {
            expect(leido.zonaQuietaDerMm).toBeGreaterThanOrEqual(2.5);
        }
    });

    it('con otro código real del archivo (TOTAL, convenio 96311343) también decodifica exacto', async () => {
        const codigo = '49800039760032710202600000000000096311343000000009';
        const buffer = await service.generar(datosValidos({
            codigoBarras: codigo, importeCentavos: 3976003, nroConvenio: '96311343',
        }));
        const leido = leerCode128DelPdf(buffer);
        expect(leido.decodificado).toBe(codigo);
    });

    it('con el código del cupón viejo de referencia (46992372.pdf) también decodifica exacto', async () => {
        const codigo = '49800043782691508202600000000000094674769000000004';
        const buffer = await service.generar(datosValidos({
            codigoBarras: codigo, importeCentavos: 4378269, nroConvenio: '94674769', fechaVencimiento: '2026-08-15',
        }));
        const leido = leerCode128DelPdf(buffer);
        expect(leido.decodificado).toBe(codigo);
    });
});

describe('calcularVtoImpreso (D12)', () => {
    it('hoy + 7 días cuando cae antes del vencimiento real', () => {
        const hoy = new Date('2026-09-14T15:00:00.000Z'); // 14/09 en AR
        const vencimientoReal = new Date('2026-10-27T00:00:00.000Z');
        expect(calcularVtoImpreso(vencimientoReal, hoy)).toBe('21/09/2026');
    });

    it('el vencimiento real como tope cuando hoy + 7 días lo supera (clave por vencer en < 7 días)', () => {
        const hoy = new Date('2026-09-14T15:00:00.000Z');
        const vencimientoReal = new Date('2026-09-18T00:00:00.000Z'); // vence en 4 días
        expect(calcularVtoImpreso(vencimientoReal, hoy)).toBe('18/09/2026');
    });

    it('exactamente 7 días: el candidato y el real coinciden', () => {
        const hoy = new Date('2026-09-14T15:00:00.000Z');
        const vencimientoReal = new Date('2026-09-21T00:00:00.000Z');
        expect(calcularVtoImpreso(vencimientoReal, hoy)).toBe('21/09/2026');
    });

    it('cruce de fin de mes: hoy + 7 días pasa a octubre', () => {
        const hoy = new Date('2026-09-26T15:00:00.000Z'); // 26/09 en AR
        const vencimientoReal = new Date('2026-12-31T00:00:00.000Z');
        // 26/09 + 7 = 03/10
        expect(calcularVtoImpreso(vencimientoReal, hoy)).toBe('03/10/2026');
    });

    it('cruce de fin de mes con el vencimiento real como tope', () => {
        const hoy = new Date('2026-09-26T15:00:00.000Z');
        const vencimientoReal = new Date('2026-09-30T00:00:00.000Z'); // vence antes de los 7 días
        expect(calcularVtoImpreso(vencimientoReal, hoy)).toBe('30/09/2026');
    });

    it('la hora AR (UTC-3) importa: 14/09 23:30 UTC ya es 14/09 en Argentina, no 15/09', () => {
        const hoy = new Date('2026-09-14T23:30:00.000Z');
        const vencimientoReal = new Date('2026-10-27T00:00:00.000Z');
        expect(calcularVtoImpreso(vencimientoReal, hoy)).toBe('21/09/2026');
    });
});

describe('esClaveVencida (D9)', () => {
    it('false el mismo día del vencimiento: todavía se puede pagar', () => {
        const hoy = new Date('2026-10-27T15:00:00.000Z');
        expect(esClaveVencida(new Date('2026-10-27T00:00:00.000Z'), hoy)).toBe(false);
    });

    it('true un día después del vencimiento', () => {
        const hoy = new Date('2026-10-28T02:00:00.000Z'); // 27/10 23:00 AR — todavía 27 en AR
        expect(esClaveVencida(new Date('2026-10-27T00:00:00.000Z'), hoy)).toBe(false);
        const hoyYaVencida = new Date('2026-10-28T15:00:00.000Z'); // 28/10 en AR
        expect(esClaveVencida(new Date('2026-10-27T00:00:00.000Z'), hoyYaVencida)).toBe(true);
    });

    it('false antes del vencimiento', () => {
        expect(esClaveVencida(new Date('2026-10-27T00:00:00.000Z'), new Date('2026-09-14T15:00:00.000Z'))).toBe(false);
    });
});
