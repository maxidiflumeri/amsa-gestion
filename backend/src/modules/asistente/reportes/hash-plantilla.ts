import { createHash } from 'crypto';

/** JSON con las claves ordenadas y sin `undefined`: el mismo objeto da siempre el mismo texto. */
function canonico(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonico);
    if (v && typeof v === 'object') {
        return Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
                .filter(([, x]) => x !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([k, x]) => [k, canonico(x)]),
        );
    }
    return v;
}

/**
 * Lo que el editor agrega o normaliza por su cuenta al abrir y guardar un filtro (`variable: false`, `obligatorio: false`,
 * `tipoEscalar`, `enumValues`, textos vacíos): no es un cambio de la persona.
 */
const DEFAULTS_DEL_EDITOR: Record<string, (v: unknown) => boolean> = {
    id: () => true,
    tipoEscalar: () => true,
    enumValues: () => true,
    variable: (v) => v === false,
    obligatorio: (v) => v === false,
    labelVariable: (v) => v === '' || v === null,
    valorPorDefecto: (v) => v === null || v === '',
};

/** La definición sin los `id` de columnas y filtros (que son uuid distintos en cada armado) ni los defaults del editor. */
function canonicaDeFiltroOColumna(x: unknown): unknown {
    if (!x || typeof x !== 'object') return x;
    return Object.fromEntries(Object.entries(x).filter(([k, v]) => !(DEFAULTS_DEL_EDITOR[k]?.(v) ?? false)));
}

function sinIds(definicion: Record<string, any>): Record<string, unknown> {
    const lista = (xs: unknown) => (Array.isArray(xs) ? xs.map(canonicaDeFiltroOColumna) : xs);
    return { ...definicion, columnas: lista(definicion?.columnas), filtros: lista(definicion?.filtros) };
}

/** sha1 de la definición normalizada (ids fuera, claves ordenadas): para saber si se guardó sin cambios. */
export function hashDefinicion(definicion: Record<string, unknown>): string {
    return createHash('sha1').update(JSON.stringify(canonico(sinIds(definicion)))).digest('hex');
}
