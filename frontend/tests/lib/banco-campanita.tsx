// La campanita REAL (NotificacionesBell + NotificacionesProvider + sockets) contra el backend falso.
// Las fábricas son propias del paquete B de C2b: no viven en `fabricas.ts`.
import React, { act } from 'react';
import { Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import NotificacionesBell from '@fe/components/layout/AppShell/NotificacionesBell';
import ImportEnCursoItem from '@fe/components/layout/AppShell/ImportEnCursoItem';
import { NotificacionesProvider, useNotificaciones } from '@fe/context/NotificacionesContext';
import { useAuth } from '@fe/context/AuthContext';
import type { NotificacionDto } from '@fe/api/notificaciones';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { ServidorFalso, type Pedido, type Respuesta } from './servidor-falso';
import { dtoC1, dtoFaseB, iso, terminal, T0, type Sobre } from './fabricas';
import { fijarAncho } from './ancho';
import { boton, clic, esperar, iniciarSesion, limpio, montar, pasar, type Montado } from './montar';

export const EN_CURSO = /^\/import\/en-curso$/;
export const CONTADOR = /^\/notificaciones\/contador$/;
export const TODOS = ['importacion.ver_historial', 'importacion.ejecutar', 'importacion.ver_progreso_otros'];

// ─── Fábricas de cargas ──────────────────────────────────────────────────────────────────────────────
export const corriendo = (id: number, over: Sobre = {}): EstadoCargaDto =>
    dtoFaseB({ remesaId: id, numeroRemesa: `00${id}`, usuarioId: id, usuarioNombre: `U${id}`, rev: 10, ...over });
export const enCola = (id: number, delante: number, over: Sobre = {}): EstadoCargaDto =>
    dtoFaseB({ remesaId: id, numeroRemesa: `00${id}`, usuarioId: id, usuarioNombre: `U${id}`, fase: 'EN_COLA', rev: 2, startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: delante, ...over });
export const finalizada = (id: number, rev = 99): EstadoCargaDto => terminal('OK', { remesaId: id, numeroRemesa: `00${id}`, usuarioId: id, rev });
/** Una carga de C1 (con `cancelable`, grupo, etc.) de la campanita, del usuario 3 salvo que se diga otra cosa. */
export const cargaC1 = (id: number, over: Sobre = {}): EstadoCargaDto =>
    dtoC1({ remesaId: id, numeroRemesa: `00${id}`, usuarioId: 3, usuarioNombre: 'Maxi', rev: 10, ...over });

// ─── Fábrica de notificaciones ───────────────────────────────────────────────────────────────────────
let secuencia = 500;
export function notificacion(over: Partial<NotificacionDto> = {}): NotificacionDto {
    const id = over.id ?? ++secuencia;
    return {
        id, tipo: 'IMPORTACION_FINALIZADA', titulo: 'Importación finalizada', mensaje: 'La remesa 00141 terminó.',
        payload: { resultado: 'CON_ERRORES', err: 12 }, rutaAccion: '/historial-importaciones/141', leida: false,
        creadoEn: iso(T0), entidadTipo: 'REMESA', entidadId: 141, ...over,
    };
}

// ─── Lista mínima de la campanita (sin barra superior) ───────────────────────────────────────────────
export const entrarRef: { login: ((idToken: string) => Promise<void>) | null } = { login: null };
export function ListaEnCurso() {
    const { importsEnCurso, noLeidas } = useNotificaciones();
    entrarRef.login = useAuth().login;
    return (
        <div>
            <span data-testid="no-leidas">{noLeidas}</span>
            {importsEnCurso.map((c) => <div key={c.remesaId} data-remesa={c.remesaId}><ImportEnCursoItem carga={c} /></div>)}
        </div>
    );
}
export const itemEnCurso = (id: number) => limpio(document.querySelector(`[data-remesa="${id}"]`)?.textContent ?? '(no está)');
export const idsEnCurso = () => Array.from(document.querySelectorAll('[data-remesa]')).map((e) => Number(e.getAttribute('data-remesa')));
export const noLeidasMostradas = () => Number(document.querySelector('[data-testid="no-leidas"]')?.textContent);

// ─── Banco con la barra: campanita + chip + rutas ────────────────────────────────────────────────────
type Resp = Respuesta | Promise<Respuesta>;
export interface BancoCampanita {
    srv: ServidorFalso;
    v: Montado;
    enCurso: EstadoCargaDto[];
    notificaciones: NotificacionDto[];
    noLeidas: number;
    /** Estado "real" de cada remesa que contesta `GET remesas/:id/progreso` (404 si no está). */
    estados: Record<number, EstadoCargaDto>;
    totales: Record<string, number>;
    retomar: (id: number) => Resp;
    cancelar: (id: number) => Resp;
    cancelarGrupo: (gid: string) => Resp;
    csv: (id: number, p: Pedido) => Resp;
    pub: (evento: string, dto: EstadoCargaDto) => void;
    texto: () => string;
}

interface Opciones {
    permisos?: string[];
    usuarioId?: number;
    ancho?: number;
    modo?: 'light' | 'dark';
    aceptarSockets?: boolean;
    enCurso?: EstadoCargaDto[];
    notificaciones?: NotificacionDto[];
    estados?: EstadoCargaDto[];
    ruta?: string;
    antes?: (b: BancoCampanita) => void;
}

function Ubicacion() {
    navegador.ir = useNavigate();
    const { pathname, search } = useLocation();
    return (
        <>
            <span data-testid="ruta">{pathname}</span>
            <span data-testid="ruta-busqueda">{search}</span>
        </>
    );
}
/** Para cambiar de ruta desde la prueba sin pasar por la campanita (un enlace de la página, el «atrás» del navegador). */
export const navegador: { ir: NavigateFunction | null } = { ir: null };
export async function irA(destino: string | number) {
    if (!navegador.ir) throw new Error('El banco todavía no montó el router');
    const ir = navegador.ir;
    await act(async () => { if (typeof destino === 'number') ir(destino); else ir(destino); });
}

export async function armarCampanita(o: Opciones = {}): Promise<BancoCampanita> {
    if (o.ancho) fijarAncho(o.ancho);
    const srv = new ServidorFalso();
    if (o.aceptarSockets === false) srv.aceptarSockets = false;
    await srv.levantar();
    iniciarSesion(o.permisos ?? TODOS, o.usuarioId ?? 3);
    const b = { srv, enCurso: o.enCurso ?? [], notificaciones: o.notificaciones ?? [], noLeidas: 0, estados: {}, totales: {} } as unknown as BancoCampanita;
    for (const e of o.estados ?? []) b.estados[e.remesaId] = e;
    b.noLeidas = b.notificaciones.filter((n) => !n.leida).length;
    b.retomar = () => ({ status: 409, body: { message: 'no previsto' } });
    b.cancelar = () => ({ status: 409, body: { message: 'no previsto' } });
    b.cancelarGrupo = () => ({ status: 404, body: { message: 'no previsto' } });
    b.csv = () => ({ status: 404, body: { message: 'no previsto' } });
    // Publicar un evento también mueve lo que contesta `GET /import/en-curso`: la campanita re-hidrata contra él.
    b.pub = (evento, dto) => {
        b.estados[dto.remesaId] = dto;
        b.enCurso = b.enCurso.filter((e) => e.remesaId !== dto.remesaId);
        if (dto.enCurso) b.enCurso.push(dto);
        srv.emitir(evento, dto);
    };

    srv.en('GET', EN_CURSO, () => ({ body: b.enCurso.map((d) => ({ ...d, servidorAhora: iso(Date.now()) })) }));
    srv.en('GET', CONTADOR, () => ({ body: { noLeidas: b.noLeidas } }));
    srv.en('GET', /^\/notificaciones$/, (_m, p) => {
        const q = new URLSearchParams(p.ruta.split('?')[1] ?? '');
        const lista = b.notificaciones.filter((n) => (q.get('soloNoLeidas') === 'true' ? !n.leida : q.get('soloLeidas') === 'true' ? n.leida : true));
        const offset = Number(q.get('offset') ?? 0); const limit = Number(q.get('limit') ?? 20);
        return { body: { data: lista.slice(offset, offset + limit), total: lista.length, limit, offset } };
    });
    srv.en('POST', /^\/notificaciones\/(\d+)\/leer$/, (m) => {
        const n = b.notificaciones.find((x) => x.id === Number(m[1]));
        if (n && !n.leida) { n.leida = true; b.noLeidas = Math.max(0, b.noLeidas - 1); }
        return { status: 201, body: {} };
    });
    srv.en('POST', /^\/notificaciones\/leer-todas$/, () => { b.notificaciones.forEach((n) => { n.leida = true; }); b.noLeidas = 0; return { status: 201, body: {} }; });
    srv.en('GET', /^\/import\/remesas\/(\d+)\/progreso$/, (m) => (b.estados[Number(m[1])]
        ? { body: { ...b.estados[Number(m[1])], servidorAhora: iso(Date.now()) } }
        : { status: 404, body: { message: 'La remesa no existe' } }));
    srv.en('GET', /^\/import\/grupos\/([^/]+)$/, (m) => {
        const gid = decodeURIComponent(m[1]);
        const remesas = Object.values(b.estados).filter((e) => e.grupoId === gid).sort((x, y) => (x.grupoOrden ?? 0) - (y.grupoOrden ?? 0));
        return remesas.length === 0 ? { status: 404, body: { message: 'El grupo no existe' } } : { body: { grupoId: gid, total: b.totales[gid] ?? remesas.length, remesas } };
    });
    srv.en('POST', /^\/import\/remesas\/(\d+)\/retomar$/, (m) => b.retomar(Number(m[1])));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/cancelar$/, (m) => b.cancelar(Number(m[1])));
    srv.en('POST', /^\/import\/grupos\/([^/]+)\/cancelar$/, (m) => b.cancelarGrupo(decodeURIComponent(m[1])));
    srv.en('GET', /^\/import\/errores\/(\d+)\/csv$/, (m, p) => b.csv(Number(m[1]), p));
    o.antes?.(b);

    b.v = await montar(
        <>
            <NotificacionesBell />
            <Ubicacion />
            <Routes>
                <Route path="/pagina-a" element={<div data-testid="pagina-a">PAGINA A</div>} />
                <Route path="/historial-importaciones/:id" element={<div data-testid="detalle">DETALLE</div>} />
                <Route path="*" element={<div data-testid="otra-ruta">OTRA RUTA</div>} />
            </Routes>
        </>,
        { conSocket: true, conNotificaciones: true, ruta: o.ruta ?? '/pagina-a', modo: o.modo, estricto: false },
    );
    b.texto = () => limpio(b.v.contenedor.textContent ?? '');
    await esperar(() => srv.sockets.size === 1 || o.aceptarSockets === false, { que: 'el socket' });
    await pasar(250);
    return b;
}

export const ruta = () => document.querySelector('[data-testid="ruta"]')?.textContent ?? '';
/** La ruta con su query (`/carga?seguir=201`). */
export const rutaCompleta = () => ruta() + (document.querySelector('[data-testid="ruta-busqueda"]')?.textContent ?? '');
export const campanitaAbierta = () => document.querySelector('[role="dialog"], .MuiPopover-root') != null;
/** Abre la campanita con un clic en la campana y espera a que dibuje. */
export async function abrirCampanita() {
    await clic(boton(/^Notificaciones$/) ?? document.querySelector('button[aria-label="Notificaciones"]'), 'la campana');
    await esperar(() => campanitaAbierta(), { que: 'la campanita abierta' });
    await pasar(300);
}
