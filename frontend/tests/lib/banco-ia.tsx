// El asistente de ayuda REAL (AppShell con su botón, su panel y el contexto; la pantalla de consumo) contra el backend falso,
// que cumple el contrato de docs/asistente-spec.md §6. Se llama «ia» y no «asistente» porque `banco-asistente` es el del asistente de carga.
import React, { act, useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { transferableAbortController } from 'node:util';
import AppShell from '@fe/components/layout/AppShell/AppShell';
import AsistenteConsumo from '@fe/pages/asistente/AsistenteConsumo';
import ReportesHome from '@fe/pages/reportes/ReportesHome';
import { usePageMeta } from '@fe/context/PageMetaContext';
import type {
    AccionIrA, AdjuntoSubido, ConfigAsistente, ConsumoAsistente, ConversacionDetalle, ConversacionResumen, EstadoAsistente, FuenteAyuda,
    FilaMapeo, Paso, TarjetaPropuesta, VistaPreviaPropuesta,
} from '@fe/types/asistente';
import { evento, multipart, ServidorFalso, type Pedido, type Respuesta } from './servidor-falso';
import { fijarAncho } from './ancho';
import { boton, clic, esperar, iniciarSesion, limpio, montar, pasar, type Montado } from './montar';

export const PREGUNTAR = /^\/asistente\/preguntar$/;
export const ESTADO = /^\/asistente\/estado$/;
export const CALIFICACION = /^\/asistente\/mensajes\/(\d+)\/calificacion$/;
export const ACCION = /^\/asistente\/mensajes\/(\d+)\/accion$/;
export const PATCH_CONFIG = /^\/asistente\/config$/;
export const PATCH_FUNCION = /^\/asistente\/funciones\/([^/]+)$/;

/** Un usuario con el asistente y lo que hace falta para ver las sugerencias de Gestión. */
export const PERMISOS_IA = ['asistente.usar', 'deudores.ver', 'promesas.crear', 'convenios.generar_cupon', 'reportes.ver', 'reportes.crear'];
export const PERMISOS_ADMIN_IA = [...PERMISOS_IA, 'asistente.administrar'];
/** Además puede armar reportes con el asistente (Fase B, D-2): `asistente.reportes` + `reportes.crear` + `reportes.ver`. */
export const PERMISOS_REPORTES_IA = [...PERMISOS_IA, 'asistente.reportes'];
export const ADJUNTOS = /^\/asistente\/adjuntos$/;
export const ADJUNTO = /^\/asistente\/adjuntos\/(\d+)$/;
export const VISTA_PREVIA = /^\/asistente\/propuestas\/(\d+)\/vista-previa$/;
export const PLANTILLA_DE_PROPUESTA = /^\/asistente\/propuestas\/(\d+)\/plantilla$/;

const TITULOS: Record<string, string> = { '/': 'Inicio', '/gestion': 'Gestión', '/reportes/nuevo': 'Nueva plantilla de reportes', '/reportes': 'Reportes' };

// ─── jsdom y el AbortSignal de fetch ─────────────────────────────────────────────────────────────────
// El fetch de Node (undici) no acepta el AbortSignal de jsdom, que es el global dentro de los tests. Se le pasa uno de Node
// enlazado al de jsdom: abortar uno aborta el otro, igual que en el navegador.
let fetchEnlazado = false;
export function instalarFetchConAbort() {
    if (fetchEnlazado) return;
    fetchEnlazado = true;
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
        const senal = init?.signal;
        if (!senal) return original(entrada, init);
        const nodo = transferableAbortController();
        if (senal.aborted) nodo.abort();
        else senal.addEventListener('abort', () => nodo.abort(), { once: true });
        return original(entrada, { ...init, signal: nodo.signal });
    }) as typeof fetch;
}

// ─── Fábricas del contrato (§6.3 y §6.4) ─────────────────────────────────────────────────────────────
export type EventoSse = [nombre: string, data: unknown];

export const ev = {
    inicio: (over: Record<string, unknown> = {}): EventoSse => ['inicio', { conversacionId: 7, mensajeUsuarioId: 101, mensajeId: 102, limiteDiario: { usadas: 4, limite: 100 }, ...over }],
    texto: (delta: string): EventoSse => ['texto', { delta }],
    herramienta: (slug: string, titulo: string): EventoSse => ['herramienta', { nombre: 'leer_pagina', slug, titulo }],
    busqueda: (): EventoSse => ['herramienta', { nombre: 'buscar_en_wiki' }],
    accion: (over: Partial<AccionIrA> = {}): EventoSse => ['accion', { id: 'toolu_1', tipo: 'ir_a', ruta: '/reportes/nuevo', etiqueta: 'Nueva plantilla de reportes', motivo: 'crear una plantilla de reportes', ...over }],
    fin: (texto: string, over: Record<string, unknown> = {}): EventoSse => ['fin', { mensajeId: 102, estado: 'ok', texto, fuentes: [], acciones: [], ms: 900, ...over }],
    paso: (tipo: Paso['tipo'], texto: string, estado: Paso['estado'] = 'ok'): EventoSse => ['paso', { tipo, estado, texto }],
    propuesta: (over: Partial<TarjetaPropuesta> = {}): EventoSse => ['propuesta', tarjeta(over)],
    error: (over: Record<string, unknown> = {}): EventoSse => ['error', { codigo: 'MODELO_NO_DISPONIBLE', mensaje: 'El asistente no está disponible en este momento. Probá en un rato.', ...over }],
};
export const accionIrA = (over: Partial<AccionIrA> = {}): AccionIrA => ({ id: 'toolu_1', tipo: 'ir_a', ruta: '/reportes/nuevo', etiqueta: 'Nueva plantilla de reportes', motivo: 'crear una plantilla de reportes', resultado: null, ...over });
export const fuente = (slug = 'reportes/armar-un-reporte', titulo = 'Armar un reporte'): FuenteAyuda => ({ slug, titulo });

// ─── Fase B: ejemplos adjuntos y propuestas (docs/asistente-reportes-spec.md §6.4) ───────────────────
export function adjuntoIA(over: Partial<AdjuntoSubido> = {}): AdjuntoSubido {
    return {
        id: 501, nombre: 'ejemplo_cartera.xlsx', tipo: 'xlsx', bytes: 18_400,
        resumen: { hojas: [{ nombre: 'Hoja1', filas: 4, usada: true }], columnas: 9, filasDatos: 3, conEncabezado: true, anchoFijo: false, encabezados: ['DNI', 'Cliente', 'Saldo'] },
        avisos: [],
        ...over,
    };
}

export const mapeoIA = (over: Partial<FilaMapeo> = {}): FilaMapeo => ({
    columnaEjemplo: 'DNI', label: 'DNI', estado: 'exacta', nota: '', saleDe: 'Documento', formato: null, ...over,
});

/** Una tarjeta con las cuatro situaciones del mapeo. */
export function tarjeta(over: Partial<TarjetaPropuesta> = {}): TarjetaPropuesta {
    return {
        propuestaId: 31, prueba: 'p-1', version: 1, nombre: 'Cartera Toyota +90', descripcion: null, empresa: 'TOYOTA', formato: 'xlsx', opciones: [],
        mapeo: [
            mapeoIA(),
            mapeoIA({ columnaEjemplo: 'Saldo', label: 'Saldo', saleDe: 'Saldo pendiente', formato: '2 decimales, coma' }),
            mapeoIA({ columnaEjemplo: 'Teléfono', label: 'Teléfono', estado: 'aproximada', nota: 'El 2.º teléfono no es el principal', saleDe: 'Teléfono / email / dirección · 2.º teléfono' }),
            mapeoIA({ columnaEjemplo: 'Observaciones', label: 'Observaciones', estado: 'sin_campo', nota: '', saleDe: 'Columna vacía' }),
            mapeoIA({ columnaEjemplo: null, label: 'Días de mora', estado: 'agregada', saleDe: 'Vencimiento', formato: 'Días desde el vencimiento' }),
        ],
        filtros: ['Empresa: TOYOTA', 'Vencimiento: hasta hace 90 días (hoy, 21/07/2026)'], orden: [],
        casos: 8412, casosAproximado: false, avisos: [], mensaje: 'Armé la plantilla igual a tu ejemplo.', sugerencias: [],
        estado: 'mostrada', plantillaId: null, vigente: true,
        ...over,
    };
}

export function vistaPreviaIA(over: Partial<VistaPreviaPropuesta> = {}): VistaPreviaPropuesta {
    return {
        columnas: ['DNI', 'Cliente', 'Saldo'],
        filas: [{ DNI: '··· 4521', Cliente: 'M. L. G.', Saldo: '$ 248.300,00' }, { DNI: '··· 1190', Cliente: 'A. P.', Saldo: '$ 91.750,50' }],
        casos: 8412,
        ...over,
    };
}

/** Una respuesta SSE que entrega cada evento por separado, con una pausa entre uno y otro. */
export function respuestaSse(eventos: EventoSse[], pausaMs = 30, extra: { cerrar?: boolean; destruir?: boolean } = {}): Respuesta {
    return { stream: { trozos: eventos.map(([n, d]) => evento(n, d)), pausaMs, ...extra } };
}
/** Una respuesta típica: inicio, el texto en trozos y el fin con ese mismo texto. */
export function respuestaNormal(trozos: string[], fin: Record<string, unknown> = {}, pausaMs = 30): Respuesta {
    return respuestaSse([ev.inicio(), ...trozos.map(ev.texto), ev.fin(trozos.join(''), fin)], pausaMs);
}

export function estadoIA(over: Partial<EstadoAsistente> = {}): EstadoAsistente {
    return { habilitado: true, pausa: null, limiteDiario: { usadas: 3, limite: 100 }, ...over };
}

export function consumoIA(over: Partial<ConsumoAsistente> = {}): ConsumoAsistente {
    return {
        mes: '2026-10', topeMensualUsd: 100, gastoUsd: 42, porcentaje: 42, proyeccionUsd: 91.5, pausa: null,
        totales: { preguntas: 1234, llamadas: 1900, usuarios: 12, costoPorPregunta: 0.0034, tasaCache: 0.87 },
        porFuncion: [{ funcion: 'ayuda', nombre: 'Ayuda y navegación', gastoUsd: 42, preguntas: 1234, topeUsd: null }],
        porUsuario: [{ usuarioId: 3, nombre: 'Maxi Di Flumeri', preguntas: 700, gastoUsd: 25.5 }, { usuarioId: 4, nombre: 'Ana Pérez', preguntas: 534, gastoUsd: 16.5 }],
        porDia: [{ dia: '2026-10-14', gastoUsd: 10.5, preguntas: 300 }, { dia: '2026-10-15', gastoUsd: 12, preguntas: 350 }],
        calidad: { positivas: 30, negativas: 10, sinCalificar: 1194, sinDocumentar: 7 },
        negativasRecientes: [{
            mensajeId: 55, fecha: '2026-10-15T15:00:00.000Z', usuario: 'Ana Pérez', pregunta: '¿Cómo anulo un cupón?', respuesta: 'Eso no está en la documentación.',
            comentario: 'Falta explicar cómo se anula', fuentes: [{ slug: 'gestion/cupones-de-pago', titulo: 'Cupones de pago' }],
        }],
        ...over,
    };
}

export function configIA(over: Partial<ConfigAsistente> = {}): ConfigAsistente {
    return {
        habilitado: true, topeMensualUsd: 100, avisoPorcentaje: 80, limiteDiarioUsuario: 100, topeTurnoUsd: 0.05, modelo: 'us.anthropic.claude-haiku-5-5',
        precios: {
            'us.anthropic.claude-haiku-5-5': {
                entrada: 0.11, salida: 0.55, cacheEscritura5m: 0.1375, cacheEscritura1h: 0.22, cacheLectura: 0.011, umbralLargo: 100000,
                largo: { entrada: 0.55, salida: 2.75, cacheEscritura5m: 0.6875, cacheEscritura1h: 1.1, cacheLectura: 0.055 },
            },
        },
        funciones: [{ clave: 'ayuda', nombre: 'Ayuda y navegación', habilitada: true, topeMensualUsd: null, modelo: 'us.anthropic.claude-haiku-5-5', topeTurnoUsd: null, limiteDiarioUsuario: null }],
        sinAdministradores: false,
        ...over,
    };
}

// ─── El banco ────────────────────────────────────────────────────────────────────────────────────────
type Resp = Respuesta | Promise<Respuesta>;
export interface BancoIA {
    srv: ServidorFalso;
    v: Montado;
    estado: EstadoAsistente;
    consumo: ConsumoAsistente;
    config: ConfigAsistente;
    conversaciones: ConversacionResumen[];
    detalles: Record<number, ConversacionDetalle>;
    /** Lo que contesta `POST /asistente/preguntar`. Se reemplaza por prueba; recibe el cuerpo y el número de pregunta (desde 1). */
    preguntar: (cuerpo: Record<string, unknown>, n: number, p: Pedido) => Resp;
    /** Cuántas veces se preguntó. */
    preguntas: number;
    /** Lo que contesta `POST /asistente/adjuntos`; recibe el archivo que llegó y el número de subida (desde 1). */
    subirAdjunto: (archivo: { campo: string; nombre: string; tipo: string; bytes: number } | null, n: number) => Resp;
    subidas: number;
    /** Lo que contesta `PATCH /asistente/adjuntos/:id`. */
    parchearAdjunto: (id: number, cuerpo: Record<string, unknown>) => Resp;
    /** Lo que contesta `GET /asistente/propuestas/:id/vista-previa`. */
    vistaPrevia: (id: number) => Resp;
    /** Lo que contesta `GET /asistente/propuestas/:id/plantilla`. */
    plantillaDePropuesta: (id: number) => Resp;
    /** Cuerpos JSON de los pedidos que coinciden (en orden). */
    cuerpos: (metodo: string, patron: RegExp) => Array<Record<string, unknown>>;
    texto: () => string;
}

interface Opciones {
    permisos?: string[];
    ancho?: number;
    modo?: 'light' | 'dark';
    ruta?: string;
    estado?: EstadoAsistente;
    consumo?: ConsumoAsistente;
    config?: ConfigAsistente;
    conversaciones?: ConversacionResumen[];
    detalles?: ConversacionDetalle[];
    estricto?: boolean;
    antes?: (b: BancoIA) => void;
}

const navegador: { ir: NavigateFunction | null } = { ir: null };
export async function irA(destino: string) {
    const ir = navegador.ir;
    if (!ir) throw new Error('El banco todavía no montó el router');
    await act(async () => { ir(destino); });
}

function Ubicacion() {
    navegador.ir = useNavigate();
    const { pathname, search } = useLocation();
    return <span data-testid="ruta" data-search={search}>{pathname}</span>;
}

/** Una pantalla cualquiera que pone su título en la barra, como hace `PageHeader`. */
function PantallaFalsa() {
    const { pathname } = useLocation();
    const { setPageMeta, clearPageMeta } = usePageMeta();
    useEffect(() => {
        setPageMeta({ title: TITULOS[pathname] ?? 'Otra pantalla' });
        return () => clearPageMeta();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);
    return <div data-testid="pantalla">PANTALLA {pathname}</div>;
}

export async function armarIA(o: Opciones = {}): Promise<BancoIA> {
    instalarFetchConAbort();
    if (o.ancho) fijarAncho(o.ancho);
    const srv = new ServidorFalso();
    await srv.levantar();
    iniciarSesion(o.permisos ?? PERMISOS_IA, 3);
    const b = {
        srv, estado: o.estado ?? estadoIA(), consumo: o.consumo ?? consumoIA(), config: o.config ?? configIA(),
        conversaciones: o.conversaciones ?? [], detalles: Object.fromEntries((o.detalles ?? []).map((d) => [d.id, d])), preguntas: 0,
    } as unknown as BancoIA;
    b.preguntar = () => respuestaNormal(['Respuesta de prueba.']);
    b.subidas = 0;
    b.subirAdjunto = (archivo) => ({ status: 201, body: adjuntoIA({ nombre: archivo?.nombre ?? 'ejemplo.xlsx', id: 500 + b.subidas }) });
    b.parchearAdjunto = (id, cuerpo) => ({ body: adjuntoIA({ id, resumen: { ...adjuntoIA().resumen, conEncabezado: cuerpo.primeraFilaEsEncabezado === true } }) });
    b.vistaPrevia = () => ({ body: vistaPreviaIA() });
    b.plantillaDePropuesta = (id) => ({ status: 404, body: { message: `Propuesta ${id} no prevista por el arnés` } });
    b.cuerpos = (metodo, patron) => srv.de(metodo, patron).map((p) => (p.cuerpo.length ? JSON.parse(p.cuerpo.toString('utf8')) : {}));

    srv.en('GET', ESTADO, () => ({ body: b.estado }));
    srv.en('GET', /^\/asistente\/conversaciones$/, () => ({ body: b.conversaciones }));
    srv.en('GET', /^\/asistente\/conversaciones\/(\d+)$/, (m) => (b.detalles[Number(m[1])] ? { body: b.detalles[Number(m[1])] } : { status: 404, body: { message: 'No existe' } }));
    srv.en('POST', PREGUNTAR, async (_m, p) => {
        b.preguntas++;
        const n = b.preguntas;
        const r = await b.preguntar(JSON.parse(p.cuerpo.toString('utf8')), n, p);
        if (!r.stream || n === 1) return r;
        // El backend real da ids nuevos a cada pregunta: la primera usa 101/102 y las siguientes, de a dos más.
        const salto = 2 * (n - 1);
        return { ...r, stream: { ...r.stream, trozos: r.stream.trozos.map((t) => t.replace(/"mensajeUsuarioId":101/g, `"mensajeUsuarioId":${101 + salto}`).replace(/"mensajeId":102/g, `"mensajeId":${102 + salto}`)) } };
    });
    srv.en('POST', ADJUNTOS, (_m, p) => { b.subidas++; return b.subirAdjunto(multipart(p).archivo, b.subidas); });
    srv.en('PATCH', ADJUNTO, (m, p) => b.parchearAdjunto(Number(m[1]), JSON.parse(p.cuerpo.toString('utf8'))));
    srv.en('DELETE', ADJUNTO, () => ({ status: 204 }));
    srv.en('GET', VISTA_PREVIA, (m) => b.vistaPrevia(Number(m[1])));
    srv.en('GET', PLANTILLA_DE_PROPUESTA, (m) => b.plantillaDePropuesta(Number(m[1])));
    srv.en('POST', CALIFICACION, () => ({ status: 204 }));
    srv.en('POST', ACCION, () => ({ status: 204 }));
    srv.en('GET', /^\/asistente\/consumo$/, () => ({ body: b.consumo }));
    srv.en('GET', PATCH_CONFIG, () => ({ body: b.config }));
    srv.en('PATCH', PATCH_CONFIG, (_m, p) => { b.config = { ...b.config, ...JSON.parse(p.cuerpo.toString('utf8')) }; return { body: b.config }; });
    srv.en('PATCH', PATCH_FUNCION, (m, p) => {
        const clave = decodeURIComponent(m[1]);
        const cambios = JSON.parse(p.cuerpo.toString('utf8'));
        b.config = { ...b.config, funciones: b.config.funciones.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)) };
        return { body: b.config.funciones.find((f) => f.clave === clave) };
    });
    // Lo que la barra y la campanita piden de fondo.
    srv.en('GET', /^\/import\/en-curso$/, () => ({ body: [] }));
    srv.en('GET', /^\/notificaciones$/, () => ({ body: { data: [], total: 0, limit: 20, offset: 0 } }));
    o.antes?.(b);

    b.v = await montar(
        <>
            <Ubicacion />
            <Routes>
                <Route element={<AppShell />}>
                    <Route path="asistente/consumo" element={<AsistenteConsumo />} />
                    <Route path="reportes-real" element={<ReportesHome />} />
                    <Route path="*" element={<PantallaFalsa />} />
                </Route>
            </Routes>
        </>,
        { conSocket: true, conNotificaciones: true, ruta: o.ruta ?? '/gestion', modo: o.modo, estricto: o.estricto },
    );
    b.texto = () => limpio(b.v.contenedor.textContent ?? '') + ' ' + limpio(document.body.textContent ?? '');
    await esperar(() => srv.sockets.size === 1, { que: 'el socket' });
    await pasar(150);
    return b;
}

export async function bajarIA(b: BancoIA | null) {
    if (!b) return;
    await b.v.desmontar();
    await b.srv.bajar();
}

// ─── Cosas que hace una persona ──────────────────────────────────────────────────────────────────────
export const rutaActual = () => document.querySelector('[data-testid="ruta"]')?.textContent ?? '';
/** El botón de la barra, sea el de texto (escritorio) o el de solo ícono (celular). */
export const botonAsistente = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.MuiAppBar-root button'))
    .find((x) => x.getAttribute('aria-label') === 'Asistente' || limpio(x.textContent ?? '') === 'Asistente') ?? null;
export const panel = () => document.querySelector<HTMLElement>('[role="complementary"][aria-label="Asistente"]');
export const entrada = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Tu pregunta"]');
export const botonEnviar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Enviar"]');
/** El panel está abierto: el modal (pantallas chicas) o el panel fijo (grandes) lo ocultan con `visibility: hidden` al cerrarlo. */
export function panelAbierto(): boolean {
    const p = panel();
    if (!p) return false;
    const paper = p.closest<HTMLElement>('.MuiDrawer-paper');
    if (!paper) return false;
    const modal = paper.closest<HTMLElement>('.MuiModal-root');
    if (modal) return getComputedStyle(modal).visibility !== 'hidden' && !modal.classList.contains('MuiModal-hidden');
    return getComputedStyle(paper).visibility !== 'hidden';
}
export async function abrirPanel() {
    await clic(botonAsistente(), 'el botón Asistente');
    await esperar(() => panelAbierto(), { que: 'el panel abierto' });
    await pasar(200);
}
export const burbujas = () => Array.from(document.querySelectorAll('[data-testid="burbuja-asistente"]')).map((e) => limpio(e.textContent ?? ''));
export const ultimaBurbuja = () => burbujas().at(-1) ?? '';

/** Escribe en el cuadro de la pregunta (un <textarea> controlado por React). */
export async function escribirPregunta(valor: string) {
    const t = entrada();
    if (!t) throw new Error('No está el cuadro de la pregunta');
    await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(t, valor);
        t.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
export async function teclaEnPregunta(key: string, shiftKey = false) {
    const t = entrada();
    if (!t) throw new Error('No está el cuadro de la pregunta');
    await act(async () => { t.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })); });
}
/** Escribe y aprieta «Enviar». */
export async function preguntarAlAsistente(texto: string) {
    await escribirPregunta(texto);
    await clic(botonEnviar(), 'Enviar');
}
export const botonDetener = () => boton('Detener');
export const alertasDelPanel = () => Array.from(panel()?.querySelectorAll('.MuiAlert-message') ?? []).map((a) => limpio(a.textContent ?? ''));
