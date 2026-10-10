import { BadRequestException, Logger } from '@nestjs/common';
import { ImportsProcessor } from './imports.processor';

describe('ImportsProcessor', () => {
    beforeAll(() => Logger.overrideLogger(false));
    afterEach(() => jest.restoreAllMocks());

    const armar = (processImportJob: jest.Mock) => {
        const importService: any = { processImportJob };
        const auditoria: any = { log: jest.fn().mockResolvedValue(undefined) };
        const requestContext: any = { run: (_ctx: unknown, fn: () => unknown) => fn() };
        const processor = new ImportsProcessor(importService, auditoria, requestContext);
        const job: any = { id: 'j1', queueName: 'import-queue', data: { remesaId: 1, usuarioId: 3 } };
        return { processor, auditoria, job };
    };

    it('una importación completada se loguea y se audita IMPORT_OK', async () => {
        const h = armar(jest.fn().mockResolvedValue({ total: 5, ok: 5, err: 0 }));
        await h.processor.process(h.job);
        expect(h.auditoria.log).toHaveBeenCalledTimes(1);
        expect(h.auditoria.log.mock.calls[0][0].resumen).toBe('Import OK remesa 1');
    });

    it('G6: un job ignorado por las guardas no se audita como OK ni se loguea como completado', async () => {
        const log = jest.spyOn(Logger.prototype, 'log');
        const warn = jest.spyOn(Logger.prototype, 'warn');
        const h = armar(jest.fn().mockResolvedValue({ total: 0, ok: 0, err: 0, ignorado: true }));

        await expect(h.processor.process(h.job)).resolves.toMatchObject({ ignorado: true });

        expect(h.auditoria.log).not.toHaveBeenCalled();
        expect(log.mock.calls.some(([m]) => String(m).includes('completada'))).toBe(false);
        expect(warn.mock.calls.some(([m]) => String(m).includes('Job ignorado'))).toBe(true);
    });

    it('G6: un error de negocio se loguea como warn (sin stack) y uno inesperado como error, sin repetir el stack', async () => {
        const error = jest.spyOn(Logger.prototype, 'error');
        const warn = jest.spyOn(Logger.prototype, 'warn');

        const negocio = armar(jest.fn().mockRejectedValue(new BadRequestException('plantilla sin estado inicial')));
        await expect(negocio.processor.process(negocio.job)).rejects.toThrow(BadRequestException);
        expect(error).not.toHaveBeenCalled();
        expect(warn.mock.calls.some(([m]) => String(m).includes('plantilla sin estado inicial'))).toBe(true);
        expect(negocio.auditoria.log.mock.calls[0][0].resumen).toBe('Import FAIL remesa 1');

        const inesperado = armar(jest.fn().mockRejectedValue(new Error('boom')));
        await expect(inesperado.processor.process(inesperado.job)).rejects.toThrow('boom');
        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0]).toHaveLength(1); // sin stack: ya lo logueó el service
    });
});

// ── Fase B (docs/imports-progreso-realtime-spec.md §9.9.2 G) ────────────────────────────────────────
import * as fs from 'fs';
import * as path from 'path';
import { OPCIONES_WORKER_IMPORT } from './imports.processor';

describe('ImportsProcessor — política de BullMQ de la Fase B', () => {
    beforeAll(() => Logger.overrideLogger(false));
    afterEach(() => jest.restoreAllMocks());

    it('OPCIONES_WORKER_IMPORT vale exactamente lo que dice el diseño', () => {
        expect(OPCIONES_WORKER_IMPORT).toEqual({
            concurrency: 1,
            lockDuration: 120000,
            stalledInterval: 30000,
            maxStalledCount: 0,
        });
    });

    it('el worker se declara con esas opciones (metadata de @Processor)', () => {
        const { PROCESSOR_METADATA, WORKER_METADATA } = jest.requireActual('@nestjs/bullmq/dist/bull.constants');
        const meta = Reflect.getMetadata(PROCESSOR_METADATA, ImportsProcessor);
        expect(meta).toMatchObject({ name: 'import-queue' });
        expect(Reflect.getMetadata(WORKER_METADATA, ImportsProcessor)).toEqual(OPCIONES_WORKER_IMPORT);
    });

    it('la cola se registra con attempts: 1 por defecto', () => {
        const fuente = fs.readFileSync(path.join(__dirname, '..', 'imports.module.ts'), 'utf8');
        expect(fuente).toMatch(/name: 'import-queue',[\s\S]*defaultJobOptions: \{ attempts: 1 \}/);
    });

    describe('listeners', () => {
        const armar = () => {
            const importService: any = new Proxy({}, {
                get: (_t, prop) => { throw new Error(`no debería llamar a ImportService.${String(prop)}`); },
            });
            const auditoria: any = { log: jest.fn() };
            const requestContext: any = { run: jest.fn() };
            return { processor: new ImportsProcessor(importService, auditoria, requestContext), auditoria };
        };

        it('stalled: warn con el id del job, sin llamar a nada del service', () => {
            const warn = jest.spyOn(Logger.prototype, 'warn');
            const h = armar();
            h.processor.onStalled('144');
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain('144');
            expect(h.auditoria.log).not.toHaveBeenCalled();
        });

        it('error: warn con el mensaje', () => {
            const warn = jest.spyOn(Logger.prototype, 'warn');
            armar().processor.onError(new Error('Missing lock for job 1. moveToFinished'));
            expect(String(warn.mock.calls[0][0])).toContain('Missing lock for job 1');
        });

        it('failed: solo loguea si el mensaje dice stalled', () => {
            const warn = jest.spyOn(Logger.prototype, 'warn');
            const h = armar();
            h.processor.onFailed({ id: '9', data: { remesaId: 7 } } as any, new Error('boom'));
            expect(warn).not.toHaveBeenCalled();
            h.processor.onFailed({ id: '9', data: { remesaId: 7 } } as any, new Error('job stalled more than allowable limit'));
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toMatch(/job 9 \(remesa 7\).*reaper/);
            // No afirma lo que no sabe: tras congelarse el proceso, la carga puede haber terminado.
            expect(String(warn.mock.calls[0][0])).not.toMatch(/sin ejecutarse|no se ejecut/i);
            expect(String(warn.mock.calls[0][0])).toContain('si la carga no terminó');
            h.processor.onFailed(undefined, new Error('job stalled more than allowable limit'));
            expect(warn).toHaveBeenCalledTimes(2);
        });
    });
});

// ── Fase C, entrega 1 (docs/imports-progreso-realtime-spec.md §10.5.3 y §10.9.2 E) ───────────────────
describe('ImportsProcessor — una carga cancelada', () => {
    beforeAll(() => Logger.overrideLogger(false));
    afterEach(() => jest.restoreAllMocks());

    const armarCancelada = (resultado: Record<string, unknown>) => {
        const importService: any = { processImportJob: jest.fn().mockResolvedValue(resultado) };
        const auditoria: any = { log: jest.fn().mockResolvedValue(undefined) };
        const requestContext: any = { run: (_ctx: unknown, fn: () => unknown) => fn() };
        const processor = new ImportsProcessor(importService, auditoria, requestContext);
        const job: any = { id: 'j7', queueName: 'import-queue', data: { remesaId: 5, usuarioId: 3 } };
        return { processor, auditoria, job };
    };

    it('no se loguea como completada, no se audita IMPORT_OK y devuelve el resultado tal cual', async () => {
        const log = jest.spyOn(Logger.prototype, 'log');
        const warn = jest.spyOn(Logger.prototype, 'warn');
        const h = armarCancelada({ total: 2500, ok: 1290, err: 10, cancelada: true });

        await expect(h.processor.process(h.job)).resolves.toEqual({ total: 2500, ok: 1290, err: 10, cancelada: true });

        // La auditoría del corte la escribe el runner (IMPORT_FAIL, WARN): acá no se audita nada.
        expect(h.auditoria.log).not.toHaveBeenCalled();
        expect(log.mock.calls.some(([m]) => String(m).includes('completada'))).toBe(false);
        expect(warn.mock.calls.some(([m]) => String(m).includes('Importación cancelada remesa=5 job=j7'))).toBe(true);
    });

    it('no relanza: BullMQ lo ve como un job terminado', async () => {
        const h = armarCancelada({ total: 0, ok: 0, err: 0, cancelada: true });
        await expect(h.processor.process(h.job)).resolves.toBeDefined();
    });

    it('una importación normal sigue auditando IMPORT_OK (el resultado sin `cancelada`)', async () => {
        const h = armarCancelada({ total: 5, ok: 5, err: 0 });
        await h.processor.process(h.job);
        expect(h.auditoria.log).toHaveBeenCalledTimes(1);
        expect(h.auditoria.log.mock.calls[0][0].resumen).toBe('Import OK remesa 5');
    });
});
