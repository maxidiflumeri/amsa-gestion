import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * «Mi perfil» (`GET /auth/perfil`): cada uno lee sus propios datos, con legajo, DNI y fecha de alta, que antes solo
 * se veían desde Usuarios con `admin.gestionar_usuarios`.
 */
describe('AuthService.getPerfil', () => {
    const fila = (over: Record<string, unknown> = {}) => ({
        id: 7,
        nombre: 'Ana Pérez',
        email: 'ana@empresa.com',
        avatarUrl: 'https://lh3.googleusercontent.com/a/foto',
        rol: 'usuario',
        activo: true,
        legajo: 'L-102',
        dni: '27336733',
        createdAt: new Date('2026-03-04T12:00:00Z'),
        rolObj: { nombre: 'OPERADOR', permisos: ['deudores.ver', 'comentarios.crear'] },
        ...over,
    });
    const armar = (resultado: unknown) => {
        const findUnique = jest.fn().mockResolvedValue(resultado);
        const service = new AuthService({} as any, { usuario: { findUnique } } as any, {} as any);
        return { service, findUnique };
    };

    it('devuelve los datos propios con legajo, DNI, fecha de alta, rol y permisos del rol', async () => {
        const { service } = armar(fila());
        await expect(service.getPerfil(7)).resolves.toEqual({
            id: 7,
            nombre: 'Ana Pérez',
            email: 'ana@empresa.com',
            avatarUrl: 'https://lh3.googleusercontent.com/a/foto',
            rol: 'OPERADOR',
            permisos: ['deudores.ver', 'comentarios.crear'],
            legajo: 'L-102',
            dni: '27336733',
            fechaAlta: new Date('2026-03-04T12:00:00Z'),
        });
    });

    it('busca por el id del token y pide solo los campos del perfil (nada de googleId ni del agente de telefonía)', async () => {
        const { service, findUnique } = armar(fila());
        await service.getPerfil(7);
        const pedido = findUnique.mock.calls[0][0];
        expect(pedido.where).toEqual({ id: 7 });
        expect(Object.keys(pedido.select).sort()).toEqual(
            ['activo', 'avatarUrl', 'createdAt', 'dni', 'email', 'id', 'legajo', 'nombre', 'rol', 'rolObj'].sort(),
        );
    });

    it('sin legajo ni DNI cargados, los devuelve en null', async () => {
        const { service } = armar(fila({ legajo: null, dni: null }));
        const perfil = await service.getPerfil(7);
        expect(perfil.legajo).toBeNull();
        expect(perfil.dni).toBeNull();
    });

    it('sin rol asignado usa el rol de texto y no tiene permisos', async () => {
        const { service } = armar(fila({ rolObj: null }));
        const perfil = await service.getPerfil(7);
        expect(perfil.rol).toBe('usuario');
        expect(perfil.permisos).toEqual([]);
    });

    it('un usuario desactivado o borrado con el token todavía válido no ve nada', async () => {
        await expect(armar(fila({ activo: false })).service.getPerfil(7)).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(armar(null).service.getPerfil(7)).rejects.toBeInstanceOf(UnauthorizedException);
    });
});
