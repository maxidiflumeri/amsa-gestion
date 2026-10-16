/** Un servicio con trabajo largo que sabe cortar en un punto seguro cuando el proceso se está cerrando. */
export interface CortablePorCierre {
    /** Pide el corte. Idempotente, sin IO, nunca tira. */
    cortarPorCierre(): void;
    /** Para el log: una línea por trabajo vivo, p. ej. "carga remesa=150 ACTUALIZACIONES 3.000/10.000 PROCESANDO". */
    trabajosEnCurso(): string[];
}

export function esCortablePorCierre(x: unknown): x is CortablePorCierre {
    return (
        typeof x === 'object' &&
        x !== null &&
        typeof (x as CortablePorCierre).cortarPorCierre === 'function' &&
        typeof (x as CortablePorCierre).trabajosEnCurso === 'function'
    );
}
