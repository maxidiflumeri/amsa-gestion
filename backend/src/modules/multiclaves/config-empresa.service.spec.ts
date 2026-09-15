import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigEmpresaMulticlavesService } from './config-empresa.service';

function armar(configuracion: any, opts: { templates?: Array<{ id: number }>; templatesFalla?: Error } = {}) {
    const tx = {
        empresa: {
            findUnique: jest.fn().mockResolvedValue(configuracion === 'NOT_FOUND' ? null : { configuracion }),
            update: jest.fn().mockResolvedValue(undefined),
        },
    };
    const prisma: any = {
        empresa: { findUnique: jest.fn().mockResolvedValue(configuracion === 'NOT_FOUND' ? null : { id: 1, configuracion }) },
        $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const emailSender: any = {
        templatesDeEmpresa: jest.fn().mockImplementation(() => {
            if (opts.templatesFalla) return Promise.reject(opts.templatesFalla);
            return Promise.resolve({ smtpId: 5, templates: opts.templates ?? [{ id: 42 }] });
        }),
    };
    return { service: new ConfigEmpresaMulticlavesService(prisma, emailSender), prisma, tx, emailSender };
}

describe('ConfigEmpresaMulticlavesService', () => {
    it('obtener: sin config previa, devuelve los defaults', async () => {
        const { service } = armar(null);
        const cfg = await service.obtener(1);
        expect(cfg.gestionAlGenerar).toBe('GES-050');
        expect(cfg.templateCuponId).toBeNull();
    });

    it('obtener: empresa inexistente → 404', async () => {
        const { service } = armar('NOT_FOUND');
        await expect(service.obtener(999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('actualizar: mergea solo la clave multiclaves, sin tocar el resto de configuracion', async () => {
        const { service, tx } = armar(
            { promesa_pago: { maxDias: 7 }, multiclaves: { gestionAlGenerar: 'GES-050' } },
            { templates: [{ id: 42 }] },
        );

        const res = await service.actualizar(1, { templateCuponId: 42 });

        expect(res.templateCuponId).toBe(42);
        expect(res.gestionAlGenerar).toBe('GES-050'); // conservado
        const dataEnviada = tx.empresa.update.mock.calls[0][0].data;
        expect(dataEnviada.configuracion.promesa_pago).toEqual({ maxDias: 7 }); // intacto
        expect(dataEnviada.configuracion.multiclaves).toEqual({ gestionAlGenerar: 'GES-050', templateCuponId: 42 });
    });

    it('actualizar: templateCuponId null lo desasigna, sin validar nada contra Sender', async () => {
        const { service, tx, emailSender } = armar({ multiclaves: { templateCuponId: 7 } });
        await service.actualizar(1, { templateCuponId: null });
        expect(tx.empresa.update.mock.calls[0][0].data.configuracion.multiclaves.templateCuponId).toBeNull();
        expect(emailSender.templatesDeEmpresa).not.toHaveBeenCalled();
    });

    it('actualizar: empresa inexistente → 404, sin escribir', async () => {
        const { service, tx } = armar('NOT_FOUND');
        await expect(service.actualizar(999, { gestionAlGenerar: 'GES-050' })).rejects.toBeInstanceOf(NotFoundException);
        expect(tx.empresa.update).not.toHaveBeenCalled();
    });

    it('actualizar: mediosDePago reemplaza el array completo, no lo mergea elemento a elemento', async () => {
        const { service, tx } = armar({ multiclaves: { mediosDePago: ['PAGO FACIL'] } });
        await service.actualizar(1, { mediosDePago: ['RAPIPAGO', 'COBRO EXPRESS'] });
        expect(tx.empresa.update.mock.calls[0][0].data.configuracion.multiclaves.mediosDePago).toEqual([
            'RAPIPAGO',
            'COBRO EXPRESS',
        ]);
    });

    describe('validación de templateCuponId contra Sender (hallazgo de la auditoría, §5)', () => {
        it('templateCuponId que no existe en la cuenta SMTP de la empresa: 400 PLANTILLA_INVALIDA, sin escribir', async () => {
            const { service, tx, emailSender } = armar({}, { templates: [{ id: 1 }, { id: 2 }] });
            await expect(service.actualizar(1, { templateCuponId: 999 })).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'PLANTILLA_INVALIDA' }),
            });
            expect(tx.empresa.update).not.toHaveBeenCalled();
            expect(emailSender.templatesDeEmpresa).toHaveBeenCalledWith(1);
        });

        it('empresa sin cuenta SMTP: el 400 de templatesDeEmpresa se propaga, sin escribir', async () => {
            const { service, tx } = armar({}, { templatesFalla: new BadRequestException('La empresa X no tiene cuenta SMTP asignada') });
            await expect(service.actualizar(1, { templateCuponId: 42 })).rejects.toBeInstanceOf(BadRequestException);
            expect(tx.empresa.update).not.toHaveBeenCalled();
        });

        it('Sender no responde: el error se propaga tal cual, sin guardar nada', async () => {
            const { service, tx } = armar({}, { templatesFalla: new Error('ECONNREFUSED') });
            await expect(service.actualizar(1, { templateCuponId: 42 })).rejects.toThrow('ECONNREFUSED');
            expect(tx.empresa.update).not.toHaveBeenCalled();
        });

        it('templateCuponId válido: se guarda normalmente', async () => {
            const { service, tx } = armar({}, { templates: [{ id: 42 }] });
            await service.actualizar(1, { templateCuponId: 42 });
            expect(tx.empresa.update).toHaveBeenCalled();
        });
    });
});
