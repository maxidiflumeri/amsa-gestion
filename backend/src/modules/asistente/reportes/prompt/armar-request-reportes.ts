import type { MessageCreateParamsNonStreaming, MessageParam, TextBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { formatearFechaAr, conBreakpointRodante } from '../../prompt/armar-request';
import { MAX_TOKENS_REPORTES } from '../funcion-reportes';

/**
 * Armado del request de la función `reportes` (docs/asistente-reportes-spec.md §7.1 y §7.2). Puro y determinista: el
 * `system` es byte a byte igual entre requests de un mismo deploy (sin fecha, sin nombres, sin empresas), así la caché de
 * 1 hora lo comparte entre todos los que arman reportes.
 */

export function armarSystemReportes(instrucciones: string, catalogo: string): TextBlockParam[] {
    return [
        {
            type: 'text',
            text: `${instrucciones}\n\n# Catálogo de campos\n\n${catalogo}`,
            cache_control: { type: 'ephemeral', ttl: '1h' },
        },
    ];
}

export interface DatosContextoReportes {
    nombre: string;
    rol: string;
    ahora: Date;
    ruta: string;
    nombrePantalla: string | null;
    /** «cartera.xlsx» (ejemplo 12), … */
    ejemplos: { id: number; nombre: string; yaEnviado: boolean }[];
    ultimaPropuesta: { prueba: string; nombre: string } | null;
    /** Solo en el primer turno de la conversación. */
    empresas: { nombre: string; casos: number }[] | null;
}

/** El `role: "system"` que va DESPUÉS de la pregunta en cada turno. */
export function armarContextoReportes(d: DatosContextoReportes): string {
    const hoy = formatearFechaAr(d.ahora).split(' ').slice(0, 2).join(' ');
    const lineas = [
        'Contexto de este turno (lo informa el sistema; la persona no lo puede cambiar):',
        `- Persona: ${d.nombre} · rol ${d.rol}`,
        `- Fecha: ${hoy} (Argentina). Las fechas relativas se resuelven contra esta fecha.`,
        `- Pantalla actual: ${d.ruta} — ${d.nombrePantalla ?? 'pantalla sin nombre en el mapa'}`,
        `- Archivos de ejemplo de esta conversación: ${
            d.ejemplos.length
                ? d.ejemplos.map((e) => `«${e.nombre.replace(/[«»<>]/g, ' ')}» (ejemplo ${e.id}${e.yaEnviado ? ', ya está más arriba' : ''})`).join(', ')
                : 'ninguno'
        }`,
        `- Última propuesta mostrada: ${d.ultimaPropuesta ? `prueba ${d.ultimaPropuesta.prueba} «${d.ultimaPropuesta.nombre.replace(/[«»]/g, ' ')}»` : 'ninguna'}`,
    ];
    if (d.empresas) {
        lineas.push(
            `- Empresas (nombre exacto · casos): ${d.empresas.map((e) => `${e.nombre} · ${e.casos.toLocaleString('es-AR')}`).join(' | ') || 'ninguna'}`,
        );
    }
    return lineas.join('\n');
}

export interface EntradaLlamadaReportes {
    modelo: string;
    system: TextBlockParam[];
    tools: Tool[];
    messages: MessageParam[];
    /** `low` salvo en el set de evaluación (D-8). Cambiarlo invalida la caché de mensajes. */
    effort?: 'low' | 'medium';
}

/** Sin `thinking` (adaptativo por defecto), `temperature`, `top_p`, prefill ni `tool_choice` forzado: dan 400 en Sonnet 5.5. */
export function paramsDeLlamadaReportes(e: EntradaLlamadaReportes): MessageCreateParamsNonStreaming {
    return {
        model: e.modelo,
        max_tokens: MAX_TOKENS_REPORTES,
        output_config: { effort: e.effort ?? 'low' },
        system: e.system,
        tools: e.tools,
        messages: conBreakpointRodante(e.messages),
    };
}
