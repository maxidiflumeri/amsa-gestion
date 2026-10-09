// Contrato del progreso de las importaciones (docs/imports-progreso-realtime-spec.md §8.4.1 y §9.4.1).
// Es copia textual de backend/src/modules/imports/progreso/estado-carga.types.ts: no tocar un lado sin el otro.

/** La Fase B agrega LEYENDO. El cliente sigue tratando cualquier otro string como
 *  "en curso, fase que no conozco". */
export type FaseCarga = 'BORRADOR' | 'EN_COLA' | 'LEYENDO' | 'PROCESANDO' | 'POST_PROCESO' | 'TERMINADA';

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
    /** Texto del paso del post-proceso, ya armado para mostrar ("Consolidando casos: 1.500 de 8.875").
     *  null fuera de POST_PROCESO o si el processor no informa. */
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
    /** Filas del archivo que no entraron en esta remesa y no son error. Es el TOTAL (filtro de la
     *  plantilla + otros cortes). */
    descartadas: number;
    /** De las `descartadas`, las que eran de otro corte de la división. null = la remesa no tiene
     *  corte propio, o la carga es anterior a la Fase B. */
    fueraDeCorte: number | null;
    /** `descartadas − (fueraDeCorte ?? 0)`: las que descartó el filtro de la plantilla. */
    descartadasPorFiltro: number;
    advertencias: number;
    /** Casos que esta carga creó. null si la categoría no lo informa. */
    nuevos: number | null;
    /** Casos que ya existían y esta carga tocó. null si la categoría no lo informa. */
    actualizados: number | null;

    /** Solo en EN_COLA: cuántas cargas en curso se confirmaron antes que esta, contando la que
     *  está corriendo. 0 = es la próxima. null si no aplica o no se pudo calcular. */
    enColaDelante: number | null;
    /** Solo en PROCESANDO: filas por segundo, promedio desde que arrancó, con un decimal.
     *  null si no aplica o todavía no hay con qué calcularla. */
    velocidad: number | null;
    /** Solo en PROCESANDO: segundos que faltan para terminar las FILAS a esa velocidad. No incluye
     *  el post-proceso. null si no aplica. */
    etaSegundos: number | null;

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
    okFilas: number;      // = ok
    errFilas: number;     // = err
    totalFilas: number;   // = terminal ? procesadas : totalEsperado
    durationMs: number | null; // = duracionMs
}
