// Formatos y etiquetas del detalle de la respuesta (docs/asistente-detalle-spec.md §12.3). Todo puro: sin React, sin tema.
import type { DetalleRespuesta, MotivoFin, NodoDetalle, PasoTiempo } from '../../types/asistente';

/** Un número entero con el separador de miles de la Argentina: `14880` → `14.880`. */
export const formatearEntero = (n: number): string => Math.round(n).toLocaleString('es-AR');

/**
 * Milisegundos a segundos: menos de 50 ms es «< 0,1 s»; después, un decimal con coma («6,1 s»); desde 100 s, sin decimales.
 * `null` o un valor que no es un número no se dibujan como un tiempo.
 */
export function formatearMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 50) return '< 0,1 s';
    const s = ms / 1000;
    if (s >= 99.95) return `${Math.round(s)} s`;
    return `${s.toFixed(1).replace('.', ',')} s`;
}

/**
 * Dólares: desde 0,01 con 3 decimales; desde 0,0001 con 4 (la ayuda cuesta USD 0,0028 por pregunta y con 3 todo diría 0,003);
 * por debajo, «< USD 0,0001». Sin costo (0, nulo o ausente) no hay nada que mostrar: texto vacío.
 */
export function formatearUsd(n: number | null | undefined): string {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
    if (n < 0.0001) return '< USD 0,0001';
    const decimales = n >= 0.01 ? 3 : 4;
    return `USD ${n.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
}

/** `us.anthropic.claude-sonnet-5-5` → «Sonnet 5.5». Si el id no tiene esa forma, el id tal cual. */
export function nombreModelo(modelo: string): string {
    const m = /claude-(haiku|sonnet|opus)-(\d+)-(\d+)/.exec(modelo ?? '');
    if (!m) return modelo;
    return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}

const TOPES: Record<string, string> = {
    tope_turno: 'tope de gasto de la respuesta',
    tope_mensual: 'tope de gasto del mes',
    tope_funcion: 'tope de gasto de la función',
};
const RECURSOS: Record<string, string> = { base: 'base', wiki: 'documentación', memoria: 'memoria' };

const tokensDe = (n: NodoDetalle): string => (typeof n.tokens === 'number' ? ` (${n.estimado ? '≈ ' : ''}${formatearEntero(n.tokens)} tokens)` : '');

/** La etiqueta de una fila del árbol (tabla de §12.3). Un tipo que no conoce se muestra tal cual. */
export function etiquetaNodo(n: NodoDetalle): string {
    switch (n.tipo) {
        case 'preparacion': return 'Preparación';
        case 'topes': return 'Topes y límite del día';
        case 'historial': return 'Conversación e historial';
        case 'contexto': return 'Armado del pedido';
        case 'llamada': {
            const base = `Llamada ${n.numero ?? ''}`.trim();
            const fin = n.fin ?? '';
            if (TOPES[fin]) return `${base}: no se hizo (${TOPES[fin]})`;
            // Sin cierre (una excepción la dejó abierta) llega `cortado`; Detener la cierra como abortada.
            if (fin === 'abortada') return `${base} · ${n.cortado ? 'quedó abierta' : 'detenida'}`;
            if (fin === 'timeout') return `${base} · no respondió a tiempo`;
            if (fin === 'error') return `${base} · falló${n.error ? ` (${n.error})` : ''}`;
            return base;
        }
        case 'espera': return n.incluyeRazonamiento ? 'Espera del primer token (incluye el razonamiento)' : 'Espera del primer token';
        case 'razonamiento': return `Razonamiento${tokensDe(n)}`;
        case 'respuesta': return `Respuesta${tokensDe(n)}`;
        case 'pedido': return `Pide «${n.nombre ?? 'otra'}»${tokensDe(n)}`;
        case 'herramienta': {
            const donde = n.recurso ? RECURSOS[n.recurso] : undefined;
            return `Herramienta ${n.nombre ?? ''}${donde ? ` (${donde})` : ''}`.replace(/\s+/g, ' ').trim();
        }
        case 'validacion': return 'Validación';
        case 'espera_base': return 'Espera de lugar en la base';
        case 'muestra': return 'Muestra (100 casos)';
        case 'conteo': return 'Conteo de casos';
        case 'guardar': return 'Guardar';
        // El nodo que resume lo recortado trae su propio texto («N pasos más sin mostrar»).
        case 'otros': return n.descripcion?.trim() ? n.descripcion : 'Otros (sin medir)';
        case 'sin_detalle': return 'Herramientas y otros (sin detalle)';
        default: return String(n.tipo);
    }
}

/** Una línea para la cabecera: cómo terminó la respuesta. `totalMs` solo hace falta para «La detuviste a los…». */
export function textoMotivo(estado: DetalleRespuesta['estado'], motivo: MotivoFin | string | null, totalMs?: number): string {
    if (motivo === null || motivo === undefined) {
        if (estado === 'cortado') return 'cortada';
        if (estado === 'rechazado') return 'rechazada';
        if (estado === 'error') return 'terminó con error';
        return 'terminó bien';
    }
    // El tope llegó con la respuesta ya completa: no es un corte, es la llamada siguiente que no se hizo.
    if (estado === 'ok' && (motivo === 'tope_turno' || motivo === 'tope_mensual' || motivo === 'tope_funcion')) {
        const cual = motivo === 'tope_turno' ? 'de la respuesta' : motivo === 'tope_mensual' ? 'del mes' : 'de la función';
        return `terminó bien; la última llamada no se hizo por el tope de gasto ${cual}`;
    }
    switch (motivo) {
        case 'tarjeta': return 'terminó bien: mostró la tarjeta';
        case 'respuesta_vacia': return 'terminó sin texto';
        case 'detenida': return typeof totalMs === 'number' ? `La detuviste a los ${formatearMs(totalMs)}` : 'La detuviste';
        case 'tope_turno': return 'Cortada por el tope de gasto de la respuesta';
        case 'max_tokens': return 'Cortada: la respuesta llegó al largo máximo';
        case 'iteraciones': return 'Cortada: llegó al máximo de pasos';
        case 'otro_corte': return 'Cortada por el modelo';
        case 'rechazo': return 'El modelo no quiso responder';
        case 'tope_mensual': return 'Se llegó al tope de gasto del mes';
        case 'tope_funcion': return 'Se llegó al tope de gasto de la función';
        case 'modelo_no_disponible': return 'El modelo no estaba disponible';
        case 'timeout': return 'El modelo no respondió a tiempo';
        case 'prompt_demasiado_grande': return 'El pedido era demasiado grande para el modelo';
        case 'interno': return 'Falló algo interno';
        case 'sin_terminar': return 'La respuesta no llegó a terminar';
        default: return String(motivo);
    }
}

/** Cuánto se solapan dos intervalos, en ms (0 si no se tocan o solo se rozan). */
const solape = (a: NodoDetalle, b: NodoDetalle): number => Math.min(a.desdeMs + a.ms, b.desdeMs + b.ms) - Math.max(a.desdeMs, b.desdeMs);

/** Dos hermanos corren «en paralelo» si sus intervalos se solapan más de 0 ms. */
export const seSolapan = (a: NodoDetalle, b: NodoDetalle): boolean => solape(a, b) > 0;

/** Para cada hermano, si se solapa con alguno de los otros. */
export function enParalelo(hermanos: NodoDetalle[]): boolean[] {
    return hermanos.map((n, i) => hermanos.some((o, j) => i !== j && seSolapan(n, o)));
}

/** La barra de la cascada, en porcentaje de la pista: `desdeMs / totalMs` y `ms / totalMs`, siempre dentro de la pista. */
export function anchoBarra(n: Pick<NodoDetalle, 'desdeMs' | 'ms'>, totalMs: number): { izquierda: number; ancho: number } {
    if (!Number.isFinite(totalMs) || totalMs <= 0) return { izquierda: 0, ancho: 0 };
    const izquierda = Math.min(100, Math.max(0, ((n.desdeMs || 0) / totalMs) * 100));
    const ancho = Math.min(100 - izquierda, Math.max(0, ((n.ms || 0) / totalMs) * 100));
    return { izquierda, ancho };
}

/** El color de la barra de un nodo, como clave de `theme.palette` (nunca un color propio). */
export function colorDeBarra(tipo: string): 'primary.main' | 'secondary.main' | 'info.main' | 'text.disabled' {
    switch (tipo) {
        case 'llamada': case 'espera': case 'respuesta': case 'pedido': return 'primary.main';
        case 'razonamiento': return 'secondary.main';
        case 'herramienta': case 'validacion': case 'espera_base': case 'muestra': case 'conteo': return 'info.main';
        default: return 'text.disabled';
    }
}

/** El tiempo dicho para un lector de pantalla: «6,1 segundos». */
export function tiempoParaLector(ms: number): string {
    return ms < 50 ? 'menos de 0,1 segundos' : formatearMs(ms).replace(/ s$/, ' segundos');
}

/** «En tu navegador: primer texto a los 18,5 s · completa a los 18,6 s». `null` si el navegador no midió. */
export function lineaNavegador(nav: DetalleRespuesta['navegador']): string | null {
    if (!nav) return null;
    const partes: string[] = [];
    if (typeof nav.primerTextoMs === 'number') partes.push(`primer texto a los ${formatearMs(nav.primerTextoMs)}`);
    else if (typeof nav.primeraSenalMs === 'number') partes.push(`primera señal a los ${formatearMs(nav.primeraSenalMs)}`);
    partes.push(`completa a los ${formatearMs(nav.totalMs)}`);
    return `En tu navegador: ${partes.join(' · ')}`;
}

/** La etiqueta de una fila de la tabla «Tiempos por paso» de Consumo (docs/asistente-detalle-spec.md §12.4). */
export function etiquetaPaso(paso: PasoTiempo | string, herramienta: string | null): string {
    switch (paso) {
        case 'total': return 'Total en el servidor';
        case 'navegador_total': return 'Total en el navegador (de todos)';
        case 'navegador_primer_texto': return 'Primer texto en el navegador (de todos)';
        case 'preparacion': return 'Preparación';
        case 'llamada': return 'Llamada';
        case 'espera': return 'Espera del primer token';
        case 'razonamiento': return 'Razonamiento';
        case 'respuesta': return 'Respuesta';
        case 'pedido': return 'Pedido de herramienta';
        case 'herramienta': return herramienta ? `Herramienta ${herramienta}` : 'Herramienta';
        case 'guardar': return 'Guardar';
        default: return String(paso);
    }
}
