// reversion/reversion-accion.reglas.ts
//
// Reglas puras de la reversión de una acción masiva (docs/imports-progreso-c3-spec.md §17.5.5 y §17.8): las usan el GET,
// el POST y el job, así que viven aparte del servicio y no tocan la base.
import type { CodigoNoRevertible, EstadoReversion, ReversionResumenDto } from './reversion-accion.types';

export const COLA_REVERSION = 'acciones-revertir-queue';

/** Textos que ve el operador (§17.8). Los dos primeros son los de C3a, sin cambios. */
export const TEXTO_NO_TERMINO =
    'Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar.';
export const TEXTO_INCOMPLETO =
    'Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte.';
export const TEXTO_EN_CURSO = 'Esta acción ya se está revirtiendo. Mirá el avance en el Historial.';
export const TEXTO_EN_SEGUNDO_PLANO =
    'La reversión sigue en segundo plano. Actualizá el Historial en unos minutos para ver cómo terminó.';
export const TEXTO_CARGA_EN_CURSO =
    'La acción masiva todavía está corriendo. Cancelala, o esperá a que termine, y después revertila.';
export const TEXTO_NADA = 'Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir.';
export const TEXTO_YA_REVERTIDA = 'Esta acción masiva ya se revirtió.';
export const TEXTO_NO_ENCOLADA =
    'No se pudo poner la reversión en la cola. Probá de nuevo en unos minutos; si se repite, avisá a soporte.';

export const textoReversionFallida = (error: string | null): string => {
    // El error de una interrumpida ya termina en punto y dice cómo seguir: ni doble punto ni la frase dos veces.
    const detalle = (error ?? 'sin detalle').trim().replace(/\.+$/, '');
    return /Revertir de nuevo/.test(detalle)
        ? `La reversión falló: ${detalle}.`
        : `La reversión falló: ${detalle}. Revertir de nuevo sigue desde donde quedó.`;
};

export const TEXTOS_NO_REVERTIBLE: Record<CodigoNoRevertible, string> = {
    YA_REVERTIDA: TEXTO_YA_REVERTIDA,
    REVERSION_EN_CURSO: TEXTO_EN_CURSO,
    REVERTIR_CARGA_EN_CURSO: TEXTO_CARGA_EN_CURSO,
    REVERTIR_NO_TERMINO: TEXTO_NO_TERMINO,
    REVERTIR_INCOMPLETO: TEXTO_INCOMPLETO,
    REVERTIR_NADA: TEXTO_NADA,
};

/** Estados de la carga que cuentan como "todavía corre" aunque la fila de progreso no lo diga. */
const ESTADOS_DE_CARGA_EN_CURSO = ['PENDIENTE', 'VALIDANDO', 'PROCESANDO'];

export interface EntradaEvaluarReversion {
    remesa: { accionRevertidaEn: Date | null; accionSnapshotsPorCaso: boolean; estadoProceso: string };
    /** null = remesa heredada, sin fila de progreso. */
    progreso: { encoladaAt: Date | null; finishedAt: Date | null; errorPostProceso: string | null; procesadas?: number | null } | null;
    /** null = nunca se pidió. */
    reversion: { estado: string } | null;
    /** Snapshots con `revertidoEn` nulo. */
    pendientes: number;
    /** Snapshots con `revertidoEn` no nulo (un intento anterior). */
    yaRevertidos: number;
}

/** El primer motivo por el que NO se puede revertir ahora, o `null` si se puede. */
export function evaluarReversion(e: EntradaEvaluarReversion): CodigoNoRevertible | null {
    const { remesa, progreso, reversion } = e;
    if (reversion?.estado === 'TERMINADA' || remesa.accionRevertidaEn) return 'YA_REVERTIDA';
    if (reversion?.estado === 'EN_COLA' || reversion?.estado === 'REVIRTIENDO') return 'REVERSION_EN_CURSO';

    const cargaEnCurso =
        progreso != null &&
        progreso.encoladaAt != null &&
        (progreso.finishedAt == null || ESTADOS_DE_CARGA_EN_CURSO.includes(remesa.estadoProceso));
    if (cargaEnCurso) return 'REVERTIR_CARGA_EN_CURSO';

    // Una cancelada (o cortada) antes de procesar ninguna fila no cambió nada: tampoco marcó `accionSnapshotsPorCaso`, que se
    // escribe antes del primer caso. No es una "anterior a C3b a medias" (auditoría de C3b). Con filas procesadas y sin la
    // marca sí lo es: cambió casos y sus snapshots no se guardaron.
    if (progreso?.procesadas === 0 && e.pendientes === 0 && e.yaRevertidos === 0) return 'REVERTIR_NADA';

    if (!remesa.accionSnapshotsPorCaso) {
        // Anterior a C3b: sus snapshots se guardaban al final de la carga, así que solo sirven si terminó entera (D5).
        if (remesa.estadoProceso !== 'FINALIZADA') return 'REVERTIR_NO_TERMINO';
        if (progreso?.errorPostProceso != null) return 'REVERTIR_INCOMPLETO';
    }

    // Todo hecho pero sin la marca final (murió entre la última tanda y el cierre): es revertible, el job solo cierra.
    if (e.pendientes === 0 && e.yaRevertidos === 0) return 'REVERTIR_NADA';
    return null;
}

export function porcentajeReversion(estado: EstadoReversion, hechos: number, total: number): number {
    if (total <= 0) return estado === 'TERMINADA' ? 100 : 0;
    return Math.min(100, Math.floor((hechos * 100) / total));
}

/** Una fila de `reversion_accion` (o lo que de ella se necesita) y el `empresaId` de su remesa. */
export interface FilaReversion {
    remesaId: number;
    estado: string;
    usuarioId: number | null;
    total: number;
    hechos: number;
    deudoresRevertidos: number;
    contactosRestaurados: number;
    comentariosBorrados: number;
    casosQueNoExistian: number;
    contactosSinCaso: number;
    error: string | null;
    encoladaAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
}

export function aReversionResumenDto(f: FilaReversion, empresaId: number): ReversionResumenDto {
    const estado = f.estado as EstadoReversion;
    return {
        remesaId: f.remesaId,
        empresaId,
        estado,
        total: f.total,
        hechos: f.hechos,
        porcentaje: porcentajeReversion(estado, f.hechos, f.total),
        deudoresRevertidos: f.deudoresRevertidos,
        contactosRestaurados: f.contactosRestaurados,
        comentariosBorrados: f.comentariosBorrados,
        casosQueNoExistian: f.casosQueNoExistian,
        contactosSinCaso: f.contactosSinCaso,
        usuarioId: f.usuarioId,
        error: f.error,
        encoladaAt: f.encoladaAt.toISOString(),
        startedAt: f.startedAt ? f.startedAt.toISOString() : null,
        finishedAt: f.finishedAt ? f.finishedAt.toISOString() : null,
    };
}

/** Motivo legible de una falla del job: el mensaje, acotado, sin el stack. */
export function motivoLegibleDeFalla(e: unknown): string {
    const mensaje = e instanceof Error ? e.message : String(e ?? '');
    const limpio = mensaje.replace(/\s+/g, ' ').trim();
    if (!limpio) return 'Error desconocido';
    return limpio.length > 300 ? `${limpio.slice(0, 297)}...` : limpio;
}
