import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import {
    anchoTotal,
    crearStreamAnchoFijo,
    inferirColumnasAnchoFijo,
    parseLineaAnchoFijo,
    validarColumnasAnchoFijo,
} from './ancho-fijo';
import { ColumnaAnchoFijo } from '../mapping-types';
import { AYSA_CUENTAS_ANCHO_FIJO, AYSA_PARTIDAS_ANCHO_FIJO } from '../plantillas/aysa';

/** Layout mínimo para los tests unitarios: código(3) · nombre(10) · importe(8). */
const COLS: ColumnaAnchoFijo[] = [
    { nombre: 'cod', inicio: 0, largo: 3 },
    { nombre: 'nombre', inicio: 3, largo: 10 },
    { nombre: 'importe', inicio: 13, largo: 8 },
];

/** Corre un buffer por el stream y devuelve las filas emitidas. */
async function correr(
    contenido: Buffer,
    cfg: Parameters<typeof crearStreamAnchoFijo>[0],
    opts?: Parameters<typeof crearStreamAnchoFijo>[1],
    trozo = 1024,
): Promise<string[][]> {
    const filas: string[][] = [];
    const origen = new Readable({
        read() {
            for (let i = 0; i < contenido.length; i += trozo) {
                this.push(contenido.subarray(i, i + trozo));
            }
            this.push(null);
        },
    });
    await new Promise<void>((resolve, reject) => {
        origen
            .pipe(crearStreamAnchoFijo(cfg, opts))
            .on('data', (f: string[]) => filas.push(f))
            .on('error', reject)
            .on('end', resolve);
    });
    return filas;
}

describe('parseLineaAnchoFijo', () => {
    it('corta por posición y trimea el relleno', () => {
        expect(parseLineaAnchoFijo('001PEREZ     12345.67', COLS)).toEqual(['001', 'PEREZ', '12345.67']);
    });

    it('conserva los ceros a la izquierda, que son parte de la clave', () => {
        expect(parseLineaAnchoFijo('001000003662688 ', [{ nombre: 'cta', inicio: 3, largo: 12 }]))
            .toEqual(['000003662688']);
    });

    it('devuelve vacío en las columnas que la línea no alcanza a cubrir', () => {
        // SAP recorta la cola de la línea cuando los últimos campos vienen vacíos.
        expect(parseLineaAnchoFijo('001PEREZ', COLS)).toEqual(['001', 'PEREZ', '']);
    });

    it('devuelve vacío en los campos que son solo relleno', () => {
        expect(parseLineaAnchoFijo('001          12345.67', COLS)).toEqual(['001', '', '12345.67']);
    });

    it('respeta el orden declarado, que es el índice que usa el mapeo', () => {
        const alReves = [...COLS].reverse();
        expect(parseLineaAnchoFijo('001PEREZ     12345.67', alReves)).toEqual(['12345.67', 'PEREZ', '001']);
    });
});

describe('validarColumnasAnchoFijo', () => {
    it('acepta un layout válido', () => {
        expect(() => validarColumnasAnchoFijo(COLS)).not.toThrow();
    });

    it('rechaza un layout vacío', () => {
        expect(() => validarColumnasAnchoFijo([])).toThrow(/no declara ninguna columna/);
        expect(() => validarColumnasAnchoFijo(undefined)).toThrow(/no declara ninguna columna/);
    });

    it('nombra la columna con problema en vez de fallar en genérico', () => {
        expect(() => validarColumnasAnchoFijo([{ nombre: 'importe', inicio: -1, largo: 8 }]))
            .toThrow(/"importe".*inicio inválido/);
        expect(() => validarColumnasAnchoFijo([{ nombre: 'importe', inicio: 0, largo: 0 }]))
            .toThrow(/"importe".*largo inválido/);
        expect(() => validarColumnasAnchoFijo([{ nombre: '  ', inicio: 0, largo: 3 }]))
            .toThrow(/#1 .*no tiene nombre/);
    });

    it('rechaza posiciones no enteras (un decimal corre todas las columnas siguientes)', () => {
        expect(() => validarColumnasAnchoFijo([{ nombre: 'cod', inicio: 1.5, largo: 3 }]))
            .toThrow(/inicio inválido/);
    });

    it('acepta columnas que se solapan: declarar un campo y una parte de él es legítimo', () => {
        expect(() => validarColumnasAnchoFijo([
            { nombre: 'fecha', inicio: 0, largo: 10 },
            { nombre: 'año', inicio: 6, largo: 4 },
        ])).not.toThrow();
    });
});

describe('anchoTotal', () => {
    it('devuelve la posición final más lejana, no la suma de los largos', () => {
        expect(anchoTotal(COLS)).toBe(21);
        expect(anchoTotal([{ nombre: 'a', inicio: 0, largo: 10 }, { nombre: 'b', inicio: 2, largo: 3 }])).toBe(10);
    });
});

describe('crearStreamAnchoFijo', () => {
    const cfg = { columnas: COLS };

    it('emite un array por fila, igual que fast-csv con headers:false', async () => {
        const contenido = Buffer.from(
            'codnombre    importe \n001PEREZ     12345.67\n002GOMEZ         0.50\n',
            'latin1',
        );
        expect(await correr(contenido, cfg, { tieneHeader: true })).toEqual([
            ['001', 'PEREZ', '12345.67'],
            ['002', 'GOMEZ', '0.50'],
        ]);
    });

    it('sin header, la primera línea ya es dato', async () => {
        const contenido = Buffer.from('001PEREZ     12345.67\n', 'latin1');
        expect(await correr(contenido, cfg, { tieneHeader: false })).toEqual([['001', 'PEREZ', '12345.67']]);
    });

    it('descarta las líneas en blanco (los TXT cierran con un salto final)', async () => {
        const contenido = Buffer.from('001PEREZ     12345.67\n\n   \n002GOMEZ         0.50\n\n', 'latin1');
        expect(await correr(contenido, cfg, { tieneHeader: false })).toHaveLength(2);
    });

    it('soporta CRLF', async () => {
        const contenido = Buffer.from('001PEREZ     12345.67\r\n002GOMEZ         0.50\r\n', 'latin1');
        expect(await correr(contenido, cfg, { tieneHeader: false })).toEqual([
            ['001', 'PEREZ', '12345.67'],
            ['002', 'GOMEZ', '0.50'],
        ]);
    });

    it('emite la última línea aunque el archivo no termine en salto de línea', async () => {
        const contenido = Buffer.from('001PEREZ     12345.67\n002GOMEZ         0.50', 'latin1');
        expect(await correr(contenido, cfg, { tieneHeader: false })).toHaveLength(2);
    });

    it('no parte filas cuando el chunk corta una línea al medio', async () => {
        const lineas = Array.from({ length: 50 }, (_, i) =>
            `${String(i).padStart(3, '0')}NOMBRE${String(i).padStart(4, '0')}${String(i).padStart(8)}`,
        );
        const contenido = Buffer.from(lineas.join('\n'), 'latin1');
        // 7 bytes por chunk: ninguna frontera cae en un salto de línea.
        const filas = await correr(contenido, cfg, { tieneHeader: false }, 7);
        expect(filas).toHaveLength(50);
        expect(filas[49][0]).toBe('049');
    });

    it('lee Latin-1 por default: las Ñ y los acentos del cedente no se rompen', async () => {
        const contenido = Buffer.from('001LARRAÑAGA 12345.67\n', 'latin1');
        const filas = await correr(contenido, { columnas: COLS }, { tieneHeader: false });
        expect(filas[0][1]).toBe('LARRAÑAGA');
    });

    it('lee UTF-8 cuando la plantilla lo declara, con el carácter partido entre chunks', async () => {
        const contenido = Buffer.from('001LARRAÑAGA 12345.67\n', 'utf8');
        // El byte 0xC3 de la Ñ queda al final de un chunk y el 0xB1 al principio del siguiente.
        const filas = await correr(contenido, { encoding: 'utf8', columnas: COLS }, { tieneHeader: false }, 9);
        expect(filas[0][1]).toBe('LARRAÑAGA');
    });

    it('falla al construirse si el layout está roto, no a mitad del archivo', () => {
        expect(() => crearStreamAnchoFijo({ columnas: [] })).toThrow(/no declara ninguna columna/);
    });
});

describe('inferirColumnasAnchoFijo', () => {
    it('propone los cortes donde hay espacio en el encabezado y en todas las filas', () => {
        const contenido = [
            'cod nombre     importe ',
            '001 PEREZ         12.50',
            '002 GOMEZ        999.00',
        ].join('\n');
        expect(inferirColumnasAnchoFijo(contenido)).toEqual([
            { nombre: 'cod', inicio: 0, largo: 4 },
            { nombre: 'nombre', inicio: 4, largo: 11 },
            { nombre: 'importe', inicio: 15, largo: 8 },
        ]);
    });

    it('no corta donde el encabezado tiene texto aunque los datos tengan espacio', () => {
        // "nombre" es una sola columna: el hueco después de PEREZ es relleno, no un separador.
        const cols = inferirColumnasAnchoFijo(['codnombre    ', '001PEREZ     '].join('\n'));
        expect(cols.map((c) => c.nombre)).toEqual(['codnombre']);
    });

    it('desambigua los nombres repetidos, que en AYSA son las dos direcciones', () => {
        const contenido = [
            'calle      calle      ',
            'SANTAFE    CORRIENTES ',
        ].join('\n');
        expect(inferirColumnasAnchoFijo(contenido).map((c) => c.nombre)).toEqual(['calle', 'calle (2)']);
    });

    it('nombra columna_N las que no tienen encabezado', () => {
        const cols = inferirColumnasAnchoFijo('001 PEREZ', { tieneHeader: false });
        expect(cols.map((c) => c.nombre)).toEqual(['columna_1', 'columna_2']);
    });

    it('devuelve vacío si no hay filas de datos', () => {
        expect(inferirColumnasAnchoFijo('')).toEqual([]);
        expect(inferirColumnasAnchoFijo('solo el header')).toEqual([]);
    });

    it('el layout que infiere cubre la línea entera, sin huecos entre columnas', () => {
        const contenido = ['cod nombre     importe ', '001 PEREZ         12.50'].join('\n');
        const cols = inferirColumnasAnchoFijo(contenido);
        let prev = 0;
        for (const c of cols) {
            expect(c.inicio).toBe(prev);
            prev = c.inicio + c.largo;
        }
    });
});

/**
 * Verificación contra los archivos reales del cedente. Es la prueba que importa: valida el layout
 * contra el formato de verdad, no contra el que creemos que es. Si el paquete no está presente
 * (otra máquina, CI) el bloque se saltea en vez de fallar.
 */
const DIR_REAL = '/home/maxi/Documentos/Ana Maya SA/Aysa/sscc 1028 Ana Maya';
const CUENTAS_REAL = 'AGAEJ0_cuentas_EJ_9000001028_129_20260622_121047.txt';
const PARTIDAS_REAL = 'AGAEJ0_partidas_EJ_9000001028_129_20260622_121047.txt';
const hayPaquete = [CUENTAS_REAL, PARTIDAS_REAL].every((f) => fs.existsSync(path.join(DIR_REAL, f)));

(hayPaquete ? describe : describe.skip)('ancho-fijo — archivos reales de AYSA (2026-06-22)', () => {
    const leer = (f: string) => fs.readFileSync(path.join(DIR_REAL, f));
    const header = (f: string) => leer(f).toString('latin1').split(/\r?\n/)[0];

    it('el layout de cuentas cierra exacto con el ancho del encabezado', () => {
        expect(anchoTotal(AYSA_CUENTAS_ANCHO_FIJO.columnas)).toBe(header(CUENTAS_REAL).length);
        expect(anchoTotal(AYSA_CUENTAS_ANCHO_FIJO.columnas)).toBe(1006);
    });

    it('el layout de partidas cierra exacto con el ancho del encabezado', () => {
        expect(anchoTotal(AYSA_PARTIDAS_ANCHO_FIJO.columnas)).toBe(header(PARTIDAS_REAL).length);
        expect(anchoTotal(AYSA_PARTIDAS_ANCHO_FIJO.columnas)).toBe(274);
    });

    it('los dos layouts son contiguos: no dejan ningún tramo del archivo sin declarar', () => {
        for (const cfg of [AYSA_CUENTAS_ANCHO_FIJO, AYSA_PARTIDAS_ANCHO_FIJO]) {
            let prev = 0;
            for (const c of cfg.columnas) {
                expect({ nombre: c.nombre, inicio: c.inicio }).toEqual({ nombre: c.nombre, inicio: prev });
                prev = c.inicio + c.largo;
            }
        }
    });

    it('cada columna de cuentas cae sobre su rótulo del encabezado', () => {
        const h = header(CUENTAS_REAL);
        // Excepciones deliberadas: el rótulo neutro del distrito y los nombres desambiguados de la
        // segunda dirección, que el cedente repite tal cual.
        const renombradas = new Set([
            'Distrito / División', 'Nombre de calle (postal)', 'Nro.puer. (postal)',
            'Nro. Anterior (postal)', 'Nro.piso (postal)', 'Nro.dpto. (postal)',
            'Cod. Pos. (postal)', 'Localidad (postal)',
        ]);
        for (const c of AYSA_CUENTAS_ANCHO_FIJO.columnas) {
            if (renombradas.has(c.nombre)) continue;
            expect({ n: c.nombre, h: h.slice(c.inicio, c.inicio + c.largo).trim() })
                .toEqual({ n: c.nombre, h: c.nombre });
        }
    });

    it('cada columna de partidas cae sobre su rótulo del encabezado', () => {
        const h = header(PARTIDAS_REAL);
        for (const c of AYSA_PARTIDAS_ANCHO_FIJO.columnas) {
            if (c.nombre === 'Distrito / División') continue;
            expect({ n: c.nombre, h: h.slice(c.inicio, c.inicio + c.largo).trim() })
                .toEqual({ n: c.nombre, h: c.nombre });
        }
    });

    it('lee el archivo de cuentas entero con los datos en su lugar', async () => {
        const filas = await correr(leer(CUENTAS_REAL), AYSA_CUENTAS_ANCHO_FIJO, { tieneHeader: true });
        const idx = (n: string) => AYSA_CUENTAS_ANCHO_FIJO.columnas.findIndex((c) => c.nombre === n);

        expect(filas).toHaveLength(115);
        expect(filas[0][idx('Of. Cobro')]).toBe('9000001028');
        expect(filas[0][idx('Cta. Cto.')]).toBe('000003667638');
        expect(filas[0][idx('Denominación IC')]).toBe('NOEMI ROSA LEMA');
        expect(filas[0][idx('Correo Electrónico')]).toBe('m.rosamolina@yahoo.com.ar');
        // Toda la cartera de este archivo está vigente: el discriminador de novedad es K.
        expect(new Set(filas.map((f) => f[idx('Nov.')]))).toEqual(new Set(['K']));
        // La cuenta contrato es la clave del caso: única en el archivo.
        expect(new Set(filas.map((f) => f[idx('Cta. Cto.')])).size).toBe(filas.length);
    });

    it('lee el archivo de partidas y sus importes suman el asignado de la cuenta', async () => {
        const cuentas = await correr(leer(CUENTAS_REAL), AYSA_CUENTAS_ANCHO_FIJO, { tieneHeader: true });
        const partidas = await correr(leer(PARTIDAS_REAL), AYSA_PARTIDAS_ANCHO_FIJO, { tieneHeader: true });

        const iC = (n: string) => AYSA_CUENTAS_ANCHO_FIJO.columnas.findIndex((c) => c.nombre === n);
        const iP = (n: string) => AYSA_PARTIDAS_ANCHO_FIJO.columnas.findIndex((c) => c.nombre === n);

        const sumaPorCuenta = new Map<string, number>();
        for (const p of partidas) {
            const k = p[iP('Cta. Cto.')];
            sumaPorCuenta.set(k, (sumaPorCuenta.get(k) ?? 0) + Number(p[iP('Importe')]));
        }

        // El cruce no deja huérfanas en ninguno de los dos sentidos: es lo que valida el layout.
        const claves = new Set(cuentas.map((c) => c[iC('Cta. Cto.')]));
        expect([...sumaPorCuenta.keys()].filter((k) => !claves.has(k))).toEqual([]);
        expect([...claves].filter((k) => !sumaPorCuenta.has(k))).toEqual([]);

        const coinciden = cuentas.filter(
            (c) => Math.abs((sumaPorCuenta.get(c[iC('Cta. Cto.')]) ?? 0) - Number(c[iC('Imp. Asignado')])) < 0.02,
        );
        expect(coinciden).toHaveLength(cuentas.length);
    });

    it('el par (cuenta, documento) es único: sirve como número de factura', async () => {
        const partidas = await correr(leer(PARTIDAS_REAL), AYSA_PARTIDAS_ANCHO_FIJO, { tieneHeader: true });
        const iP = (n: string) => AYSA_PARTIDAS_ANCHO_FIJO.columnas.findIndex((c) => c.nombre === n);
        const pares = partidas.map((p) => `${p[iP('Cta. Cto.')]}|${p[iP('Nro. docum.')]}`);
        expect(new Set(pares).size).toBe(pares.length);
    });

    it('el inferidor acierta la mayoría de los cortes del archivo real', async () => {
        const inferidas = inferirColumnasAnchoFijo(leer(PARTIDAS_REAL));
        const reales = new Set(AYSA_PARTIDAS_ANCHO_FIJO.columnas.map((c) => c.inicio));
        const aciertos = inferidas.filter((c) => reales.has(c.inicio)).length;
        // No acierta el 100% —los campos pegados en encabezado y datos quedan fusionados—, por eso
        // el resultado es editable. Pero tiene que dejar poco para corregir a mano.
        expect(aciertos / reales.size).toBeGreaterThan(0.6);
    });
});
