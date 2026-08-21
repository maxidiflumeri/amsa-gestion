import { Test, TestingModule } from '@nestjs/testing';
import { ComentariosController } from './comentarios.controller';
import { ComentariosService } from './comentarios.service';

/**
 * El controller delega todo; lo que se verifica acá es el cableado que sí es suyo: de dónde saca el
 * usuario. Antes este archivo era el esqueleto del CLI, sin el provider del servicio, así que ni
 * siquiera compilaba el módulo de test.
 */
describe('ComentariosController', () => {
    let controller: ComentariosController;
    const servicio = {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        removePropio: jest.fn().mockResolvedValue({ id: 1 }),
        findByDeudor: jest.fn().mockResolvedValue([]),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            controllers: [ComentariosController],
            providers: [{ provide: ComentariosService, useValue: servicio }],
        }).compile();

        controller = module.get(ComentariosController);
    });

    it('se construye', () => {
        expect(controller).toBeDefined();
    });

    it('el autor sale de la sesión, no del body', async () => {
        await controller.create({ deudorId: 5, texto: 'hola', usuarioId: 999 } as any, { usuario: { sub: 7 } });
        expect(servicio.create).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: 7 }));
    });

    it('sin sesión el comentario queda sin autor', async () => {
        await controller.create({ deudorId: 5, texto: 'hola' } as any, {});
        expect(servicio.create).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: null }));
    });

    it('borrar pasa el usuario de la sesión, que es lo que limita a "propios"', async () => {
        await controller.remove('3', { usuario: { sub: 7 } });
        expect(servicio.removePropio).toHaveBeenCalledWith(3, 7);
    });
});
