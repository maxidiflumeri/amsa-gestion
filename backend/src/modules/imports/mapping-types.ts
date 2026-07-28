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

/**
 * Acción sobre los deudores de la remesa origen que NO aparecen en el archivo de ACTUALIZACIONES.
 * - `PAGO_TODO` (default): comportamiento clásico. Todas sus facturas → PAGADA, pago por el total,
 *   la consolidación posterior los deja en SIT-050 (cancelado/pagó todo).
 * - `DESASIGNAR`: se les setea `estadoGestionId = GES-094` (guardando el previo en
 *   `estadoGestionPrevioAId` para poder revertir). NO toca deuda, pagos, facturas ni situación.
 *   Los deudores cancelados (SIT-050) se ignoran. Pensado para archivos diarios de gestión
 *   (Fiat MT / Prelegal): el que no viene hoy no pagó, simplemente sale de la gestión del día.
 * - `IGNORAR`: no se hace nada con los ausentes (archivos parciales o pruebas).
 */
export type AccionAusenteActualizacion = 'PAGO_TODO' | 'DESASIGNAR' | 'IGNORAR';

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
    // ADD_COMENTARIO: texto fijo (ESTATICO), una columna (COLUMNA + fromIndex), o una PLANTILLA
    // de texto libre con variables `{{colN}}` (N = índice de columna 0-based) que se reemplazan
    // por el valor de esa columna en cada fila. La plantilla permite concatenar y maquetar libre.
    | { tipo: 'ADD_COMENTARIO'; modo: 'ESTATICO' | 'COLUMNA' | 'PLANTILLA'; texto?: string; fromIndex?: number; plantilla?: string }
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
     * ACTUALIZACIONES: qué hacer con los deudores de la remesa origen ausentes del archivo.
     * Default `PAGO_TODO` (comportamiento clásico). Ver {@link AccionAusenteActualizacion}.
     */
    accionAusente?: AccionAusenteActualizacion;
    /**
     * ACTUALIZACIONES: si `false`, NO se crean deudores nuevos cuando el registro no matchea
     * la remesa origen — solo se actualizan los existentes y se ignoran los no encontrados.
     * Útil cuando un mismo archivo cubre varias remesas y se aplica una por una.
     * Default `true` (comportamiento clásico: los no encontrados se cargan como caso nuevo).
     */
    crearNuevosCasos?: boolean;
    /** Config de la categoría ACCIONES (acciones masivas). */
    acciones?: AccionesConfig;
    /** Config de la categoría MULTIRREGISTRO (archivo con varios tipos de línea). */
    multirregistro?: MultirregistroConfig;
}

/* ────────────────────────────────────────────────────────────────────────────
 * MULTIRREGISTRO — archivos con varios tipos de línea en el mismo archivo
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Config de la categoría MULTIRREGISTRO (caso Toyota cuenta 87).
 *
 * La ESTRUCTURA del archivo (qué tipo de línea es el deudor, cuál la factura, cómo se vinculan
 * entre sí) vive en el parser y el processor, porque es específica del formato y generalizarla
 * sería construir un ETL. Acá va solo el **layout**: qué índice de columna ocupa cada dato, que es
 * lo que puede moverse sin aviso y conviene poder corregir sin deploy.
 *
 * Spec: `docs/imports-actualizacion-diaria-y-multirregistro-spec.md` §B.
 *
 * Formato del archivo:
 *   CLI;<nroCliente>;<nombre>;<calle>;...        → deudor + contactos
 *   GES;...;<nroCliente>;<contrato>;...;<aviso>  → factura (una por aviso)
 *   DET;<aviso>;<concepto>;<importe>;...         → desglose del importe de la factura
 *   BAJ;<aviso>;<fecha>;<motivo>                 → baja del caso
 *
 * Vínculos (dos saltos, NO una clave única compartida):
 *   CLI.nroCliente ── GES.nroCliente     y     GES.aviso ── DET.aviso / BAJ.aviso
 */
export interface MultirregistroConfig {
    /** Índice de la columna que trae el código de tipo de línea (default 0). */
    discriminadorIndex?: number;
    /** Codificación del archivo. Toyota manda Latin-1; leerlo como UTF-8 rompe las Ñ y los acentos. */
    encoding?: 'latin1' | 'utf8';
    /** Layout de la línea del cliente → deudor + contactos. */
    cli: {
        codigo: string;
        nroCliente: number;
        nombre: number;
        /** Índices que se concatenan para armar el domicilio, en orden. */
        domicilio?: number[];
        email?: number;
        /** Índice del código de área, que se antepone a cada teléfono. */
        codArea?: number;
        telefonos?: number[];
        /** Índices que se guardan en `camposAdicionales`, con el nombre a usar como clave. */
        adicionales?: Record<string, number>;
    };
    /** Layout de la línea de aviso → factura. */
    ges: {
        codigo: string;
        nroCliente: number;
        contrato: number;
        aviso: number;
    };
    /** Layout de la línea de detalle → desglose de la factura. */
    det: {
        codigo: string;
        aviso: number;
        concepto: number;
        /** Importe que suma al total de la factura. Se toma CON su signo (hay negativos). */
        importe: number;
        /** Columna de cantidad de días (la usa el concepto de días de mora). */
        dias?: number;
        /** Conceptos que NO son cargos y no deben ir al desglose (match por "empieza con"). */
        conceptosIgnorados?: string[];
        /** Concepto que trae los días de mora; su valor se agrega al final del desglose. */
        conceptoDiasMora?: string;
    };
    /** Layout de la línea de baja. */
    baj: {
        codigo: string;
        aviso: number;
        fecha?: number;
        motivo?: number;
        /**
         * Motivos que significan que el aviso **se pagó** (match por "empieza con", sin distinguir
         * mayúsculas). Solo para éstos se registra un pago por el importe del aviso.
         *
         * El resto de los motivos —en el archivo de Toyota, 9 de cada 10 son "Días de Mora
         * Excedidos"— NO son pagos: el cedente retira el aviso de la gestión y la deuda deja de
         * reclamarse. Registrar un pago ahí inventaría plata que nunca entró (el mismo error que
         * causó el incidente del 2026-07-21).
         */
        motivosPago?: string[];
    };
}