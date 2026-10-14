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
import type { ResumenCategoria } from '../progreso/estado-carga.types';
import { ContactosProcessor } from './contactos.processor';
import { EnriquecimientoProcessor } from './enriquecimiento.processor';
import { SUBFASE, consolidarConProgreso } from '../utils/reporte-progreso';
import { _resetCacheSituacionesCerradas } from '../utils/situaciones-cerradas';

beforeEach(() => _resetCacheSituacionesCerradas());

type Llamada =
    | { t: 'filas'; n: number }
    | { t: 'sub'; nombre: string; hecho?: number; total?: number }
    | { t: 'cont'; nuevos?: number; actualizados?: number };

function espia() {
    const llamadas: Llamada[] = [];
    const resumenes: ResumenCategoria[] = [];
    const progreso: ReporteProgreso = {
        filasDelLote: (n) => { llamadas.push({ t: 'filas', n }); },
        subfase: (nombre, hecho, total) => { llamadas.push({ t: 'sub', nombre, hecho, total }); },
        contadores: (c) => { llamadas.push({ t: 'cont', ...c }); },
        resumen: (r) => { resumenes.push(r); },
    };
    const subs = () => llamadas.filter((l): l is Extract<Llamada, { t: 'sub' }> => l.t === 'sub');
    /** Nombres de subfase en el orden en que aparecen por primera vez. */
    const nombres = () => [...new Set(subs().map((s) => s.nombre))];
    /** "hecho" de un paso, en orden. */
    const hechoDe = (nombre: string) => subs().filter((s) => s.nombre === nombre && s.hecho != null).map((s) => s.hecho);
    const totalDe = (nombre: string) => subs().find((s) => s.nombre === nombre && s.total != null)?.total;
    const filas = () => llamadas.filter((l): l is Extract<Llamada, { t: 'filas' }> => l.t === 'filas').map((l) => l.n);
    const conts = () => llamadas.filter((l): l is Extract<Llamada, { t: 'cont' }> => l.t === 'cont');
    /** El último `resumen` informado (el objeto entero reemplaza al anterior). */
    const ultimoResumen = () => resumenes[resumenes.length - 1];
    return { llamadas, progreso, subs, nombres, hechoDe, totalDe, filas, conts, resumenes, ultimoResumen };
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
    it('C3b: el afterAll ya no abre la subfase "Guardando datos para revertir" ni escribe snapshots (van con cada caso)', async () => {
        const createMany = jest.fn().mockResolvedValue({ count: 0 });
        const e = ctxBase({ accion_masiva_snapshot: { createMany } });
        const proc = new AccionesProcessor();

        await proc.afterAll(e.ctx);

        expect(e.nombres()).toEqual([]);
        expect(createMany).not.toHaveBeenCalled();
        expect(e.conts()).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('CONTACTOS y ENRIQUECIMIENTO', () => {
    it.each(['contactos.processor.ts', 'enriquecimiento.processor.ts'])('%s solo informa el resumen (C3a): ni subfases, ni contadores, ni filas del lote', (archivo) => {
        const fuente = fs.readFileSync(path.join(__dirname, archivo), 'utf8');
        expect(fuente).not.toMatch(/progreso\??\.(contadores|filasDelLote|subfase)/);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// C3a — el resumen por categoría y el control "la base queda idéntica con y sin el canal" (spec C3 §8.1)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Serializa los argumentos de forma estable: sin funciones, con Set/Map/BigInt/Date legibles. */
function estable(valor: unknown): string {
    return JSON.stringify(valor, (_k, v) => {
        if (typeof v === 'function') return undefined;
        if (typeof v === 'bigint') return v.toString();
        if (v instanceof Set) return [...v];
        if (v instanceof Map) return [...v];
        return v;
    });
}

/**
 * Envuelve un objeto de dos niveles (`prisma.modelo.metodo(args)`, o uno de un nivel como `auditoria.log`) con un
 * Proxy que anota cada llamada —`modelo.metodo(args)`— y delega en el original. Con `soloPrimerArg` anota solo el
 * primer argumento (el segundo de `consolidar` es el `onProgress`, que existe solo con el canal).
 */
function grabar<T extends object>(falso: T, prefijo: string, llamadas: string[], soloPrimerArg = false): T {
    const anotar = (nombre: string, args: unknown[]) =>
        llamadas.push(`${prefijo}${nombre}(${estable(soloPrimerArg ? args.slice(0, 1) : args)})`);
    const proxy: T = new Proxy(falso, {
        get(target, prop, receptor) {
            const valor = Reflect.get(target, prop, receptor);
            if (typeof prop !== 'string') return valor;
            if (prop === '$transaction' && typeof valor === 'function') {
                // La transacción interactiva (C3b): el callback recibe este mismo proxy como `tx`, así que lo que escribe
                // adentro también queda grabado, entre un `begin` y un `end`.
                return async (fn: unknown, ...resto: unknown[]) => {
                    // La forma de arreglo (`$transaction([op1, op2])`) sigue grabándose como una llamada más.
                    if (typeof fn !== 'function') {
                        anotar(prop, [fn, ...resto]);
                        return valor.apply(target, [fn, ...resto]);
                    }
                    llamadas.push(`${prefijo}$transaction:begin`);
                    try {
                        return await (fn as (tx: T) => Promise<unknown>)(proxy);
                    } finally {
                        llamadas.push(`${prefijo}$transaction:end`);
                    }
                };
            }
            if (typeof valor === 'function') {
                return (...args: unknown[]) => {
                    anotar(prop, args);
                    return valor.apply(target, args);
                };
            }
            if (valor !== null && typeof valor === 'object') {
                return new Proxy(valor, {
                    get(t2, p2, r2) {
                        const v2 = Reflect.get(t2, p2, r2);
                        if (typeof p2 !== 'string' || typeof v2 !== 'function') return v2;
                        return (...args: unknown[]) => {
                            anotar(`${prop}.${p2}`, args);
                            return v2.apply(t2, args);
                        };
                    },
                });
            }
            return valor;
        },
    });
    return proxy;
}

interface Escenario {
    prisma: () => any;
    ctx?: Partial<ProcessContext>;
    /** Corre el processor completo sobre el contexto armado. `falso` es el prisma sin envolver. */
    correr: (ctx: ProcessContext, falso: any) => Promise<void>;
}

/** Corre el escenario con o sin `ctx.progreso` y devuelve todo lo que el processor le pidió a lo de afuera. */
async function ejecutar(esc: Escenario, conProgreso: boolean) {
    // El catálogo de situaciones cerradas se cachea en el módulo: sin esto la segunda corrida se saltea una lectura.
    _resetCacheSituacionesCerradas();
    const llamadas: string[] = [];
    const falso = esc.prisma();
    const e = ctxBase(grabar(falso, 'prisma.', llamadas), esc.ctx ?? {});
    const ctx = e.ctx;
    (ctx as any).consolidacion = grabar((ctx as any).consolidacion, 'consolidacion.', llamadas, true);
    (ctx as any).promesas = grabar((ctx as any).promesas, 'promesas.', llamadas);
    (ctx as any).auditoria = grabar((ctx as any).auditoria, 'auditoria.', llamadas);
    if (!conProgreso) (ctx as any).progreso = undefined;
    await esc.correr(ctx, falso);
    return { llamadas, resumenes: e.resumenes, ultimo: e.ultimoResumen() };
}

describe('C3a — el canal `resumen` no cambia lo que el processor le pide a la base', () => {
    beforeAll(() => {
        // Los pagos automáticos usan `new Date()`: con la hora quieta las dos corridas dan argumentos idénticos.
        jest.useFakeTimers({
            now: new Date('2026-10-14T12:00:00Z'),
            doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance'],
        });
    });
    afterAll(() => jest.useRealTimers());

    // ── fakes ───────────────────────────────────────────────────────────────────────────────
    const actCartera = (i: number) => ({
        id: i, documento: String(20000000 + i), nroCliente: null, nombre: 'N', apellido: 'A', camposAdicionales: null,
        estadoGestionId: GESTION, estadoGestionPrevioAId: null, estadoSituacionId: 100,
    });
    function prismaActualizaciones(opts: { cartera?: Map<string, any>; deudoresMonto?: any[]; listado?: any[] } = {}) {
        const cartera = opts.cartera ?? new Map<string, any>();
        let siguienteId = 5000;
        return {
            parametro: {
                findUnique: jest.fn().mockImplementation(({ where }: any) =>
                    Promise.resolve(where.clave === 'GES-094' ? { id: GES_094 } : where.clave === 'SIT-050' ? { id: SIT_050 } : null)),
                findFirst: jest.fn().mockResolvedValue({ id: GESTION }),
                findMany: jest.fn().mockImplementation(({ where }: any) =>
                    Promise.resolve(where?.categoria === 'CANCELADO' ? [{ id: SIT_050 }] : [{ id: GESTION }, { id: 210 }])),
            },
            deudor: {
                findMany: jest.fn().mockImplementation(({ where, select }: any) => {
                    if (where?.documento?.in) return Promise.resolve((where.documento.in as string[]).map((d) => cartera.get(d)).filter(Boolean));
                    if (where?.nroCliente?.in) return Promise.resolve([]);
                    if (select?.montoTotal) return Promise.resolve(opts.deudoresMonto ?? []);
                    return Promise.resolve(opts.listado ?? []);
                }),
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

    function prismaFacturasC3() {
        return {
            deudor: {
                findMany: jest.fn().mockImplementation(({ where }: any) => {
                    if (where?.nroCliente?.in) {
                        return Promise.resolve((where.nroCliente.in as string[]).filter((n) => n !== '999').map((n) => ({ id: Number(n), nroCliente: n })));
                    }
                    return Promise.resolve([{ id: 1, camposAdicionales: null }]);
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            $executeRaw: jest.fn().mockResolvedValue(1),
        };
    }

    function prismaContactos() {
        return {
            deudor: { findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(where.documento === '0' ? [] : [{ id: 7 }, { id: 8 }])) },
            contacto: { upsert: jest.fn().mockResolvedValue({}) },
            factura: { upsert: jest.fn().mockResolvedValue({}) },
        };
    }

    function prismaPagos() {
        const pagos: any[] = [];
        return {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
            pago: {
                findFirst: jest.fn().mockImplementation(({ where }: any) =>
                    Promise.resolve(pagos.find((p) =>
                        (where.deudorId?.in ? where.deudorId.in.includes(p.deudorId) : p.deudorId === where.deudorId) &&
                        (where.origen === undefined || p.origen === where.origen) &&
                        (where.confirmadoImport === undefined || p.confirmadoImport === where.confirmadoImport) &&
                        (where.importe === undefined || p.importe === where.importe)) ?? null)),
                create: jest.fn().mockImplementation(({ data }: any) => { pagos.push(data); return Promise.resolve(data); }),
                update: jest.fn().mockResolvedValue({}),
            },
            factura: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            importerror: { create: jest.fn().mockResolvedValue({}) },
        };
    }

    function prismaAcciones() {
        const deudor = (id: number, sit: number) => ({
            id, estadoSituacionId: sit, estadoGestionId: null, motivoNoPagoId: null, nombre: 'X', apellido: '', montoTotal: 100,
            fechaVencimiento: null, nroCliente: String(id), camposAdicionales: null,
        });
        return {
            deudor: {
                findMany: jest.fn().mockImplementation(({ where }: any) => {
                    const id = Number(where?.id ?? where?.nroCliente ?? 0);
                    return Promise.resolve(id === 9 ? [] : [deudor(id, id === 2 ? 50 : 41)]);
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            parametro: { findMany: jest.fn().mockResolvedValue([{ id: 50, clave: 'SIT-050' }]) },
            remesa: { update: jest.fn().mockResolvedValue({}) },
            accion_masiva_snapshot: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
            // La transacción interactiva: el grabador de `grabar` le pasa su propio proxy como `tx`.
            $transaction: jest.fn(),
        };
    }

    function prismaCedenteC3(cartera: any[] = []) {
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
    const casoCedente = (nro: string) => ({ _tipo: 'CASO', nroCliente: nro, documento: `2717939${nro}`, nombre: 'X', camposAdicionales: {}, _blocks: [] }) as any;

    function prismaClavesC3() {
        return {
            clave_pago: {
                count: jest.fn().mockResolvedValue(3),
                findMany: jest.fn().mockResolvedValue([{ nroConvenio: 'C0', nroTramite: 'T0', empresaId: 1 }, { nroConvenio: 'C1', nroTramite: 'T1', empresaId: 1 }]),
            },
            deudor: { findMany: jest.fn().mockResolvedValue([{ nroCliente: 'T0' }]) },
            pago: { findMany: jest.fn().mockResolvedValue([{ deudorId: 5 }]) },
        };
    }

    // ── los escenarios, uno por categoría (ACTUALIZACIONES y MULTI* tienen más de uno) ──────────
    const estado = (proc: unknown, s: Record<string, unknown>) => Object.assign(proc as object, s);
    const filasDeuda = (n: number) => Array.from({ length: n }, (_, i) => ({ idx: i, row: { documento: String(20000000 + i), nombre: 'N' } as any }));

    const escenarios: Record<string, Escenario> = {
        DEUDORES: {
            prisma: () => prismaDeudores({ '333': 55 }),
            correr: async (ctx) => {
                const p = new DeudoresProcessor();
                for (const documento of ['111', '111', '333', '444']) await p.processRow({ documento, nombre: 'A' } as any, ctx);
                await p.afterAll(ctx);
            },
        },
        DEUDORES_Y_FACTURAS: {
            prisma: () => prismaDeudores(),
            correr: async (ctx) => {
                const p = new DeudoresYFacturasProcessor();
                for (const documento of ['111', '111', '222']) {
                    await p.processRow({ documento, nombre: 'A', nroFactura: `F${documento}`, importe: 10 } as any, ctx);
                }
                await p.afterAll(ctx);
            },
        },
        FACTURAS: {
            prisma: () => prismaFacturasC3(),
            ctx: { montoDeudorDesdeFacturas: 'SIEMPRE' } as any,
            correr: async (ctx) => {
                const p = new FacturasProcessor();
                const f = new Date('2026-01-01');
                const rows = ['1', '2', '999'].map((n, i) => ({ idx: i, row: { nro_cliente: n, nroFactura: `F${n}`, importe: 10, fechaEmision: f, vencimiento: f, camposAdicionales: { zona: 'N' } } as any }));
                await p.processBatch(rows, ctx);
                await p.afterAll(ctx);
            },
        },
        CONTACTOS: {
            prisma: () => prismaContactos(),
            correr: async (ctx) => {
                const p = new ContactosProcessor();
                await p.processRow({ documento: '27179395', tipo: 'telefono', valor: '1155551234' } as any, ctx);
                await p.processRow({ documento: '27179396', tipo: 'telefono', valor: 'abc' } as any, ctx);
                await p.afterAll(ctx);
            },
        },
        ENRIQUECIMIENTO: {
            prisma: () => prismaContactos(),
            correr: async (ctx) => {
                const p = new EnriquecimientoProcessor();
                await p.processRow({ documento: '27179395', tipo: 'telefono', valor: '1155551234' } as any, ctx);
                await p.processRow({ documento: '27179396', tipo: 'telefono', valor: 'abc' } as any, ctx);
                await p.afterAll(ctx);
            },
        },
        PAGOS: {
            prisma: () => prismaPagos(),
            correr: async (ctx) => {
                const p = new PagosProcessor();
                const fila = (importe: number, observacion?: string) => ({ nro_cliente: '000003462007', importe, fecha: '2026-07-17', ...(observacion ? { observacion } : {}) }) as any;
                await p.processRow(fila(195.04), ctx);
                await p.processRow(fila(195.04), ctx); // ya cargado
                await p.processRow(fila(-50), ctx);    // negativo
                await p.afterAll(ctx);
            },
        },
        'ACTUALIZACIONES (pagó todo)': {
            prisma: () => prismaActualizaciones({ deudoresMonto: [{ id: 2, montoTotal: 100 }, { id: 3, montoTotal: 0 }, { id: 4, montoTotal: 50 }] }),
            ctx: { accionAusente: 'PAGO_TODO' } as any,
            correr: async (ctx) => {
                const p = new ActualizacionesProcessor();
                estado(p, { sawReconciliationData: true, matchedExistingCount: 1, processedDeudorIds: new Set([1]) });
                await p.afterAll(ctx);
            },
        },
        'ACTUALIZACIONES (desasignar)': {
            prisma: () => prismaActualizaciones({ listado: [{ id: 2, estadoGestionId: 210, estadoSituacionId: 100 }, { id: 3, estadoGestionId: 210, estadoSituacionId: 100 }] }),
            correr: async (ctx) => {
                const p = new ActualizacionesProcessor();
                const cartera = new Map<string, any>([['20000000', actCartera(1)]]);
                (ctx.prisma as any); // la cartera de la base falsa ya viene en el escenario por documento
                void cartera;
                estado(p, { sawReconciliationData: true, matchedExistingCount: 1, processedDeudorIds: new Set([1]), pagosDeudorIds: new Set([1]), reasignadosCount: 1 });
                await p.afterAll(ctx);
            },
        },
        'ACTUALIZACIONES (sin coincidencias)': {
            prisma: () => prismaActualizaciones(),
            ctx: { accionAusente: 'PAGO_TODO' } as any,
            correr: async (ctx) => {
                const p = new ActualizacionesProcessor();
                await p.processBatch(filasDeuda(3).map((r) => ({ ...r, row: { ...r.row, montoTotal: 100 } })), ctx);
                await p.afterAll(ctx);
            },
        },
        ACCIONES: {
            prisma: () => prismaAcciones(),
            ctx: {
                accionesConfig: {
                    matchMode: 'DEUDOR', matchColumn: { field: 'id', fromIndex: 0 }, saltearCanceladas: true,
                    operaciones: [{ tipo: 'SET_CAMPO', campo: 'nombre', modo: 'ESTATICO', valor: 'TOCADO' }],
                },
            } as any,
            correr: async (ctx) => {
                const p = new AccionesProcessor();
                for (const id of [1, 2, 9]) await p.processRow({ _raw: [String(id)] } as any, ctx);
                await p.afterAll(ctx);
            },
        },
        'MULTIRREGISTRO (con bajas por pago y retiradas)': {
            prisma: () => prismaCedenteC3(),
            ctx: { multirregistroConfig: { baj: { codigo: 'BAJ', aviso: 2, motivosPago: ['Pago de Cuota'] } } } as any,
            correr: async (ctx, falso) => {
                const p = new MultirregistroProcessor();
                await p.processRow(casoCedente('346395'), ctx);
                falso.factura.findMany.mockResolvedValue([{ id: 11, deudorId: 555, importe: 100, estado: 'PENDIENTE' }]);
                await p.processRow({ _tipo: 'BAJA', aviso: '1', motivo: 'Pago de Cuota' } as any, ctx);
                falso.factura.findMany.mockResolvedValue([{ id: 12, deudorId: 556, importe: 80, estado: 'PENDIENTE' }]);
                await p.processRow({ _tipo: 'BAJA', aviso: '2', motivo: 'Retiro del cedente' } as any, ctx);
                falso.factura.findMany.mockResolvedValue([]);
                await p.processRow({ _tipo: 'BAJA', aviso: '3', motivo: 'Pago de Cuota' } as any, ctx);
                await p.afterAll!(ctx);
            },
        },
        'MULTIARCHIVO (con bajas por pago y desasignación)': {
            prisma: () => prismaCedenteC3([{ id: 777, estadoGestionId: 210, estadoSituacionId: null }, { id: 1000, estadoGestionId: 210, estadoSituacionId: null }]),
            ctx: { plantillaId: 7, multiarchivoConfig: { accionAusente: 'DESASIGNAR', bajas: { motivosPagoIds: ['1'], motivosPago: ['Pago de Cuota'] } } } as any,
            correr: async (ctx, falso) => {
                const p = new MultiarchivoProcessor();
                await p.processRow(casoCedente('488744'), ctx);
                falso.factura.findMany.mockResolvedValue([{ id: 11, deudorId: 555, importe: 100, estado: 'PENDIENTE' }]);
                await p.processRow({ _tipo: 'BAJA', nroFactura: '1-1', motivo: 'Pago de Cuota' } as any, ctx);
                await p.afterAll!(ctx);
            },
        },
        MULTICLAVES: {
            prisma: () => prismaClavesC3(),
            correr: async (ctx) => {
                const p = new MulticlavesProcessor();
                await p.afterAll!(ctx);
            },
        },
    };

    it('cubre las once categorías', () => {
        const categorias = new Set(Object.keys(escenarios).map((k) => k.split(' ')[0]));
        expect([...categorias].sort()).toEqual([
            'ACCIONES', 'ACTUALIZACIONES', 'CONTACTOS', 'DEUDORES', 'DEUDORES_Y_FACTURAS', 'ENRIQUECIMIENTO', 'FACTURAS',
            'MULTIARCHIVO', 'MULTICLAVES', 'MULTIRREGISTRO', 'PAGOS',
        ]);
    });

    describe.each(Object.keys(escenarios))('%s', (nombre) => {
        it('hace EXACTAMENTE las mismas llamadas a la base (y al resto del contexto) con y sin ctx.progreso', async () => {
            const sin = await ejecutar(escenarios[nombre], false);
            const con = await ejecutar(escenarios[nombre], true);
            expect(sin.llamadas.length).toBeGreaterThan(0);
            expect(con.llamadas).toEqual(sin.llamadas);
            // Y el canal sí se usó: sin esto la comparación no probaría nada.
            expect(con.resumenes.length).toBeGreaterThan(0);
            expect(sin.resumenes).toHaveLength(0);
        });
    });

    // ── el resumen final de cada categoría, con los números del escenario ────────────────────
    const resumenDe = async (nombre: string) => (await ejecutar(escenarios[nombre], true)).ultimo;

    it('DEUDORES: una fila sobre una identidad repetida no suma casos', async () => {
        expect(await resumenDe('DEUDORES')).toEqual({ tipo: 'DEUDORES', casosNuevos: 2, contactosCopiados: 0 });
    });

    it('DEUDORES_Y_FACTURAS: casos nuevos y casos con facturas', async () => {
        expect(await resumenDe('DEUDORES_Y_FACTURAS')).toEqual({ tipo: 'DEUDORES_Y_FACTURAS', casosNuevos: 2, casosConFacturas: 2, contactosCopiados: 0 });
    });

    it('FACTURAS: los clientes que no existen en la remesa de origen', async () => {
        expect(await resumenDe('FACTURAS')).toEqual({ tipo: 'FACTURAS', casosConFacturas: 2, clientesInexistentes: 1 });
    });

    it.each(['CONTACTOS', 'ENRIQUECIMIENTO'])('%s: un contacto por caso, y la fila sin contacto válido', async (tipo) => {
        expect(await resumenDe(tipo)).toEqual({ tipo, contactosCargados: 2, filasSinContactoValido: 1 });
    });

    it('PAGOS: un negativo que ya estaba cargado no se cuenta como negativo (recarga del mismo archivo; auditoría de C3a)', async () => {
        const r = await ejecutar({
            prisma: () => prismaPagos(),
            correr: async (ctx) => {
                const p = new PagosProcessor();
                const fila = { nro_cliente: '000003462007', importe: -50, fecha: '2026-07-17' } as any;
                await p.processRow({ ...fila }, ctx);
                await p.processRow({ ...fila }, ctx); // la misma fila otra vez: ya cargado
                await p.afterAll(ctx);
            },
        }, true);
        expect(r.ultimo).toMatchObject({ tipo: 'PAGOS', yaCargados: 1, negativos: 1 });
    });

    it('PAGOS: ya cargados, negativos y sin claves', async () => {
        expect(await resumenDe('PAGOS')).toEqual({
            tipo: 'PAGOS', casosConPagos: 1, yaCargados: 1, negativos: 1, facturasMarcadas: 0, claves: null,
        });
    });

    it('ACTUALIZACIONES pagó todo: ausentes dados por pagados y los sin importe', async () => {
        const r = await resumenDe('ACTUALIZACIONES (pagó todo)');
        expect(r).toMatchObject({
            tipo: 'ACTUALIZACIONES',
            coincidencias: 1,
            ausentes: { accion: 'PAGO_TODO', resultado: 'APLICADO', pagosGenerados: 2, salteadosSinMonto: 1, desasignados: 0 },
        });
    });

    it('ACTUALIZACIONES desasignar: cuántos ausentes se desasignaron', async () => {
        const r = await resumenDe('ACTUALIZACIONES (desasignar)');
        expect(r).toMatchObject({ reasignados: 1, ausentes: { accion: 'DESASIGNAR', resultado: 'APLICADO', desasignados: 2, pagosGenerados: 0 } });
    });

    it('ACTUALIZACIONES sin ninguna coincidencia: ABORTADO_SIN_COINCIDENCIAS, y el reporte viene antes del reset', async () => {
        const r = await resumenDe('ACTUALIZACIONES (sin coincidencias)');
        expect(r).toMatchObject({
            coincidencias: 0, casosNuevos: 3,
            ausentes: { accion: 'PAGO_TODO', resultado: 'ABORTADO_SIN_COINCIDENCIAS', pagosGenerados: 0 },
        });
    });

    it('ACTUALIZACIONES: durante las filas el cierre figura NO_LLEGO; sin remesa de origen, SIN_REMESA_ORIGEN; en solo datos, OMITIDO_SOLO_DATOS', async () => {
        const e = ctxBase(prismaActualizaciones(), { accionAusente: 'PAGO_TODO' });
        const p = new ActualizacionesProcessor();
        await p.processBatch(filasDeuda(2), e.ctx);
        expect(e.ultimoResumen()).toMatchObject({ tipo: 'ACTUALIZACIONES', ausentes: { resultado: 'NO_LLEGO' } });

        const sinOrigen = ctxBase(prismaActualizaciones(), { remesaOrigenId: undefined, accionAusente: 'PAGO_TODO' });
        await new ActualizacionesProcessor().afterAll(sinOrigen.ctx);
        expect(sinOrigen.ultimoResumen()).toMatchObject({ ausentes: { resultado: 'SIN_REMESA_ORIGEN' } });

        const soloDatos = ctxBase(prismaActualizaciones(), { accionAusente: 'PAGO_TODO', modoActualizacion: 'SOLO_DATOS' });
        await new ActualizacionesProcessor().afterAll(soloDatos.ctx);
        expect(soloDatos.ultimoResumen()).toMatchObject({ ausentes: { resultado: 'OMITIDO_SOLO_DATOS' } });
    });

    it('ACCIONES (C3b): las escrituras de cada caso quedan entre un $transaction:begin y un :end, y la marca va antes de todo', async () => {
        const { llamadas } = await ejecutar(escenarios['ACCIONES'], true);
        const primerTx = llamadas.indexOf('prisma.$transaction:begin');
        expect(primerTx).toBeGreaterThan(-1);
        expect(llamadas.findIndex((l) => l.startsWith('prisma.remesa.update('))).toBeLessThan(primerTx);
        let dentro = false;
        for (const l of llamadas) {
            if (l === 'prisma.$transaction:begin') dentro = true;
            else if (l === 'prisma.$transaction:end') dentro = false;
            else if (/^prisma\.(deudor\.update|accion_masiva_snapshot\.createMany)\(/.test(l)) expect(dentro).toBe(true);
        }
        expect(llamadas.some((l) => l.startsWith('prisma.accion_masiva_snapshot.createMany('))).toBe(true);
    });

    it('ACCIONES: casos afectados, cancelados salteados y filas sin match', async () => {
        expect(await resumenDe('ACCIONES')).toEqual({
            tipo: 'ACCIONES', deudoresAfectados: 1, comentariosCreados: 0, contactosEliminados: 0, saltadosCancelados: 1, filasSinMatch: 1,
        });
    });

    it('MULTIRREGISTRO: altas, bajas por pago, retiradas y sin factura que coincida', async () => {
        expect(await resumenDe('MULTIRREGISTRO (con bajas por pago y retiradas)')).toMatchObject({
            tipo: 'MULTIRREGISTRO', altas: 1, bajas: 2, bajasPago: 1, bajasRetiradas: 1, bajasSinMatch: 1, bajasYaAplicadas: 0,
        });
    });

    it('MULTIARCHIVO: informa su propio tipo', async () => {
        expect(await resumenDe('MULTIARCHIVO (con bajas por pago y desasignación)')).toMatchObject({ tipo: 'MULTIARCHIVO', altas: 1, bajasPago: 1 });
    });

    it('MULTICLAVES: trámites, con y sin caso, y los casos re-consolidados', async () => {
        expect(await resumenDe('MULTICLAVES')).toEqual({
            tipo: 'MULTICLAVES', yaCargadas: 0, tramites: 2, conCaso: 1, sinCaso: 1, casosReconsolidados: 1,
        });
    });

    it('el reporte final va ANTES del reset(): ningún resumen de cierre sale en cero cuando hubo trabajo', async () => {
        for (const nombre of ['DEUDORES', 'FACTURAS', 'PAGOS', 'ACCIONES', 'MULTIRREGISTRO (con bajas por pago y retiradas)']) {
            const { resumenes } = await ejecutar(escenarios[nombre], true);
            const ultimo = JSON.stringify(resumenes[resumenes.length - 1]);
            expect(ultimo).toMatch(/[1-9]/);
        }
    });
});
