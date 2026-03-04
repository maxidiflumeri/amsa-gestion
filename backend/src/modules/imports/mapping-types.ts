// src/import/mapping.types.ts
export type ImportCategoria = 'DEUDORES' | 'FACTURAS' | 'ENRIQUECIMIENTO';

export interface MappingColumn {
    fromIndex: number;          // índice de columna del archivo (0-based)
    transforms?: string[];      // ej: ["trim","toNumber:es-AR"]
}

export interface MappingJson {
    entity: 'DEUDOR' | 'FACTURA' | 'ENRIQ_MIXTO';
    matchKeys: string[];        // ej: ["empresaId","documento"]
    columns: Record<string, MappingColumn>;  // campos principales
    extras?: Record<string, MappingColumn>;   // <-- NUEVO (opcional)
    defaults?: Record<string, any>;
    validations?: Array<{ field: string; rule: string }>;
    dedup?: { strategy: 'keep-last' | 'keep-first'; orderBy?: string[] };
}