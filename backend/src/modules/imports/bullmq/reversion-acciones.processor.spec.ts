import { Logger } from '@nestjs/common';
import { OPCIONES_WORKER_REVERSION, ReversionAccionesProcessor } from './reversion-acciones.processor';
import { COLA_REVERSION } from '../reversion/reversion-accion.reglas';
import * as fs from 'fs';
import * as path from 'path';

describe('ReversionAccionesProcessor', () => {
    beforeAll(() => Logger.overrideLogger(false));
    afterEach(() => jest.restoreAllMocks());

    const armar = (ejecutar: jest.Mock) => {
        const requestContext: any = { run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) };
        const processor = new ReversionAccionesProcessor({ ejecutar } as never, requestContext);
        const job: any = { id: 'revertir-5-2', queueName: COLA_REVERSION, data: { remesaId: 5, usuarioId: 9, _ctx: { requestId: 'abc123' } } };
        return { processor, job, requestContext };
    };

    it('ejecuta la reversión con el id del job y propaga el requestId del pedido', async () => {
        const ejecutar = jest.fn().mockResolvedValue(undefined);
        const h = armar(ejecutar);

        await h.processor.process(h.job);

        expect(ejecutar).toHaveBeenCalledWith(5, 'revertir-5-2');
        expect(h.requestContext.run.mock.calls[0][0]).toMatchObject({ requestId: 'abc123', usuarioId: 9, source: 'bull', jobId: 'revertir-5-2', queue: COLA_REVERSION });
    });

    it('re-lanza el error (si no, BullMQ no marca el job como fallido)', async () => {
        const h = armar(jest.fn().mockRejectedValue(new Error('se cayó la base')));
        await expect(h.processor.process(h.job)).rejects.toThrow('se cayó la base');
    });

    it('sin remesaId en el job, falla', async () => {
        const h = armar(jest.fn());
        h.job.data = {};
        await expect(h.processor.process(h.job)).rejects.toThrow('remesaId es requerido');
    });

    it('opciones del worker: de a una, lock de 2 min, un job de un worker muerto NO se vuelve a ejecutar (D4)', () => {
        expect(OPCIONES_WORKER_REVERSION).toEqual({ concurrency: 1, lockDuration: 120_000, stalledInterval: 30_000, maxStalledCount: 0 });
    });

    it('es una cola propia, distinta de la de importaciones, y el processor la usa con esas opciones', () => {
        expect(COLA_REVERSION).toBe('acciones-revertir-queue');
        expect(COLA_REVERSION).not.toBe('import-queue');
        const fuente = fs.readFileSync(path.join(__dirname, 'reversion-acciones.processor.ts'), 'utf8');
        expect(fuente).toMatch(/@Processor\(COLA_REVERSION, OPCIONES_WORKER_REVERSION\)/);
        const modulo = fs.readFileSync(path.join(__dirname, '..', 'imports.module.ts'), 'utf8');
        expect(modulo).toMatch(/name: COLA_REVERSION,\s*defaultJobOptions: \{ attempts: 1 \}/);
        expect(modulo).toMatch(/ReversionAccionesService, ReversionAccionesProcessor/);
    });

    it('loguea stalled, error y failed sin escribir en la base', () => {
        const warn = jest.spyOn(Logger.prototype, 'warn');
        const h = armar(jest.fn());
        h.processor.onStalled('revertir-5-2');
        h.processor.onError(new Error('x'));
        h.processor.onFailed(h.job, new Error('y'));
        expect(warn).toHaveBeenCalledTimes(3);
    });
});
