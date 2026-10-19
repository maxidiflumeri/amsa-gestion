import { Logger } from '@nestjs/common';
import type { ContentBlock, ContentBlockParam, MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { ymdLocal } from '../../../common/utils/dia-local';
import { NodoCatalogo } from '../../reportes/dto/catalogo.dto';
import { PerfilConAvisos, filasDeDatos, normalizar } from '../adjuntos/perfil-ejemplo';
import { hojaPorNombre, perfilATexto } from '../adjuntos/perfil-a-texto';
import { EventoSse, Paso, TarjetaPropuesta } from '../dto/asistente.tipos';
import { ClienteModelo } from '../modelo/cliente-modelo';
import { resolverRuta, limpiarRuta } from '../rutas/rutas-catalogo';
import { MENSAJE_MODELO_NO_DISPONIBLE, TopeError } from '../turno/errores';
import { PuertoMedicion, PuertoTopes, ResultadoLlamada, llamarModelo } from '../turno/llamada-modelo';
import { ResultadoTurno, TEXTO_RECHAZO } from '../turno/turno-runner';
import { Descriptor, describirOpciones } from './describir-propuesta';
import { notaDeEmpresaExacta } from './empresas';
import { FUNCION_REPORTES, MAX_HOJAS, MAX_ITERACIONES_REPORTES, MAX_PROMPT_ESTIMADO, MAX_PRUEBAS, MAX_VALORES } from './funcion-reportes';
import { armarToolsReportes, recortarMostrar, verificarFormaProbar } from './herramientas-reportes';
import { instruccionesReportes } from './prompt/instrucciones-reportes';
import { armarContextoReportes, armarSystemReportes, paramsDeLlamadaReportes } from './prompt/armar-request-reportes';
import { Capacidades, EntradaProbar, PlantillaNormalizada, Vocabulario } from './tipos-reportes';
import { validarPropuesta } from './validador-propuesta';
import { numerosDeLaPersona, sinNumerosDeLaPersona, textosDeUsuario } from './no-repetir';

/**
 * El loop de un turno de la función `reportes` (docs/asistente-reportes-spec.md §7.3). Sin Prisma: el script de evaluación
 * lo corre igual con puertos en memoria. Nunca registra el texto de la pregunta ni de la respuesta en los logs, ni un
 * valor de un filtro.
 */

const TEXTO_SIN_MARGEN = 'Me quedé sin margen de gasto para esta respuesta. Probá pedir algo más concreto o en dos partes.';
const TEXTO_SIN_TERMINAR = 'No llegué a terminar la plantilla. Decime qué priorizar y sigo.';
const SUFIJO_CORTADA = '\n\n_(La respuesta quedó cortada.)_';
const TEXTO_VACIO = 'No pude armar una respuesta. Probá reformular el pedido.';

export interface EjemploConId {
    id: number;
    nombre: string;
    perfil: PerfilConAvisos;
}

export type TarjetaBase = Omit<
    TarjetaPropuesta,
    'propuestaId' | 'prueba' | 'version' | 'casos' | 'casosAproximado' | 'avisos' | 'mensaje' | 'sugerencias' | 'estado' | 'plantillaId' | 'vigente'
>;

export interface PuertoVocabularios {
    /** Carga (y cachea) lo que el validador necesita antes de empezar el turno. */
    preparar(): Promise<void>;
    /** El `tool_result` de `valores_de_campo`. */
    valores(campo: string, buscar?: string): Promise<{ ok: true; texto: string } | { ok: false; error: string }>;
    vocabulario(path: string): Vocabulario | null;
    empresas(): { id: number; nombre: string; casos: number }[];
    formatosTelefono(): ReadonlyMap<number, string>;
    nombresPlantillas(): ReadonlySet<string>;
}

export interface PuertoDatosAdicionales {
    claves(empresa: string): Promise<{ ok: true; claves: string[] } | { ok: false; parecidas: string[] }>;
}

export interface ResultadoPrueba {
    tipo: 'ok';
    id: string;
    propuestaId: number;
    casos: number | null;
    aproximado: boolean;
    columnasVacias: string[];
    avisos: string[];
    /** El `tool_result`: solo cantidades, nunca un valor. */
    textoParaModelo: string;
}

export interface PuertoPrueba {
    probar(a: {
        entrada: EntradaProbar;
        normalizada: PlantillaNormalizada;
        tarjeta: TarjetaBase;
        avisosValidador: string[];
        ids: { conversacionId: number | null; usuarioId: number | null; mensajeId: number | null };
        hoy: string;
    }): Promise<ResultadoPrueba | { tipo: 'ocupada' } | { tipo: 'fallo'; mensaje: string } | { tipo: 'rechazada'; problemas: string[] }>;
}

export interface PuertoPropuestas {
    /** Marca `mostrada` la prueba de esta conversación y devuelve la tarjeta completa; null si no existe. */
    mostrar(a: { conversacionId: number | null; prueba: string; mensaje: string; sugerencias: string[] }): Promise<TarjetaPropuesta | null>;
}

export interface DependenciasReportes {
    cliente: ClienteModelo;
    topes: PuertoTopes;
    medicion: PuertoMedicion;
    modelo: string;
    strict: boolean;
    timeoutMs: number;
    /** Solo el set de evaluación (D-8 y D-12). */
    effort?: 'low' | 'medium';
    strictProbar?: boolean;
    catalogo: NodoCatalogo[];
    catalogoTexto: string;
    capacidades: Capacidades;
    vocabularios: PuertoVocabularios;
    datosAdicionales: PuertoDatosAdicionales;
    prueba: PuertoPrueba;
    propuestas: PuertoPropuestas;
}

export interface EntradaTurnoReportes {
    pregunta: string;
    ruta: string;
    persona: { nombre: string; rol: string };
    ahora: Date;
    /** Los mensajes de los turnos anteriores, con sus bloques de thinking tal cual. */
    previos: MessageParam[];
    esPrimerTurno: boolean;
    /** Los de ESTE mensaje: su perfil va en el primer bloque del `user`. */
    adjuntosNuevos: EjemploConId[];
    /** Todos los de la conversación (incluye los nuevos). */
    ejemplos: EjemploConId[];
    /** El ejemplo del que sale el mapeo: el primero del último mensaje que adjuntó. */
    principalId: number | null;
    ultimaPropuesta: { prueba: string; nombre: string } | null;
    ids: { usuarioId: number | null; conversacionId: number | null; mensajeId: number | null };
    signal: AbortSignal;
    /** `paso` y `propuesta` (y `texto` al final de la iteración que corresponde). */
    emitir: (evento: EventoSse) => void;
}

export interface ResultadoTurnoReportes extends ResultadoTurno {
    pasos: Paso[];
    propuestas: TarjetaPropuesta[];
}

interface ResultadoHerramienta {
    content: string;
    esError: boolean;
}

const textoDe = (content: ContentBlock[]): string => content.map((b) => (b.type === 'text' ? b.text : '')).join('');

/** El historial guarda lo que devolvió el modelo (con thinking), sin bloques de texto vacíos: la API los rechaza. */
function paraHistorial(content: ContentBlock[]): ContentBlockParam[] {
    return content.filter((b) => !(b.type === 'text' && b.text.trim() === '')) as unknown as ContentBlockParam[];
}

/** Las hojas que el modelo pidió con `ver_otra_hoja` en turnos anteriores: el mapeo sigue siendo de esa hoja. */
export function hojasElegidasDesde(previos: MessageParam[]): Map<number, string> {
    const out = new Map<number, string>();
    for (const m of previos) {
        if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
        for (const b of m.content) {
            if (b.type === 'tool_use' && b.name === 'ver_otra_hoja') {
                const i = b.input as { ejemplo?: unknown; hoja?: unknown };
                if (typeof i?.ejemplo === 'number' && typeof i.hoja === 'string') out.set(i.ejemplo, i.hoja);
            }
        }
    }
    return out;
}

/**
 * El ejemplo del que sale el mapeo: el primero de la conversación (`principalId`), salvo que el mapeo use más columnas de
 * otro (la persona pidió otro formato más adelante). Así un adjunto posterior no hace que la regla 19 rechace las columnas
 * del primero, y tampoco ata a la persona al primero si cambió de formato.
 */
export function elegirPrincipal(
    mapeo: { columnaEjemplo: string | null }[],
    ejemplos: EjemploConId[],
    principalId: number | null,
    hojaElegida: Map<number, string>,
): EjemploConId | undefined {
    const porDefecto = principalId !== null ? ejemplos.find((x) => x.id === principalId) : undefined;
    if (ejemplos.length <= 1) return porDefecto ?? ejemplos[0];
    const usadas = mapeo.map((m) => m.columnaEjemplo).filter((x): x is string => typeof x === 'string').map((x) => normalizar(x));
    const puntaje = (ej: EjemploConId): number => {
        const nombreHoja = hojaElegida.get(ej.id);
        const idx = nombreHoja !== undefined ? hojaPorNombre(ej.perfil, nombreHoja) : -1;
        const hoja = ej.perfil.hojas[idx >= 0 ? idx : ej.perfil.hojaUsada] ?? ej.perfil.hojas[0];
        const nombres = new Set(hoja.columnas.map((c) => normalizar(c.encabezado ?? `columna ${c.n}`)));
        return usadas.filter((u) => nombres.has(u)).length;
    };
    let mejor = porDefecto;
    let mejorPuntaje = mejor ? puntaje(mejor) : -1;
    for (const ej of ejemplos) {
        const p = puntaje(ej);
        if (p > mejorPuntaje) {
            mejor = ej;
            mejorPuntaje = p;
        }
    }
    return mejor;
}

function pasoDeEjemplo(e: EjemploConId): Paso {
    const hoja = e.perfil.hojas[e.perfil.hojaUsada] ?? e.perfil.hojas[0];
    const nombre = e.nombre.replace(/[«»]/g, ' ');
    const base = `Leí el ejemplo «${nombre}»: ${hoja.columnas.length} ${hoja.columnas.length === 1 ? 'columna' : 'columnas'} y ${filasDeDatos(hoja)} ${filasDeDatos(hoja) === 1 ? 'fila' : 'filas'}`;
    const notas: string[] = [];
    if (!hoja.conEncabezado) notas.push('sin encabezado');
    if (e.perfil.avisos?.length) notas.push(e.perfil.avisos[0].replace(/\.$/, ''));
    return notas.length > 0 ? { tipo: 'ejemplo', estado: 'aviso', texto: `${base}, ${notas.join('; ')}` } : { tipo: 'ejemplo', estado: 'ok', texto: base };
}

export class TurnoReportesRunner {
    private readonly logger = new Logger(TurnoReportesRunner.name);
    private readonly system;
    private readonly tools;
    private readonly descriptor: Descriptor;

    constructor(private readonly deps: DependenciasReportes) {
        this.system = armarSystemReportes(instruccionesReportes(deps.capacidades), deps.catalogoTexto);
        this.tools = armarToolsReportes(deps.capacidades, deps.strict, deps.strictProbar ?? false);
        this.descriptor = new Descriptor(deps.catalogo);
    }

    async correr(e: EntradaTurnoReportes): Promise<ResultadoTurnoReportes> {
        const t0 = Date.now();
        const { cliente, topes, medicion, vocabularios, capacidades } = this.deps;
        const hoy = ymdLocal(e.ahora);

        await vocabularios.preparar();

        // --- Armado del request -------------------------------------------------------------------------------------
        const actual = resolverRuta(e.ruta);
        const contexto = armarContextoReportes({
            nombre: e.persona.nombre,
            rol: e.persona.rol,
            ahora: e.ahora,
            ruta: actual.canonica ?? limpiarRuta(e.ruta),
            nombrePantalla: actual.entrada?.nombre ?? null,
            ejemplos: e.ejemplos.map((x) => ({ id: x.id, nombre: x.nombre, yaEnviado: !e.adjuntosNuevos.some((n) => n.id === x.id) })),
            ultimaPropuesta: e.ultimaPropuesta,
            empresas: e.esPrimerTurno ? vocabularios.empresas().map((x) => ({ nombre: x.nombre, casos: x.casos })) : null,
        });
        const bloquesEjemplo = e.adjuntosNuevos.map((a) => ({ type: 'text' as const, text: perfilATexto(a.perfil, a.id) }));
        const apiUsuario: MessageParam[] = [
            { role: 'user', content: [...bloquesEjemplo, { type: 'text', text: e.pregunta }] },
            { role: 'system', content: contexto },
        ];
        const messages: MessageParam[] = [...e.previos, ...apiUsuario];
        const apiNuevos: MessageParam[] = [];

        // --- Estado del turno ---------------------------------------------------------------------------------------
        const pasos: Paso[] = [];
        const propuestas: TarjetaPropuesta[] = [];
        const textosIter: string[] = [];
        let iterMostrada: number | null = null;
        let costoTurno = 0;
        let llamadas = 0;
        let pruebas = 0;
        let valores = 0;
        let hojasPedidas = 0;
        let estado: ResultadoTurno['estado'] = 'ok';
        let textoVisible: string | null = null;
        let error: ResultadoTurno['error'];

        const hojaElegida = new Map<number, string>(hojasElegidasDesde(e.previos));
        // Los números largos que escribió la persona (DNI, CUIT, teléfono) no se repiten en lo que se le muestra.
        const numerosPersona = numerosDeLaPersona([e.pregunta, ...textosDeUsuario(e.previos)]);
        const emitirPaso = (p: Paso) => {
            pasos.push(p);
            e.emitir({ evento: 'paso', data: p });
        };

        const resultado = (): ResultadoTurnoReportes => ({
            estado,
            texto: sinNumerosDeLaPersona(textoVisible ?? textosIter.map((t) => t.trim()).filter(Boolean).join('\n\n'), numerosPersona),
            fuentes: [],
            acciones: [],
            apiUsuario,
            apiAsistente: apiNuevos,
            costoUsd: costoTurno,
            llamadas,
            ms: Date.now() - t0,
            pasos,
            propuestas,
            ...(error ? { error } : {}),
        });

        for (const a of e.adjuntosNuevos) emitirPaso(pasoDeEjemplo(a));

        // El tope de gasto del turno se verifica ANTES de cada llamada, así que un request enorme pasaría la primera: se lo
        // estima acá y se corta con un error claro.
        const estimado = Math.ceil((JSON.stringify(this.system).length + JSON.stringify(this.tools).length + JSON.stringify(messages).length) / 3);
        if (estimado > MAX_PROMPT_ESTIMADO) {
            this.logger.warn(`Turno de reportes cortado antes de llamar: el pedido estimado es de ${estimado} tokens (mensaje=${e.ids.mensajeId})`);
            estado = 'error';
            error = {
                codigo: 'PROMPT_DEMASIADO_GRANDE',
                mensaje: 'El pedido es demasiado grande para armarlo (los archivos de ejemplo pesan mucho). Probá con un recorte del archivo o empezá una conversación nueva.',
            };
            return resultado();
        }

        // --- Herramientas -------------------------------------------------------------------------------------------
        const ejecutar = async (nombre: string, entrada: unknown): Promise<ResultadoHerramienta> => {
            const input = (entrada ?? {}) as Record<string, unknown>;

            if (nombre === 'valores_de_campo') {
                const campo = typeof input.campo === 'string' ? input.campo.trim() : '';
                const buscar = typeof input.buscar === 'string' ? input.buscar : undefined;
                if (!campo) return { content: 'Falta el campo.', esError: true };
                if (valores >= MAX_VALORES) return { content: 'Ya pediste valores seis veces en esta respuesta.', esError: true };
                valores++;
                const r = await vocabularios.valores(campo, buscar);
                if (!r.ok) return { content: r.error, esError: true };
                const etiqueta = campo === 'formatos_telefono' ? 'los formatos de teléfono' : this.descriptor.etiquetaDeCampo(campo);
                emitirPaso({ tipo: 'valores', estado: 'ok', texto: `Busqué los valores de ${etiqueta}` });
                // Con una empresa de nombre exacto se usa sin preguntar (el prompt lo dice; el resultado también).
                const nota = campo === 'empresa.nombre' && buscar ? notaDeEmpresaExacta(buscar, vocabularios.empresas()) : null;
                return { content: nota ? `${r.texto}\n${nota}` : r.texto, esError: false };
            }

            if (nombre === 'datos_adicionales') {
                const empresa = typeof input.empresa === 'string' ? input.empresa.trim() : '';
                if (!empresa) return { content: 'Falta la empresa.', esError: true };
                const r = await this.deps.datosAdicionales.claves(empresa);
                if (!r.ok) {
                    return {
                        content: `No hay una empresa llamada «${empresa}».${r.parecidas.length ? ` Las más parecidas: ${r.parecidas.join(', ')}.` : ''}`,
                        esError: true,
                    };
                }
                emitirPaso({ tipo: 'datos_adicionales', estado: 'ok', texto: `Busqué los datos adicionales de ${empresa}: ${r.claves.length} ${r.claves.length === 1 ? 'clave' : 'claves'}` });
                return {
                    content: r.claves.length
                        ? `Claves de datos adicionales de ${empresa} (siempre son texto): ${r.claves.join(', ')}.`
                        : `${empresa} no manda datos adicionales.`,
                    esError: false,
                };
            }

            if (nombre === 'ver_otra_hoja') {
                const id = typeof input.ejemplo === 'number' ? input.ejemplo : NaN;
                const hoja = typeof input.hoja === 'string' ? input.hoja : '';
                const ej = e.ejemplos.find((x) => x.id === id);
                if (!ej) return { content: `No hay un ejemplo con id ${String(input.ejemplo)} en esta conversación.`, esError: true };
                if (hojasPedidas >= MAX_HOJAS) return { content: 'Ya pediste dos hojas en esta respuesta.', esError: true };
                const idx = hojaPorNombre(ej.perfil, hoja);
                if (idx < 0) {
                    return { content: `El ejemplo ${id} no tiene una hoja «${hoja}». Hojas: ${ej.perfil.hojas.map((h) => `«${h.nombre}»`).join(', ')}.`, esError: true };
                }
                hojasPedidas++;
                hojaElegida.set(id, hoja);
                emitirPaso({ tipo: 'hoja', estado: 'ok', texto: `Leí la hoja «${ej.perfil.hojas[idx].nombre}»` });
                return { content: perfilATexto(ej.perfil, id, { hoja: idx }), esError: false };
            }

            if (nombre === 'probar_plantilla') {
                if (pruebas >= MAX_PRUEBAS) {
                    return {
                        content: 'Ya probaste cuatro veces en esta respuesta. Contale a la persona qué no pudiste resolver y preguntale.',
                        esError: true,
                    };
                }
                pruebas++;
                return this.probar(input, e, {
                    hoy,
                    hojaElegida,
                    esUltima: pruebas === MAX_PRUEBAS,
                    emitirPaso,
                });
            }

            if (nombre === 'mostrar_propuesta') {
                if (iterMostrada !== null) return { content: 'Ya mostraste una propuesta en esta respuesta.', esError: true };
                const m = recortarMostrar(input);
                m.mensaje = sinNumerosDeLaPersona(m.mensaje, numerosPersona);
                m.sugerencias = m.sugerencias.map((s) => sinNumerosDeLaPersona(s, numerosPersona));
                const tarjeta = m.prueba ? await this.deps.propuestas.mostrar({ conversacionId: e.ids.conversacionId, ...m }) : null;
                if (!tarjeta) return { content: 'Esa prueba no existe en esta conversación. Mostrá una que haya salido sin errores.', esError: true };
                propuestas.push(tarjeta);
                e.emitir({ evento: 'propuesta', data: tarjeta });
                emitirPaso({ tipo: 'propuesta', estado: 'ok', texto: 'Te muestro la propuesta' });
                iterMostrada = textosIter.length - 1;
                return { content: 'Tarjeta mostrada. La persona todavía no eligió.', esError: false };
            }

            return { content: 'Esa herramienta no existe.', esError: true };
        };

        // --- Loop -----------------------------------------------------------------------------------------------------
        for (let iter = 0; iter < MAX_ITERACIONES_REPORTES; iter++) {
            let llamada: ResultadoLlamada;
            try {
                llamada = await llamarModelo(
                    { cliente, topes, medicion },
                    {
                        funcion: FUNCION_REPORTES,
                        modelo: this.deps.modelo,
                        iteracion: iter,
                        ids: e.ids,
                        params: paramsDeLlamadaReportes({ modelo: this.deps.modelo, system: this.system, tools: this.tools, messages, effort: this.deps.effort }),
                        signal: e.signal,
                        costoTurno,
                        timeoutMs: this.deps.timeoutMs,
                    },
                );
            } catch (err) {
                if (!(err instanceof TopeError)) throw err;
                if (err.codigo === 'TOPE_TURNO') {
                    this.logger.warn(`Turno de reportes cortado por el tope de gasto del turno (mensaje=${e.ids.mensajeId})`);
                    if (iterMostrada !== null) {
                        estado = 'ok';
                        break;
                    }
                    estado = 'cortado';
                    textoVisible = TEXTO_SIN_MARGEN;
                    apiNuevos.push({ role: 'assistant', content: [{ type: 'text', text: TEXTO_SIN_MARGEN }] });
                    break;
                }
                estado = 'error';
                error = { codigo: err.codigo as 'TOPE_MENSUAL' | 'TOPE_FUNCION', mensaje: err.message };
                return resultado();
            }

            llamadas++;
            costoTurno += llamada.costo;

            if (llamada.tipo === 'abortada') {
                // Una iteración sin `finalMessage` no entra al historial; se cierra con un mensaje del asistente.
                estado = 'cortado';
                textoVisible = [...textosIter, llamada.textoIter].map((t) => t.trim()).filter(Boolean).join('\n\n');
                apiNuevos.push({ role: 'assistant', content: [{ type: 'text', text: '(Respuesta interrumpida.)' }] });
                break;
            }
            if (llamada.tipo === 'fallo') {
                this.logger.error(
                    `Falló la llamada al modelo de reportes (mensaje=${e.ids.mensajeId}, iteracion=${iter}): ${llamada.error?.name}: ${llamada.error?.message}`,
                    llamada.error?.stack,
                );
                estado = 'error';
                error = { codigo: 'MODELO_NO_DISPONIBLE', mensaje: MENSAJE_MODELO_NO_DISPONIBLE };
                return resultado();
            }

            const msg = llamada.msg;
            textosIter.push(textoDe(msg.content));
            const usos = msg.content.filter((b) => b.type === 'tool_use');

            if (msg.stop_reason === 'end_turn' || msg.stop_reason === 'stop_sequence') {
                const bloques = paraHistorial(msg.content);
                const hayContenido = msg.content.some((b) => (b.type === 'text' && b.text.trim() !== '') || b.type === 'tool_use');
                apiNuevos.push({
                    role: 'assistant',
                    content: hayContenido ? bloques : [...bloques, { type: 'text', text: TEXTO_VACIO }],
                });
                estado = 'ok';
                if (!hayContenido) textosIter[textosIter.length - 1] = TEXTO_VACIO;
                break;
            }

            if (msg.stop_reason === 'refusal') {
                this.logger.warn(`El modelo de reportes se negó a responder (mensaje=${e.ids.mensajeId}, categoria=${msg.stop_details?.category ?? 'sin categoría'})`);
                estado = 'rechazado';
                textoVisible = TEXTO_RECHAZO;
                apiNuevos.length = 0;
                break;
            }

            if (msg.stop_reason !== 'tool_use') {
                // max_tokens, pause_turn…: un tool_use sin resultado rompería el historial, así que no se ejecuta ninguna.
                this.logger.warn(`Respuesta de reportes cortada por ${msg.stop_reason} (mensaje=${e.ids.mensajeId}, herramientas pendientes=${usos.length})`);
                estado = 'cortado';
                const t = `${textoDe(msg.content)}${SUFIJO_CORTADA}`.trim();
                textoVisible = [...textosIter.slice(0, -1), t].map((x) => x.trim()).filter(Boolean).join('\n\n');
                apiNuevos.push({ role: 'assistant', content: [{ type: 'text', text: t }] });
                break;
            }

            // tool_use: con thinking, tal cual, dentro del turno y en el historial.
            messages.push({ role: 'assistant', content: msg.content });
            apiNuevos.push({ role: 'assistant', content: paraHistorial(msg.content) });
            const resultados: ToolResultBlockParam[] = [];
            for (const b of usos) {
                const r = await ejecutar(b.name, b.input);
                resultados.push({ type: 'tool_result', tool_use_id: b.id, content: r.content, ...(r.esError ? { is_error: true } : {}) });
            }
            messages.push({ role: 'user', content: resultados });
            apiNuevos.push({ role: 'user', content: resultados });

            if (iterMostrada !== null) {
                // La tarjeta ya está: no hace falta otra llamada.
                apiNuevos.push({ role: 'assistant', content: [{ type: 'text', text: 'Listo.' }] });
                estado = 'ok';
                break;
            }
            if (iter === MAX_ITERACIONES_REPORTES - 1) {
                estado = 'cortado';
                textoVisible = TEXTO_SIN_TERMINAR;
                apiNuevos.push({ role: 'assistant', content: [{ type: 'text', text: TEXTO_SIN_TERMINAR }] });
            }
        }

        // Con tarjeta se muestra solo el texto de la iteración que la mostró; las anteriores son notas de trabajo.
        if (textoVisible === null && iterMostrada !== null) textoVisible = (textosIter[iterMostrada] ?? '').trim();
        if (estado === 'ok' && textoVisible === null && textosIter.every((t) => t.trim() === '')) textoVisible = '';

        // Lo que ve la persona del texto: una sola vez, al final (las notas de trabajo no se muestran mientras corre).
        const final = resultado();
        if (final.texto) e.emitir({ evento: 'texto', data: { delta: final.texto } });
        return final;
    }

    private async probar(
        input: unknown,
        e: EntradaTurnoReportes,
        o: { hoy: string; hojaElegida: Map<number, string>; esUltima: boolean; emitirPaso: (p: Paso) => void },
    ): Promise<ResultadoHerramienta> {
        const forma = verificarFormaProbar(input);
        if (!forma.ok) {
            o.emitirPaso({ tipo: 'prueba', estado: 'error', texto: 'La prueba encontró 1 problema: lo corrijo' });
            return { content: forma.error, esError: true };
        }
        const entrada = forma.entrada;
        const { vocabularios } = this.deps;

        const principal = elegirPrincipal(entrada.mapeo, e.ejemplos, e.principalId, o.hojaElegida);
        let ejemploPrincipal;
        if (principal) {
            const nombreHoja = o.hojaElegida.get(principal.id);
            const idx = nombreHoja !== undefined ? hojaPorNombre(principal.perfil, nombreHoja) : -1;
            ejemploPrincipal = { perfil: principal.perfil, hoja: idx >= 0 ? idx : principal.perfil.hojaUsada };
        }

        const usaAdicionales =
            entrada.definicion.columnas.some((c) => c.path.startsWith('camposAdicionales.')) ||
            entrada.definicion.filtros.some((f) => f.path.startsWith('camposAdicionales.'));
        let claves: string[] | null = null;
        if (usaAdicionales && entrada.empresa) {
            const r = await this.deps.datosAdicionales.claves(entrada.empresa);
            claves = r.ok ? r.claves : null;
        }

        const v = validarPropuesta(entrada, {
            catalogo: this.deps.catalogo,
            vocabulario: (p) => vocabularios.vocabulario(p),
            empresas: vocabularios.empresas(),
            clavesAdicionales: claves,
            ejemploPrincipal,
            capacidades: this.deps.capacidades,
            formatosTelefonoIds: new Set(vocabularios.formatosTelefono().keys()),
            nombresPlantillas: vocabularios.nombresPlantillas(),
        });

        if (v.errores.length > 0 || !v.normalizada) {
            // Sin los textos de los errores: un valor de filtro puede ser un DNI que escribió la persona.
            this.logger.warn(`Prueba rechazada (conversación ${e.ids.conversacionId}): ${v.errores.length} errores`);
            o.emitirPaso({
                tipo: 'prueba',
                estado: 'error',
                texto: `La prueba encontró ${v.errores.length} ${v.errores.length === 1 ? 'problema' : 'problemas'}: los corrijo`,
            });
            return {
                content: `La plantilla no pasó la validación (no se corrió nada):\n${v.errores.map((x) => `- ${x}`).join('\n')}`,
                esError: true,
            };
        }

        const n = v.normalizada;
        const tarjeta: TarjetaBase = {
            nombre: n.nombre,
            descripcion: n.descripcion,
            empresa: entrada.empresa ?? null,
            formato: n.formatoSalida,
            opciones: describirOpciones(n),
            mapeo: this.descriptor.mapeo(entrada, n, vocabularios.formatosTelefono()),
            filtros: this.descriptor.filtros(n, o.hoy),
            orden: this.descriptor.orden(n),
        };
        const r = await this.deps.prueba.probar({ entrada, normalizada: n, tarjeta, avisosValidador: v.avisos, ids: e.ids, hoy: o.hoy });
        if (r.tipo === 'ocupada') {
            o.emitirPaso({ tipo: 'prueba', estado: 'error', texto: 'No pude probar la plantilla: la base está ocupada' });
            return {
                content: 'No pude probarla ahora: la base está ocupada. No vuelvas a probar en esta respuesta; avisale a la persona.',
                esError: true,
            };
        }
        if (r.tipo === 'rechazada') {
            o.emitirPaso({ tipo: 'prueba', estado: 'error', texto: `La prueba encontró ${r.problemas.length} ${r.problemas.length === 1 ? 'problema' : 'problemas'}: los corrijo` });
            return { content: `La plantilla corrió pero no se puede mostrar (no se guardó):\n${r.problemas.map((x) => `- ${x}`).join('\n')}`, esError: true };
        }
        if (r.tipo === 'fallo') {
            o.emitirPaso({ tipo: 'prueba', estado: 'error', texto: 'La prueba falló: lo corrijo' });
            return { content: `El motor no pudo correr la plantilla: ${r.mensaje}`, esError: true };
        }
        const casos = r.casos === null ? 'no pude contar los casos' : `${r.casos.toLocaleString('es-AR')} casos${r.aproximado ? ' (aprox.)' : ''}`;
        const vacias = r.columnasVacias.length;
        const extra = vacias > 0 ? `, ${vacias} ${vacias === 1 ? 'columna vacía' : 'columnas vacías'} en la muestra` : r.avisos.length > 0 ? `, ${r.avisos.length} ${r.avisos.length === 1 ? 'aviso' : 'avisos'}` : ', sin errores';
        o.emitirPaso({ tipo: 'prueba', estado: vacias > 0 || r.avisos.length > 0 ? 'aviso' : 'ok', texto: `Probé la plantilla: ${casos}${extra}` });
        const cierre = o.esUltima ? '\nEs la última prueba de esta respuesta: mostrá la propuesta o preguntale a la persona qué hacer.' : '';
        return { content: `${r.textoParaModelo}${cierre}`, esError: false };
    }
}
