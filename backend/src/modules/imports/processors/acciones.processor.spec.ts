/**
 * AccionesProcessor — `saltearCanceladas` (spec §10.7).
 *
 * Antes de la fase 4a de multiclaves, `saltearCanceladas` comparaba contra la clave `SIT-050`
 * pelada. Desde la fase 4a resuelve por la categoría CANCELADO completa (SIT-050 a SIT-053, y desde
 * esta misma fase también SIT-054 "Cancelado con quita") vía `idsSituacionCancelada`.
 *
 * Hallazgo de la auditoría (importante #7): la ampliación no es solo "sumar SIT-054" — también
 * cambia el comportamiento para SIT-051/052/053, que antes NO se salteaban. Este archivo no
 * existía antes de la fase 4a (`AccionesProcessor` no tenía cobertura unitaria dedicada).
 */
import { AccionesProcessor } from './acciones.processor';
import { ProcessContext } from './processor.interface';
import { _resetCacheSituacionesCerradas } from '../utils/situaciones-cerradas';

beforeEach(() => {
    _resetCacheSituacionesCerradas();
});

/** Prisma mockeado con una lista de deudores fija, más el catálogo de categoría CANCELADO. */
function makeCtx(deudores: Array<{ id: number; estadoSituacionId: number | null; nombre?: string }>) {
    const deudorUpdate = jest.fn().mockResolvedValue({});
    const parametroFindMany = jest.fn().mockImplementation(({ where }: any) => {
        if (where?.categoria === 'CANCELADO') {
            return Promise.resolve([50, 51, 52, 53, 54].map((id) => ({ id, clave: `SIT-0${id}` })));
        }
        return Promise.resolve([]);
    });

    const prisma: any = {
        deudor: {
            findMany: jest.fn().mockResolvedValue(
                deudores.map((d) => ({
                    id: d.id, estadoSituacionId: d.estadoSituacionId, estadoGestionId: null, motivoNoPagoId: null,
                    nombre: d.nombre ?? 'X', apellido: '', montoTotal: 100, fechaVencimiento: null, nroCliente: String(d.id),
                    camposAdicionales: null,
                })),
            ),
            update: deudorUpdate,
        },
        parametro: { findMany: parametroFindMany },
        accion_masiva_snapshot: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };

    const ctx = {
        prisma,
        remesaId: 1,
        empresaId: 10,
        usuarioId: 1,
        auditoria: { log: jest.fn().mockResolvedValue(undefined) },
        accionesConfig: {
            matchMode: 'DEUDOR',
            matchColumn: { field: 'id', fromIndex: 0 },
            saltearCanceladas: true,
            operaciones: [{ tipo: 'SET_CAMPO', campo: 'nombre', modo: 'ESTATICO', valor: 'TOCADO' }],
        },
    } as unknown as ProcessContext;

    return { ctx, prisma, deudorUpdate };
}

const fila = (id: number) => ({ _raw: [String(id)] } as any);

describe('AccionesProcessor — saltearCanceladas resuelve por categoría CANCELADO', () => {
    it.each([
        ['SIT-050 (Cancelado / Pagado)', 50],
        ['SIT-051 (Cancelado antes de la gestión)', 51],
        ['SIT-052 (Cancelado a liquidar)', 52],
        ['SIT-053 (Cancelado a monto histórico)', 53],
        ['SIT-054 (Cancelado con quita, multiclaves)', 54],
    ])('saltea un caso en %s', async (_nombre, sitId) => {
        const { ctx, deudorUpdate } = makeCtx([{ id: 1, estadoSituacionId: sitId }]);

        const proc = new AccionesProcessor();
        await proc.processRow(fila(1), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
    });

    it('NO saltea un caso en una situación viva (no CANCELADO)', async () => {
        const { ctx, deudorUpdate } = makeCtx([{ id: 2, estadoSituacionId: 41 /* SIT-041, Pago parcial */ }]);
        const proc = new AccionesProcessor();

        await proc.processRow(fila(2), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 2 }, data: { nombre: 'TOCADO' } });
    });

    it('un lote mixto: toca solo al vivo, saltea el cancelado con quita', async () => {
        const { ctx, deudorUpdate, prisma } = makeCtx([]);
        prisma.deudor.findMany
            .mockResolvedValueOnce([
                { id: 1, estadoSituacionId: 54, estadoGestionId: null, motivoNoPagoId: null, nombre: 'A', apellido: '', montoTotal: 100, fechaVencimiento: null, nroCliente: '1', camposAdicionales: null },
            ])
            .mockResolvedValueOnce([
                { id: 2, estadoSituacionId: 41, estadoGestionId: null, motivoNoPagoId: null, nombre: 'B', apellido: '', montoTotal: 100, fechaVencimiento: null, nroCliente: '2', camposAdicionales: null },
            ]);

        const proc = new AccionesProcessor();
        await proc.processRow(fila(1), ctx);
        await proc.processRow(fila(2), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).toHaveBeenCalledTimes(1);
        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 2 }, data: { nombre: 'TOCADO' } });
    });

    it('modo degradado: sin ningún código CANCELADO seedeado, no saltea a nadie (muestra de más, no de menos)', async () => {
        const { ctx, deudorUpdate, prisma } = makeCtx([{ id: 1, estadoSituacionId: 50 }]);
        prisma.parametro.findMany.mockResolvedValue([]);

        const proc = new AccionesProcessor();
        await proc.processRow(fila(1), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { nombre: 'TOCADO' } });
    });

    it('con saltearCanceladas apagado, toca a todos sin importar la situación', async () => {
        const { ctx, deudorUpdate } = makeCtx([{ id: 1, estadoSituacionId: 54 }]);
        (ctx.accionesConfig as any).saltearCanceladas = false;

        const proc = new AccionesProcessor();
        await proc.processRow(fila(1), ctx);
        await proc.afterAll(ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { nombre: 'TOCADO' } });
    });
});
