import { AsistenteConfigService } from './asistente-config.service';

// La primera apertura después del deploy pide el estado en paralelo: dos `upsert` sobre la tabla vacía hacen los dos el
// INSERT de id=1 y el segundo fallaba con P2002 (un 500 y un ERROR en CloudWatch). Auditoría de la Fase A.
describe('AsistenteConfigService.leer', () => {
    const fila = {
        id: 1,
        habilitado: true,
        topeMensualUsd: 100,
        avisoPorcentaje: 80,
        limiteDiarioUsuario: 100,
        topeTurnoUsd: 0.05,
        retencionDias: 90,
        precios: null,
        avisoMes80: null,
        avisoMes100: null,
    };
    const duplicado = () => Object.assign(new Error('Unique constraint failed on the constraint: PRIMARY'), { code: 'P2002' });

    function armar() {
        const prisma: any = {
            asistente_config: { upsert: jest.fn() },
            asistente_funcion: { upsert: jest.fn().mockResolvedValue({}) },
        };
        return { prisma, svc: new AsistenteConfigService(prisma, {} as any, {} as any) };
    }

    it('si el upsert de la configuración choca con otro (P2002), lo reintenta y lee la fila', async () => {
        const { prisma, svc } = armar();
        prisma.asistente_config.upsert.mockRejectedValueOnce(duplicado()).mockResolvedValueOnce(fila);
        await expect(svc.leer()).resolves.toBeDefined();
        expect(prisma.asistente_config.upsert).toHaveBeenCalledTimes(2);
    });

    it('lo mismo al sembrar las funciones', async () => {
        const { prisma, svc } = armar();
        prisma.asistente_config.upsert.mockResolvedValue(fila);
        prisma.asistente_funcion.upsert.mockRejectedValueOnce(duplicado()).mockResolvedValue({});
        await expect(svc.leer()).resolves.toBeDefined();
    });

    it('otro error no se reintenta', async () => {
        const { prisma, svc } = armar();
        prisma.asistente_config.upsert.mockRejectedValueOnce(new Error('la base no responde'));
        await expect(svc.leer()).rejects.toThrow('la base no responde');
        expect(prisma.asistente_config.upsert).toHaveBeenCalledTimes(1);
    });
});
