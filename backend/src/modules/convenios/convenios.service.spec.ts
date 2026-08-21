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
