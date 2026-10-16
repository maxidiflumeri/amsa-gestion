import { ConveniosController } from './convenios.controller';

describe('ConveniosController.create', () => {
    const armar = () => {
        const service: any = { create: jest.fn().mockResolvedValue({ id: 1 }) };
        return { controller: new ConveniosController(service), service };
    };

    it('pisa el usuarioId del body con el del JWT aunque el cliente mande otro', async () => {
        const { controller, service } = armar();
        await controller.create({ deudorId: 1, usuarioId: 99 } as any, { sub: 3 });
        expect(service.create.mock.calls[0][0].usuarioId).toBe(3);
    });

    it('sin usuario en el request deja el usuarioId sin definir (no confía en el body)', async () => {
        const { controller, service } = armar();
        await controller.create({ deudorId: 1, usuarioId: 99 } as any, undefined as any);
        expect(service.create.mock.calls[0][0].usuarioId).toBeUndefined();
    });
});
