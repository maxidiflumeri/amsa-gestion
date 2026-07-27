/**
 * Merge de `camposAdicionales` con semántica "gana el valor nuevo": las claves de
 * `nuevos` reemplazan a las de `base`; las claves de `base` que no están en `nuevos`
 * se conservan. Misma semántica que `mergeCamposAdicionalesEnDeudores`
 * (utils/monto-facturas.ts), extraída como función pura para reutilizar y testear.
 *
 * Robusto ante `null`/`undefined`/valores no-objeto (JSON de Prisma) en cualquiera
 * de los dos lados: los trata como `{}`.
 */
function comoObjeto(v: unknown): Record<string, any> {
    return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, any>)
        : {};
}

export function mergeAdicionales(
    base: unknown,
    nuevos: unknown,
): Record<string, any> {
    return { ...comoObjeto(base), ...comoObjeto(nuevos) };
}

/**
 * ¿Dos `camposAdicionales` son equivalentes en contenido? Sirve para decidir si un merge
 * cambió algo o devolvió lo mismo que ya estaba guardado, y así evitar un UPDATE inútil.
 *
 * Compara en profundidad e ignora el orden de las claves. Trata `null`/`undefined`/no-objeto
 * como `{}`, igual que `mergeAdicionales`.
 */
export function adicionalesEquivalentes(a: unknown, b: unknown): boolean {
    return valoresIguales(comoObjeto(a), comoObjeto(b));
}

function valoresIguales(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;

    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((v, i) => valoresIguales(v, b[i]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a as object);
        const kb = Object.keys(b as object);
        if (ka.length !== kb.length) return false;
        return ka.every(
            (k) =>
                Object.prototype.hasOwnProperty.call(b, k) &&
                valoresIguales((a as any)[k], (b as any)[k]),
        );
    }

    return false;
}
