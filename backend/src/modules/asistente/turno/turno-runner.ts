import { Logger } from '@nestjs/common';
import type { ContentBlock, ContentBlockParam, Message, MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { AccionIrA, EventoSse, FuenteAyuda, MotivoFin } from '../dto/asistente.tipos';
import { ClienteModelo } from '../modelo/cliente-modelo';
import { UsoTokens } from '../modelo/precios';
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
import { Coincidencia, OpcionesBusqueda, rotuloCoincidencia } from '../wiki/buscador';
import { PaginaWiki } from '../wiki/parsear-pagina';
import { PuertoWiki } from '../wiki/wiki-indice';
import { extraerCitas } from './citas';
import { MENSAJE_MODELO_NO_DISPONIBLE, TopeError } from './errores';
import { LlamadaRegistro, PuertoMedicion, PuertoTopes, ResultadoLlamada, claseDeError, llamarModelo, usoAbortado } from './llamada-modelo';
import { PuertoTraza, TRAZA_NULA } from './traza';

// Lo que se extrajo a `llamada-modelo.ts` sigue saliendo de acá: lo importan el servicio, la medición y los tests.
export { usoAbortado };
export type { LlamadaRegistro, PuertoMedicion, PuertoTopes };

/** Iteraciones máximas del loop de herramientas por turno (buscar → leer → leer → responder entra con margen). */
export const MAX_ITERACIONES = 5;
/** Páginas que se pueden leer con `leer_pagina` en una respuesta. */
export const MAX_LECTURAS = 3;
/** Búsquedas con `buscar_en_wiki` en una respuesta. */
export const MAX_BUSQUEDAS = 2;

/**
 * La búsqueda automática con la pregunta, que va en el contexto del turno: solo palabras distintivas y pocas
 * coincidencias, para que lo que el índice ya resuelve no se llene de ruido.
 */
export const BUSQUEDA_AUTOMATICA: OpcionesBusqueda = {
    limite: 4,
    porPagina: 2,
    minCobertura: 0.5,
    minRelativo: 0.35,
    soloDistintivas: true,
    largoFragmento: 140,
};
/** La búsqueda que pide el modelo con `buscar_en_wiki`. */
export const BUSQUEDA_HERRAMIENTA: OpcionesBusqueda = { limite: 6, porPagina: 2, minRelativo: 0.2, largoFragmento: 220 };

/** El `tool_result` de `buscar_en_wiki`. */
export function resultadoBusqueda(texto: string, coincidencias: Coincidencia[]): string {
    if (coincidencias.length === 0) {
        return `No hay coincidencias para «${texto}» en la wiki. Podés probar con otras palabras; si tampoco aparece, no está documentado.`;
    }
    return [
        `Coincidencias para «${texto}» en el texto completo de la wiki, de la más a la menos relevante:`,
        ...coincidencias.map((c, i) => `${i + 1}. ${rotuloCoincidencia(c)}${c.fragmento ? `\n   «${c.fragmento}»` : ''}`),
        'Para responder con una de estas, leé su página con leer_pagina, salvo que ya esté en la conversación.',
    ].join('\n');
}

/**
 * En `/ayuda/<slug>` la persona está leyendo esa página: es "la página de la pantalla". Antes el contexto decía que
 * Documentación no tenía página y el modelo no sabía qué tenía abierto (el 👎 del 18/10/2026).
 */
export function paginaAbiertaEnDocumentacion(ruta: string, wiki: Pick<PuertoWiki, 'pagina'>): PaginaWiki | undefined {
    const m = /^\/ayuda\/(.+)$/.exec(limpiarRuta(ruta));
    return m ? wiki.pagina(m[1]) : undefined;
}

/** Lo mismo que se compara para decir que un texto repite a otro: el comienzo, sin diferencias de espacios. */
const COMIENZO_REPETIDO = 80;

function comienzo(t: string): string {
    return t.replace(/\s+/g, ' ').trim().slice(0, COMIENZO_REPETIDO);
}

/** El texto de una iteración y dónde empieza dentro del texto del turno. */
export interface SegmentoTexto {
    inicio: number;
    texto: string;
}

/**
 * Si el texto de una iteración empieza igual que el de otra posterior, queda solo el posterior: después de mostrar la
 * tarjeta, el modelo a veces reescribe la respuesta entera (6 de 16 en el código de prod, set de evaluación del
 * 19/10/2026). Corta por posición, así que nunca toca otra aparición del mismo texto.
 */
export function sinRespuestasRepetidas(textoTurno: string, segmentos: SegmentoTexto[]): string {
    const aSacar = segmentos.filter((sg, i) => {
        const a = comienzo(sg.texto);
        return a.length >= 40 && segmentos.slice(i + 1).some((b) => comienzo(b.texto) === a);
    });
    if (aSacar.length === 0) return textoTurno;
    let out = textoTurno;
    for (const sg of [...aSacar].reverse()) out = out.slice(0, sg.inicio) + out.slice(sg.inicio + sg.texto.length);
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Una oferta de llevar a otra pantalla: "¿Querés que te lleve…?", "Si querés, te llevo…", "Puedo llevarte…". */
const RE_OFERTA = /(?:que\s+te\s+lleve|\bte\s+llevo\b|\bllevarte\b)/i;
/** No es una oferta: la niega ("no te puedo llevar")… */
const RE_NEGACION = /\b(no|sin|nunca)\b/i;
/** …o la cita: la tarjeta dice **¿Querés que te lleve a «…»?**, o "¿Querés que te lleve…?" entre comillas. */
const RE_CITA = /(?:["«“]|\*\*)\s*¿/;

/** ¿El texto ofrece llevar a la persona a otra pantalla? (También lo usa el set de evaluación.) */
export function ofreceEnTexto(texto: string): boolean {
    return oracionesDe(texto).some(esOferta);
}

function esOferta(oracion: string): boolean {
    return RE_OFERTA.test(oracion) && !RE_NEGACION.test(oracion) && !RE_CITA.test(oracion);
}

/** Las oraciones de una línea, con su puntuación y el espacio que las sigue. */
function oracionesDe(linea: string): string[] {
    return linea.match(/[^.!?\n]*(?:[.!?]+|$)\s*/g)?.filter((o) => o !== '') ?? [];
}

/**
 * Saca la oferta de ir a otra pantalla escrita en el texto cuando no hubo tarjeta: la persona no tiene botón para
 * aceptarla (el 👎 del 17/10/2026). Va por oración: no toca las que la niegan o la citan, y una línea que queda vacía
 * (o con solo la viñeta) se va entera.
 */
export function quitarOfertaSinTarjeta(texto: string): string {
    let cambio = false;
    const lineas = texto.split('\n').map((linea) => {
        const m = /^(\s*(?:[-*]|\d+\.)\s+)?(.*)$/.exec(linea)!;
        const vineta = m[1] ?? '';
        const oraciones = oracionesDe(m[2]);
        const quedan = oraciones.filter((o) => !esOferta(o));
        if (quedan.length === oraciones.length) return linea;
        cambio = true;
        const resto = quedan.join('').trim();
        return resto ? `${vineta}${resto}` : null;
    });
    if (!cambio) return texto;
    return lineas
        .filter((l): l is string => l !== null)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export const TEXTO_RECHAZO = 'No puedo responder eso. Probá reformular la pregunta o buscá en la Documentación.';
const SUFIJO_CORTADA = '\n\n_(La respuesta quedó cortada.)_';
const SUFIJO_SIN_TERMINAR = '\n\n_(No llegué a terminar: probá preguntar más concreto.)_';
const TEXTO_VACIO = 'No pude armar una respuesta. Probá reformular la pregunta.';

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
    /** El medidor del detalle de la respuesta (docs/asistente-detalle-spec.md). Sin él, el turno corre exactamente igual. */
    traza?: PuertoTraza;
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
    error?: { codigo: 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'MODELO_NO_DISPONIBLE' | 'PROMPT_DEMASIADO_GRANDE'; mensaje: string };
}

interface ResultadoHerramienta {
    content: string;
    esError: boolean;
    /** Lo que hizo, en palabras, para el detalle (§8.2). Lo arma el backend: nunca lleva lo que escribió la persona. */
    descripcion?: string;
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
        const traza = e.traza ?? TRAZA_NULA;

        // --- Armado del request ---------------------------------------------------------------------------------
        const actual = resolverRuta(e.ruta);
        const abierta = paginaAbiertaEnDocumentacion(e.ruta, wiki);
        const pagina = abierta ?? wiki.paginaPrincipalParaRuta(limpiarRuta(e.ruta));
        const coincidencias = wiki.buscar(e.pregunta, BUSQUEDA_AUTOMATICA);
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
            paginaAbiertaEnDocumentacion: !!abierta,
            coincidencias,
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
        let busquedas = 0;
        let ofertas = 0;
        const segmentos: SegmentoTexto[] = [];
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
                if (!p) return { content: 'No existe esa página.', esError: true, descripcion: 'Pidió una página que no existe' };
                if (presentes.has(slug)) {
                    return { content: 'Esa página ya está más arriba en esta conversación.', esError: false, descripcion: 'Ya estaba en la conversación' };
                }
                if (lecturas >= MAX_LECTURAS) {
                    return { content: 'Ya leíste tres páginas en esta respuesta.', esError: true, descripcion: 'Ya había leído tres páginas' };
                }
                lecturas++;
                presentes.add(slug);
                e.emitir({ evento: 'herramienta', data: { nombre: 'leer_pagina', slug, titulo: p.titulo } });
                return { content: p.cuerpo, esError: false, descripcion: `Leí «${p.titulo}»` };
            }
            if (nombre === 'buscar_en_wiki') {
                const texto = (typeof input.texto === 'string' ? input.texto : '').trim().slice(0, 200);
                if (!texto) return { content: 'Falta qué buscar.', esError: true };
                if (busquedas >= MAX_BUSQUEDAS) {
                    return { content: 'Ya buscaste dos veces en esta respuesta.', esError: true };
                }
                busquedas++;
                // Sin el texto buscado: puede traer lo que escribió la persona.
                e.emitir({ evento: 'herramienta', data: { nombre: 'buscar_en_wiki' } });
                // La descripción nunca lleva el texto buscado, igual que el evento `herramienta`.
                return { content: resultadoBusqueda(texto, wiki.buscar(texto, BUSQUEDA_HERRAMIENTA)), esError: false, descripcion: 'Busqué en la documentación' };
            }
            if (nombre === 'ofrecer_ir_a') {
                const ruta = typeof input.ruta === 'string' ? input.ruta : '';
                const motivo = (typeof input.motivo === 'string' ? input.motivo : '').trim().slice(0, 120);
                const v = validarIrA(ruta, e.persona.permisos);
                // Sin el motivo en la descripción: trae la ruta que pidió el modelo.
                const noSeMostro = 'No se mostró la tarjeta';
                if (!v.ok && v.motivo === 'NO_EXISTE') {
                    return { content: 'Esa pantalla no existe en el mapa.', esError: true, descripcion: noSeMostro };
                }
                if (!v.ok) {
                    const pide = v.faltan.map(etiquetaPermiso).join(' o ');
                    return {
                        content: `No se mostró: el rol de la persona no puede abrir ${ruta} (pide ${pide}).`,
                        esError: true,
                        descripcion: noSeMostro,
                    };
                }
                if (v.entrada.ruta === actual.canonica) {
                    return { content: 'La persona ya está en esa pantalla.', esError: true, descripcion: noSeMostro };
                }
                if (ofertas >= 1) {
                    return { content: 'Ya ofreciste ir a una pantalla en esta respuesta.', esError: true, descripcion: noSeMostro };
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
                return { content: 'Tarjeta mostrada. La persona todavía no eligió.', esError: false, descripcion: `Ofrecí ir a «${accion.etiqueta}»` };
            }
            return { content: 'Esa herramienta no existe.', esError: true };
        };

        // --- Loop -----------------------------------------------------------------------------------------------
        for (let iter = 0; iter < MAX_ITERACIONES; iter++) {
            let primerTexto = true;
            let llamada: ResultadoLlamada;
            const tl = traza.llamada(iter);
            try {
                llamada = await llamarModelo(
                    { cliente, topes, medicion },
                    {
                        funcion: e.funcion,
                        modelo: this.deps.modelo,
                        iteracion: iter,
                        ids: e.ids,
                        params: paramsDeLlamada({ modelo: this.deps.modelo, system, tools, messages }),
                        signal: e.signal,
                        costoTurno,
                        traza: tl,
                        onTexto: (d) => {
                            // Los textos de iteraciones distintas se pegan con un salto de párrafo.
                            let delta = d;
                            if (primerTexto) {
                                primerTexto = false;
                                if (textoTurno && !textoTurno.endsWith('\n')) delta = `\n\n${d}`;
                            }
                            textoTurno += delta;
                            e.emitir({ evento: 'texto', data: { delta } });
                        },
                    },
                );
            } catch (err) {
                if (!(err instanceof TopeError)) throw err;
                traza.motivo(err.codigo.toLowerCase() as MotivoFin);
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
            llamadas++;
            costoTurno += llamada.costo;
            const textoIter = llamada.textoIter;

            if (llamada.tipo === 'abortada') {
                traza.motivo('detenida');
                estado = 'cortado';
                cerrarCortado(textoIter, textoIter ? '' : '(Respuesta interrumpida.)');
                break;
            }
            if (llamada.tipo === 'fallo') {
                // AccessDenied o credenciales: señal de IAM mal aplicada. Siempre con stack.
                this.logger.error(
                    `Falló la llamada al modelo (mensaje=${e.ids.mensajeId}, iteracion=${iter}): ${llamada.error?.name}: ${llamada.error?.message}`,
                    llamada.error?.stack,
                );
                traza.motivo(claseDeError(llamada.error) === 'APIConnectionTimeoutError' ? 'timeout' : 'modelo_no_disponible');
                estado = 'error';
                return resultado({ error: { codigo: 'MODELO_NO_DISPONIBLE', mensaje: MENSAJE_MODELO_NO_DISPONIBLE } });
            }
            const msg: Message = llamada.msg;
            // El texto de esta iteración es lo último que se agregó al del turno.
            if (textoIter) segmentos.push({ inicio: textoTurno.length - textoIter.length, texto: textoIter });

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
                traza.motivo('rechazo');
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
                traza.motivo(msg.stop_reason === 'max_tokens' ? 'max_tokens' : 'otro_corte');
                estado = 'cortado';
                textoTurno += SUFIJO_CORTADA;
                cerrarCortado(textoDe(msg.content), SUFIJO_CORTADA);
                break;
            }

            // tool_use: el mensaje con thinking es válido DENTRO del turno; lo guardado va sin thinking.
            messages.push({ role: 'assistant', content: msg.content });
            apiNuevos.push({ role: 'assistant', content: sinThinking(msg.content) });
            const ofertasAntes = acciones.length;
            const resultados: ToolResultBlockParam[] = usos.map((b) => {
                const th = traza.herramienta(b.name);
                const r = ejecutar(b.name, b.input, b.id);
                if (r.descripcion) th.describir({ texto: r.descripcion, estado: r.esError ? 'error' : 'ok' });
                th.cerrar({ esError: r.esError, caracteresResultado: r.content.length });
                return {
                    type: 'tool_result',
                    tool_use_id: b.id,
                    content: r.content,
                    ...(r.esError ? { is_error: true } : {}),
                };
            });
            messages.push({ role: 'user', content: resultados });
            apiNuevos.push({ role: 'user', content: resultados });

            // La respuesta ya está completa (tiene su fuente) y lo único que pidió es la tarjeta, que se mostró: no hace
            // falta otra llamada. Con ella, el modelo a veces reescribía la respuesta entera o comentaba la tarjeta.
            const soloTarjetas = usos.every((b) => b.name === 'ofrecer_ir_a') && acciones.length - ofertasAntes === usos.length;
            if (soloTarjetas && /^Fuente:/m.test(textoTurno)) {
                traza.motivo('tarjeta');
                apiNuevos.push({ role: 'assistant', content: [{ type: 'text', text: 'Listo.' }] });
                estado = 'ok';
                break;
            }

            if (iter === MAX_ITERACIONES - 1) {
                traza.motivo('iteraciones');
                estado = 'cortado';
                textoTurno += SUFIJO_SIN_TERMINAR;
                cerrarCortado('', SUFIJO_SIN_TERMINAR);
            }
        }

        // Solo con el turno terminado bien: si la reescritura quedó cortada, la versión completa es la anterior.
        if (estado === 'ok') {
            const sinRepetir = sinRespuestasRepetidas(textoTurno, segmentos);
            if (sinRepetir !== textoTurno) {
                this.logger.warn(`La respuesta se repitió después de una herramienta: queda la última versión (mensaje=${e.ids.mensajeId})`);
                textoTurno = sinRepetir;
            }
        }
        if (estado !== 'rechazado' && acciones.length === 0) {
            const sinOferta = quitarOfertaSinTarjeta(textoTurno);
            if (sinOferta !== textoTurno) {
                this.logger.warn(`La respuesta ofrecía ir a una pantalla sin la tarjeta: se saca del texto (mensaje=${e.ids.mensajeId})`);
                textoTurno = sinOferta;
            }
        }
        if (estado === 'ok' && textoTurno.trim() === '') {
            traza.motivo('respuesta_vacia');
            textoTurno = TEXTO_VACIO;
        }

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
}
