import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ComentariosService } from './comentarios.service';

/**
 * `removePropio` respalda el permiso "Eliminar comentarios propios". La condición original dejaba
 * pasar los comentarios **sin autor** —los que escriben las acciones masivas y las importaciones—,
 * así que con ese permiso cualquiera podía borrar el rastro de lo que hizo un proceso.
 */
describe('ComentariosService.removePropio', () => {
    const armar = (comentario: any) => {
        const del = jest.fn().mockResolvedValue({});
        const prisma: any = {
            comentario: { findUnique: jest.fn().mockResolvedValue(comentario), delete: del },
        };
        const bloqueo = { assertNoBloqueado: jest.fn().mockResolvedValue(undefined) };
        return { service: new ComentariosService(prisma, bloqueo as any), del, bloqueo };
    };

    it('deja borrar el propio', async () => {
        const { service, del } = armar({ id: 1, deudorId: 9, usuarioId: 7 });
        await expect(service.removePropio(1, 7)).resolves.toMatchObject({ id: 1 });
        expect(del).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('rechaza el de otra persona', async () => {
        const { service, del } = armar({ id: 1, deudorId: 9, usuarioId: 8 });
        await expect(service.removePropio(1, 7)).rejects.toBeInstanceOf(ForbiddenException);
        expect(del).not.toHaveBeenCalled();
    });

    it('rechaza uno sin autor: lo dejó un proceso, no una persona', async () => {
        const { service, del } = armar({ id: 1, deudorId: 9, usuarioId: null });
        await expect(service.removePropio(1, 7)).rejects.toThrow(/proceso del sistema/);
        expect(del).not.toHaveBeenCalled();
    });

    it('tampoco lo puede borrar una sesión sin usuario', async () => {
        const { service, del } = armar({ id: 1, deudorId: 9, usuarioId: null });
        await expect(service.removePropio(1, undefined)).rejects.toBeInstanceOf(ForbiddenException);
        expect(del).not.toHaveBeenCalled();
    });

    it('404 si no existe', async () => {
        const { service } = armar(null);
        await expect(service.removePropio(1, 7)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('no se puede borrar en una cuenta cancelada', async () => {
        const { service, bloqueo, del } = armar({ id: 1, deudorId: 9, usuarioId: 7 });
        bloqueo.assertNoBloqueado.mockRejectedValue(new ForbiddenException('cancelada'));
        await expect(service.removePropio(1, 7)).rejects.toBeInstanceOf(ForbiddenException);
        expect(del).not.toHaveBeenCalled();
    });
});
