/**
 * Errores de una carga: listado paginado con tipo y totales, y CSV en streaming
 * (docs/imports-progreso-c2-spec.md §5.3 y §5.4; casos ER-1 a ER-13 de §10.2 B).
 */
import { Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ErroresQueryDto } from './dtos/import.dto';
import { dobleLecturas } from './doble-prisma-lecturas';
import { ImportService, SalidaCsv } from './imports.service';

beforeAll(() => Logger.overrideLogger(false));

const aviso = (id: number, msg = '[aviso] algo') => ({ id, remesaId: 1, rowNumber: 0, errorMsg: msg, rawRow: null, createdAt: new Date('2026-10-01T10:00:00Z') });
const fila = (id: number, rowNumber: number, msg = 'Monto inválido', rawRow: unknown = ['a', 'b']) => ({
    id, remesaId: 1, rowNumber, errorMsg: msg, rawRow, createdAt: new Date('2026-10-01T10:00:00Z'),
});

function servicio(errores: any[], remesas: any[] = [{ id: 1, numeroRemesa: '00151', progreso: null }]) {
    const d = dobleLecturas({ remesas, errores });
    const svc = new ImportService(d.prisma, null as never, null as never, null as never, null as never, null as never, null as never, null as never, null as never);
    return { svc, d };
}

/** Respuesta falsa: guarda lo escrito; `capacidad` permite simular contrapresión. */
function salida(o: { devuelveFalseEn?: number } = {}) {
    const escrito: string[] = [];
    const eventos = new Map<string, () => void>();
    const res = {
        cabeceras: {} as Record<string, string>,
        destroyed: false,
        writableEnded: false,
        destruida: 0,
        pendientesDrain: 0,
        setHeader(n: string, v: string) { this.cabeceras[n] = v; },
        write(t: string) {
            escrito.push(t);
            if (o.devuelveFalseEn === escrito.length) { this.pendientesDrain++; return false; }
            return true;
        },
        end() { this.writableEnded = true; },
        destroy() { this.destroyed = true; this.destruida++; },
        on(e: string, cb: () => void) { eventos.set(e, cb); },
        off(e: string, cb: () => void) { if (eventos.get(e) === cb) eventos.delete(e); },
    };
    return { res: res as unknown as SalidaCsv & typeof res, escrito, eventos };
}

describe('getErrors', () => {
    const mezcla = () => [
        aviso(1), aviso(2, '[parseo] x'), aviso(3, '[post-proceso] y'),
        fila(4, 0, '[AGNEJ0_EJ_9000001028_IEQ006_20260725.txt:1] Deudor no encontrado para pago (…)'),
        fila(5, 1), fila(6, 2), fila(7, 3), fila(8, 4),
    ];

    it('ER-1: filtra por tipo y los totales son de toda la carga', async () => {
        const { svc } = servicio(mezcla());
        const f = await svc.getErrors(1, { tipo: 'FILA' });
        const a = await svc.getErrors(1, { tipo: 'AVISO' });
        const t = await svc.getErrors(1, { tipo: 'TODOS' });
        expect([f.total, a.total, t.total]).toEqual([5, 3, 8]);
        for (const r of [f, a, t]) expect(r.totales).toEqual({ filas: 5, avisos: 3 });
        expect(f.data[0]).toMatchObject({ rowNumber: 0, tipo: 'FILA', fila: 1 });
        expect(a.data.every((e) => e.tipo === 'AVISO' && e.fila === null)).toBe(true);
    });

    it('ER-2: sin parámetros, las cinco claves de hoy en el mismo orden, más tipo, fila y totales', async () => {
        const { svc } = servicio(mezcla());
        const r = await svc.getErrors(1, { pageSize: 100 });
        expect(Object.keys(r).slice(0, 5)).toEqual(['data', 'total', 'page', 'pageSize', 'totalPages']);
        expect(r.data.map((e) => e.rowNumber)).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
        expect(Object.keys(r.data[0])).toEqual(expect.arrayContaining(['id', 'rowNumber', 'errorMsg', 'rawRow', 'createdAt', 'tipo', 'fila']));
        expect(r.totales).toEqual({ filas: 5, avisos: 3 });
    });

    it('ER-3: con 150 avisos y 20 filas, tipo=FILA y pageSize=100 devuelve las 20', async () => {
        const errores = [...Array.from({ length: 150 }, (_, i) => aviso(i + 1)), ...Array.from({ length: 20 }, (_, i) => fila(1000 + i, i))];
        const { svc } = servicio(errores);
        const r = await svc.getErrors(1, { tipo: 'FILA', pageSize: 100 });
        expect(r.data).toHaveLength(20);
        expect(r.total).toBe(20);
        expect(r.totales).toEqual({ filas: 20, avisos: 150 });
    });

    it('ER-4: orden desc, filas de mayor a menor y avisos por id descendente', async () => {
        const { svc } = servicio(mezcla());
        expect((await svc.getErrors(1, { tipo: 'FILA', orden: 'desc' })).data.map((e) => e.rowNumber)).toEqual([4, 3, 2, 1, 0]);
        expect((await svc.getErrors(1, { tipo: 'AVISO', orden: 'desc' })).data.map((e) => e.id)).toEqual([3, 2, 1]);
    });

    it('ER-5: paginado con rowNumber repetidos, sin repetir ni saltear', async () => {
        const errores = Array.from({ length: 7 }, (_, i) => fila(i + 1, i < 5 ? 0 : 1, `[x:${i}] error`));
        const { svc } = servicio(errores);
        const p1 = await svc.getErrors(1, { page: 1, pageSize: 3 });
        const p2 = await svc.getErrors(1, { page: 2, pageSize: 3 });
        const p3 = await svc.getErrors(1, { page: 3, pageSize: 3 });
        expect([...p1.data, ...p2.data, ...p3.data].map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(p1.totalPages).toBe(3);
    });

    it('ER-6: una remesa sin errores, o que no existe, da lista vacía y totales en 0', async () => {
        const { svc } = servicio([]);
        for (const id of [1, 999]) {
            const r = await svc.getErrors(id, {});
            expect(r.data).toEqual([]);
            expect(r.totales).toEqual({ filas: 0, avisos: 0 });
            expect(r.totalPages).toBe(0);
        }
    });
});

describe('erroresCsv', () => {
    it('ER-7: BOM, encabezado, una línea por registro, ; y \\r\\n; el aviso sin fila ni columnas', async () => {
        const { svc } = servicio([aviso(1), aviso(2, '[parseo] b'), fila(3, 0, 'Falta el DNI', ['=1+1', '-1500,50', 'a;b']), fila(4, 1), fila(5, 2)]);
        const { res, escrito } = salida();
        await svc.erroresCsv(1, 'TODOS', res);
        const texto = escrito.join('');
        expect(texto.startsWith('﻿Tipo;Fila;Mensaje;Contenido de la fila (una columna por campo)\r\n')).toBe(true);
        const lineas = texto.replace('﻿', '').split('\r\n');
        expect(lineas).toHaveLength(7); // encabezado + 5 + cierre vacío
        expect(lineas[1]).toBe('Aviso;;[aviso] algo');
        expect(lineas[3]).toBe('Fila;1;Falta el DNI;\'=1+1;-1500,50;"a;b"');
        expect(lineas[4]).toBe('Fila;2;Monto inválido;a;b');
        expect(res.cabeceras['Content-Type']).toBe('text/csv; charset=utf-8');
        expect(res.cabeceras['Content-Disposition']).toBe('attachment; filename="errores-remesa-00151.csv"');
        expect(res.cabeceras['Cache-Control']).toBe('no-store');
        expect(res.writableEnded).toBe(true);
    });

    it('ER-8: 4.500 registros en tres lecturas de 2.000, cada una con el cursor de la anterior y sin skip', async () => {
        const errores = Array.from({ length: 4500 }, (_, i) => fila(i + 1, Math.floor(i / 3), 'e'));
        const { svc, d } = servicio(errores);
        const { res, escrito } = salida();
        await svc.erroresCsv(1, 'TODOS', res);
        expect(d.lecturasDeErrores).toHaveLength(3);
        for (const l of d.lecturasDeErrores) {
            expect(l.skip).toBeUndefined();
            expect(l.take).toBe(2000);
        }
        expect(d.lecturasDeErrores[0].where).toEqual({ remesaId: 1 });
        expect(d.lecturasDeErrores[1].where).toEqual({
            AND: [{ remesaId: 1 }, { OR: [{ rowNumber: { gt: 666 } }, { rowNumber: 666, id: { gt: 2000 } }] }],
        });
        const lineas = escrito.join('').split('\r\n').filter(Boolean);
        expect(lineas).toHaveLength(4501);
        // El orden total se conserva: filas 1..1500 (rowNumber 0..1499, +1) repetidas de a 3.
        expect(lineas[1]).toBe('Fila;1;e;a;b');
        expect(lineas[4500]).toBe('Fila;1500;e;a;b');
    });

    it('ER-9: con el tope en 3 y 5 registros, tres líneas y el aviso de lo omitido', async () => {
        const { svc } = servicio([fila(1, 0), fila(2, 1), fila(3, 2), fila(4, 3), fila(5, 4)]);
        const { res, escrito } = salida();
        await svc.erroresCsv(1, 'TODOS', res, 3);
        const lineas = escrito.join('').split('\r\n').filter(Boolean);
        expect(lineas).toHaveLength(1 + 3 + 1);
        expect(lineas[4]).toBe('Aviso;;Se omitieron 2 registros: este archivo trae los primeros 3 de 5.');
    });

    it('ER-9 bis: con exactamente el tope de registros no hay aviso de omitidos', async () => {
        const { svc } = servicio([fila(1, 0), fila(2, 1), fila(3, 2)]);
        const { res, escrito } = salida();
        await svc.erroresCsv(1, 'TODOS', res, 3);
        expect(escrito.join('')).not.toContain('Se omitieron');
    });

    it('ER-10: si el cliente cierra la conexión después del primer lote, no hay más lecturas ni error', async () => {
        const errores = Array.from({ length: 4500 }, (_, i) => fila(i + 1, i, 'e'));
        const { svc, d } = servicio(errores);
        const { res } = salida();
        const original = res.write.bind(res);
        let escritas = 0;
        res.write = (t: string) => {
            escritas++;
            const r = original(t);
            if (escritas === 2001) res.destroyed = true; // el encabezado y el lote de 2.000
            return r;
        };
        await expect(svc.erroresCsv(1, 'TODOS', res)).resolves.toBeUndefined();
        expect(d.lecturasDeErrores).toHaveLength(1);
        expect(res.destruida).toBe(0);
    });

    it('ER-11: si la segunda lectura rechaza, el método rechaza, la respuesta se destruye y no se escribe línea de cierre', async () => {
        const errores = Array.from({ length: 4500 }, (_, i) => fila(i + 1, i, 'e'));
        const { svc, d } = servicio(errores);
        const original = d.prisma.importerror.findMany;
        let n = 0;
        d.prisma.importerror.findMany = async (a: unknown) => {
            if (++n === 2) throw new Error('la base se cayó');
            return original(a);
        };
        const { res, escrito } = salida();
        await expect(svc.erroresCsv(1, 'TODOS', res)).rejects.toThrow('la base se cayó');
        expect(res.destruida).toBe(1);
        expect(res.writableEnded).toBe(false);
        expect(escrito).toHaveLength(1 + 2000);
    });

    it('ER-12: de una remesa que no existe tira NotFoundException antes de escribir nada', async () => {
        const { svc } = servicio([]);
        const { res, escrito } = salida();
        await expect(svc.erroresCsv(999, 'TODOS', res)).rejects.toBeInstanceOf(NotFoundException);
        expect(escrito).toEqual([]);
        expect(res.cabeceras).toEqual({});
    });

    it('ER-13: si write devuelve false, no se escribe la línea siguiente hasta el drain', async () => {
        const { svc } = servicio([fila(1, 0), fila(2, 1)]);
        const { res, escrito, eventos } = salida({ devuelveFalseEn: 2 }); // la primera línea de datos
        const terminado = svc.erroresCsv(1, 'TODOS', res);
        await new Promise((r) => setTimeout(r, 20));
        expect(escrito).toHaveLength(2); // BOM+encabezado y la primera fila; la segunda espera
        eventos.get('drain')!();
        await terminado;
        expect(escrito).toHaveLength(3);
    });

    it('tipo=FILA y tipo=AVISO bajan solo lo suyo', async () => {
        const { svc } = servicio([aviso(1), fila(2, 0, '[a.txt:1] x'), fila(3, 1)]);
        const f = salida();
        await svc.erroresCsv(1, 'FILA', f.res);
        expect(f.escrito.join('').split('\r\n').filter(Boolean)).toHaveLength(3);
        const a = salida();
        await svc.erroresCsv(1, 'AVISO', a.res);
        expect(a.escrito.join('').split('\r\n').filter(Boolean)).toHaveLength(2);
    });
});

describe('erroresCsv — escuchas de la contrapresión', () => {
    it('al reanudar por drain no queda ninguna escucha colgada', async () => {
        const { svc } = servicio([fila(1, 0), fila(2, 1), fila(3, 2)]);
        const { res, eventos } = salida({ devuelveFalseEn: 2 });
        const terminado = svc.erroresCsv(1, 'TODOS', res);
        await new Promise((r) => setTimeout(r, 20));
        expect([...eventos.keys()].sort()).toEqual(['close', 'drain']);
        eventos.get('drain')!();
        await terminado;
        expect(eventos.size).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// C3a — la fila del archivo, "los últimos" con avisos y la definición única de aviso
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('getErrors — la fila del archivo (C3a, A2)', () => {
    const conLinea = (id: number, rowNumber: number, linea: number | null) => ({ ...fila(id, rowNumber), linea });

    it('CA-6: con `linea`, fila es la del archivo y filaEsDelArchivo true; el rowNumber no cambia', async () => {
        const { svc } = servicio([conLinea(1, 0, 10)]);
        const [e] = (await svc.getErrors(1, {})).data;
        expect(e).toMatchObject({ rowNumber: 0, fila: 10, filaEsDelArchivo: true, tipo: 'FILA' });
    });

    it('una carga anterior (sin `linea`, o null) da rowNumber + 1 y false', async () => {
        const { svc } = servicio([fila(1, 4), conLinea(2, 5, null)]);
        const r = (await svc.getErrors(1, {})).data;
        expect(r.map((e) => [e.fila, e.filaEsDelArchivo])).toEqual([[5, false], [6, false]]);
    });

    it('un aviso no tiene fila ni siquiera si trae `linea`', async () => {
        const { svc } = servicio([{ ...aviso(1), linea: 7 }]);
        const [e] = (await svc.getErrors(1, {})).data;
        expect(e).toMatchObject({ tipo: 'AVISO', fila: null, filaEsDelArchivo: false });
    });

    it('el CSV lleva la fila del archivo en la columna "Fila" y no cambia de columnas', async () => {
        const { svc } = servicio([conLinea(1, 0, 10), fila(2, 1)]);
        const { res, escrito } = salida();
        await svc.erroresCsv(1, 'TODOS', res);
        const lineas = escrito.join('').replace('﻿', '').split('\r\n');
        expect(lineas[0]).toBe('Tipo;Fila;Mensaje;Contenido de la fila (una columna por campo)');
        expect(lineas[1]).toBe('Fila;10;Monto inválido;a;b');
        expect(lineas[2]).toBe('Fila;2;Monto inválido;a;b');
    });
});

describe('getErrors — reciente (C3a, A3)', () => {
    /** 7 errores de fila (ids 1-4 y 7-9 hasta 9) con 2 avisos intercalados: los ids mezclan los dos tipos. */
    const intercalados = () => [
        fila(1, 0), fila(2, 1), fila(3, 2), aviso(4, '[parseo] a'), fila(5, 3), fila(6, 4), fila(7, 5), aviso(8), fila(9, 6),
    ];

    it('CA-7: los 5 más nuevos por id, con los avisos adentro, y los totales de toda la carga', async () => {
        const { svc } = servicio(intercalados());
        const r = await svc.getErrors(1, { tipo: 'TODOS', orden: 'desc', reciente: true, pageSize: 5 });
        expect(r.data.map((e) => e.id)).toEqual([9, 8, 7, 6, 5]);
        expect(r.data.filter((e) => e.tipo === 'AVISO').map((e) => e.id)).toEqual([8]);
        expect(r.totales).toEqual({ filas: 7, avisos: 2 });
        expect(r.page).toBe(1);
    });

    it('si los avisos son los más viejos no entran: se ve lo que pasó último', async () => {
        const { svc } = servicio([aviso(1), aviso(2), fila(3, 0), fila(4, 1), fila(5, 2), fila(6, 3), fila(7, 4), fila(8, 5)]);
        const r = await svc.getErrors(1, { reciente: true, pageSize: 5 });
        expect(r.data.map((e) => e.id)).toEqual([8, 7, 6, 5, 4]);
    });

    it('pageSize 50 con reciente se acota a 20, y `page` se ignora', async () => {
        const errores = Array.from({ length: 60 }, (_, i) => fila(i + 1, i));
        const { svc } = servicio(errores);
        const r = await svc.getErrors(1, { reciente: true, pageSize: 50, page: 3 });
        expect(r.data).toHaveLength(20);
        expect(r.data[0].id).toBe(60);
        expect(r.page).toBe(1);
        expect(r.pageSize).toBe(20);
    });

    it('no ordena en memoria más de 2 × n registros: cada lectura trae a lo sumo n', async () => {
        const errores = Array.from({ length: 300 }, (_, i) => (i % 10 === 0 ? aviso(i + 1) : fila(i + 1, i)));
        const { svc, d } = servicio(errores);
        await svc.getErrors(1, { reciente: true, pageSize: 5 });
        const recientes = d.lecturasDeErrores.filter((l) => l.take === 5);
        expect(recientes).toHaveLength(2);
        expect(recientes.every((l) => l.skip === undefined)).toBe(true);
    });

    it('con tipo FILA o AVISO lee solo ese tipo', async () => {
        const { svc } = servicio(intercalados());
        const f = await svc.getErrors(1, { tipo: 'FILA', reciente: true, pageSize: 3 });
        const a = await svc.getErrors(1, { tipo: 'AVISO', reciente: true, pageSize: 3 });
        expect(f.data.map((e) => e.id)).toEqual([9, 7, 6]);
        expect(a.data.map((e) => e.id)).toEqual([8, 4]);
    });

    it('sin reciente la respuesta es la de siempre (paginada por rowNumber)', async () => {
        const { svc } = servicio(intercalados());
        const r = await svc.getErrors(1, { orden: 'desc', pageSize: 5 });
        expect(r.data.map((e) => e.rowNumber)).toEqual([6, 5, 4, 3, 2]);
    });
});

describe('ErroresQueryDto — reciente (C3a)', () => {
    const probar = async (q: Record<string, string>) => {
        const dto = plainToInstance(ErroresQueryDto, q);
        return { dto, errores: await validate(dto) };
    };

    it('reciente=true llega como booleano true; reciente=false como false; ausente, undefined', async () => {
        expect((await probar({ reciente: 'true' })).dto.reciente).toBe(true);
        expect((await probar({ reciente: 'false' })).dto.reciente).toBe(false);
        const sin = await probar({ orden: 'desc' });
        expect(sin.dto.reciente).toBeUndefined();
        expect(sin.errores).toHaveLength(0);
    });

    it('reciente=foo se rechaza (400 con el ValidationPipe global)', async () => {
        const { errores } = await probar({ reciente: 'foo' });
        expect(errores).toHaveLength(1);
        expect(errores[0].property).toBe('reciente');
    });
});
