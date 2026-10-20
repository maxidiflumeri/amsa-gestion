import type { Message, MessageCreateParamsNonStreaming, MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

export type { Message, MessageCreateParamsNonStreaming };

/** Lo que el medidor necesita saber de un stream: qué bloque empieza y termina, nunca su contenido. */
export type TipoBloque = 'thinking' | 'redacted_thinking' | 'text' | 'tool_use' | 'otro';
export type EventoStreamModelo =
    | { tipo: 'conexion' } // `connect`
    | { tipo: 'inicio_mensaje' } // `message_start`
    | { tipo: 'inicio_bloque'; indice: number; bloque: TipoBloque; herramienta?: string } // `content_block_start`
    | { tipo: 'fin_bloque'; indice: number } // `content_block_stop`
    | { tipo: 'fin_mensaje' }; // `message_stop`

/** Lo que el turno necesita de un stream del modelo. */
export interface StreamModelo {
    /** Se llama con cada fragmento de texto a medida que llega. */
    onTexto(cb: (delta: string) => void): void;
    /** El mensaje completo; rechaza si la llamada falla o se aborta. */
    finalMessage(): Promise<Message>;
    /** Lo que llegó hasta ahora (para costear una llamada abortada a mitad). */
    parcial(): Message | undefined;
    /**
     * Opcional: los eventos del stream SIN contenido, para el detalle (docs/asistente-detalle-spec.md §7.2). Un doble que no
     * lo implementa da una llamada «sin desglose». El callback nunca rompe el stream: lo envuelve quien lo llama.
     */
    onEvento?(cb: (e: EventoStreamModelo) => void): void;
}

/** El puerto del modelo. La implementación real es `ClienteBedrock`; los tests usan un doble con guion. */
export interface ClienteModelo {
    stream(params: MessageCreateParamsNonStreaming, signal?: AbortSignal, opciones?: OpcionesStream): StreamModelo;
}

/** Opciones del request que no son parte de los `params` (la ayuda no pasa ninguna). */
export interface OpcionesStream {
    /** Timeout de esta llamada, en ms. Sin esto rige el del cliente. */
    timeoutMs?: number;
}

/** Token de inyección de `ClienteModelo`. */
export const CLIENTE_MODELO = Symbol('CLIENTE_MODELO');

/** Lo mínimo del cliente del SDK que usamos (`AnthropicBedrock` y `AnthropicBedrockMantle` lo cumplen). */
export interface ClienteAnthropic {
    messages: {
        stream(
            params: MessageCreateParamsNonStreaming,
            options?: { signal?: AbortSignal; timeout?: number },
        ): {
            on(evento: 'text', cb: (delta: string) => void): unknown;
            on(evento: 'connect', cb: () => void): unknown;
            on(evento: 'streamEvent', cb: (ev: MessageStreamEvent) => void): unknown;
            finalMessage(): Promise<Message>;
            readonly currentMessage: Message | undefined;
        };
    };
}

export class ClienteBedrock implements ClienteModelo {
    constructor(private readonly cliente: ClienteAnthropic) {}

    stream(params: MessageCreateParamsNonStreaming, signal?: AbortSignal, opciones?: OpcionesStream): StreamModelo {
        const s = this.cliente.messages.stream(
            params,
            opciones?.timeoutMs !== undefined ? { signal, timeout: opciones.timeoutMs } : { signal },
        );
        return {
            onTexto: (cb) => {
                s.on('text', (delta) => cb(delta));
            },
            finalMessage: () => s.finalMessage(),
            parcial: () => s.currentMessage,
            onEvento: (cb) => {
                // Un listener que lanza corta la llamada en el SDK (`_emit` no tiene try): el medidor nunca rompe el stream.
                const seguro = (e: EventoStreamModelo) => {
                    try {
                        cb(e);
                    } catch {
                        /* medir nunca rompe una respuesta */
                    }
                };
                s.on('connect', () => seguro({ tipo: 'conexion' }));
                s.on('streamEvent', (ev) => {
                    try {
                        switch (ev.type) {
                            case 'message_start':
                                return seguro({ tipo: 'inicio_mensaje' });
                            case 'content_block_start': {
                                const b = ev.content_block;
                                const bloque: TipoBloque =
                                    b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'text' || b.type === 'tool_use' ? b.type : 'otro';
                                return seguro({
                                    tipo: 'inicio_bloque',
                                    indice: ev.index,
                                    bloque,
                                    ...(b.type === 'tool_use' ? { herramienta: b.name } : {}),
                                });
                            }
                            case 'content_block_stop':
                                return seguro({ tipo: 'fin_bloque', indice: ev.index });
                            case 'message_stop':
                                return seguro({ tipo: 'fin_mensaje' });
                            default:
                                return; // deltas y message_delta: nada
                        }
                    } catch {
                        /* ídem */
                    }
                });
            },
        };
    }
}
