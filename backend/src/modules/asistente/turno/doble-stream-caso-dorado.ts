import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages';
import { PRECIOS_DEFAULT } from '../modelo/precios';
import { GuionLlamada, usageCrudo } from './doble-stream-con-tiempos';

/**
 * SOLO PARA LOS TESTS (queda afuera del build). El guion del «caso dorado» de docs/asistente-detalle-spec.md §14.1: dos
 * llamadas de Sonnet 5.5 con una prueba de plantilla en el medio. Los instantes están en ms desde el inicio del turno
 * (`T`); `guion()` los pasa a «ms desde que se abre el stream», que es lo que pide `GuionLlamada`.
 */

export const MODELO_DORADO = 'us.anthropic.claude-sonnet-5-5';
export const PRECIO_DORADO = PRECIOS_DEFAULT[MODELO_DORADO];

/** Los instantes del caso, en ms desde `t0`. */
export const T = {
    topesFin: 20,
    historialFin: 120,
    llamada1: 300,
    stream1: 302,
    herramientaFin: 11200,
    llamada2: 11200,
    guardarFin: 18300,
};

const rel = (base: number, t: number): number => t - base;

/** El guion de las dos llamadas. `inputProbar` es el `input` del `tool_use` de la llamada 1. */
export function guionDorado(inputProbar: Record<string, unknown> = { relleno: 'x'.repeat(532) }): GuionLlamada[] {
    const b1 = T.stream1;
    const b2 = T.llamada2;
    const thinking = { type: 'thinking', thinking: '', signature: '' } as unknown as ContentBlock;
    const llamada1: GuionLlamada = {
        eventos: [
            { en: rel(b1, 700), e: { tipo: 'conexion' } },
            { en: rel(b1, 1400), e: { tipo: 'inicio_mensaje' } },
            { en: rel(b1, 1500), e: { tipo: 'inicio_bloque', indice: 0, bloque: 'thinking' } },
            { en: rel(b1, 4880), e: { tipo: 'fin_bloque', indice: 0 } },
            { en: rel(b1, 4900), e: { tipo: 'inicio_bloque', indice: 1, bloque: 'tool_use', herramienta: 'probar_plantilla' } },
            { en: rel(b1, 6350), e: { tipo: 'fin_bloque', indice: 1 } },
            { en: rel(b1, 6390), e: { tipo: 'fin_mensaje' } },
        ],
        duracion: rel(b1, 6400),
        content: [thinking, { type: 'tool_use', id: 'tu1', name: 'probar_plantilla', input: inputProbar, caller: { type: 'direct' } } as unknown as ContentBlock],
        stop_reason: 'tool_use',
        usage: usageCrudo({ entrada: 1180, salida: 592, thinking: 412, cacheLectura: 11300, cacheEscritura5m: 2400 }),
    };
    const llamada2: GuionLlamada = {
        eventos: [
            { en: rel(b2, 11500), e: { tipo: 'conexion' } },
            { en: rel(b2, 12000), e: { tipo: 'inicio_mensaje' } },
            { en: rel(b2, 12100), e: { tipo: 'inicio_bloque', indice: 0, bloque: 'thinking' } },
            { en: rel(b2, 15280), e: { tipo: 'fin_bloque', indice: 0 } },
            { en: rel(b2, 15300), e: { tipo: 'inicio_bloque', indice: 1, bloque: 'text' } },
            { en: rel(b2, 18150), e: { tipo: 'fin_bloque', indice: 1 } },
            { en: rel(b2, 18190), e: { tipo: 'fin_mensaje' } },
        ],
        textos: [{ en: rel(b2, 15400), delta: 'Listo, la plantilla anda.' }],
        duracion: rel(b2, 18200),
        content: [thinking, { type: 'text', text: 'Listo, la plantilla anda.', citations: null } as unknown as ContentBlock],
        stop_reason: 'end_turn',
        usage: usageCrudo({ entrada: 120, salida: 610, thinking: 230, cacheLectura: 14700, cacheEscritura5m: 352 }),
    };
    return [llamada1, llamada2];
}
