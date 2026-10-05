import { Logger } from '@nestjs/common';
import { CargaInfo, ProgresoTracker } from './progreso-tracker';

const INFO: CargaInfo = {
    remesaId: 1, numeroRemesa: '00001', nombre: 'Carga', empresaId: 10, tipo: 'DEUDORES',
    usuarioId: 3, usuarioNombre: 'Maxi', totalFilasVistaPrevia: 100,
};

function armar(opts: { updateFalla?: (data: any) => boolean; emitFalla?: boolean } = {}) {
    const orden: string[] = [];
    let rev = 0;
    const prisma: any = {
        remesa: {
            update: jest.fn().mockImplementation(({ data }: any) => {
                if (opts.updateFalla?.(data)) { orden.push('update!'); return Promise.reject(new Error('base caída')); }
                orden.push('update');
                rev++;
                return Promise.resolve({ progreso: { rev } });
            }),
        },
    };
    const emitir = (nombre: string) => jest.fn().mockImplementation(() => {
        orden.push(nombre);
        if (opts.emitFalla) throw new Error('socket caído');
    });
    const realtime: any = {
        emitImportIniciada: emitir('iniciada'),
        emitImportProgreso: emitir('progreso'),
        emitImportFinalizada: emitir('finalizada'),
    };
    const logger = new Logger('test');
    const warn = jest.spyOn(logger, 'warn').mockImplementation();
    const error = jest.spyOn(logger, 'error').mockImplementation();
    const tracker = new ProgresoTracker({ prisma, realtime, logger }, INFO, null);
    return { tracker, prisma, realtime, orden, warn, error };
}

const dataDe = (h: ReturnType<typeof armar>, i: number) => h.prisma.remesa.update.mock.calls[i][0].data;

describe('ProgresoTracker', () => {
    it('iniciar persiste y recién después emite iniciada, con intento 1 y el total de la vista previa', async () => {
        const h = armar();
        await h.tracker.iniciar('job-1');
        expect(h.orden).toEqual(['update', 'iniciada']);
        expect(h.realtime.emitImportIniciada.mock.calls[0][0]).toMatchObject({
            fase: 'PROCESANDO', intentos: 1, totalEsperado: 100, procesadas: 0, rev: 1,
        });
        expect(dataDe(h, 0)).toMatchObject({ estadoProceso: 'PROCESANDO', okFilas: 0, errFilas: 0 });
    });

    it('lote persiste ANTES de emitir y no toca remesa.totalFilas', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.orden.length = 0;
        await h.tracker.lote({ ok: 40, err: 10, descartadas: 2 });
        expect(h.orden).toEqual(['update', 'progreso']);
        expect(dataDe(h, 1)).not.toHaveProperty('totalFilas');
        expect(dataDe(h, 1)).toMatchObject({ okFilas: 40, errFilas: 10 });
        expect(dataDe(h, 1).progreso.upsert.update).toMatchObject({ procesadas: 50, porcentaje: 50, descartadas: 2, rev: { increment: 1 } });
    });

    it('lote deja pasar el error de la base y no emite', async () => {
        const h = armar({ updateFalla: (d) => d.okFilas === 5 });
        await h.tracker.iniciar('j');
        h.orden.length = 0;
        await expect(h.tracker.lote({ ok: 5, err: 0, descartadas: 0 })).rejects.toThrow('base caída');
        expect(h.orden).toEqual(['update!']);
    });

    it('finalizar persiste ANTES de emitir finalizada, una sola vez, y es idempotente', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        h.orden.length = 0;
        const estado = await h.tracker.finalizar({ ok: 90, err: 10, descartadas: 0, errorPostProceso: null });
        expect(h.orden).toEqual(['update', 'finalizada']);
        expect(estado).toMatchObject({ resultado: 'CON_ERRORES', progreso: 100, terminal: true, procesadas: 100 });
        expect(dataDe(h, 1)).toMatchObject({ estadoProceso: 'FINALIZADA', totalFilas: 100 });

        await h.tracker.finalizar({ ok: 1, err: 0, descartadas: 0, errorPostProceso: null });
        expect(h.prisma.remesa.update).toHaveBeenCalledTimes(2);
        expect(h.realtime.emitImportFinalizada).toHaveBeenCalledTimes(1);
    });

    it('finalizar con errorPostProceso es CON_ADVERTENCIAS', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        const estado = await h.tracker.finalizar({ ok: 10, err: 0, descartadas: 0, errorPostProceso: 'deadlock' });
        expect(estado).toMatchObject({ resultado: 'CON_ADVERTENCIAS', errorPostProceso: 'deadlock' });
    });

    it('si finalizar no puede persistir, tira y no emite finalizada', async () => {
        const h = armar({ updateFalla: (d) => d.estadoProceso === 'FINALIZADA' });
        await h.tracker.iniciar('j');
        await expect(h.tracker.finalizar({ ok: 1, err: 0, descartadas: 0, errorPostProceso: null })).rejects.toThrow('base caída');
        expect(h.realtime.emitImportFinalizada).not.toHaveBeenCalled();
    });

    describe('fallar', () => {
        it('escribe los ok/err reales hasta el corte, persiste antes de emitir y conserva el porcentaje', async () => {
            const h = armar();
            await h.tracker.iniciar('j');
            h.orden.length = 0;
            const estado = await h.tracker.fallar(new Error('se cortó'), { ok: 30, err: 0, descartadas: 0 });
            expect(h.orden).toEqual(['update', 'finalizada']);
            expect(dataDe(h, 1)).toMatchObject({ estadoProceso: 'FALLIDA', okFilas: 30, errFilas: 0 });
            expect(estado).toMatchObject({ resultado: 'FALLIDA', error: 'se cortó', ok: 30, procesadas: 30, progreso: 30 });
            expect(h.tracker.noSePudoRegistrar).toBe(false);
        });

        it('no tira ni emite cuando no puede escribir: lo loguea con stack y devuelve igual el estado', async () => {
            const h = armar({ updateFalla: (d) => d.estadoProceso === 'FALLIDA' });
            await h.tracker.iniciar('j');
            const estado = await h.tracker.fallar(new Error('x'), { ok: 0, err: 0, descartadas: 0 });
            expect(h.realtime.emitImportFinalizada).not.toHaveBeenCalled();
            expect(h.error).toHaveBeenCalledTimes(1);
            expect(h.error.mock.calls[0][1]).toEqual(expect.any(String));
            expect(h.tracker.noSePudoRegistrar).toBe(true);
            expect(estado.resultado).toBe('FALLIDA');
        });

        it('no pisa un estado terminal ya persistido', async () => {
            const h = armar();
            await h.tracker.iniciar('j');
            await h.tracker.finalizar({ ok: 10, err: 0, descartadas: 0, errorPostProceso: null });
            const estado = await h.tracker.fallar(new Error('tarde'), { ok: 0, err: 0, descartadas: 0 });
            expect(h.prisma.remesa.update).toHaveBeenCalledTimes(2);
            expect(h.realtime.emitImportFinalizada).toHaveBeenCalledTimes(1);
            expect(estado.resultado).toBe('OK');
            expect(h.error).toHaveBeenCalled();
        });

        it('guarda un motivo legible para un error de Prisma', async () => {
            const h = armar();
            await h.tracker.iniciar('j');
            const e: any = new Error('Invalid `prisma.x.create()` invocation in\n/app/x.js:1\n\nUnique constraint failed on the constraint: `K`');
            e.code = 'P2002';
            const estado = await h.tracker.fallar(e, { ok: 0, err: 0, descartadas: 0 });
            expect(estado.error).toBe('Unique constraint failed on the constraint: `K` (P2002)');
        });
    });

    it('un emisor de socket que tira nunca tumba al tracker', async () => {
        const h = armar({ emitFalla: true });
        await expect(h.tracker.iniciar('j')).resolves.toBeUndefined();
        await expect(h.tracker.lote({ ok: 1, err: 0, descartadas: 0 })).resolves.toBeUndefined();
        await expect(h.tracker.finalizar({ ok: 1, err: 0, descartadas: 0, errorPostProceso: null })).resolves.toMatchObject({ resultado: 'OK' });
        expect(h.warn).toHaveBeenCalled();
    });

    it('con un update que devuelve {} (mocks viejos) el rev sigue creciendo en memoria', async () => {
        const h = armar();
        h.prisma.remesa.update.mockResolvedValue({});
        await h.tracker.iniciar('j');
        await h.tracker.lote({ ok: 1, err: 0, descartadas: 0 });
        expect(h.realtime.emitImportProgreso.mock.calls[0][0].rev).toBe(2);
    });

    it('entrarEnPostProceso pone la fase POST_PROCESO sin cambiar el porcentaje', async () => {
        const h = armar();
        await h.tracker.iniciar('j');
        await h.tracker.lote({ ok: 100, err: 0, descartadas: 0 });
        await h.tracker.entrarEnPostProceso();
        expect(h.realtime.emitImportProgreso.mock.calls[1][0]).toMatchObject({ fase: 'POST_PROCESO', progreso: 99 });
    });
});
