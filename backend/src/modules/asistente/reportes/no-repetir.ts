import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';

/**
 * No repetir los números que escribió la persona (DNI, CUIT, número de cliente, teléfono): la regla de la Fase A,
 * acá como red determinista. En reportes el texto se muestra una sola vez, al final, así que se puede limpiar antes.
 * En el set de evaluación del 19/10/2026, R16 ("el reporte del DNI 30111222") lo repitió en 1 de 2 corridas.
 *
 * Solo toca números de 7 dígitos o más (con puntos, guiones o espacios en el medio) que la persona escribió: "8.412
 * casos" o "hace 90 días" quedan como están. Los filtros de la tarjeta muestran el valor igual: ahí hace falta verlo.
 */
const MIN_DIGITOS = 7;
const RE_NUMERO = /\d[\d.\- ]*\d/g;
export const REEMPLAZO_NUMERO = 'el número que mencionaste';

function soloDigitos(s: string): string {
    return s.replace(/\D/g, '');
}

/** Los números largos de los textos de la persona, solo los dígitos. */
export function numerosDeLaPersona(textos: string[]): Set<string> {
    const out = new Set<string>();
    for (const t of textos) {
        for (const m of t.matchAll(RE_NUMERO)) {
            const d = soloDigitos(m[0]);
            if (d.length >= MIN_DIGITOS) out.add(d);
        }
    }
    return out;
}

/** Los textos `user` del historial (las preguntas anteriores de la conversación). */
export function textosDeUsuario(mensajes: MessageParam[]): string[] {
    const out: string[] = [];
    for (const m of mensajes) {
        if (m.role !== 'user') continue;
        if (typeof m.content === 'string') out.push(m.content);
        else for (const b of m.content) if (b.type === 'text') out.push(b.text);
    }
    return out;
}

/** El texto con cada número de la persona reemplazado; un número distinto (o corto) queda igual. */
export function sinNumerosDeLaPersona(texto: string, numeros: Set<string>): string {
    if (!texto || numeros.size === 0) return texto;
    return texto.replace(RE_NUMERO, (m) => {
        const d = soloDigitos(m);
        return d.length >= MIN_DIGITOS && numeros.has(d) ? REEMPLAZO_NUMERO : m;
    });
}
