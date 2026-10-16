// Inicio REAL (useMiDia + bloques + sockets) contra el backend falso, que cumple el contrato de docs/inicio-spec.md §5.3.
import React from 'react';
import Inicio from '@fe/pages/Inicio';
import type { AgendaItemDto, EjecucionResumenDto, GestionesDto, MiDiaDto, RetomarItemDto } from '@fe/api/inicio';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import type { Transaccion } from '@fe/types/auditoria';
import { ymdLocal } from '@fe/pages/inicio/formato';
import { ServidorFalso, type Pedido, type Respuesta } from './servidor-falso';
import { fijarAncho } from './ancho';
import { esperar, iniciarSesion, limpio, montar, pasar, type Montado } from './montar';

export const MI_DIA = /^\/inicio\/mi-dia$/;
export const TRANSACCIONES = /^\/transacciones(\?|$)/;

/** Los 13 permisos del rol OPERADOR de prod (docs/inicio-spec.md §1). */
export const PERMISOS_OPERADOR = [
    'deudores.ver', 'comentarios.ver', 'comentarios.crear', 'convenios.ver', 'empresas.ver', 'importacion.ver_historial',
    'plantillas_import.ver', 'parametros.ver', 'politicas.ver', 'reportes.ver', 'reportes.ejecutar', 'telefonia.usar', 'telefonia.click_to_call',
];
/** Un ADMIN: los del operador más lo que habilita el resto de los bloques. */
export const PERMISOS_ADMIN = [
    ...PERMISOS_OPERADOR, 'promesas.ver', 'convenios.crear', 'importacion.ejecutar', 'dashboards.ver', 'auditoria.ver', 'auditoria.ver_todos', 'importacion.ver_progreso_otros',
];

// ─── Fábricas del contrato ───────────────────────────────────────────────────────────────────────────
export const hoyYmd = () => ymdLocal();
/** 'YYYY-MM-DD' de hoy ± n días. */
export function dia(n: number): string {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n);
    return ymdLocal(d);
}
const haceMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export function gestiones(over: Partial<GestionesDto> = {}): GestionesDto {
    return {
        hoy: 38, casosHoy: 31, ayerALaMismaHora: { gestiones: 30, casos: 27 }, promedioALaMismaHora: 34, diasBase: 7,
        semana: { desde: dia(-4), gestiones: 120, casos: 98, diasConGestion: 4 },
        serie: Array.from({ length: 14 }, (_, i) => ({ dia: dia(i - 13), gestiones: 10 + i, casos: 8 + i })),
        truncado: false, ...over,
    };
}
export function retomar(n = 8): RetomarItemDto[] {
    return Array.from({ length: n }, (_, i) => ({
        deudorId: 100 + i, nombre: `Ana Pérez ${i}`, documento: `2000000${i}`, empresa: 'Telecom', ultimaGestion: haceMin(10 + i),
        ultimoTexto: `Quedó en llamar ${i}`, gestionesMias30d: 2 + i, estadoGestion: i % 2 === 0 ? 'Contactado' : null, estadoSituacion: 'Mora temprana',
    }));
}
export function itemAgenda(over: Partial<AgendaItemDto> = {}): AgendaItemDto {
    return {
        tipo: 'PROMESA', id: 1, deudorId: 500, nombre: 'Juan Gómez', documento: '30111222', empresa: 'AYSA', dia: hoyYmd(), monto: 46600,
        estado: 'VIGENTE', cerradaEn: null, nroCuota: null, cantCuotas: null, observacion: null, ...over,
    };
}
export function ejecucion(over: Partial<EjecucionResumenDto> = {}): EjecucionResumenDto {
    return { id: 1, plantilla: 'Pagos del mes', estado: 'FINALIZADA', progreso: 100, formato: 'xlsx', totalFilas: 1200, creadaEn: haceMin(30), terminadaEn: haceMin(28), descargable: true, ...over };
}

/** Lo que devuelve el backend a un OPERADOR: sin agenda ni promesas, importacionesHoy como arreglo vacío. */
export function miDiaOperador(over: Partial<MiDiaDto> = {}): MiDiaDto {
    return {
        generadoEn: new Date().toISOString(), hoy: hoyYmd(), errores: [], gestiones: gestiones(), retomar: retomar(), agenda: null, promesas: null,
        importacionesHoy: [], reportes: [ejecucion(), ejecucion({ id: 2, plantilla: 'Casos sin gestión', estado: 'FALLIDA', descargable: false })], ...over,
    };
}
/** Lo que devuelve a un ADMIN con todos los bloques. */
export function miDiaAdmin(over: Partial<MiDiaDto> = {}): MiDiaDto {
    const hoy = [
        itemAgenda({ id: 1, nombre: 'Juan Gómez' }),
        itemAgenda({ id: 2, deudorId: 501, nombre: 'María Ruiz', monto: 30000 }),
        itemAgenda({ id: 3, deudorId: 502, nombre: 'Luis Sosa', estado: 'CUMPLIDA', cerradaEn: haceMin(60) }),
        itemAgenda({ tipo: 'CUOTA', id: 9, deudorId: 503, nombre: 'Rosa Paz', monto: 12000, estado: 'PENDIENTE', nroCuota: 1, cantCuotas: 3 }),
    ];
    return {
        ...miDiaOperador(), agenda: {
            hoy, proximos: [itemAgenda({ id: 4, deudorId: 504, nombre: 'Pablo Gil', dia: dia(2) })], sinCumplir: [itemAgenda({ id: 5, deudorId: 505, nombre: 'Eva Luna', dia: dia(-1), estado: 'INCUMPLIDA' })],
            totales: { hoy: 4, proximos: 1, sinCumplir: 1 }, limite: 50, incluye: { promesas: true, cuotas: true },
        },
        promesas: { tomadas7d: 9, vencidas30d: { total: 9, cumplidas: 6 }, vencenHoy: { cantidad: 2, monto: 76600 } },
        importacionesHoy: [{ remesaId: 70, empresa: 'AYSA', nombre: 'Cartera octubre', numeroRemesa: '00070', resultado: 'CON_ERRORES', terminadaEn: haceMin(90), ok: 900, err: 12 }],
        ...over,
    };
}

export function transaccion(over: Partial<Transaccion> = {}): Transaccion {
    return {
        id: 1, createdAt: haceMin(5), usuarioId: 3, empresaId: null, modulo: 'GESTION', entidad: 'Comentario', entidadId: '1', tipo: 'CREATE', severidad: 'INFO', estado: 'OK',
        deudorId: null, recursoTexto: null, resumen: 'Cargó un comentario', data: null, ip: null, userAgent: null, usuario: { id: 3, nombre: 'Maxi', email: 'm@x' }, ...over,
    };
}

// ─── El banco ────────────────────────────────────────────────────────────────────────────────────────
export interface BancoInicio {
    srv: ServidorFalso;
    v: Montado;
    /** Cuerpo de `GET /inicio/mi-dia`. Cambiarlo cambia lo que contestan los pedidos siguientes. */
    miDia: MiDiaDto;
    /** Para dictar una respuesta distinta (error, demora). null = la normal. */
    dictar: ((p: Pedido) => Respuesta | Promise<Respuesta> | null) | null;
    enCurso: EstadoCargaDto[];
    transacciones: Transaccion[];
    descargas: number[];
    texto: () => string;
    pedidosMiDia: () => number;
    pedidosTransacciones: () => number;
}

interface Opciones {
    permisos?: string[];
    usuarioId?: number;
    miDia?: MiDiaDto;
    ancho?: number;
    modo?: 'light' | 'dark';
    enCurso?: EstadoCargaDto[];
    transacciones?: Transaccion[];
    estricto?: boolean;
    antes?: (b: BancoInicio) => void;
}

export async function armarInicio(o: Opciones = {}): Promise<BancoInicio> {
    if (o.ancho) fijarAncho(o.ancho);
    const srv = new ServidorFalso();
    await srv.levantar();
    iniciarSesion(o.permisos ?? PERMISOS_OPERADOR, o.usuarioId ?? 3);
    const b = { srv, miDia: o.miDia ?? miDiaOperador(), dictar: null, enCurso: o.enCurso ?? [], transacciones: o.transacciones ?? [transaccion()], descargas: [] } as unknown as BancoInicio;

    srv.en('GET', MI_DIA, async (_m, p) => (b.dictar ? await b.dictar(p) : null) ?? { body: { ...b.miDia, generadoEn: new Date().toISOString() } });
    srv.en('GET', TRANSACCIONES, () => ({ body: { total: b.transacciones.length, items: b.transacciones } }));
    srv.en('GET', /^\/reportes\/ejecuciones\/(\d+)\/descargar$/, (m) => {
        b.descargas.push(Number(m[1]));
        return { crudo: { tipo: 'application/octet-stream', contenido: 'a,b\n1,2\n' } };
    });
    srv.en('GET', /^\/import\/en-curso$/, () => ({ body: b.enCurso.map((d) => ({ ...d, servidorAhora: new Date().toISOString() })) }));
    srv.en('GET', /^\/notificaciones$/, () => ({ body: { data: [], total: 0, limit: 20, offset: 0 } }));
    srv.en('GET', /^\/deudores\/empresas$/, () => ({ body: [] }));
    o.antes?.(b);

    b.v = await montar(<Inicio />, { conSocket: true, conNotificaciones: true, ruta: '/', patron: '/', modo: o.modo, estricto: o.estricto });
    b.texto = () => limpio(b.v.contenedor.textContent ?? '');
    b.pedidosMiDia = () => srv.cuantos('GET', MI_DIA);
    b.pedidosTransacciones = () => srv.cuantos('GET', TRANSACCIONES);
    await esperar(() => srv.sockets.size === 1, { que: 'el socket' });
    await pasar(250);
    return b;
}

/** Los títulos de las tarjetas (h6) y de las secciones (h2) que la página dibuja. */
export const titulos = () => Array.from(document.querySelectorAll('h1, h2, h6, .MuiTypography-h6')).map((e) => limpio(e.textContent ?? ''));
/** Espera a que el primer pedido de `mi-dia` ya se haya pintado. */
export async function dibujado() {
    await esperar(() => document.querySelector('[role="progressbar"][aria-label="Cargando"]') === null && /Tu día/.test(document.body.textContent ?? ''), { que: 'Inicio dibujado' });
}
