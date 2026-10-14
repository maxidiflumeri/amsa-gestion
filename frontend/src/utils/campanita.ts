// Lógica pura de la campanita y del chip de la barra superior (C2b, §16.8). Sin React, sin red.
import type { NotificacionDto } from '../api/notificaciones';
import type { EstadoCargaDto } from '../types/importProgreso';
import { barraIndeterminada, cancelacionPedidaAt, formatearNumero } from './estadoCarga';

const TIPOS_DE_IMPORTACION_TERMINADA = ['IMPORTACION_FINALIZADA', 'IMPORTACION_ERROR'];
const RUTA_DE_REMESA = /^\/historial-importaciones\/(\d+)\/?$/;

/**
 * Lo que dice el chip de la barra superior. null = sin cargas (no se dibuja).
 * Una sola carga: "Cancelando importación" si ya se pidió cortarla, "Importación en cola" si no arrancó,
 * "Importando 43 %" si se sabe el avance, "Importando…" si no. Dos o más: "3 importaciones".
 */
export function textoChipImportaciones(cargas: EstadoCargaDto[]): string | null {
    if (cargas.length === 0) return null;
    if (cargas.length > 1) return `${formatearNumero(cargas.length)} importaciones`;
    const c = cargas[0];
    if (cancelacionPedidaAt(c) !== null) return 'Cancelando importación';
    if (c.fase === 'EN_COLA') return 'Importación en cola';
    if (c.fase === 'PROCESANDO' && !barraIndeterminada(c) && Number.isFinite(c.progreso)) return `Importando ${c.progreso} %`;
    return 'Importando…';
}

/**
 * Remesa de una notificación de importación terminada: `entidadId` si `entidadTipo` es REMESA; si no, el número de
 * `rutaAccion` (`/historial-importaciones/{id}`). null para cualquier otro tipo de notificación o una ruta que no es esa.
 */
export function remesaDeNotificacion(n: NotificacionDto): number | null {
    if (!TIPOS_DE_IMPORTACION_TERMINADA.includes(n.tipo)) return null;
    if (n.entidadTipo === 'REMESA' && typeof n.entidadId === 'number' && Number.isInteger(n.entidadId) && n.entidadId > 0) return n.entidadId;
    const m = typeof n.rutaAccion === 'string' ? RUTA_DE_REMESA.exec(n.rutaAccion) : null;
    return m ? Number(m[1]) : null;
}

const numero = (valor: unknown): number | null => (typeof valor === 'number' && Number.isFinite(valor) ? valor : null);

/**
 * Lo que se OFRECE en una notificación. Se decide con el `payload`, que es una foto vieja: lo que se HACE se decide
 * al consultar el estado real (AccionesNotificacion). Un campo que falta o no es número cuenta como "no ofrecer".
 */
export function accionesDeNotificacion(
    n: NotificacionDto,
    tienePermiso: (permiso: string) => boolean,
): { descargar: boolean; retomar: boolean } {
    const ninguna = { descargar: false, retomar: false };
    if (remesaDeNotificacion(n) === null || !tienePermiso('importacion.ver_historial')) return ninguna;
    const payload = n.payload;
    if (payload == null || typeof payload !== 'object') return ninguna;
    const errores = numero(payload.err ?? payload.errFilas);
    const avisos = numero(payload.advertencias);
    const descargar = (errores !== null && errores > 0) || (avisos !== null && avisos > 0);
    const retomar = tienePermiso('importacion.ejecutar')
        && payload.procesadas === 0
        && (payload.cancelada === true || payload.resultado === 'FALLIDA');
    return { descargar, retomar };
}
