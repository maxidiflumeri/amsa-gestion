// Banco de C1: el ImportWizard REAL contra un backend falso que cumple el contrato de §10.4.4
// (ejecutar-grupo, grupos/:id, cancelar, retomar, division-preview con `yaCargado`, alta con `repetir`).
import React from 'react';
import ImportWizard from '@fe/pages/ImportWizard';
import { ServidorFalso, type Pedido, type Respuesta } from './servidor-falso';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { dtoC1, enColaC1, iso } from './fabricas';
import { boton, clic, esperar, iniciarSesion, limpio, montar, pasar, type Montado } from './montar';
import { VALIDAR_OK, hastaElArchivo } from './wizard';

type Resp = Respuesta;
/** Una división del alta, como la manda el asistente. */
export interface DivisionAlta { valores: Record<string, string>; numeroRemesa?: string; filtros?: unknown[]; repetir?: boolean }

export interface BancoC1 {
    srv: ServidorFalso;
    v: Montado;
    estados: Record<number, EstadoCargaDto>;
    totales: Record<string, number>;
    /** `divisiones` de cada POST /import/remesas, ya parseadas. */
    altas: DivisionAlta[][];
    cortes: () => Array<Record<string, unknown>>;
    crear: (divisiones: DivisionAlta[], p: Pedido) => Resp | Promise<Resp>;
    validar: (id: number) => Resp | Promise<Resp>;
    ejecutar: (id: number, cuerpo: { remesaIds?: number[] }) => Resp | Promise<Resp>;
    ejecutarGrupo: (cuerpo: { remesaIds: number[] }) => Resp | Promise<Resp>;
    cancelar: (id: number) => Resp | Promise<Resp>;
    cancelarGrupo: (gid: string) => Resp | Promise<Resp>;
    retomar: (id: number) => Resp | Promise<Resp>;
    retomarGrupo: (gid: string) => Resp | Promise<Resp>;
    grupo: (gid: string) => Resp | Promise<Resp>;
    pub: (evento: string, dto: EstadoCargaDto) => void;
    texto: () => string;
    siguienteId: number;
    /** El corte de cada remesa en `GET /import/remesas/:id` (para seguir una división con ?seguir=). */
    cortesDeRemesa?: Record<number, string>;
}

export const CORTES_3 = () => [
    { valores: { 'Nómina': '3081' }, filas: 5000, numeroSugerido: '3081', filtros: [{ fromIndex: 3, operador: '=', valor: '3081' }] },
    { valores: { 'Nómina': '3082' }, filas: 4000, numeroSugerido: '3082', filtros: [{ fromIndex: 3, operador: '=', valor: '3082' }] },
    { valores: { 'Nómina': '3083' }, filas: 3000, numeroSugerido: '3083', filtros: [{ fromIndex: 3, operador: '=', valor: '3083' }] },
];

export function campoMultipart(p: Pedido, nombre: string): string | null {
    const s = p.cuerpo.toString('utf8');
    const m = new RegExp(`name="${nombre}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`).exec(s);
    return m ? m[1] : null;
}
const json = (p: Pedido) => { try { return JSON.parse(p.cuerpo.toString('utf8') || '{}'); } catch { return {}; } };

export async function armarBancoC1(o: { permisos?: string[]; usuarioId?: number; aceptarSockets?: boolean; ruta?: string; sembrar?: (b: BancoC1) => void } = {}): Promise<BancoC1> {
    const srv = new ServidorFalso();
    if (o.aceptarSockets === false) srv.aceptarSockets = false;
    await srv.levantar();
    iniciarSesion(o.permisos ?? ['importacion.ver_historial', 'importacion.ejecutar'], o.usuarioId ?? 3);
    const b = { srv, estados: {}, totales: {}, altas: [], siguienteId: 141 } as unknown as BancoC1;
    b.cortes = CORTES_3;
    b.crear = (divisiones) => {
        const ids = divisiones.length ? divisiones.map(() => b.siguienteId++) : [b.siguienteId++];
        ids.forEach((id, i) => { b.estados[id] = dtoC1({ remesaId: id, numeroRemesa: divisiones[i]?.numeroRemesa ?? String(id), fase: 'BORRADOR', enCurso: false, estadoProceso: 'VALIDANDO', rev: 1, procesadas: 0, ok: 0, err: 0, progreso: 0, totalEsperado: 5000, startedAt: null, heartbeatAt: null, encoladaAt: null }); });
        return { status: 201, body: divisiones.length ? { remesaIds: ids } : { remesaId: ids[0] } };
    };
    b.validar = () => ({ body: VALIDAR_OK });
    b.ejecutar = (id) => {
        b.estados[id] = enColaC1({ remesaId: id, numeroRemesa: b.estados[id]?.numeroRemesa ?? String(id), totalEsperado: 5000 });
        return { status: 201, body: { message: 'Importación encolada', remesaId: id, carga: b.estados[id] } };
    };
    let nGrupo = 0;
    b.ejecutarGrupo = (cuerpo) => {
        const gid = `grupo-${++nGrupo}`;
        const ids: number[] = [...cuerpo.remesaIds].sort((x: number, y: number) => x - y);
        b.totales[gid] = ids.length;
        ids.forEach((id, i) => { b.estados[id] = enColaC1({ remesaId: id, numeroRemesa: b.estados[id]?.numeroRemesa ?? String(id), totalEsperado: 5000, grupoId: gid, grupoOrden: i + 1, grupoTotal: ids.length, enColaDelante: i }); });
        return { status: 201, body: { message: 'ok', grupoId: gid, cargas: ids.map((id) => b.estados[id]) } };
    };
    b.grupo = (gid) => {
        const remesas = Object.values(b.estados).filter((e) => e.grupoId === gid).sort((x, y) => (x.grupoOrden ?? 0) - (y.grupoOrden ?? 0));
        if (remesas.length === 0) return { status: 404, body: { message: 'El grupo no existe' } };
        return { body: { grupoId: gid, total: b.totales[gid] ?? remesas.length, remesas: remesas.map((e) => ({ ...e, servidorAhora: iso(Date.now()) })) } };
    };
    b.cancelar = () => ({ status: 409, body: { message: 'no previsto' } });
    b.cancelarGrupo = () => ({ status: 404, body: { message: 'no previsto' } });
    b.retomar = () => ({ status: 409, body: { message: 'no previsto' } });
    b.retomarGrupo = () => ({ status: 409, body: { message: 'no previsto' } });
    b.pub = (evento, dto) => { b.estados[dto.remesaId] = dto; srv.emitir(evento, dto); };

    srv.en('GET', /^\/import\/empresas$/, () => ({ body: [{ id: 1, nombre: 'Telecom' }] }));
    srv.en('GET', /^\/import\/plantillas\/1\/DEUDORES$/, () => ({ body: [{ id: 7, nombre: 'Telecom deudores', version: 3, mappingJson: { divisionRemesa: { porNomina: { etiqueta: 'Nómina' } } } }] }));
    srv.en('POST', /^\/import\/remesas\/division-preview$/, () => ({ body: { cortes: b.cortes() } }));
    srv.en('POST', /^\/import\/remesas$/, (_m, p) => { const d = JSON.parse(campoMultipart(p, 'divisiones') ?? '[]'); b.altas.push(d); return b.crear(d, p); });
    srv.en('POST', /^\/import\/validar\/(\d+)$/, (m) => b.validar(Number(m[1])));
    srv.en('POST', /^\/import\/ejecutar\/(\d+)$/, (m, p) => b.ejecutar(Number(m[1]), json(p)));
    srv.en('POST', /^\/import\/ejecutar-grupo$/, (_m, p) => b.ejecutarGrupo(json(p)));
    srv.en('GET', /^\/import\/grupos\/([^/]+)$/, (m) => b.grupo(decodeURIComponent(m[1])));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/cancelar$/, (m) => b.cancelar(Number(m[1])));
    srv.en('POST', /^\/import\/grupos\/([^/]+)\/cancelar$/, (m) => b.cancelarGrupo(decodeURIComponent(m[1])));
    srv.en('POST', /^\/import\/remesas\/(\d+)\/retomar$/, (m) => b.retomar(Number(m[1])));
    srv.en('POST', /^\/import\/grupos\/([^/]+)\/retomar$/, (m) => b.retomarGrupo(decodeURIComponent(m[1])));
    srv.en('GET', /^\/import\/remesas\/(\d+)\/progreso$/, (m) => {
        const e = b.estados[Number(m[1])];
        return e ? { body: { ...e, servidorAhora: iso(Date.now()) } } : { status: 404, body: { message: 'No existe' } };
    });
    // El detalle de una remesa: lo pide el asistente al seguir una división (?seguir=) para mostrar el corte de cada una.
    srv.en('GET', /^\/import\/remesas\/(\d+)$/, (m) => {
        const id = Number(m[1]);
        return b.estados[id] ? { body: { id, corte: b.cortesDeRemesa?.[id] ?? null } } : { status: 404, body: { message: 'No existe' } };
    });
    o.sembrar?.(b);
    b.v = await montar(<ImportWizard />, { conSocket: true, ...(o.ruta ? { ruta: o.ruta } : {}) });
    b.texto = () => limpio(b.v.contenedor.textContent ?? '');
    return b;
}

/** Hasta el diálogo de cortes abierto. */
export async function hastaLosCortes(b: BancoC1) {
    await hastaElArchivo(b);
    await clic(boton('Ver los cortes del archivo'), 'Ver los cortes del archivo');
    await esperar(() => !!boton(/^Crear \d+ remesa/), { que: 'el diálogo de cortes' });
    await pasar(80);
}

/** Filas del diálogo de cortes: tilde, número y texto. */
export function filasDeCortes() {
    const dlg = Array.from(document.querySelectorAll('.MuiDialog-root')).find((d) => /El archivo trae varias asignaciones/.test(d.textContent ?? ''));
    if (!dlg) return [];
    return Array.from(dlg.querySelectorAll('tbody tr')).map((tr) => {
        const check = tr.querySelector('input[type="checkbox"]') as HTMLInputElement;
        const numero = tr.querySelector('input[type="text"]') as HTMLInputElement;
        return { tr, check, numero, tildado: check.checked, valor: numero.value, texto: limpio(tr.textContent ?? '') };
    });
}

/** Hasta la vista previa de una división (crea las N tildadas tal como vienen). */
export async function hastaLaVistaPreviaDividida(b: BancoC1) {
    await hastaLosCortes(b);
    await clic(boton(/^Crear \d+ remesa/), 'Crear N remesa(s)');
    await esperar(() => !!boton('Confirmar e importar'), { que: 'la vista previa' });
    await pasar(120);
}

export const POSTS_QUE_ARRANCAN = /^\/import\/(ejecutar\/\d+|ejecutar-grupo|validar\/\d+|remesas\/\d+\/retomar|grupos\/[^/]+\/retomar)$/;
