process.env.TZ = 'America/Argentina/Buenos_Aires';

import { BadRequestException } from '@nestjs/common';
import { PromesasService } from './promesas.service';

/**
 * D1 (docs/inicio-spec.md §2.1): la fecha de una promesa es un día calendario guardado a las 00:00Z.
 * Comparada contra `hoy 00:00 local` (03:00Z) se cerraba como INCUMPLIDA la madrugada de su propio
 * día, y no se podía cargar una promesa para hoy.
 */
describe('PromesasService: fechas por día calendario', () => {
    afterEach(() => jest.useRealTimers());

    const armar = (maxDias?: number) => {
        const prisma: any = {
            parametro: { findUnique: jest.fn(async ({ where }) => ({ id: where.clave === 'SIT-020' ? 20 : 21 })) },
            deudor: {
                findUnique: jest.fn().mockResolvedValue({ id: 5, empresaId: 1, estadoSituacionId: null }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            empresa: {
                findUnique: jest.fn().mockResolvedValue({
                    configuracion: maxDias ? { promesa_pago: { maxDias } } : null,
                }),
            },
            pago: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { importe: 0 } }),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            promesa_pago: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
                update: jest.fn(),
            },
            $transaction: jest.fn(async (fn: any) => fn(prisma)),
        };
        const bloqueo: any = { assertNoBloqueado: jest.fn().mockResolvedValue(undefined) };
        const auditoria: any = { log: jest.fn().mockResolvedValue(undefined) };
        const service = new PromesasService(prisma, bloqueo, auditoria);
        return { service, prisma };
    };

    describe('procesarVencidas (cron de las 2 AM)', () => {
        it('el 17/10 a las 02:00 una promesa del 17/10 NO se evalúa: el where corta en 17/10 00:00Z', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-10-17T05:00:00.000Z')); // 02:00 AR
            const { service, prisma } = armar();
            await service.procesarVencidas();
            const where = prisma.promesa_pago.findMany.mock.calls[0][0].where;
            expect(where.estado).toBe('VIGENTE');
            expect(where.fechaPromesa.lt.toISOString()).toBe('2026-10-17T00:00:00.000Z');
            // La del 17/10 guardada a las 00:00Z no es "< 17/10 00:00Z"; la del 16/10 sí.
            expect(new Date('2026-10-17T00:00:00.000Z') < where.fechaPromesa.lt).toBe(false);
            expect(new Date('2026-10-16T00:00:00.000Z') < where.fechaPromesa.lt).toBe(true);
        });

        it('una promesa del 16/10 sin pago se cierra INCUMPLIDA el 17/10', async () => {
            jest.useFakeTimers().setSystemTime(new Date('2026-10-17T05:00:00.000Z'));
            const { service, prisma } = armar();
            prisma.promesa_pago.findMany.mockResolvedValue([
                { id: 9, deudorId: 5, pagosAlCrear: 0, fechaPromesa: new Date('2026-10-16T00:00:00.000Z') },
            ]);
            const r = await service.procesarVencidas();
            expect(r).toEqual({ evaluadas: 1, cumplidas: 0, incumplidas: 1 });
            expect(prisma.promesa_pago.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 9 }, data: expect.objectContaining({ estado: 'INCUMPLIDA' }) }),
            );
        });
    });

    describe('crear (alta)', () => {
        const alta = (fechaPromesa: string) => ({ deudorId: 5, fechaPromesa, monto: 100 }) as any;

        beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-16T13:00:00.000Z'))); // 10:00 AR

        it('acepta una promesa para hoy (antes daba 400)', async () => {
            const { service, prisma } = armar();
            await expect(service.onModuleInit()).resolves.toBeUndefined();
            await expect(service.crear(alta('2026-10-16'), 1)).resolves.toBeDefined();
            expect(prisma.promesa_pago.create).toHaveBeenCalled();
        });

        it('rechaza una promesa de ayer', async () => {
            const { service } = armar();
            await service.onModuleInit();
            await expect(service.crear(alta('2026-10-15'), 1)).rejects.toBeInstanceOf(BadRequestException);
            await expect(service.crear(alta('2026-10-15'), 1)).rejects.toThrow(/anterior a hoy/);
        });

        it('acepta hoy + maxDias y rechaza hoy + maxDias + 1', async () => {
            const { service } = armar(5);
            await service.onModuleInit();
            await expect(service.crear(alta('2026-10-21'), 1)).resolves.toBeDefined();
            await expect(service.crear(alta('2026-10-22'), 1)).rejects.toThrow(/no puede superar los 5 días/);
        });

        it('sin configuración usa el máximo por defecto (7 días)', async () => {
            const { service } = armar();
            await service.onModuleInit();
            await expect(service.crear(alta('2026-10-23'), 1)).resolves.toBeDefined();
            await expect(service.crear(alta('2026-10-24'), 1)).rejects.toBeInstanceOf(BadRequestException);
        });

        it('a las 23:30 locales (ya es el día siguiente en UTC) "hoy" sigue siendo el día local', async () => {
            jest.setSystemTime(new Date('2026-10-17T02:30:00.000Z')); // 23:30 AR del 16/10
            const { service } = armar();
            await service.onModuleInit();
            await expect(service.crear(alta('2026-10-16'), 1)).resolves.toBeDefined();
            await expect(service.crear(alta('2026-10-15'), 1)).rejects.toBeInstanceOf(BadRequestException);
        });
    });
});
