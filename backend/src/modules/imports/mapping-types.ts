// src/import/mapping.types.ts
export type ImportCategoria = 'DEUDORES' | 'FACTURAS' | 'PAGOS' | 'CONTACTOS' | 'ENRIQUECIMIENTO';

export interface MappingColumn {
    fromIndex: number;          // índice de columna del archivo (0-based)
    transforms?: string[];      // ej: ["trim","toNumber:es-AR"]
}

export interface RepetitiveBlock {
    entity: string;                 // ej: "FACTURA" o "CONTACTO"
    columns: Record<string, MappingColumn>;
}

/**
 * Modo de cálculo del importe (`montoTotal`) del deudor a partir de la suma de
 * sus facturas. Aplica a las categorías FACTURAS y DEUDORES_Y_FACTURAS.
 * - `NO`: no se toca `montoTotal` (lo trae el archivo de deudores).
 * - `SI_VACIO`: se completa con Σfacturas solo si el deudor quedó en null/0 (default).
 * - `SIEMPRE`: `montoTotal = Σfacturas`, pisando cualquier valor previo.
 */
export type MontoDeudorMode = 'NO' | 'SI_VACIO' | 'SIEMPRE';

/**
 * Modo del import de ACTUALIZACIONES:
 * - `RECONCILIAR` (default): comportamiento clásico — reconcilia deuda (pagos automáticos,
 *   nuevas facturas) y marca como "pagó todo" a los deudores ausentes del archivo.
 * - `SOLO_DATOS`: solo actualiza identidad (DNI) y datos adicionales de deudores existentes.
 *   NO reconcilia deuda, NO marca ausentes como pagados y NO crea deudores nuevos.
 *   Se usa para completar el DNI + adicionales de asignaciones cargadas sin DNI.
 */
export type ModoActualizacion = 'RECONCILIAR' | 'SOLO_DATOS';

export interface MappingJson {
    entity: 'DEUDOR' | 'FACTURA' | 'PAGO' | 'CONTACTO' | 'ENRIQ_MIXTO' | 'MIXTO';
    matchKeys: string[];        // ej: ["empresaId","documento"]
    columns: Record<string, MappingColumn>;  // campos principales
    extras?: Record<string, MappingColumn>;   // <-- campos adicionales (JSON)
    blocks?: RepetitiveBlock[];               // <-- bloques repetitivos (N-1)
    defaults?: Record<string, any>;
    validations?: Array<{ field: string; rule: string }>;
    dedup?: { strategy: 'keep-last' | 'keep-first'; orderBy?: string[] };
    /** Modo de cálculo de `deudor.montoTotal` desde las facturas (default `SI_VACIO`). */
    montoDeudorDesdeFacturas?: MontoDeudorMode;
    /** Modo del import de ACTUALIZACIONES (default `RECONCILIAR`). */
    modoActualizacion?: ModoActualizacion;
}