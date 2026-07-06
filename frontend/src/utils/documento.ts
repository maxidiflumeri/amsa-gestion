// Espeja backend/src/modules/imports/utils/documento.ts:
// los deudores cargados SIN DNI guardan un placeholder `SIN-DNI-<nroCliente>`
// en la columna `documento` (que es NOT NULL). Ese placeholder se pisa cuando
// llega el DNI real por una importación de ACTUALIZACIONES.
export const PREFIJO_SIN_DNI = 'SIN-DNI-'

export function esDocumentoPlaceholder(doc: string | null | undefined): boolean {
    return typeof doc === 'string' && doc.startsWith(PREFIJO_SIN_DNI)
}

/** Texto a mostrar para el documento de un deudor (oculta el placeholder). */
export function mostrarDocumento(doc: string | null | undefined): string {
    if (!doc) return 'Sin DNI'
    return esDocumentoPlaceholder(doc) ? 'Sin DNI' : doc
}
