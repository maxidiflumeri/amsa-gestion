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
            update: deudorUpdate,
        },
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
    return { ctx, prisma, deudorUpdate };
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
        // Marcar al deudor 4 como visto en el archivo
        (proc as any).processedDeudorIds.add(4);

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
