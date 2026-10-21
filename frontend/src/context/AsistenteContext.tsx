import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { asistenteApi, ErrorConexion, ErrorPregunta, preguntar } from '../api/asistente';
import type {
    AccionIrA, AdjuntoSubido, ConversacionResumen, DetalleRespuesta, EstadoAsistente, EventoAsistente, FuncionClave, MensajeAsistente, TarjetaPropuesta,
    TiemposNavegador,
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
    /** Lo que está haciendo antes de escribir: «Leyendo «…»…» o «Buscando en la documentación…». */
    actividad?: string | null;
    /** Por qué falló la respuesta (estado `error`); el texto parcial, si lo hubo, queda en `texto`. */
    errorTexto?: string;
    /** El error fue un tope: reintentar no tiene sentido. */
    errorDeTope?: boolean;
    /** El usuario cortó con «Detener». */
    detenido?: boolean;
    /** Vino de una conversación abierta y el servidor la tiene todavía `en_curso`: no hay un stream de esta pestaña escribiéndola. */
    recuperada?: boolean;
    /** Se escribió en esta sesión (no viene del historial): su tarjeta vigente pide la vista previa sola. */
    enVivo?: boolean;
}

/** Un ejemplo que la persona adjuntó y todavía no mandó (docs/asistente-reportes-spec.md §9, §16.1). */
export interface AdjuntoPendiente {
    clave: string;
    nombre: string;
    estado: 'subiendo' | 'listo' | 'error';
    /** 0 a 100, mientras sube. */
    progreso: number;
    adjunto?: AdjuntoSubido;
    /** El archivo, para poder reintentar si el servidor estaba ocupado. */
    archivo?: File;
    reintentable?: boolean;
    /** El mensaje del backend (o el de la validación local) cuando `estado` es `error`. */
    error?: string;
}

/** Cuántos ejemplos entran en un mensaje, y el tamaño máximo (el servidor es quien decide; esto evita subir de más). */
export const MAX_ADJUNTOS = 3;
export const MAX_BYTES_ADJUNTO = 5 * 1024 * 1024;
const CLAVE_MODO = 'amsa_asistente_modo';
/** El interruptor «Mostrar el detalle de las respuestas»: '0' apagado, cualquier otra cosa (o nada) encendido. */
const CLAVE_DETALLE = 'amsa_asistente_detalle';
/** El tope que acepta el servidor para un tiempo del navegador (docs/asistente-detalle-spec.md §6.1). */
const MAX_TIEMPO_NAVEGADOR_MS = 900_000;
/** El evento con el que el editor avisa que guardó la plantilla de una propuesta (la tarjeta pasa a «Guardada»). */
export const EVENTO_PROPUESTA_GUARDADA = 'asistente:propuesta-guardada';
/** El editor avisa que cargó la plantilla de una propuesta (detalle: `{ propuestaId }`). */
export const EVENTO_PROPUESTA_ABIERTA = 'asistente:propuesta-abierta';
export interface DetalleGuardada { propuestaId: number; plantillaId: number; /** El nombre con el que se guardó (puede haberse cambiado en el editor). */ nombre?: string }

/** Lo que impide preguntar: el compositor queda deshabilitado y el panel explica por qué. */
export interface Bloqueo { tipo: 'pausa' | 'limite'; mensaje: string }
/** Un aviso que no bloquea (otra pestaña con una pregunta en curso, conversación llena...). */
export interface Aviso { tipo: 'turno' | 'llena' | 'perdida' | 'permiso' | 'adjunto'; mensaje: string }

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
    enviar: (texto: string, reenvio?: MensajeAsistente['adjuntos']) => Promise<ResultadoEnvio>;
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
    /** En qué modo está el panel: la ayuda o el constructor de reportes (docs/asistente-reportes-spec.md D-13). */
    modo: FuncionClave;
    /** Tiene `asistente.reportes`, `reportes.crear` y `reportes.ver`, y el servidor no se lo negó. Sin esto no hay selector. */
    puedeArmarReportes: boolean;
    /** Cambia de modo y empieza una conversación nueva (una conversación es de una sola función). No hace nada si ya está en ese modo. */
    cambiarModo: (m: FuncionClave) => void;
    adjuntos: AdjuntoPendiente[];
    subirArchivos: (archivos: File[]) => void;
    /** Vuelve a subir un archivo que falló porque el servidor estaba ocupado. */
    reintentarAdjunto: (clave: string) => void;
    quitarAdjunto: (clave: string) => void;
    /** «La primera fila no es el encabezado» (o sí lo es): vuelve a perfilar el ejemplo. */
    marcarPrimeraFila: (clave: string, esEncabezado: boolean) => Promise<void>;
    /** Abre la propuesta en el editor (`/reportes/nuevo?propuesta=ID`), o la plantilla ya guardada. */
    abrirPropuesta: (p: TarjetaPropuesta) => void;
    /** Tiene `asistente.ver_detalle`: sin esto no hay desplegable en las respuestas ni interruptor en el menú (docs/asistente-detalle-spec.md §12). */
    verDetalle: boolean;
    /** El interruptor del menú del panel. Encendido por defecto; se recuerda en el navegador. Solo cuenta si `verDetalle`. */
    mostrarDetalle: boolean;
    alternarDetalle: () => void;
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
const MENSAJE_LIMITE_REPORTES = (limite: number) => `Llegaste al límite de ${limite} pedidos de reportes de hoy. Mañana se renueva.`;
/** De quién es el límite diario que se alcanzó: el general de la plataforma o el propio de la función (el 429 trae `LIMITE_DIARIO` o `LIMITE_FUNCION`). */
export type OrigenLimite = 'general' | 'funcion';
const bloqueoDe = (e: EstadoAsistente | null, origen: OrigenLimite): Bloqueo | null => {
    if (!e) return null;
    if (e.pausa) return { tipo: 'pausa', mensaje: e.pausa.mensaje };
    if (!e.habilitado) return { tipo: 'pausa', mensaje: 'amaIA está pausada por un administrador.' };
    if (e.limiteDiario.limite > 0 && e.limiteDiario.usadas >= e.limiteDiario.limite) {
        return { tipo: 'limite', mensaje: origen === 'funcion' ? MENSAJE_LIMITE_REPORTES(e.limiteDiario.limite) : MENSAJE_LIMITE(e.limiteDiario.limite) };
    }
    return null;
};

/** El modo que quedó de la última vez. `localStorage` puede tirar (ventana privada, datos bloqueados): se arranca en la ayuda. */
function leerModoGuardado(): FuncionClave {
    try { return localStorage.getItem(CLAVE_MODO) === 'reportes' ? 'reportes' : 'ayuda'; } catch { return 'ayuda'; }
}
function guardarModo(m: FuncionClave) {
    try { localStorage.setItem(CLAVE_MODO, m); } catch { /* sin almacenamiento: no se recuerda */ }
}

/** El interruptor del detalle que quedó de la última vez. `localStorage` puede tirar: se arranca encendido. */
function leerDetalleGuardado(): boolean {
    try { return localStorage.getItem(CLAVE_DETALLE) !== '0'; } catch { return true; }
}
function guardarDetalle(v: boolean) {
    try { localStorage.setItem(CLAVE_DETALLE, v ? '1' : '0'); } catch { /* sin almacenamiento: no se recuerda */ }
}

/** Los tiempos que midió el navegador, en enteros y dentro de lo que acepta el servidor (0 ≤ señales ≤ total ≤ 900.000). */
function tiemposDelNavegador(t0: number, primeraSenal: number | null, primerTexto: number | null, ahora: number): TiemposNavegador {
    const ms = (t: number) => Math.min(MAX_TIEMPO_NAVEGADOR_MS, Math.max(0, Math.round(t - t0)));
    const totalMs = ms(ahora);
    return {
        primeraSenalMs: primeraSenal === null ? null : Math.min(totalMs, ms(primeraSenal)),
        primerTextoMs: primerTexto === null ? null : Math.min(totalMs, ms(primerTexto)),
        totalMs,
    };
}

export const AsistenteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { tienePermiso } = useAuth();
    const disponible = tienePermiso('asistente.usar');
    // El servidor puede negar la función aunque el token todavía diga que sí (le sacaron el permiso con la sesión abierta).
    const [funcionNegada, setFuncionNegada] = useState(false);
    const puedeArmarReportes = disponible && !funcionNegada
        && tienePermiso('asistente.reportes') && tienePermiso('reportes.crear') && tienePermiso('reportes.ver');
    const [modoElegido, setModoElegido] = useState<FuncionClave>(leerModoGuardado);
    const modo: FuncionClave = puedeArmarReportes ? modoElegido : 'ayuda';
    const modoRef = useRef<FuncionClave>(modo);
    modoRef.current = modo;
    const verDetalle = disponible && tienePermiso('asistente.ver_detalle');
    const [mostrarDetalle, setMostrarDetalle] = useState<boolean>(leerDetalleGuardado);
    const mostrarDetalleRef = useRef(mostrarDetalle);
    mostrarDetalleRef.current = mostrarDetalle;
    const alternarDetalle = useCallback(() => {
        const nuevo = !mostrarDetalleRef.current;
        mostrarDetalleRef.current = nuevo;
        setMostrarDetalle(nuevo);
        guardarDetalle(nuevo);
    }, []);
    // Lo dice el 429 de la última pregunta, con el texto del backend. Sin él (el estado que pide el panel), el límite es el de la función del modo activo.
    const [limiteAlcanzado, setLimiteAlcanzado] = useState<{ mensaje: string; origen: OrigenLimite } | null>(null);
    const [adjuntos, setAdjuntos] = useState<AdjuntoPendiente[]>([]);
    const adjuntosRef = useRef<AdjuntoPendiente[]>([]);
    adjuntosRef.current = adjuntos;
    const secuenciaAdjunto = useRef(0);
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
        const deQuien = modo;
        try {
            const e = await asistenteApi.estado(deQuien);
            // Si mientras tanto se cambió de modo, ese estado es de la otra función.
            if (montadoRef.current && modoRef.current === deQuien) {
                setEstado(e);
                // El estado de la función de reportes no dice nada del límite general: si ese fue el 429, el cartel sigue hasta «Volver a probar».
                setLimiteAlcanzado((prev) => (prev && prev.origen === 'general' && deQuien === 'reportes' ? prev : null));
            }
        } catch {
            // Sin estado no se bloquea nada: si hay una pausa, el servidor la va a decir al preguntar.
        }
    }, [modo]);

    useEffect(() => {
        if (abierto && disponible) void cargarEstado();
    }, [abierto, disponible, cargarEstado]);

    const abrir = useCallback(() => setAbierto(true), []);
    const cerrar = useCallback(() => setAbierto(false), []);
    const alternar = useCallback(() => setAbierto((a) => !a), []);

    const bloqueo = useMemo<Bloqueo | null>(() => {
        const base = bloqueoDe(estado, modo === 'reportes' ? 'funcion' : 'general');
        if (base?.tipo === 'limite' && limiteAlcanzado) return { tipo: 'limite', mensaje: limiteAlcanzado.mensaje };
        if (!base && limiteAlcanzado) return { tipo: 'limite', mensaje: limiteAlcanzado.mensaje };
        return base;
    }, [estado, modo, limiteAlcanzado]);
    const hayBloqueo = bloqueo !== null;

    // Mientras el compositor está bloqueado (pausa, tope o límite) y el panel abierto, el cartel se va solo apenas se levanta.
    useEffect(() => {
        if (!hayBloqueo || !abierto || !disponible) return;
        const revisar = () => { void cargarEstado(); };
        const h = setInterval(revisar, REVISAR_BLOQUEO_MS);
        window.addEventListener('focus', revisar);
        return () => { clearInterval(h); window.removeEventListener('focus', revisar); };
    }, [hayBloqueo, abierto, disponible, cargarEstado]);

    const volverAProbar = useCallback(() => { setLimiteAlcanzado(null); void cargarEstado(); }, [cargarEstado]);

    /** El servidor negó la función de reportes: el selector se va, la conversación se descarta y queda el motivo. */
    const negarFuncion = useCallback((mensaje: string) => {
        setFuncionNegada(true);
        modoRef.current = 'ayuda';
        fijarConversacion(null);
        setMensajes([]);
        setAdjuntos([]);
        setEstado(null);
        setAviso({ tipo: 'permiso', mensaje });
    }, [fijarConversacion]);

    const enviar = useCallback(async (texto: string, reenvio?: MensajeAsistente['adjuntos']): Promise<ResultadoEnvio> => {
        const pregunta = texto.trim();
        if (!pregunta || enviandoRef.current) return 'ignorado';
        // El reloj de la persona: desde que apretó Enviar. Monotónico, no se ve afectado por un cambio de hora.
        const t0 = performance.now();
        let primeraSenal: number | null = null;
        let primerTexto: number | null = null;
        const modoDelEnvio = modoRef.current;
        const reportes = modoDelEnvio === 'reportes';
        // Los ejemplos listos viajan con la pregunta; los que todavía suben o fallaron se quedan en el compositor.
        const adjuntosDelEnvio = reportes ? (reenvio ?? []) : [];
        const pendientesEnviados = reportes && !reenvio ? adjuntosRef.current.filter((a) => a.estado === 'listo' && a.adjunto) : [];
        if (reportes && !reenvio && adjuntosRef.current.some((a) => a.estado === 'subiendo')) return 'ignorado';
        const idsAdjuntos = reenvio ? adjuntosDelEnvio.map((a) => a.id) : pendientesEnviados.map((a) => a.adjunto!.id);
        const adjuntosVista: MensajeAsistente['adjuntos'] = reenvio
            ? adjuntosDelEnvio
            : pendientesEnviados.map((a) => ({ id: a.adjunto!.id, nombre: a.adjunto!.nombre, tipo: a.adjunto!.tipo, columnas: a.adjunto!.resumen.columnas }));
        if (pendientesEnviados.length > 0) setAdjuntos((prev) => prev.filter((a) => !pendientesEnviados.some((x) => x.clave === a.clave)));
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
            { clave: `l${-idU}`, id: idU, rol: 'usuario', texto: pregunta, ruta, fuentes: [], acciones: [], estado: 'ok', calificacion: null, createdAt: ahora, pasos: [], propuestas: [], adjuntos: adjuntosVista },
            { clave: `l${-idA}`, id: idA, rol: 'asistente', texto: '', ruta: null, fuentes: [], acciones: [], estado: 'en_curso', calificacion: null, createdAt: ahora, actividad: null, pasos: [], propuestas: [], adjuntos: [], enVivo: true },
        ]);

        let accionesVivas: AccionIrA[] = [];
        let resultado: ResultadoEnvio = 'enviado';

        /** Lo que midió el navegador, a más tardar ahora: se pega al detalle de la burbuja y se manda al servidor (para todos, D-6). */
        const cerrarMedicion = (mensajeId: number | undefined): TiemposNavegador => {
            const nav = tiemposDelNavegador(t0, primeraSenal, primerTexto, performance.now());
            if (mensajeId && mensajeId > 0) asistenteApi.tiempos(mensajeId, nav).catch(() => undefined);
            return nav;
        };
        const conNavegador = (d: DetalleRespuesta | undefined, nav: TiemposNavegador): { detalle?: DetalleRespuesta } => (d ? { detalle: { ...d, navegador: nav } } : {});

        const alEvento = (e: EventoAsistente) => {
            if (!montadoRef.current) return;
            if (primeraSenal === null && ['texto', 'herramienta', 'paso', 'accion', 'propuesta'].includes(e.evento)) primeraSenal = performance.now();
            if (primerTexto === null && e.evento === 'texto') primerTexto = performance.now();
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
                    actualizarAsistente((m) => (m.actividad ? { ...m, actividad: null } : m));
                    programarVolcado();
                    break;
                case 'herramienta': {
                    const actividad = e.data.nombre === 'buscar_en_wiki' ? 'Buscando en la documentación…' : `Leyendo «${e.data.titulo}»…`;
                    actualizarAsistente((m) => ({ ...m, actividad }));
                    break;
                }
                case 'accion':
                    accionesVivas = [...accionesVivas, { ...e.data, resultado: null }];
                    break;
                case 'paso': {
                    const paso = e.data;
                    actualizarAsistente((m) => ({ ...m, pasos: [...m.pasos, paso], actividad: null }));
                    break;
                }
                case 'propuesta': {
                    const nueva = e.data;
                    const idActual = idAsistenteRef.current;
                    // Una versión nueva deja vieja a toda propuesta anterior de la conversación (solo la vigente muestra la vista previa).
                    setMensajes((prev) => prev.map((m) => {
                        if (m.rol !== 'asistente') return m;
                        const previas = m.propuestas.some((p) => p.vigente) ? m.propuestas.map((p) => ({ ...p, vigente: false })) : m.propuestas;
                        return m.id === idActual ? { ...m, propuestas: [...previas.filter((p) => p.propuestaId !== nueva.propuestaId), nueva], actividad: null } : { ...m, propuestas: previas };
                    }));
                    break;
                }
                case 'fin': {
                    cancelarVolcado();
                    textoRef.current = e.data.texto;
                    const fin = e.data;
                    const navFin = cerrarMedicion(fin.mensajeId);
                    actualizarAsistente((m) => ({
                        ...m, id: fin.mensajeId, texto: fin.texto, fuentes: fin.fuentes, acciones: fin.acciones ?? accionesVivas, estado: fin.estado, actividad: null,
                        pasos: fin.pasos ?? m.pasos, propuestas: fin.propuestas ?? m.propuestas, ...conNavegador(fin.detalle, navFin),
                    }));
                    idAsistenteRef.current = fin.mensajeId;
                    break;
                }
                case 'error': {
                    cancelarVolcado();
                    const tope = e.data.codigo === 'TOPE_MENSUAL' || e.data.codigo === 'TOPE_FUNCION';
                    const parcial = textoRef.current;
                    const idError = e.data.mensajeId;
                    const navError = cerrarMedicion(idError);
                    actualizarAsistente((m) => ({ ...m, id: idError ?? m.id, texto: parcial, estado: 'error', actividad: null, errorTexto: e.data.mensaje, errorDeTope: tope, ...conNavegador(e.data.detalle, navError) }));
                    if (idError) idAsistenteRef.current = idError;
                    if (e.data.codigo === 'PROMPT_DEMASIADO_GRANDE') {
                        // El ejemplo es demasiado grande y el turno cortó antes de llamar al modelo: reintentar igual daría lo mismo.
                        // El texto y los ejemplos vuelven al compositor para quitar el que sobra y mandar de nuevo.
                        resultado = 'rechazado';
                        actualizarAsistente((m) => ({ ...m, errorDeTope: true }));
                    }
                    if (tope) setEstado((s) => ({ habilitado: false, limiteDiario: s?.limiteDiario ?? { usadas: 0, limite: 0 }, pausa: { codigo: e.data.codigo as 'TOPE_MENSUAL' | 'TOPE_FUNCION', mensaje: e.data.mensaje } }));
                    break;
                }
            }
        };

        // Un rechazo previo al stream: no hubo `inicio`, así que el par todavía tiene los ids temporales.
        const quitarPar = () => setMensajes((prev) => prev.filter((m) => m.id !== idU && m.id !== idA));

        try {
            // En la ayuda el cuerpo es el de siempre: `funcion` y `adjuntos` solo viajan en el modo reportes.
            await preguntar({
                ...(conversacionRef.current ? { conversacionId: conversacionRef.current } : {}),
                pregunta,
                ruta,
                ...(reportes ? { funcion: 'reportes' as const, ...(idsAdjuntos.length > 0 ? { adjuntos: idsAdjuntos } : {}) } : {}),
            }, { onEvento: alEvento, signal: ac.signal });
        } catch (e) {
            cancelarVolcado();
            if (!montadoRef.current) return 'enviado';
            const parcial = textoRef.current;
            if ((e as { name?: string })?.name === 'AbortError') {
                actualizarAsistente((m) => ({ ...m, texto: parcial, estado: 'cortado', actividad: null, detenido: true }));
            } else if (e instanceof ErrorPregunta) {
                resultado = 'rechazado';
                // Se decide por `codigo` y no por el status: el backend manda PAUSADO y los topes como 429 (503 en versiones viejas).
                const codigoPausa = (['PAUSADO', 'TOPE_MENSUAL', 'TOPE_FUNCION'] as const).find((c) => c === e.codigo);
                if (codigoPausa || (e.status === 503 && e.codigo !== 'LIMITE_DIARIO')) {
                    quitarPar();
                    const codigo = codigoPausa ?? (e.codigo === 'SIN_WIKI' || e.codigo === 'SIN_PRECIO' ? e.codigo : 'PAUSADO');
                    const mensaje = !codigoPausa && e.message === MENSAJE_SIN_DATOS ? 'amaIA no está disponible en este momento. Probá en un rato.' : e.message;
                    setEstado((s) => ({ habilitado: false, limiteDiario: s?.limiteDiario ?? { usadas: 0, limite: 0 }, pausa: { codigo, mensaje } }));
                } else if (e.status === 429) {
                    quitarPar();
                    // El texto lo arma el backend según de qué límite se trate (LIMITE_FUNCION o el general LIMITE_DIARIO): nunca el modo activo.
                    const origen: OrigenLimite = e.codigo === 'LIMITE_FUNCION' ? 'funcion' : 'general';
                    const tope = e.limite ?? 0;
                    setLimiteAlcanzado({
                        origen,
                        mensaje: e.message !== MENSAJE_SIN_DATOS ? e.message : origen === 'funcion' ? MENSAJE_LIMITE_REPORTES(tope) : MENSAJE_LIMITE(tope),
                    });
                    setEstado((s) => ({ habilitado: s?.habilitado ?? true, pausa: s?.pausa ?? null, limiteDiario: { usadas: e.usadas ?? s?.limiteDiario.usadas ?? 0, limite: e.limite ?? s?.limiteDiario.limite ?? 0 } }));
                } else if (e.status === 409 && e.codigo === 'TURNO_EN_CURSO') {
                    quitarPar();
                    setAviso({ tipo: 'turno', mensaje: 'Ya tenés una pregunta en curso en otra pestaña.' });
                } else if (e.status === 409 && e.codigo === 'CONVERSACION_LLENA') {
                    quitarPar();
                    setAviso({ tipo: 'llena', mensaje: reportes ? e.message : 'Esta conversación llegó al máximo de preguntas. Empezá una nueva.' });
                } else if (e.status === 403 && e.codigo === 'SIN_PERMISO_FUNCION') {
                    // Le sacaron el permiso con la sesión abierta: el selector se va y queda el motivo.
                    quitarPar();
                    negarFuncion(e.message);
                } else if (e.status === 400 && e.codigo === 'ADJUNTO_INVALIDO') {
                    // Un ejemplo ya no sirve (ajeno, vencido, de otra conversación): el texto y los ejemplos vuelven al compositor para corregirlo.
                    quitarPar();
                    setAviso({ tipo: 'adjunto', mensaje: e.message });
                } else if (e.status === 409 && e.codigo === 'FUNCION_DISTINTA') {
                    // No debería pasar (el panel manda la función de la conversación): se sigue con una conversación nueva en este modo.
                    quitarPar();
                    fijarConversacion(null);
                    setMensajes([]);
                    setAviso({ tipo: 'perdida', mensaje: e.message !== MENSAJE_SIN_DATOS ? e.message : 'Esa conversación era de otro modo. Empezá una nueva.' });
                } else if (e.status === 404) {
                    quitarPar();
                    setAviso({ tipo: 'perdida', mensaje: 'Esa conversación ya no existe. Empezá una nueva.' });
                } else {
                    resultado = 'enviado';
                    actualizarAsistente((m) => ({ ...m, texto: parcial, estado: 'error', actividad: null, errorTexto: e.message }));
                }
            } else {
                const mensaje = e instanceof ErrorConexion ? e.message : 'No se pudo completar la respuesta.';
                actualizarAsistente((m) => ({ ...m, texto: parcial, estado: 'error', actividad: null, errorTexto: mensaje }));
            }
        } finally {
            if (abortRef.current === ac) abortRef.current = null;
            enviandoRef.current = false;
            if (montadoRef.current) {
                setEnviando(false);
                // Lo que quedó sin volcar (el último trozo llegó entre un cuadro y el siguiente).
                actualizarAsistente((m) => (m.estado === 'en_curso' ? { ...m, estado: 'error', actividad: null, errorTexto: 'Se cortó la conexión con el servidor' } : m));
            }
        }
        // Si el servidor no aceptó el mensaje, los ejemplos siguen siendo válidos: vuelven al compositor junto con el texto.
        if (resultado === 'rechazado' && pendientesEnviados.length > 0 && montadoRef.current && modoRef.current === modoDelEnvio) {
            setAdjuntos((prev) => [...pendientesEnviados, ...prev.filter((a) => !pendientesEnviados.some((x) => x.clave === a.clave))]);
        }
        return resultado;
    }, [actualizarAsistente, cancelarVolcado, fijarConversacion, negarFuncion, programarVolcado]);

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
        // Con ejemplos, se reenvían los mismos (ya están vinculados a la conversación y el servidor los acepta de nuevo).
        void enviar(ultimaPregunta.texto, ultimaPregunta.adjuntos?.length ? ultimaPregunta.adjuntos : undefined);
    }, [mensajes, enviar]);

    const cargarConversaciones = useCallback(async () => {
        try {
            const deQuien = modoRef.current;
            const lista = await asistenteApi.conversaciones(10, deQuien);
            // Una conversación es de una sola función: el menú muestra las del modo en el que está el panel.
            if (montadoRef.current) setConversaciones(lista.filter((c) => (c.funcion ?? 'ayuda') === deQuien));
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
                ...m, clave: `s${m.id}`, fuentes: m.fuentes ?? [], acciones: m.acciones ?? [], pasos: m.pasos ?? [], propuestas: m.propuestas ?? [], adjuntos: m.adjuntos ?? [],
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

    // ─── Fase B: modo, ejemplos adjuntos y propuestas ───────────────────────────────────────────────

    /** Descarta en el servidor un ejemplo que no se va a mandar (best effort: si falla, el barrido de 24 h lo limpia). */
    const descartarEnServidor = useCallback((a: AdjuntoPendiente) => {
        if (a.adjunto) asistenteApi.borrarAdjunto(a.adjunto.id).catch(() => undefined);
    }, []);

    const cambiarModo = useCallback((nuevo: FuncionClave) => {
        if (nuevo === modoRef.current) return;
        if (nuevo === 'reportes' && !puedeArmarReportes) return;
        abortRef.current?.abort();
        cancelarVolcado();
        modoRef.current = nuevo;
        setModoElegido(nuevo);
        guardarModo(nuevo);
        // Una conversación es de una sola función: se empieza otra. Los ejemplos de un modo no sirven en el otro.
        adjuntosRef.current.forEach(descartarEnServidor);
        setAdjuntos([]);
        fijarConversacion(null);
        setMensajes([]);
        setAviso(null);
        setConversaciones(null);
        setEstado(null);
        setLimiteAlcanzado(null);
    }, [cancelarVolcado, descartarEnServidor, fijarConversacion, puedeArmarReportes]);

    const actualizarPendiente = useCallback((clave: string, cambios: Partial<AdjuntoPendiente>) => {
        setAdjuntos((prev) => prev.map((a) => (a.clave === clave ? { ...a, ...cambios } : a)));
    }, []);

    const subirArchivos = useCallback((archivos: File[]) => {
        if (modoRef.current !== 'reportes') return;
        let ocupados = adjuntosRef.current.filter((a) => a.estado !== 'error').length;
        for (const archivo of archivos) {
            const clave = `a${++secuenciaAdjunto.current}`;
            const rechazo = ocupados >= MAX_ADJUNTOS
                ? `Se pueden adjuntar hasta ${MAX_ADJUNTOS} archivos por mensaje.`
                : archivo.size > MAX_BYTES_ADJUNTO ? `«${archivo.name}» pesa más de 5 MB: un ejemplo de formato no necesita tanto.` : null;
            if (rechazo) {
                setAdjuntos((prev) => [...prev, { clave, nombre: archivo.name, estado: 'error', progreso: 0, error: rechazo }]);
                continue;
            }
            ocupados++;
            setAdjuntos((prev) => [...prev, { clave, nombre: archivo.name, estado: 'subiendo', progreso: 0 }]);
            asistenteApi.subirAdjunto(archivo, (progreso) => { if (montadoRef.current) actualizarPendiente(clave, { progreso }); })
                .then((adjunto) => {
                    if (!montadoRef.current) return;
                    // Lo quitó (o cambió de modo) mientras subía: el archivo ya está en el servidor y no se va a mandar.
                    if (!adjuntosRef.current.some((a) => a.clave === clave)) {
                        asistenteApi.borrarAdjunto(adjunto.id).catch(() => undefined);
                        return;
                    }
                    // El servidor reconoce el mismo archivo y devuelve el mismo id: dos chips con el mismo id se pisarían al quitar uno.
                    if (adjuntosRef.current.some((a) => a.clave !== clave && a.adjunto?.id === adjunto.id)) {
                        actualizarPendiente(clave, { estado: 'error', error: `«${archivo.name}» ya está adjunto.` });
                        return;
                    }
                    actualizarPendiente(clave, { estado: 'listo', progreso: 100, adjunto });
                })
                .catch((e: unknown) => {
                    if (!montadoRef.current) return;
                    const respuesta = (e as { response?: { status?: number; data?: { codigo?: string; mensaje?: string | string[]; message?: string | string[] } } }).response;
                    const datos = respuesta?.data;
                    if (respuesta?.status === 403 && datos?.codigo === 'SIN_PERMISO_FUNCION') {
                        const m = datos.mensaje ?? datos.message;
                        negarFuncion(typeof m === 'string' ? m : Array.isArray(m) && m[0] ? m[0] : 'No tenés permiso para armar reportes con amaIA.');
                        return;
                    }
                    const crudo = datos?.mensaje ?? datos?.message;
                    const texto = Array.isArray(crudo) ? crudo[0] : crudo;
                    actualizarPendiente(clave, {
                        estado: 'error',
                        // 429 OCUPADO: el perfilado esperó 30 s y no hubo lugar. Se puede volver a intentar con el mismo archivo.
                        reintentable: respuesta?.status === 429 && datos?.codigo === 'OCUPADO',
                        archivo,
                        error: typeof texto === 'string' && texto.trim() ? texto : `No se pudo subir «${archivo.name}». Probá de nuevo.`,
                    });
                });
        }
    }, [actualizarPendiente, negarFuncion]);

    const reintentarAdjunto = useCallback((clave: string) => {
        const a = adjuntosRef.current.find((x) => x.clave === clave);
        if (!a?.archivo) return;
        setAdjuntos((prev) => prev.filter((x) => x.clave !== clave));
        adjuntosRef.current = adjuntosRef.current.filter((x) => x.clave !== clave);
        subirArchivos([a.archivo]);
    }, [subirArchivos]);

    const quitarAdjunto = useCallback((clave: string) => {
        const a = adjuntosRef.current.find((x) => x.clave === clave);
        setAdjuntos((prev) => prev.filter((x) => x.clave !== clave));
        if (a) descartarEnServidor(a);
    }, [descartarEnServidor]);

    const marcarPrimeraFila = useCallback(async (clave: string, esEncabezado: boolean) => {
        const a = adjuntosRef.current.find((x) => x.clave === clave);
        if (!a?.adjunto) return;
        actualizarPendiente(clave, { estado: 'subiendo', progreso: 100 });
        try {
            const nuevo = await asistenteApi.actualizarAdjunto(a.adjunto.id, esEncabezado);
            if (montadoRef.current) actualizarPendiente(clave, { estado: 'listo', adjunto: nuevo, error: undefined });
        } catch (e) {
            if (!montadoRef.current) return;
            actualizarPendiente(clave, { estado: 'listo' });
            notifyRef.current.error(e as Error);
        }
    }, [actualizarPendiente]);

    const abrirPropuesta = useCallback((p: TarjetaPropuesta) => {
        if (p.estado === 'guardada' && p.plantillaId) {
            navigate(`/reportes/${p.plantillaId}/editar`);
            return;
        }
        // La tarjeta pasa a «abierta» recién cuando el editor la cargó (EVENTO_PROPUESTA_ABIERTA): si la persona rechaza
        // reemplazar lo que tenía armado, no se abrió.
        navigate(`/reportes/nuevo?propuesta=${p.propuestaId}`);
    }, [navigate]);

    useEffect(() => {
        const alAbrir = (ev: Event) => {
            const d = (ev as CustomEvent<{ propuestaId: number }>).detail;
            if (!d) return;
            setMensajes((prev) => prev.map((m) => (m.propuestas?.some((x) => x.propuestaId === d.propuestaId && x.estado === 'mostrada')
                ? { ...m, propuestas: m.propuestas.map((x) => (x.propuestaId === d.propuestaId ? { ...x, estado: 'abierta' as const } : x)) }
                : m)));
        };
        window.addEventListener(EVENTO_PROPUESTA_ABIERTA, alAbrir);
        return () => window.removeEventListener(EVENTO_PROPUESTA_ABIERTA, alAbrir);
    }, []);

    // El editor avisa cuando se guardó la plantilla de una propuesta: la tarjeta pasa a «Guardada».
    useEffect(() => {
        const alGuardar = (ev: Event) => {
            const d = (ev as CustomEvent<DetalleGuardada>).detail;
            if (!d) return;
            setMensajes((prev) => prev.map((m) => (m.propuestas?.some((x) => x.propuestaId === d.propuestaId)
                ? { ...m, propuestas: m.propuestas.map((x) => (x.propuestaId === d.propuestaId ? { ...x, estado: 'guardada' as const, plantillaId: d.plantillaId, nombre: d.nombre?.trim() || x.nombre } : x)) }
                : m)));
        };
        window.addEventListener(EVENTO_PROPUESTA_GUARDADA, alGuardar);
        return () => window.removeEventListener(EVENTO_PROPUESTA_GUARDADA, alGuardar);
    }, []);

    const value = useMemo<AsistenteContextValue>(() => ({
        disponible, abierto, abrir, cerrar, alternar, mensajes, conversacionId, enviando, estado, bloqueo, aviso, enviar, detener,
        reintentar, nuevaConversacion, conversaciones, cargarConversaciones, abrirConversacion, actualizarConversacion, volverAProbar, calificar, responderAccion,
        modo, puedeArmarReportes, cambiarModo, adjuntos, subirArchivos, reintentarAdjunto, quitarAdjunto, marcarPrimeraFila, abrirPropuesta,
        verDetalle, mostrarDetalle, alternarDetalle,
    }), [disponible, abierto, abrir, cerrar, alternar, mensajes, conversacionId, enviando, estado, bloqueo, aviso, enviar, detener,
        reintentar, nuevaConversacion, conversaciones, cargarConversaciones, abrirConversacion, actualizarConversacion, volverAProbar, calificar, responderAccion,
        modo, puedeArmarReportes, cambiarModo, adjuntos, subirArchivos, reintentarAdjunto, quitarAdjunto, marcarPrimeraFila, abrirPropuesta,
        verDetalle, mostrarDetalle, alternarDetalle]);

    return <AsistenteContext.Provider value={value}>{children}</AsistenteContext.Provider>;
};

export const useAsistente = (): AsistenteContextValue => {
    const ctx = useContext(AsistenteContext);
    if (!ctx) throw new Error('useAsistente debe usarse dentro de <AsistenteProvider>');
    return ctx;
};
