import { Logger } from '@nestjs/common';
import type { ContentBlock, ContentBlockParam, Message, MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { AccionIrA, EventoSse, FuenteAyuda } from '../dto/asistente.tipos';
import { ClienteModelo } from '../modelo/cliente-modelo';
import { USO_VACIO, UsoTokens, usoDeUsage } from '../modelo/precios';
import { INSTRUCCIONES } from '../prompt/instrucciones';
import {
    TurnoHistorial,
    armarContexto,
    armarSystem,
    armarTools,
    paramsDeLlamada,
    recortarHistorial,
    slugsPresentes,
} from '../prompt/armar-request';
import {
    RUTAS_CATALOGO,
    etiquetaPermiso,
    etiquetasDePermisos,
    limpiarRuta,
    mapaDePantallas,
    resolverRuta,
    rutasAbribles,
    validarIrA,
} from '../rutas/rutas-catalogo';
import { PuertoWiki } from '../wiki/wiki-indice';
import { extraerCitas } from './citas';
import { MENSAJE_MODELO_NO_DISPONIBLE, TopeError } from './errores';

/** Iteraciones máximas del loop de herramientas por turno. */
export const MAX_ITERACIONES = 4;
/** Páginas que se pueden leer con `leer_pagina` en una respuesta. */
export const MAX_LECTURAS = 3;

export const TEXTO_RECHAZO = 'No puedo responder eso. Probá reformular la pregunta o buscá en la Documentación.';
const SUFIJO_CORTADA = '\n\n_(La respuesta quedó cortada.)_';
const SUFIJO_SIN_TERMINAR = '\n\n_(No llegué a terminar: probá preguntar más concreto.)_';
/**
 * Un stream cortado con Detener trae en `usage` solo la salida del `message_start`. Se estima la que alcanzó a generar
 * por el texto ya emitido (unos 3 caracteres por token), para que el costo no quede por debajo de lo facturado.
 */
export function usoAbortado(uso: UsoTokens, textoEmitido: string): UsoTokens {
    return { ...uso, salida: Math.max(uso.salida, Math.ceil(textoEmitido.length / 3)) };
}

const TEXTO_VACIO = 'No pude armar una respuesta. Probá reformular la pregunta.';

export interface LlamadaRegistro {
    usuarioId: number | null;
    conversacionId: number | null;
    mensajeId: number | null;
    funcion: string;
    modelo: string;
    iteracion: number;
    uso: UsoTokens;
    ms: number;
    stopReason: string | null;
    error: string | null;
}

export interface PuertoMedicion {
    /** Registra la llamada y devuelve su costo en USD. Nunca debe perder el costo. */
    registrarLlamada(l: LlamadaRegistro): Promise<number>;
}

export interface PuertoTopes {
    /** Lanza `TopeError` si ya no se puede llamar al modelo (mensual, de la función o del turno). */
    verificarIteracion(funcion: string, costoTurno: number): Promise<void>;
}

export interface DependenciasTurno {
    cliente: ClienteModelo;
    wiki: PuertoWiki;
    topes: PuertoTopes;
    medicion: PuertoMedicion;
    modelo: string;
    /** `strict: true` en las herramientas (solo bedrock-runtime). */
    strict: boolean;
    maxTokensContexto: number;
}

export interface EntradaTurno {
    funcion: string;
    pregunta: string;
    ruta: string;
    persona: { nombre: string; rol: string; permisos: string[] };
    ahora: Date;
    historial: TurnoHistorial[];
    ultimoPromptTokens: number;
    ids: { usuarioId: number | null; conversacionId: number | null; mensajeId: number | null };
    signal: AbortSignal;
    /** Eventos que van al navegador mientras el turno corre: `texto`, `herramienta` y `accion`. */
    emitir: (evento: EventoSse) => void;
}

export type EstadoTurno = 'ok' | 'cortado' | 'rechazado' | 'error';

export interface ResultadoTurno {
    estado: EstadoTurno;
    /** La respuesta completa: todos los textos del turno, en orden. */
    texto: string;
    fuentes: FuenteAyuda[];
    acciones: AccionIrA[];
    /** Lo que aporta el mensaje del usuario al historial: [pregunta, contexto]. */
    apiUsuario: MessageParam[];
    /** Lo que aporta el mensaje del asistente, SIN bloques de thinking. */
    apiAsistente: MessageParam[];
    costoUsd: number;
    llamadas: number;
    ms: number;
    error?: { codigo: 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'MODELO_NO_DISPONIBLE'; mensaje: string };
}

interface ResultadoHerramienta {
    content: string;
    esError: boolean;
}

/** Los bloques de una respuesta, sin thinking y reducidos a los campos que acepta la API al reenviarlos. */
export function sinThinking(content: ContentBlock[]): ContentBlockParam[] {
    const out: ContentBlockParam[] = [];
    for (const b of content) {
        if (b.type === 'text') {
            if (b.text.trim() !== '') out.push({ type: 'text', text: b.text });
        } else if (b.type === 'tool_use') {
            out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
        }
    }
    return out;
}

function textoDe(content: ContentBlock[]): string {
    return content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/**
 * El loop de un turno (docs/asistente-spec.md §7.3). Sin Prisma: el script de evaluación lo corre igual con puertos en
 * memoria. Nunca registra el texto de la pregunta ni de la respuesta en los logs.
 */
export class TurnoRunner {
    private readonly logger = new Logger(TurnoRunner.name);

    constructor(private readonly deps: DependenciasTurno) {}

    async correr(e: EntradaTurno): Promise<ResultadoTurno> {
        const t0 = Date.now();
        const { wiki, cliente, medicion, topes } = this.deps;

        // --- Armado del request ---------------------------------------------------------------------------------
        const actual = resolverRuta(e.ruta);
        const pagina = wiki.paginaPrincipalParaRuta(limpiarRuta(e.ruta));
        const system = armarSystem(INSTRUCCIONES, mapaDePantallas(), wiki.indice);
        const tools = armarTools(
            wiki.slugs,
            RUTAS_CATALOGO.map((r) => r.ruta),
            this.deps.strict,
        );

        const recorte = recortarHistorial(e.historial, {
            ultimoPromptTokens: e.ultimoPromptTokens,
            charsNuevo: e.pregunta.length + (pagina?.cuerpo.length ?? 0) + 2000,
            maxTokens: this.deps.maxTokensContexto,
        });
        if (recorte.descartados > 0) {
            this.logger.log(
                `Historial recortado: ${recorte.descartados} turnos viejos fuera del request (conversacion=${e.ids.conversacionId})`,
            );
        }
        const previos = recorte.historial.flatMap((t) => t.mensajes);
        const presentes = slugsPresentes(previos);

        const contexto = armarContexto({
            nombre: e.persona.nombre,
            rol: e.persona.rol,
            ahora: e.ahora,
            ruta: actual.canonica,
            nombrePantalla: actual.entrada?.nombre ?? null,
            etiquetasPermisos: etiquetasDePermisos(e.persona.permisos),
            rutasAbribles: rutasAbribles(e.persona.permisos),
            pagina: pagina ? { slug: pagina.slug, titulo: pagina.titulo, cuerpo: pagina.cuerpo } : null,
            paginaYaPresente: pagina ? presentes.has(pagina.slug) : false,
        });
        if (pagina) presentes.add(pagina.slug);

        const apiUsuario: MessageParam[] = [
            { role: 'user', content: [{ type: 'text', text: e.pregunta }] },
            { role: 'system', content: contexto },
        ];
        const messages: MessageParam[] = [...previos, ...apiUsuario];
        const apiNuevos: MessageParam[] = [];

        // --- Estado del turno -----------------------------------------------------------------------------------
        let textoTurno = '';
        let costoTurno = 0;
        let llamadas = 0;
        let lecturas = 0;
        let ofertas = 0;
        const acciones: AccionIrA[] = [];
        let estado: EstadoTurno = 'ok';

        const resultado = (extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
            estado,
            texto: textoTurno,
            fuentes: [],
            acciones,
            apiUsuario,
            apiAsistente: apiNuevos,
            costoUsd: costoTurno,
            llamadas,
            ms: Date.now() - t0,
            ...extra,
        });

        const cerrarCortado = (textoIter: string, sufijo: string) => {
            const texto = `${textoIter}${sufijo}`.trim();
            if (texto) apiNuevos.push({ role: 'assistant', content: [{ type: 'text', text: texto }] });
        };

        const ejecutar = (nombre: string, entrada: unknown, id: string): ResultadoHerramienta => {
            const input = (entrada ?? {}) as Record<string, unknown>;
            if (nombre === 'leer_pagina') {
                const slug = typeof input.slug === 'string' ? input.slug : '';
                const p = wiki.pagina(slug);
                if (!p) return { content: 'No existe esa página.', esError: true };
                if (presentes.has(slug)) {
                    return { content: 'Esa página ya está más arriba en esta conversación.', esError: false };
                }
                if (lecturas >= MAX_LECTURAS) {
                    return { content: 'Ya leíste tres páginas en esta respuesta.', esError: true };
                }
                lecturas++;
                presentes.add(slug);
                e.emitir({ evento: 'herramienta', data: { nombre: 'leer_pagina', slug, titulo: p.titulo } });
                return { content: p.cuerpo, esError: false };
            }
            if (nombre === 'ofrecer_ir_a') {
                const ruta = typeof input.ruta === 'string' ? input.ruta : '';
                const motivo = (typeof input.motivo === 'string' ? input.motivo : '').trim().slice(0, 120);
                const v = validarIrA(ruta, e.persona.permisos);
                if (!v.ok && v.motivo === 'NO_EXISTE') {
                    return { content: 'Esa pantalla no existe en el mapa.', esError: true };
                }
                if (!v.ok) {
                    const pide = v.faltan.map(etiquetaPermiso).join(' o ');
                    return {
                        content: `No se mostró: el rol de la persona no puede abrir ${ruta} (pide ${pide}).`,
                        esError: true,
                    };
                }
                if (v.entrada.ruta === actual.canonica) {
                    return { content: 'La persona ya está en esa pantalla.', esError: true };
                }
                if (ofertas >= 1) {
                    return { content: 'Ya ofreciste ir a una pantalla en esta respuesta.', esError: true };
                }
                ofertas++;
                const accion: AccionIrA = {
                    id,
                    tipo: 'ir_a',
                    ruta: v.entrada.ruta,
                    etiqueta: v.entrada.nombre,
                    motivo,
                    resultado: null,
                };
                acciones.push(accion);
                e.emitir({
                    evento: 'accion',
                    data: { id, tipo: 'ir_a', ruta: accion.ruta, etiqueta: accion.etiqueta, motivo },
                });
                return { content: 'Tarjeta mostrada. La persona todavía no eligió.', esError: false };
            }
            return { content: 'Esa herramienta no existe.', esError: true };
        };

        // --- Loop -----------------------------------------------------------------------------------------------
        for (let iter = 0; iter < MAX_ITERACIONES; iter++) {
            try {
                await topes.verificarIteracion(e.funcion, costoTurno);
            } catch (err) {
                if (!(err instanceof TopeError)) throw err;
                if (err.codigo === 'TOPE_TURNO') {
                    this.logger.warn(`Turno cortado por el tope de gasto del turno (mensaje=${e.ids.mensajeId})`);
                    if (/^Fuente:/m.test(textoTurno)) {
                        // La respuesta ya estaba completa (con su fuente): lo que se corta es el cierre después de una
                        // herramienta. El historial necesita un mensaje del asistente al final; no se muestra.
                        estado = 'ok';
                        apiNuevos.push({ role: 'assistant', content: [{ type: 'text', text: 'Listo.' }] });
                        break;
                    }
                    estado = 'cortado';
                    textoTurno += SUFIJO_SIN_TERMINAR;
                    cerrarCortado('', SUFIJO_SIN_TERMINAR);
                    break;
                }
                estado = 'error';
                return resultado({ error: { codigo: err.codigo, mensaje: err.message } });
            }

            let textoIter = '';
            let primerTexto = true;
            const ti = Date.now();
            const stream = cliente.stream(
                paramsDeLlamada({ modelo: this.deps.modelo, system, tools, messages }),
                e.signal,
            );
            stream.onTexto((d) => {
                // Los textos de iteraciones distintas se pegan con un salto de párrafo.
                let delta = d;
                if (primerTexto) {
                    primerTexto = false;
                    if (textoTurno && !textoTurno.endsWith('\n')) delta = `\n\n${d}`;
                }
                textoIter += d;
                textoTurno += delta;
                e.emitir({ evento: 'texto', data: { delta } });
            });

            let msg: Message;
            try {
                msg = await stream.finalMessage();
            } catch (err: any) {
                const abortado = e.signal.aborted || err?.constructor?.name === 'APIUserAbortError';
                llamadas++;
                costoTurno += await medicion.registrarLlamada({
                    ...this.base(e, iter),
                    uso: abortado ? usoAbortado(usoDeUsage(stream.parcial()?.usage), textoIter) : { ...USO_VACIO },
                    ms: Date.now() - ti,
                    stopReason: null,
                    error: abortado ? 'abortado' : String(err?.name ?? 'Error').slice(0, 120),
                });
                if (abortado) {
                    estado = 'cortado';
                    cerrarCortado(textoIter, textoIter ? '' : '(Respuesta interrumpida.)');
                    break;
                }
                // AccessDenied o credenciales: señal de IAM mal aplicada. Siempre con stack.
                this.logger.error(
                    `Falló la llamada al modelo (mensaje=${e.ids.mensajeId}, iteracion=${iter}): ${err?.name}: ${err?.message}`,
                    err?.stack,
                );
                estado = 'error';
                return resultado({ error: { codigo: 'MODELO_NO_DISPONIBLE', mensaje: MENSAJE_MODELO_NO_DISPONIBLE } });
            }

            llamadas++;
            costoTurno += await medicion.registrarLlamada({
                ...this.base(e, iter),
                uso: usoDeUsage(msg.usage),
                ms: Date.now() - ti,
                stopReason: msg.stop_reason,
                error: null,
            });

            const usos = msg.content.filter((b) => b.type === 'tool_use');

            if (msg.stop_reason === 'end_turn' || msg.stop_reason === 'stop_sequence') {
                const bloques = sinThinking(msg.content);
                // Sin ningún bloque (solo thinking o texto en blanco) se guarda el texto de reemplazo: si no, el turno
                // entra al historial sin mensaje de asistente y el request siguiente queda user/system/user/system,
                // que Bedrock rechaza con 400 para siempre en esa conversación.
                apiNuevos.push({ role: 'assistant', content: bloques.length > 0 ? bloques : [{ type: 'text', text: TEXTO_VACIO }] });
                estado = 'ok';
                break;
            }

            if (msg.stop_reason === 'refusal') {
                this.logger.warn(
                    `El modelo se negó a responder (mensaje=${e.ids.mensajeId}, categoria=${msg.stop_details?.category ?? 'sin categoría'})`,
                );
                estado = 'rechazado';
                textoTurno = TEXTO_RECHAZO;
                apiNuevos.length = 0;
                break;
            }

            if (msg.stop_reason !== 'tool_use') {
                // max_tokens, pause_turn, model_context_window_exceeded: no se ejecuta ninguna herramienta.
                this.logger.warn(
                    `Respuesta cortada por ${msg.stop_reason} (mensaje=${e.ids.mensajeId}, herramientas pendientes=${usos.length})`,
                );
                estado = 'cortado';
                textoTurno += SUFIJO_CORTADA;
                cerrarCortado(textoDe(msg.content), SUFIJO_CORTADA);
                break;
            }

            // tool_use: el mensaje con thinking es válido DENTRO del turno; lo guardado va sin thinking.
            messages.push({ role: 'assistant', content: msg.content });
            apiNuevos.push({ role: 'assistant', content: sinThinking(msg.content) });
            const resultados: ToolResultBlockParam[] = usos.map((b) => {
                const r = ejecutar(b.name, b.input, b.id);
                return {
                    type: 'tool_result',
                    tool_use_id: b.id,
                    content: r.content,
                    ...(r.esError ? { is_error: true } : {}),
                };
            });
            messages.push({ role: 'user', content: resultados });
            apiNuevos.push({ role: 'user', content: resultados });

            if (iter === MAX_ITERACIONES - 1) {
                estado = 'cortado';
                textoTurno += SUFIJO_SIN_TERMINAR;
                cerrarCortado('', SUFIJO_SIN_TERMINAR);
            }
        }

        if (estado === 'ok' && textoTurno.trim() === '') textoTurno = TEXTO_VACIO;

        let fuentes: FuenteAyuda[] = [];
        if (estado !== 'rechazado') {
            const citas = extraerCitas(textoTurno, wiki);
            fuentes = citas.fuentes;
            for (const slug of citas.invalidas) {
                this.logger.warn(`La respuesta citó una página que no existe: ${slug} (mensaje=${e.ids.mensajeId})`);
            }
        }
        return resultado({ fuentes });
    }

    private base(e: EntradaTurno, iter: number) {
        return {
            usuarioId: e.ids.usuarioId,
            conversacionId: e.ids.conversacionId,
            mensajeId: e.ids.mensajeId,
            funcion: e.funcion,
            modelo: this.deps.modelo,
            iteracion: iter,
        };
    }
}
