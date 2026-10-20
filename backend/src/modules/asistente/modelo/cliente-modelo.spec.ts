import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import type { MessageCreateParamsNonStreaming, MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { ClienteAnthropic, ClienteBedrock, EventoStreamModelo } from './cliente-modelo';

/**
 * El adaptador de Bedrock contra un `MessageStream` REAL del SDK (docs/asistente-detalle-spec.md §7.2): `ClienteAnthropic` es
 * un tipo propio con un `as unknown as`, así que `tsc` no compara los nombres de evento con el SDK. Lo único falso es la
 * conexión HTTP: `createMessage` corre su camino de verdad (`connect` incluido) sobre una respuesta que armamos acá.
 */
const params = { model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'hola' }] } as MessageCreateParamsNonStreaming;

const usage = { input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function eventosCrudos(): MessageStreamEvent[] {
    return [
        { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, stop_sequence: null, usage } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'firma-secreta' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hola ' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'mundo' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu1', name: 'leer_pagina', input: {} } },
        { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"slug":"dni-30111222"}' } },
        { type: 'content_block_stop', index: 2 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
    ] as unknown as MessageStreamEvent[];
}

/** Un `Messages` mínimo cuya respuesta es la lista de eventos: lo demás (MessageStream) es el del SDK. */
function clienteSobre(eventos: MessageStreamEvent[]): ClienteAnthropic {
    const messages = {
        create: () => ({
            withResponse: async () => ({
                response: new Response(null),
                data: {
                    controller: new AbortController(),
                    async *[Symbol.asyncIterator]() {
                        for (const e of eventos) yield e;
                    },
                },
            }),
        }),
    };
    return {
        messages: {
            stream: (p: MessageCreateParamsNonStreaming) => MessageStream.createMessage(messages as never, p as never),
        },
    } as unknown as ClienteAnthropic;
}

describe('ClienteBedrock.stream().onEvento', () => {
    it('emite el desglose sin contenido, y onTexto y finalMessage siguen igual', async () => {
        const s = new ClienteBedrock(clienteSobre(eventosCrudos())).stream(params);
        const eventos: EventoStreamModelo[] = [];
        const deltas: string[] = [];
        s.onTexto((d) => deltas.push(d));
        s.onEvento!((e) => eventos.push(e));
        const msg = await s.finalMessage();

        expect(eventos).toEqual([
            { tipo: 'conexion' },
            { tipo: 'inicio_mensaje' },
            { tipo: 'inicio_bloque', indice: 0, bloque: 'thinking' },
            { tipo: 'fin_bloque', indice: 0 },
            { tipo: 'inicio_bloque', indice: 1, bloque: 'text' },
            { tipo: 'fin_bloque', indice: 1 },
            { tipo: 'inicio_bloque', indice: 2, bloque: 'tool_use', herramienta: 'leer_pagina' },
            { tipo: 'fin_bloque', indice: 2 },
            { tipo: 'fin_mensaje' },
        ]);
        // Nada de contenido: ni el texto, ni la firma, ni el input de la herramienta.
        const plano = JSON.stringify(eventos);
        expect(plano).not.toMatch(/Hola|mundo|firma-secreta|dni-30111222/);
        expect(deltas).toEqual(['Hola ', 'mundo']);
        expect(msg.stop_reason).toBe('tool_use');
        expect(msg.content).toHaveLength(3);
    });

    it('un callback de onEvento que lanza NO rompe la llamada', async () => {
        const s = new ClienteBedrock(clienteSobre(eventosCrudos())).stream(params);
        const deltas: string[] = [];
        let llamados = 0;
        s.onTexto((d) => deltas.push(d));
        s.onEvento!(() => {
            llamados++;
            throw new Error('el medidor se rompió');
        });
        const msg = await s.finalMessage();
        expect(llamados).toBe(9);
        expect(deltas).toEqual(['Hola ', 'mundo']);
        expect(msg.stop_reason).toBe('tool_use');
    });

    it('un bloque de un tipo que no conoce (server_tool_use) es «otro»', async () => {
        const evs = eventosCrudos();
        evs[4] = { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 's', name: 'web_search', input: {} } } as unknown as MessageStreamEvent;
        const s = new ClienteBedrock(clienteSobre(evs)).stream(params);
        const eventos: EventoStreamModelo[] = [];
        s.onEvento!((e) => eventos.push(e));
        await s.finalMessage().catch(() => undefined);
        expect(eventos).toContainEqual({ tipo: 'inicio_bloque', indice: 1, bloque: 'otro' });
    });
});
