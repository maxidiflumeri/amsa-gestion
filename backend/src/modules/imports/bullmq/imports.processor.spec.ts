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
