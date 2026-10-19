/**
 * Tipos del contrato del asistente (docs/asistente-spec.md §6.4). El frontend copia estos mismos tipos
 * en `src/types/asistente.ts`: si cambia uno, cambia el otro.
 */

export type CodigoPausa = 'PAUSADO' | 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'SIN_WIKI' | 'SIN_PRECIO';

export interface EstadoAsistente {
    /** false si hay cualquier pausa. */
    habilitado: boolean;
    pausa: { codigo: CodigoPausa; mensaje: string } | null;
    limiteDiario: { usadas: number; limite: number };
}

export interface AccionIrA {
    id: string;
    tipo: 'ir_a';
    ruta: string;
    etiqueta: string;
    motivo: string;
    resultado: null | 'aceptada' | 'rechazada';
}

export interface FuenteAyuda {
    slug: string;
    titulo: string;
}

export type EstadoMensaje = 'en_curso' | 'ok' | 'cortado' | 'rechazado' | 'error';

// ============ Fase B: armar plantillas de reportes (docs/asistente-reportes-spec.md §6.4) ============

export type FuncionClave = 'ayuda' | 'reportes';

export interface AdjuntoSubido {
    id: number;
    nombre: string;
    tipo: 'xlsx' | 'xls' | 'csv' | 'txt';
    bytes: number;
    resumen: {
        hojas: { nombre: string | null; filas: number; usada: boolean }[];
        columnas: number;
        filasDatos: number;
        conEncabezado: boolean;
        anchoFijo: boolean;
        /** Los primeros 3 encabezados, para que la persona vea que se tomó bien la primera fila. */
        encabezados: string[];
    };
    avisos: string[];
}

export type TipoPaso = 'ejemplo' | 'valores' | 'datos_adicionales' | 'hoja' | 'prueba' | 'propuesta';
export interface Paso {
    tipo: TipoPaso;
    estado: 'ok' | 'aviso' | 'error';
    texto: string;
}

export type EstadoMapeo = 'exacta' | 'aproximada' | 'sin_campo' | 'agregada';
export interface FilaMapeo {
    /** Encabezado de la columna del ejemplo, o null si la columna se agregó a pedido. */
    columnaEjemplo: string | null;
    label: string;
    estado: EstadoMapeo;
    /** Del modelo, recortada a 200. */
    nota: string;
    /** Del backend: "Documento", "Teléfono / email / dirección · 2.º teléfono", "Columna vacía". */
    saleDe: string;
    /** Del backend: "DD/MM/YYYY", "2 decimales, coma", "Días desde el vencimiento". */
    formato: string | null;
}

export interface TarjetaPropuesta {
    propuestaId: number;
    prueba: string;
    /** 1, 2, 3… dentro de la conversación: la tarjeta vieja dice "Versión 1". */
    version: number;
    nombre: string;
    descripcion: string | null;
    empresa: string | null;
    formato: 'xlsx' | 'csv' | 'txt' | 'pdf';
    /** "Separador ;", "Sin BOM", "Ancho fijo: 6 columnas", "latin1". */
    opciones: string[];
    mapeo: FilaMapeo[];
    /** "Empresa: TOYOTA", "Vencimiento: hasta hace 90 días (hoy, 21/07/2026)"; [] = "Sin filtros: trae todas las carteras". */
    filtros: string[];
    orden: string[];
    /** null = no se pudo contar a tiempo. */
    casos: number | null;
    casosAproximado: boolean;
    /** Del validador y de la prueba, en castellano. */
    avisos: string[];
    /** Lo que escribió el modelo en mostrar_propuesta. */
    mensaje: string;
    /** 0 a 3 chips de ajuste. */
    sugerencias: string[];
    estado: 'mostrada' | 'abierta' | 'guardada';
    plantillaId: number | null;
    /** false si en la misma conversación hay una versión mostrada más nueva. */
    vigente: boolean;
}

export interface VistaPreviaPropuesta {
    columnas: string[];
    /** Enmascaradas. */
    filas: Record<string, string>[];
    casos: number | null;
    error?: 'TIMEOUT' | 'FALLO';
}

export interface PlantillaDesdeAsistente {
    nombre: string;
    descripcion: string | null;
    raiz: 'deudor';
    empresaId: number | null;
    /** Con ids uuid en columnas y filtros. */
    definicion: Record<string, unknown>;
    formatoSalida: 'xlsx' | 'csv' | 'txt' | 'pdf';
    /** { [formato]: {...} } */
    opcionesFormato: Record<string, Record<string, unknown>>;
    asistentePropuestaId: number;
}

export interface MensajeAsistente {
    id: number;
    rol: 'usuario' | 'asistente';
    texto: string;
    ruta: string | null;
    fuentes: FuenteAyuda[];
    acciones: AccionIrA[];
    estado: EstadoMensaje;
    calificacion: 1 | -1 | null;
    createdAt: string;
    /** Fase B. Vacío en la ayuda. */
    pasos: Paso[];
    propuestas: TarjetaPropuesta[];
    /** Solo en los mensajes de la persona. */
    adjuntos: { id: number; nombre: string; tipo: string; columnas: number }[];
}

export interface ConversacionResumen {
    id: number;
    titulo: string;
    turnos: number;
    updatedAt: string;
    funcion: FuncionClave;
}

export interface ConversacionDetalle extends ConversacionResumen {
    mensajes: MensajeAsistente[];
}

export interface FuncionAsistente {
    clave: string;
    nombre: string;
    habilitada: boolean;
    topeMensualUsd: number | null;
    /** El modelo con el que corre la función. */
    modelo: string;
    /** null = el global. */
    topeTurnoUsd: number | null;
    /** null = sin límite propio (rige igual el global). */
    limiteDiarioUsuario: number | null;
}

export interface PrecioModelo {
    entrada: number;
    salida: number;
    cacheEscritura5m: number;
    cacheEscritura1h: number;
    cacheLectura: number;
    umbralLargo?: number;
    largo?: Omit<PrecioModelo, 'umbralLargo' | 'largo'>;
}

export interface ConfigAsistente {
    habilitado: boolean;
    topeMensualUsd: number;
    avisoPorcentaje: number;
    limiteDiarioUsuario: number;
    topeTurnoUsd: number;
    modelo: string;
    precios: Record<string, PrecioModelo>;
    funciones: FuncionAsistente[];
    /** Nadie activo tiene asistente.administrar: el aviso del tope no le llega a nadie. */
    sinAdministradores: boolean;
}

export interface ConsumoAsistente {
    mes: string;
    topeMensualUsd: number;
    gastoUsd: number;
    porcentaje: number;
    proyeccionUsd: number;
    pausa: EstadoAsistente['pausa'];
    totales: {
        preguntas: number;
        llamadas: number;
        usuarios: number;
        costoPorPregunta: number;
        /** cacheLectura / (entrada + cacheLectura + cacheEscrituras) */
        tasaCache: number;
    };
    porFuncion: {
        funcion: string;
        nombre: string;
        gastoUsd: number;
        preguntas: number;
        topeUsd: number | null;
        modelo?: string;
        /** Solo en la función de reportes. */
        plantillas?: {
            mostradas: number;
            abiertas: number;
            guardadas: number;
            guardadasSinCambios: number;
            costoPorGuardada: number | null;
        };
    }[];
    /** Top 50 por gasto. */
    porUsuario: { usuarioId: number; nombre: string; preguntas: number; gastoUsd: number }[];
    porDia: { dia: string; gastoUsd: number; preguntas: number }[];
    calidad: { positivas: number; negativas: number; sinCalificar: number; sinDocumentar: number };
    /** Las últimas 20. */
    negativasRecientes: {
        mensajeId: number;
        fecha: string;
        usuario: string;
        pregunta: string;
        respuesta: string;
        comentario: string | null;
        fuentes: FuenteAyuda[];
    }[];
}

/** Eventos del stream SSE de `POST /asistente/preguntar` (§6.3). */
export type EventoSse =
    | { evento: 'inicio'; data: { conversacionId: number; mensajeUsuarioId: number; mensajeId: number; limiteDiario: { usadas: number; limite: number } } }
    | { evento: 'texto'; data: { delta: string } }
    | { evento: 'herramienta'; data: { nombre: 'leer_pagina'; slug: string; titulo: string } | { nombre: 'buscar_en_wiki' } }
    | { evento: 'accion'; data: { id: string; tipo: 'ir_a'; ruta: string; etiqueta: string; motivo: string } }
    | { evento: 'paso'; data: Paso }
    | { evento: 'propuesta'; data: TarjetaPropuesta }
    | {
          evento: 'fin';
          data: {
              mensajeId: number;
              estado: 'ok' | 'cortado' | 'rechazado';
              texto: string;
              fuentes: FuenteAyuda[];
              acciones: AccionIrA[];
              /** Vacíos en la ayuda. */
              pasos: Paso[];
              propuestas: TarjetaPropuesta[];
              ms: number;
          };
      }
    | { evento: 'error'; data: { codigo: CodigoErrorSse; mensaje: string; mensajeId?: number } };

export type CodigoErrorSse = 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'MODELO_NO_DISPONIBLE' | 'PROMPT_DEMASIADO_GRANDE' | 'INTERNO';
