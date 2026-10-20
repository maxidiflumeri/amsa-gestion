import api from './axios';
import type {
    AdjuntoSubido, ConfigAsistente, ConsumoAsistente, ConversacionDetalle, ConversacionResumen, EstadoAsistente, EventoAsistente,
    DetalleRespuesta, FuncionAsistente, FuncionClave, PlantillaDesdeAsistente, PreguntarBody, TiemposAsistente, TiemposNavegador,
    VistaPreviaPropuesta,
} from '../types/asistente';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

/**
 * El servidor rechazó la pregunta antes de abrir el stream (400, 404, 409, 429, 503): viene un JSON con el motivo.
 * `codigo` es el de §6.2 (`TURNO_EN_CURSO`, `LIMITE_DIARIO`, `PAUSADO`, ...), cuando lo trae.
 */
export class ErrorPregunta extends Error {
    constructor(
        public readonly status: number,
        public readonly codigo: string | null,
        mensaje: string,
        public readonly usadas?: number,
        public readonly limite?: number,
    ) {
        super(mensaje);
        this.name = 'ErrorPregunta';
    }
}

/** No hubo respuesta del servidor (red caída) o el stream se cortó antes de `fin`/`error`. */
export class ErrorConexion extends Error {
    constructor(mensaje = 'No hay conexión con el servidor') {
        super(mensaje);
        this.name = 'ErrorConexion';
    }
}

const textoDe = (v: unknown): string | undefined => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined);

/** Mismo tratamiento del 401 que `api/axios.ts`: sesión vencida, a login. */
function sesionVencida() {
    localStorage.removeItem('amsa_token');
    localStorage.removeItem('amsa_usuario');
    if (window.location.pathname !== '/login') window.location.href = '/login';
}

/** Corta un bloque `event: x\ndata: {...}` en su evento. Las líneas que empiezan con `:` (ping) y las desconocidas se ignoran. */
function parsearBloque(bloque: string): EventoAsistente | null {
    let nombre = '';
    const datos: string[] = [];
    for (const linea of bloque.split('\n')) {
        if (linea.startsWith(':')) continue;
        if (linea.startsWith('event:')) nombre = linea.slice(6).trim();
        else if (linea.startsWith('data:')) datos.push(linea.slice(5).replace(/^ /, ''));
    }
    if (!nombre || datos.length === 0) return null;
    // `paso` y `propuesta` son de la Fase B: sin ellos en la lista la tarjeta no aparecería y tampoco habría un error.
    if (!['inicio', 'texto', 'herramienta', 'accion', 'paso', 'propuesta', 'fin', 'error'].includes(nombre)) return null;
    try {
        return { evento: nombre, data: JSON.parse(datos.join('\n')) } as EventoAsistente;
    } catch {
        return null;
    }
}

/**
 * Hace una pregunta y entrega los eventos del SSE a medida que llegan (docs/asistente-spec.md §6.3).
 *
 * Va con `fetch` y no con axios: axios no entrega el cuerpo de a trozos en el navegador. Cortar con `signal`
 * cierra la conexión y el backend aborta la llamada al modelo (cancelar ahorra plata).
 *
 * Termina (resuelve) cuando llega `fin` o `error`. Si la conexión se cae antes, lanza `ErrorConexion`; si el
 * servidor rechaza el pedido antes del stream, `ErrorPregunta`. Cortar con `signal` lanza el `AbortError` de fetch.
 */
export async function preguntar(body: PreguntarBody, { onEvento, signal }: { onEvento: (e: EventoAsistente) => void; signal?: AbortSignal }): Promise<void> {
    const token = localStorage.getItem('amsa_token') || localStorage.getItem('token');
    let resp: Response;
    try {
        resp = await fetch(`${BASE}/asistente/preguntar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
            signal,
        });
    } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        throw new ErrorConexion();
    }

    if (!resp.ok) {
        if (resp.status === 401) sesionVencida();
        let datos: Record<string, unknown> = {};
        try { datos = await resp.json(); } catch { /* sin cuerpo JSON */ }
        const codigo = typeof datos.codigo === 'string' ? datos.codigo : null;
        throw new ErrorPregunta(
            resp.status,
            codigo,
            textoDe(datos.mensaje) ?? textoDe(datos.message) ?? 'No se pudo hacer la pregunta',
            typeof datos.usadas === 'number' ? datos.usadas : undefined,
            typeof datos.limite === 'number' ? datos.limite : undefined,
        );
    }
    if (!resp.body) throw new ErrorConexion();

    const lector = resp.body.getReader();
    const decodificador = new TextDecoder();
    let buffer = '';
    let terminado = false;
    const entregar = (bloque: string) => {
        const e = parsearBloque(bloque);
        if (!e) return;
        if (e.evento === 'fin' || e.evento === 'error') terminado = true;
        onEvento(e);
    };
    try {
        for (;;) {
            const { value, done } = await lector.read();
            if (done) break;
            // Se normaliza sobre lo acumulado: un `\r\n` partido entre dos trozos (`…\r` | `\n…`) queda junto recién acá.
            buffer = (buffer + decodificador.decode(value, { stream: true })).replace(/\r\n/g, '\n');
            let i: number;
            while ((i = buffer.indexOf('\n\n')) >= 0) {
                entregar(buffer.slice(0, i));
                buffer = buffer.slice(i + 2);
            }
        }
        buffer = (buffer + decodificador.decode()).replace(/\r\n/g, '\n');
        if (buffer.trim()) entregar(buffer);
    } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') throw e;
        throw new ErrorConexion('Se cortó la conexión con el servidor');
    }
    if (!terminado) throw new ErrorConexion('Se cortó la conexión con el servidor');
}

export const asistenteApi = {
    /** El estado de una función (la ayuda, si no se dice cuál). */
    estado(funcion?: FuncionClave): Promise<EstadoAsistente> {
        return api.get('/asistente/estado', { params: funcion && funcion !== 'ayuda' ? { funcion } : undefined, silencioso: true }).then((r) => r.data);
    },
    conversaciones(limite = 10, funcion?: FuncionClave): Promise<ConversacionResumen[]> {
        return api.get('/asistente/conversaciones', { params: { limite, ...(funcion ? { funcion } : {}) }, silencioso: true }).then((r) => r.data);
    },
    conversacion(id: number): Promise<ConversacionDetalle> {
        return api.get(`/asistente/conversaciones/${id}`).then((r) => r.data);
    },
    /** `valor` 0 quita la calificación. */
    calificar(mensajeId: number, valor: 1 | -1 | 0, comentario?: string): Promise<void> {
        return api.post(`/asistente/mensajes/${mensajeId}/calificacion`, comentario ? { valor, comentario } : { valor }).then(() => undefined);
    },
    accion(mensajeId: number, accionId: string, resultado: 'aceptada' | 'rechazada'): Promise<void> {
        return api.post(`/asistente/mensajes/${mensajeId}/accion`, { accionId, resultado }, { silencioso: true }).then(() => undefined);
    },
    consumo(mes?: string): Promise<ConsumoAsistente> {
        return api.get('/asistente/consumo', { params: mes ? { mes } : undefined }).then((r) => r.data);
    },
    /**
     * Lo que midió el navegador de la persona (docs/asistente-detalle-spec.md §7.10). Va de fondo: si falla no pasa nada.
     * El servidor guarda solo la primera vez y contesta 204 igual.
     */
    tiempos(mensajeId: number, t: TiemposNavegador): Promise<void> {
        return api.post(`/asistente/mensajes/${mensajeId}/tiempos`, t, { silencioso: true }).then(() => undefined);
    },
    /** El detalle de una respuesta ajena (las 👎 de Consumo): pide `asistente.administrar` y `asistente.ver_detalle`. */
    detalleDeMensaje(id: number): Promise<DetalleRespuesta> {
        return api.get(`/asistente/mensajes/${id}/detalle`, { silencioso: true }).then((r) => r.data);
    },
    /** Mediana y p95 de cada paso, por función. Es de la tarjeta «Tiempos por paso»: pide `asistente.administrar`. */
    tiemposConsumo(mes?: string): Promise<TiemposAsistente> {
        return api.get('/asistente/consumo/tiempos', { params: mes ? { mes } : undefined, silencioso: true }).then((r) => r.data);
    },
    config(): Promise<ConfigAsistente> {
        return api.get('/asistente/config').then((r) => r.data);
    },
    actualizarConfig(cambios: Partial<Pick<ConfigAsistente, 'habilitado' | 'topeMensualUsd' | 'avisoPorcentaje' | 'limiteDiarioUsuario' | 'topeTurnoUsd' | 'precios'>>): Promise<ConfigAsistente> {
        return api.patch('/asistente/config', cambios).then((r) => r.data);
    },
    actualizarFuncion(clave: string, cambios: { habilitada?: boolean; topeMensualUsd?: number | null; topeTurnoUsd?: number | null; limiteDiarioUsuario?: number | null }): Promise<FuncionAsistente> {
        return api.patch(`/asistente/funciones/${encodeURIComponent(clave)}`, cambios).then((r) => r.data);
    },

    // ─── Fase B: armar reportes (docs/asistente-reportes-spec.md §6.1) ───
    /** Sube un ejemplo (multipart, campo `archivo`). `onProgreso` recibe 0 a 100. El 400/413 trae `{ codigo, mensaje }`: lo muestra el chip. */
    subirAdjunto(archivo: File, onProgreso?: (porcentaje: number) => void, signal?: AbortSignal): Promise<AdjuntoSubido> {
        const datos = new FormData();
        datos.append('archivo', archivo);
        return api.post('/asistente/adjuntos', datos, {
            silencioso: true,
            signal,
            onUploadProgress: (e) => { if (onProgreso && e.total) onProgreso(Math.min(100, Math.round((e.loaded / e.total) * 100))); },
        }).then((r) => r.data);
    },
    actualizarAdjunto(id: number, primeraFilaEsEncabezado: boolean): Promise<AdjuntoSubido> {
        return api.patch(`/asistente/adjuntos/${id}`, { primeraFilaEsEncabezado }, { silencioso: true }).then((r) => r.data);
    },
    borrarAdjunto(id: number): Promise<void> {
        return api.delete(`/asistente/adjuntos/${id}`, { silencioso: true }).then(() => undefined);
    },
    /** La plantilla de una propuesta, lista para cargar en el editor. Marca la propuesta como abierta. */
    plantillaDePropuesta(id: number): Promise<PlantillaDesdeAsistente> {
        return api.get(`/asistente/propuestas/${id}/plantilla`).then((r) => r.data);
    },
    /** Filas de muestra, enmascaradas (docs/asistente-reportes-spec.md §8.4). No se guardan. */
    vistaPrevia(id: number, filas = 5): Promise<VistaPreviaPropuesta> {
        return api.get(`/asistente/propuestas/${id}/vista-previa`, { params: { filas }, silencioso: true }).then((r) => r.data);
    },
};
