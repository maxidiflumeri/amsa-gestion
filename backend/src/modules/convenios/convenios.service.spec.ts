process.env.TZ = 'America/Argentina/Buenos_Aires';

import { BadRequestException } from '@nestjs/common';
import { ConveniosService } from './convenios.service';

/**
 * Pagar una cuota de convenio movía plata y no cerraba el círculo: no disparaba la consolidación
 * (el saldo del caso no bajaba), el pago quedaba con `origen` en NULL (no se podía borrar) y el
 * importe era editable sin validar, así que una cuota de $50.000 se saldaba con $100.
 */
describe('ConveniosService.marcarCuotaPagada', () => {
    const CUOTA = {
        id: 1, nroCuota: 2, estado: 'PENDIENTE', importe: 50000,
        convenio: { id: 7, deudorId: 33 },
    };

    const armar = (cuota: any = CUOTA) => {
        const creados: any[] = [];
        const prisma: any = {
            cuota_convenio: { findUnique: jest.fn().mockResolvedValue(cuota), update: jest.fn() },
            pago: { create: jest.fn((args) => { creados.push(args.data); return args; }) },
            $transaction: jest.fn(async (ops: any[]) => ops.map(() => ({ id: 1, estado: 'PAGADA' }))),
        };
        // `$transaction` recibe las promesas ya construidas, así que los mocks corren igual.
        const bloqueo = { assertNoBloqueado: jest.fn().mockResolvedValue(undefined) };
        const consolidacion = { consolidar: jest.fn().mockResolvedValue(undefined) };
        const service = new ConveniosService(prisma, bloqueo as any, consolidacion as any);
        return { service, prisma, consolidacion, creados };
    };

    const pago = (importe: number) => ({ fecha: '2026-08-21', importe });

    it('rechaza un importe menor al de la cuota', async () => {
        const { service, consolidacion } = armar();
        await expect(service.marcarCuotaPagada(1, pago(100))).rejects.toBeInstanceOf(BadRequestException);
        expect(consolidacion.consolidar).not.toHaveBeenCalled();
    });

    it('el mensaje dice cuánto es la cuota y qué hacer', async () => {
        const { service } = armar();
        await expect(service.marcarCuotaPagada(1, pago(100))).rejects.toThrow(/50000/);
        await expect(service.marcarCuotaPagada(1, pago(100))).rejects.toThrow(/pago suelto/);
    });

    it('acepta el importe exacto', async () => {
        const { service } = armar();
        await expect(service.marcarCuotaPagada(1, pago(50000))).resolves.toBeDefined();
    });

    it('acepta de más: el deudor puede pagar adelantado', async () => {
        const { service } = armar();
        await expect(service.marcarCuotaPagada(1, pago(60000))).resolves.toBeDefined();
    });

    it('el pago queda etiquetado como CONVENIO, no con origen NULL', async () => {
        const { service, creados } = armar();
        await service.marcarCuotaPagada(1, pago(50000));
        expect(creados[0].origen).toBe('CONVENIO');
    });

    it('dispara la consolidación del deudor: sin esto el saldo del caso no baja', async () => {
        const { service, consolidacion } = armar();
        await service.marcarCuotaPagada(1, pago(50000));
        expect(consolidacion.consolidar).toHaveBeenCalledWith({ tipo: 'DEUDORES', deudorIds: [33] });
    });

    it('no deja volver a pagar una cuota ya pagada', async () => {
        const { service } = armar({ ...CUOTA, estado: 'PAGADA' });
        await expect(service.marcarCuotaPagada(1, pago(50000))).rejects.toBeInstanceOf(BadRequestException);
    });
});

/**
 * D1 (docs/inicio-spec.md §2.1): el vencimiento de una cuota es un día calendario guardado a las 00:00Z.
 * El cron de las 3 AM la marcaba VENCIDA la madrugada de su propio día (`lt: now` contra `D 00:00Z`).
 */
describe('ConveniosService.updateEstadosCuotas', () => {
    afterEach(() => jest.useRealTimers());

    it('el 17/10 a las 03:00 locales solo vencen las cuotas anteriores al 17/10 (no la del 17/10)', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-10-17T06:00:00.000Z')); // 03:00 AR
        const updateMany = jest.fn().mockResolvedValue({ count: 2 });
        const service = new ConveniosService({ cuota_convenio: { updateMany } } as any, {} as any, {} as any);

        await service.updateEstadosCuotas();

        const where = updateMany.mock.calls[0][0].where;
        expect(where.estado).toBe('PENDIENTE');
        expect(where.fechaVencimiento.lt.toISOString()).toBe('2026-10-17T00:00:00.000Z');
    });
});

describe('ConveniosService: datos del usuario que viajan con el convenio (auditoría Inicio)', () => {
    it('findByDeudor trae solo id y nombre del usuario: nunca email, dni, googleId ni legajo', async () => {
        const findMany = jest.fn().mockResolvedValue([]);
        const service = new ConveniosService({ convenio: { findMany } } as any, {} as any, {} as any);
        await service.findByDeudor(5);
        expect(findMany.mock.calls[0][0].include.usuario).toEqual({ select: { id: true, nombre: true } });
    });

    it('en todo el service, ningún include trae la fila entera del usuario', () => {
        const fuente = require('fs').readFileSync(require('path').join(__dirname, 'convenios.service.ts'), 'utf8');
        expect(fuente).not.toMatch(/usuario:\s*true/);
    });
});
