import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import { CierreOrdenadoService } from './cierre-ordenado.service';

class HostFalso extends WorkerHost {
    constructor(private readonly w: { close: () => Promise<void> }) {
        super();
    }
    get worker(): any {
        return this.w;
    }
    async process(): Promise<any> {
        return undefined;
    }
}

function montar(providers: unknown[], crons: Array<[string, { stop: jest.Mock }]> = []) {
    const discovery = { getProviders: () => providers.map((instance) => ({ instance, name: 'p' })) };
    const scheduler = { getCronJobs: () => new Map(crons) };
    return new CierreOrdenadoService(discovery as any, scheduler as any);
}

describe('CierreOrdenadoService.drenar', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('sin trabajos: termina enseguida y cierra todos los workers', async () => {
        const c1 = jest.fn().mockResolvedValue(undefined);
        const c2 = jest.fn().mockResolvedValue(undefined);
        const s = montar([new HostFalso({ close: c1 }), new HostFalso({ close: c2 }), {}]);
        const r = await s.drenar('SIGTERM', 5000);
        expect(r.completo).toBe(true);
        expect(c1).toHaveBeenCalledTimes(1);
        expect(c2).toHaveBeenCalledTimes(1);
    });

    it('el close() de todas las colas va antes de cualquier cortarPorCierre()', async () => {
        const orden: string[] = [];
        const h1 = new HostFalso({ close: async () => void orden.push('close1') });
        const h2 = new HostFalso({ close: async () => void orden.push('close2') });
        const cortable = {
            cortarPorCierre: () => void orden.push('corte'),
            trabajosEnCurso: () => [],
        };
        await montar([cortable, h1, h2]).drenar('SIGTERM', 5000);
        expect(orden.indexOf('corte')).toBeGreaterThan(orden.indexOf('close1'));
        expect(orden.indexOf('corte')).toBeGreaterThan(orden.indexOf('close2'));
    });

    it('espera a un worker que tarda y devuelve completo: true', async () => {
        let cerrado = false;
        const lento = new HostFalso({
            close: () => new Promise<void>((res) => setTimeout(() => ((cerrado = true), res()), 40)),
        });
        const r = await montar([lento]).drenar('SIGTERM', 5000);
        expect(cerrado).toBe(true);
        expect(r.completo).toBe(true);
    });

    it('tope: un worker que nunca cierra da completo: false con el warn que nombra lo que sigue', async () => {
        jest.useFakeTimers();
        const colgado = new HostFalso({ close: () => new Promise<void>(() => undefined) });
        const cortable = {
            cortarPorCierre: jest.fn(),
            trabajosEnCurso: () => ['carga remesa=150 ACTUALIZACIONES 3.000/10.000 PROCESANDO'],
        };
        const p = montar([colgado, cortable]).drenar('SIGTERM', 75000);
        await jest.advanceTimersByTimeAsync(75000);
        const r = await p;
        expect(r.completo).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('carga remesa=150 ACTUALIZACIONES 3.000/10.000 PROCESANDO'));
    });

    it('un cortarPorCierre() que tira no frena a los demás', async () => {
        const malo = { cortarPorCierre: () => { throw new Error('boom'); }, trabajosEnCurso: () => [] };
        const bueno = { cortarPorCierre: jest.fn(), trabajosEnCurso: () => [] };
        const r = await montar([malo, bueno]).drenar('SIGTERM', 5000);
        expect(bueno.cortarPorCierre).toHaveBeenCalledTimes(1);
        expect(r.completo).toBe(true);
    });

    it('un worker cuyo close() rechaza no tira y se da por cerrado', async () => {
        const h = new HostFalso({ close: () => Promise.reject(new Error('redis caído')) });
        const r = await montar([h]).drenar('SIGTERM', 5000);
        expect(r.completo).toBe(true);
    });

    it('detiene los crons, también si uno falla al detenerse', async () => {
        const a = { stop: jest.fn(() => { throw new Error('x'); }) };
        const b = { stop: jest.fn() };
        await montar([], [['a', a], ['b', b]]).drenar('SIGTERM', 5000);
        expect(a.stop).toHaveBeenCalled();
        expect(b.stop).toHaveBeenCalled();
    });
});
