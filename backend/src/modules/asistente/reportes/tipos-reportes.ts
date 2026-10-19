import type { EstadoMapeo } from '../dto/asistente.tipos';

/**
 * Tipos internos de la función `reportes` del asistente (docs/asistente-reportes-spec.md §7 y §15.2).
 */

export type FormatoSalida = 'xlsx' | 'csv' | 'txt' | 'pdf';
export type Cardinalidad = 'concatenar' | 'primero' | 'ultimo' | 'expandir';

/** Lo que manda el modelo a `probar_plantilla` (ya con la forma verificada). */
export interface EntradaProbar {
    nombre: string;
    descripcion?: string;
    empresa: string | null;
    formatoSalida: FormatoSalida;
    opciones: OpcionesEntrada;
    definicion: DefinicionEntrada;
    mapeo: MapeoEntrada[];
}

export interface OpcionesEntrada {
    separador?: string;
    incluirHeader?: boolean;
    bom?: boolean;
    encoding?: 'utf8' | 'latin1';
    lineEnding?: '\r\n' | '\n';
    anchoFijo?: number[];
    alineacion?: ('izquierda' | 'derecha')[];
    relleno?: (' ' | '0')[];
}

export interface ColumnaEntrada {
    label: string;
    path: string;
    valorFijo?: string;
    tipo?: 'texto' | 'numero' | 'fecha' | 'boolean' | 'telefono' | 'dias';
    formato?: string;
    decimales?: number;
    separadorDecimal?: ',' | '.';
    separadorMiles?: '.' | ',' | '';
    cardinalidad?: Cardinalidad;
    separadorConcat?: string;
    formatoTelefonoId?: number;
}

export type ValorFiltro = string | number | boolean | (string | number)[];

export interface FiltroEntrada {
    path: string;
    operador: string;
    valor?: ValorFiltro;
    variable?: boolean;
    labelVariable?: string;
    obligatorio?: boolean;
    valorPorDefecto?: ValorFiltro;
}

export interface DefinicionEntrada {
    columnas: ColumnaEntrada[];
    filtros: FiltroEntrada[];
    ordenamientos: { path: string; direccion: 'asc' | 'desc' }[];
    cardinalidadDefault: Cardinalidad;
    /** No están en el esquema de la herramienta (el modelo no los usa); el validador los entiende igual. */
    totales?: { path: string; funcion: 'sum' | 'avg' | 'count' | 'min' | 'max'; label?: string }[];
    agrupaciones?: { path: string; mostrarSubtotales?: boolean; saltoPagina?: boolean }[];
}

export interface MapeoEntrada {
    columnaEjemplo: string | null;
    label: string;
    estado: EstadoMapeo;
    nota: string;
}

/** La plantilla lista para el editor y para el motor: ids uuid, opciones por formato, empresa resuelta. */
export interface PlantillaNormalizada {
    nombre: string;
    descripcion: string | null;
    raiz: 'deudor';
    empresaId: number | null;
    definicion: {
        columnas: Record<string, unknown>[];
        filtros: Record<string, unknown>[];
        ordenamientos: { path: string; direccion: 'asc' | 'desc' }[];
        cardinalidadDefault: Cardinalidad;
        totales?: Record<string, unknown>[];
        agrupaciones?: Record<string, unknown>[];
    };
    formatoSalida: FormatoSalida;
    opcionesFormato: Record<string, Record<string, unknown>>;
}

export interface Capacidades {
    /** Fechas relativas en filtros (`hoy-90`). */
    E1: boolean;
    /** Columna `dias`. */
    E2: boolean;
    /** Decimales y separadores. */
    E3: boolean;
    /** Ancho fijo con alineación y relleno. */
    E4: boolean;
}

export const CAPACIDADES_TODAS: Capacidades = { E1: true, E2: true, E3: true, E4: true };

export interface Vocabulario {
    valores: string[];
    /** Si es cerrado, un valor fuera de la lista es un error (si no, es solo informativo). */
    cerrado: boolean;
}
