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
    /** Detalle de la respuesta (docs/asistente-detalle-spec.md): solo con `asistente.ver_detalle` y solo en rol 'asistente'. */
    detalle?: DetalleRespuesta | null;
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
              /** Solo con `asistente.ver_detalle` (docs/asistente-detalle-spec.md §6.2). */
              detalle?: DetalleRespuesta;
          };
      }
    | { evento: 'error'; data: { codigo: CodigoErrorSse; mensaje: string; mensajeId?: number; detalle?: DetalleRespuesta } };

export type CodigoErrorSse = 'TOPE_MENSUAL' | 'TOPE_FUNCION' | 'MODELO_NO_DISPONIBLE' | 'PROMPT_DEMASIADO_GRANDE' | 'INTERNO';

// ============ Detalle de la respuesta (docs/asistente-detalle-spec.md §6.3) ============

export const PERMISO_VER_DETALLE = 'asistente.ver_detalle';

/** Abierto a propósito: una función nueva puede sumar tipos; el panel muestra el tipo tal cual si no lo conoce. */
export type TipoNodo =
    | 'preparacion' | 'topes' | 'historial' | 'contexto'                 // la preparación y sus partes
    | 'llamada' | 'espera' | 'razonamiento' | 'respuesta' | 'pedido'      // una llamada al modelo y sus tramos
    | 'herramienta' | 'validacion' | 'espera_base' | 'muestra' | 'conteo' // una herramienta y sus partes
    | 'guardar' | 'otros' | 'sin_detalle';

/** Dónde corre la herramienta: lo que explica su tiempo. */
export type RecursoHerramienta = 'base' | 'wiki' | 'memoria';

export type MotivoFin =
    | 'tarjeta'                  // ok: terminó al mostrar la tarjeta, sin otra llamada
    | 'respuesta_vacia'          // ok: el modelo no devolvió texto y se mostró el texto de reemplazo
    | 'detenida'                 // cortado: Detener o se cerró el panel
    | 'tope_turno' | 'max_tokens' | 'iteraciones' | 'otro_corte'
    | 'rechazo'                  // rechazado
    | 'tope_mensual' | 'tope_funcion' | 'modelo_no_disponible' | 'timeout' | 'prompt_demasiado_grande' | 'interno'
    | 'sin_terminar';            // reconstruido: la respuesta quedó en curso (el servidor se reinició a mitad)

export interface NodoDetalle {
    tipo: TipoNodo | string;
    /** Desde el inicio del turno en el servidor. Ubica la barra de la cascada. */
    desdeMs: number;
    ms: number;
    /** Llamada: 1, 2, 3… */
    numero?: number;
    /** Herramienta y pedido: el nombre de la herramienta, de la lista de la función (si no, 'otra'). */
    nombre?: string;
    recurso?: RecursoHerramienta;
    /** Herramienta: lo que hizo, en palabras. Lo arma el backend (el texto del paso). Nunca argumentos ni resultados. */
    descripcion?: string;
    estado?: 'ok' | 'aviso' | 'error';
    tokens?: number;
    costoUsd?: number;
    /** Los tokens o el costo salen de un reparto (§7.3.4): se muestran con «≈». */
    estimado?: boolean;
    /** Llamada: por qué terminó. El stop_reason, o 'abortada' | 'timeout' | 'error' | 'tope_turno' | 'tope_mensual' | 'tope_funcion'. */
    fin?: string;
    /** Llamada que falló: la clase del error del SDK ('APIConnectionTimeoutError', 'RateLimitError'…). */
    error?: string;
    /** Llamada: el uso tal como lo registró asistente_llamada. */
    uso?: { entrada: number; cacheLectura: number; cacheEscritura: number; salida: number; razonamiento: number };
    /** Llamada: el stream no informó sus bloques (un doble sin onEvento, o falló el medidor). */
    sinDesglose?: boolean;
    /** Espera: cuándo llegaron las cabeceras (después de los reintentos) y el primer evento, desde el inicio de la llamada. */
    msConexion?: number | null;
    msPrimerEvento?: number | null;
    /** Espera: lo que tardó el control de topes antes de abrir el stream. */
    msTopes?: number;
    /** Espera: el razonamiento no tuvo tiempo propio y quedó adentro (§7.3.5). */
    incluyeRazonamiento?: boolean;
    /** Razonamiento: sus eventos llegaron juntos; su tiempo está en la espera. Tiene tokens y costo, no duración. */
    sinTiempoPropio?: boolean;
    /** Herramienta: lo que le devolvió al modelo, ≈ 3 caracteres por token. Se paga como entrada de la llamada siguiente. */
    tokensResultado?: number;
    /** Quedó abierto: Detener, un error o una falla a mitad. */
    cortado?: boolean;
    hijos?: NodoDetalle[];
}

export interface TiemposNavegador {
    /** El primer cambio en pantalla después de Enviar: texto, «Leyendo…», un paso, una tarjeta. */
    primeraSenalMs: number | null;
    primerTextoMs: number | null;
    totalMs: number;
}

export interface DetalleRespuesta {
    version: 1;
    funcion: string;            // 'ayuda' | 'reportes' | 'cartera'… (string: no se suma otra unión de dos funciones)
    modelo: string;             // 'us.anthropic.claude-sonnet-5-5'
    estado: 'ok' | 'cortado' | 'rechazado' | 'error';
    motivo: MotivoFin | null;   // null = terminó bien, sin nada que aclarar
    totalMs: number;
    /** Cuándo salió el primer texto del servidor, desde el inicio del turno. */
    primerTextoMs: number | null;
    /** La suma de las llamadas: el mismo número que asistente_llamada. */
    costoUsd: number;
    llamadas: number;
    nodos: NodoDetalle[];
    /** Reconstruido desde asistente_llamada: solo las llamadas, sin tramos ni herramientas. */
    parcial: boolean;
    /** Falló algo del medidor: lo que está es correcto, pero falta algo. */
    incompleto: boolean;
    recortado: boolean;
    navegador: TiemposNavegador | null;
}

export type PasoTiempo =
    | 'total' | 'navegador_total' | 'navegador_primer_texto' | 'preparacion' | 'llamada' | 'espera'
    | 'razonamiento' | 'respuesta' | 'pedido' | 'herramienta' | 'guardar';
export interface FilaTiempo { paso: PasoTiempo; herramienta: string | null; muestras: number; medianaMs: number; p95Ms: number }
export interface TiemposAsistente {
    mes: string;
    /** Respuestas con detalle en el mes (las de antes de esta funcionalidad y las de conversaciones borradas no están). */
    respuestas: number;
    /** Más de 5.000: se tomaron las 5.000 más nuevas. */
    recortado: boolean;
    porFuncion: { funcion: string; nombre: string; filas: FilaTiempo[] }[];
}
