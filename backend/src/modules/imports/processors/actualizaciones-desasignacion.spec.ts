/**
 * Tests de Feature A — "Actualización diaria de gestión" del ActualizacionesProcessor.
 *
 * Cubre el flag `accionAusente`:
 *  - DESASIGNAR: los ausentes del archivo → GES-094 (guardando el previo). Ignora SIT-050,
 *    ya-desasignados y presentes. Un pago no se genera (no es "pagó todo").
 *  - Re-asignación: un presente que venía en GES-094 se restaura a su gestión previa (o al
 *    default si el previo ya no existe). Ignora SIT-050.
 *  - Idempotencia: correr con todos ya desasignados no produce updates.
 *  - Modo degradado: sin GES-094 seedeado, no se toca a nadie.
 *  - IGNORAR: no se desasigna a nadie.
 */
import { ActualizacionesProcessor } from './actualizaciones.processor';
import { ProcessContext } from './processor.interface';

const GES_094 = 94;
const SIT_050 = 50;
const DEFAULT_GESTION = 200;

function makeCtx(overrides: Partial<ProcessContext> = {}) {
    const deudorUpdate = jest.fn().mockResolvedValue({});
    const deudorCreate = jest.fn().mockResolvedValue({ id: 777 });
    const parametroFindUnique = jest.fn().mockImplementation(({ where }: any) => {
        if (where.clave === 'GES-094') return Promise.resolve({ id: GES_094 });
        if (where.clave === 'SIT-050') return Promise.resolve({ id: SIT_050 });
        return Promise.resolve(null);
    });
    const prisma: any = {
        parametro: {
            findUnique: parametroFindUnique,
            findFirst: jest.fn().mockResolvedValue({ id: DEFAULT_GESTION }),
        },
        deudor: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            update: deudorUpdate,
            create: deudorCreate,
        },
        contacto: {
            findMany: jest.fn().mockResolvedValue([]),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            upsert: jest.fn().mockResolvedValue({}),
        },
        factura: { create: jest.fn().mockResolvedValue({}) },
        $queryRaw: jest.fn().mockResolvedValue([]),
        $transaction: jest.fn((arr: any[]) => Promise.resolve(arr)),
    };
    const ctx = {
        prisma,
        remesaId: 10,
        remesaOrigenId: 5,
        empresaId: 1,
        usuarioId: 99,
        defaults: { estadoSituacionId: 100, estadoGestionId: DEFAULT_GESTION },
        consolidacion: { consolidar: jest.fn().mockResolvedValue(undefined) },
        promesas: { cerrarCumplidas: jest.fn().mockResolvedValue(undefined) },
        auditoria: { log: jest.fn().mockResolvedValue(undefined) },
        montoDeudorDesdeFacturas: 'SI_VACIO',
        modoActualizacion: 'RECONCILIAR',
        comportamientoDeudaMayor: 'FACTURA_NUEVA',
        crearNuevosCasos: true,
        accionAusente: 'DESASIGNAR',
        ...overrides,
    } as unknown as ProcessContext;
    return { ctx, prisma, deudorUpdate, deudorCreate };
}

describe('ActualizacionesProcessor — accionAusente=DESASIGNAR (afterAll)', () => {
    it('desasigna a los ausentes (GES-094) guardando el previo, e ignora SIT-050 / ya-desasignado / presente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        prisma.deudor.findMany.mockResolvedValue([
            { id: 1, estadoGestionId: 210, estadoSituacionId: null }, // ausente normal → desasignar
            { id: 2, estadoGestionId: 210, estadoSituacionId: SIT_050 }, // cancelado → skip
            { id: 3, estadoGestionId: GES_094, estadoSituacionId: null }, // ya desasignado → skip
            { id: 4, estadoGestionId: 210, estadoSituacionId: null }, // presente en el archivo → skip
        ]);
        // Marcar al deudor 4 como visto en el archivo (match real contra la cartera)
        (proc as any).processedDeudorIds.add(4);
        (proc as any).matchedExistingCount = 1;

        await proc.afterAll(ctx);

        // Solo el deudor 1 se desasigna
        expect(deudorUpdate).toHaveBeenCalledTimes(1);
        expect(deudorUpdate).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { estadoGestionId: GES_094, estadoGestionPrevioAId: 210 },
        });
        // Auditoría resumen (1 por batch)
        expect(ctx.auditoria.log).toHaveBeenCalledTimes(1);
        // No hubo datos de deuda → no se consolida ni se generan pagos
        expect(ctx.consolidacion.consolidar).not.toHaveBeenCalled();
    });

    it('idempotente: si todos los ausentes ya están en GES-094, no hace updates', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        prisma.deudor.findMany.mockResolvedValue([
            { id: 1, estadoGestionId: GES_094, estadoSituacionId: null },
            { id: 2, estadoGestionId: GES_094, estadoSituacionId: null },
        ]);
        (proc as any).matchedExistingCount = 1; // hubo match real → el guard no aplica

        await proc.afterAll(ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
        expect(ctx.auditoria.log).not.toHaveBeenCalled();
    });

    it('modo degradado: sin GES-094 seedeado no toca a nadie', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();
        prisma.parametro.findUnique.mockResolvedValue(null); // GES-094 y SIT-050 ausentes

        await proc.afterAll(ctx);

        expect(prisma.deudor.findMany).not.toHaveBeenCalled();
        expect(deudorUpdate).not.toHaveBeenCalled();
    });

    it('GUARD: si 0 filas matchearon la cartera (archivo fallido) NO desasigna a nadie', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        // La remesa origen tiene deudores, pero ninguna fila del archivo matcheó (matchedExistingCount=0,
        // el estado por defecto de un batch en el que todo falló la validación). No se debe tocar nada.
        prisma.deudor.findMany.mockResolvedValue([
            { id: 1, estadoGestionId: 210, estadoSituacionId: null },
            { id: 2, estadoGestionId: 210, estadoSituacionId: null },
        ]);

        await proc.afterAll(ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
        expect(ctx.auditoria.log).not.toHaveBeenCalled();
    });

    it('IGNORAR: no desasigna a ningún ausente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx({ accionAusente: 'IGNORAR' } as any);

        prisma.deudor.findMany.mockResolvedValue([
            { id: 1, estadoGestionId: 210, estadoSituacionId: null },
        ]);

        await proc.afterAll(ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
    });
});

describe('ActualizacionesProcessor — alta de casos nuevos (escenario B)', () => {
    it('SOLO_DATOS + crearNuevosCasos: da de alta el caso nuevo en la MISMA remesa origen y lo marca presente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorCreate } = makeCtx({
            modoActualizacion: 'SOLO_DATOS',
            accionAusente: 'DESASIGNAR',
            crearNuevosCasos: true,
        } as any);

        // No existe en la remesa origen → se crea (escenario B).
        prisma.deudor.findUnique.mockResolvedValue(null);

        await proc.processRow({ documento: '30111222', nombre: 'JUANA' } as any, ctx);

        // Alta en la remesa ORIGEN (5), no en la del import (10) → cartera unificada, sin duplicar mañana.
        expect(deudorCreate).toHaveBeenCalledTimes(1);
        expect(deudorCreate.mock.calls[0][0].data.remesaId).toBe(5);
        // Marcado como presente (no se auto-desasigna en el afterAll) sin contar como match real.
        expect((proc as any).processedDeudorIds.has(777)).toBe(true);
        expect((proc as any).matchedExistingCount).toBe(0);
    });

    it('RECONCILIAR + PAGO_TODO: el caso nuevo también va a la remesa origen y se marca presente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorCreate } = makeCtx({
            modoActualizacion: 'RECONCILIAR',
            accionAusente: 'PAGO_TODO',
            crearNuevosCasos: true,
        } as any);
        prisma.deudor.findUnique.mockResolvedValue(null);

        await proc.processRow({ documento: '30111222', nombre: 'JUANA', montoTotal: '1000' } as any, ctx);

        // El destino ya no depende de accionAusente: siempre la cartera (5), no la del import (10).
        expect(deudorCreate).toHaveBeenCalledTimes(1);
        expect(deudorCreate.mock.calls[0][0].data.remesaId).toBe(5);
        expect((proc as any).processedDeudorIds.has(777)).toBe(true);
        expect((proc as any).matchedExistingCount).toBe(0);
    });

    it('REGRESIÓN: un caso nuevo bajo PAGO_TODO no se marca "pagó todo" en el afterAll de la misma corrida', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma } = makeCtx({
            modoActualizacion: 'RECONCILIAR',
            accionAusente: 'PAGO_TODO',
            crearNuevosCasos: true,
        } as any);
        const pagoCreate = jest.fn().mockResolvedValue({});
        prisma.pago = { create: pagoCreate, aggregate: jest.fn().mockResolvedValue({ _sum: { importe: 0 } }) };
        prisma.factura.updateMany = jest.fn().mockResolvedValue({ count: 0 });

        // Fila 1: deudor existente de la cartera (match real) → presente.
        prisma.deudor.findUnique.mockResolvedValueOnce({ id: 111 });
        await proc.processRow({ documento: '20000001', montoTotal: '5000' } as any, ctx);
        // Fila 2: no existe → alta en la remesa origen (id 777).
        prisma.deudor.findUnique.mockResolvedValue(null);
        await proc.processRow({ documento: '30111222', nombre: 'JUANA', montoTotal: '1000' } as any, ctx);

        // El afterAll recorre la cartera: el 111 y el recién creado 777 están presentes; solo el 222
        // estuvo ausente del archivo y es el único que debe reconciliarse como "pagó todo".
        prisma.deudor.findMany.mockResolvedValue([
            { id: 111, montoTotal: 5000 },
            { id: 222, montoTotal: 3000 },
            { id: 777, montoTotal: 1000 },
        ]);

        await proc.afterAll(ctx);

        expect(pagoCreate).toHaveBeenCalledTimes(1);
        expect(pagoCreate.mock.calls[0][0].data.deudorId).toBe(222);
    });
});

describe('ActualizacionesProcessor — re-asignación (reasignarSiCorresponde)', () => {
    it('restaura el estado de gestión previo de un deudor que venía en GES-094', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        prisma.deudor.findUnique.mockResolvedValue({
            estadoGestionId: GES_094,
            estadoGestionPrevioAId: 210,
            estadoSituacionId: null,
        });

        await (proc as any).reasignarSiCorresponde(7, ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { estadoGestionId: 210, estadoGestionPrevioAId: null },
        });
    });

    it('cae al default cuando el previo apunta a un parámetro inexistente', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        prisma.deudor.findUnique.mockResolvedValue({
            estadoGestionId: GES_094,
            estadoGestionPrevioAId: 999,
            estadoSituacionId: null,
        });
        prisma.parametro.findFirst.mockResolvedValue(null); // previo 999 ya no existe

        await (proc as any).reasignarSiCorresponde(7, ctx);

        expect(deudorUpdate).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { estadoGestionId: DEFAULT_GESTION, estadoGestionPrevioAId: null },
        });
    });

    it('no re-asigna a un deudor cancelado (SIT-050)', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        prisma.deudor.findUnique.mockResolvedValue({
            estadoGestionId: GES_094,
            estadoGestionPrevioAId: 210,
            estadoSituacionId: SIT_050,
        });

        await (proc as any).reasignarSiCorresponde(7, ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
    });

    it('no hace nada si el deudor no estaba desasignado', async () => {
        const proc = new ActualizacionesProcessor();
        const { ctx, prisma, deudorUpdate } = makeCtx();

        prisma.deudor.findUnique.mockResolvedValue({
            estadoGestionId: 210, // no es GES-094
            estadoGestionPrevioAId: null,
            estadoSituacionId: null,
        });

        await (proc as any).reasignarSiCorresponde(7, ctx);

        expect(deudorUpdate).not.toHaveBeenCalled();
    });
});
