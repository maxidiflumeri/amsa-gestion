import { NotFoundException } from '@nestjs/common';
import { DeudoresService } from './deudores.service';

/**
 * `update` conserva lo que no viene y pisa lo que sí. El motivo de no pago era la excepción: `''` y
 * `undefined` caían en la misma rama, así que **una vez cargado quedaba pegado al caso para siempre**.
 */
describe('DeudoresService.update — motivo de no pago', () => {
    const DEUDOR = { id: 1, estadoSituacionId: 10, estadoGestionId: 20, motivoNoPagoId: 30 };

    const armar = (parametro: any = { id: 99, clave: 'MNP-001' }) => {
        const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...DEUDOR, ...data }));
        const prisma: any = {
            parametro: { findUnique: jest.fn().mockResolvedValue(parametro) },
            deudor: { findUnique: jest.fn().mockResolvedValue(DEUDOR), update },
        };
        const bloqueo = { assertNoBloqueado: jest.fn().mockResolvedValue(undefined) };
        return { service: new DeudoresService(prisma, bloqueo as any), update };
    };

    const dataDe = (update: jest.Mock) => update.mock.calls[0][0].data;

    it('sin el campo, el motivo se conserva', async () => {
        const { service, update } = armar();
        await service.update(1, {});
        expect(dataDe(update).motivoNoPagoId).toBe(30);
    });

    it('con cadena vacía, se borra', async () => {
        const { service, update } = armar();
        await service.update(1, { motivoNoPagoClave: '' });
        expect(dataDe(update).motivoNoPagoId).toBeNull();
    });

    it('con null, se borra', async () => {
        const { service, update } = armar();
        await service.update(1, { motivoNoPagoClave: null });
        expect(dataDe(update).motivoNoPagoId).toBeNull();
    });

    it('con una clave válida, se cambia', async () => {
        const { service, update } = armar();
        await service.update(1, { motivoNoPagoClave: 'MNP-001' });
        expect(dataDe(update).motivoNoPagoId).toBe(99);
    });

    it('una clave que no existe es un error, no un silencio', async () => {
        const { service } = armar(null);
        await expect(service.update(1, { motivoNoPagoClave: 'NO-EXISTE' })).rejects.toBeInstanceOf(NotFoundException);
    });
});
