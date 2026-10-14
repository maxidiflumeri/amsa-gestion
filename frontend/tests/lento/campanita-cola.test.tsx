// Segunda pasada de C1: el polling de la campanita con cargas EN_COLA, con intervalos reales de 30 a 60 s por prueba.
// Portado del arnés de C1 (11) para C2b. No corre con `npm test` sino con `npm run test:lento`.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificacionesProvider } from '@fe/context/NotificacionesContext';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { iso } from '../lib/fabricas';
import { CONTADOR, EN_CURSO, ListaEnCurso as Lista, TODOS, corriendo, enCola, idsEnCurso as ids, itemEnCurso as item } from '../lib/banco-campanita';
import { ServidorFalso } from '../lib/servidor-falso';
import { dormir, esperar, iniciarSesion, montar, pasar, type Montado } from '../lib/montar';

let srv: ServidorFalso; let v: Montado | null = null; let lista: EstadoCargaDto[];
const posicion = (id: number) => /(Hay|Es la) [^.]*\./.exec(item(id))?.[0] ?? '(sin posición)';
const tiempos = (patron: RegExp, t0: number) => srv.de('GET', patron).filter((p) => p.t >= t0).map((p) => p.t - t0);
const seg = (ms: number[]) => ms.map((t) => (t / 1000).toFixed(1)).join(', ') || '(ninguna)';

beforeEach(async () => {
    lista = [];
    srv = await new ServidorFalso().levantar();
    srv.en('GET', EN_CURSO, () => ({ body: lista.map((d) => ({ ...d, servidorAhora: iso(Date.now()) })) }));
});
afterEach(async () => { if (v) await v.desmontar(); v = null; await srv.bajar(); });

async function abrir(permisos = TODOS, conSocket = true) {
    iniciarSesion(permisos);
    v = await montar(<NotificacionesProvider><Lista /></NotificacionesProvider>, { conSocket: true });
    if (conSocket) await esperar(() => srv.sockets.size === 1, { que: 'el socket conectado' });
    await pasar(500);
    return Date.now();
}
/** Emite el progreso de `id` una vez por segundo durante `segundos`, o hasta que `cortar` devuelva true. */
async function conProgreso(id: number, segundos: number, cortar: () => boolean = () => false) {
    for (let s = 1; s <= segundos && !cortar(); s++) {
        const d = corriendo(id, { rev: 10 + s, procesadas: 3000 + s * 100 });
        const i = lista.findIndex((x) => x.remesaId === id); if (i >= 0) lista[i] = d;
        srv.emitir('import:progreso', d);
        await pasar(1000);
    }
}

describe('una carga en cola que se elimina (el borrado no emite evento)', () => {
    it('A corriendo con un progreso por segundo, B y C en cola, se elimina B: B desaparece y C corrige su posición sin esperar a que A termine', async () => {
        lista = [corriendo(201), enCola(202, 1), enCola(203, 2)];
        const t0 = await abrir();
        expect(ids()).toEqual([201, 202, 203]);
        lista = [corriendo(201), enCola(203, 1)]; // alguien eliminó la 202 desde el Historial
        const borradaEn = Date.now();
        let corregidaEn: number | null = null;
        await conProgreso(201, 60, () => { if (!ids().includes(202) && /Hay 1 importación/.test(item(203))) { corregidaEn = corregidaEn ?? Date.now(); } return corregidaEn !== null; });
        const tardo = corregidaEn === null ? null : corregidaEn - borradaEn;
        console.log(`borrado de una carga en cola: B desaparece y C pasa a «${posicion(203)}» a los ${tardo === null ? '(no ocurrió en 60 s)' : (tardo / 1000).toFixed(1) + ' s'}; consultas a /import/en-curso desde que se abrió: a los ${seg(tiempos(EN_CURSO, t0))} s; lista: ${JSON.stringify(ids())}`);
        expect(tardo).not.toBeNull();
        expect(tardo!).toBeLessThanOrEqual(46_500);
        expect(ids()).toEqual([201, 203]);
        expect(item(201)).toContain('Procesando'); // la que corre no retrocede ni se pierde con la re-hidratación
    });

    it('después de una re-hidratación por eventos, el polling espera 30 s desde ESA: no se pisa con ella', async () => {
        lista = [corriendo(201), enCola(203, 1)];
        await abrir();
        await pasar(9000); // para que el evento caiga lejos de la hidratación del montaje
        const t0 = Date.now();
        srv.emitir('import:iniciada', corriendo(301, { rev: 3 })); // re-hidrata ya (hay otra en cola)
        lista = [corriendo(201), corriendo(301, { rev: 3 }), enCola(203, 2)];
        await conProgreso(201, 50);
        const ts = tiempos(EN_CURSO, t0);
        const brechas = ts.slice(1).map((t, i) => t - ts[i]);
        console.log(`evento a los 9,5 s de abrir y después 50 s de progreso ajeno: consultas a los ${seg(ts)} s del evento; brechas ${brechas.map((x) => (x / 1000).toFixed(1)).join(', ')} s`);
        expect(ts[0]).toBeLessThan(300);
        expect(ts.length).toBeGreaterThanOrEqual(2);
        expect(ts.length).toBeLessThanOrEqual(3);
        for (const x of brechas) expect(x).toBeGreaterThanOrEqual(29_000);
    });
});

describe('no consulta más de lo que consultaba', () => {
    async function contar(nombre: string, inicial: EstadoCargaDto[], emitir: boolean, permisos = TODOS) {
        lista = inicial;
        const t0 = await abrir(permisos);
        if (!permisos.includes('importacion.ver_historial')) { for (const d of inicial) srv.emitir('import:progreso', d); await pasar(300); }
        if (emitir) await conProgreso(201, 50); else await pasar(50_000);
        const r = { nombre, lista: tiempos(EN_CURSO, t0), contador: tiempos(CONTADOR, t0), ids: ids() };
        await v!.desmontar(); v = null;
        await esperar(() => srv.sockets.size === 0, { que: 'socket cerrado' });
        srv.pedidos.length = 0;
        return r;
    }

    it('sin cargas en cola: con eventos, ninguna consulta; en silencio, la de siempre (una, a los ~45 s)', async () => {
        const conEventos = await contar('una corriendo, con su progreso por segundo', [corriendo(201)], true);
        const enSilencio = await contar('una corriendo, en silencio', [corriendo(201)], false);
        console.log(`sin cargas en cola, 50 s: con eventos -> /import/en-curso a los ${seg(conEventos.lista)} s; en silencio -> a los ${seg(enSilencio.lista)} s`);
        expect(conEventos.lista).toEqual([]);
        expect(enSilencio.lista.length).toBe(1);
        expect(enSilencio.lista[0]).toBeGreaterThanOrEqual(29_000);
    });

    it('con una carga en cola y en silencio: UNA consulta en 50 s (las dos condiciones del polling no suman)', async () => {
        const r = await contar('una en cola, en silencio', [enCola(203, 0)], false);
        console.log(`una en cola, en silencio, 50 s: /import/en-curso a los ${seg(r.lista)} s; contador a los ${seg(r.contador)} s`);
        expect(r.lista.length).toBe(1);
        expect(r.contador.length).toBe(1);
    });

    it('sin importacion.ver_historial y con una carga en cola en la lista (llegada por socket): nunca /import/en-curso', async () => {
        const r = await contar('sin ver_historial', [corriendo(201), enCola(203, 1)], true, ['importacion.ver_progreso_otros']);
        console.log(`sin ver_historial, una en cola y 50 s de progreso ajeno: /import/en-curso ${r.lista.length} consultas; contador a los ${seg(r.contador)} s; lista ${JSON.stringify(r.ids)}`);
        expect(r.lista).toEqual([]);
        expect(r.ids.sort()).toEqual([201, 203]);
        expect(r.contador.length).toBeLessThanOrEqual(2);
    });
});

describe('socket caído y desmontaje', () => {
    it('con el socket caído y una carga en cola: una consulta cada 15 s, no más; al desmontar, ninguna', async () => {
        srv.aceptarSockets = false;
        lista = [corriendo(201), enCola(203, 1)];
        iniciarSesion(TODOS);
        v = await montar(<NotificacionesProvider><Lista /></NotificacionesProvider>, { conSocket: true });
        await esperar(() => ids().length === 2, { que: 'la lista hidratada por HTTP' });
        await pasar(300);
        const t0 = Date.now();
        await pasar(32_000);
        const ts = tiempos(EN_CURSO, t0);
        await v.desmontar(); v = null;
        const alDesmontar = Date.now();
        await dormir(32_000);
        const despues = tiempos(EN_CURSO, alDesmontar).length + tiempos(CONTADOR, alDesmontar).length;
        console.log(`socket caído con una en cola: /import/en-curso a los ${seg(ts)} s; después de desmontar, ${despues} pedidos en 32 s`);
        expect(ts.length).toBe(2);
        expect(ts[1] - ts[0]).toBeGreaterThanOrEqual(14_000);
        expect(despues).toBe(0);
    });

    it('con el socket conectado y una carga en cola: desmontar apaga el polling', async () => {
        lista = [corriendo(201), enCola(203, 1)];
        await abrir();
        await v!.desmontar(); v = null;
        const t0 = Date.now();
        await dormir(47_000);
        const n = tiempos(EN_CURSO, t0).length + tiempos(CONTADOR, t0).length;
        console.log(`desmontada con una en cola: ${n} pedidos en 47 s`);
        expect(n).toBe(0);
    });
});
