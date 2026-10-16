import { Logger } from '@nestjs/common';
import {
    MAX_TANDAS_LIMPIEZA,
    NotificacionesLimpiezaService,
    TANDA_LIMPIEZA,
} from './notificaciones-limpieza.service';

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date('2026-10-16T08:00:00.000Z');
const VARS = [
    'NOTIFICACIONES_RETENCION_LEIDAS_DIAS',
    'NOTIFICACIONES_RETENCION_NO_LEIDAS_DIAS',
    'NOTIFICACIONES_LIMPIEZA_DESACTIVADA',
];

type Fila = { id: number; usuarioId: number; leida: boolean };
const filas = (n: number, usuarioId = 3, leida = true, desde = 1): Fila[] =>
    Array.from({ length: n }, (_, i) => ({ id: desde + i, usuarioId, leida }));

function armar(tandas: Fila[][], borrados?: number[]) {
    const findMany = jest.fn();
    for (const t of tandas) findMany.mockResolvedValueOnce(t);
    findMany.mockResolvedValue([]);
    const deleteMany = jest.fn();
    tandas.forEach((t, i) => deleteMany.mockResolvedValueOnce({ count: borrados?.[i] ?? t.length }));
    deleteMany.mockResolvedValue({ count: 0 });
    const prisma: any = { notificacion: { findMany, deleteMany } };
    const notificaciones: any = { emitirContador: jest.fn().mockResolvedValue(undefined) };
    return { service: new NotificacionesLimpiezaService(prisma, notificaciones), findMany, deleteMany, notificaciones };
}

describe('NotificacionesLimpiezaService', () => {
    let warn: jest.SpyInstance;
    let error: jest.SpyInstance;

    beforeEach(() => {
        for (const v of VARS) delete process.env[v];
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    });
    afterEach(() => {
        for (const v of VARS) delete process.env[v];
        jest.restoreAllMocks();
    });

    it('L-1: la condición tiene las tres ramas con lt, y los bordes de 30 y 180 días', () => {
        const { service } = armar([]);
        const c = service.condicion(AHORA) as any;
        const limite30 = new Date(AHORA.getTime() - 30 * DIA);
        const limite180 = new Date(AHORA.getTime() - 180 * DIA);
        expect(c.OR).toEqual([
            { leida: true, leidaEn: { lt: limite30 } },
            { leida: true, leidaEn: null, creadoEn: { lt: limite30 } },
            { leida: false, creadoEn: { lt: limite180 } },
        ]);

        // Semántica del `lt`: exactamente 30 días no entra; 30 días y 1 ms, sí.
        const entra = (fecha: Date, limite: Date) => fecha.getTime() < limite.getTime();
        expect(entra(new Date(AHORA.getTime() - 30 * DIA), limite30)).toBe(false);
        expect(entra(new Date(AHORA.getTime() - 30 * DIA - 1), limite30)).toBe(true);
        // Leída hace 10 días y creada hace 200: la rama de leídas mira `leidaEn`, no `creadoEn`.
        expect(entra(new Date(AHORA.getTime() - 10 * DIA), limite30)).toBe(false);
        // Leída sin `leidaEn` y creada hace 31 días: entra por la segunda rama.
        expect(entra(new Date(AHORA.getTime() - 31 * DIA), limite30)).toBe(true);
    });

    it('L-1: respeta las retenciones del entorno', () => {
        process.env.NOTIFICACIONES_RETENCION_LEIDAS_DIAS = '7';
        process.env.NOTIFICACIONES_RETENCION_NO_LEIDAS_DIAS = '90';
        const { service } = armar([]);
        const c = service.condicion(AHORA) as any;
        expect(c.OR[0].leidaEn.lt).toEqual(new Date(AHORA.getTime() - 7 * DIA));
        expect(c.OR[2].creadoEn.lt).toEqual(new Date(AHORA.getTime() - 90 * DIA));
    });

    it('L-2: tandas de 1.000, 1.000 y 3 hacen tres deleteMany, borran 2.003 y cortan', async () => {
        const { service, findMany, deleteMany } = armar([
            filas(TANDA_LIMPIEZA, 3, true, 1),
            filas(TANDA_LIMPIEZA, 3, true, 1001),
            filas(3, 3, true, 2001),
        ]);
        const r = await service.limpiar(AHORA);
        expect(deleteMany).toHaveBeenCalledTimes(3);
        expect(findMany).toHaveBeenCalledTimes(3);
        expect(r).toMatchObject({ borradas: 2003, leidas: 2003, noLeidas: 0, tandas: 3, topeAlcanzado: false });
    });

    it('L-3: con tandas siempre llenas corta a las 50, avisa y marca el tope', async () => {
        const { service, deleteMany } = armar(
            Array.from({ length: MAX_TANDAS_LIMPIEZA + 5 }, (_, i) => filas(TANDA_LIMPIEZA, 3, true, i * TANDA_LIMPIEZA + 1)),
        );
        const r = await service.limpiar(AHORA);
        expect(deleteMany).toHaveBeenCalledTimes(MAX_TANDAS_LIMPIEZA);
        expect(r.topeAlcanzado).toBe(true);
        expect(r.borradas).toBe(MAX_TANDAS_LIMPIEZA * TANDA_LIMPIEZA);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('tope'));
    });

    it('L-4: una tanda que lee 1.000 y borra 0 corta con un warn y no repite', async () => {
        const { service, findMany, deleteMany } = armar([filas(TANDA_LIMPIEZA)], [0]);
        findMany.mockResolvedValue(filas(TANDA_LIMPIEZA)); // si repitiera, devolvería lo mismo siempre
        const r = await service.limpiar(AHORA);
        expect(deleteMany).toHaveBeenCalledTimes(1);
        expect(r.borradas).toBe(0);
        expect(r.topeAlcanzado).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no borró ninguna'));
    });

    it('L-5: emite el contador solo a quienes perdieron no leídas', async () => {
        const { service, notificaciones } = armar([
            [...filas(2, 3, true, 1), ...filas(1, 4, false, 10), ...filas(2, 5, false, 20), ...filas(1, 4, false, 30)],
        ]);
        const r = await service.limpiar(AHORA);
        expect(notificaciones.emitirContador).toHaveBeenCalledTimes(2);
        expect(notificaciones.emitirContador).toHaveBeenCalledWith(4);
        expect(notificaciones.emitirContador).toHaveBeenCalledWith(5);
        expect(notificaciones.emitirContador).not.toHaveBeenCalledWith(3);
        expect(r).toMatchObject({ leidas: 2, noLeidas: 4, usuarios: 2 });
    });

    it('L-6: el where del deleteMany es AND de id in y la condición', async () => {
        const { service, deleteMany } = armar([filas(3)]);
        await service.limpiar(AHORA);
        expect(deleteMany).toHaveBeenCalledWith({
            where: { AND: [{ id: { in: [1, 2, 3] } }, service.condicion(AHORA)] },
        });
    });

    it.each(['0', 'abc', '', '-5', '1.5', '1e1', '0x10'])('L-7: la variable inválida %p usa el default con un warn', (valor) => {
        process.env.NOTIFICACIONES_RETENCION_LEIDAS_DIAS = valor;
        process.env.NOTIFICACIONES_RETENCION_NO_LEIDAS_DIAS = valor;
        const { service } = armar([]);
        expect(service.retencionLeidasDias()).toBe(30);
        expect(service.retencionNoLeidasDias()).toBe(180);
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('L-7: el warn de un valor inválido sale una sola vez, aunque se lea muchas veces (auditoría Fase D)', async () => {
        process.env.NOTIFICACIONES_RETENCION_LEIDAS_DIAS = 'abc';
        const { service } = armar([]);
        service.onModuleInit();
        await service.limpiar(AHORA);
        await service.limpiar(AHORA);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('borradas sale de lo que borró el deleteMany, no de las candidatas leídas (auditoría Fase D)', async () => {
        const filas = [
            { id: 1, usuarioId: 5, leida: false },
            { id: 2, usuarioId: 5, leida: false },
            { id: 3, usuarioId: 6, leida: true },
        ];
        const { service } = armar([filas], [2]);
        const r = await service.limpiar(AHORA);
        expect(r.borradas).toBe(2);
        expect(r.leidas + r.noLeidas).toBe(3);
    });

    it('L-7: sin variables usa los defaults sin warn', () => {
        const { service } = armar([]);
        expect(service.retencionLeidasDias()).toBe(30);
        expect(service.retencionNoLeidasDias()).toBe(180);
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(['sí', 'si', '1', 'true', 'YES'])('L-7: DESACTIVADA=%p no consulta nada', async (valor) => {
        process.env.NOTIFICACIONES_LIMPIEZA_DESACTIVADA = valor;
        const { service, findMany, deleteMany } = armar([filas(3)]);
        const r = await service.limpiar(AHORA);
        expect(findMany).not.toHaveBeenCalled();
        expect(deleteMany).not.toHaveBeenCalled();
        expect(r.borradas).toBe(0);
    });

    it.each(['false', '0', ''])('DESACTIVADA=%p no apaga la limpieza', async (valor) => {
        process.env.NOTIFICACIONES_LIMPIEZA_DESACTIVADA = valor;
        const { service, findMany } = armar([]);
        await service.limpiar(AHORA);
        expect(findMany).toHaveBeenCalled();
    });

    it('L-8: si findMany tira, el método del cron loguea un error con stack y no tira', async () => {
        const { service, findMany } = armar([]);
        const falla = new Error('conexión perdida');
        findMany.mockReset();
        findMany.mockRejectedValue(falla);
        await expect(service.limpiezaNocturna()).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('conexión perdida'), falla.stack);
    });

    it('onModuleInit dice si está activa o desactivada', () => {
        const log = Logger.prototype.log as unknown as jest.SpyInstance;
        const { service } = armar([]);
        service.onModuleInit();
        expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Limpieza de notificaciones activa: todos los días a las 05:00, leídas a los 30 días, sin leer a los 180'));
        process.env.NOTIFICACIONES_LIMPIEZA_DESACTIVADA = '1';
        service.onModuleInit();
        expect(log).toHaveBeenLastCalledWith(expect.stringContaining('desactivada'));
    });
});
