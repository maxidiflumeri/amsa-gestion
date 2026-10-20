import * as path from 'path';
import { Logger } from '@nestjs/common';
import type { ContentBlock, Message } from '@anthropic-ai/sdk/resources/messages';
import { ClienteModelo, MessageCreateParamsNonStreaming, StreamModelo } from '../modelo/cliente-modelo';
import { WikiIndice } from '../wiki/wiki-indice';
import { TurnoRunner } from './turno-runner';
import * as fs from 'fs';
import { format } from 'pretty-format';
import { GuionLlamada, ClienteConTiempos, RelojFalso } from './doble-stream-con-tiempos';
import { TrazaTurno } from './traza';

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

describe('request de la ayuda a Bedrock con el detalle encendido (docs/asistente-detalle-spec.md §14.1)', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const guionDe = (content: ContentBlock[], stop_reason: Message['stop_reason']): GuionLlamada => ({
        eventos: [
            { en: 10, e: { tipo: 'conexion' } },
            { en: 20, e: { tipo: 'inicio_mensaje' } },
            { en: 30, e: { tipo: 'inicio_bloque', indice: 0, bloque: content[0].type === 'tool_use' ? 'tool_use' : 'text', ...(content[0].type === 'tool_use' ? { herramienta: content[0].name } : {}) } },
            { en: 40, e: { tipo: 'fin_bloque', indice: 0 } },
            { en: 45, e: { tipo: 'fin_mensaje' } },
        ],
        duracion: 50,
        content,
        stop_reason,
        usage,
    });

    async function correr(conTraza: boolean) {
        const reloj = new RelojFalso();
        const cliente = new ClienteConTiempos(reloj, [
            guionDe([uso('t1', 'buscar_en_wiki', { texto: 'plantilla de reportes' })], 'tool_use'),
            guionDe([texto('Desde Reportes.\n\nFuente: [reportes-como-funciona]')], 'end_turn'),
            guionDe([texto('Sí.')], 'end_turn'),
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
            ...(conTraza ? { traza: new TrazaTurno({ funcion: 'ayuda', modelo: 'us.anthropic.claude-haiku-5-5', reloj: reloj.ahora }) } : {}),
        };
        const r1 = await runner.correr({ ...base, pregunta: '¿De dónde creo una plantilla de reportes?', historial: [] });
        await runner.correr({
            ...base,
            pregunta: '¿Y se puede duplicar?',
            historial: [{ mensajes: [...r1.apiUsuario, ...r1.apiAsistente] }],
        });
        return cliente.capturado.map((c) => ({ conSignal: c.conSignal, params: c.params }));
    }

    it('los params con traza son iguales a los de sin traza', async () => {
        expect(await correr(true)).toEqual(await correr(false));
    });

    it('los params con traza son los del snapshot de siempre, byte a byte (el snapshot NO se regenera)', async () => {
        const capturado = await correr(true);
        const crudo = fs.readFileSync(path.join(__dirname, '__snapshots__', 'params-ayuda.spec.ts.snap'), 'utf8');
        const snapshots: Record<string, string> = {};
        // Lo mismo que hace Jest para leer un .snap: es JavaScript que asigna a `exports`.
        new Function('exports', crudo)(snapshots);
        const clave = 'request de la ayuda a Bedrock no cambia: params de cada iteración de un turno con herramientas y de un segundo turno con historial 1';
        const serializado = `\n${format(capturado, { escapeRegex: true, indent: 2, printFunctionName: false, printBasicPrototype: false, escapeString: false })}\n`;
        expect(serializado).toBe(snapshots[clave]);
    });
});
