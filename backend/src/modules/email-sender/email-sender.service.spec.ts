import { BadRequestException } from '@nestjs/common';
import { EmailSenderService } from './email-sender.service';

const DEUDOR = {
    id: 1,
    nombre: 'Juan',
    apellido: 'Perez',
    documento: '20304050',
    empresaId: 10,
    empresa: { id: 10, nombre: 'TELECOM_PERSONAL', cuentaSmtpId: 5 },
    remesa: { id: 1, nombre: 'Remesa' },
    estadoSituacion: null,
    estadoGestion: null,
    motivoNoPago: null,
    contactos: [],
};

function armar(opts: { cuentaSmtpId?: number | null; enviarManualResult?: any; enviarManualFalla?: Error } = {}) {
    const prisma: any = {
        deudor: { findUnique: jest.fn().mockResolvedValue({ ...DEUDOR, empresa: { ...DEUDOR.empresa, cuentaSmtpId: 'cuentaSmtpId' in opts ? opts.cuentaSmtpId : 5 } }) },
        empresa: { findUnique: jest.fn().mockResolvedValue({ id: 10, nombre: 'TELECOM_PERSONAL', cuentaSmtpId: 'cuentaSmtpId' in opts ? opts.cuentaSmtpId : 5 }) },
        envio_email: { create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 100, ...data })) },
    };
    const sender: any = {
        enviarManual: jest.fn().mockImplementation(() => {
            if (opts.enviarManualFalla) return Promise.reject(opts.enviarManualFalla);
            return Promise.resolve(opts.enviarManualResult ?? { ok: true, total: 1, enviados: 1, reporteIds: [1] });
        }),
    };
    return { service: new EmailSenderService(prisma, sender), prisma, sender };
}

describe('EmailSenderService.enviar', () => {
    it('con templateId: manda por Sender con templateId y variables, registra envio_email ENVIADO', async () => {
        const { service, prisma, sender } = armar();
        const res = await service.enviar({
            deudorId: 1,
            usuarioId: 7,
            templateId: 55,
            destinatarios: ['a@b.com'],
            variables: { nombre: 'Juan' },
            archivos: [],
        });

        expect(res.ok).toBe(true);
        expect(sender.enviarManual).toHaveBeenCalledWith(expect.objectContaining({ smtpId: 5, templateId: 55, html: undefined }));
        expect(prisma.envio_email.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ templateId: 55, estado: 'ENVIADO' }) }),
        );
    });

    it('sin templateId, con html + asunto: manda html y guarda templateId null en envio_email', async () => {
        const { service, prisma, sender } = armar();
        const res = await service.enviar({
            deudorId: 1,
            usuarioId: 7,
            html: '<p>Hola</p>',
            asunto: 'Cupón de pago - Personal',
            destinatarios: ['a@b.com'],
            archivos: [],
        });

        expect(res.ok).toBe(true);
        expect(sender.enviarManual).toHaveBeenCalledWith(
            expect.objectContaining({ templateId: undefined, html: '<p>Hola</p>', asunto: 'Cupón de pago - Personal' }),
        );
        expect(prisma.envio_email.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ templateId: null }) }));
    });

    it('sin templateId y sin html: 400', async () => {
        const { service } = armar();
        await expect(
            service.enviar({ deudorId: 1, usuarioId: 7, destinatarios: ['a@b.com'], archivos: [] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sin templateId y sin asunto: 400 (el asunto es obligatorio sin plantilla)', async () => {
        const { service } = armar();
        await expect(
            service.enviar({ deudorId: 1, usuarioId: 7, html: '<p>x</p>', destinatarios: ['a@b.com'], archivos: [] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sin destinatarios: 400', async () => {
        const { service } = armar();
        await expect(
            service.enviar({ deudorId: 1, usuarioId: 7, templateId: 1, destinatarios: [], archivos: [] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('empresa sin cuenta SMTP: 400', async () => {
        const { service } = armar({ cuentaSmtpId: null });
        await expect(
            service.enviar({ deudorId: 1, usuarioId: 7, templateId: 1, destinatarios: ['a@b.com'], archivos: [] }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('todos los destinatarios dados de baja: Sender responde ok:true/enviados:0/omitidos, pero NO se registra como ENVIADO', async () => {
        const { service, prisma } = armar({
            enviarManualResult: {
                ok: true,
                total: 1,
                enviados: 0,
                reporteIds: [1],
                omitidos: [{ email: 'a@b.com', motivo: 'El destinatario se dio de baja de los envíos' }],
            },
        });
        const res = await service.enviar({
            deudorId: 1,
            usuarioId: 7,
            templateId: 1,
            destinatarios: ['a@b.com'],
            variables: {},
            archivos: [],
        });
        expect(res.ok).toBe(true); // Sender no lo cuenta como error
        expect(res.enviados).toBe(0);
        expect(res.omitidos).toEqual([{ email: 'a@b.com', motivo: 'El destinatario se dio de baja de los envíos' }]);
        // Pero el historial NO puede decir "ENVIADO" si a nadie le llegó nada.
        expect(prisma.envio_email.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estado: 'OMITIDO' }) }));
    });

    it('envío parcial (algunos omitidos, otros sí recibieron): estado sigue ENVIADO', async () => {
        const { service, prisma } = armar({
            enviarManualResult: {
                ok: true,
                total: 2,
                enviados: 1,
                reporteIds: [1, 2],
                omitidos: [{ email: 'baja@b.com', motivo: 'El destinatario se dio de baja de los envíos' }],
            },
        });
        const res = await service.enviar({
            deudorId: 1,
            usuarioId: 7,
            templateId: 1,
            destinatarios: ['ok@b.com', 'baja@b.com'],
            variables: {},
            archivos: [],
        });
        expect(res.enviados).toBe(1);
        expect(res.omitidos).toHaveLength(1);
        expect(prisma.envio_email.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estado: 'ENVIADO' }) }));
    });

    it('Sender explota: no relanza, registra envio_email en ERROR y devuelve ok:false', async () => {
        const { service, prisma } = armar({ enviarManualFalla: new Error('ECONNREFUSED') });
        const res = await service.enviar({
            deudorId: 1,
            usuarioId: 7,
            templateId: 1,
            destinatarios: ['a@b.com'],
            variables: {},
            archivos: [],
        });
        expect(res.ok).toBe(false);
        expect(res.errores?.[0].error).toBe('ECONNREFUSED');
        expect(prisma.envio_email.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estado: 'ERROR' }) }));
    });
});
