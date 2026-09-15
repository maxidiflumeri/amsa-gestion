import { SenderHttpClient } from './sender-http.client';

/** Evita la llamada HTTP real: intercepta `this.http.post` después de `onModuleInit()`. */
function armar() {
    const client = new SenderHttpClient();
    client.onModuleInit();
    const post = jest.fn().mockResolvedValue({ data: { ok: true, total: 1, enviados: 1, reporteIds: [1] } });
    (client as any).http.post = post;
    return { client, post };
}

describe('SenderHttpClient.enviarManual', () => {
    it('con templateId: manda templateId y variables, sin campo html', async () => {
        const { client, post } = armar();
        await client.enviarManual({
            smtpId: 5,
            templateId: 55,
            destinatarios: ['a@b.com'],
            variables: { nombre: 'Juan' },
            archivos: [],
        });

        const [, form] = post.mock.calls[0];
        const buffer = form.getBuffer().toString('utf8');
        expect(buffer).toContain('name="templateId"');
        expect(buffer).toContain('55');
        expect(buffer).not.toContain('name="html"');
    });

    it('sin templateId, con html + subject: manda html y subject, sin campo templateId', async () => {
        const { client, post } = armar();
        await client.enviarManual({
            smtpId: 5,
            html: '<p>Hola</p>',
            asunto: 'Cupón de pago - Personal',
            destinatarios: ['a@b.com'],
            archivos: [],
        });

        const [, form] = post.mock.calls[0];
        const buffer = form.getBuffer().toString('utf8');
        expect(buffer).toContain('name="html"');
        expect(buffer).toContain('<p>Hola</p>');
        expect(buffer).toContain('name="subject"');
        expect(buffer).toContain('Cupón de pago - Personal');
        expect(buffer).not.toContain('name="templateId"');
    });

    it('sin templateId y sin html: lanza sin llamar a Sender', async () => {
        const { client, post } = armar();
        await expect(
            client.enviarManual({ smtpId: 5, destinatarios: ['a@b.com'], archivos: [] }),
        ).rejects.toThrow();
        expect(post).not.toHaveBeenCalled();
    });

    it('adjunta los archivos con su nombre y tipo', async () => {
        const { client, post } = armar();
        await client.enviarManual({
            smtpId: 5,
            templateId: 1,
            destinatarios: ['a@b.com'],
            variables: {},
            archivos: [{ originalname: 'cupon-pago-123.pdf', buffer: Buffer.from('%PDF'), mimetype: 'application/pdf' }],
        });
        const [, form] = post.mock.calls[0];
        const buffer = form.getBuffer().toString('utf8');
        expect(buffer).toContain('cupon-pago-123.pdf');
        expect(buffer).toContain('application/pdf');
    });
});
