/**
 * Config de la regla de clave de pago (multiclaves, fase 4a) leída de variables de entorno —
 * compartida entre `ConsolidacionSituacionService` (que decide si un caso se cancela) y
 * `ClavesService` (que arma el chip "Pagada"/"Cancelado con quita" de la ficha).
 *
 * Antes de esta extracción, `claves.service.ts` tenía su propia tolerancia hardcodeada (100
 * centavos) y siempre sumaba los pagos (modo `SUMA`), sin mirar
 * `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS`/`CONSOLIDACION_CLAVE_MODO` — hallazgo de la auditoría
 * de la fase 4a (menor #10): con `CONSOLIDACION_CLAVE_MODO=PAGO_UNICO`, la ficha podía mostrar
 * "Pagada" por la suma de dos pagos parciales que la consolidación real NO habría aceptado (esa
 * regla exige un solo pago que alcance). Un único punto de lectura evita que las dos partes se
 * desincronicen si alguna cambia sin la otra.
 *
 * Ver `docs/multiclaves-spec.md` §10.5c y `consolidacion.service.ts`.
 */

export const TOLERANCIA_CLAVE_MIN = 0;
export const TOLERANCIA_CLAVE_MAX = 1000;
export const DEFAULT_TOLERANCIA_CLAVE_CENTAVOS = 100;

export type ModoClave = 'SUMA' | 'PAGO_UNICO';
export const DEFAULT_MODO_CLAVE: ModoClave = 'SUMA';

/**
 * `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS`, validada. Tira si está fuera de rango o no es un
 * entero — mismo criterio que usa `ConsolidacionSituacionService.onModuleInit` para frenar el
 * arranque del backend.
 */
export function leerToleranciaClaveCentavos(): number {
    const raw = process.env.CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS;
    if (raw == null || raw.trim() === '') return DEFAULT_TOLERANCIA_CLAVE_CENTAVOS;

    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed < TOLERANCIA_CLAVE_MIN || parsed > TOLERANCIA_CLAVE_MAX) {
        throw new Error(
            `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS="${raw}" está fuera del rango aceptado ` +
            `[${TOLERANCIA_CLAVE_MIN}, ${TOLERANCIA_CLAVE_MAX}]. Corregir la variable de entorno y reiniciar. ` +
            `Valor recomendado: ${DEFAULT_TOLERANCIA_CLAVE_CENTAVOS}`,
        );
    }
    return parsed;
}

/** `CONSOLIDACION_CLAVE_MODO`, validado. Mismo criterio que `ConsolidacionSituacionService`. */
export function leerModoClave(): ModoClave {
    const raw = process.env.CONSOLIDACION_CLAVE_MODO;
    if (raw == null || raw.trim() === '') return DEFAULT_MODO_CLAVE;
    if (raw === 'SUMA' || raw === 'PAGO_UNICO') return raw;
    throw new Error(
        `CONSOLIDACION_CLAVE_MODO="${raw}" no es válido. Los valores aceptados son SUMA o PAGO_UNICO. ` +
        `Corregir la variable de entorno y reiniciar. Default: ${DEFAULT_MODO_CLAVE}`,
    );
}
