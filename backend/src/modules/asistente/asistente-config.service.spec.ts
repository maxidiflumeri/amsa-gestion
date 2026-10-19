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

describe('AsistenteConfigService: funciones por modelo (Fase B)', () => {
    const fila = { clave: 'reportes', nombre: 'Constructor de reportes', habilitada: true, topeMensualUsd: null, topeTurnoUsd: null, limiteDiarioUsuario: null };
    const modelo: any = { modelo: 'us.anthropic.claude-haiku-5-5', modeloPara: (f: string) => (f === 'reportes' ? 'us.anthropic.claude-sonnet-5-5' : 'us.anthropic.claude-haiku-5-5') };

    function armar(filas: object[]) {
        const prisma: any = {
            asistente_config: { upsert: jest.fn().mockResolvedValue({ id: 1, habilitado: true, topeMensualUsd: 100, avisoPorcentaje: 80, limiteDiarioUsuario: 100, topeTurnoUsd: 0.05, precios: null }) },
            asistente_funcion: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue(filas), findUnique: jest.fn(), update: jest.fn() },
        };
        return { prisma, svc: new AsistenteConfigService(prisma, modelo, { log: jest.fn().mockResolvedValue(undefined) } as any) };
    }

    it('la función de reportes informa su modelo y, con la columna en null, el tope por turno y el límite de código', async () => {
        const { svc } = armar([{ ...fila, clave: 'ayuda', nombre: 'Ayuda' }, fila]);
        const [ayuda, reportes] = await svc.funciones();
        expect(reportes).toMatchObject({ clave: 'reportes', modelo: 'us.anthropic.claude-sonnet-5-5', topeTurnoUsd: 0.3, limiteDiarioUsuario: 40 });
        expect(ayuda).toMatchObject({ clave: 'ayuda', modelo: 'us.anthropic.claude-haiku-5-5', topeTurnoUsd: null, limiteDiarioUsuario: null });
    });

    it('lo configurado manda sobre el de código', async () => {
        const { svc } = armar([{ ...fila, topeTurnoUsd: 0.5, limiteDiarioUsuario: 10 }]);
        expect(await svc.funcion('reportes')).toMatchObject({ topeTurnoUsd: 0.5, limiteDiarioUsuario: 10 });
    });

    it('precioVigente(modelo): el de código de Sonnet, y null para un modelo sin precio', async () => {
        const { svc } = armar([]);
        expect(await svc.precioVigente('us.anthropic.claude-sonnet-5-5')).toMatchObject({ entrada: 2.2, salida: 11 });
        expect(await svc.precioVigente('un.modelo.nuevo')).toBeNull();
        expect(await svc.precioVigente()).toMatchObject({ entrada: 0.11 });
    });

    it('el PATCH guarda tope por turno y límite diario, y se audita', async () => {
        const { prisma, svc } = armar([]);
        prisma.asistente_funcion.findUnique.mockResolvedValue({ ...fila });
        prisma.asistente_funcion.update.mockResolvedValue({ ...fila, topeTurnoUsd: 0.25, limiteDiarioUsuario: 20 });
        const r = await svc.actualizarFuncion('reportes', { topeTurnoUsd: 0.25, limiteDiarioUsuario: 20 }, 1);
        expect(prisma.asistente_funcion.update.mock.calls[0][0].data).toEqual({ topeTurnoUsd: 0.25, limiteDiarioUsuario: 20 });
        expect(r).toMatchObject({ topeTurnoUsd: 0.25, limiteDiarioUsuario: 20 });
        const audit = (svc as any).auditoria.log;
        expect(audit).toHaveBeenCalled();
    });
});
