import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { ClienteModelo, MessageCreateParamsNonStreaming, StreamModelo } from '../modelo/cliente-modelo';
import { TopeError } from './errores';
import { LlamadaRegistro, llamarModelo, usoAbortado } from './llamada-modelo';

const params = { model: 'm', max_tokens: 10, messages: [] } as MessageCreateParamsNonStreaming;
const ids = { usuarioId: 1, conversacionId: 2, mensajeId: 3 };

function armar(opts: { msg?: Partial<Message>; falla?: Error; parcial?: Partial<Message>; deltas?: string[] }) {
    const registradas: LlamadaRegistro[] = [];
    const stream = jest.fn((): StreamModelo => {
        let cb: (d: string) => void = () => undefined;
        return {
            onTexto: (f) => {
                cb = f;
            },
            finalMessage: async () => {
                for (const d of opts.deltas ?? []) cb(d);
                if (opts.falla) throw opts.falla;
                return { content: [], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, cache_creation: null }, ...opts.msg } as Message;
            },
            parcial: () => opts.parcial as Message | undefined,
        };
    });
    const cliente: ClienteModelo = { stream };
    const verificar = jest.fn().mockResolvedValue(undefined);
    const deps = {
        cliente,
        topes: { verificarIteracion: verificar },
        medicion: {
            registrarLlamada: async (l: LlamadaRegistro) => {
                registradas.push(l);
                return 0.5;
            },
        },
    };
    const base = { funcion: 'reportes', modelo: 'mod', iteracion: 2, ids, params, signal: new AbortController().signal, costoTurno: 0.1 };
    return { deps, stream, verificar, registradas, base };
}

describe('llamarModelo', () => {
    it('verifica los topes ANTES de abrir el stream, con la función y el costo del turno', async () => {
        const a = armar({});
        a.verificar.mockRejectedValueOnce(new TopeError('TOPE_TURNO', 'x'));
        await expect(llamarModelo(a.deps, a.base)).rejects.toBeInstanceOf(TopeError);
        expect(a.stream).not.toHaveBeenCalled();
        expect(a.verificar).toHaveBeenCalledWith('reportes', 0.1);
        expect(a.registradas).toHaveLength(0);
    });

    it('una llamada que sale bien se registra con su uso y devuelve el costo y el texto', async () => {
        const a = armar({ deltas: ['ho', 'la'] });
        const onTexto = jest.fn();
        const r = await llamarModelo(a.deps, { ...a.base, onTexto });
        expect(r).toMatchObject({ tipo: 'ok', costo: 0.5, textoIter: 'hola' });
        expect(onTexto).toHaveBeenCalledTimes(2);
        expect(a.registradas[0]).toMatchObject({ ...ids, funcion: 'reportes', modelo: 'mod', iteracion: 2, stopReason: 'end_turn', error: null });
        expect(a.registradas[0].uso).toMatchObject({ entrada: 10, salida: 5, cacheLectura: 100 });
    });

    it('abortada: se costea con el usage parcial y el texto emitido (3 caracteres por token)', async () => {
        const ac = new AbortController();
        ac.abort();
        const a = armar({ falla: new Error('abortado'), parcial: { usage: { input_tokens: 7, output_tokens: 1 } as never }, deltas: ['x'.repeat(30)] });
        const r = await llamarModelo(a.deps, { ...a.base, signal: ac.signal });
        expect(r.tipo).toBe('abortada');
        expect(a.registradas[0]).toMatchObject({ error: 'abortado', stopReason: null });
        expect(a.registradas[0].uso).toMatchObject({ entrada: 7, salida: 10 });
    });

    it('un error del cliente sin usage se registra en cero con la clase del error', async () => {
        const a = armar({ falla: Object.assign(new Error('x'), { name: 'AccessDeniedException' }) });
        const r = await llamarModelo(a.deps, a.base);
        expect(r.tipo).toBe('fallo');
        expect(a.registradas[0]).toMatchObject({ error: 'AccessDeniedException' });
        expect(a.registradas[0].uso.entrada).toBe(0);
    });

    it('el timeout solo se pasa cuando la función lo pide (la ayuda no cambia)', async () => {
        const a = armar({});
        await llamarModelo(a.deps, a.base);
        expect((a.stream.mock.calls as unknown[][])[0][2]).toBeUndefined();
        await llamarModelo(a.deps, { ...a.base, timeoutMs: 120000 });
        expect((a.stream.mock.calls as unknown[][])[1][2]).toEqual({ timeoutMs: 120000 });
    });
});

describe('usoAbortado', () => {
    it('toma el mayor entre la salida informada y la estimada por el texto', () => {
        const uso = { entrada: 1, salida: 4, thinking: 0, cacheLectura: 0, cacheEscritura5m: 0, cacheEscritura1h: 0 };
        expect(usoAbortado(uso, 'x'.repeat(30)).salida).toBe(10);
        expect(usoAbortado(uso, 'x').salida).toBe(4);
    });
});
