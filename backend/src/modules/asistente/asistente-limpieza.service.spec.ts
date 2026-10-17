import { Logger } from '@nestjs/common';
import {
    AsistenteLimpiezaService,
    MAX_TANDAS_LIMPIEZA_ASISTENTE,
    RETENCION_LLAMADAS_DIAS,
    TANDA_LIMPIEZA_ASISTENTE,
} from './asistente-limpieza.service';

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date('2026-10-16T08:00:00.000Z');
const VARS = ['ASISTENTE_RETENCION_DIAS', 'ASISTENTE_LIMPIEZA_DESACTIVADA'];

function armar(tandas: number[]) {
    const findMany = jest.fn();
    for (const n of tandas) findMany.mockResolvedValueOnce(Array.from({ length: n }, (_, i) => ({ id: i + 1 })));
    findMany.mockResolvedValue([]);
    const deleteMany = jest.fn();
    for (const n of tandas) deleteMany.mockResolvedValueOnce({ count: n });
    deleteMany.mockResolvedValue({ count: 0 });
    const borrarLlamadas = jest.fn().mockResolvedValue({ count: 4 });
    const prisma: any = {
        asistente_conversacion: { findMany, deleteMany },
        asistente_llamada: { deleteMany: borrarLlamadas },
    };
    return { svc: new AsistenteLimpiezaService(prisma), findMany, deleteMany, borrarLlamadas };
}

describe('AsistenteLimpiezaService', () => {
    beforeEach(() => {
        for (const v of VARS) delete process.env[v];
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => {
        for (const v of VARS) delete process.env[v];
        jest.restoreAllMocks();
    });

    it('borra las conversaciones de más de 90 días (por updatedAt) y las llamadas de más de 400', async () => {
        const { svc, findMany, borrarLlamadas } = armar([3]);
        const r = await svc.limpiar(AHORA);
        expect(r).toMatchObject({ conversaciones: 3, llamadas: 4, tandas: 1, topeAlcanzado: false });
        expect(findMany.mock.calls[0][0].where).toEqual({ updatedAt: { lt: new Date(AHORA.getTime() - 90 * DIA) } });
        expect(borrarLlamadas).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(AHORA.getTime() - RETENCION_LLAMADAS_DIAS * DIA) } } });
    });

    it('borra por tandas de 500 hasta que una no viene llena', async () => {
        const { svc, deleteMany } = armar([TANDA_LIMPIEZA_ASISTENTE, TANDA_LIMPIEZA_ASISTENTE, 12]);
        const r = await svc.limpiar(AHORA);
        expect(r.conversaciones).toBe(1012);
        expect(r.tandas).toBe(3);
        expect(deleteMany).toHaveBeenCalledTimes(3);
    });

    it('tope de 40 tandas: avisa y el resto queda para mañana', async () => {
        const { svc } = armar(Array(MAX_TANDAS_LIMPIEZA_ASISTENTE + 5).fill(TANDA_LIMPIEZA_ASISTENTE));
        const r = await svc.limpiar(AHORA);
        expect(r.tandas).toBe(MAX_TANDAS_LIMPIEZA_ASISTENTE);
        expect(r.topeAlcanzado).toBe(true);
        expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('tope'));
    });

    it('el borrado de conversaciones vuelve a chequear la condición (una que se actualizó en el medio no se borra)', async () => {
        const { svc, deleteMany } = armar([2]);
        await svc.limpiar(AHORA);
        expect(deleteMany.mock.calls[0][0].where.updatedAt).toEqual({ lt: new Date(AHORA.getTime() - 90 * DIA) });
        expect(deleteMany.mock.calls[0][0].where.id).toEqual({ in: [1, 2] });
    });

    it('ASISTENTE_RETENCION_DIAS cambia la retención; un valor inválido vuelve al default con aviso', async () => {
        process.env.ASISTENTE_RETENCION_DIAS = '30';
        const a = armar([1]);
        await a.svc.limpiar(AHORA);
        expect(a.findMany.mock.calls[0][0].where.updatedAt.lt).toEqual(new Date(AHORA.getTime() - 30 * DIA));

        process.env.ASISTENTE_RETENCION_DIAS = 'abc';
        expect(armar([]).svc.retencionDias()).toBe(90);
        expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('ASISTENTE_RETENCION_DIAS'));
    });

    it.each(['1', 'true', 'si', 'sí', 'YES'])('ASISTENTE_LIMPIEZA_DESACTIVADA=%s: no hace nada', async (valor) => {
        process.env.ASISTENTE_LIMPIEZA_DESACTIVADA = valor;
        const { svc, findMany, borrarLlamadas } = armar([5]);
        await expect(svc.limpiar(AHORA)).resolves.toMatchObject({ conversaciones: 0, llamadas: 0 });
        expect(findMany).not.toHaveBeenCalled();
        expect(borrarLlamadas).not.toHaveBeenCalled();
    });

    it('vacío o false la dejan encendida', async () => {
        for (const v of ['', 'false', '0']) {
            process.env.ASISTENTE_LIMPIEZA_DESACTIVADA = v;
            const { svc, findMany } = armar([1]);
            await svc.limpiar(AHORA);
            expect(findMany).toHaveBeenCalled();
        }
    });

    it('la corrida nocturna no tira si la base falla', async () => {
        const { svc, findMany } = armar([]);
        findMany.mockReset();
        findMany.mockRejectedValue(new Error('db'));
        await expect(svc.limpiezaNocturna()).resolves.toBeUndefined();
        expect(Logger.prototype.error).toHaveBeenCalled();
    });
});
