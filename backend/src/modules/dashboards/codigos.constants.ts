/**
 * Códigos canónicos del catálogo de parámetros usados por el módulo de dashboards.
 * Fuente de verdad: backend/prisma/seed-codigos-curados.ts.
 *
 * Cualquier cambio de clave acá debe sincronizarse con el seed.
 */
export const CODIGOS = {
    // Contacto con Persona Correcta (titular + tercero)
    CPC_SITUACION_CLAVES: ['SIT-011', 'SIT-012'] as const,

    // Promesa de pago — acción de gestión + estado de situación
    PROMESA_GESTION_CLAVE: 'GES-030',
    PROMESA_SITUACION_VIGENTE: 'SIT-020',
    PROMESA_SITUACION_INCUMPLIDA: 'SIT-021',

    // Categorías de situación
    CONTACTADO_CATEGORIA: 'CONTACTADO',
    PAGANDO_CATEGORIA: 'PAGANDO',
    CANCELADO_CATEGORIA: 'CANCELADO',
    INCOBRABLE_CATEGORIA: 'INCOBRABLE',
    LEGAL_CATEGORIA: 'LEGAL',
} as const;

export const RANGO_MAX_DIAS = 366;
