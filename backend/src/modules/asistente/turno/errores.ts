/** Un tope de gasto alcanzado entre dos llamadas de un mismo turno (docs/asistente-spec.md §11.2). */
export type CodigoTope = 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'TOPE_TURNO';

export class TopeError extends Error {
    constructor(
        public readonly codigo: CodigoTope,
        mensaje: string,
    ) {
        super(mensaje);
        this.name = 'TopeError';
    }
}

export const MENSAJE_TOPE_MENSUAL =
    'amaIA llegó al tope de gasto de este mes y se pausó para todos. Vuelve el 1.º o cuando un administrador suba el tope.';
export const MENSAJE_TOPE_FUNCION =
    'Esta función de amaIA llegó al tope de gasto de este mes y se pausó. Vuelve el 1.º o cuando un administrador suba el tope.';
export const MENSAJE_PAUSADO = 'amaIA está pausada por un administrador.';
export const MENSAJE_MODELO_NO_DISPONIBLE = 'amaIA no está disponible en este momento. Probá en un rato.';
export const MENSAJE_INTERNO = 'amaIA tuvo un problema. Probá de nuevo en un rato.';
