// Contrato del asistente (docs/asistente-spec.md §6.4), copiado tal cual.

export type CodigoPausa = 'PAUSADO' | 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'SIN_WIKI' | 'SIN_PRECIO';
export interface EstadoAsistente {
  habilitado: boolean;                       // false si hay cualquier pausa
  pausa: { codigo: CodigoPausa; mensaje: string } | null;
  limiteDiario: { usadas: number; limite: number };
}
export interface AccionIrA { id: string; tipo: 'ir_a'; ruta: string; etiqueta: string; motivo: string;
  resultado: null | 'aceptada' | 'rechazada' }
export interface FuenteAyuda { slug: string; titulo: string }
export interface MensajeAsistente {
  id: number; rol: 'usuario' | 'asistente'; texto: string; ruta: string | null;
  fuentes: FuenteAyuda[]; acciones: AccionIrA[];
  estado: 'en_curso' | 'ok' | 'cortado' | 'rechazado' | 'error';
  calificacion: 1 | -1 | null; createdAt: string;
}
export interface ConversacionResumen { id: number; titulo: string; turnos: number; updatedAt: string }
export interface ConversacionDetalle extends ConversacionResumen { mensajes: MensajeAsistente[] }
export interface FuncionAsistente { clave: string; nombre: string; habilitada: boolean; topeMensualUsd: number | null }
export interface PrecioModelo { entrada: number; salida: number; cacheEscritura5m: number; cacheEscritura1h: number;
  cacheLectura: number; umbralLargo?: number; largo?: Omit<PrecioModelo, 'umbralLargo' | 'largo'> }
export interface ConfigAsistente {
  habilitado: boolean; topeMensualUsd: number; avisoPorcentaje: number; limiteDiarioUsuario: number;
  topeTurnoUsd: number; modelo: string; precios: Record<string, PrecioModelo>; funciones: FuncionAsistente[];
  sinAdministradores: boolean;               // nadie activo tiene asistente.administrar → el aviso no le llega a nadie
}
export interface ConsumoAsistente {
  mes: string; topeMensualUsd: number; gastoUsd: number; porcentaje: number; proyeccionUsd: number;
  pausa: EstadoAsistente['pausa'];
  totales: { preguntas: number; llamadas: number; usuarios: number; costoPorPregunta: number;
             tasaCache: number /* cacheLectura / (entrada + cacheLectura + cacheEscrituras) */ };
  porFuncion: { funcion: string; nombre: string; gastoUsd: number; preguntas: number; topeUsd: number | null }[];
  porUsuario: { usuarioId: number; nombre: string; preguntas: number; gastoUsd: number }[];   // top 50 por gasto
  porDia: { dia: string /* YYYY-MM-DD */; gastoUsd: number; preguntas: number }[];
  calidad: { positivas: number; negativas: number; sinCalificar: number; sinDocumentar: number };
  negativasRecientes: { mensajeId: number; fecha: string; usuario: string; pregunta: string; respuesta: string;
                        comentario: string | null; fuentes: FuenteAyuda[] }[];               // últimas 20
}

// Eventos del SSE de POST /asistente/preguntar (§6.3).
export interface EventoInicio { conversacionId: number; mensajeUsuarioId: number; mensajeId: number; limiteDiario: { usadas: number; limite: number } }
export interface EventoTexto { delta: string }
export type EventoHerramienta = { nombre: 'leer_pagina'; slug: string; titulo: string } | { nombre: 'buscar_en_wiki' };
export interface EventoAccion { id: string; tipo: 'ir_a'; ruta: string; etiqueta: string; motivo: string }
export interface EventoFin { mensajeId: number; estado: 'ok' | 'cortado' | 'rechazado'; texto: string; fuentes: FuenteAyuda[]; acciones: AccionIrA[]; ms: number }
export interface EventoError { codigo: 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'MODELO_NO_DISPONIBLE' | 'INTERNO'; mensaje: string; mensajeId?: number }

export type EventoAsistente =
  | { evento: 'inicio'; data: EventoInicio }
  | { evento: 'texto'; data: EventoTexto }
  | { evento: 'herramienta'; data: EventoHerramienta }
  | { evento: 'accion'; data: EventoAccion }
  | { evento: 'fin'; data: EventoFin }
  | { evento: 'error'; data: EventoError };

export interface PreguntarBody { conversacionId?: number; pregunta: string; ruta: string }
