import { Logger } from '@nestjs/common';
import { cerrarRedisAcotado } from './cerrar-redis';
import { NeotelRedisService } from '../../modules/neotel/neotel-redis.service';
import { ConsolidacionRedisLockService } from '../../modules/consolidacion/consolidacion-redis-lock.service';

const falso = (status: string, quit: () => Promise<unknown>) => ({ status, quit: jest.fn(quit), disconnect: jest.fn() }) as any;

describe('cerrarRedisAcotado', () => {
    const logger = new Logger('test');
    beforeEach(() => {
        jest.spyOn(logger, 'log').mockImplementation();
        jest.spyOn(logger, 'warn').mockImplementation();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('conectado: quit() y después disconnect()', async () => {
        const c = falso('ready', async () => 'OK');
        await cerrarRedisAcotado(c, 'lock', logger);
        expect(c.quit).toHaveBeenCalledTimes(1);
        expect(c.disconnect).toHaveBeenCalledTimes(1);
    });

    it('quit() que nunca resuelve: a los 2 s corta con disconnect()', async () => {
        jest.useFakeTimers();
        const c = falso('reconnecting', () => new Promise(() => undefined));
        const p = cerrarRedisAcotado(c, 'lock', logger);
        await jest.advanceTimersByTimeAsync(1999);
        expect(c.disconnect).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(2);
        await p;
        expect(c.disconnect).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('quit() no respondió'));
    });

    it('quit() que rechaza: warn y disconnect()', async () => {
        const c = falso('ready', async () => { throw new Error('Connection is closed'); });
        await cerrarRedisAcotado(c, 'lock', logger);
        expect(c.disconnect).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalled();
    });

    it("status 'wait' (nunca conectó) o 'end': disconnect() sin quit()", async () => {
        for (const status of ['wait', 'end']) {
            const c = falso(status, async () => 'OK');
            await cerrarRedisAcotado(c, 'lock', logger);
            expect(c.quit).not.toHaveBeenCalled();
            expect(c.disconnect).toHaveBeenCalledTimes(1);
        }
    });

    it('sin cliente (onModuleInit no corrió) no tira', async () => {
        await expect(cerrarRedisAcotado(undefined, 'lock', logger)).resolves.toBeUndefined();
    });
});

describe('los servicios de Redis cierran con el helper acotado', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('NeotelRedisService con status wait: disconnect() sin quit()', async () => {
        const s = new NeotelRedisService({ get: jest.fn() } as any);
        const c = falso('wait', async () => 'OK');
        (s as any).client = c;
        await s.onModuleDestroy();
        expect(c.quit).not.toHaveBeenCalled();
        expect(c.disconnect).toHaveBeenCalled();
    });

    it('ConsolidacionRedisLockService con quit() colgado: a los 2 s, disconnect()', async () => {
        jest.useFakeTimers();
        const s = new ConsolidacionRedisLockService({ get: jest.fn() } as any);
        const c = falso('ready', () => new Promise(() => undefined));
        (s as any).client = c;
        const p = s.onModuleDestroy();
        await jest.advanceTimersByTimeAsync(2001);
        await p;
        jest.useRealTimers();
        expect(c.disconnect).toHaveBeenCalledTimes(1);
    });
});
