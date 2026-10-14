// Contrato del progreso de las importaciones (docs/imports-progreso-realtime-spec.md §8.4.1, §9.4.1 y §10.4.2).
// Es copia textual de backend/src/modules/imports/progreso/estado-carga.types.ts: no tocar un lado sin el otro.

/** La Fase B agrega LEYENDO. El cliente sigue tratando cualquier otro string como
 *  "en curso, fase que no conozco". */
export type FaseCarga = 'BORRADOR' | 'EN_COLA' | 'LEYENDO' | 'PROCESANDO' | 'POST_PROCESO' | 'TERMINADA';

export type ResultadoCarga = 'OK' | 'CON_ERRORES' | 'CON_ADVERTENCIAS' | 'SIN_FILAS' | 'FALLIDA';

export type EstadoProcesoRemesa = 'PENDIENTE' | 'VALIDANDO' | 'PROCESANDO' | 'FINALIZADA' | 'FALLIDA';

/** Lo que hizo una carga, por categoría. El processor lo informa entero en cada llamada; el último reemplaza al anterior. */
export type ResumenCategoria =
    | { tipo: 'DEUDORES'; casosNuevos: number; contactosCopiados: number }
    | { tipo: 'DEUDORES_Y_FACTURAS'; casosNuevos: number; casosConFacturas: number; contactosCopiados: number }
    | { tipo: 'FACTURAS'; casosConFacturas: number; clientesInexistentes: number }
    | { tipo: 'CONTACTOS' | 'ENRIQUECIMIENTO'; contactosCargados: number; filasSinContactoValido: number }
    | {
          tipo: 'PAGOS';
          casosConPagos: number; yaCargados: number; negativos: number; facturasMarcadas: number;
          /** Solo si la plantilla trae clave de pago (convenio / referencia). */
          claves: { cargada: number; noCargada: number; otraEmpresa: number; ilegible: number; tramitesEnVariosCasos: number; casosFueraDeRemesaOrigen: number } | null;
      }
    | {
          tipo: 'ACTUALIZACIONES';
          coincidencias: number; casosNuevos: number; reasignados: number; contactosCopiados: number;
          ausentes: {
              accion: 'PAGO_TODO' | 'DESASIGNAR' | 'IGNORAR';
              /** NO_LLEGO = el cierre no corrió (cancelada, fallida, o todavía en filas). */
              resultado: 'APLICADO' | 'OMITIDO_SOLO_DATOS' | 'ABORTADO_SIN_COINCIDENCIAS' | 'SIN_REMESA_ORIGEN' | 'NO_LLEGO';
              pagosGenerados: number; desasignados: number; salteadosSinMonto: number;
          };
      }
    | { tipo: 'ACCIONES'; deudoresAfectados: number; comentariosCreados: number; contactosEliminados: number; saltadosCancelados: number; filasSinMatch: number }
    | {
          tipo: 'MULTIRREGISTRO' | 'MULTIARCHIVO';
          altas: number; actualizados: number; reasignados: number; desasignados: number; contactosCopiados: number;
          bajas: number; bajasPago: number; bajasRetiradas: number; bajasYaAplicadas: number; bajasSinMatch: number; bajasAmbiguas: number;
          casosDadosDeBaja: number;
      }
    | { tipo: 'MULTICLAVES'; yaCargadas: number; tramites: number | null; conCaso: number | null; sinCaso: number | null; casosReconsolidados: number | null };

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
    /** Números de las remesas donde ya figura el corte de esta (confirmadas después de que esta se creó). Con algún
     *  valor, `retomable` es false. Lo calculan solo las lecturas HTTP; en los eventos de socket y en cualquier otro
     *  caso es null (y un backend anterior a la entrega 2a no lo manda: se lee con `== null`). */
    corteRepetidoEn: string[] | null;

    /** Lo que hizo la carga, por categoría (C3a). null mientras corre, en una carga anterior a C3a, y en una que cerró
     *  el reaper (interrumpida). Sale de `import_progreso.resumen.categoria`. */
    resumenCategoria: ResumenCategoria | null;

    /** @deprecated Alias para las pestañas que quedaron abiertas con el frontend anterior.
     *  El código nuevo NO los lee. Se quitan en la Fase C. */
    okFilas: number;      // = ok
    errFilas: number;     // = err
    totalFilas: number;   // = terminal ? procesadas : totalEsperado
    durationMs: number | null; // = duracionMs
}
