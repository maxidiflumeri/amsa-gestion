// Funciones puras del progreso de las importaciones. Las comparten el hook useEstadoCarga, los
// contextos y los componentes (wizard, detalle, campanita). Textos: docs/imports-progreso-realtime-spec.md §8.8.8.
import type { EstadoCargaDto } from '../types/importProgreso';

/** Cada cuánto consulta el hook de una carga cuando el socket está caído. */
export const POLL_MS = 10_000;
/** Cada cuánto consulta la campanita cuando el socket está caído. */
export const POLL_LISTA_MS = 15_000;
/** Un socket conectado pero sin novedades por este tiempo se considera sospechoso: se consulta por HTTP. */
export const SILENCIO_MS = 30_000;
/** Cuánto tiene que durar la desconexión para mostrar el ícono de la barra superior (evita el parpadeo). */
export const GRACIA_INDICADOR_MS = 5_000;
/** Minutos sin novedades del servidor a partir de los cuales la pantalla avisa. */
export const SIN_NOVEDADES_MIN = 5;

/** Todo lo que entra por socket pasa por acá antes de usarse: un payload con la forma vieja se ignora. */
export function esEstadoCarga(valor: unknown): valor is EstadoCargaDto {
    if (typeof valor !== 'object' || valor === null) return false;
    const v = valor as Record<string, unknown>;
    return (
        typeof v.remesaId === 'number' &&
        typeof v.rev === 'number' &&
        typeof v.terminal === 'boolean' &&
        typeof v.enCurso === 'boolean'
    );
}

/**
 * Devuelve `nuevo` si no había nada o si no es más viejo que `actual`; si no, `actual`.
 * Impide que una respuesta HTTP vieja pise un evento de socket más nuevo.
 */
export function fusionarEstadoCarga(
    actual: EstadoCargaDto | null,
    nuevo: EstadoCargaDto,
): EstadoCargaDto {
    if (actual === null || nuevo.rev >= actual.rev) return nuevo;
    return actual;
}

export interface EtiquetaFase {
    principal: string;
    secundario: string | null;
}

/**
 * Texto de la fase. `contexto` solo cambia el BORRADOR: en el paso "Importando" del wizard es
 * "Enviando a la cola…" (todavía no hay estado o recién se confirmó); en el detalle es un borrador sin confirmar.
 */
export function etiquetaFase(
    estado: Pick<EstadoCargaDto, 'fase'> | null,
    contexto: 'wizard' | 'detalle' = 'detalle',
): EtiquetaFase {
    if (estado === null) return { principal: 'Enviando a la cola…', secundario: null };
    switch (estado.fase) {
        case 'BORRADOR':
            return contexto === 'wizard'
                ? { principal: 'Enviando a la cola…', secundario: null }
                : { principal: 'Borrador', secundario: 'Vista previa sin confirmar. No se cargó nada.' };
        case 'EN_COLA':
            return { principal: 'En cola', secundario: 'Esperando que termine otra importación.' };
        case 'PROCESANDO':
            return { principal: 'Procesando', secundario: null };
        case 'POST_PROCESO':
            return {
                principal: 'Post-proceso',
                secundario: 'Consolidando y cerrando la carga. Puede tardar varios minutos.',
            };
        default:
            return { principal: estado.fase, secundario: null };
    }
}

export type SeveridadResultado = 'success' | 'warning' | 'error' | 'info';

export interface ResultadoPresentado {
    severidad: SeveridadResultado;
    titulo: string;
    detalle: string | null;
}

function sinPuntoFinal(texto: string): string {
    return texto.trim().replace(/[.\s]+$/, '');
}

/**
 * Qué quedó sin hacer cuando el post-proceso (`afterAll` del processor de la categoría) no terminó, y qué
 * hacer. Verificado contra `backend/src/modules/imports/processors/*.processor.ts`. Donde no se puede
 * afirmar un remedio con certeza, el texto dice qué quedó pendiente y manda a soporte.
 */
export function pendientePostProceso(tipo: string): string {
    switch (tipo) {
        case 'PAGOS':
            return 'Quedó sin hacer el recálculo de saldo y situación de los casos que recibieron pagos, y el cierre de las promesas cumplidas. Consolidá desde el Historial cada remesa de deudores que elegiste como origen al importar (no la de pagos: no tiene casos propios); si no te acordás cuáles fueron, o el detalle trae el aviso CASO_FUERA_DE_REMESA_ORIGEN, avisá a soporte. Las promesas las resuelve soporte.';
        case 'ACTUALIZACIONES':
            return 'Quedó sin hacer, o a medias, el cierre de los ausentes del archivo (según la plantilla: darlos por pagados, desasignarlos o nada), la consolidación de los casos y el cierre de las promesas cumplidas. Avisá a soporte.';
        case 'FACTURAS':
            return 'Quedó sin hacer el cálculo del importe de los casos desde sus facturas (salvo que la plantilla diga «No calcular»), la unión de los datos adicionales del archivo y la consolidación. Los casos que vinieron sin importe pueden haber quedado sin él. Avisá a soporte.';
        case 'DEUDORES_Y_FACTURAS':
            return 'Quedó sin hacer el cálculo del importe de los casos desde sus facturas (salvo que la plantilla diga «No calcular») y la consolidación. Los casos que vinieron sin importe pueden haber quedado sin él. Avisá a soporte.';
        case 'MULTIRREGISTRO':
            return 'Quedó sin hacer la consolidación de los casos tocados y el cierre de las promesas cumplidas. Avisá a soporte.';
        case 'MULTIARCHIVO':
            return 'Quedó sin hacer el cierre de los ausentes (desasignarlos, solo si la plantilla tiene activada la desasignación), la consolidación de los casos tocados y el cierre de las promesas cumplidas. Avisá a soporte.';
        case 'ACCIONES':
            return 'Quedaron sin guardar los datos que permiten revertir la acción. Avisá a soporte y no uses Revertir: puede deshacer solo una parte y se puede una sola vez.';
        case 'MULTICLAVES':
            return 'Pudo quedar sin hacer la re-consolidación de los casos que ya tenían pagos con estas claves. Avisá a soporte.';
        case 'DEUDORES':
        case 'CONTACTOS':
        case 'ENRIQUECIMIENTO':
            return 'En esta categoría el cierre solo limpia datos internos: lo que se cargó quedó completo. Avisá a soporte con el motivo.';
        default:
            return 'Quedó pendiente el cierre de la carga. Avisá a soporte con el motivo.';
    }
}

/** Título, severidad y detalle del resultado de una carga terminada (§8.8.8). */
export function presentarResultado(
    estado: Pick<
        EstadoCargaDto,
        'resultado' | 'ok' | 'err' | 'procesadas' | 'descartadas' | 'error' | 'errorPostProceso' | 'tipo'
    >,
): ResultadoPresentado {
    switch (estado.resultado) {
        case 'OK':
            return { severidad: 'success', titulo: 'Importación exitosa', detalle: null };
        case 'CON_ERRORES':
            if (estado.ok > 0) {
                return {
                    severidad: 'warning',
                    titulo: 'Importación finalizada con filas con error',
                    detalle: `${estado.err} de ${estado.procesadas} filas no se cargaron. Mirá el motivo de cada una en el detalle.`,
                };
            }
            return {
                severidad: 'error',
                titulo: 'No se cargó ninguna fila',
                detalle: `Las ${estado.err} filas dieron error.`,
            };
        case 'SIN_FILAS':
            return {
                severidad: 'warning',
                titulo: 'El archivo no tenía filas para procesar',
                detalle:
                    estado.descartadas > 0
                        ? `El filtro de la plantilla descartó las ${estado.descartadas} filas.`
                        : null,
            };
        case 'CON_ADVERTENCIAS': {
            const motivo = estado.errorPostProceso ? `: ${sinPuntoFinal(estado.errorPostProceso)}` : '';
            const filas =
                estado.err > 0
                    ? `Se cargaron ${estado.ok} filas y ${estado.err} dieron error.`
                    : `Se cargaron ${estado.ok} filas.`;
            return {
                severidad: 'warning',
                titulo: 'Importación finalizada con advertencias',
                detalle: `${filas} Pero el post-proceso no terminó${motivo}. ${pendientePostProceso(estado.tipo)} No hace falta volver a subir el archivo.`,
            };
        }
        case 'FALLIDA': {
            const motivo = estado.error ? sinPuntoFinal(estado.error) : 'No se informó el motivo';
            const cargadas =
                estado.ok > 0
                    ? ` Antes del corte se cargaron ${estado.ok} filas${estado.err > 0 ? ` y ${estado.err} dieron error` : ''}; el cierre de la carga no corrió.`
                    : '';
            return {
                severidad: 'error',
                titulo: 'La importación falló',
                detalle: `${motivo}.${cargadas}`,
            };
        }
        default:
            return { severidad: 'info', titulo: 'Importación finalizada', detalle: null };
    }
}

/** Orden de gravedad para elegir el encabezado del resumen: menor número = peor. */
function rangoGravedad(estado: Pick<EstadoCargaDto, 'resultado' | 'ok'>): number {
    switch (estado.resultado) {
        case 'FALLIDA':
            return 0;
        case 'CON_ADVERTENCIAS':
            return 1;
        case 'CON_ERRORES':
            return estado.ok === 0 ? 2 : 4;
        case 'SIN_FILAS':
            return 3;
        case 'OK':
            return 5;
        default:
            return 6;
    }
}

/** La remesa de peor resultado de la lista (la primera en caso de empate). Null si la lista está vacía. */
export function peorResultado(estados: EstadoCargaDto[]): EstadoCargaDto | null {
    let peor: EstadoCargaDto | null = null;
    for (const e of estados) {
        if (peor === null || rangoGravedad(e) < rangoGravedad(peor)) peor = e;
    }
    return peor;
}

/**
 * La barra no puede mostrar un porcentaje honesto: en cola, en post-proceso, procesando sin total
 * conocido, o una fase que el cliente no conoce.
 */
export function barraIndeterminada(
    estado: Pick<EstadoCargaDto, 'fase' | 'terminal' | 'totalEsperado'> | null,
): boolean {
    if (estado === null) return true;
    if (estado.terminal) return false;
    if (estado.fase === 'PROCESANDO') return estado.totalEsperado <= 0;
    return true;
}

/**
 * Minutos (enteros) sin novedades de una carga PROCESANDO. La edad del último latido se mide con la hora
 * del servidor (`servidorAhora − (heartbeatAt ?? startedAt)`, en el momento de recibir el DTO) más lo
 * transcurrido en el cliente desde que se recibió: no depende de que el reloj de la PC coincida con el del
 * servidor y avisa enseguida al abrir una carga ya colgada. Si el DTO no trae `servidorAhora`, se cae a
 * medir desde que este navegador vio por última vez una novedad (`vistoEn`). Solo aplica a PROCESANDO: en
 * cola es esperar, y en post-proceso el texto de la fase ya avisa que tarda. Null si no aplica.
 */
export function minutosSinNovedades(
    estado: Pick<EstadoCargaDto, 'fase' | 'enCurso' | 'heartbeatAt' | 'startedAt'> & { servidorAhora?: string },
    recibidoEn: number,
    vistoEn: number,
    ahora: number,
): number | null {
    if (!estado.enCurso || estado.fase !== 'PROCESANDO') return null;
    const referencia = estado.heartbeatAt ?? estado.startedAt;
    const servidor = estado.servidorAhora ? Date.parse(estado.servidorAhora) : NaN;
    const latido = referencia ? Date.parse(referencia) : NaN;
    let edadMs: number;
    if (!Number.isNaN(servidor) && !Number.isNaN(latido)) {
        edadMs = servidor - latido + Math.max(0, ahora - recibidoEn);
    } else {
        edadMs = Math.max(0, ahora - vistoEn);
    }
    return Math.max(0, Math.floor(edadMs / 60_000));
}

/** Resultados que se muestran como advertencia en una notificación (ícono y toast). */
export function resultadoEsAdvertencia(resultado: unknown): boolean {
    return resultado === 'CON_ADVERTENCIAS' || resultado === 'CON_ERRORES' || resultado === 'SIN_FILAS';
}

/** Filas de `importerror` que son avisos de la carga y no errores de una fila (rowNumber 0 ≠ aviso: la primera fila de datos también es 0). */
export function esAvisoDeCarga(errorMsg: unknown): boolean {
    return typeof errorMsg === 'string' && /^\[(aviso|parseo|post-proceso)\]/.test(errorMsg);
}
