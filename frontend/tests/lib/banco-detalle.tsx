// ImportDetail REAL en su ruta, contra el backend falso con los endpoints de C1.
import React from 'react';
import ImportDetail from '@fe/pages/ImportDetail';
import { ServidorFalso, type Respuesta } from './servidor-falso';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { T0, iso } from './fabricas';
import { esperar, iniciarSesion, limpio, montar, pasar, type Montado } from './montar';

type Resp = Respuesta;
export interface BancoDetalle {
    srv: ServidorFalso; v: Montado;
    estados: Record<number, EstadoCargaDto>; totales: Record<string, number>;
    cancelar: (id: number) => Resp | Promise<Resp>;
    cancelarGrupo: (gid: string) => Resp | Promise<Resp>;
    retomar: (id: number) => Resp | Promise<Resp>;
    grupo: (gid: string) => Resp | Promise<Resp>;
    progreso: (id: number) => Resp | Promise<Resp>;
    /** `GET /import/remesas/:id/reversion` (C3b). Por defecto 404: un backend anterior a C3b. */
    reversionGet: (id: number) => Resp | Promise<Resp>;
    /** `POST /import/remesas/:id/reversion` (C3b). */
    reversionPost: (id: number) => Resp | Promise<Resp>;
    pub: (evento: string, dto: EstadoCargaDto) => void;
    texto: () => string;
}

export async function armarDetalle(dto: EstadoCargaDto, o: { permisos?: string[]; usuarioId?: number; aceptarSockets?: boolean; otras?: EstadoCargaDto[]; esperarSocket?: boolean; antes?: (b: BancoDetalle) => void; remesa?: Record<string, unknown> } = {}): Promise<BancoDetalle> {
    const srv = new ServidorFalso();
    if (o.aceptarSockets === false) srv.aceptarSockets = false;
    await srv.levantar();
    iniciarSesion(o.permisos ?? ['importacion.ver_historial', 'importacion.ejecutar'], o.usuarioId ?? 3);
    const b = { srv, estados: { [dto.remesaId]: dto }, totales: {} } as unknown as BancoDetalle;
    for (const x of o.otras ?? []) b.estados[x.remesaId] = x;
    b.progreso = (id) => (b.estados[id] ? { body: { ...b.estados[id], servidorAhora: iso(Date.now()) } } : { status: 404, body: { message: 'No existe' } });
    b.grupo = (gid) => {
        const remesas = Object.values(b.estados).filter((e) => e.grupoId === gid).sort((x, y) => (x.grupoOrden ?? 0) - (y.grupoOrden ?? 0));
        if (remesas.length === 0) return { status: 404, body: { message: 'El grupo no existe' } };
        return { body: { grupoId: gid, total: b.totales[gid] ?? remesas.length, remesas } };
    };
    b.cancelar = () => ({ status: 409, body: { message: 'no previsto' } });
    b.cancelarGrupo = () => ({ status: 404, body: { message: 'no previsto' } });
    b.retomar = () => ({ status: 409, body: { message: 'no previsto' } });
    b.reversionGet = () => ({ status: 404, body: { message: 'Ruta no prevista por el arnés' } });
    b.reversionPost = () => ({ status: 404, body: { message: 'Ruta no prevista por el arnés' } });
    b.pub = (evento, d) => { b.estados[d.remesaId] = d; srv.emitir(evento, d); };
    srv.en('GET', /^\/import\/remesas\/(\d+)\/progreso$/, (m) => b.progreso(Number(m[1])));
    srv.en('GET', /^\/import\/remesas\/(\d+)$/, (m) => {
        const e = b.estados[Number(m[1])];
        if (!e) return { status: 404, body: { message: 'No existe' } };
        return { body: {
            id: e.remesaId, numeroRemesa: e.numeroRemesa, nombre: 'Telecom septiembre', categoria: e.tipo, estadoProceso: e.estadoProceso,
            totalFilas: 14466, okFilas: e.ok, errFilas: e.err, fechaVencimiento: null, createdAt: iso(T0 - 200_000), updatedAt: iso(T0),
            empresa: { id: 10, nombre: 'Telecom' }, plantilla: { id: 7, nombre: 'Telecom deudores', categoria: e.tipo },
            usuarioCreador: { id: e.usuarioId, nombre: e.usuarioNombre, email: 'm@x' }, politica: null, tasaExitoPct: null, carga: e,
            ...(o.remesa ?? {}),
        } };
    });
    srv.en('GET', /^\/import\/errores\/(\d+)$/, () => ({ body: { data: [] } }));
    srv.en('GET', /^\/import\/grupos\/([^/]+)$/, (m) => b.grupo(decodeURIComponent(m[1])));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/cancelar$/, (m) => b.cancelar(Number(m[1])));
    srv.en('POST', /^\/import\/grupos\/([^/]+)\/cancelar$/, (m) => b.cancelarGrupo(decodeURIComponent(m[1])));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/retomar$/, (m) => b.retomar(Number(m[1])));
    srv.en('GET', /^\/import\/remesas\/(\d+)\/reversion$/, (m) => b.reversionGet(Number(m[1])));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/reversion$/, (m) => b.reversionPost(Number(m[1])));
    o.antes?.(b);
    b.v = await montar(<ImportDetail />, { conSocket: true, ruta: `/historial-importaciones/${dto.remesaId}`, patron: '/historial-importaciones/:id' });
    b.texto = () => limpio(b.v.contenedor.textContent ?? '');
    await esperar(() => (o.aceptarSockets === false || o.esperarSocket === false || srv.sockets.size === 1) && /Información general/.test(b.texto()) && srv.cuantos('GET', /progreso/) >= 1, { que: 'el detalle dibujado' });
    await pasar(350);
    return b;
}
