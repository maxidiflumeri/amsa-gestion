import * as path from 'path';
import { Logger } from '@nestjs/common';
import type { ContentBlock, Message } from '@anthropic-ai/sdk/resources/messages';
import { EventoSse } from '../dto/asistente.tipos';
import { ClienteModelo, MessageCreateParamsNonStreaming, StreamModelo } from '../modelo/cliente-modelo';
import { WikiIndice } from '../wiki/wiki-indice';
import { TopeError } from './errores';
import { usoAbortado,
    DependenciasTurno,
    EntradaTurno,
    LlamadaRegistro,
    MAX_ITERACIONES,
    TEXTO_RECHAZO,
    TurnoRunner,
} from './turno-runner';

const wiki = WikiIndice.desdeDirectorio(path.join(__dirname, '..', '__fixtures__', 'ayuda'));

// Los 13 permisos del OPERADOR de prod: sin reportes.crear.
const OPERADOR = ['deudores.ver', 'reportes.ver', 'reportes.ejecutar', 'importacion.ver_historial'];
const ADMIN = [...OPERADOR, 'reportes.crear', 'importacion.ejecutar'];

interface PasoGuion {
    deltas?: string[];
    content: ContentBlock[];
    stop_reason: Message['stop_reason'];
    usage?: Partial<Message['usage']>;
    /** La llamada falla con este error en vez de devolver un mensaje. */
    falla?: Error;
    stop_details?: Message['stop_details'];
}

const usage = (extra: Partial<Message['usage']> = {}): Message['usage'] =>
    ({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, ...extra }) as Message['usage'];

const texto = (text: string): ContentBlock => ({ type: 'text', text, citations: null }) as ContentBlock;
const usoHerramienta = (id: string, name: string, input: Record<string, unknown>): ContentBlock =>
    ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as unknown as ContentBlock;
const thinking = (): ContentBlock => ({ type: 'thinking', thinking: '', signature: 'firma' }) as ContentBlock;

/** Doble del modelo: responde con un guion, una respuesta por llamada, y guarda los params que recibió. */
class ClienteModeloFalso implements ClienteModelo {
    llamadas: MessageCreateParamsNonStreaming[] = [];
    private i = 0;
    constructor(private readonly guion: PasoGuion[]) {}

    stream(params: MessageCreateParamsNonStreaming, signal?: AbortSignal): StreamModelo {
        this.llamadas.push(JSON.parse(JSON.stringify(params)));
        const paso = this.guion[this.i++];
        let cb: (d: string) => void = () => undefined;
        return {
            onTexto: (f) => {
                cb = f;
            },
            finalMessage: async () => {
                if (!paso) throw new Error('el guion se acabó');
                if (signal?.aborted) throw Object.assign(new Error('abortado'), { name: 'APIUserAbortError' });
                if (paso.falla) throw paso.falla;
                for (const d of paso.deltas ?? []) cb(d);
                return {
                    id: 'msg_1',
                    type: 'message',
                    role: 'assistant',
                    model: 'm',
                    content: paso.content,
                    stop_reason: paso.stop_reason,
                    stop_sequence: null,
                    stop_details: paso.stop_details ?? null,
                    usage: usage(paso.usage),
                } as unknown as Message;
            },
            parcial: () => undefined,
        };
    }
}

function armar(guion: PasoGuion[], opciones: Partial<DependenciasTurno> = {}) {
    const cliente = new ClienteModeloFalso(guion);
    const registradas: LlamadaRegistro[] = [];
    const verificar = jest.fn().mockResolvedValue(undefined);
    const runner = new TurnoRunner({
        cliente,
        wiki,
        topes: { verificarIteracion: verificar },
        medicion: {
            registrarLlamada: async (l) => {
                registradas.push(l);
                return 0.001;
            },
        },
        modelo: 'us.anthropic.claude-haiku-5-5',
        strict: true,
        maxTokensContexto: 60000,
        ...opciones,
    });
    const eventos: EventoSse[] = [];
    const entrada = (extra: Partial<EntradaTurno> = {}): EntradaTurno => ({
        funcion: 'ayuda',
        pregunta: '¿De dónde creo una plantilla de reportes?',
        ruta: '/gestion',
        persona: { nombre: 'Ana', rol: 'ADMIN', permisos: ADMIN },
        ahora: new Date('2026-10-16T17:05:00Z'),
        historial: [],
        ultimoPromptTokens: 0,
        ids: { usuarioId: 7, conversacionId: 3, mensajeId: 11 },
        signal: new AbortController().signal,
        emitir: (e) => eventos.push(e),
        ...extra,
    });
    return { runner, cliente, registradas, eventos, entrada, verificar };
}

describe('TurnoRunner', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('solo texto: emite los deltas, devuelve ok y registra UNA llamada', async () => {
        const { runner, eventos, registradas, entrada, cliente } = armar([
            { deltas: ['Hola ', 'mundo.'], content: [thinking(), texto('Hola mundo.')], stop_reason: 'end_turn' },
        ]);
        const r = await runner.correr(entrada());
        expect(eventos.map((e) => e.evento)).toEqual(['texto', 'texto']);
        expect(r.estado).toBe('ok');
        expect(r.texto).toBe('Hola mundo.');
        expect(r.llamadas).toBe(1);
        expect(registradas).toHaveLength(1);
        expect(registradas[0]).toMatchObject({ iteracion: 0, stopReason: 'end_turn', error: null, mensajeId: 11, usuarioId: 7 });
        expect(r.costoUsd).toBeCloseTo(0.001);
        // El thinking no se guarda.
        expect(JSON.stringify(r.apiAsistente)).not.toContain('thinking');
        expect(r.apiAsistente).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'Hola mundo.' }] }]);
        // La pregunta va seguida del mensaje system con el contexto.
        expect(r.apiUsuario.map((m) => m.role)).toEqual(['user', 'system']);
        expect(cliente.llamadas[0].messages.map((m) => m.role)).toEqual(['user', 'system']);
    });

    it('leer_pagina: segunda llamada con el cuerpo como tool_result, y el breakpoint en el último user', async () => {
        const { runner, cliente, eventos, entrada } = armar([
            { content: [thinking(), usoHerramienta('t1', 'leer_pagina', { slug: 'reportes/armar-un-reporte' })], stop_reason: 'tool_use' },
            { deltas: ['Listo. Fuente: [Armar un reporte](/ayuda/reportes/armar-un-reporte)'], content: [texto('Listo. Fuente: [Armar un reporte](/ayuda/reportes/armar-un-reporte)')], stop_reason: 'end_turn' },
        ]);
        const r = await runner.correr(entrada());
        const segunda = cliente.llamadas[1].messages;
        expect(segunda.map((m) => m.role)).toEqual(['user', 'system', 'assistant', 'user']);
        const resultado = (segunda[3].content as any[])[0];
        expect(resultado.type).toBe('tool_result');
        expect(resultado.content).toContain('Para armar un reporte necesitás el permiso');
        expect(resultado.cache_control).toEqual({ type: 'ephemeral' });
        // Dentro del turno el thinking se reenvía; lo guardado va sin thinking.
        expect(JSON.stringify(segunda[2])).toContain('thinking');
        expect(JSON.stringify(r.apiAsistente)).not.toContain('thinking');
        expect(eventos).toContainEqual({
            evento: 'herramienta',
            data: { nombre: 'leer_pagina', slug: 'reportes/armar-un-reporte', titulo: 'Armar un reporte' },
        });
        expect(r.fuentes).toEqual([{ slug: 'reportes/armar-un-reporte', titulo: 'Armar un reporte' }]);
        expect(r.estado).toBe('ok');
    });

    it('ofrecer_ir_a sin permiso: is_error, sin evento accion; el texto nombra el permiso que falta', async () => {
        const { runner, cliente, eventos, entrada } = armar([
            { content: [usoHerramienta('t1', 'ofrecer_ir_a', { ruta: '/reportes/nuevo', motivo: 'crear una plantilla' })], stop_reason: 'tool_use' },
            { deltas: ['Te falta Crear reportes.'], content: [texto('Te falta Crear reportes.')], stop_reason: 'end_turn' },
        ]);
        const r = await runner.correr(entrada({ persona: { nombre: 'Ana', rol: 'OPERADOR', permisos: OPERADOR } }));
        const res = (cliente.llamadas[1].messages[3].content as any[])[0];
        expect(res.is_error).toBe(true);
        expect(res.content).toContain('no puede abrir /reportes/nuevo (pide Crear reportes)');
        expect(eventos.some((e) => e.evento === 'accion')).toBe(false);
        expect(r.acciones).toEqual([]);
    });

    it('ofrecer_ir_a con permiso: emite accion con la etiqueta del catálogo', async () => {
        const { runner, eventos, entrada } = armar([
            { content: [usoHerramienta('t1', 'ofrecer_ir_a', { ruta: '/reportes/nuevo', motivo: 'crear una plantilla de reportes' })], stop_reason: 'tool_use' },
            { deltas: ['Ahí.'], content: [texto('Ahí.')], stop_reason: 'end_turn' },
        ]);
        const r = await runner.correr(entrada());
        const accion = eventos.find((e) => e.evento === 'accion');
        expect(accion).toEqual({
            evento: 'accion',
            data: { id: 't1', tipo: 'ir_a', ruta: '/reportes/nuevo', etiqueta: 'Nueva plantilla de reportes', motivo: 'crear una plantilla de reportes' },
        });
        expect(r.acciones).toEqual([
            { id: 't1', tipo: 'ir_a', ruta: '/reportes/nuevo', etiqueta: 'Nueva plantilla de reportes', motivo: 'crear una plantilla de reportes', resultado: null },
        ]);
    });

    it('ofrecer_ir_a: la segunda oferta del turno, la pantalla actual y una ruta fuera del mapa son is_error', async () => {
        const { runner, cliente, eventos, entrada } = armar([
            {
                content: [
                    usoHerramienta('a', 'ofrecer_ir_a', { ruta: '/reportes', motivo: 'x' }),
                    usoHerramienta('b', 'ofrecer_ir_a', { ruta: '/historial-importaciones', motivo: 'y' }),
                    usoHerramienta('c', 'ofrecer_ir_a', { ruta: '/gestion', motivo: 'z' }),
                    usoHerramienta('d', 'ofrecer_ir_a', { ruta: '/inventada', motivo: 'w' }),
                ],
                stop_reason: 'tool_use',
            },
            { deltas: ['ok'], content: [texto('ok')], stop_reason: 'end_turn' },
        ]);
        await runner.correr(entrada());
        const res = cliente.llamadas[1].messages[3].content as any[];
        expect(res[0].is_error).toBeUndefined();
        expect(res[1].content).toBe('Ya ofreciste ir a una pantalla en esta respuesta.');
        expect(res[2].content).toBe('La persona ya está en esa pantalla.');
        expect(res[3].content).toBe('Esa pantalla no existe en el mapa.');
        expect(eventos.filter((e) => e.evento === 'accion')).toHaveLength(1);
    });

    it('leer_pagina: slug inexistente, página ya presente y la cuarta lectura', async () => {
        const slugs = ['reportes/armar-un-reporte', 'reportes/ejecutar-y-descargar', 'primeros-pasos/inicio', 'reportes/sin-metadatos'];
        const { runner, cliente, entrada } = armar([
            {
                content: [
                    usoHerramienta('1', 'leer_pagina', { slug: 'no/existe' }),
                    usoHerramienta('2', 'leer_pagina', { slug: slugs[0] }),
                    usoHerramienta('3', 'leer_pagina', { slug: slugs[0] }),
                    usoHerramienta('4', 'leer_pagina', { slug: slugs[1] }),
                    usoHerramienta('5', 'leer_pagina', { slug: slugs[2] }),
                    usoHerramienta('6', 'leer_pagina', { slug: slugs[3] }),
                ],
                stop_reason: 'tool_use',
            },
            { deltas: ['ok'], content: [texto('ok')], stop_reason: 'end_turn' },
        ]);
        await runner.correr(entrada());
        const res = cliente.llamadas[1].messages[3].content as any[];
        expect(res[0]).toMatchObject({ is_error: true, content: 'No existe esa página.' });
        expect(res[1].is_error).toBeUndefined();
        expect(res[2]).toMatchObject({ content: 'Esa página ya está más arriba en esta conversación.' });
        expect(res[2].is_error).toBeUndefined();
        expect(res[3].is_error).toBeUndefined();
        expect(res[4].is_error).toBeUndefined();
        expect(res[5]).toMatchObject({ is_error: true, content: 'Ya leíste tres páginas en esta respuesta.' });
    });

    it('la página principal de la pantalla va en el contexto y no se vuelve a leer', async () => {
        const { runner, cliente, entrada } = armar([
            { content: [usoHerramienta('1', 'leer_pagina', { slug: 'gestion/buscar-un-caso' })], stop_reason: 'tool_use' },
            { deltas: ['ok'], content: [texto('ok')], stop_reason: 'end_turn' },
        ]);
        await runner.correr(entrada({ ruta: '/gestion' }));
        expect(cliente.llamadas[0].messages[1].content).toContain('<pagina slug="gestion/buscar-un-caso">');
        const res = (cliente.llamadas[1].messages[3].content as any[])[0];
        expect(res.content).toBe('Esa página ya está más arriba en esta conversación.');
    });

    it('si la página de la pantalla ya está en el historial, el contexto no la repite', async () => {
        const previo = [
            { role: 'user' as const, content: [{ type: 'text' as const, text: 'p1' }] },
            { role: 'system' as const, content: 'ctx\n<pagina slug="gestion/buscar-un-caso">\nviejo\n</pagina>' },
            { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'r1' }] },
        ];
        const { runner, cliente, entrada } = armar([{ deltas: ['ok'], content: [texto('ok')], stop_reason: 'end_turn' }]);
        await runner.correr(entrada({ ruta: '/gestion', historial: [{ mensajes: previo }] }));
        const ctx = cliente.llamadas[0].messages[4].content as string;
        expect(ctx).toContain('ya está más arriba en la conversación');
        expect(ctx).not.toContain('<pagina slug');
    });

    it('4 iteraciones con herramientas: estado cortado y la última llamada es la 4.ª', async () => {
        const paso = (i: number): PasoGuion => ({
            content: [usoHerramienta(`t${i}`, 'leer_pagina', { slug: 'primeros-pasos/inicio' })],
            stop_reason: 'tool_use',
        });
        const { runner, registradas, entrada } = armar([paso(0), paso(1), paso(2), paso(3), paso(4)]);
        const r = await runner.correr(entrada());
        expect(MAX_ITERACIONES).toBe(4);
        expect(r.llamadas).toBe(4);
        expect(registradas).toHaveLength(4);
        expect(r.estado).toBe('cortado');
        expect(r.texto).toContain('No llegué a terminar');
        // El historial queda coherente: termina en un mensaje del asistente.
        expect(r.apiAsistente.at(-1)?.role).toBe('assistant');
    });

    it('refusal: rechazado, texto fijo, sin ejecutar herramientas', async () => {
        const { runner, eventos, entrada } = armar([
            {
                content: [usoHerramienta('t1', 'ofrecer_ir_a', { ruta: '/reportes', motivo: 'x' })],
                stop_reason: 'refusal',
                stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
            },
        ]);
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('rechazado');
        expect(r.texto).toBe(TEXTO_RECHAZO);
        expect(r.acciones).toEqual([]);
        expect(r.fuentes).toEqual([]);
        expect(r.apiAsistente).toEqual([]);
        expect(eventos.some((e) => e.evento === 'accion')).toBe(false);
        // El log trae la categoría, nunca el texto de la pregunta.
        const logs = (Logger.prototype.warn as jest.Mock).mock.calls.map((c) => c[0]).join('\n');
        expect(logs).toContain('general_harms');
        expect(logs).not.toContain('plantilla de reportes');
    });

    it('max_tokens con tool_use: no ejecuta la herramienta y corta', async () => {
        const { runner, eventos, cliente, entrada } = armar([
            {
                deltas: ['Voy'],
                content: [texto('Voy'), usoHerramienta('t1', 'ofrecer_ir_a', { ruta: '/reportes', motivo: 'x' })],
                stop_reason: 'max_tokens',
            },
        ]);
        const r = await runner.correr(entrada());
        expect(cliente.llamadas).toHaveLength(1);
        expect(eventos.some((e) => e.evento === 'accion')).toBe(false);
        expect(r.estado).toBe('cortado');
        expect(r.texto).toBe('Voy\n\n_(La respuesta quedó cortada.)_');
        // Lo que se guarda no deja un tool_use sin su resultado.
        expect(JSON.stringify(r.apiAsistente)).not.toContain('tool_use');
    });

    it('tope mensual alcanzado entre iteraciones: error TOPE_MENSUAL y las llamadas previas ya quedaron registradas', async () => {
        const { runner, registradas, verificar, entrada } = armar([
            { content: [usoHerramienta('t1', 'leer_pagina', { slug: 'primeros-pasos/inicio' })], stop_reason: 'tool_use' },
        ]);
        verificar.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TopeError('TOPE_MENSUAL', 'Tope.'));
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('error');
        expect(r.error).toEqual({ codigo: 'TOPE_MENSUAL', mensaje: 'Tope.' });
        expect(registradas).toHaveLength(1);
        expect(r.costoUsd).toBeCloseTo(0.001);
    });

    it('tope del turno: corta con estado cortado (no es un error para la persona)', async () => {
        const { runner, verificar, entrada } = armar([
            { content: [usoHerramienta('t1', 'leer_pagina', { slug: 'primeros-pasos/inicio' })], stop_reason: 'tool_use' },
        ]);
        verificar.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TopeError('TOPE_TURNO', 'x'));
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('cortado');
        expect(r.error).toBeUndefined();
        expect(r.apiAsistente.at(-1)?.role).toBe('assistant');
    });

    it('abort a mitad: estado cortado y la llamada registrada con error "abortado"', async () => {
        const ac = new AbortController();
        ac.abort();
        const { runner, registradas, entrada } = armar([{ deltas: ['x'], content: [texto('x')], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada({ signal: ac.signal }));
        expect(r.estado).toBe('cortado');
        expect(registradas).toHaveLength(1);
        expect(registradas[0]).toMatchObject({ error: 'abortado', stopReason: null });
        expect(registradas[0].uso.entrada).toBe(0);
    });

    it('Bedrock caído: error MODELO_NO_DISPONIBLE, la llamada se registra con costo 0 y se loguea el stack', async () => {
        const falla = Object.assign(new Error('AccessDeniedException'), { name: 'PermissionDeniedError' });
        const { runner, registradas, entrada } = armar([{ falla, content: [], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('error');
        expect(r.error?.codigo).toBe('MODELO_NO_DISPONIBLE');
        expect(r.error?.mensaje).toBe('El asistente no está disponible en este momento. Probá en un rato.');
        expect(registradas[0]).toMatchObject({ error: 'PermissionDeniedError' });
        expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('PermissionDeniedError'), expect.any(String));
    });

    it('texto repartido en iteraciones: fin.texto los concatena, separados por un párrafo', async () => {
        const { runner, eventos, entrada } = armar([
            { deltas: ['Paso 1.'], content: [texto('Paso 1.'), usoHerramienta('t1', 'leer_pagina', { slug: 'primeros-pasos/inicio' })], stop_reason: 'tool_use' },
            { deltas: ['Fuente: [Inicio](/ayuda/primeros-pasos/inicio)'], content: [texto('Fuente: [Inicio](/ayuda/primeros-pasos/inicio)')], stop_reason: 'end_turn' },
        ]);
        const r = await runner.correr(entrada());
        expect(r.texto).toBe('Paso 1.\n\nFuente: [Inicio](/ayuda/primeros-pasos/inicio)');
        const deltas = eventos.filter((e) => e.evento === 'texto').map((e) => (e as any).data.delta);
        expect(deltas.join('')).toBe(r.texto);
    });

    it('cita inválida: queda fuera de fuentes y se avisa con el slug', async () => {
        const { runner, entrada } = armar([
            {
                deltas: ['Fuente: [A](/ayuda/gestion/buscar-un-caso) · [B](/ayuda/inventada/pagina).'],
                content: [texto('Fuente: [A](/ayuda/gestion/buscar-un-caso) · [B](/ayuda/inventada/pagina).')],
                stop_reason: 'end_turn',
            },
        ]);
        const r = await runner.correr(entrada());
        expect(r.fuentes).toEqual([{ slug: 'gestion/buscar-un-caso', titulo: 'Buscar un caso' }]);
        expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('inventada/pagina'));
    });

    it('strict solo con el endpoint runtime', async () => {
        const conStrict = armar([{ content: [texto('a')], stop_reason: 'end_turn' }], { strict: true });
        await conStrict.runner.correr(conStrict.entrada());
        expect((conStrict.cliente.llamadas[0].tools as any[]).every((t) => t.strict === true)).toBe(true);

        const sin = armar([{ content: [texto('a')], stop_reason: 'end_turn' }], { strict: false });
        await sin.runner.correr(sin.entrada());
        expect((sin.cliente.llamadas[0].tools as any[]).some((t) => 'strict' in t)).toBe(false);
    });

    it('el system es idéntico entre dos turnos de personas distintas (la caché pega)', async () => {
        const a = armar([{ content: [texto('a')], stop_reason: 'end_turn' }]);
        await a.runner.correr(a.entrada());
        const b = armar([{ content: [texto('a')], stop_reason: 'end_turn' }]);
        await b.runner.correr(b.entrada({ persona: { nombre: 'Luis', rol: 'OPERADOR', permisos: OPERADOR }, ahora: new Date('2027-01-01T00:00:00Z') }));
        expect(JSON.stringify(a.cliente.llamadas[0].system)).toBe(JSON.stringify(b.cliente.llamadas[0].system));
        expect(JSON.stringify(a.cliente.llamadas[0].tools)).toBe(JSON.stringify(b.cliente.llamadas[0].tools));
    });

    it('la persona y los permisos van en el mensaje system del turno, no en el system cacheado', async () => {
        const { runner, cliente, entrada } = armar([{ content: [texto('a')], stop_reason: 'end_turn' }]);
        await runner.correr(entrada({ persona: { nombre: 'Luis', rol: 'OPERADOR', permisos: OPERADOR } }));
        const ctx = cliente.llamadas[0].messages[1].content as string;
        expect(ctx).toContain('Persona: Luis · rol OPERADOR');
        expect(ctx).toContain('Ver deudores');
        expect(ctx).not.toContain('Crear reportes');
        expect(JSON.stringify(cliente.llamadas[0].system)).not.toContain('Luis');
    });

    it('una respuesta vacía no se muestra vacía', async () => {
        const { runner, entrada } = armar([{ content: [thinking()], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada());
        expect(r.texto).toContain('No pude armar una respuesta');
    });

    it('una respuesta vacía guarda un mensaje del asistente: si no, la conversación quedaba rota para siempre (auditoría)', async () => {
        const { runner, entrada } = armar([{ content: [thinking()], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada());
        expect(r.apiAsistente.at(-1)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: expect.stringContaining('No pude armar') }] });
    });

    it('tope del turno con la respuesta ya completa (con su fuente): ok, sin "(No llegué a terminar…)" (auditoría)', async () => {
        const { runner, verificar, entrada } = armar([
            {
                deltas: ['Andá a **Reportes**.\n\nFuente: [Armar un reporte](/ayuda/reportes/armar-un-reporte)'],
                content: [
                    texto('Andá a **Reportes**.\n\nFuente: [Armar un reporte](/ayuda/reportes/armar-un-reporte)'),
                    usoHerramienta('t1', 'ofrecer_ir_a', { ruta: '/reportes', motivo: 'x' }),
                ],
                stop_reason: 'tool_use',
            },
        ]);
        verificar.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TopeError('TOPE_TURNO', 'x'));
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('ok');
        expect(r.texto).not.toContain('No llegué a terminar');
        expect(r.apiAsistente.at(-1)?.role).toBe('assistant');
    });

    it('un turno abortado estima la salida por el texto ya emitido', () => {
        const u = usoAbortado({ entrada: 10, salida: 3, thinking: 0, cacheLectura: 0, cacheEscritura5m: 0, cacheEscritura1h: 0 }, 'x'.repeat(900));
        expect(u.salida).toBe(300);
        expect(usoAbortado({ entrada: 10, salida: 500, thinking: 0, cacheLectura: 0, cacheEscritura5m: 0, cacheEscritura1h: 0 }, 'abc').salida).toBe(500);
    });
});
