// C2b: useUltimosErrores contra el servidor falso (TE-1 a TE-8, docs/imports-progreso-c2-spec.md §16.4.4).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUltimosErrores } from '@fe/hooks/useUltimosErrores';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import type { ErroresRespuesta } from '@fe/types/importHistorial';
import { dtoC1, errorDeCarga, terminalC1 } from '../lib/fabricas';
import { ServidorFalso, type Respuesta } from '../lib/servidor-falso';
import { esperar, iniciarSesion, montar, pasar, type Montado } from '../lib/montar';

function Sonda({ carga, activo }: { carga: EstadoCargaDto | null; activo?: boolean }) {
    const u = useUltimosErrores(carga, activo);
    return <div data-testid="u">{u === null ? 'NULL' : `${u.items.map((e) => e.errorMsg).join('|')};fallo=${u.fallo};totales=${u.totales ? `${u.totales.filas}/${u.totales.avisos}` : 'none'}`}</div>;
}
const lectura = (mensajes: string[], totales = { filas: mensajes.length, avisos: 0 }): ErroresRespuesta => ({
    data: mensajes.map((m, i) => errorDeCarga({ id: i + 1, errorMsg: m })), total: mensajes.length, page: 1, pageSize: 5, totalPages: 1, totales,
});

let srv: ServidorFalso;
let v: Montado | null = null;
let responder: (remesaId: number, n: number) => Respuesta | Promise<Respuesta>;
const llamadas: Record<number, number> = {};
const LEIDAS = /^\/import\/errores\/\d+\?/;
const mostrado = () => document.querySelector('[data-testid="u"]')?.textContent ?? '';

beforeEach(async () => {
    for (const k of Object.keys(llamadas)) delete llamadas[Number(k)];
    responder = (_id, n) => ({ body: lectura([`error ${n}`]) });
    srv = new ServidorFalso();
    await srv.levantar();
    srv.en('GET', /^\/import\/errores\/(\d+)$/, (m) => { const id = Number(m[1]); llamadas[id] = (llamadas[id] ?? 0) + 1; return responder(id, llamadas[id]); });
    iniciarSesion();
});
afterEach(async () => { if (v) await v.desmontar(); v = null; await srv.bajar(); });

const enCurso = (over: Record<string, unknown> = {}) => dtoC1({ err: 3, advertencias: 0, ...over });

describe('TE-1 y TE-8 — cuándo no pide', () => {
    it('TE-1 — sin errores ni avisos: 0 pedidos', async () => {
        v = await montar(<Sonda carga={dtoC1({ err: 0, advertencias: 0 })} />);
        await pasar(400);
        expect(srv.cuantos('GET', LEIDAS)).toBe(0);
        expect(mostrado()).toBe('NULL');
    });
    it('TE-1 — sin estado todavía: 0 pedidos', async () => {
        v = await montar(<Sonda carga={null} />);
        await pasar(300);
        expect(srv.cuantos('GET', LEIDAS)).toBe(0);
    });
    it('TE-8 — `activo=false`: 0 pedidos aunque haya errores', async () => {
        v = await montar(<Sonda carga={enCurso()} activo={false} />);
        await pasar(400);
        expect(srv.cuantos('GET', LEIDAS)).toBe(0);
    });
});

describe('TE-2 — la lectura', () => {
    it('con `err` > 0: un solo pedido (también en modo estricto), con los parámetros exactos', async () => {
        v = await montar(<Sonda carga={enCurso()} />);
        await esperar(() => /error 1/.test(mostrado()), { que: 'la primera lectura' });
        await pasar(300);
        const pedidos = srv.de('GET', LEIDAS);
        expect(pedidos).toHaveLength(1);
        expect(pedidos[0].ruta).toBe('/import/errores/141?tipo=TODOS&orden=desc&page=1&pageSize=5');
        expect(mostrado()).toBe('error 1;fallo=false;totales=1/0');
    });
    it('con solo avisos también pide', async () => {
        v = await montar(<Sonda carga={enCurso({ err: 0, advertencias: 2 })} />);
        await esperar(() => /error 1/.test(mostrado()), { que: 'la lectura' });
    });
    it('cuando la carga pasa de 0 a tener errores pide una vez, sin una segunda por el mismo cambio', async () => {
        v = await montar(<Sonda carga={enCurso({ err: 0 })} />);
        await pasar(200);
        await v.rerender(<Sonda carga={enCurso({ err: 2, rev: 6 })} />);
        await esperar(() => /error 1/.test(mostrado()), { que: 'la lectura' });
        await pasar(500);
        expect(srv.cuantos('GET', LEIDAS)).toBe(1);
    });
});

describe('TE-3 — el tope de una lectura cada 5 s', () => {
    it('10 eventos en 2 s con `err` subiendo: a lo sumo una lectura más dentro de los 5 s, y la pendiente no se pierde', async () => {
        v = await montar(<Sonda carga={enCurso({ err: 3 })} />);
        await esperar(() => /error 1/.test(mostrado()), { que: 'la primera lectura' });
        const t0 = Date.now();
        for (let i = 1; i <= 10; i++) {
            await v.rerender(<Sonda carga={enCurso({ err: 3 + i, rev: 6 + i })} />);
            await pasar(200);
        }
        expect(srv.cuantos('GET', LEIDAS)).toBeLessThanOrEqual(2);
        await esperar(() => srv.cuantos('GET', LEIDAS) === 2, { ms: 7000, que: 'la lectura diferida' });
        expect(Date.now() - t0).toBeGreaterThanOrEqual(2900);
        await pasar(400);
        expect(srv.cuantos('GET', LEIDAS)).toBe(2);
    });
});

describe('TE-4 — al terminar', () => {
    it('al pasar a terminal hay una lectura más, enseguida, y la pendiente se cancela', async () => {
        v = await montar(<Sonda carga={enCurso()} />);
        await esperar(() => /error 1/.test(mostrado()), { que: 'la primera lectura' });
        await v.rerender(<Sonda carga={enCurso({ err: 4, rev: 7 })} />);
        await pasar(100);
        expect(srv.cuantos('GET', LEIDAS)).toBe(1);
        await v.rerender(<Sonda carga={terminalC1('CON_ERRORES', { err: 4, ok: 10, rev: 8 })} />);
        await esperar(() => /error 2/.test(mostrado()), { ms: 2000, que: 'la lectura final' });
        await pasar(5400);
        expect(srv.cuantos('GET', LEIDAS)).toBe(2);
    });
});

describe('TE-5 — una respuesta vieja', () => {
    it('la que llega después de una más nueva se descarta', async () => {
        responder = async (_id, n) => (n === 1 ? { body: lectura(['viejo']), demoraMs: 1200 } : { body: lectura(['nuevo']) });
        v = await montar(<Sonda carga={enCurso()} />);
        await esperar(() => srv.cuantos('GET', LEIDAS) === 1, { que: 'el primer pedido' });
        await v.rerender(<Sonda carga={terminalC1('CON_ERRORES', { err: 3, ok: 5, rev: 8 })} />);
        await esperar(() => /nuevo/.test(mostrado()), { que: 'la respuesta nueva' });
        await pasar(1600);
        expect(mostrado()).toContain('nuevo');
        expect(mostrado()).not.toContain('viejo');
    });
});

describe('TE-6 — otra remesa', () => {
    it('se limpia y se pide la nueva', async () => {
        v = await montar(<Sonda carga={enCurso({ remesaId: 141 })} />);
        await esperar(() => /error 1/.test(mostrado()), { que: 'la lectura de la 141' });
        responder = (id) => ({ body: lectura([`de la ${id}`]) });
        await v.rerender(<Sonda carga={enCurso({ remesaId: 142, rev: 1 })} />);
        await esperar(() => /de la 142/.test(mostrado()), { que: 'la lectura de la 142' });
        expect(srv.cuantos('GET', /^\/import\/errores\/142\?/)).toBe(1);
        expect(mostrado()).not.toContain('error 1');
    });
    it('a una remesa sin errores: vuelve a null y no pide', async () => {
        v = await montar(<Sonda carga={enCurso({ remesaId: 141 })} />);
        await esperar(() => /error 1/.test(mostrado()), { que: 'la lectura' });
        await v.rerender(<Sonda carga={dtoC1({ remesaId: 142, err: 0, advertencias: 0 })} />);
        await pasar(300);
        expect(mostrado()).toBe('NULL');
        expect(srv.cuantos('GET', /^\/import\/errores\/142/)).toBe(0);
    });
});

describe('TE-7 — un fallo', () => {
    it('un 500 después de una lectura buena conserva los items y marca `fallo`', async () => {
        v = await montar(<Sonda carga={enCurso()} />);
        await esperar(() => /error 1/.test(mostrado()), { que: 'la lectura buena' });
        responder = () => ({ status: 500, body: { message: 'boom' } });
        await v.rerender(<Sonda carga={terminalC1('CON_ERRORES', { err: 3, ok: 5, rev: 8 })} />);
        await esperar(() => /fallo=true/.test(mostrado()), { que: 'el fallo' });
        expect(mostrado()).toContain('error 1');
    });
    it('un fallo sin ninguna lectura previa devuelve `fallo` y sin items', async () => {
        responder = () => ({ status: 500, body: { message: 'boom' } });
        v = await montar(<Sonda carga={enCurso()} />);
        await esperar(() => /fallo=true/.test(mostrado()), { que: 'el fallo' });
        expect(mostrado()).toBe(';fallo=true;totales=none');
    });
    it('un backend viejo (sin `totales`): items y totales null', async () => {
        responder = () => ({ body: { data: [errorDeCarga({ errorMsg: 'solo' })], total: 1, page: 1, pageSize: 5, totalPages: 1 } });
        v = await montar(<Sonda carga={enCurso()} />);
        await esperar(() => /solo/.test(mostrado()), { que: 'la lectura' });
        expect(mostrado()).toBe('solo;fallo=false;totales=none');
    });
});
