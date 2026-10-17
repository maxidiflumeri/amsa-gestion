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
}

export interface ConversacionResumen {
    id: number;
    titulo: string;
    turnos: number;
    updatedAt: string;
}

export interface ConversacionDetalle extends ConversacionResumen {
    mensajes: MensajeAsistente[];
}

export interface FuncionAsistente {
    clave: string;
    nombre: string;
    habilitada: boolean;
    topeMensualUsd: number | null;
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
    porFuncion: { funcion: string; nombre: string; gastoUsd: number; preguntas: number; topeUsd: number | null }[];
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
    | { evento: 'herramienta'; data: { nombre: 'leer_pagina'; slug: string; titulo: string } }
    | { evento: 'accion'; data: { id: string; tipo: 'ir_a'; ruta: string; etiqueta: string; motivo: string } }
    | {
          evento: 'fin';
          data: {
              mensajeId: number;
              estado: 'ok' | 'cortado' | 'rechazado';
              texto: string;
              fuentes: FuenteAyuda[];
              acciones: AccionIrA[];
              ms: number;
          };
      }
    | { evento: 'error'; data: { codigo: CodigoErrorSse; mensaje: string; mensajeId?: number } };

export type CodigoErrorSse = 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'MODELO_NO_DISPONIBLE' | 'INTERNO';
