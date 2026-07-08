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

/**
 * Comportamiento de ACTUALIZACIONES (Modo B / saldo) cuando el saldo informado es
 * MAYOR al actual del deudor (la deuda creció):
 * - `FACTURA_NUEVA` (default): genera una factura de ajuste por la diferencia y sube el saldo.
 * - `ACTUALIZAR_SALDO`: no genera facturas nuevas; si el deudor tiene una única factura pendiente,
 *   le actualiza el importe al saldo informado, y sube el saldo. Pensado para intereses diarios.
 */
export type ComportamientoDeudaMayor = 'FACTURA_NUEVA' | 'ACTUALIZAR_SALDO';

// ─────────────────────────────────────────────────────────────────────────────
// Categoría ACCIONES (acciones masivas): matcheo + catálogo cerrado de operaciones.
// ─────────────────────────────────────────────────────────────────────────────

/** Origen del valor de una operación: el mismo para todos, o por columna del archivo. */
export type OrigenValor = 'ESTATICO' | 'COLUMNA';

export type CampoPrincipal = 'nombre' | 'apellido' | 'montoTotal' | 'fechaVencimiento' | 'nroCliente';
export type TipoContactoAccion = 'telefono' | 'email' | 'cualquiera';

export type AccionOperacion =
    | { tipo: 'SET_SITUACION' | 'SET_GESTION' | 'SET_MOTIVO'; modo: OrigenValor; parametroId?: number; fromIndex?: number }
    | { tipo: 'SET_CAMPO'; campo: CampoPrincipal; modo: OrigenValor; valor?: string; fromIndex?: number }
    | { tipo: 'SET_ADICIONALES'; columnas: Array<{ nombre: string; fromIndex: number }> }
    | { tipo: 'ADD_COMENTARIO'; modo: OrigenValor; texto?: string; fromIndex?: number }
    | { tipo: 'DELETE_CONTACTO'; contactoTipo: TipoContactoAccion; modo: OrigenValor; valor?: string; fromIndex?: number };

export interface AccionesConfig {
    /** DEUDOR: acciones sobre deudores matcheados por listado. CONTACTO: limpieza global de contactos. */
    matchMode: 'DEUDOR' | 'CONTACTO';
    /** Columna de match para matchMode DEUDOR (id = ID interno del deudor). */
    matchColumn?: { field: 'nro_cliente' | 'documento' | 'id'; fromIndex: number };
    /** Valor de contacto a borrar para matchMode CONTACTO (limpieza global). */
    contactoValor?: { tipo: 'telefono' | 'email'; fromIndex: number };
    /** Si true, no se tocan los deudores cancelados (SIT-050). */
    saltearCanceladas?: boolean;
    /** Operaciones a aplicar en orden. */
    operaciones: AccionOperacion[];
}

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
    /** Comportamiento ante deuda mayor en ACTUALIZACIONES (default `FACTURA_NUEVA`). */
    comportamientoDeudaMayor?: ComportamientoDeudaMayor;
    /**
     * ACTUALIZACIONES: si `false`, NO se crean deudores nuevos cuando el registro no matchea
     * la remesa origen — solo se actualizan los existentes y se ignoran los no encontrados.
     * Útil cuando un mismo archivo cubre varias remesas y se aplica una por una.
     * Default `true` (comportamiento clásico: los no encontrados se cargan como caso nuevo).
     */
    crearNuevosCasos?: boolean;
    /** Config de la categoría ACCIONES (acciones masivas). */
    acciones?: AccionesConfig;
}