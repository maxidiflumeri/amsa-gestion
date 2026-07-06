import { MappedRow } from '../processors/processor.interface';
import { nroClienteDeFila } from './nro-cliente';

/**
 * Placeholder de `documento` para deudores cargados SIN DNI.
 *
 * La identidad del deudor es la clave única `(empresaId, documento, remesaId)` y
 * `documento` es NOT NULL, así que un deudor sin DNI necesita igual un valor en esa
 * columna. Usamos un placeholder DETERMINÍSTICO derivado del `nroCliente` para que:
 *  - se respete la clave única,
 *  - reimportar el mismo archivo sea idempotente (mismo placeholder → upsert, no duplica),
 *  - el DNI real (que llega después por una plantilla de ACTUALIZACIONES) pueda
 *    identificar y pisar el placeholder.
 */
export const PREFIJO_SIN_DNI = 'SIN-DNI-';

/** Placeholder estable a partir del número de cliente. */
export function placeholderDocumento(nroCliente: string): string {
    return `${PREFIJO_SIN_DNI}${String(nroCliente).trim()}`;
}

/** True si el documento es un placeholder generado por falta de DNI real. */
export function esDocumentoPlaceholder(doc: string | null | undefined): boolean {
    return typeof doc === 'string' && doc.startsWith(PREFIJO_SIN_DNI);
}

/**
 * Documento a persistir para una fila de DEUDORES/DEUDORES_Y_FACTURAS:
 *  - el DNI del archivo si viene,
 *  - si no, un placeholder derivado del nroCliente,
 *  - `''` si no hay ninguno de los dos (fila inválida — la valida el processor).
 */
export function documentoDeFila(row: MappedRow): string {
    const doc = String(row.documento ?? '').trim();
    if (doc) return doc;
    const nroCliente = nroClienteDeFila(row);
    return nroCliente ? placeholderDocumento(nroCliente) : '';
}
