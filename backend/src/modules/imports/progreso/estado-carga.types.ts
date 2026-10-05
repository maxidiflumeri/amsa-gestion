// Contrato del estado de una carga (docs/imports-progreso-realtime-spec.md §8.4.1).
// Se copia TAL CUAL en frontend/src/types/importProgreso.ts: no cambiar un nombre acá sin cambiarlo allá.

/** Fases que existen en la Fase A. La Fase B agrega valores: el cliente trata cualquier otro
 *  string como "en curso, fase que no conozco" y muestra el texto tal cual. */
export type FaseCarga = 'BORRADOR' | 'EN_COLA' | 'PROCESANDO' | 'POST_PROCESO' | 'TERMINADA';

export type ResultadoCarga = 'OK' | 'CON_ERRORES' | 'CON_ADVERTENCIAS' | 'SIN_FILAS' | 'FALLIDA';

export type EstadoProcesoRemesa = 'PENDIENTE' | 'VALIDANDO' | 'PROCESANDO' | 'FINALIZADA' | 'FALLIDA';

/** Foto completa del estado de una carga. Es el payload de los tres eventos de socket y la
 *  respuesta de los endpoints de estado. Nunca es un delta. */
export interface EstadoCargaDto {
    remesaId: number;
    /** Crece con cada escritura. 0 = remesa heredada, sin fila de progreso. */
    rev: number;
    numeroRemesa: string;
    nombre: string;
    empresaId: number;
    /** Categoría de la remesa (DEUDORES, PAGOS, …). */
    tipo: string;
    usuarioId: number | null;
    /** 'Sistema' si la remesa no tiene creador. */
    usuarioNombre: string;

    estadoProceso: EstadoProcesoRemesa;
    fase: FaseCarga | string;
    subfase: string | null;
    /** Encolada y sin terminar. Lo calcula el backend; el cliente no lo deduce de `fase`. */
    enCurso: boolean;
    /** FINALIZADA o FALLIDA. */
    terminal: boolean;
    /** null mientras `terminal` sea false. */
    resultado: ResultadoCarga | null;

    /** Entero 0-100. Nunca 100 si `terminal` es false. */
    progreso: number;
    /** 0 = no se sabe (la UI muestra barra indeterminada). */
    totalEsperado: number;
    procesadas: number;
    ok: number;
    err: number;
    descartadas: number;
    advertencias: number;
    /** Fase B. null en la A. */
    nuevos: number | null;
    actualizados: number | null;

    /** Motivo, cuando `resultado` es FALLIDA. */
    error: string | null;
    /** Motivo, cuando `resultado` es CON_ADVERTENCIAS. */
    errorPostProceso: string | null;
    intentos: number;

    /** Fechas en ISO 8601 (UTC), armadas con `toISOString()`. */
    encoladaAt: string | null;
    startedAt: string | null;
    heartbeatAt: string | null;
    finishedAt: string | null;
    /** finishedAt − startedAt. null si no terminó o si es heredada. */
    duracionMs: number | null;
    /** Hora del servidor (ISO 8601, UTC) al armar este DTO. Sirve para medir la edad de
     *  `heartbeatAt` sin depender del reloj del navegador. */
    servidorAhora: string;

    /** @deprecated Alias para las pestañas que quedaron abiertas con el frontend anterior.
     *  El código nuevo NO los lee. Se quitan en la Fase C. */
    okFilas: number; // = ok
    errFilas: number; // = err
    totalFilas: number; // = terminal ? procesadas : totalEsperado
    durationMs: number | null; // = duracionMs
}
