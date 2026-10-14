// Contrato de la reversión de una acción masiva (docs/imports-progreso-c3-spec.md §17.4).
// Es copia textual de backend/src/modules/imports/reversion/reversion-accion.types.ts: no tocar un lado sin el otro.
export type EstadoReversion = 'EN_COLA' | 'REVIRTIENDO' | 'TERMINADA' | 'FALLIDA' | 'INTERRUMPIDA';

/** Lo que viaja en el historial (`ImportHistoryItem.reversion`) y en los dos eventos de socket. */
export interface ReversionResumenDto {
    remesaId: number;
    empresaId: number;
    estado: EstadoReversion;
    total: number;              // snapshots a revertir (ya revertidos + pendientes al arrancar el intento)
    hechos: number;
    porcentaje: number;         // floor(hechos*100/total); 100 con total 0 y TERMINADA
    deudoresRevertidos: number; // cambios de caso deshechos (como hoy: un caso con dos cambios cuenta dos)
    contactosRestaurados: number;
    comentariosBorrados: number;
    casosQueNoExistian: number; // cambios sobre casos que ya no existen: no se pudo restaurar nada
    contactosSinCaso: number;   // contactos que no se restauraron porque su caso ya no existe
    usuarioId: number | null;
    error: string | null;       // FALLIDA o INTERRUMPIDA: el motivo, legible
    encoladaAt: string;
    startedAt: string | null;
    finishedAt: string | null;
}

export type CodigoNoRevertible =
    | 'YA_REVERTIDA'            // ya hay una reversión TERMINADA (o accionRevertidaEn)
    | 'REVERSION_EN_CURSO'      // hay una EN_COLA o REVIRTIENDO
    | 'REVERTIR_CARGA_EN_CURSO' // la acción masiva todavía corre (o está en cola)
    | 'REVERTIR_NO_TERMINO'     // anterior a C3b y no FINALIZADA (C3a)
    | 'REVERTIR_INCOMPLETO'     // anterior a C3b y con errorPostProceso (C3a)
    | 'REVERTIR_NADA';          // no quedó ningún cambio pendiente de revertir

export interface CoberturaReversion {
    exacta: boolean;            // true: los snapshots cubren todo lo que la carga aplicó
    casos: number;              // casos distintos con algo pendiente de revertir
    cambiosDeCaso: number;      // snapshots pendientes por tipo
    contactos: number;
    comentarios: number;
    yaRevertidos: number;       // snapshots ya revertidos por un intento anterior (retomar)
    casosAfectadosInformados: number | null; // resumen.categoria.deudoresAfectados de C3a, si lo hay
    cargaCortada: boolean;      // la acción masiva terminó FALLIDA (cancelada, fallida o cerrada por el reaper)
    filasProcesadas: number | null;          // import_progreso.procesadas
    totalFilas: number | null;               // import_progreso.totalEsperado
}

export interface ReversionAccionDto {
    remesaId: number;
    revertible: boolean;
    motivo: { code: CodigoNoRevertible; texto: string } | null; // null ⟺ revertible
    cobertura: CoberturaReversion;
    reversion: ReversionResumenDto | null;                      // null: nunca se pidió
    accionRevertidaEn: string | null;
}
