import { UsuarioActivoService } from './usuario-activo.service';

/**
 * El caso que importa: desactivar a alguien tiene que cortarle la sesión abierta. Antes el guard solo
 * verificaba la firma del JWT y la persona seguía trabajando hasta que el token venciera.
 */
describe('UsuarioActivoService', () => {
    const armar = (activo: boolean | null) => {
        const findUnique = jest.fn().mockResolvedValue(activo === null ? null : { activo });
        const prisma = { usuario: { findUnique } } as any;
        return { service: new UsuarioActivoService(prisma), findUnique };
    };

    it('deja pasar a un usuario activo', async () => {
        const { service } = armar(true);
        await expect(service.estaActivo(1)).resolves.toBe(true);
    });

    it('rechaza a un usuario desactivado', async () => {
        const { service } = armar(false);
        await expect(service.estaActivo(1)).resolves.toBe(false);
    });

    it('rechaza a un usuario borrado con un token todavía válido', async () => {
        const { service } = armar(null);
        await expect(service.estaActivo(1)).resolves.toBe(false);
    });

    it('no le pega a la base en cada request', async () => {
        const { service, findUnique } = armar(true);
        await service.estaActivo(1);
        await service.estaActivo(1);
        await service.estaActivo(1);
        expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('invalidar corta el acceso en el momento, sin esperar al TTL', async () => {
        const findUnique = jest
            .fn()
            .mockResolvedValueOnce({ activo: true })
            .mockResolvedValueOnce({ activo: false });
        const service = new UsuarioActivoService({ usuario: { findUnique } } as any);

        await expect(service.estaActivo(7)).resolves.toBe(true);
        service.invalidar(7); // lo llama el ABM al guardar el usuario
        await expect(service.estaActivo(7)).resolves.toBe(false);
        expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('la caché es por usuario: invalidar uno no afecta a los demás', async () => {
        const findUnique = jest.fn().mockResolvedValue({ activo: true });
        const service = new UsuarioActivoService({ usuario: { findUnique } } as any);

        await service.estaActivo(1);
        await service.estaActivo(2);
        service.invalidar(1);
        await service.estaActivo(2);

        expect(findUnique).toHaveBeenCalledTimes(2);
    });
});
