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
