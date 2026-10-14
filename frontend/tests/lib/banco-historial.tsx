// ImportHistory REAL contra un backend falso que cumple el contrato de §4.4 de docs/imports-progreso-c2-spec.md.
// El doble se comporta como el backend: `GET /import/historial` pagina, busca y devuelve por id descendente.
import React from 'react';
import ImportHistory from '@fe/pages/ImportHistory';
import type { HistorialItemDto, GrupoHistorialDto, HistorialRespuesta } from '@fe/types/importHistorial';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { ServidorFalso, type Pedido, type Respuesta } from './servidor-falso';
import { iso } from './fabricas';
import { esperar, iniciarSesion, limpio, montar, pasar, type Montado } from './montar';

export type Resp = Respuesta;

export interface BancoHistorial {
    srv: ServidorFalso;
    v: Montado;
    /** Todas las remesas de la empresa 1, en cualquier orden: el doble las pagina. */
    items: HistorialItemDto[];
    /** Cargas en curso que devuelve `GET /import/en-curso`. */
    enCurso: EstadoCargaDto[];
    /** Para dictar una respuesta distinta de `GET /import/historial` (error, demora, cuerpo viejo). `null` = la normal. */
    historial: ((p: Pedido) => Resp | Promise<Resp> | null) | null;
    cancelar: (id: number) => Resp | Promise<Resp>;
    cancelarGrupo: (gid: string) => Resp | Promise<Resp>;
    retomar: (id: number) => Resp | Promise<Resp>;
    retomarGrupo: (gid: string) => Resp | Promise<Resp>;
    confirmarPendientes: (ids: number[]) => Resp | Promise<Resp>;
    eliminar: (id: number) => Resp | Promise<Resp>;
    grupo: (gid: string) => Resp | Promise<Resp>;
    /** Publica un evento de socket y actualiza la carga que el doble tiene guardada. */
    pub: (evento: string, dto: EstadoCargaDto) => void;
    texto: () => string;
    consultasHistorial: (desde?: number) => number;
}

/** Con o sin query string. */
export const HISTORIAL = /^\/import\/historial(\?|$)/;

export function resumenDeGrupo(items: HistorialItemDto[], gid: string): GrupoHistorialDto {
    const del = items.filter((i) => i.carga.grupoId === gid);
    return {
        grupoId: gid,
        total: del[0]?.carga.grupoTotal ?? del.length,
        existentes: del.length,
        enCurso: del.filter((i) => i.carga.enCurso).length,
        cancelables: del.filter((i) => i.carga.cancelable).length,
        retomables: del.filter((i) => i.carga.retomable).length,
        finalizadas: del.filter((i) => i.carga.terminal && !i.carga.cancelada && i.carga.resultado !== 'FALLIDA').length,
        noCargadas: del.filter((i) => i.carga.terminal && (i.carga.cancelada || i.carga.resultado === 'FALLIDA')).length,
        usuarioId: del[0]?.carga.usuarioId ?? null,
    };
}

export function paginaDelHistorial(items: HistorialItemDto[], query: URLSearchParams): HistorialRespuesta {
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 25);
    const q = (query.get('q') ?? '').toLowerCase();
    const filtrados = items
        .filter((i) => q === '' || i.numeroRemesa.toLowerCase().includes(q) || i.nombre.toLowerCase().includes(q))
        .sort((a, b) => b.id - a.id);
    const data = filtrados.slice((page - 1) * pageSize, page * pageSize);
    const grupos: Record<string, GrupoHistorialDto> = {};
    for (const i of data) if (i.carga.grupoId) grupos[i.carga.grupoId] = resumenDeGrupo(items, i.carga.grupoId);
    return { data, total: filtrados.length, page, pageSize, totalPages: Math.max(1, Math.ceil(filtrados.length / pageSize)), grupos, servidorAhora: iso(Date.now()) };
}

interface Opciones {
    items: HistorialItemDto[];
    permisos?: string[];
    usuarioId?: number;
    ancho?: number;
    modo?: 'light' | 'dark';
    enCurso?: EstadoCargaDto[];
    aceptarSockets?: boolean;
    /** Modo estricto de React. Por defecto NO: con él el socket se reconecta con espera (~6 s) y cada prueba tarda eso de más. */
    estricto?: boolean;
    /** Antes de montar: para dictar respuestas. */
    antes?: (b: BancoHistorial) => void;
}

export const PERMISOS_COMPLETOS = [
    'importacion.ver_historial', 'importacion.ejecutar', 'importacion.eliminar', 'importacion.ver_progreso_otros',
    'consolidacion.ejecutar', 'deudores.acciones_masivas',
];

export async function armarHistorial(o: Opciones): Promise<BancoHistorial> {
    const srv = new ServidorFalso();
    if (o.aceptarSockets === false) srv.aceptarSockets = false;
    await srv.levantar();
    iniciarSesion(o.permisos ?? PERMISOS_COMPLETOS, o.usuarioId ?? 3);
    const b = { srv, items: [...o.items], enCurso: o.enCurso ?? [], historial: null } as unknown as BancoHistorial;
    b.cancelar = () => ({ status: 409, body: { message: 'no previsto' } });
    b.cancelarGrupo = () => ({ status: 404, body: { message: 'no previsto' } });
    b.retomar = () => ({ status: 409, body: { message: 'no previsto' } });
    b.retomarGrupo = () => ({ status: 409, body: { message: 'no previsto' } });
    b.confirmarPendientes = () => ({ status: 409, body: { message: 'no previsto' } });
    b.eliminar = (id) => { b.items = b.items.filter((i) => i.id !== id); return { body: { deleted: true } }; };
    b.grupo = (gid) => {
        const remesas = b.items.filter((i) => i.carga.grupoId === gid).map((i) => i.carga).sort((x, y) => (x.grupoOrden ?? 0) - (y.grupoOrden ?? 0));
        return remesas.length === 0 ? { status: 404, body: { message: 'El grupo no existe' } } : { body: { grupoId: gid, total: remesas[0].grupoTotal ?? remesas.length, remesas } };
    };
    b.pub = (evento, dto) => {
        b.items = b.items.map((i) => (i.id === dto.remesaId ? { ...i, carga: dto } : i));
        srv.emitir(evento, dto);
    };
    b.consultasHistorial = (desde = 0) => srv.cuantos('GET', HISTORIAL, desde);
    const json = (p: Pedido) => { try { return JSON.parse(p.cuerpo.toString('utf8') || '{}'); } catch { return {}; } };
    const consulta = (p: Pedido) => new URLSearchParams(p.ruta.split('?')[1] ?? '');

    srv.en('GET', /^\/import\/empresas$/, () => ({ body: [{ id: 1, nombre: 'Telecom' }, { id: 2, nombre: 'AYSA' }] }));
    srv.en('GET', /^\/politicas$/, () => ({ body: [{ id: 5, nombre: 'Política A', activa: true }] }));
    srv.en('GET', /^\/import\/en-curso$/, () => ({ body: b.enCurso }));
    srv.en('GET', /^\/import\/historial$/, async (_m, p) => {
        const dictada = b.historial ? await b.historial(p) : null;
        return dictada ?? { body: paginaDelHistorial(b.items, consulta(p)) };
    });
    srv.en('GET', /^\/import\/grupos\/([^/]+)$/, (m) => b.grupo(decodeURIComponent(m[1])));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/cancelar$/, (m) => b.cancelar(Number(m[1])));
    srv.en('POST', /^\/import\/grupos\/([^/]+)\/cancelar$/, (m) => b.cancelarGrupo(decodeURIComponent(m[1])));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/retomar$/, (m) => b.retomar(Number(m[1])));
    srv.en('POST', /^\/import\/grupos\/([^/]+)\/retomar$/, (m) => b.retomarGrupo(decodeURIComponent(m[1])));
    srv.en('POST', /^\/import\/remesas\/confirmar-pendientes$/, (_m, p) => b.confirmarPendientes(json(p).remesaIds ?? []));
    srv.en('DELETE', /^\/import\/remesas\/(\d+)$/, (m) => b.eliminar(Number(m[1])));
    srv.en('PUT', /^\/import\/remesas\/(\d+)\/politica$/, () => ({ body: {} }));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/revertir-acciones$/, () => ({ body: { deudoresRevertidos: 4, contactosRestaurados: 1, comentariosBorrados: 2 } }));
    o.antes?.(b);
    if (o.ancho) (await import('./ancho')).fijarAncho(o.ancho);
    b.v = await montar(<ImportHistory />, { conSocket: true, conNotificaciones: true, ruta: '/historial-importaciones', patron: '/historial-importaciones', modo: o.modo, estricto: o.estricto ?? false });
    b.texto = () => limpio(b.v.contenedor.textContent ?? '');
    await esperar(() => srv.sockets.size === 1 || o.aceptarSockets === false, { que: 'el socket' });
    // Deja asentarse el handshake de socket.io: bajar el servidor con uno a medias tarda ~6 s.
    await pasar(250);
    return b;
}

/** Espera a que la lista dibuje al menos una fila (o su estado vacío). */
export async function listaDibujada(b: BancoHistorial) {
    await esperar(() => b.v.contenedor.querySelector('tbody tr, .MuiCard-root, .MuiAlert-root') != null, { que: 'la lista del Historial' });
}
