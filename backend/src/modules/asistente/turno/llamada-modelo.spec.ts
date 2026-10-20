import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { ClienteModelo, MessageCreateParamsNonStreaming, StreamModelo } from '../modelo/cliente-modelo';
import { TopeError } from './errores';
import { LlamadaRegistro, llamarModelo, usoAbortado } from './llamada-modelo';
import { APIConnectionTimeoutError, APIError, RateLimitError } from '@anthropic-ai/sdk';
import { claseDeError, largosDe } from './llamada-modelo';
import { PRECIOS_DEFAULT } from '../modelo/precios';
import { ClienteConTiempos, GuionLlamada, RelojFalso, medicionConPrecio, topesConTiempo, usageCrudo } from './doble-stream-con-tiempos';
import { TrazaTurno } from './traza';

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

// ---- Detalle de la respuesta (docs/asistente-detalle-spec.md): los enganches de la traza -----------------------------

describe('llamarModelo con traza', () => {
    const PRECIO = PRECIOS_DEFAULT['us.anthropic.claude-sonnet-5-5'];
    const entrada = { funcion: 'ayuda', modelo: 'm', iteracion: 0, ids, params, costoTurno: 0 };
    const textoBloque = { type: 'text', text: 'hola', citations: null } as never;
    const guion = (sobre: Partial<GuionLlamada> = {}): GuionLlamada => ({
        eventos: [
            { en: 100, e: { tipo: 'conexion' as const } },
            { en: 150, e: { tipo: 'inicio_mensaje' as const } },
            { en: 200, e: { tipo: 'inicio_bloque' as const, indice: 0, bloque: 'text' as const } },
            { en: 700, e: { tipo: 'fin_bloque' as const, indice: 0 } },
        ],
        duracion: 750,
        content: [textoBloque],
        stop_reason: 'end_turn' as const,
        usage: usageCrudo({ entrada: 100, salida: 50 }),
        ...sobre,
    });
    const armarTraza = () => {
        const reloj = new RelojFalso();
        return { reloj, traza: new TrazaTurno({ funcion: 'ayuda', modelo: 'm', precio: PRECIO, reloj: reloj.ahora }) };
    };

    it('los eventos del stream llegan a la traza y la llamada se cierra con el costo registrado', async () => {
        const { reloj, traza } = armarTraza();
        const medicion = medicionConPrecio(PRECIO);
        const r = await llamarModelo({ cliente: new ClienteConTiempos(reloj, [guion()]), topes: topesConTiempo(reloj, 5), medicion }, { ...entrada, signal: new AbortController().signal, traza: traza.llamada(0) });
        expect(r.tipo).toBe('ok');
        const llamada = traza.armar({ estado: 'ok' }).nodos.find((n) => n.tipo === 'llamada')!;
        expect(llamada).toMatchObject({ ms: 755, fin: 'end_turn', costoUsd: (r as { costo: number }).costo });
        expect(llamada.hijos!.map((h) => [h.tipo, h.ms])).toEqual([
            ['espera', 205],
            ['respuesta', 550],
        ]);
        expect(llamada.hijos![0]).toMatchObject({ msTopes: 5, msConexion: 105, msPrimerEvento: 155 });
    });

    it('sin onEvento el stream no informa sus bloques: la llamada queda «sin desglose»', async () => {
        const { reloj, traza } = armarTraza();
        await llamarModelo({ cliente: new ClienteConTiempos(reloj, [guion({ sinEventos: true })]), topes: topesConTiempo(reloj, 0), medicion: medicionConPrecio(PRECIO) }, { ...entrada, signal: new AbortController().signal, traza: traza.llamada(0) });
        const llamada = traza.armar({ estado: 'ok' }).nodos.find((n) => n.tipo === 'llamada')!;
        expect(llamada.sinDesglose).toBe(true);
        expect(llamada.hijos).toHaveLength(1);
    });

    it('un TopeError antes de llamar: la traza lo anota como «no se hizo» y se relanza', async () => {
        const { reloj, traza } = armarTraza();
        const cliente = new ClienteConTiempos(reloj, [guion()]);
        const topes = topesConTiempo(reloj, 3, { llamada: 0, codigo: 'TOPE_TURNO' });
        await expect(llamarModelo({ cliente, topes, medicion: medicionConPrecio(PRECIO) }, { ...entrada, signal: new AbortController().signal, traza: traza.llamada(0) })).rejects.toBeInstanceOf(TopeError);
        expect(cliente.capturado).toHaveLength(0);
        const d = traza.armar({ estado: 'cortado' });
        expect(d.nodos.find((n) => n.tipo === 'llamada')).toMatchObject({ fin: 'tope_turno', ms: 3 });
        expect(d.llamadas).toBe(0);
        expect(d.costoUsd).toBe(0);
    });

    it('abortada: la traza recibe el uso estimado y el bloque abierto queda cortado', async () => {
        const { reloj, traza } = armarTraza();
        const ac = new AbortController();
        const g = guion({ parcial: { usage: { input_tokens: 7, output_tokens: 1 } as never, content: [{ type: 'text', text: 'x'.repeat(30), citations: null }] as never } });
        g.eventos.push({ en: 800, e: { tipo: 'fin_mensaje' as const } });
        const cliente = new ClienteConTiempos(reloj, [{ ...g, eventos: g.eventos.filter((x) => x.e.tipo !== 'fin_bloque') }]);
        // Se aborta cuando llega el inicio del bloque de texto.
        const original = cliente.stream.bind(cliente);
        cliente.stream = (p, s, o) => {
            const st = original(p, s, o);
            st.onEvento!(() => undefined);
            const prev = st.onEvento!.bind(st);
            st.onEvento = (cb) => prev((e) => (cb(e), e.tipo === 'inicio_bloque' && ac.abort()));
            return st;
        };
        const r = await llamarModelo({ cliente, topes: topesConTiempo(reloj, 0), medicion: medicionConPrecio(PRECIO) }, { ...entrada, signal: ac.signal, traza: traza.llamada(0) });
        expect(r.tipo).toBe('abortada');
        const llamada = traza.armar({ estado: 'cortado' }).nodos.find((n) => n.tipo === 'llamada')!;
        expect(llamada).toMatchObject({ fin: 'abortada', estimado: true });
        expect(llamada.hijos!.find((h) => h.tipo === 'respuesta')).toMatchObject({ cortado: true, estimado: true });
    });

    it('una traza que lanza en todos sus métodos no cambia lo que hace ni lo que registra la llamada', async () => {
        const reloj = new RelojFalso();
        const rota = new Proxy({}, { get: () => () => { throw new Error('medidor roto'); } }) as never;
        const conTraza = medicionConPrecio(PRECIO);
        const sinTraza = medicionConPrecio(PRECIO);
        const a = await llamarModelo({ cliente: new ClienteConTiempos(reloj, [guion()]), topes: topesConTiempo(reloj, 0), medicion: conTraza }, { ...entrada, signal: new AbortController().signal, traza: rota });
        const b = await llamarModelo({ cliente: new ClienteConTiempos(reloj, [guion()]), topes: topesConTiempo(reloj, 0), medicion: sinTraza }, { ...entrada, signal: new AbortController().signal });
        expect(a).toEqual(b);
        expect(conTraza.registradas.map((x) => ({ ...x, ms: 0 }))).toEqual(sinTraza.registradas.map((x) => ({ ...x, ms: 0 })));
    });

    it('un stream cuyo onEvento lanza al suscribirse tampoco rompe la llamada', async () => {
        const { reloj, traza } = armarTraza();
        const cliente = new ClienteConTiempos(reloj, [guion()]);
        const original = cliente.stream.bind(cliente);
        cliente.stream = (p, s, o) => {
            const st = original(p, s, o);
            st.onEvento = () => {
                throw new Error('no se puede suscribir');
            };
            return st;
        };
        const r = await llamarModelo({ cliente, topes: topesConTiempo(reloj, 0), medicion: medicionConPrecio(PRECIO) }, { ...entrada, signal: new AbortController().signal, traza: traza.llamada(0) });
        expect(r.tipo).toBe('ok');
    });

    it('un fallo del cliente guarda la clase del SDK en asistente_llamada y en el nodo', async () => {
        const { reloj, traza } = armarTraza();
        const medicion = medicionConPrecio(PRECIO);
        const r = await llamarModelo({ cliente: new ClienteConTiempos(reloj, [guion({ falla: new APIConnectionTimeoutError(), duracion: 60000 })]), topes: topesConTiempo(reloj, 0), medicion }, { ...entrada, signal: new AbortController().signal, traza: traza.llamada(0) });
        expect(r.tipo).toBe('fallo');
        expect(medicion.registradas[0].error).toBe('APIConnectionTimeoutError');
        expect(traza.armar({ estado: 'error' }).nodos.find((n) => n.tipo === 'llamada')).toMatchObject({ fin: 'timeout', error: 'APIConnectionTimeoutError' });
    });
});

describe('claseDeError', () => {
    it('distingue los errores del SDK por su clase (err.name da «Error» para todos)', () => {
        const timeout = new APIConnectionTimeoutError();
        expect(timeout.name).toBe('Error');
        expect(claseDeError(timeout)).toBe('APIConnectionTimeoutError');
        expect(claseDeError(new RateLimitError(429, {}, 'x', new Headers()))).toBe('RateLimitError');
        expect(claseDeError(APIError.generate(500, {}, 'x', new Headers()))).toBe('InternalServerError');
    });
    it('el name propio de AWS gana; un Error común es «Error»; lo raro no lanza', () => {
        expect(claseDeError(Object.assign(new Error('x'), { name: 'AccessDeniedException' }))).toBe('AccessDeniedException');
        expect(claseDeError(new Error('x'))).toBe('Error');
        expect(claseDeError(null)).toBe('Error');
        expect(claseDeError(Object.assign(new Error('x'), { name: 'N'.repeat(300) })).length).toBe(120);
    });
});

describe('largosDe', () => {
    it('cuenta caracteres del texto y del input, sin mirar el razonamiento', () => {
        const razonamiento = { type: 'thinking', thinking: 'secreto', signature: 's' };
        const r = largosDe([razonamiento, { type: 'text', text: 'hola' }, { type: 'tool_use', id: 'a', name: 'x', input: { a: 1 } }] as never);
        expect(r).toEqual([
            { indice: 0, tipo: 'thinking', caracteres: 0 },
            { indice: 1, tipo: 'text', caracteres: 4 },
            { indice: 2, tipo: 'tool_use', caracteres: 7 },
        ]);
        expect(largosDe(undefined)).toEqual([]);
        expect(largosDe([{ get type() { throw new Error('x'); } }] as never)).toEqual([]);
    });
});
