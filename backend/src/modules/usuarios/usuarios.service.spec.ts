import { ConflictException } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';

/**
 * Borrar un usuario **funcionaba**: casi todas las FKs que lo apuntan son `ON DELETE SET NULL`, así
 * que no fallaba — se llevaba puesta la trazabilidad. Sus comentarios, pagos y registros de auditoría
 * quedaban huérfanos y pasaban a figurar como "Sistema", en silencio y sin vuelta atrás.
 */
describe('UsuariosService.remove', () => {
    const TABLAS = [
        'comentario', 'pago', 'promesa_pago', 'transaccion',
        'convenio', 'remesa', 'ejecucion_reporte', 'envio_email',
    ] as const;

    const armar = (conteos: Partial<Record<(typeof TABLAS)[number], number>> = {}) => {
        const del = jest.fn().mockResolvedValue({});
        const prisma: any = {
            usuario: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 5, nombre: 'Ana Pérez', email: 'ana@x.com', legajo: null, avatarUrl: null,
                    activo: true, rolId: null, rolObj: null, agenteTelefonia: null, createdAt: new Date(),
                }),
                delete: del,
            },
        };
        for (const t of TABLAS) {
            prisma[t] = { count: jest.fn().mockResolvedValue(conteos[t] ?? 0) };
        }
        const activo = { invalidar: jest.fn() };
        const service = new UsuariosService(prisma, {} as any, activo as any);
        return { service, del, activo };
    };

    it('deja borrar un alta equivocada que nunca se usó', async () => {
        const { service, del, activo } = armar();
        await expect(service.remove(5)).resolves.toEqual({ mensaje: 'Usuario eliminado correctamente' });
        expect(del).toHaveBeenCalledWith({ where: { id: 5 } });
        expect(activo.invalidar).toHaveBeenCalledWith(5);
    });

    it.each(TABLAS)('rechaza el borrado si tiene actividad en %s', async (tabla) => {
        const { service, del } = armar({ [tabla]: 3 });
        await expect(service.remove(5)).rejects.toBeInstanceOf(ConflictException);
        expect(del).not.toHaveBeenCalled();
    });

    it('el mensaje dice qué tiene y adónde ir', async () => {
        const { service } = armar({ comentario: 12, pago: 1 });
        await expect(service.remove(5)).rejects.toThrow(/12 comentarios/);
        await expect(service.remove(5)).rejects.toThrow(/1 pago[^s]/);
        await expect(service.remove(5)).rejects.toThrow(/desactivalo/i);
    });

    it('pluraliza sin inventar palabras', async () => {
        const { service } = armar({ transaccion: 69, remesa: 2 });
        // Agregarle una "s" al final daba "69 registro de auditorías".
        await expect(service.remove(5)).rejects.toThrow(/69 registros de auditoría\b/);
        await expect(service.remove(5)).rejects.toThrow(/2 importaciones/);
    });

    it('en singular no pluraliza', async () => {
        const { service } = armar({ transaccion: 1, remesa: 1 });
        await expect(service.remove(5)).rejects.toThrow(/1 registro de auditoría,/);
        await expect(service.remove(5)).rejects.toThrow(/1 importación\b/);
    });
});
