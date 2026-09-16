import { idsSituacionCancelada, _resetCacheSituacionesCerradas } from './situaciones-cerradas';

describe('idsSituacionCancelada', () => {
    beforeEach(() => {
        _resetCacheSituacionesCerradas();
    });

    it('devuelve los ids de los parámetros de situación con categoría CANCELADO', async () => {
        const findMany = jest.fn().mockResolvedValue([
            { id: 50, clave: 'SIT-050' },
            { id: 51, clave: 'SIT-051' },
            { id: 54, clave: 'SIT-054' },
        ]);
        const prisma = { parametro: { findMany } } as any;

        const ids = await idsSituacionCancelada(prisma);

        expect(ids).toEqual([50, 51, 54]);
        expect(findMany).toHaveBeenCalledWith({
            where: { grupo: 'situacion', categoria: 'CANCELADO' },
            select: { id: true, clave: true },
        });
    });

    it('cachea por proceso: una segunda llamada no vuelve a consultar la base', async () => {
        const findMany = jest.fn().mockResolvedValue([{ id: 50, clave: 'SIT-050' }]);
        const prisma = { parametro: { findMany } } as any;

        await idsSituacionCancelada(prisma);
        await idsSituacionCancelada(prisma);

        expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('modo degradado: sin códigos CANCELADO devuelve [] y no lanza', async () => {
        const prisma = { parametro: { findMany: jest.fn().mockResolvedValue([]) } } as any;

        await expect(idsSituacionCancelada(prisma)).resolves.toEqual([]);
    });

    it('_resetCacheSituacionesCerradas fuerza a re-consultar', async () => {
        const findMany = jest.fn().mockResolvedValue([{ id: 50, clave: 'SIT-050' }]);
        const prisma = { parametro: { findMany } } as any;

        await idsSituacionCancelada(prisma);
        _resetCacheSituacionesCerradas();
        await idsSituacionCancelada(prisma);

        expect(findMany).toHaveBeenCalledTimes(2);
    });
});
