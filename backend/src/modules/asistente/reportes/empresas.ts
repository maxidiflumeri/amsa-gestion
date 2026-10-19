import { normalizar } from '../adjuntos/perfil-ejemplo';

/**
 * Empresas con nombre exacto (docs/asistente-reportes-spec.md §0.9, nota del 19/10/2026): si el pedido trae el nombre
 * exacto de una empresa se usa esa sin preguntar y el mensaje de la tarjeta nombra las otras que empiezan igual.
 */

export function empresaExacta(nombre: string, empresas: { nombre: string }[]): string | null {
    const k = normalizar(nombre);
    return empresas.find((e) => normalizar(e.nombre) === k)?.nombre ?? null;
}

/** Las otras empresas cuyo nombre empieza igual que `exacta` (TOYOTA → TOYOTA PLAN DE AHORRO, …). */
export function otrasConElMismoPrefijo(exacta: string, empresas: { nombre: string }[]): string[] {
    const k = normalizar(exacta);
    return empresas.map((e) => e.nombre).filter((n) => normalizar(n) !== k && normalizar(n).startsWith(k));
}

/** La línea que se agrega al resultado de `valores_de_campo` de `empresa.nombre` cuando se pidió con `buscar`. */
export function notaDeEmpresaExacta(buscar: string, empresas: { nombre: string }[]): string | null {
    const exacta = empresaExacta(buscar, empresas);
    if (exacta) {
        const otras = otrasConElMismoPrefijo(exacta, empresas);
        return otras.length
            ? `Coincide exacto: «${exacta}». Usala; nombrá las otras ${otras.length} en el mensaje: ${otras.join(', ')}.`
            : `Coincide exacto: «${exacta}». Usala.`;
    }
    const k = normalizar(buscar);
    const parecidas = empresas.filter((e) => normalizar(e.nombre).includes(k)).length;
    return parecidas > 1 ? 'No hay una empresa exacta con ese nombre y hay varias parecidas: preguntale a la persona cuál.' : null;
}
