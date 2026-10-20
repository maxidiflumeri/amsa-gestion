import { APIUserAbortError } from '@anthropic-ai/sdk';
import type { ContentBlock, Message, Usage } from '@anthropic-ai/sdk/resources/messages';
import { ClienteModelo, EventoStreamModelo, MessageCreateParamsNonStreaming, OpcionesStream, StreamModelo } from '../modelo/cliente-modelo';
import { calcularCosto } from '../modelo/precios';
import type { PrecioModelo } from '../dto/asistente.tipos';
import { TopeError } from './errores';
import type { LlamadaRegistro, PuertoMedicion, PuertoTopes } from './llamada-modelo';

/**
 * SOLO PARA LOS TESTS (queda afuera del build: `tsconfig.build.json`). Un `ClienteModelo` cuyo guion fija en qué milisegundo
 * llega cada evento del stream, sobre un reloj falso que se mueve a mano (docs/asistente-detalle-spec.md §14.1).
 */

export class RelojFalso {
    t = 0;
    ahora = (): number => this.t;
    avanzar(ms: number): void {
        this.t += ms;
    }
}

export interface GuionLlamada {
    /** En qué ms desde que se abre el stream llega cada evento. */
    eventos: { en: number; e: EventoStreamModelo }[];
    /** Deltas de texto: en qué ms y qué texto (para onTexto). */
    textos?: { en: number; delta: string }[];
    /** En qué ms resuelve (o rechaza) finalMessage. */
    duracion: number;
    content: ContentBlock[];
    stop_reason: Message['stop_reason'];
    usage?: Partial<Usage> & { output_tokens_details?: { thinking_tokens?: number } };
    /** Si está, finalMessage rechaza con esto (p. ej. `new APIConnectionTimeoutError()` del SDK). */
    falla?: Error;
    /** No implementa onEvento (como los dobles de hoy). */
    sinEventos?: boolean;
    /** Lo que devuelve `parcial()` (para costear una llamada abortada). */
    parcial?: Partial<Message>;
}

export class ClienteConTiempos implements ClienteModelo {
    capturado: { params: MessageCreateParamsNonStreaming; conSignal: boolean; opciones?: OpcionesStream }[] = [];
    private i = 0;

    constructor(
        private readonly reloj: RelojFalso,
        private readonly guion: GuionLlamada[],
    ) {}

    stream(params: MessageCreateParamsNonStreaming, signal?: AbortSignal, opciones?: OpcionesStream): StreamModelo {
        this.capturado.push({ params: JSON.parse(JSON.stringify(params)), conSignal: signal instanceof AbortSignal, opciones });
        const paso = this.guion[this.i++];
        if (!paso) throw new Error('El guion del doble se quedó sin llamadas.');
        const base = this.reloj.t;
        let cbTexto: (d: string) => void = () => undefined;
        let cbEvento: ((e: EventoStreamModelo) => void) | undefined;

        const irA = (en: number) => {
            const destino = base + en;
            if (destino > this.reloj.t) this.reloj.t = destino;
        };
        const abortada = () => signal?.aborted === true;

        const stream: StreamModelo = {
            onTexto: (cb) => {
                cbTexto = cb;
            },
            // Avanza el reloj a cada `en` y emite, todo adentro de finalMessage, como el doble de llamada-modelo.spec.
            finalMessage: async () => {
                const lista: ({ en: number; evento: EventoStreamModelo } | { en: number; delta: string })[] = [
                    ...paso.eventos.map((x) => ({ en: x.en, evento: x.e })),
                    ...(paso.textos ?? []).map((x) => ({ en: x.en, delta: x.delta })),
                ].sort((a, b) => a.en - b.en);
                for (const x of lista) {
                    if (abortada()) throw new APIUserAbortError();
                    irA(x.en);
                    if ('evento' in x) cbEvento?.(x.evento);
                    else cbTexto(x.delta);
                }
                if (abortada()) throw new APIUserAbortError();
                irA(paso.duracion);
                if (paso.falla) throw paso.falla;
                const u = paso.usage ?? {};
                return {
                    id: 'msg_doble',
                    type: 'message',
                    role: 'assistant',
                    model: 'doble',
                    content: paso.content,
                    stop_reason: paso.stop_reason,
                    stop_sequence: null,
                    stop_details: null,
                    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, ...u },
                } as unknown as Message;
            },
            parcial: () => paso.parcial as Message | undefined,
        };
        if (!paso.sinEventos) {
            stream.onEvento = (cb) => {
                cbEvento = cb;
            };
        }
        return stream;
    }
}

/** Lo que hace `MedicionService.registrarLlamada`: devuelve el costo redondeado a 6 decimales, y guarda lo que recibió. */
export function medicionConPrecio(precio: PrecioModelo): PuertoMedicion & { registradas: LlamadaRegistro[] } {
    const registradas: LlamadaRegistro[] = [];
    return {
        registradas,
        registrarLlamada: async (l) => {
            registradas.push(l);
            return Number(calcularCosto(l.uso, precio).toFixed(6));
        },
    };
}

/** Topes que tardan `ms` en el reloj falso y, si se pide, cortan en la llamada `cortarEn` (0, 1, 2…). */
export function topesConTiempo(reloj: RelojFalso, ms: number | ((llamada: number) => number), cortarEn?: { llamada: number; codigo: TopeError['codigo'] }): PuertoTopes & { llamadas: number } {
    const topes = {
        llamadas: 0,
        verificarIteracion: async () => {
            const n = topes.llamadas++;
            reloj.avanzar(typeof ms === 'function' ? ms(n) : ms);
            if (cortarEn && cortarEn.llamada === n) throw new TopeError(cortarEn.codigo, 'tope de prueba');
        },
    };
    return topes;
}

/** Un `usage` crudo desde los tokens de `UsoTokens`, para armar guiones legibles. */
export function usageCrudo(u: { entrada: number; salida: number; thinking?: number; cacheLectura?: number; cacheEscritura5m?: number; cacheEscritura1h?: number }): GuionLlamada['usage'] {
    return {
        input_tokens: u.entrada,
        output_tokens: u.salida,
        cache_read_input_tokens: u.cacheLectura ?? 0,
        cache_creation_input_tokens: (u.cacheEscritura5m ?? 0) + (u.cacheEscritura1h ?? 0),
        cache_creation: { ephemeral_5m_input_tokens: u.cacheEscritura5m ?? 0, ephemeral_1h_input_tokens: u.cacheEscritura1h ?? 0 },
        ...(u.thinking !== undefined ? { output_tokens_details: { thinking_tokens: u.thinking } } : {}),
    } as GuionLlamada['usage'];
}
