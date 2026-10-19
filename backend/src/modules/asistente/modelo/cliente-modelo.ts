import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';

export type { Message, MessageCreateParamsNonStreaming };

/** Lo que el turno necesita de un stream del modelo. */
export interface StreamModelo {
    /** Se llama con cada fragmento de texto a medida que llega. */
    onTexto(cb: (delta: string) => void): void;
    /** El mensaje completo; rechaza si la llamada falla o se aborta. */
    finalMessage(): Promise<Message>;
    /** Lo que llegó hasta ahora (para costear una llamada abortada a mitad). */
    parcial(): Message | undefined;
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
        };
    }
}
