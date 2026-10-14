// C2a: la tarjeta de errores del detalle (FE-1 a FE-12).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErroresDeCarga from '@fe/components/import/ErroresDeCarga';
import * as descargas from '@fe/utils/descargas';
import type { ErrorDeCargaDto } from '@fe/types/importHistorial';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { ServidorFalso, type Pedido, type Respuesta } from '../lib/servidor-falso';
import { alertas, boton, clic, dialogo, esperar, iniciarSesion, limpio, montar, pasar, toasts, type Montado } from '../lib/montar';
import { BASURA, dtoC1, errorDeCarga, terminalC1 } from '../lib/fabricas';

vi.mock('@fe/utils/descargas', async (original) => ({ ...(await original<typeof import('@fe/utils/descargas')>()), descargarBlob: vi.fn() }));

const filasDe = (n: number, desde = 0): ErrorDeCargaDto[] => Array.from({ length: n }, (_, i) => errorDeCarga({ id: desde + i + 1, rowNumber: i, fila: i + 1, errorMsg: `DNI inválido ${i + 1}` }));
const avisosDe = (n: number): ErrorDeCargaDto[] => Array.from({ length: n }, (_, i) => errorDeCarga({ id: 10_000 + i, rowNumber: 0, tipo: 'AVISO', fila: null, errorMsg: `[AVISO] Aviso ${i + 1}` }));

interface Banco { srv: ServidorFalso; v: Montado; filas: ErrorDeCargaDto[]; avisos: ErrorDeCargaDto[]; totalesDictados: { filas: number; avisos: number } | null; csv: (p: Pedido) => Respuesta; erroresReq: () => Pedido[]; }
let b: Banco | null = null;

async function armar(o: { filas?: ErrorDeCargaDto[]; avisos?: ErrorDeCargaDto[]; carga?: EstadoCargaDto; multiclaves?: boolean; viejo?: boolean; totales?: { filas: number; avisos: number } }): Promise<Banco> {
    const srv = new ServidorFalso();
    await srv.levantar();
    iniciarSesion(['importacion.ver_historial'], 3);
    const bb = { srv, filas: o.filas ?? [], avisos: o.avisos ?? [], totalesDictados: o.totales ?? null } as unknown as Banco;
    bb.csv = () => ({ crudo: { tipo: 'text/csv; charset=utf-8', contenido: '﻿fila;mensaje\n1;DNI inválido\n' } });
    bb.erroresReq = () => srv.de('GET', /^\/import\/errores\/\d+(\?|$)/);
    srv.en('GET', /^\/import\/errores\/(\d+)$/, (_m, p) => {
        const q = new URLSearchParams(p.ruta.split('?')[1] ?? '');
        const tipo = q.get('tipo') ?? 'TODOS';
        const page = Number(q.get('page') ?? 1);
        const pageSize = Number(q.get('pageSize') ?? 50);
        // Un backend anterior no filtra por `tipo`: devuelve todo.
        const lista = !o.viejo && tipo === 'FILA' ? bb.filas : !o.viejo && tipo === 'AVISO' ? bb.avisos : [...bb.filas, ...bb.avisos];
        const data = lista.slice((page - 1) * pageSize, page * pageSize);
        const base = { data, total: lista.length, page, pageSize, totalPages: Math.max(1, Math.ceil(lista.length / pageSize)) };
        return { body: o.viejo ? base : { ...base, totales: bb.totalesDictados ?? { filas: bb.filas.length, avisos: bb.avisos.length } } };
    });
    srv.en('GET', /^\/import\/errores\/(\d+)\/csv$/, (_m, p) => bb.csv(p));
    const carga = o.carga ?? terminalC1('CON_ERRORES', { remesaId: 141, ok: 10, err: (o.filas ?? []).length, procesadas: 10 + (o.filas ?? []).length, advertencias: (o.avisos ?? []).length });
    bb.v = await montar(<ErroresDeCarga remesaId={141} numeroRemesa="00141" carga={carga} esMulticlaves={o.multiclaves === true} />);
    return bb;
}
const filasVisibles = () => Array.from(document.querySelectorAll('tbody tr')).map((tr) => limpio(tr.textContent ?? ''));
const pestanas = () => Array.from(document.querySelectorAll('[role="tab"]')).map((t) => limpio(t.textContent ?? ''));
const ultimaRuta = () => b!.erroresReq().slice(-1)[0]?.ruta ?? '';

beforeEach(() => { vi.mocked(descargas.descargarBlob).mockClear(); });
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; vi.restoreAllMocks(); });

describe('FE-1 a FE-4 — pestañas, números y paginado', () => {
    it('FE-1 — 483 filas y 2 avisos: dos pestañas con sus cantidades; cada una pide con su `tipo`', async () => {
        b = await armar({ filas: filasDe(483), avisos: avisosDe(2) });
        await esperar(() => pestanas().length === 2, { que: 'las pestañas' });
        expect(pestanas()).toEqual(['Errores de fila (483)', 'Avisos (2)']);
        expect(b.erroresReq().every((p) => /tipo=FILA/.test(p.ruta))).toBe(true);
        await clic(document.querySelectorAll('[role="tab"]')[1], 'la pestaña Avisos');
        await esperar(() => /tipo=AVISO/.test(ultimaRuta()), { que: 'el pedido de avisos' });
        await esperar(() => filasVisibles().length === 2, { que: 'los dos avisos' });
        expect(filasVisibles()[0]).toContain('[AVISO] Aviso 1');
    });

    it('FE-2 — 150 avisos y 20 filas: la pestaña de filas muestra las 20', async () => {
        b = await armar({ filas: filasDe(20), avisos: avisosDe(150) });
        await esperar(() => filasVisibles().length === 20, { que: 'las 20 filas' });
        expect(pestanas()).toEqual(['Errores de fila (20)', 'Avisos (150)']);
        expect(filasVisibles().every((f) => /DNI inválido/.test(f))).toBe(true);
    });

    it('FE-3 — la fila guardada en la posición 0 se muestra como «1», no como «—»; un aviso, «—»', async () => {
        b = await armar({ filas: [errorDeCarga({ id: 1, rowNumber: 0, fila: 1 }), errorDeCarga({ id: 2, rowNumber: 1, fila: 2 })], avisos: avisosDe(1) });
        await esperar(() => filasVisibles().length === 2, { que: 'las filas' });
        expect(filasVisibles()[0].startsWith('1')).toBe(true);
        expect(filasVisibles()[1].startsWith('2')).toBe(true);
        await clic(document.querySelectorAll('[role="tab"]')[1], 'Avisos');
        await esperar(() => filasVisibles().length === 1 && /\[AVISO\]/.test(filasVisibles()[0]), { que: 'el aviso' });
        expect(filasVisibles()[0].startsWith('—')).toBe(true);
    });

    it('FE-4 — paginado: la página 2 pide `page=2`', async () => {
        b = await armar({ filas: filasDe(60) });
        await esperar(() => filasVisibles().length === 25, { que: 'la primera página' });
        await clic(document.querySelector('button[aria-label="Go to next page"]'), 'siguiente');
        await esperar(() => /page=2/.test(ultimaRuta()), { que: 'page=2' });
        await esperar(() => /26–50 de 60/.test(limpio(document.body.textContent ?? '')), { que: 'la segunda página' });
        expect(filasVisibles()[0]).toContain('DNI inválido 26');
    });

    it('el encabezado de la columna explica qué cuenta el número', async () => {
        b = await armar({ filas: filasDe(1) });
        await esperar(() => filasVisibles().length === 1, { que: 'la fila' });
        const tip = 'Posición entre las filas que procesó esta carga, contando desde 1. No cuenta el encabezado ni las filas descartadas por un filtro. Para ubicar el registro, mirá la columna con el contenido de la fila.';
        expect(document.querySelector(`[aria-label="${tip}"]`)).not.toBeNull();
    });
});

describe('FE-5 y FE-6 — vivo y honesto', () => {
    it('FE-5 — carga en curso: `err` sube tres veces en dos segundos → una sola consulta nueva; al terminar, una más', async () => {
        const base = dtoC1({ remesaId: 141, err: 5, ok: 100, procesadas: 105 });
        b = await armar({ filas: filasDe(5), carga: base });
        await esperar(() => filasVisibles().length === 5, { que: 'las filas' });
        const inicial = b.erroresReq().length;
        for (const n of [6, 7, 8]) {
            b.filas = filasDe(n);
            await b.v.rerender(<ErroresDeCarga remesaId={141} numeroRemesa="00141" carga={dtoC1({ ...base, err: n })} esMulticlaves={false} />);
            await pasar(400);
        }
        expect(b.erroresReq().length).toBe(inicial + 1);
        b.filas = filasDe(8);
        await b.v.rerender(<ErroresDeCarga remesaId={141} numeroRemesa="00141" carga={terminalC1('CON_ERRORES', { remesaId: 141, err: 8, ok: 100, procesadas: 108 })} esMulticlaves={false} />);
        await esperar(() => b!.erroresReq().length === inicial + 2, { que: 'la consulta final' });
        await pasar(5600);
        expect(b.erroresReq().length).toBe(inicial + 2); // la consulta diferida de la ventana se cancela al terminar
    });

    it('FE-6 — la carga dice `err > 0` y la respuesta trae los totales en 0: «No se pudieron leer los errores» y «Reintentar»; nunca «No hay errores»', async () => {
        b = await armar({ filas: [], avisos: [], carga: terminalC1('CON_ERRORES', { remesaId: 141, err: 7, ok: 3, procesadas: 10 }), totales: { filas: 0, avisos: 0 } });
        await esperar(() => alertas().some((a) => /No se pudieron leer los errores/.test(a.texto)), { que: 'el aviso' });
        expect(boton('Reintentar')).not.toBeNull();
        expect(limpio(document.body.textContent ?? '')).not.toMatch(/No hay (errores|registros)/);
        b.filas = filasDe(7);
        b.totalesDictados = null;
        await clic(boton('Reintentar'), 'Reintentar');
        await esperar(() => filasVisibles().length === 7, { que: 'las filas tras reintentar' });
    });

    it('FE-6 — la lectura falla (500): el mismo aviso, con «Reintentar»', async () => {
        b = await armar({ filas: filasDe(3) });
        b.srv.en('GET', /^\/import\/errores\/(\d+)$/, () => ({ status: 500, body: { message: 'boom' } }));
        await b.v.rerender(<ErroresDeCarga remesaId={142} numeroRemesa="00142" carga={terminalC1('CON_ERRORES', { remesaId: 142, err: 3, ok: 1, procesadas: 4 })} esMulticlaves={false} />);
        await esperar(() => alertas().some((a) => /No se pudieron leer los errores/.test(a.texto)), { que: 'el aviso' });
    });
});

describe('FE-7 a FE-10 — descargar', () => {
    it('FE-7 — un GET con `Authorization`; no se llama a `window.open`; el blob llega a `descargarBlob` con el nombre', async () => {
        const abrir = vi.spyOn(window, 'open');
        b = await armar({ filas: filasDe(3) });
        await esperar(() => filasVisibles().length === 3, { que: 'las filas' });
        await clic(boton('Descargar CSV'), 'Descargar CSV');
        await esperar(() => vi.mocked(descargas.descargarBlob).mock.calls.length === 1, { que: 'la entrega del archivo' });
        const pedidos = b.srv.de('GET', /\/csv/);
        expect(pedidos).toHaveLength(1);
        expect(pedidos[0].autorizacion).toBe('Bearer token-de-prueba');
        expect(pedidos[0].ruta).toBe('/import/errores/141/csv?tipo=TODOS');
        const [blob, nombre] = vi.mocked(descargas.descargarBlob).mock.calls[0];
        expect(blob).toBeInstanceOf(Blob);
        expect(await leerBlob(blob as Blob)).toContain('DNI inválido');
        expect(nombre).toBe('errores-remesa-00141.csv');
        expect(abrir).not.toHaveBeenCalled();
    });

    it('FE-8 — un 404: el toast dice el mensaje del backend, no un genérico', async () => {
        b = await armar({ filas: filasDe(2) });
        b.csv = () => ({ status: 404, body: { statusCode: 404, message: 'La remesa 141 no existe' } });
        await esperar(() => filasVisibles().length === 2, { que: 'las filas' });
        await clic(boton('Descargar CSV'), 'Descargar CSV');
        await esperar(() => toasts().length > 0, { que: 'el toast' });
        expect(toasts()).toEqual([{ variante: 'error', texto: 'La remesa 141 no existe' }]);
        expect(descargas.descargarBlob).not.toHaveBeenCalled();
    });

    it('FE-9 — la descarga se corta (la conexión se cae): toast de error y `descargarBlob` no se llama', async () => {
        b = await armar({ filas: filasDe(2) });
        b.csv = () => ({ cortar: true });
        await esperar(() => filasVisibles().length === 2, { que: 'las filas' });
        await clic(boton('Descargar CSV'), 'Descargar CSV');
        await esperar(() => toasts().length > 0, { que: 'el toast' });
        expect(toasts()[0].variante).toBe('error');
        expect(toasts()[0].texto).toMatch(/^No se pudo descargar el archivo/);
        expect(descargas.descargarBlob).not.toHaveBeenCalled();
        expect(boton('Descargar CSV')!.disabled).toBe(false);
    });

    it('FE-10 — más de 200.000: pide confirmación con los dos números antes de bajar', async () => {
        b = await armar({ filas: filasDe(5), avisos: avisosDe(1), totales: { filas: 150_000, avisos: 60_000 } });
        await esperar(() => filasVisibles().length === 5, { que: 'las filas' });
        await clic(boton('Descargar CSV'), 'Descargar CSV');
        const d = await esperar(() => dialogo(/^Descargar CSV$/), { que: 'la confirmación' });
        expect(limpio(d.textContent ?? '')).toContain('Esta carga tiene 210.000 errores y avisos. El archivo va a traer los primeros 200.000.');
        expect(b.srv.de('GET', /\/csv/)).toHaveLength(0);
        await clic(boton('Descargar', d), 'confirmar');
        await esperar(() => vi.mocked(descargas.descargarBlob).mock.calls.length === 1, { que: 'la entrega' });
        expect(b.srv.de('GET', /\/csv/)).toHaveLength(1);
    });

    it('FE-10 — con 200.000 o menos no pregunta', async () => {
        b = await armar({ filas: filasDe(5), totales: { filas: 200_000, avisos: 0 } });
        await esperar(() => filasVisibles().length === 5, { que: 'las filas' });
        await clic(boton('Descargar CSV'), 'Descargar CSV');
        await esperar(() => vi.mocked(descargas.descargarBlob).mock.calls.length === 1, { que: 'la entrega' });
    });
});

describe('FE-11 y FE-12', () => {
    it('FE-11 — backend viejo (sin `totales`): una sola lista, sin pestañas ni botón; los avisos con «—»', async () => {
        const viejos = [
            { id: 1, rowNumber: 0, errorMsg: '[aviso] Algo', rawRow: null, createdAt: '2026-10-09T10:00:00.000Z' },
            { id: 2, rowNumber: 0, errorMsg: 'DNI inválido', rawRow: { dni: 'x' }, createdAt: '2026-10-09T10:00:00.000Z' },
        ] as unknown as ErrorDeCargaDto[];
        b = await armar({ filas: [viejos[1]], avisos: [viejos[0]], viejo: true, carga: terminalC1('CON_ADVERTENCIAS', { remesaId: 141, err: 1, advertencias: 1, ok: 5, procesadas: 6, errorPostProceso: 'x' }) });
        await esperar(() => filasVisibles().length === 2, { que: 'la lista' });
        expect(pestanas()).toEqual([]);
        expect(boton('Descargar CSV')).toBeNull();
        const filas = filasVisibles();
        expect(filas[0].startsWith('—')).toBe(true); // el aviso primero, como antes
        expect(filas[1].startsWith('0')).toBe(true);
        expect(limpio(document.body.textContent ?? '')).not.toMatch(BASURA);
        await esperar(() => /pageSize=100/.test(ultimaRuta()), { que: 'el pedido de 100' });
    });

    it('FE-12 — Claves de pago: «Trámite» en vez de «Fila» y «Trámites rechazados» en la pestaña', async () => {
        b = await armar({ filas: filasDe(2), multiclaves: true });
        await esperar(() => filasVisibles().length === 2, { que: 'las filas' });
        expect(pestanas()).toEqual(['Trámites rechazados (2)']);
        const encabezados = Array.from(document.querySelectorAll('thead th')).map((th) => limpio(th.textContent ?? ''));
        expect(encabezados[0]).toBe('Trámite');
        expect(tooltipDelEncabezado()).toMatch(/^Posición entre los trámites que procesó esta carga/);
    });
});

const leerBlob = (blob: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(blob); });
const tooltipDelEncabezado = () => document.querySelector('thead th [aria-label]')?.getAttribute('aria-label') ?? '';
