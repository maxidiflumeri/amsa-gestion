import * as path from 'path';
import { Logger } from '@nestjs/common';
import type { ContentBlock, Message } from '@anthropic-ai/sdk/resources/messages';
import { ClienteModelo, MessageCreateParamsNonStreaming, StreamModelo } from '../modelo/cliente-modelo';
import { WikiIndice } from '../wiki/wiki-indice';
import { TurnoRunner } from './turno-runner';

/**
 * Red de la extracción de `llamada-modelo.ts` (docs/asistente-reportes-spec.md §3): el request que la ayuda le manda a
 * Bedrock no puede cambiar ni un byte. El snapshot se generó con el runner ANTES de la extracción.
 */
const wiki = WikiIndice.desdeDirectorio(path.join(__dirname, '..', '__fixtures__', 'ayuda'));

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null };
const texto = (text: string): ContentBlock => ({ type: 'text', text, citations: null }) as ContentBlock;
const uso = (id: string, name: string, input: Record<string, unknown>): ContentBlock =>
    ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as unknown as ContentBlock;

class Falso implements ClienteModelo {
    capturado: { params: MessageCreateParamsNonStreaming; conSignal: boolean }[] = [];
    private i = 0;
    constructor(private readonly guion: { content: ContentBlock[]; stop_reason: Message['stop_reason'] }[]) {}
    stream(params: MessageCreateParamsNonStreaming, signal?: AbortSignal): StreamModelo {
        this.capturado.push({ params: JSON.parse(JSON.stringify(params)), conSignal: signal instanceof AbortSignal });
        const paso = this.guion[this.i++];
        return {
            onTexto: () => undefined,
            finalMessage: async () =>
                ({ id: 'm', type: 'message', role: 'assistant', model: 'm', content: paso.content, stop_reason: paso.stop_reason, stop_sequence: null, stop_details: null, usage }) as unknown as Message,
            parcial: () => undefined,
        };
    }
}

describe('request de la ayuda a Bedrock', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('no cambia: params de cada iteración de un turno con herramientas y de un segundo turno con historial', async () => {
        const cliente = new Falso([
            { content: [uso('t1', 'buscar_en_wiki', { texto: 'plantilla de reportes' })], stop_reason: 'tool_use' },
            { content: [texto('Desde Reportes.\n\nFuente: [reportes-como-funciona]')], stop_reason: 'end_turn' },
            { content: [texto('Sí.')], stop_reason: 'end_turn' },
        ]);
        const runner = new TurnoRunner({
            cliente,
            wiki,
            topes: { verificarIteracion: async () => undefined },
            medicion: { registrarLlamada: async () => 0.001 },
            modelo: 'us.anthropic.claude-haiku-5-5',
            strict: true,
            maxTokensContexto: 60000,
        });
        const base = {
            funcion: 'ayuda',
            ruta: '/gestion',
            persona: { nombre: 'Ana', rol: 'ADMIN', permisos: ['reportes.ver', 'reportes.crear'] },
            ahora: new Date('2026-10-16T17:05:00Z'),
            ultimoPromptTokens: 0,
            ids: { usuarioId: 7, conversacionId: 3, mensajeId: 11 },
            signal: new AbortController().signal,
            emitir: () => undefined,
        };
        const r1 = await runner.correr({ ...base, pregunta: '¿De dónde creo una plantilla de reportes?', historial: [] });
        await runner.correr({
            ...base,
            pregunta: '¿Y se puede duplicar?',
            historial: [{ mensajes: [...r1.apiUsuario, ...r1.apiAsistente] }],
        });
        expect(cliente.capturado).toMatchSnapshot();
    });
});
