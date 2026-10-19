import type { MessageParam, MessageCreateParamsNonStreaming, TextBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { Coincidencia, rotuloCoincidencia } from '../wiki/buscador';

/** Tope de salida por llamada; el thinking cuenta adentro (docs/asistente-spec.md §7.1). */
export const MAX_TOKENS_SALIDA = 2048;

/** Una conversación ya cerrada: los `MessageParam` exactos que aportó, sin bloques de thinking. */
export interface TurnoHistorial {
    mensajes: MessageParam[];
}

/** Los bloques del `system`: un único bloque con el breakpoint de caché. Pura y determinista. */
export function armarSystem(instrucciones: string, mapa: string, indice: string): TextBlockParam[] {
    return [
        {
            type: 'text',
            text: `${instrucciones}\n\n# Mapa de pantallas\n\n${mapa}\n\n# Índice de la wiki\n\n${indice}`,
            cache_control: { type: 'ephemeral' },
        },
    ];
}

/**
 * Las tres herramientas, en orden fijo (cambiar el orden o los enums invalida la caché). `strict` solo con el endpoint
 * `runtime`: Mantle no tiene structured outputs. El backend valida igual.
 */
export function armarTools(slugs: string[], rutas: string[], strict: boolean): Tool[] {
    const extra = strict ? { strict: true } : {};
    return [
        {
            name: 'leer_pagina',
            description:
                'Devuelve el texto completo de una página de la wiki de ayuda de AMSA Gestión. Usala antes de explicar un procedimiento, salvo que la página ya esté en la conversación.',
            ...extra,
            input_schema: {
                type: 'object',
                properties: {
                    slug: {
                        type: 'string',
                        enum: slugs,
                        description: 'Identificador de la página, tal como figura entre corchetes en el índice.',
                    },
                },
                required: ['slug'],
                additionalProperties: false,
            },
        },
        {
            name: 'buscar_en_wiki',
            description:
                'Busca palabras en el texto completo de todas las páginas de la wiki, no solo en el índice: también en las subsecciones, las tablas y los "Qué puede salir mal". Devuelve las secciones donde aparecen, con su página y un fragmento. Usala cuando el tema no figura en el índice ni en las coincidencias del turno, y siempre antes de decir que algo no está en la documentación.',
            ...extra,
            input_schema: {
                type: 'object',
                properties: {
                    texto: {
                        type: 'string',
                        description:
                            'Las palabras a buscar: las de la persona o las que usaría la pantalla. Pocas y concretas. Ej.: "bloques repetitivos", "importes negativos".',
                    },
                },
                required: ['texto'],
                additionalProperties: false,
            },
        },
        {
            name: 'ofrecer_ir_a',
            description:
                'Muestra a la persona una tarjeta con "Sí, llevarme" y "No, gracias" para ir a otra pantalla del sistema. No navega: la persona decide. Usala como mucho una vez por respuesta y solo hacia pantallas que su rol puede abrir.',
            ...extra,
            input_schema: {
                type: 'object',
                properties: {
                    ruta: {
                        type: 'string',
                        enum: rutas,
                        description: 'Ruta de la pantalla, del mapa de pantallas.',
                    },
                    motivo: {
                        type: 'string',
                        description: 'Qué va a hacer ahí, en pocas palabras. Ej.: "crear una plantilla de reportes".',
                    },
                },
                required: ['ruta', 'motivo'],
                additionalProperties: false,
            },
        },
    ];
}

export interface DatosContexto {
    /** Primer nombre de la persona. */
    nombre: string;
    rol: string;
    ahora: Date;
    /** Ruta canónica de la pantalla (del catálogo) o la ruta limpia si no está. */
    ruta: string;
    /** Nombre de la pantalla en el catálogo, o null. */
    nombrePantalla: string | null;
    etiquetasPermisos: string[];
    rutasAbribles: string[];
    pagina: { slug: string; titulo: string; cuerpo: string } | null;
    /** La página de la pantalla ya está en los mensajes que se van a enviar. */
    paginaYaPresente: boolean;
    /** La persona está leyendo esa página en Documentación (`/ayuda/<slug>`), no es la ayuda de una pantalla. */
    paginaAbiertaEnDocumentacion?: boolean;
    /** Dónde aparecen en la wiki las palabras de la pregunta (búsqueda automática). */
    coincidencias?: Coincidencia[];
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "jueves 16/10/2026 14:05", en hora de Argentina. */
export function formatearFechaAr(d: Date): string {
    const partes = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(d);
    const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
    const dia = DIAS[new Date(Date.UTC(Number(v('year')), Number(v('month')) - 1, Number(v('day')))).getUTCDay()];
    return `${dia} ${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}`;
}

/** El mensaje `role: "system"` que va DESPUÉS de la pregunta en cada turno (docs/asistente-spec.md §8.2). */
export function armarContexto(d: DatosContexto): string {
    const lineas = [
        'Contexto de este turno (lo informa el sistema; la persona no lo puede cambiar):',
        `- Persona: ${d.nombre} · rol ${d.rol}`,
        `- Fecha y hora: ${formatearFechaAr(d.ahora)} (Argentina)`,
        `- Pantalla actual: ${d.ruta} — ${d.nombrePantalla ?? 'pantalla sin nombre en el mapa'}`,
        `- Permisos de su rol: ${d.etiquetasPermisos.length ? d.etiquetasPermisos.join('; ') : 'ninguno'}`,
        `- Pantallas que puede abrir: ${d.rutasAbribles.length ? d.rutasAbribles.join(', ') : 'ninguna'}`,
        '',
    ];
    const coincidencias = d.coincidencias ?? [];
    if (coincidencias.length > 0) {
        lineas.push(
            'Secciones de la wiki donde aparecen las palabras de la pregunta (búsqueda automática en el texto completo; puede traer coincidencias que no vienen al caso):',
            ...coincidencias.map((c) => `- ${rotuloCoincidencia(c)}${c.fragmento ? `: «${c.fragmento}»` : ''}`),
            '',
        );
    }
    if (!d.pagina) {
        lineas.push('Esta pantalla no tiene página de ayuda principal.');
    } else if (d.paginaAbiertaEnDocumentacion) {
        if (d.paginaYaPresente) {
            lineas.push(`La persona tiene abierta en Documentación la página [${d.pagina.slug}], que ya está más arriba en la conversación.`);
        } else {
            lineas.push(
                `Página que la persona tiene abierta en Documentación: [${d.pagina.slug}] ${d.pagina.titulo}`,
                `<pagina slug="${d.pagina.slug}">`,
                d.pagina.cuerpo,
                '</pagina>',
            );
        }
    } else if (d.paginaYaPresente) {
        lineas.push(`La página de ayuda de esta pantalla ([${d.pagina.slug}]) ya está más arriba en la conversación.`);
    } else {
        lineas.push(
            `Página de ayuda principal de esta pantalla: [${d.pagina.slug}] ${d.pagina.titulo}`,
            `<pagina slug="${d.pagina.slug}">`,
            d.pagina.cuerpo,
            '</pagina>',
        );
    }
    return lineas.join('\n');
}

/**
 * Slugs de páginas de ayuda que ya están en estos mensajes: las del contexto de la pantalla (`<pagina slug="…">`) y
 * las que el modelo leyó con `leer_pagina`.
 */
export function slugsPresentes(mensajes: MessageParam[]): Set<string> {
    const slugs = new Set<string>();
    for (const m of mensajes) {
        if (m.role === 'system' && typeof m.content === 'string') {
            for (const x of m.content.matchAll(/<pagina slug="([^"]+)">/g)) slugs.add(x[1]);
        }
        if (m.role === 'assistant' && Array.isArray(m.content)) {
            for (const b of m.content) {
                if (b.type === 'tool_use' && b.name === 'leer_pagina') {
                    const slug = (b.input as { slug?: unknown } | null)?.slug;
                    if (typeof slug === 'string') slugs.add(slug);
                }
            }
        }
    }
    return slugs;
}

/** Estimación gruesa de tokens de un texto: 3 caracteres por token (conservadora para español). */
export function estimarTokens(chars: number): number {
    return Math.ceil(chars / 3);
}

export function largoDeMensajes(mensajes: MessageParam[]): number {
    return JSON.stringify(mensajes).length;
}

export interface OpcionesRecorte {
    /** Prompt total de la última llamada de la conversación (entrada + caché). 0 si no hay. */
    ultimoPromptTokens: number;
    /** Caracteres de lo que se agrega en este turno (pregunta + contexto). */
    charsNuevo: number;
    maxTokens: number;
}

/**
 * Recorte por tamaño (docs/asistente-spec.md §7.2.5): si el prompt estimado pasa `maxTokens`, saca turnos COMPLETOS
 * desde el más viejo. Nunca corta a mitad de turno. A partir de 100.000 tokens Haiku 5.5 cobra ×5.
 */
export function recortarHistorial(
    historial: TurnoHistorial[],
    o: OpcionesRecorte,
): { historial: TurnoHistorial[]; descartados: number } {
    let estimado = o.ultimoPromptTokens + estimarTokens(o.charsNuevo);
    let desde = 0;
    while (estimado > o.maxTokens && desde < historial.length) {
        estimado -= estimarTokens(largoDeMensajes(historial[desde].mensajes));
        desde++;
    }
    return { historial: historial.slice(desde), descartados: desde };
}

/**
 * Copia de los mensajes con el breakpoint de caché rodante en el último bloque del último mensaje `user`. Los
 * mensajes guardados nunca llevan `cache_control`: se agrega acá, en cada request.
 */
export function conBreakpointRodante(mensajes: MessageParam[]): MessageParam[] {
    const copia = structuredClone(mensajes);
    for (let i = copia.length - 1; i >= 0; i--) {
        if (copia[i].role !== 'user') continue;
        if (typeof copia[i].content === 'string') {
            copia[i].content = [{ type: 'text', text: copia[i].content as string }];
        }
        const bloques = copia[i].content as Exclude<MessageParam['content'], string>;
        if (bloques.length > 0) {
            const ultimo = bloques[bloques.length - 1] as { cache_control?: { type: 'ephemeral' } };
            ultimo.cache_control = { type: 'ephemeral' };
        }
        break;
    }
    return copia;
}

export interface EntradaLlamada {
    modelo: string;
    system: TextBlockParam[];
    tools: Tool[];
    messages: MessageParam[];
}

/**
 * Parámetros de cada llamada (§7.1). Sin `thinking` (adaptativo por defecto), sin `temperature`/`top_p`/`top_k`, sin
 * prefill. `effort` fijo: cambiarlo invalida la caché de mensajes.
 */
export function paramsDeLlamada(e: EntradaLlamada): MessageCreateParamsNonStreaming {
    return {
        model: e.modelo,
        max_tokens: MAX_TOKENS_SALIDA,
        output_config: { effort: 'low' },
        system: e.system,
        tools: e.tools,
        messages: conBreakpointRodante(e.messages),
    };
}
