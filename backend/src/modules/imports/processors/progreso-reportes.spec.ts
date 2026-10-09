/**
 * La secuencia de reportes de progreso por categoría (docs/imports-progreso-realtime-spec.md §9.9.2 D).
 *
 * Processors reales, cada uno con un `prisma` falso mínimo —como en sus specs— y un `ctx.progreso` que
 * graba las llamadas. Se afirma lo que el processor INFORMA (nombres de subfase, en orden; "N de M"
 * creciente; contadores), no lo que hace: eso lo cubren los specs de cada processor, que no se tocan.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AccionesProcessor } from './acciones.processor';
import { ActualizacionesProcessor } from './actualizaciones.processor';
import { DeudoresProcessor } from './deudores.processor';
import { DeudoresYFacturasProcessor } from './deudores-facturas.processor';
import { FacturasProcessor } from './facturas.processor';
import { MultiarchivoProcessor } from './multiarchivo.processor';
import { MulticlavesProcessor } from './multiclaves.processor';
import { MultirregistroProcessor } from './multirregistro.processor';
import { PagosProcessor } from './pagos.processor';
import { ProcessContext, ReporteProgreso } from './processor.interface';
import { SUBFASE, consolidarConProgreso } from '../utils/reporte-progreso';
import { _resetCacheSituacionesCerradas } from '../utils/situaciones-cerradas';

beforeEach(() => _resetCacheSituacionesCerradas());

type Llamada =
    | { t: 'filas'; n: number }
    | { t: 'sub'; nombre: string; hecho?: number; total?: number }
    | { t: 'cont'; nuevos?: number; actualizados?: number };

function espia() {
    const llamadas: Llamada[] = [];
    const progreso: ReporteProgreso = {
        filasDelLote: (n) => { llamadas.push({ t: 'filas', n }); },
        subfase: (nombre, hecho, total) => { llamadas.push({ t: 'sub', nombre, hecho, total }); },
        contadores: (c) => { llamadas.push({ t: 'cont', ...c }); },
    };
    const subs = () => llamadas.filter((l): l is Extract<Llamada, { t: 'sub' }> => l.t === 'sub');
    /** Nombres de subfase en el orden en que aparecen por primera vez. */
    const nombres = () => [...new Set(subs().map((s) => s.nombre))];
    /** "hecho" de un paso, en orden. */
    const hechoDe = (nombre: string) => subs().filter((s) => s.nombre === nombre && s.hecho != null).map((s) => s.hecho);
    const totalDe = (nombre: string) => subs().find((s) => s.nombre === nombre && s.total != null)?.total;
    const filas = () => llamadas.filter((l): l is Extract<Llamada, { t: 'filas' }> => l.t === 'filas').map((l) => l.n);
    const conts = () => llamadas.filter((l): l is Extract<Llamada, { t: 'cont' }> => l.t === 'cont');
    return { llamadas, progreso, subs, nombres, hechoDe, totalDe, filas, conts };
}

/** `consolidar` que informa como el real: por tandas, con `onProgress`. */
function consolidarQueInforma(total = 1200) {
    return jest.fn().mockImplementation(async (_scope: unknown, opts?: { onProgress?: (a: number, t: number) => void }) => {
        opts?.onProgress?.(500, total);
        opts?.onProgress?.(1000, total);
        return { aSIT050: 0, aSIT041: 0, evaluados: total, conPagos: 0 };
    });
}

const GES_094 = 94;
const SIT_050 = 50;
const GESTION = 200;

/** Contexto base para los processors de deudores/casos. */
function ctxBase(prisma: any, over: Partial<ProcessContext> = {}) {
    const { progreso, ...e } = espia();
    const ctx = {
        prisma,
        remesaId: 10,
        remesaOrigenId: 5,
        empresaId: 1,
        usuarioId: 9,
        defaults: { estadoSituacionId: 100, estadoGestionId: GESTION },
        consolidacion: { consolidar: consolidarQueInforma() },
        promesas: { cerrarCumplidas: jest.fn().mockResolvedValue(undefined) },
        auditoria: { log: jest.fn().mockResolvedValue(undefined) },
        identidadDeudor: 'DOCUMENTO',
        montoDeudorDesdeFacturas: 'SI_VACIO',
        modoActualizacion: 'RECONCILIAR',
        comportamientoDeudaMayor: 'FACTURA_NUEVA',
        crearNuevosCasos: true,
        accionAusente: 'DESASIGNAR',
        progreso,
        ...over,
    } as unknown as ProcessContext;
    return { ctx, ...e };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('consolidarConProgreso', () => {
    it('sin canal de reporte la llamada es EXACTAMENTE la de siempre: un solo argumento', async () => {
        const consolidar = jest.fn().mockResolvedValue({ ok: true });
        const ctx = { consolidacion: { consolidar } } as unknown as ProcessContext;
        const r = await consolidarConProgreso(ctx, { tipo: 'DEUDORES', deudorIds: [1] }, SUBFASE.CONSOLIDANDO_CASOS);
        expect(r).toEqual({ ok: true });
        expect(consolidar).toHaveBeenCalledTimes(1);
        expect(consolidar.mock.calls[0]).toEqual([{ tipo: 'DEUDORES', deudorIds: [1] }]);
        expect(consolidar.mock.calls[0]).toHaveLength(1);
    });

    it('con canal: anuncia el paso y reenvía onProgress como "N de M"', async () => {
        const e = espia();
        const consolidar = consolidarQueInforma(900);
        const ctx = { consolidacion: { consolidar }, progreso: e.progreso } as unknown as ProcessContext;
        await consolidarConProgreso(ctx, { tipo: 'REMESA', remesaId: 5 }, SUBFASE.CONSOLIDANDO_REMESA_ORIGEN);
        expect(e.subs().map((s) => [s.nombre, s.hecho, s.total])).toEqual([
            ['Consolidando la remesa de origen', undefined, undefined],
            ['Consolidando la remesa de origen', 500, 900],
            ['Consolidando la remesa de origen', 1000, 900],
        ]);
        expect(consolidar.mock.calls[0][1]).toEqual({ onProgress: expect.any(Function) });
    });

    it('los nombres de subfase son los del diseño', () => {
        expect(Object.values(SUBFASE).sort()).toEqual([
            'Buscando pagos de estas claves',
            'Cerrando ausentes',
            'Cerrando promesas cumplidas',
            'Consolidando casos',
            'Consolidando casos con pagos',
            'Consolidando casos tocados',
            'Consolidando la remesa de la carga',
            'Consolidando la remesa de origen',
            'Desasignando ausentes',
            'Guardando datos para revertir',
            'Recalculando importes',
            'Uniendo datos adicionales',
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('ACTUALIZACIONES', () => {
    function prismaAct(opts: { cartera?: Map<string, any>; listado?: any[]; deudoresMonto?: any[] } = {}) {
        const cartera = opts.cartera ?? new Map<string, any>();
        let siguienteId = 5000;
        const findMany = jest.fn().mockImplementation(({ where, select }: any) => {
            if (where?.documento?.in) return Promise.resolve((where.documento.in as string[]).map((d) => cartera.get(d)).filter(Boolean));
            if (where?.nroCliente?.in) return Promise.resolve([]);
            if (select?.montoTotal) return Promise.resolve(opts.deudoresMonto ?? []);
            return Promise.resolve(opts.listado ?? []);
        });
        return {
            parametro: {
                findUnique: jest.fn().mockImplementation(({ where }: any) =>
                    Promise.resolve(where.clave === 'GES-094' ? { id: GES_094 } : where.clave === 'SIT-050' ? { id: SIT_050 } : null)),
                findFirst: jest.fn().mockResolvedValue({ id: GESTION }),
                findMany: jest.fn().mockImplementation(({ where }: any) =>
                    Promise.resolve(where?.categoria === 'CANCELADO' ? [{ id: SIT_050 }] : [{ id: GESTION }, { id: 210 }])),
            },
            deudor: {
                findMany,
                findUnique: jest.fn().mockResolvedValue(null),
                findFirst: jest.fn().mockResolvedValue(null),
                update: jest.fn().mockResolvedValue({}),
                create: jest.fn().mockImplementation(({ data }: any) =>
                    Promise.resolve({ id: siguienteId++, documento: data.documento, nroCliente: null, nombre: '', apellido: '', camposAdicionales: null, estadoGestionId: GESTION, estadoGestionPrevioAId: null, estadoSituacionId: 100 })),
            },
            contacto: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }), upsert: jest.fn().mockResolvedValue({}) },
            factura: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({}) },
            pago: { create: jest.fn().mockResolvedValue({}), aggregate: jest.fn().mockResolvedValue({ _sum: { importe: 0 } }) },
            $queryRaw: jest.fn().mockResolvedValue([]),
            $transaction: jest.fn((arr: any[]) => Promise.all(arr)),
        };
    }
    const deudorCartera = (i: number) => ({
        id: i, documento: String(20000000 + i), nroCliente: null, nombre: 'N', apellido: 'A', camposAdicionales: null,
        estadoGestionId: GESTION, estadoGestionPrevioAId: null, estadoSituacionId: 100,
    });
    const estadoInterno = (proc: ActualizacionesProcessor, s: Record<string, unknown>) => Object.assign(proc as any, s);

    it('desasignar: Desasignando ausentes (N de M creciente, de a 500) → origen → carga → promesas si hubo pagos', async () => {
        const listado = Array.from({ length: 1200 }, (_, i) => ({ id: i + 2, estadoGestionId: 210, estadoSituacionId: 100 }));
        const { ctx, nombres, hechoDe, totalDe } = ctxBase(prismaAct({ listado }));
        const proc = new ActualizacionesProcessor();
        estadoInterno(proc, { sawReconciliationData: true, matchedExistingCount: 1, processedDeudorIds: new Set([1]), pagosDeudorIds: new Set([1]) });

        await proc.afterAll(ctx);

        expect(nombres()).toEqual([
            'Desasignando ausentes', 'Consolidando la remesa de origen', 'Consolidando la remesa de la carga', 'Cerrando promesas cumplidas',
        ]);
        expect(totalDe('Desasignando ausentes')).toBe(1200);
        expect(hechoDe('Desasignando ausentes')).toEqual([0, 500, 1000, 1200]);
        // Lo que informa `consolidar` llega como "N de M".
        expect(hechoDe('Consolidando la remesa de origen')).toEqual([500, 1000]);
        expect(totalDe('Consolidando la remesa de origen')).toBe(1200);
        expect(ctx.promesas.cerrarCumplidas).toHaveBeenCalledTimes(1);
    });

    it('desasignar sin pagos: no hay "Cerrando promesas cumplidas"; y sin segunda remesa, no hay "de la carga"', async () => {
        const { ctx, nombres } = ctxBase(prismaAct({ listado: [] }), { remesaId: 5 });
        const proc = new ActualizacionesProcessor();
        estadoInterno(proc, { sawReconciliationData: true, matchedExistingCount: 1, processedDeudorIds: new Set([1]) });

        await proc.afterAll(ctx);

        // Anuncia el paso aunque no haya a quién desasignar: el siguiente lo reemplaza.
        expect(nombres()).toEqual(['Desasignando ausentes', 'Consolidando la remesa de origen']);
        expect(ctx.promesas.cerrarCumplidas).not.toHaveBeenCalled();
    });

    it('pagó todo: "Cerrando ausentes", N de M sobre los deudores de la remesa de origen, informando cada 200', async () => {
        const deudoresMonto = Array.from({ length: 450 }, (_, i) => ({ id: i + 2, montoTotal: 0 }));
        const { ctx, nombres, hechoDe, totalDe } = ctxBase(prismaAct({ deudoresMonto }), { accionAusente: 'PAGO_TODO' });
        const proc = new ActualizacionesProcessor();
        estadoInterno(proc, { sawReconciliationData: true, matchedExistingCount: 1, processedDeudorIds: new Set([1]) });

        await proc.afterAll(ctx);

        expect(nombres()).toEqual(['Cerrando ausentes', 'Consolidando la remesa de origen', 'Consolidando la remesa de la carga']);
        expect(totalDe('Cerrando ausentes')).toBe(450);
        expect(hechoDe('Cerrando ausentes')).toEqual([0, 200, 400]);
    });

    it('por lote: filasDelLote creciente, nunca mayor que el lote; contadores con altas y existentes', async () => {
        const cartera = new Map<string, any>();
        for (let i = 0; i < 200; i++) cartera.set(String(20000000 + i), deudorCartera(i + 1));
        const { ctx, filas, conts } = ctxBase(prismaAct({ cartera }), { modoActualizacion: 'SOLO_DATOS' });
        const proc = new ActualizacionesProcessor();
        const rows = Array.from({ length: 250 }, (_, i) => ({ idx: i, row: { documento: String(20000000 + i), nombre: 'N' } as any }));

        const errores = await proc.processBatch(rows, ctx);

        expect(errores).toEqual([]);
        expect(filas()).toEqual([100, 200]);
        filas().forEach((n) => expect(n).toBeLessThanOrEqual(rows.length));
        const ultimo = conts()[conts().length - 1];
        expect(ultimo).toMatchObject({ nuevos: 50, actualizados: 200 });
    });

    it('en RECONCILIAR la mitad del avance es la reconciliación de deuda: nunca supera el lote', async () => {
        const cartera = new Map<string, any>();
        for (let i = 0; i < 250; i++) cartera.set(String(20000000 + i), deudorCartera(i + 1));
        const { ctx, filas } = ctxBase(prismaAct({ cartera }));
        const proc = new ActualizacionesProcessor();
        jest.spyOn(proc as any, 'reconciliarDeudor').mockResolvedValue(undefined);
        const rows = Array.from({ length: 250 }, (_, i) => ({ idx: i, row: { documento: String(20000000 + i) } as any }));

        await proc.processBatch(rows, ctx);

        expect(filas()).toEqual([50, 100, 175, 225]);
        filas().forEach((n) => expect(n).toBeLessThanOrEqual(rows.length));
    });

    it('sin ctx.progreso, consolidar se llama con un solo argumento', async () => {
        const { ctx } = ctxBase(prismaAct({ listado: [] }), { progreso: undefined });
        const proc = new ActualizacionesProcessor();
        estadoInterno(proc, { sawReconciliationData: true, matchedExistingCount: 1, processedDeudorIds: new Set([1]) });
        await proc.afterAll(ctx);
        const llamadas = (ctx.consolidacion.consolidar as jest.Mock).mock.calls;
        expect(llamadas.length).toBeGreaterThan(0);
        llamadas.forEach((c) => expect(c).toHaveLength(1));
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('PAGOS', () => {
    it('Consolidando casos con pagos → Cerrando promesas cumplidas; nunca informa contadores', async () => {
        const e = espia();
        const ctx = {
            prisma: { importerror: { create: jest.fn().mockResolvedValue({}) } },
            remesaId: 10, empresaId: 1,
            consolidacion: { consolidar: consolidarQueInforma(3) },
            promesas: { cerrarCumplidas: jest.fn().mockResolvedValue(undefined) },
            progreso: e.progreso,
        } as unknown as ProcessContext;
        const proc = new PagosProcessor();
        (proc as any).processedDeudorIds = new Set([1, 2, 3]);

        await proc.afterAll(ctx);

        expect(e.nombres()).toEqual(['Consolidando casos con pagos', 'Cerrando promesas cumplidas']);
        expect(e.conts()).toHaveLength(0);
        expect(e.filas()).toHaveLength(0);
        expect((ctx.consolidacion.consolidar as jest.Mock).mock.calls[0][0]).toEqual({ tipo: 'DEUDORES', deudorIds: [1, 2, 3] });
    });

    it('sin deudores con pagos consolida la remesa y no cierra promesas', async () => {
        const e = espia();
        const ctx = {
            prisma: {}, remesaId: 10, remesaOrigenId: 5, empresaId: 1,
            consolidacion: { consolidar: consolidarQueInforma(3) },
            promesas: { cerrarCumplidas: jest.fn() },
            progreso: e.progreso,
        } as unknown as ProcessContext;
        await new PagosProcessor().afterAll(ctx);
        expect(e.nombres()).toEqual(['Consolidando casos con pagos']);
        expect(ctx.promesas.cerrarCumplidas).not.toHaveBeenCalled();
    });

    it('el processor no tiene ninguna llamada a contadores ni a filasDelLote (sus números son otros: Fase C)', () => {
        const fuente = fs.readFileSync(path.join(__dirname, 'pagos.processor.ts'), 'utf8');
        expect(fuente).not.toMatch(/progreso\??\.contadores|progreso\??\.filasDelLote/);
    });

    it('sin ctx.progreso, consolidar se llama con un solo argumento', async () => {
        const ctx = {
            prisma: {}, remesaId: 10, empresaId: 1,
            consolidacion: { consolidar: jest.fn().mockResolvedValue({}) },
            promesas: { cerrarCumplidas: jest.fn().mockResolvedValue(undefined) },
        } as unknown as ProcessContext;
        const proc = new PagosProcessor();
        (proc as any).processedDeudorIds = new Set([1]);
        await proc.afterAll(ctx);
        expect((ctx.consolidacion.consolidar as jest.Mock).mock.calls[0]).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FACTURAS', () => {
    function prismaFacturas() {
        return {
            deudor: {
                findMany: jest.fn().mockImplementation(({ where }: any) => {
                    if (where?.nroCliente?.in) return Promise.resolve((where.nroCliente.in as string[]).map((n) => ({ id: Number(n), nroCliente: n })));
                    return Promise.resolve([{ id: 1, camposAdicionales: null }]);
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            $executeRaw: jest.fn().mockResolvedValue(1),
        };
    }

    it('filasDelLote por tanda de 500 del upsert en bloque, creciente y sin pasarse del lote', async () => {
        const { ctx, filas } = ctxBase(prismaFacturas());
        const proc = new FacturasProcessor();
        const f = new Date('2026-01-01');
        const rows = Array.from({ length: 1200 }, (_, i) => ({
            idx: i,
            row: { nro_cliente: String(i + 1), nroFactura: `F${i}`, importe: 10, fechaEmision: f, vencimiento: f } as any,
        }));

        const errores = await proc.processBatch(rows, ctx);

        expect(errores).toEqual([]);
        expect(filas()).toEqual([500, 1000, 1200]);
    });

    it('afterAll: Recalculando importes → Consolidando casos → Uniendo datos adicionales', async () => {
        const e = ctxBase(prismaFacturas(), { montoDeudorDesdeFacturas: 'SIEMPRE' });
        const proc = new FacturasProcessor();
        const rows = [
            { idx: 0, row: { nro_cliente: '1', nroFactura: 'F1', importe: 10, fechaEmision: new Date(), vencimiento: new Date(), camposAdicionales: { zona: 'N' } } as any },
        ];
        await proc.processBatch(rows, e.ctx);

        await proc.afterAll(e.ctx);

        expect(e.nombres()).toEqual(['Recalculando importes', 'Consolidando casos', 'Uniendo datos adicionales']);
        expect(e.hechoDe('Recalculando importes')).toEqual([0, 1]);
        expect(e.totalDe('Uniendo datos adicionales')).toBe(1);
    });

    it('con el modo NO del importe no hay recálculo ni consolidación: no se informa un paso que no corre', async () => {
        const e = ctxBase(prismaFacturas(), { montoDeudorDesdeFacturas: 'NO' });
        const proc = new FacturasProcessor();
        await proc.processBatch([{ idx: 0, row: { nro_cliente: '1', nroFactura: 'F1', importe: 1, fechaEmision: new Date(), vencimiento: new Date() } as any }], e.ctx);
        await proc.afterAll(e.ctx);
        expect(e.nombres()).toEqual([]);
    });

    it('sin ctx.progreso, consolidar se llama con un solo argumento', async () => {
        const e = ctxBase(prismaFacturas(), { progreso: undefined });
        const proc = new FacturasProcessor();
        await proc.processBatch([{ idx: 0, row: { nro_cliente: '1', nroFactura: 'F1', importe: 1, fechaEmision: new Date(), vencimiento: new Date() } as any }], e.ctx);
        await proc.afterAll(e.ctx);
        (e.ctx.consolidacion.consolidar as jest.Mock).mock.calls.forEach((c) => expect(c).toHaveLength(1));
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
/** Un `prisma` donde `deudor.findFirst` resuelve por documento: los "ya existentes" están en `existentes`. */
function prismaDeudores(existentes: Record<string, number> = {}) {
    const porDoc = new Map(Object.entries(existentes));
    let siguiente = 1000;
    return {
        deudor: {
            findFirst: jest.fn().mockImplementation(({ where }: any) => {
                const id = porDoc.get(String(where.documento));
                return Promise.resolve(id != null ? { id } : null);
            }),
            update: jest.fn().mockResolvedValue({}),
            create: jest.fn().mockImplementation(({ data }: any) => {
                const id = siguiente++;
                porDoc.set(String(data.documento), id);
                return Promise.resolve({ id });
            }),
        },
        contacto: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }), upsert: jest.fn() },
        factura: { upsert: jest.fn().mockResolvedValue({}) },
        $executeRaw: jest.fn().mockResolvedValue(1),
    };
}

describe('DEUDORES_Y_FACTURAS', () => {
    it('tres filas del mismo caso nuevo: nuevos 1 y actualizados no se informa; el afterAll recalcula y consolida', async () => {
        const e = ctxBase(prismaDeudores());
        const proc = new DeudoresYFacturasProcessor();

        for (const nombre of ['A', 'B', 'C']) await proc.processRow({ documento: '111', nombre } as any, e.ctx);
        await proc.afterAll(e.ctx);

        const cs = e.conts();
        expect(cs[cs.length - 1]).toEqual({ t: 'cont', nuevos: 1 });
        expect(e.conts().every((c) => c.actualizados === undefined)).toBe(true);
        expect(e.nombres()).toEqual(['Recalculando importes', 'Consolidando casos']);
    });

    it('una fila sobre un caso que ya estaba en la remesa NO cuenta como actualizado: "ya existía" dentro de una remesa nueva da siempre 0 y confunde', async () => {
        const e = ctxBase(prismaDeudores({ '222': 77 }));
        await new DeudoresYFacturasProcessor().processRow({ documento: '222', nombre: 'A' } as any, e.ctx);
        expect(e.conts().pop()).toEqual({ t: 'cont', nuevos: 0 });
    });
});

describe('DEUDORES', () => {
    it('crea → nuevos; una fila sobre un caso que ya estaba o sobre uno creado por esta carga no suma nada; nunca informa actualizados', async () => {
        const e = ctxBase(prismaDeudores({ '333': 55 }));
        const proc = new DeudoresProcessor();

        await proc.processRow({ documento: '111', nombre: 'A' } as any, e.ctx);
        expect(e.conts().pop()).toEqual({ t: 'cont', nuevos: 1 });
        await proc.processRow({ documento: '111', nombre: 'A2' } as any, e.ctx); // identidad repetida en el archivo
        expect(e.conts().pop()).toEqual({ t: 'cont', nuevos: 1 });
        await proc.processRow({ documento: '333', nombre: 'B' } as any, e.ctx);
        expect(e.conts().pop()).toEqual({ t: 'cont', nuevos: 1 });
        expect(e.conts().every((c) => c.actualizados === undefined)).toBe(true);
    });

    it('no tiene subfases', async () => {
        const e = ctxBase(prismaDeudores());
        const proc = new DeudoresProcessor();
        await proc.processRow({ documento: '111' } as any, e.ctx);
        await proc.afterAll(e.ctx);
        expect(e.subs()).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('MULTIRREGISTRO y MULTIARCHIVO (casos de cedente)', () => {
    function prismaCedente(cartera: any[] = []) {
        return {
            parametro: {
                findUnique: jest.fn().mockImplementation(({ where }: any) =>
                    Promise.resolve({ 'GES-090': { id: 90 }, 'SIT-071': { id: 71 }, 'GES-094': { id: GES_094 }, 'SIT-050': { id: SIT_050 } }[where.clave as string] ?? null)),
                findMany: jest.fn().mockImplementation(({ where }: any) =>
                    Promise.resolve(where?.categoria === 'CANCELADO' ? [{ id: SIT_050 }] : [GESTION, 210, 90, GES_094].map((id) => ({ id })))),
            },
            deudor: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue(cartera),
                create: jest.fn().mockResolvedValue({ id: 777 }),
                update: jest.fn().mockResolvedValue({}),
            },
            factura: {
                findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}),
                aggregate: jest.fn().mockResolvedValue({ _sum: { importe: 0 }, _count: 1 }), count: jest.fn().mockResolvedValue(0),
            },
            contacto: { createMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]) },
            pago: { create: jest.fn().mockResolvedValue({}) },
            $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.resolve(ops)),
        };
    }
    const caso = { _tipo: 'CASO', nroCliente: '488744', documento: '27179395431', nombre: 'X', camposAdicionales: {}, _blocks: [] };

    it('MULTIARCHIVO: contadores con altas y actualizados; sin desasignar, solo "Consolidando casos tocados"', async () => {
        const e = ctxBase(prismaCedente(), { multiarchivoConfig: { bajas: { motivosPagoIds: ['1'], motivosPago: ['Pago de Cuota'] } } } as any);
        const proc = new MultiarchivoProcessor();

        await proc.processRow(caso as any, e.ctx);
        expect(e.conts().pop()).toMatchObject({ nuevos: 1, actualizados: 0 });
        await proc.afterAll!(e.ctx);

        expect(e.nombres()).toEqual(['Consolidando casos tocados']);
    });

    it('MULTIARCHIVO: "Desasignando ausentes" solo con la plantilla en desasignar, N de M de a 500, antes de consolidar', async () => {
        const cartera = [
            { id: 777, estadoGestionId: 210, estadoSituacionId: null },
            ...Array.from({ length: 700 }, (_, i) => ({ id: 1000 + i, estadoGestionId: 210, estadoSituacionId: null })),
        ];
        const e = ctxBase(prismaCedente(cartera), {
            plantillaId: 7,
            multiarchivoConfig: { accionAusente: 'DESASIGNAR', bajas: { motivosPagoIds: ['1'], motivosPago: ['Pago de Cuota'] } },
        } as any);
        const proc = new MultiarchivoProcessor();

        await proc.processRow(caso as any, e.ctx); // crea el 777
        await proc.afterAll!(e.ctx);

        expect(e.nombres()).toEqual(['Desasignando ausentes', 'Consolidando casos tocados']);
        expect(e.hechoDe('Desasignando ausentes')).toEqual([0, 500, 700]);
        expect(e.totalDe('Desasignando ausentes')).toBe(700);
    });

    it('MULTIRREGISTRO: contadores y cierre de promesas solo si hubo pagos', async () => {
        const e = ctxBase(prismaCedente(), { multirregistroConfig: { baj: { codigo: 'BAJ', aviso: 2, motivosPago: ['Pago de Cuota'] } } } as any);
        const prisma = e.ctx.prisma as any;
        const proc = new MultirregistroProcessor();
        await proc.processRow({ _tipo: 'CASO', nroCliente: '346395', nombre: 'X', camposAdicionales: {}, _blocks: [] } as any, e.ctx);
        prisma.factura.findMany.mockResolvedValue([{ id: 11, deudorId: 555, importe: 100 }]);
        await proc.processRow({ _tipo: 'BAJA', aviso: '1', motivo: 'Pago de Cuota' } as any, e.ctx);

        await proc.afterAll!(e.ctx);

        expect(e.conts().pop()).toMatchObject({ nuevos: 1, actualizados: 0 });
        expect(e.nombres()).toEqual(['Consolidando casos tocados', 'Cerrando promesas cumplidas']);
    });

    it('sin ctx.progreso, consolidar se llama con un solo argumento', async () => {
        const e = ctxBase(prismaCedente(), { progreso: undefined, multiarchivoConfig: { bajas: { motivosPagoIds: ['1'], motivosPago: ['Pago de Cuota'] } } } as any);
        const proc = new MultiarchivoProcessor();
        await proc.processRow(caso as any, e.ctx);
        await proc.afterAll!(e.ctx);
        (e.ctx.consolidacion.consolidar as jest.Mock).mock.calls.forEach((c) => expect(c).toHaveLength(1));
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('MULTICLAVES', () => {
    function prismaClaves(convenios: number, deudorIdsConPago: number[]) {
        return {
            clave_pago: {
                count: jest.fn().mockResolvedValue(convenios),
                findMany: jest.fn().mockResolvedValue(Array.from({ length: convenios }, (_, i) => ({ nroConvenio: `C${i}`, nroTramite: `T${i}`, empresaId: 1 }))),
            },
            deudor: { findMany: jest.fn().mockResolvedValue([]) },
            pago: { findMany: jest.fn().mockResolvedValue(deudorIdsConPago.map((deudorId) => ({ deudorId }))) },
        };
    }

    it('Buscando pagos de estas claves (de a 1.000) → Consolidando casos con pagos solo si hay pagos; ni filasDelLote ni contadores', async () => {
        const e = ctxBase(prismaClaves(2500, [5]));
        await new MulticlavesProcessor().afterAll!(e.ctx);
        expect(e.nombres()).toEqual(['Buscando pagos de estas claves', 'Consolidando casos con pagos']);
        expect(e.hechoDe('Buscando pagos de estas claves')).toEqual([0, 1000, 2000, 2500]);
        expect(e.totalDe('Buscando pagos de estas claves')).toBe(2500);
        expect(e.filas()).toHaveLength(0);
        expect(e.conts()).toHaveLength(0);
    });

    it('sin pagos huérfanos no hay paso de consolidación', async () => {
        const e = ctxBase(prismaClaves(10, []));
        await new MulticlavesProcessor().afterAll!(e.ctx);
        expect(e.nombres()).toEqual(['Buscando pagos de estas claves']);
    });

    it('el processor no informa filasDelLote ni contadores (resuelve el lote en una transacción)', () => {
        const fuente = fs.readFileSync(path.join(__dirname, 'multiclaves.processor.ts'), 'utf8');
        expect(fuente).not.toMatch(/progreso\??\.contadores|progreso\??\.filasDelLote/);
    });

    it('sin ctx.progreso, consolidar se llama con un solo argumento', async () => {
        const e = ctxBase(prismaClaves(10, [5]), { progreso: undefined });
        await new MulticlavesProcessor().afterAll!(e.ctx);
        expect((e.ctx.consolidacion.consolidar as jest.Mock).mock.calls[0]).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('ACCIONES', () => {
    it('Guardando datos para revertir: N de M sobre los snapshots, de a 500', async () => {
        const e = ctxBase({ accion_masiva_snapshot: { createMany: jest.fn().mockResolvedValue({ count: 0 }) } });
        const proc = new AccionesProcessor();
        (proc as any).snapshots = Array.from({ length: 1100 }, (_, i) => ({ remesaId: 10, entidad: 'deudor', entidadId: i, accion: 'UPDATE', datosPrevios: {} }));

        await proc.afterAll(e.ctx);

        expect(e.nombres()).toEqual(['Guardando datos para revertir']);
        expect(e.hechoDe('Guardando datos para revertir')).toEqual([0, 500, 1000, 1100]);
        expect(e.totalDe('Guardando datos para revertir')).toBe(1100);
        expect(e.conts()).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('CONTACTOS y ENRIQUECIMIENTO', () => {
    it.each(['contactos.processor.ts', 'enriquecimiento.processor.ts'])('%s no llama a progreso (no se tocó)', (archivo) => {
        const fuente = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
        expect(fuente).not.toMatch(/\bprogreso\b/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('un ctx.progreso que tira', () => {
    it('el reporte se hace con ?. y el flujo del processor no depende de él: lo ataja el tracker, no el processor', async () => {
        // El contrato (§9.4.4 regla 2) es que `ctx.progreso` NO tira: lo garantiza el runner (FB-15). Acá se
        // fija lo que el processor SÍ garantiza: que no hace nada con el valor de retorno de un reporte.
        const e = ctxBase(prismaDeudores());
        (e.ctx.progreso as any).contadores = jest.fn(() => undefined);
        await new DeudoresProcessor().processRow({ documento: '111', nombre: 'A' } as any, e.ctx);
        expect(e.ctx.prisma.deudor.create).toHaveBeenCalledTimes(1);
    });

    it('sin ctx.progreso los processors de casos corren igual (el campo es opcional)', async () => {
        const e = ctxBase(prismaDeudores(), { progreso: undefined });
        await expect(new DeudoresProcessor().processRow({ documento: '111', nombre: 'A' } as any, e.ctx)).resolves.toBeUndefined();
        await expect(new DeudoresYFacturasProcessor().processRow({ documento: '222', nombre: 'A' } as any, e.ctx)).resolves.toBeUndefined();
    });
});
