import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { asistenteApi, ErrorConexion, ErrorPregunta, preguntar } from '../api/asistente';
import type {
    AccionIrA, ConversacionResumen, EstadoAsistente, EventoAsistente, MensajeAsistente,
} from '../types/asistente';
import { useAuth } from './AuthContext';
import { useNotify } from '../hooks/useNotify';

/**
 * El asistente de ayuda (docs/asistente-spec.md §12). Vive en `AppShell` y no en la barra: al navegar con
 * «Sí, llevarme» la conversación tiene que sobrevivir al cambio de pantalla.
 *
 * Contiene el streaming: cierra el panel y la respuesta sigue escribiéndose; «Detener» corta el `fetch` y, del otro
 * lado, el backend corta la llamada al modelo.
 */

/** Un mensaje tal como lo dibuja el panel: el del contrato, más lo que solo existe mientras se escribe o si falló. */
export interface MensajeVista extends MensajeAsistente {
    /** Identidad estable en pantalla: el `id` cambia cuando el servidor confirma el mensaje, la `clave` no. */
    clave: string;
    /** Título de la página que está leyendo en este momento («Leyendo «…»…»). */
    leyendo?: string | null;
    /** Por qué falló la respuesta (estado `error`); el texto parcial, si lo hubo, queda en `texto`. */
    errorTexto?: string;
    /** El error fue un tope: reintentar no tiene sentido. */
    errorDeTope?: boolean;
    /** El usuario cortó con «Detener». */
    detenido?: boolean;
    /** Vino de una conversación abierta y el servidor la tiene todavía `en_curso`: no hay un stream de esta pestaña escribiéndola. */
    recuperada?: boolean;
}

/** Lo que impide preguntar: el compositor queda deshabilitado y el panel explica por qué. */
export interface Bloqueo { tipo: 'pausa' | 'limite'; mensaje: string }
/** Un aviso que no bloquea (otra pestaña con una pregunta en curso, conversación llena...). */
export interface Aviso { tipo: 'turno' | 'llena' | 'perdida'; mensaje: string }

export type ResultadoEnvio = 'enviado' | 'rechazado' | 'ignorado';

interface AsistenteContextValue {
    /** Tiene `asistente.usar`: si no, no hay botón ni panel. */
    disponible: boolean;
    abierto: boolean;
    abrir: () => void;
    cerrar: () => void;
    alternar: () => void;
    mensajes: MensajeVista[];
    conversacionId: number | null;
    enviando: boolean;
    estado: EstadoAsistente | null;
    bloqueo: Bloqueo | null;
    aviso: Aviso | null;
    /** `rechazado` = el servidor no aceptó la pregunta (tope, límite, otra pestaña): el panel devuelve el texto al compositor. */
    enviar: (texto: string) => Promise<ResultadoEnvio>;
    detener: () => void;
    reintentar: () => void;
    nuevaConversacion: () => void;
    conversaciones: ConversacionResumen[] | null;
    cargarConversaciones: () => Promise<void>;
    abrirConversacion: (id: number) => Promise<void>;
    /** Vuelve a leer la conversación abierta (la última respuesta puede haber terminado). */
    actualizarConversacion: () => void;
    /** Vuelve a pedir el estado: el cartel de pausa o de límite se va si ya se levantó. */
    volverAProbar: () => void;
    calificar: (mensajeId: number, valor: 1 | -1 | 0, comentario?: string) => Promise<void>;
    responderAccion: (mensajeId: number, accion: AccionIrA, resultado: 'aceptada' | 'rechazada') => void;
}

const AsistenteContext = createContext<AsistenteContextValue | null>(null);

/** Un cuadro de animación: con `requestAnimationFrame` si hay, con un timer de 16 ms si no (el arnés de tests). */
function programarCuadro(cb: () => void): () => void {
    if (typeof requestAnimationFrame === 'function') {
        const h = requestAnimationFrame(cb);
        return () => cancelAnimationFrame(h);
    }
    const h = setTimeout(cb, 16);
    return () => clearTimeout(h);
}

/** Cada cuánto se vuelve a mirar si se levantó un bloqueo, con el panel abierto. */
const REVISAR_BLOQUEO_MS = 60_000;
/** Una conversación con la última respuesta en curso se recarga sola cada tanto, hasta un máximo. */
const RECARGAR_CADA_MS = 3_000;
const RECARGAR_HASTA_MS = 30_000;

/** El texto que pone `preguntar` cuando el backend no mandó ninguno. */
const MENSAJE_SIN_DATOS = 'No se pudo hacer la pregunta';
const MENSAJE_LIMITE = (limite: number) => `Llegaste al límite de ${limite} preguntas de hoy. Mañana se renueva.`;
const bloqueoDe = (e: EstadoAsistente | null): Bloqueo | null => {
    if (!e) return null;
    if (e.pausa) return { tipo: 'pausa', mensaje: e.pausa.mensaje };
    if (!e.habilitado) return { tipo: 'pausa', mensaje: 'El asistente está pausado por un administrador.' };
    if (e.limiteDiario.limite > 0 && e.limiteDiario.usadas >= e.limiteDiario.limite) return { tipo: 'limite', mensaje: MENSAJE_LIMITE(e.limiteDiario.limite) };
    return null;
};

export const AsistenteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { tienePermiso } = useAuth();
    const disponible = tienePermiso('asistente.usar');
    const { pathname } = useLocation();
    const navigate = useNavigate();
    // `useNotify` devuelve un objeto nuevo en cada render: por ref, para que no cambie el valor del contexto en cada cuadro del streaming.
    const notify = useNotify();
    const notifyRef = useRef(notify);
    notifyRef.current = notify;

    const [abierto, setAbierto] = useState(false);
    const [mensajes, setMensajes] = useState<MensajeVista[]>([]);
    const [conversacionId, setConversacionId] = useState<number | null>(null);
    const [enviando, setEnviando] = useState(false);
    const [estado, setEstado] = useState<EstadoAsistente | null>(null);
    const [aviso, setAviso] = useState<Aviso | null>(null);
    const [conversaciones, setConversaciones] = useState<ConversacionResumen[] | null>(null);

    // Lo que el streaming necesita leer sin depender de renders.
    const conversacionRef = useRef<number | null>(null);
    const enviandoRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);
    const textoRef = useRef('');
    const cancelarCuadroRef = useRef<(() => void) | null>(null);
    const idAsistenteRef = useRef(0);
    const montadoRef = useRef(true);
    const pathnameRef = useRef(pathname);
    pathnameRef.current = pathname;
    const secuenciaTemporal = useRef(0);

    useEffect(() => {
        montadoRef.current = true;
        return () => {
            montadoRef.current = false;
            cancelarCuadroRef.current?.();
            abortRef.current?.abort();
        };
    }, []);

    const fijarConversacion = useCallback((id: number | null) => {
        conversacionRef.current = id;
        setConversacionId(id);
    }, []);

    /** Cambia el mensaje del asistente que se está escribiendo (el id se toma ahora: el updater de React corre más tarde). */
    const actualizarAsistente = useCallback((cambios: (m: MensajeVista) => MensajeVista) => {
        const id = idAsistenteRef.current;
        setMensajes((prev) => prev.map((m) => (m.id === id && m.rol === 'asistente' ? cambios(m) : m)));
    }, []);

    /** Vuelca a pantalla lo acumulado: a lo sumo una vez por cuadro. */
    const programarVolcado = useCallback(() => {
        if (cancelarCuadroRef.current) return;
        cancelarCuadroRef.current = programarCuadro(() => {
            cancelarCuadroRef.current = null;
            if (!montadoRef.current) return;
            const texto = textoRef.current;
            actualizarAsistente((m) => (m.texto === texto ? m : { ...m, texto }));
        });
    }, [actualizarAsistente]);

    const cancelarVolcado = useCallback(() => {
        cancelarCuadroRef.current?.();
        cancelarCuadroRef.current = null;
    }, []);

    const cargarEstado = useCallback(async () => {
        try {
            const e = await asistenteApi.estado();
            if (montadoRef.current) setEstado(e);
        } catch {
            // Sin estado no se bloquea nada: si hay una pausa, el servidor la va a decir al preguntar.
        }
    }, []);

    useEffect(() => {
        if (abierto && disponible) void cargarEstado();
    }, [abierto, disponible, cargarEstado]);

    const abrir = useCallback(() => setAbierto(true), []);
    const cerrar = useCallback(() => setAbierto(false), []);
    const alternar = useCallback(() => setAbierto((a) => !a), []);

    const bloqueo = useMemo(() => bloqueoDe(estado), [estado]);
    const hayBloqueo = bloqueo !== null;

    // Mientras el compositor está bloqueado (pausa, tope o límite) y el panel abierto, el cartel se va solo apenas se levanta.
    useEffect(() => {
        if (!hayBloqueo || !abierto || !disponible) return;
        const revisar = () => { void cargarEstado(); };
        const h = setInterval(revisar, REVISAR_BLOQUEO_MS);
        window.addEventListener('focus', revisar);
        return () => { clearInterval(h); window.removeEventListener('focus', revisar); };
    }, [hayBloqueo, abierto, disponible, cargarEstado]);

    const volverAProbar = useCallback(() => { void cargarEstado(); }, [cargarEstado]);

    const enviar = useCallback(async (texto: string): Promise<ResultadoEnvio> => {
        const pregunta = texto.trim();
        if (!pregunta || enviandoRef.current) return 'ignorado';
        enviandoRef.current = true;
        setEnviando(true);
        setAviso(null);
        const ac = new AbortController();
        abortRef.current = ac;
        textoRef.current = '';

        const idU = --secuenciaTemporal.current;
        const idA = --secuenciaTemporal.current;
        idAsistenteRef.current = idA;
        const ahora = new Date().toISOString();
        const ruta = pathnameRef.current.slice(0, 200) || '/';
        setMensajes((prev) => [
            ...prev,
            { clave: `l${-idU}`, id: idU, rol: 'usuario', texto: pregunta, ruta, fuentes: [], acciones: [], estado: 'ok', calificacion: null, createdAt: ahora },
            { clave: `l${-idA}`, id: idA, rol: 'asistente', texto: '', ruta: null, fuentes: [], acciones: [], estado: 'en_curso', calificacion: null, createdAt: ahora, leyendo: null },
        ]);

        let accionesVivas: AccionIrA[] = [];
        let resultado: ResultadoEnvio = 'enviado';

        const alEvento = (e: EventoAsistente) => {
            if (!montadoRef.current) return;
            switch (e.evento) {
                case 'inicio': {
                    fijarConversacion(e.data.conversacionId);
                    const nuevoIdA = e.data.mensajeId;
                    setMensajes((prev) => prev.map((m) => (m.id === idU ? { ...m, id: e.data.mensajeUsuarioId } : m.id === idA ? { ...m, id: nuevoIdA } : m)));
                    idAsistenteRef.current = nuevoIdA;
                    setEstado((s) => ({ habilitado: true, pausa: null, ...(s ?? {}), limiteDiario: e.data.limiteDiario }));
                    break;
                }
                case 'texto':
                    textoRef.current += e.data.delta;
                    actualizarAsistente((m) => (m.leyendo ? { ...m, leyendo: null } : m));
                    programarVolcado();
                    break;
                case 'herramienta':
                    actualizarAsistente((m) => ({ ...m, leyendo: e.data.titulo }));
                    break;
                case 'accion':
                    accionesVivas = [...accionesVivas, { ...e.data, resultado: null }];
                    break;
                case 'fin': {
                    cancelarVolcado();
                    textoRef.current = e.data.texto;
                    const fin = e.data;
                    actualizarAsistente((m) => ({ ...m, id: fin.mensajeId, texto: fin.texto, fuentes: fin.fuentes, acciones: fin.acciones ?? accionesVivas, estado: fin.estado, leyendo: null }));
                    idAsistenteRef.current = fin.mensajeId;
                    break;
                }
                case 'error': {
                    cancelarVolcado();
                    const tope = e.data.codigo === 'TOPE_MENSUAL' || e.data.codigo === 'TOPE_FUNCION';
                    const parcial = textoRef.current;
                    const idError = e.data.mensajeId;
                    actualizarAsistente((m) => ({ ...m, id: idError ?? m.id, texto: parcial, estado: 'error', leyendo: null, errorTexto: e.data.mensaje, errorDeTope: tope }));
                    if (idError) idAsistenteRef.current = idError;
                    if (tope) setEstado((s) => ({ habilitado: false, limiteDiario: s?.limiteDiario ?? { usadas: 0, limite: 0 }, pausa: { codigo: e.data.codigo as 'TOPE_MENSUAL' | 'TOPE_FUNCION', mensaje: e.data.mensaje } }));
                    break;
                }
            }
        };

        // Un rechazo previo al stream: no hubo `inicio`, así que el par todavía tiene los ids temporales.
        const quitarPar = () => setMensajes((prev) => prev.filter((m) => m.id !== idU && m.id !== idA));

        try {
            await preguntar({ ...(conversacionRef.current ? { conversacionId: conversacionRef.current } : {}), pregunta, ruta }, { onEvento: alEvento, signal: ac.signal });
        } catch (e) {
            cancelarVolcado();
            if (!montadoRef.current) return 'enviado';
            const parcial = textoRef.current;
            if ((e as { name?: string })?.name === 'AbortError') {
                actualizarAsistente((m) => ({ ...m, texto: parcial, estado: 'cortado', leyendo: null, detenido: true }));
            } else if (e instanceof ErrorPregunta) {
                resultado = 'rechazado';
                // Se decide por `codigo` y no por el status: el backend manda PAUSADO y los topes como 429 (503 en versiones viejas).
                const codigoPausa = (['PAUSADO', 'TOPE_MENSUAL', 'TOPE_FUNCION'] as const).find((c) => c === e.codigo);
                if (codigoPausa || (e.status === 503 && e.codigo !== 'LIMITE_DIARIO')) {
                    quitarPar();
                    const codigo = codigoPausa ?? (e.codigo === 'SIN_WIKI' || e.codigo === 'SIN_PRECIO' ? e.codigo : 'PAUSADO');
                    const mensaje = !codigoPausa && e.message === MENSAJE_SIN_DATOS ? 'El asistente no está disponible en este momento. Probá en un rato.' : e.message;
                    setEstado((s) => ({ habilitado: false, limiteDiario: s?.limiteDiario ?? { usadas: 0, limite: 0 }, pausa: { codigo, mensaje } }));
                } else if (e.status === 429) {
                    quitarPar();
                    setEstado((s) => ({ habilitado: s?.habilitado ?? true, pausa: s?.pausa ?? null, limiteDiario: { usadas: e.usadas ?? s?.limiteDiario.usadas ?? 0, limite: e.limite ?? s?.limiteDiario.limite ?? 0 } }));
                } else if (e.status === 409 && e.codigo === 'TURNO_EN_CURSO') {
                    quitarPar();
                    setAviso({ tipo: 'turno', mensaje: 'Ya tenés una pregunta en curso en otra pestaña.' });
                } else if (e.status === 409 && e.codigo === 'CONVERSACION_LLENA') {
                    quitarPar();
                    setAviso({ tipo: 'llena', mensaje: 'Esta conversación llegó al máximo de preguntas. Empezá una nueva.' });
                } else if (e.status === 404) {
                    quitarPar();
                    setAviso({ tipo: 'perdida', mensaje: 'Esa conversación ya no existe. Empezá una nueva.' });
                } else {
                    resultado = 'enviado';
                    actualizarAsistente((m) => ({ ...m, texto: parcial, estado: 'error', leyendo: null, errorTexto: e.message }));
                }
            } else {
                const mensaje = e instanceof ErrorConexion ? e.message : 'No se pudo completar la respuesta.';
                actualizarAsistente((m) => ({ ...m, texto: parcial, estado: 'error', leyendo: null, errorTexto: mensaje }));
            }
        } finally {
            if (abortRef.current === ac) abortRef.current = null;
            enviandoRef.current = false;
            if (montadoRef.current) {
                setEnviando(false);
                // Lo que quedó sin volcar (el último trozo llegó entre un cuadro y el siguiente).
                actualizarAsistente((m) => (m.estado === 'en_curso' ? { ...m, estado: 'error', leyendo: null, errorTexto: 'Se cortó la conexión con el servidor' } : m));
            }
        }
        return resultado;
    }, [actualizarAsistente, cancelarVolcado, fijarConversacion, programarVolcado]);

    const detener = useCallback(() => { abortRef.current?.abort(); }, []);

    const nuevaConversacion = useCallback(() => {
        abortRef.current?.abort();
        cancelarVolcado();
        fijarConversacion(null);
        setMensajes([]);
        setAviso(null);
        setConversaciones(null);
    }, [cancelarVolcado, fijarConversacion]);

    const reintentar = useCallback(() => {
        if (enviandoRef.current) return;
        const ultimaPregunta = [...mensajes].reverse().find((m) => m.rol === 'usuario');
        const ultimo = mensajes[mensajes.length - 1];
        if (!ultimaPregunta || !ultimo || ultimo.rol !== 'asistente') return;
        setMensajes((prev) => prev.slice(0, -2));
        void enviar(ultimaPregunta.texto);
    }, [mensajes, enviar]);

    const cargarConversaciones = useCallback(async () => {
        try {
            const lista = await asistenteApi.conversaciones(10);
            if (montadoRef.current) setConversaciones(lista);
        } catch {
            if (montadoRef.current) setConversaciones([]);
        }
    }, []);

    const leerConversacion = useCallback(async (id: number, silencioso: boolean) => {
        abortRef.current?.abort();
        cancelarVolcado();
        try {
            const c = await asistenteApi.conversacion(id);
            if (!montadoRef.current) return;
            // Si mientras tanto se cambió de conversación (o se empezó una nueva), esta lectura ya no corresponde.
            if (silencioso && conversacionRef.current !== c.id) return;
            fijarConversacion(c.id);
            setAviso(null);
            const ultimo = c.mensajes.length - 1;
            setMensajes(c.mensajes.map((m, i) => ({
                ...m, clave: `s${m.id}`, fuentes: m.fuentes ?? [], acciones: m.acciones ?? [],
                ...(i === ultimo && m.rol === 'asistente' && m.estado === 'en_curso' ? { recuperada: true } : {}),
            })));
        } catch (e) {
            if (!silencioso) notifyRef.current.error(e as Error);
        }
    }, [cancelarVolcado, fijarConversacion]);

    const abrirConversacion = useCallback((id: number) => leerConversacion(id, false), [leerConversacion]);

    const actualizarConversacion = useCallback(() => {
        const id = conversacionRef.current;
        if (id) void leerConversacion(id, false);
    }, [leerConversacion]);

    // La última respuesta de la conversación abierta sigue `en_curso` en el servidor (otra pestaña, o se cortó el stream de esta).
    const respuestaPendiente = conversacionId !== null && !enviando
        && mensajes.length > 0 && mensajes[mensajes.length - 1].recuperada === true && mensajes[mensajes.length - 1].estado === 'en_curso';
    useEffect(() => {
        if (!respuestaPendiente || !abierto) return;
        const desde = Date.now();
        const h = setInterval(() => {
            if (Date.now() - desde >= RECARGAR_HASTA_MS) { clearInterval(h); return; }
            const id = conversacionRef.current;
            if (id && !enviandoRef.current) void leerConversacion(id, true);
        }, RECARGAR_CADA_MS);
        return () => clearInterval(h);
    }, [respuestaPendiente, abierto, conversacionId, leerConversacion]);

    const calificar = useCallback(async (mensajeId: number, valor: 1 | -1 | 0, comentario?: string) => {
        const anterior = mensajes.find((m) => m.id === mensajeId)?.calificacion ?? null;
        const nueva = valor === 0 ? null : valor;
        setMensajes((prev) => prev.map((m) => (m.id === mensajeId ? { ...m, calificacion: nueva } : m)));
        try {
            await asistenteApi.calificar(mensajeId, valor, comentario);
        } catch (e) {
            setMensajes((prev) => prev.map((m) => (m.id === mensajeId ? { ...m, calificacion: anterior } : m)));
            notifyRef.current.error(e as Error);
        }
    }, [mensajes]);

    const responderAccion = useCallback((mensajeId: number, accion: AccionIrA, resultado: 'aceptada' | 'rechazada') => {
        setMensajes((prev) => prev.map((m) => (m.id === mensajeId
            ? { ...m, acciones: m.acciones.map((a) => (a.id === accion.id ? { ...a, resultado } : a)) }
            : m)));
        if (resultado === 'aceptada') navigate(accion.ruta);
        // Que el servidor se entere es un registro: si falla, la persona igual ya decidió.
        asistenteApi.accion(mensajeId, accion.id, resultado).catch(() => undefined);
    }, [navigate]);

    const value = useMemo<AsistenteContextValue>(() => ({
        disponible, abierto, abrir, cerrar, alternar, mensajes, conversacionId, enviando, estado, bloqueo, aviso, enviar, detener,
        reintentar, nuevaConversacion, conversaciones, cargarConversaciones, abrirConversacion, actualizarConversacion, volverAProbar, calificar, responderAccion,
    }), [disponible, abierto, abrir, cerrar, alternar, mensajes, conversacionId, enviando, estado, bloqueo, aviso, enviar, detener,
        reintentar, nuevaConversacion, conversaciones, cargarConversaciones, abrirConversacion, actualizarConversacion, volverAProbar, calificar, responderAccion]);

    return <AsistenteContext.Provider value={value}>{children}</AsistenteContext.Provider>;
};

export const useAsistente = (): AsistenteContextValue => {
    const ctx = useContext(AsistenteContext);
    if (!ctx) throw new Error('useAsistente debe usarse dentro de <AsistenteProvider>');
    return ctx;
};
