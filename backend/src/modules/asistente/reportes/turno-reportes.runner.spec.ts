import { Logger } from '@nestjs/common';
import type { ContentBlock, Message } from '@anthropic-ai/sdk/resources/messages';
import { CatalogoService } from '../../reportes/catalogo/catalogo.service';
import { perfilarArchivo } from '../adjuntos/perfil-ejemplo';
import { EventoSse, TarjetaPropuesta } from '../dto/asistente.tipos';
import { ClienteModelo, MessageCreateParamsNonStreaming, StreamModelo } from '../modelo/cliente-modelo';
import { TopeError } from '../turno/errores';
import { LlamadaRegistro } from '../turno/llamada-modelo';
import { catalogoCompacto } from './prompt/catalogo-compacto';
import { CAPACIDADES_TODAS, Vocabulario } from './tipos-reportes';
import {
    DependenciasReportes,
    EntradaTurnoReportes,
    PuertoPrueba,
    ResultadoPrueba,
    TurnoReportesRunner,
    elegirPrincipal,
    hojasElegidasDesde,
} from './turno-reportes.runner';
import { APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import { MotivoFin } from '../dto/asistente.tipos';
import { MODELO_DORADO, PRECIO_DORADO, guionDorado } from '../turno/doble-stream-caso-dorado';
import { ClienteConTiempos, RelojFalso, medicionConPrecio, topesConTiempo } from '../turno/doble-stream-con-tiempos';
import { PuertoMedicion, PuertoTopes } from '../turno/llamada-modelo';
import { TrazaTurno } from '../turno/traza';

interface Paso {
    content: ContentBlock[];
    stop_reason: Message['stop_reason'];
    falla?: Error;
    stop_details?: Message['stop_details'];
}

const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null };
const texto = (text: string): ContentBlock => ({ type: 'text', text, citations: null }) as ContentBlock;
const razonando = (): ContentBlock => ({ type: 'thinking', thinking: '', signature: 'firma-abc' }) as ContentBlock;
const usar = (id: string, name: string, input: Record<string, unknown>): ContentBlock =>
    ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as unknown as ContentBlock;

class ClienteFalso implements ClienteModelo {
    llamadas: { params: MessageCreateParamsNonStreaming; timeoutMs?: number }[] = [];
    private i = 0;
    constructor(private readonly guion: Paso[]) {}
    stream(params: MessageCreateParamsNonStreaming, signal?: AbortSignal, opciones?: { timeoutMs?: number }): StreamModelo {
        this.llamadas.push({ params: JSON.parse(JSON.stringify(params)), timeoutMs: opciones?.timeoutMs });
        const paso = this.guion[this.i++];
        return {
            onTexto: () => undefined,
            finalMessage: async () => {
                if (!paso) throw new Error('el guion se acabó');
                if (signal?.aborted) throw Object.assign(new Error('abortado'), { name: 'APIUserAbortError' });
                if (paso.falla) throw paso.falla;
                return {
                    id: 'm',
                    type: 'message',
                    role: 'assistant',
                    model: 'm',
                    content: paso.content,
                    stop_reason: paso.stop_reason,
                    stop_sequence: null,
                    stop_details: paso.stop_details ?? null,
                    usage,
                } as unknown as Message;
            },
            parcial: () => undefined,
        };
    }
}

const EMPRESAS = ['TOYOTA', 'TELECOM'].map((nombre, i) => ({ id: i + 1, nombre, casos: 1000 * (i + 1) }));
const VOCAB: Record<string, Vocabulario> = { 'empresa.nombre': { valores: EMPRESAS.map((e) => e.nombre), cerrado: true } };

/** Una propuesta mínima sin archivo de ejemplo: todo agregada. */
const propuesta = (extra: Record<string, unknown> = {}) => ({
    nombre: 'Cartera Toyota',
    empresa: 'TOYOTA',
    formatoSalida: 'xlsx',
    opciones: {},
    definicion: {
        columnas: [
            { label: 'DNI', path: 'documento' },
            { label: 'Saldo', path: 'saldo', tipo: 'numero', decimales: 2 },
        ],
        filtros: [{ path: 'empresa.nombre', operador: 'eq', valor: 'TOYOTA' }],
        ordenamientos: [],
        cardinalidadDefault: 'concatenar',
    },
    mapeo: [
        { columnaEjemplo: null, label: 'DNI', estado: 'agregada', nota: '' },
        { columnaEjemplo: null, label: 'Saldo', estado: 'agregada', nota: '' },
    ],
    ...extra,
});

let catalogo: DependenciasReportes['catalogo'];
beforeAll(async () => {
    catalogo = await new CatalogoService(null as never).getCatalogo('deudor', 3);
});

function armar(guion: Paso[], opciones: { topes?: jest.Mock; ocupada?: boolean; mostrar?: jest.Mock } = {}) {
    const cliente = new ClienteFalso(guion);
    const registradas: LlamadaRegistro[] = [];
    let n = 0;
    const probadas: string[] = [];
    const prueba: PuertoPrueba = {
        probar: async (a) => {
            if (opciones.ocupada) return { tipo: 'ocupada' };
            n++;
            probadas.push(`p${n}`);
            const r: ResultadoPrueba = {
                tipo: 'ok',
                id: `p${n}`,
                propuestaId: 100 + n,
                casos: 8412,
                aproximado: false,
                columnasVacias: [],
                avisos: a.avisosValidador,
                textoParaModelo: `Prueba p${n}: sin errores.\nMuestra: 100 filas.\nCasos de la consulta completa: 8412.`,
            };
            return r;
        },
    };
    const mostrar =
        opciones.mostrar ??
        jest.fn(async ({ prueba: id, mensaje, sugerencias }: { prueba: string; mensaje: string; sugerencias: string[] }): Promise<TarjetaPropuesta | null> =>
            probadas.includes(id)
                ? ({ propuestaId: 100 + Number(id.slice(1)), prueba: id, version: Number(id.slice(1)), mensaje, sugerencias, estado: 'mostrada' } as unknown as TarjetaPropuesta)
                : null,
        );
    const verificar = opciones.topes ?? jest.fn().mockResolvedValue(undefined);
    const runner = new TurnoReportesRunner({
        cliente,
        topes: { verificarIteracion: verificar },
        medicion: {
            registrarLlamada: async (l) => {
                registradas.push(l);
                return 0.01;
            },
        },
        modelo: 'us.anthropic.claude-sonnet-5-5',
        strict: true,
        timeoutMs: 120_000,
        catalogo,
        catalogoTexto: catalogoCompacto(catalogo),
        capacidades: CAPACIDADES_TODAS,
        vocabularios: {
            preparar: async () => undefined,
            valores: async (campo) => (campo === 'empresa.nombre' ? { ok: true, texto: 'TOYOTA\nTELECOM' } : { ok: false, error: `«${campo}» es texto libre: no tiene una lista de valores.` }),
            vocabulario: (p) => VOCAB[p] ?? null,
            empresas: () => EMPRESAS,
            formatosTelefono: () => new Map([[1, '549{numero}']]),
            nombresPlantillas: () => new Set<string>(),
        },
        datosAdicionales: { claves: async () => ({ ok: true, claves: ['MODELO', 'PATENTE'] }) },
        prueba,
        propuestas: { mostrar },
    });
    const eventos: EventoSse[] = [];
    const entrada = (extra: Partial<EntradaTurnoReportes> = {}): EntradaTurnoReportes => ({
        pregunta: 'Armame la cartera de Toyota con documento y saldo',
        ruta: '/reportes',
        persona: { nombre: 'Ana', rol: 'ADMIN' },
        ahora: new Date('2026-10-19T17:05:00Z'),
        previos: [],
        esPrimerTurno: true,
        adjuntosNuevos: [],
        ejemplos: [],
        principalId: null,
        ultimaPropuesta: null,
        ids: { usuarioId: 7, conversacionId: 3, mensajeId: 11 },
        signal: new AbortController().signal,
        emitir: (e) => eventos.push(e),
        ...extra,
    });
    return { runner, cliente, registradas, eventos, entrada, verificar, mostrar };
}

describe('TurnoReportesRunner', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const probar = (id: string, extra: Record<string, unknown> = {}) => ({
        content: [razonando(), usar(id, 'probar_plantilla', propuesta(extra))],
        stop_reason: 'tool_use' as const,
    });
    const mostrar = (id: string, prueba: string) => ({
        content: [razonando(), usar(id, 'mostrar_propuesta', { prueba, mensaje: 'Listo, revisala.', sugerencias: ['Agregá el teléfono'] })],
        stop_reason: 'tool_use' as const,
    });

    it('una pregunta (end_turn): el texto completo es visible, sin herramientas', async () => {
        const { runner, eventos, entrada, registradas } = armar([{ content: [razonando(), texto('¿Cuál Toyota?')], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('ok');
        expect(r.texto).toBe('¿Cuál Toyota?');
        expect(r.propuestas).toEqual([]);
        expect(eventos.filter((e) => e.evento === 'texto')).toHaveLength(1);
        expect(registradas).toHaveLength(1);
        expect(registradas[0]).toMatchObject({ funcion: 'reportes', modelo: 'us.anthropic.claude-sonnet-5-5', iteracion: 0 });
    });

    it('tampoco lo repite en las sugerencias de la tarjeta (re-auditoría)', async () => {
        const conDni = (id: string, prueba: string) => ({
            content: [razonando(), usar(id, 'mostrar_propuesta', { prueba, mensaje: 'Listo.', sugerencias: ['Filtrá por el DNI 30111222', 'Agregá el teléfono'] })],
            stop_reason: 'tool_use' as const,
        });
        const { runner, mostrar: mostrarMock, entrada } = armar([probar('t1'), conDni('t2', 'p1'), { content: [texto('Fuente')], stop_reason: 'end_turn' }]);
        await runner.correr(entrada({ pregunta: 'Armame el reporte del DNI 30111222 con todos sus pagos' }));
        const llamada = mostrarMock.mock.calls[0][0];
        expect(JSON.stringify(llamada.sugerencias)).not.toContain('30111222');
        expect(llamada.sugerencias[1]).toBe('Agregá el teléfono');
    });

    it('no repite el DNI que escribió la persona, ni en el texto ni en el mensaje de la tarjeta (R16)', async () => {
        const { runner, entrada } = armar([{ content: [razonando(), texto('Con el filtro documento = 30111222 trae 8.412 casos.')], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada({ pregunta: 'Armame el reporte del DNI 30111222 con todos sus pagos' }));
        expect(r.texto).not.toContain('30111222');
        expect(r.texto).toContain('el número que mencionaste');
        expect(r.texto).toContain('8.412');
    });

    it('prueba rechazada por el validador → reintento → tarjeta; corta después de la tarjeta con "Listo." y no hace otra llamada', async () => {
        const mala = propuesta();
        (mala.definicion.columnas[0] as { path: string }).path = 'estadoSituacion.codigo';
        const { runner, cliente, eventos, entrada } = armar([
            { content: [razonando(), texto('Intento uno.'), usar('t1', 'probar_plantilla', mala)], stop_reason: 'tool_use' },
            probar('t2'),
            { content: [razonando(), texto('Te dejo la propuesta.'), usar('t3', 'mostrar_propuesta', { prueba: 'p1', mensaje: 'Revisala.', sugerencias: [] })], stop_reason: 'tool_use' },
            { content: [texto('no debería llamarse')], stop_reason: 'end_turn' },
        ]);
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('ok');
        expect(cliente.llamadas).toHaveLength(3);
        // La primera prueba fue rechazada con el error del validador y no corrió nada.
        const tr = cliente.llamadas[1].params.messages.at(-1) as { content: { is_error?: boolean; content: string }[] };
        expect(tr.content[0].is_error).toBe(true);
        expect(tr.content[0].content).toContain('La plantilla no pasó la validación (no se corrió nada)');
        expect(tr.content[0].content).toContain('no existe «codigo» dentro de estadoSituacion');
        // Corte con "Listo." en el historial.
        expect(r.apiAsistente.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Listo.' }] });
        expect(r.propuestas).toHaveLength(1);
        // Texto visible: solo el de la iteración de la tarjeta, no la nota "Intento uno.".
        expect(r.texto).toBe('Te dejo la propuesta.');
        const textos = eventos.filter((e) => e.evento === 'texto');
        expect(textos).toHaveLength(1);
        // Pasos en orden: error, ok, propuesta.
        expect(r.pasos.map((p) => `${p.tipo}:${p.estado}`)).toEqual(['prueba:error', 'prueba:ok', 'propuesta:ok']);
        expect(eventos.map((e) => e.evento).filter((x) => x !== 'texto')).toEqual(['paso', 'paso', 'propuesta', 'paso']);
    });

    it('el historial conserva los bloques thinking con su firma, tal cual', async () => {
        const { runner, entrada } = armar([probar('t1'), mostrar('t2', 'p1')]);
        const r = await runner.correr(entrada());
        const asistentes = r.apiAsistente.filter((m) => m.role === 'assistant');
        const conThinking = asistentes.filter((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'thinking'));
        expect(conThinking).toHaveLength(2);
        for (const m of conThinking) {
            expect((m.content as { type: string; signature?: string }[]).find((b) => b.type === 'thinking')).toEqual({ type: 'thinking', thinking: '', signature: 'firma-abc' });
        }
        // Y el historial termina en un mensaje del asistente, sin tool_use sin resultado.
        expect(r.apiAsistente.at(-1)?.role).toBe('assistant');
    });

    it('la 5.ª prueba es is_error y la 4.ª pide mostrar o preguntar', async () => {
        const { runner, cliente, entrada } = armar([probar('t1'), probar('t2'), probar('t3'), probar('t4'), probar('t5'), { content: [texto('Te pregunto.')], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada());
        const ultimo = (i: number) => (cliente.llamadas[i].params.messages.at(-1) as { content: { is_error?: boolean; content: string }[] }).content[0];
        expect(ultimo(4).content).toContain('Es la última prueba de esta respuesta');
        expect(ultimo(5).is_error).toBe(true);
        expect(ultimo(5).content).toContain('Ya probaste cuatro veces');
        expect(r.estado).toBe('ok');
        expect(r.texto).toContain('Te pregunto.');
    });

    it('mostrar_propuesta sin una prueba válida: is_error, y no hay tarjeta', async () => {
        const { runner, cliente, entrada } = armar([mostrar('t1', 'p9'), { content: [texto('Perdón.')], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada());
        const tr = (cliente.llamadas[1].params.messages.at(-1) as { content: { is_error?: boolean; content: string }[] }).content[0];
        expect(tr.is_error).toBe(true);
        expect(tr.content).toContain('Esa prueba no existe en esta conversación');
        expect(r.propuestas).toEqual([]);
    });

    it('la entrada de probar_plantilla con la forma mal da is_error sin validar', async () => {
        const { runner, cliente, entrada } = armar([
            { content: [usar('t1', 'probar_plantilla', { nombre: 'x' })], stop_reason: 'tool_use' },
            { content: [texto('Ok.')], stop_reason: 'end_turn' },
        ]);
        await runner.correr(entrada());
        const tr = (cliente.llamadas[1].params.messages.at(-1) as { content: { is_error?: boolean; content: string }[] }).content[0];
        expect(tr.is_error).toBe(true);
        expect(tr.content).toContain('La entrada no tiene la forma esperada');
    });

    it('datos_adicionales y valores_de_campo arman sus pasos', async () => {
        const { runner, entrada } = armar([
            { content: [usar('a', 'datos_adicionales', { empresa: 'TOYOTA' }), usar('b', 'valores_de_campo', { campo: 'empresa.nombre' })], stop_reason: 'tool_use' },
            { content: [texto('Listo.')], stop_reason: 'end_turn' },
        ]);
        const r = await runner.correr(entrada());
        expect(r.pasos[0]).toEqual({ tipo: 'datos_adicionales', estado: 'ok', texto: 'Busqué los datos adicionales de TOYOTA: 2 claves' });
        expect(r.pasos[1]).toMatchObject({ tipo: 'valores', texto: 'Busqué los valores de Nombre de la empresa' });
    });

    it('la 7.ª llamada a valores_de_campo es is_error; un campo de texto libre también', async () => {
        const f = (i: number, campo = 'empresa.nombre') => ({ content: [usar(`v${i}`, 'valores_de_campo', { campo })], stop_reason: 'tool_use' as const });
        const { runner, cliente, entrada } = armar([f(1), f(2), f(3), f(4), f(5), f(6, 'nombre'), f(7), { content: [texto('Listo.')], stop_reason: 'end_turn' }]);
        await runner.correr(entrada());
        const res = (i: number) => (cliente.llamadas[i].params.messages.at(-1) as { content: { is_error?: boolean; content: string }[] }).content[0];
        expect(res(6).is_error).toBe(true);
        expect(res(6).content).toContain('es texto libre');
        expect(res(7).is_error).toBe(true);
        expect(res(7).content).toContain('Ya pediste valores seis veces');
    });

    it('valores_de_campo de empresa.nombre con una exacta: el resultado dice «Coincide exacto» y sin buscar no lo dice', async () => {
        const { runner, cliente, entrada } = armar([
            { content: [usar('v1', 'valores_de_campo', { campo: 'empresa.nombre', buscar: 'toyota' })], stop_reason: 'tool_use' },
            { content: [usar('v2', 'valores_de_campo', { campo: 'empresa.nombre' })], stop_reason: 'tool_use' },
            { content: [texto('Listo.')], stop_reason: 'end_turn' },
        ]);
        await runner.correr(entrada());
        const res = (i: number) => (cliente.llamadas[i].params.messages.at(-1) as { content: { content: string }[] }).content[0].content;
        expect(res(1)).toContain('Coincide exacto: «TOYOTA». Usala.');
        expect(res(2)).not.toContain('Coincide exacto');
    });

    it('el perfil del ejemplo es el primer bloque del user, una sola vez; las empresas van solo en el primer turno', async () => {
        const perfil = perfilarArchivo(Buffer.from('DNI;Saldo\n30111222;10,50\n27888999;20,00\n'), 'ejemplo.csv');
        const ej = { id: 12, nombre: 'ejemplo.csv', perfil };
        const a = armar([{ content: [texto('¿Para qué empresa?')], stop_reason: 'end_turn' }]);
        const r1 = await a.runner.correr(a.entrada({ adjuntosNuevos: [ej], ejemplos: [ej], principalId: 12 }));
        const user = a.cliente.llamadas[0].params.messages.at(-2) as { content: { type: string; text: string }[] };
        expect(user.content[0].text).toContain('<ejemplo id="12" archivo="ejemplo.csv"');
        expect(user.content.at(-1)?.text).toBe('Armame la cartera de Toyota con documento y saldo');
        const ctx = a.cliente.llamadas[0].params.messages.at(-1) as { role: string; content: string };
        expect(ctx.role).toBe('system');
        expect(ctx.content).toContain('Empresas (nombre exacto · casos): TOYOTA · 1.000 | TELECOM · 2.000');
        expect(ctx.content).toContain('«ejemplo.csv» (ejemplo 12)');
        expect(r1.pasos[0]).toMatchObject({ tipo: 'ejemplo', estado: 'ok', texto: 'Leí el ejemplo «ejemplo.csv»: 2 columnas y 2 filas' });
        // El valor del archivo no llegó.
        expect(JSON.stringify(a.cliente.llamadas[0].params)).not.toMatch(/30111222|27888999/);

        // Segundo turno: sin el perfil y sin las empresas.
        const b = armar([{ content: [texto('Listo.')], stop_reason: 'end_turn' }]);
        await b.runner.correr(b.entrada({ previos: [...r1.apiUsuario, ...r1.apiAsistente], esPrimerTurno: false, ejemplos: [ej], principalId: 12 }));
        const msgs = JSON.stringify(b.cliente.llamadas[0].params.messages.slice(-2));
        expect(msgs).not.toContain('<ejemplo id=');
        const ctx2 = b.cliente.llamadas[0].params.messages.at(-1) as { content: string };
        expect(ctx2.content).not.toContain('Empresas (nombre exacto');
        expect(ctx2.content).toContain('ya está más arriba');
    });

    it('un pedido enorme se corta ANTES de la primera llamada con un error claro (aunque el tope del turno recién se verifica en la primera)', async () => {
        const a = armar([{ content: [texto('no debería llamarse')], stop_reason: 'end_turn' }]);
        const historial = [{ role: 'user' as const, content: 'x'.repeat(400_000) }, { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'ok' }] }];
        const r = await a.runner.correr(a.entrada({ previos: historial, esPrimerTurno: false }));
        expect(r.estado).toBe('error');
        expect(r.error?.codigo).toBe('PROMPT_DEMASIADO_GRANDE');
        expect(r.error?.mensaje).toContain('demasiado grande');
        expect(a.cliente.llamadas).toHaveLength(0);
        expect(a.registradas).toHaveLength(0);
        expect(a.verificar).not.toHaveBeenCalled();
    });

    it('el bloque <ejemplo> de un perfil enorme se acota a 15.000 caracteres y el turno sí entra', async () => {
        const perfil = perfilarArchivo(Buffer.from('DNI;Saldo\n1;2\n'), 'a.csv');
        perfil.hojas[0].columnas = Array.from({ length: 60 }, (_, n) => ({ ...perfil.hojas[0].columnas[0], n, encabezado: 'x'.repeat(8000) }));
        const a = armar([{ content: [texto('Listo.')], stop_reason: 'end_turn' }]);
        const ej = { id: 12, nombre: 'enorme.csv', perfil };
        const r = await a.runner.correr(a.entrada({ adjuntosNuevos: [ej], ejemplos: [ej], principalId: 12 }));
        expect(r.estado).toBe('ok');
        const bloque = JSON.stringify(a.cliente.llamadas[0].params.messages);
        expect(bloque.length).toBeLessThan(40_000);
    });

    it('los parámetros: Sonnet, effort low, system con caché de 1 hora, timeout de la función y el historial con breakpoint rodante', async () => {
        const { runner, cliente, entrada } = armar([{ content: [texto('x')], stop_reason: 'end_turn' }]);
        await runner.correr(entrada());
        const { params, timeoutMs } = cliente.llamadas[0];
        expect(params.model).toBe('us.anthropic.claude-sonnet-5-5');
        expect(params.max_tokens).toBe(16000);
        expect(params.output_config).toEqual({ effort: 'low' });
        expect((params.system as { cache_control: unknown }[])[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
        expect(params).not.toHaveProperty('thinking');
        expect(params).not.toHaveProperty('temperature');
        expect(params).not.toHaveProperty('tool_choice');
        expect(params.tools?.map((t) => (t as { name: string }).name)).toEqual(['valores_de_campo', 'datos_adicionales', 'ver_otra_hoja', 'probar_plantilla', 'mostrar_propuesta']);
        expect(timeoutMs).toBe(120_000);
        const user = params.messages.find((m) => m.role === 'user') as { content: { cache_control?: unknown }[] };
        expect(user.content.at(-1)?.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('tope del turno: sin tarjeta es cortado con el aviso; con la tarjeta ya mostrada no llega a verificarse', async () => {
        const topes = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TopeError('TOPE_TURNO', 'x'));
        const a = armar([probar('t1')], { topes });
        const r = await a.runner.correr(a.entrada());
        expect(r.estado).toBe('cortado');
        expect(r.texto).toContain('Me quedé sin margen de gasto');
        expect(r.apiAsistente.at(-1)?.role).toBe('assistant');

        const topes2 = jest.fn().mockResolvedValue(undefined);
        const b = armar([probar('t1'), mostrar('t2', 'p1')], { topes: topes2 });
        const r2 = await b.runner.correr(b.entrada());
        expect(r2.estado).toBe('ok');
        expect(topes2).toHaveBeenCalledTimes(2);
    });

    it('tope mensual: error con la llamada previa ya registrada', async () => {
        const topes = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TopeError('TOPE_MENSUAL', 'Tope.'));
        const a = armar([probar('t1')], { topes });
        const r = await a.runner.correr(a.entrada());
        expect(r.estado).toBe('error');
        expect(r.error).toEqual({ codigo: 'TOPE_MENSUAL', mensaje: 'Tope.' });
        expect(a.registradas).toHaveLength(1);
    });

    it('refusal: rechazado, texto fijo, sin historial', async () => {
        const { runner, entrada } = armar([{ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' } as never }]);
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('rechazado');
        expect(r.apiAsistente).toEqual([]);
    });

    it('max_tokens con un tool_use pendiente: no ejecuta nada y cierra el historial sin tool_use', async () => {
        const { runner, mostrar: m, entrada } = armar([{ content: [razonando(), texto('Armando…'), usar('t1', 'mostrar_propuesta', { prueba: 'p1', mensaje: 'x', sugerencias: [] })], stop_reason: 'max_tokens' }]);
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('cortado');
        expect(m).not.toHaveBeenCalled();
        expect(JSON.stringify(r.apiAsistente)).not.toContain('tool_use');
        expect(r.apiAsistente.at(-1)?.role).toBe('assistant');
    });

    it('Detener: cortado, la llamada abortada se registra y el historial cierra con un mensaje del asistente', async () => {
        const ac = new AbortController();
        ac.abort();
        const a = armar([{ content: [texto('x')], stop_reason: 'end_turn' }]);
        const r = await a.runner.correr(a.entrada({ signal: ac.signal }));
        expect(r.estado).toBe('cortado');
        expect(a.registradas[0]).toMatchObject({ error: 'abortado' });
        expect(r.apiAsistente).toEqual([{ role: 'assistant', content: [{ type: 'text', text: '(Respuesta interrumpida.)' }] }]);
    });

    it('la llamada falla: error MODELO_NO_DISPONIBLE', async () => {
        const { runner, entrada } = armar([{ content: [], stop_reason: 'end_turn', falla: Object.assign(new Error('boom'), { name: 'AccessDeniedException' }) }]);
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('error');
        expect(r.error?.codigo).toBe('MODELO_NO_DISPONIBLE');
    });

    it('8 iteraciones sin tarjeta: cortado con el aviso', async () => {
        const f = (i: number) => ({ content: [usar(`v${i}`, 'valores_de_campo', { campo: 'empresa.nombre', buscar: String(i) })], stop_reason: 'tool_use' as const });
        const { runner, cliente, entrada } = armar([f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8)]);
        const r = await runner.correr(entrada());
        expect(cliente.llamadas).toHaveLength(8);
        expect(r.estado).toBe('cortado');
        expect(r.texto).toContain('No llegué a terminar la plantilla');
        expect(r.apiAsistente.at(-1)?.role).toBe('assistant');
    });

    it('una prueba rechazada por el ancho fijo es is_error, paso de error y el modelo tiene que corregir (no hay tarjeta)', async () => {
        const a = armar([probar('t1'), mostrar('t2', 'p1'), { content: [texto('Ajusto el ancho.')], stop_reason: 'end_turn' }], {});
        (a.runner as any).deps.prueba = { probar: async () => ({ tipo: 'rechazada', problemas: ['1 valor de la muestra no entra en «Saldo» (ancho 5): a la derecha se pierden los dígitos más significativos; ampliá el ancho.'] }) };
        const r = await a.runner.correr(a.entrada());
        const tr = (a.cliente.llamadas[1].params.messages.at(-1) as { content: { is_error?: boolean; content: string }[] }).content[0];
        expect(tr.is_error).toBe(true);
        expect(tr.content).toContain('no se puede mostrar');
        expect(r.propuestas).toEqual([]);
        expect(r.pasos[0]).toMatchObject({ tipo: 'prueba', estado: 'error' });
    });

    it('la base ocupada: is_error y paso de error', async () => {
        const { runner, cliente, entrada } = armar([probar('t1'), { content: [texto('No pude.')], stop_reason: 'end_turn' }], { ocupada: true });
        const r = await runner.correr(entrada());
        const tr = (cliente.llamadas[1].params.messages.at(-1) as { content: { is_error?: boolean; content: string }[] }).content[0];
        expect(tr.is_error).toBe(true);
        expect(tr.content).toContain('la base está ocupada');
        expect(r.pasos[0]).toMatchObject({ tipo: 'prueba', estado: 'error' });
    });

    it('una respuesta sin texto ni herramientas (solo thinking) no deja el historial roto', async () => {
        const { runner, entrada } = armar([{ content: [razonando()], stop_reason: 'end_turn' }]);
        const r = await runner.correr(entrada());
        expect(r.estado).toBe('ok');
        expect(r.texto).toContain('No pude armar una respuesta');
        expect(JSON.stringify(r.apiAsistente)).toContain('No pude armar una respuesta');
    });

    it('no loguea el texto de la pregunta ni de los errores de la validación', async () => {
        const warn = jest.spyOn(Logger.prototype, 'warn');
        const mala = propuesta();
        (mala.definicion.filtros[0] as { valor: string }).valor = 'DOCUMENTO-30111222';
        const { runner, entrada } = armar([{ content: [usar('t1', 'probar_plantilla', mala)], stop_reason: 'tool_use' }, { content: [texto('Ok.')], stop_reason: 'end_turn' }]);
        await runner.correr(entrada());
        expect(JSON.stringify(warn.mock.calls)).not.toContain('30111222');
    });
});

describe('hojasElegidasDesde', () => {
    it('recupera la hoja que el modelo pidió en un turno anterior', () => {
        const previos = [
            { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 'a', name: 'ver_otra_hoja', input: { ejemplo: 12, hoja: 'Datos' } }] },
        ];
        expect(hojasElegidasDesde(previos).get(12)).toBe('Datos');
    });
});

describe('elegirPrincipal (§9.5)', () => {
    const ej = (id: number, csv: string) => ({ id, nombre: `e${id}.csv`, perfil: perfilarArchivo(Buffer.from(csv), `e${id}.csv`) });
    const A = ej(1, 'DNI;Saldo\n1;10,50\n2;20,00\n');
    const B = ej(2, 'Cuenta;Importe\n1;10,50\n2;20,00\n');
    const m = (...cols: (string | null)[]) => cols.map((columnaEjemplo) => ({ columnaEjemplo }));

    it('un solo ejemplo, o ninguna columna del ejemplo usada: el primero de la conversación', () => {
        expect(elegirPrincipal(m('DNI'), [A], 1, new Map())?.id).toBe(1);
        expect(elegirPrincipal(m(null, null), [A, B], 1, new Map())?.id).toBe(1);
    });

    it('un adjunto posterior NO reemplaza al primero: el mapeo de las columnas de A se valida contra A', () => {
        expect(elegirPrincipal(m('DNI', 'Saldo'), [A, B], 1, new Map())?.id).toBe(1);
    });

    it('si la persona cambió de formato y el mapeo usa las columnas de B, el principal es B', () => {
        expect(elegirPrincipal(m('Cuenta', 'Importe'), [A, B], 1, new Map())?.id).toBe(2);
    });

    it('con el mismo puntaje gana el primero', () => {
        expect(elegirPrincipal(m('DNI', 'Cuenta'), [A, B], 1, new Map())?.id).toBe(1);
    });
});

// ---- Detalle de la respuesta (docs/asistente-detalle-spec.md §9, §14.1): los enganches del runner de reportes -----------

describe('TurnoReportesRunner con traza', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    /** Lo de `armar`, pero con el cliente, la medición, los topes y la prueba a elección (para el reloj falso). */
    function armarMedido(o: { cliente: ClienteModelo; medicion?: PuertoMedicion; topes?: PuertoTopes; prueba?: PuertoPrueba; modelo?: string }) {
        const probadas: string[] = [];
        const prueba: PuertoPrueba =
            o.prueba ??
            ({
                probar: async (a) => {
                    probadas.push(`p${probadas.length + 1}`);
                    return { tipo: 'ok', id: `p${probadas.length}`, propuestaId: 100, casos: 8412, aproximado: false, columnasVacias: [], avisos: a.avisosValidador, textoParaModelo: 'Prueba: sin errores.' } as ResultadoPrueba;
                },
            } satisfies PuertoPrueba);
        const runner = new TurnoReportesRunner({
            cliente: o.cliente,
            topes: o.topes ?? { verificarIteracion: async () => undefined },
            medicion: o.medicion ?? { registrarLlamada: async () => 0.01 },
            modelo: o.modelo ?? 'us.anthropic.claude-sonnet-5-5',
            strict: true,
            timeoutMs: 120_000,
            catalogo,
            catalogoTexto: catalogoCompacto(catalogo),
            capacidades: CAPACIDADES_TODAS,
            vocabularios: {
                preparar: async () => undefined,
                valores: async (campo) => (campo === 'empresa.nombre' ? { ok: true, texto: 'TOYOTA\nTELECOM' } : { ok: false, error: `«${campo}» es texto libre.` }),
                vocabulario: (p) => VOCAB[p] ?? null,
                empresas: () => EMPRESAS,
                formatosTelefono: () => new Map([[1, '549{numero}']]),
                nombresPlantillas: () => new Set<string>(),
            },
            datosAdicionales: { claves: async () => ({ ok: true, claves: ['MODELO', 'PATENTE'] }) },
            prueba,
            propuestas: {
                mostrar: async ({ prueba: id, mensaje, sugerencias }) =>
                    probadas.includes(id) ? ({ propuestaId: 100, prueba: id, version: 1, mensaje, sugerencias, estado: 'mostrada' } as unknown as TarjetaPropuesta) : null,
            },
        });
        const eventos: EventoSse[] = [];
        const entrada = (extra: Partial<EntradaTurnoReportes> = {}): EntradaTurnoReportes => ({
            pregunta: 'Armame la cartera de Toyota con documento y saldo',
            ruta: '/reportes',
            persona: { nombre: 'Ana', rol: 'ADMIN' },
            ahora: new Date('2026-10-19T17:05:00Z'),
            previos: [],
            esPrimerTurno: true,
            adjuntosNuevos: [],
            ejemplos: [],
            principalId: null,
            ultimaPropuesta: null,
            ids: { usuarioId: 7, conversacionId: 3, mensajeId: 11 },
            signal: new AbortController().signal,
            emitir: (e) => eventos.push(e),
            ...extra,
        });
        return { runner, eventos, entrada };
    }

    const nuevaTraza = () => new TrazaTurno({ funcion: 'reportes', modelo: 'us.anthropic.claude-sonnet-5-5' });
    const hijo = (n: { hijos?: { tipo: string }[] }, tipo: string) => n.hijos!.find((h) => h.tipo === tipo) as any;

    it('el caso dorado del lado del runner: los mismos números que el guion de la spec (§18.3)', async () => {
        const reloj = new RelojFalso();
        const traza = new TrazaTurno({ funcion: 'reportes', modelo: MODELO_DORADO, precio: PRECIO_DORADO, reloj: reloj.ahora });
        const medicion = medicionConPrecio(PRECIO_DORADO);
        // La prueba del servicio, con el reloj: la validación la hace el runner; el resto, la prueba.
        const prueba: PuertoPrueba = {
            probar: async (a) => {
                a.traza!.parte('espera_base')();
                const fm = a.traza!.parte('muestra');
                const fc = a.traza!.parte('conteo');
                reloj.avanzar(3100);
                fm();
                reloj.avanzar(1620);
                fc();
                reloj.avanzar(80);
                return { tipo: 'ok', id: 'p1', propuestaId: 101, casos: 8412, aproximado: false, columnasVacias: [], avisos: [], textoParaModelo: 'x'.repeat(930) } as ResultadoPrueba;
            },
        };
        const { runner, entrada } = armarMedido({
            cliente: new ClienteConTiempos(reloj, guionDorado(propuesta())),
            medicion,
            topes: topesConTiempo(reloj, (n) => (n === 0 ? 2 : 0)),
            prueba,
            modelo: MODELO_DORADO,
        });

        let fin = traza.parte('topes');
        reloj.avanzar(20);
        fin();
        fin = traza.parte('historial');
        reloj.avanzar(100);
        fin();
        traza.parte('contexto');
        reloj.avanzar(180);
        const r = await runner.correr(entrada({ traza }));
        const guardar = traza.parte('guardar');
        reloj.avanzar(100);
        guardar();
        const d = traza.armar({ estado: r.estado });

        expect(r.estado).toBe('ok');
        expect(d.nodos.map((n) => n.tipo)).toEqual(['preparacion', 'llamada', 'herramienta', 'llamada', 'guardar']);
        const [prep, l1, herr, l2] = d.nodos;
        expect(prep).toMatchObject({ ms: 300 });
        expect(l1).toMatchObject({ desdeMs: 300, ms: 6100 });
        expect(l1.costoUsd).toBeCloseTo(0.016951, 6);
        expect(hijo(l1, 'espera')).toMatchObject({ ms: 1200, msConexion: 400, msPrimerEvento: 1100, msTopes: 2 });
        expect(hijo(l1, 'razonamiento')).toMatchObject({ ms: 3400, tokens: 412 });
        expect(hijo(l1, 'pedido')).toMatchObject({ ms: 1500, tokens: 180, nombre: 'probar_plantilla' });
        expect(herr).toMatchObject({ nombre: 'probar_plantilla', recurso: 'base', desdeMs: 6400, ms: 4800, tokensResultado: 310, descripcion: 'Probé la plantilla: 8.412 casos, sin errores' });
        expect(herr.hijos!.map((h) => [h.tipo, h.ms])).toEqual([
            ['validacion', 0],
            ['espera_base', 0],
            ['muestra', 3100],
            ['conteo', 4720],
        ]);
        expect(l2).toMatchObject({ desdeMs: 11200, ms: 7000 });
        expect(l2.costoUsd).toBeCloseTo(0.009559, 6);
        expect(d.totalMs).toBe(18300);
        expect(d.costoUsd).toBeCloseTo(0.02651, 6);
        expect(d.costoUsd).toBeCloseTo(r.costoUsd, 6);
        expect(d.nodos.some((n) => n.tipo === 'otros')).toBe(false);
    });

    it('la descripción de cada herramienta es el texto de su último paso, el mismo que ve la persona', async () => {
        const cliente = new ClienteFalso([
            { content: [usar('v1', 'valores_de_campo', { campo: 'empresa.nombre' }), usar('d1', 'datos_adicionales', { empresa: 'TOYOTA' })], stop_reason: 'tool_use' },
            { content: [usar('t1', 'probar_plantilla', propuesta())], stop_reason: 'tool_use' },
            { content: [usar('m1', 'mostrar_propuesta', { prueba: 'p1', mensaje: 'Listo.', sugerencias: [] })], stop_reason: 'tool_use' },
        ]);
        const { runner, entrada } = armarMedido({ cliente });
        const traza = nuevaTraza();
        const r = await runner.correr(entrada({ traza }));
        const hs = traza.armar({ estado: r.estado }).nodos.filter((n) => n.tipo === 'herramienta');
        expect(hs.map((h) => h.nombre)).toEqual(['valores_de_campo', 'datos_adicionales', 'probar_plantilla', 'mostrar_propuesta']);
        expect(hs.map((h) => h.descripcion)).toEqual(r.pasos.map((p) => p.texto));
        expect(hs.map((h) => h.recurso)).toEqual(['base', 'base', 'base', 'base']);
    });

    it('varios tool_use en una misma respuesta: herramientas en orden y sin solaparse', async () => {
        const cliente = new ClienteFalso([
            { content: [usar('v1', 'valores_de_campo', { campo: 'empresa.nombre' }), usar('d1', 'datos_adicionales', { empresa: 'TOYOTA' })], stop_reason: 'tool_use' },
            { content: [texto('Listo.')], stop_reason: 'end_turn' },
        ]);
        const reloj = new RelojFalso();
        const { runner, entrada } = armarMedido({ cliente });
        const traza = new TrazaTurno({ funcion: 'reportes', modelo: 'm', reloj: () => (reloj.avanzar(7), reloj.t) });
        const r = await runner.correr(entrada({ traza }));
        const hs = traza.armar({ estado: r.estado }).nodos.filter((n) => n.tipo === 'herramienta');
        expect(hs).toHaveLength(2);
        expect(hs[0].desdeMs + hs[0].ms).toBeLessThanOrEqual(hs[1].desdeMs);
    });

    it('PROMPT_DEMASIADO_GRANDE: solo la preparación y su motivo', async () => {
        const cliente = new ClienteFalso([{ content: [texto('no debería llamarse')], stop_reason: 'end_turn' }]);
        const { runner, entrada } = armarMedido({ cliente });
        const traza = nuevaTraza();
        const historial = [{ role: 'user' as const, content: 'x'.repeat(400_000) }, { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'ok' }] }];
        const r = await runner.correr(entrada({ previos: historial, esPrimerTurno: false, traza }));
        const d = traza.armar({ estado: r.estado });
        expect(r.error?.codigo).toBe('PROMPT_DEMASIADO_GRANDE');
        expect(d.motivo).toBe('prompt_demasiado_grande');
        expect(d.nodos.map((n) => n.tipo)).toEqual(['preparacion']);
        expect(d.llamadas).toBe(0);
    });

    it('con y sin traza: pasos, texto, apiAsistente, propuestas, params de cada llamada y el resto del resultado son iguales', async () => {
        const guion = (): Paso[] => [
            { content: [razonando(), usar('t1', 'probar_plantilla', propuesta())], stop_reason: 'tool_use' },
            { content: [razonando(), texto('Te dejo la propuesta.'), usar('t2', 'mostrar_propuesta', { prueba: 'p1', mensaje: 'Revisala.', sugerencias: ['Agregá el teléfono'] })], stop_reason: 'tool_use' },
        ];
        const con = new ClienteFalso(guion());
        const sin = new ClienteFalso(guion());
        const a = armarMedido({ cliente: con });
        const b = armarMedido({ cliente: sin });
        const rCon = await a.runner.correr(a.entrada({ traza: nuevaTraza() }));
        const rSin = await b.runner.correr(b.entrada());
        expect({ ...rCon, ms: 0 }).toEqual({ ...rSin, ms: 0 });
        expect(con.llamadas).toEqual(sin.llamadas);
        expect(a.eventos).toEqual(b.eventos);
    });

    it('la prueba recibe la herramienta en curso; sin traza es la nula, que no hace nada', async () => {
        const vistas: unknown[] = [];
        const prueba: PuertoPrueba = {
            probar: async (x) => {
                vistas.push((x as { traza?: unknown }).traza);
                return { tipo: 'ocupada' };
            },
        };
        const guion = () => new ClienteFalso([{ content: [usar('t1', 'probar_plantilla', propuesta())], stop_reason: 'tool_use' }, { content: [texto('ok')], stop_reason: 'end_turn' }]);
        const a = armarMedido({ cliente: guion(), prueba });
        await a.runner.correr(a.entrada({ traza: nuevaTraza() }));
        const b = armarMedido({ cliente: guion(), prueba });
        await b.runner.correr(b.entrada());
        expect(vistas[0]).toBeDefined();
        const nula = vistas[1] as { parte(t: string): () => void };
        expect(() => nula.parte('muestra')()).not.toThrow();
    });

    describe('el motivo de cada fin (§9)', () => {
        async function motivoDe(guion: Paso[], o: { topes?: jest.Mock; signal?: AbortSignal } = {}): Promise<MotivoFin | null> {
            const a = armarMedido({ cliente: new ClienteFalso(guion), topes: o.topes ? { verificarIteracion: o.topes } : undefined });
            const traza = nuevaTraza();
            const r = await a.runner.correr(a.entrada({ traza, ...(o.signal ? { signal: o.signal } : {}) }));
            return traza.armar({ estado: r.estado }).motivo;
        }
        const probar1: Paso = { content: [razonando(), usar('t1', 'probar_plantilla', propuesta())], stop_reason: 'tool_use' };
        const mostrar1: Paso = { content: [razonando(), usar('t2', 'mostrar_propuesta', { prueba: 'p1', mensaje: 'Listo.', sugerencias: [] })], stop_reason: 'tool_use' };

        it('bien: sin nada que aclarar', async () => {
            expect(await motivoDe([{ content: [texto('¿Cuál Toyota?')], stop_reason: 'end_turn' }])).toBeNull();
        });
        it('tarjeta', async () => {
            expect(await motivoDe([probar1, mostrar1])).toBe('tarjeta');
        });
        it('respuesta_vacia', async () => {
            expect(await motivoDe([{ content: [razonando()], stop_reason: 'end_turn' }])).toBe('respuesta_vacia');
        });
        it('detenida', async () => {
            const ac = new AbortController();
            ac.abort();
            expect(await motivoDe([{ content: [texto('x')], stop_reason: 'end_turn' }], { signal: ac.signal })).toBe('detenida');
        });
        it('tope_turno (con y sin tarjeta), tope_mensual y tope_funcion', async () => {
            for (const codigo of ['TOPE_TURNO', 'TOPE_MENSUAL', 'TOPE_FUNCION'] as const) {
                const topes = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TopeError(codigo, 'x'));
                expect(await motivoDe([probar1], { topes })).toBe(codigo.toLowerCase());
            }
        });
        it('rechazo, max_tokens y otro_corte', async () => {
            expect(await motivoDe([{ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' } as never }])).toBe('rechazo');
            expect(await motivoDe([{ content: [razonando(), texto('Armando…')], stop_reason: 'max_tokens' }])).toBe('max_tokens');
            expect(await motivoDe([{ content: [razonando(), texto('Armando…')], stop_reason: 'pause_turn' }])).toBe('otro_corte');
        });
        it('iteraciones', async () => {
            const f = (i: number): Paso => ({ content: [usar(`v${i}`, 'valores_de_campo', { campo: 'empresa.nombre', buscar: String(i) })], stop_reason: 'tool_use' });
            expect(await motivoDe([f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8)])).toBe('iteraciones');
        });
        it('modelo_no_disponible y timeout', async () => {
            expect(await motivoDe([{ content: [], stop_reason: 'end_turn', falla: Object.assign(new Error('x'), { name: 'AccessDeniedException' }) }])).toBe('modelo_no_disponible');
            expect(await motivoDe([{ content: [], stop_reason: 'end_turn', falla: new APIConnectionTimeoutError() }])).toBe('timeout');
        });
    });
});
