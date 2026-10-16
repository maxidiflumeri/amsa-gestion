import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { instalarCierreOrdenado, leerTopesCierre } from './instalar-cierre';
import { CierreOrdenadoService } from './cierre-ordenado.service';

function montar(opts: {
    drenar?: () => Promise<{ completo: boolean; ms: number }>;
    close?: () => Promise<void>;
    env?: NodeJS.ProcessEnv;
    servidor?: EventEmitter;
}) {
    const handlers: Record<string, () => void> = {};
    const proceso = { on: (s: string, f: () => void) => void (handlers[s] = f) } as any;
    const salir = jest.fn();
    const drenar = jest.fn(opts.drenar ?? (async () => ({ completo: true, ms: 1 })));
    const close = jest.fn(opts.close ?? (async () => undefined));
    const app: any = {
        get: (tok: unknown) => (tok === CierreOrdenadoService ? { drenar } : undefined),
        close,
        ...(opts.servidor ? { getHttpServer: () => opts.servidor } : {}),
    };
    instalarCierreOrdenado(app, { proceso, salir, env: opts.env ?? {} });
    return { handlers, salir, drenar, close };
}

describe('instalarCierreOrdenado', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('SIGTERM -> drenar -> app.close -> salir(0)', async () => {
        const m = montar({});
        m.handlers.SIGTERM();
        await new Promise((r) => setImmediate(r));
        expect(m.drenar).toHaveBeenCalledWith('SIGTERM', 75000);
        expect(m.close).toHaveBeenCalledTimes(1);
        expect(m.salir).toHaveBeenCalledWith(0);
    });

    it('una segunda señal no drena dos veces', async () => {
        const m = montar({});
        m.handlers.SIGTERM();
        m.handlers.SIGINT();
        await new Promise((r) => setImmediate(r));
        expect(m.drenar).toHaveBeenCalledTimes(1);
        expect(m.salir).toHaveBeenCalledTimes(1);
    });

    it('app.close que no termina -> salir(1) a los 10 s', async () => {
        jest.useFakeTimers();
        const m = montar({ close: () => new Promise<void>(() => undefined) });
        m.handlers.SIGTERM();
        await jest.advanceTimersByTimeAsync(9999);
        expect(m.salir).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(2);
        expect(m.salir).toHaveBeenCalledWith(1);
    });

    it('drenar que cuelga -> el vigía, salir(1) a los 90 s', async () => {
        jest.useFakeTimers();
        const m = montar({ drenar: () => new Promise(() => undefined) });
        m.handlers.SIGTERM();
        await jest.advanceTimersByTimeAsync(89999);
        expect(m.salir).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(2);
        expect(m.salir).toHaveBeenCalledWith(1);
    });

    it('drenar incompleto -> sale con 1 SIN cerrar la app (no le corta Prisma a lo que sigue corriendo)', async () => {
        const m = montar({ drenar: async () => ({ completo: false, ms: 75000 }) });
        m.handlers.SIGTERM();
        await new Promise((r) => setImmediate(r));
        expect(m.close).not.toHaveBeenCalled();
        expect(m.salir).toHaveBeenCalledWith(1);
        expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('sale sin cerrar Nest'));
    });

    it('un socket que no contesta el cierre se corta al segundo y la app termina de cerrar con 0', async () => {
        jest.useFakeTimers();
        const servidor = new EventEmitter();
        const mudo = Object.assign(new EventEmitter(), { destroy: jest.fn() });
        const educado = Object.assign(new EventEmitter(), { destroy: jest.fn() });
        let terminar: () => void = () => undefined;
        // Como socket.io: app.close() termina recién cuando se cerraron todas las conexiones.
        const m = montar({
            servidor,
            close: () => new Promise<void>((r) => {
                terminar = r;
                educado.emit('close');
            }),
        });
        servidor.emit('upgrade', {}, mudo);
        servidor.emit('upgrade', {}, educado);
        mudo.destroy.mockImplementation(() => {
            mudo.emit('close');
            terminar();
        });
        m.handlers.SIGTERM();
        await jest.advanceTimersByTimeAsync(999);
        expect(mudo.destroy).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(2);
        expect(mudo.destroy).toHaveBeenCalledTimes(1);
        expect(educado.destroy).not.toHaveBeenCalled();
        expect(m.salir).toHaveBeenCalledWith(0);
    });

    it('sin sockets pendientes no corta nada ni avisa', async () => {
        jest.useFakeTimers();
        const servidor = new EventEmitter();
        const s = Object.assign(new EventEmitter(), { destroy: jest.fn() });
        const m = montar({ servidor });
        servidor.emit('upgrade', {}, s);
        s.emit('close');
        m.handlers.SIGTERM();
        await jest.advanceTimersByTimeAsync(5000);
        expect(s.destroy).not.toHaveBeenCalled();
        expect(m.salir).toHaveBeenCalledWith(0);
        expect(Logger.prototype.warn).not.toHaveBeenCalledWith(expect.stringContaining('no contestaron'));
    });

    it('error en drenar -> salir(1)', async () => {
        const m = montar({ drenar: async () => { throw new Error('x'); } });
        m.handlers.SIGTERM();
        await new Promise((r) => setImmediate(r));
        expect(m.salir).toHaveBeenCalledWith(1);
    });

    it('los topes del entorno se acotan', () => {
        expect(leerTopesCierre({})).toEqual({ esperaTrabajosMs: 75000, appMs: 10000, totalMs: 90000 });
        expect(leerTopesCierre({ CIERRE_ESPERA_TRABAJOS_MS: '5' }).esperaTrabajosMs).toBe(1000);
        expect(leerTopesCierre({ CIERRE_ESPERA_TRABAJOS_MS: '9999999' }).esperaTrabajosMs).toBe(600000);
        expect(leerTopesCierre({ CIERRE_ESPERA_TRABAJOS_MS: 'abc' }).esperaTrabajosMs).toBe(75000);
        // el vigía nunca es menor que espera + app + 2 s
        expect(leerTopesCierre({ CIERRE_ESPERA_TRABAJOS_MS: '3000', CIERRE_TOPE_TOTAL_MS: '1000' }).totalMs).toBe(15000);
        expect(leerTopesCierre({ CIERRE_ESPERA_TRABAJOS_MS: '3000', CIERRE_TOPE_TOTAL_MS: '6000' }).totalMs).toBe(15000);
    });
});
