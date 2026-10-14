import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { conOrigen, ErrorDeParseo, FilaLeida, recorrerFilas } from './recorrer-filas';
import { AYSA_CUENTAS_ANCHO_FIJO } from '../plantillas/aysa';

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorrer-filas-'));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Escribe un archivo temporal y devuelve su path. */
const escribir = (nombre: string, contenido: string, encoding: BufferEncoding = 'latin1'): string => {
    const p = path.join(dir, nombre);
    fs.writeFileSync(p, Buffer.from(contenido, encoding));
    return p;
};

/** Recorre y junta las filas. */
async function juntar(opts: Parameters<typeof recorrerFilas>[0]) {
    const filas: FilaLeida[] = [];
    const total = await recorrerFilas(opts, (f) => { filas.push(f); });
    return { filas, total };
}

const CSV = { tieneHeader: true, separador: ';' };

describe('recorrerFilas — un solo archivo', () => {
    it('lee un delimitado con encabezado y devuelve arrays por índice', async () => {
        const p = escribir('uno.csv', 'cod;nombre\n001;PEREZ\n002;GOMEZ\n');
        const { filas, total } = await juntar({ paths: [p], ...CSV });

        expect(total).toBe(2);
        expect(filas.map((f) => f.valores)).toEqual([['001', 'PEREZ'], ['002', 'GOMEZ']]);
    });

    it('no pone origen cuando hay un solo archivo: los mensajes de error no cambian', async () => {
        const p = escribir('solo.csv', 'cod;nombre\n001;PEREZ\n');
        const { filas } = await juntar({ paths: [p], ...CSV });

        expect(filas[0].origen).toBeNull();
        expect(conOrigen('Campo requerido faltante: documento', null))
            .toBe('Campo requerido faltante: documento');
    });

    it('sin encabezado, la primera línea ya es dato', async () => {
        const p = escribir('sin-header.csv', '001;PEREZ\n002;GOMEZ\n');
        const { total } = await juntar({ paths: [p], tieneHeader: false, separador: ';' });

        expect(total).toBe(2);
    });

    it('devuelve 0 y no falla con un archivo que solo tiene encabezado', async () => {
        const p = escribir('vacio.csv', 'cod;nombre\n');
        expect((await juntar({ paths: [p], ...CSV })).total).toBe(0);
    });
});

describe('recorrerFilas — varios archivos del mismo formato', () => {
    it('los recorre como si fueran uno solo, en orden, con el índice acumulado', async () => {
        const a = escribir('a.csv', 'cod;nombre\n001;PEREZ\n002;GOMEZ\n');
        const b = escribir('b.csv', 'cod;nombre\n003;LOPEZ\n');

        const { filas, total } = await juntar({ paths: [a, b], ...CSV });

        expect(total).toBe(3);
        expect(filas.map((f) => f.valores[0])).toEqual(['001', '002', '003']);
        expect(filas.map((f) => f.indice)).toEqual([0, 1, 2]);
    });

    it('saltea el encabezado de cada archivo, no solo el del primero', async () => {
        const a = escribir('h1.csv', 'cod;nombre\n001;PEREZ\n');
        const b = escribir('h2.csv', 'cod;nombre\n002;GOMEZ\n');

        const { filas } = await juntar({ paths: [a, b], ...CSV });

        expect(filas.map((f) => f.valores[0])).toEqual(['001', '002']);
    });

    it('el origen dice archivo y posición dentro de ese archivo, no el índice global', async () => {
        const a = escribir('cuentas_003.txt', 'cod;nombre\n001;PEREZ\n002;GOMEZ\n');
        const b = escribir('cuentas_006.txt', 'cod;nombre\n003;LOPEZ\n');

        const { filas } = await juntar({ paths: [a, b], ...CSV });

        expect(filas.map((f) => f.origen)).toEqual([
            'cuentas_003.txt:1', 'cuentas_003.txt:2', 'cuentas_006.txt:1',
        ]);
    });

    it('usa el nombre con el que se subió el archivo, no el del disco', async () => {
        // En `uploads/` los archivos quedan como `<timestamp>_<hash>.txt`.
        const a = escribir('1754820000_abc123.txt', 'cod;nombre\n001;PEREZ\n');
        const b = escribir('1754820001_def456.txt', 'cod;nombre\n002;GOMEZ\n');

        const { filas } = await juntar({
            paths: [a, b],
            nombres: ['AGAEJ0_cuentas_003.txt', 'AGAEJ0_cuentas_006.txt'],
            ...CSV,
        });

        expect(filas.map((f) => f.origen)).toEqual([
            'AGAEJ0_cuentas_003.txt:1', 'AGAEJ0_cuentas_006.txt:1',
        ]);
    });

    it('un archivo vacío en el medio no corta el recorrido ni corre los índices', async () => {
        const a = escribir('c1.csv', 'cod;nombre\n001;PEREZ\n');
        const vacio = escribir('c2.csv', 'cod;nombre\n');
        const c = escribir('c3.csv', 'cod;nombre\n002;GOMEZ\n');

        const { filas, total } = await juntar({ paths: [a, vacio, c], ...CSV });

        expect(total).toBe(2);
        expect(filas.map((f) => f.origen)).toEqual(['c1.csv:1', 'c3.csv:1']);
    });

    it('conOrigen antepone el archivo al mensaje de error', () => {
        expect(conOrigen('Deudor no encontrado (nro_cliente=000003662688)', 'partidas_072.txt:8891'))
            .toBe('[partidas_072.txt:8891] Deudor no encontrado (nro_cliente=000003662688)');
    });
});

describe('recorrerFilas — pausa del stream', () => {
    it('espera a que resuelva el callback antes de seguir leyendo', async () => {
        // Es lo que le permite al worker procesar un lote antes de acumular el siguiente.
        const p = escribir('lote.csv', `cod\n${Array.from({ length: 50 }, (_, i) => i).join('\n')}\n`);

        let enVuelo = 0;
        let maxEnVuelo = 0;
        const orden: number[] = [];

        await recorrerFilas({ paths: [p], tieneHeader: true, separador: ';' }, async (f) => {
            maxEnVuelo = Math.max(maxEnVuelo, ++enVuelo);
            await new Promise((r) => setImmediate(r));
            orden.push(Number(f.valores[0]));
            enVuelo--;
        });

        expect(maxEnVuelo).toBe(1);
        expect(orden).toEqual(Array.from({ length: 50 }, (_, i) => i));
    });

    it('propaga el error del callback en vez de tragárselo', async () => {
        const p = escribir('falla.csv', 'cod\n001\n002\n');

        await expect(
            recorrerFilas({ paths: [p], tieneHeader: true, separador: ';' }, async () => {
                throw new Error('explotó el lote');
            }),
        ).rejects.toThrow('explotó el lote');
    });
});

describe('recorrerFilas — ancho fijo', () => {
    const COLS = {
        columnas: [
            { nombre: 'cod', inicio: 0, largo: 3 },
            { nombre: 'nombre', inicio: 3, largo: 10 },
        ],
    };

    it('corta por posición y el separador de la plantilla se ignora', async () => {
        const p = escribir('fijo.txt', 'codnombre    \n001PEREZ     \n002GOMEZ     \n');

        const { filas } = await juntar({
            paths: [p], tieneHeader: true, separador: ';', anchoFijo: COLS,
        });

        expect(filas.map((f) => f.valores)).toEqual([['001', 'PEREZ'], ['002', 'GOMEZ']]);
    });

    it('junta varios archivos de ancho fijo con el origen de cada uno', async () => {
        const a = escribir('suc003.txt', 'codnombre    \n001PEREZ     \n');
        const b = escribir('suc006.txt', 'codnombre    \n002GOMEZ     \n');

        const { filas, total } = await juntar({
            paths: [a, b], tieneHeader: true, separador: ';', anchoFijo: COLS,
        });

        expect(total).toBe(2);
        expect(filas.map((f) => f.origen)).toEqual(['suc003.txt:1', 'suc006.txt:1']);
    });

    it('respeta el encoding de la plantilla', async () => {
        const p = escribir('utf.txt', 'codnombre    \n001LARRAÑAGA \n', 'utf8');

        const { filas } = await juntar({
            paths: [p], tieneHeader: true, separador: ';',
            anchoFijo: { ...COLS, encoding: 'utf8' },
        });

        expect(filas[0].valores[1]).toBe('LARRAÑAGA');
    });
});

/**
 * El caso que motivó todo esto: los 31 TXT que manda AYSA por bajada, recorridos como una sola
 * remesa. Se saltea si el paquete no está en la máquina.
 */
const DIR_AYSA = '/home/maxi/Documentos/Ana Maya SA/Aysa/sscc 1028 Ana Maya';
const cuentasAysa = fs.existsSync(DIR_AYSA)
    ? fs.readdirSync(DIR_AYSA).filter((f) => f.startsWith('AGAEJ0_cuentas')).map((f) => path.join(DIR_AYSA, f))
    : [];

(cuentasAysa.length ? describe : describe.skip)('recorrerFilas — los 31 TXT de cuentas de AYSA', () => {
    it('los lee como una sola remesa de 21.335 casos', async () => {
        const { filas, total } = await juntar({
            paths: cuentasAysa,
            tieneHeader: true,
            separador: ';',
            anchoFijo: AYSA_CUENTAS_ANCHO_FIJO,
        });

        expect(cuentasAysa).toHaveLength(31);
        expect(total).toBe(21335);

        // La cuenta contrato es única en toda la cartera, no solo dentro de cada sucursal: es lo que
        // permite cargarla como un único `nroCliente`.
        const iCta = AYSA_CUENTAS_ANCHO_FIJO.columnas.findIndex((c) => c.nombre === 'Cta. Cto.');
        expect(new Set(filas.map((f) => f.valores[iCta])).size).toBe(total);
    });

    it('cada fila sabe de qué sucursal salió', async () => {
        const { filas } = await juntar({
            paths: cuentasAysa,
            tieneHeader: true,
            separador: ';',
            anchoFijo: AYSA_CUENTAS_ANCHO_FIJO,
        });

        const iDist = AYSA_CUENTAS_ANCHO_FIJO.columnas.findIndex((c) => c.nombre === 'Distrito / División');
        // El número de sucursal del nombre del archivo tiene que ser el de la columna de la fila.
        for (const f of filas) {
            const enNombre = /_(\d{3})_\d{8}_/.exec(f.origen ?? '')?.[1];
            expect({ origen: f.origen, suc: enNombre }).toEqual({ origen: f.origen, suc: f.valores[iDist] });
        }
    });
});


describe('recorrerFilas — encabezados que el cedente manda repetidos', () => {
    /**
     * El archivo de pagos de Telecom Personal manda `PAYMENT_METHOD_DES` en la columna 7 y otra vez
     * en la 9. Con `headers: true`, fast-csv corta con `Duplicate headers found` y la excepción
     * subía sin capturar hasta el controller: la pantalla mostraba "Internal server error" y la
     * remesa quedaba en PENDIENTE con 0 filas (pasó dos veces el 26/08 en producción).
     *
     * El pipeline mapea por índice y nunca usa los nombres de columna, así que la solución es no
     * pedirle a fast-csv que interprete el encabezado.
     */
    it('lee el archivo igual, sin importar que dos columnas se llamen igual', async () => {
        const p = escribir(
            'dup.csv',
            'gestor;cuenta;metodo;cust;metodo;cobrado\n1008;1001693491510001;Efectivo;1001693491510001;Efectivo;68000\n',
        );
        const { filas, total } = await juntar({ paths: [p], ...CSV });

        expect(total).toBe(1);
        expect(filas[0].valores).toEqual([
            '1008', '1001693491510001', 'Efectivo', '1001693491510001', 'Efectivo', '68000',
        ]);
    });

    it('el encabezado no se procesa como fila', async () => {
        const p = escribir('dup2.csv', 'a;a;a\n1;2;3\n4;5;6\n');
        const { total } = await juntar({ paths: [p], ...CSV });

        expect(total).toBe(2);
    });

    it('sin encabezado declarado, la primera línea es un dato más', async () => {
        const p = escribir('sinhdr.csv', '1;2;3\n4;5;6\n');
        const { total } = await juntar({ paths: [p], tieneHeader: false, separador: ';' });

        expect(total).toBe(2);
    });

    it('un error de formato dice de qué archivo salió, para que se pueda devolver como 400', async () => {
        const p = escribir('roto.csv', 'a;b\n"sin cerrar;1\n');
        // El nombre con el que el operador lo subió, no el del temporal.
        const fallo = await juntar({ paths: [p], nombres: ['PAGOS.csv'], ...CSV }).catch((e) => e);

        expect(fallo).toBeInstanceOf(ErrorDeParseo);
        expect(fallo.message).toContain('PAGOS.csv');
    });
});

describe('recorrerFilas — la fila del archivo (`linea`, C3a)', () => {
    it('con encabezado, el primer dato es la línea 2 (el encabezado es la 1)', async () => {
        const p = escribir('linea-h.csv', 'cod;nombre\n001;A\n002;B\n003;C\n');
        const { filas } = await juntar({ paths: [p], ...CSV });
        expect(filas.map((f) => f.linea)).toEqual([2, 3, 4]);
        expect(filas.map((f) => f.indice)).toEqual([0, 1, 2]);
    });

    it('sin encabezado, el primer dato es la línea 1', async () => {
        const p = escribir('linea-sh.csv', '001;A\n002;B\n');
        const { filas } = await juntar({ paths: [p], tieneHeader: false, separador: ';' });
        expect(filas.map((f) => f.linea)).toEqual([1, 2]);
    });

    it('con ancho fijo y encabezado también cuenta el encabezado', async () => {
        const p = escribir('linea-af.txt', 'h1h2\nabcd\nefgh\n');
        const { filas } = await juntar({
            paths: [p],
            tieneHeader: true,
            separador: ';',
            anchoFijo: { columnas: [{ nombre: 'a', inicio: 0, largo: 2 }, { nombre: 'b', inicio: 2, largo: 2 }] },
        });
        expect(filas.map((f) => f.linea)).toEqual([2, 3]);
    });

    describe('ancho fijo con líneas vacías (la línea es la física del archivo)', () => {
        const AF = {
            tieneHeader: true,
            separador: ';',
            anchoFijo: { columnas: [{ nombre: 'a', inicio: 0, largo: 2 }, { nombre: 'b', inicio: 2, largo: 2 }] },
        };

        it('una línea vacía en el medio: las siguientes conservan su línea física', async () => {
            // 1 encabezado, 2 ab, 3 vacía, 4 cd, 5 ef
            const p = escribir('af-medio.txt', 'h1h2\nabxy\n\ncdxy\nefxy\n');
            const { filas } = await juntar({ paths: [p], ...AF });
            expect(filas.map((f) => f.valores[0])).toEqual(['ab', 'cd', 'ef']);
            expect(filas.map((f) => f.linea)).toEqual([2, 4, 5]);
            expect(filas.map((f) => f.indice)).toEqual([0, 1, 2]);
        });

        it('líneas vacías arriba del encabezado y entre los datos (con CRLF)', async () => {
            // 1 vacía, 2 encabezado, 3 ab, 4 vacía, 5 vacía, 6 cd
            const p = escribir('af-arriba.txt', '\r\nh1h2\r\nabxy\r\n\r\n\r\ncdxy\r\n');
            const { filas } = await juntar({ paths: [p], ...AF });
            expect(filas.map((f) => f.valores[0])).toEqual(['ab', 'cd']);
            expect(filas.map((f) => f.linea)).toEqual([3, 6]);
        });

        it('sin encabezado y con una vacía al principio', async () => {
            const p = escribir('af-sh.txt', '\nabxy\ncdxy\n');
            const { filas } = await juntar({ paths: [p], ...AF, tieneHeader: false });
            expect(filas.map((f) => f.linea)).toEqual([2, 3]);
        });

        it('la última línea sin salto final y precedida de una vacía', async () => {
            const p = escribir('af-final.txt', 'h1h2\nabxy\n\ncdxy');
            const { filas } = await juntar({ paths: [p], ...AF });
            expect(filas.map((f) => f.linea)).toEqual([2, 4]);
        });
    });

    it('con dos archivos la línea reinicia en cada uno y el índice no', async () => {
        const a = escribir('dos-a.csv', 'cod;nombre\n001;A\n002;B\n');
        const b = escribir('dos-b.csv', 'cod;nombre\n003;C\n');
        const { filas } = await juntar({ paths: [a, b], ...CSV });
        expect(filas.map((f) => f.linea)).toEqual([2, 3, 2]);
        expect(filas.map((f) => f.indice)).toEqual([0, 1, 2]);
        expect(filas.map((f) => f.origen)).toEqual(['dos-a.csv:1', 'dos-a.csv:2', 'dos-b.csv:1']);
    });

    describe('Excel', () => {
        /** Una hoja con dos filas vacías arriba, el encabezado en la 3, datos en la 4, 6 y 8 (la 5 y la 7 vacías). */
        function hoja(nombre: string, ref: string): string {
            const ws: Record<string, unknown> = {};
            const celda = (a: string, v: string) => { ws[a] = { t: 's', v }; };
            celda('A3', 'cod'); celda('B3', 'nombre');
            celda('A4', 'd4'); celda('B4', 'x4');
            celda('A6', 'd6'); celda('B6', 'x6');
            celda('A8', 'd8'); celda('B8', 'x8');
            ws['!ref'] = ref;
            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, ws as xlsx.WorkSheet, 'H');
            const p = path.join(dir, nombre);
            xlsx.writeFile(wb, p);
            return p;
        }

        it('el rango empieza en la fila 3 (filas vacías arriba): la línea es la fila de la hoja de Excel', async () => {
            const { filas } = await juntar({ paths: [hoja('x-a3.xlsx', 'A3:B8')], tieneHeader: true, separador: ';' });
            const datos = filas.filter((f) => f.valores[0]);
            expect(datos.map((f) => [f.valores[0], f.linea])).toEqual([['d4', 4], ['d6', 6], ['d8', 8]]);
        });

        it('el rango empieza en la fila 1: la línea sigue siendo la de la hoja', async () => {
            const { filas } = await juntar({ paths: [hoja('x-a1.xlsx', 'A1:B8')], tieneHeader: false, separador: ';' });
            const datos = filas.filter((f) => f.valores[0] && f.valores[0] !== 'cod');
            expect(datos.map((f) => [f.valores[0], f.linea])).toEqual([['d4', 4], ['d6', 6], ['d8', 8]]);
        });
    });
});
