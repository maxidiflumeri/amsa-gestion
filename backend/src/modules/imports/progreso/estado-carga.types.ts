// Contrato del estado de una carga (docs/imports-progreso-realtime-spec.md §8.4.1 y §9.4.1).
// Se copia TAL CUAL en frontend/src/types/importProgreso.ts: no cambiar un nombre acá sin cambiarlo allá.

/** La Fase B agrega LEYENDO. El cliente sigue tratando cualquier otro string como
 *  "en curso, fase que no conozco" y muestra el texto tal cual. */
export type FaseCarga = 'BORRADOR' | 'EN_COLA' | 'LEYENDO' | 'PROCESANDO' | 'POST_PROCESO' | 'TERMINADA';

export type ResultadoCarga = 'OK' | 'CON_ERRORES' | 'CON_ADVERTENCIAS' | 'SIN_FILAS' | 'FALLIDA';

export type EstadoProcesoRemesa = 'PENDIENTE' | 'VALIDANDO' | 'PROCESANDO' | 'FINALIZADA' | 'FALLIDA';

/**
 * `import_progreso.resumen` (Json). Sobre versionado: C3 lo extiende con el resumen por categoría.
 * Todas las claves son opcionales para quien lee: una carga anterior a C1 trae null.
 */
export interface ResumenCarga {
    v?: number;
    /** Remesas de origen con las que se confirmó la carga (lo que viajaba solo en el job y en la auditoría). */
    origen?: { remesaOrigenId: number | null; remesaOrigenIds: number[] | null };
    /** La carga falló o se canceló sin haberle entregado ninguna fila a un processor. */
    sinFilasEntregadas?: true;
    /** Quién pidió la cancelación. */
    cancelacion?: { usuarioId: number; nombre: string };
    /** Veces que se retomó. Informativo. */
    retomas?: number;
}

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
    /** Filas del archivo que no entraron en esta remesa y no son error: el TOTAL (filtro de la
     *  plantilla + otros cortes de la división). */
    descartadas: number;
    /** De las `descartadas`, las que eran de otro corte de la división. null = la remesa no tiene
     *  corte propio, o la carga es anterior a la Fase B. */
    fueraDeCorte: number | null;
    /** `descartadas − (fueraDeCorte ?? 0)`: las que descartó el filtro de la plantilla. Es el número
     *  que se muestra como "Descartadas". Lo calcula el backend. */
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

    /** Carga dividida confirmada como grupo: id, posición (1..N) y cantidad. null si no lo es. */
    grupoId: string | null;
    grupoOrden: number | null;
    grupoTotal: number | null;

    /** Alguien pidió cancelar (ISO 8601). No se borra al terminar. null si nadie lo pidió. */
    cancelacionPedidaAt: string | null;
    /** Terminó por una cancelación. Con `true`, `resultado` viaja como 'FALLIDA' y `error` trae el
     *  texto de la cancelación: una pestaña que no conoce este campo la muestra como fallida con ese
     *  motivo, que es cierto. */
    cancelada: boolean;
    /** Nombre de quien pidió la cancelación, si se sabe. */
    canceladaPor: string | null;
    /** Se puede pedir la cancelación ahora. Lo calcula el backend (§10.4.1). */
    cancelable: boolean;
    /** Terminó sin haber cargado ninguna fila y se puede volver a encolar tal cual. Lo calcula el
     *  backend (§10.4.1); el endpoint lo vuelve a comprobar. */
    retomable: boolean;

    /** @deprecated Alias para las pestañas que quedaron abiertas con el frontend anterior.
     *  El código nuevo NO los lee. Se quitan en la Fase C. */
    okFilas: number; // = ok
    errFilas: number; // = err
    totalFilas: number; // = terminal ? procesadas : totalEsperado
    durationMs: number | null; // = duracionMs
}
