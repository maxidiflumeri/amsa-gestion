// Campanita: lo que mide intervalos reales de un minuto o más. Portado del arnés de C1 (10 y 11) para C2b.
// No corre con `npm test` sino con `npm run test:lento`.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificacionesProvider } from '@fe/context/NotificacionesContext';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { iso } from '../lib/fabricas';
import { CONTADOR, EN_CURSO, ListaEnCurso as Lista, TODOS, corriendo, enCola, entrarRef, finalizada, idsEnCurso as ids, itemEnCurso as item, noLeidasMostradas as noLeidas } from '../lib/banco-campanita';
import { ServidorFalso } from '../lib/servidor-falso';
import { dormir, esperar, iniciarSesion, montar, pasar, type Montado } from '../lib/montar';

let srv: ServidorFalso; let v: Montado | null = null;
let lista: EstadoCargaDto[]; let noLeidasServidor: number; let demoraLista = 0;
const pedidosLista = (desde = 0) => srv.cuantos('GET', EN_CURSO, desde);
const pedidosContador = (desde = 0) => srv.cuantos('GET', CONTADOR, desde);

beforeEach(async () => {
    lista = []; noLeidasServidor = 3; demoraLista = 0; entrarRef.login = null;
    srv = await new ServidorFalso().levantar();
    srv.en('GET', EN_CURSO, () => { const foto = lista.map((d) => ({ ...d, servidorAhora: iso(Date.now()) })); return { body: foto, demoraMs: demoraLista }; });
    srv.en('GET', CONTADOR, () => ({ body: { noLeidas: noLeidasServidor } }));
});
afterEach(async () => { if (v) await v.desmontar(); v = null; await srv.bajar(); });

async function abrir(permisos = TODOS, esperarSocket = true) {
    iniciarSesion(permisos);
    v = await montar(<NotificacionesProvider><Lista /></NotificacionesProvider>, { conSocket: true });
    if (esperarSocket) await esperar(() => srv.sockets.size === 1, { que: 'el socket conectado' });
    await pasar(500);
    return Date.now();
}

describe('re-hidratación de la campanita cuando la cola se mueve (hallazgo 1)', () => {
    it('un minuto con cargas que arrancan y terminan cada segundo y una esperando: una consulta cada 5 s, ni una más', async () => {
        lista = [enCola(203, 5)];
        await abrir();
        const t0 = Date.now();
        let id = 400;
        while (Date.now() - t0 < 60_000) {
            id++;
            srv.emitir('import:iniciada', corriendo(id, { rev: 3 }));
            await pasar(500);
            srv.emitir('import:finalizada', finalizada(id));
            await pasar(500);
        }
        const n = pedidosLista(t0);
        await pasar(7000);
        const tiempos = srv.de('GET', EN_CURSO).filter((p) => p.t >= t0).map((p) => p.t - t0);
        const brechas = tiempos.slice(1).map((t, i) => t - tiempos[i]);
        console.log(`campanita, 60 s con 120 eventos de inicio/fin: ${n} consultas; con la de cierre: ${tiempos.length}; brecha mínima ${Math.min(...brechas)} ms`);
        expect(n).toBeGreaterThanOrEqual(12);
        expect(n).toBeLessThanOrEqual(13);
        expect(tiempos.length - n).toBeLessThanOrEqual(1);
        expect(Math.min(...brechas)).toBeGreaterThanOrEqual(4990);
    });
});

describe('lo de la Fase A en NotificacionesContext', () => {
    it('con el socket caído consulta cada 15 s si hay cargas en la lista, y no consulta si está vacía', async () => {
        srv.aceptarSockets = false;
        lista = [corriendo(201)];
        await abrir(TODOS, false);
        await esperar(() => ids().length === 1, { que: 'la lista hidratada por HTTP' });
        const t0 = Date.now(); const base = pedidosLista();
        lista = [corriendo(201, { rev: 40, procesadas: 8000 })];
        await pasar(32_000);
        const tiempos = srv.de('GET', EN_CURSO).slice(base).map((p) => p.t - t0);
        console.log(`socket caído, lista con una carga: consultas a los ${tiempos.join(', ')} ms`);
        expect(tiempos.length).toBe(2);
        expect(tiempos[1] - tiempos[0]).toBeGreaterThanOrEqual(14_000);
        expect(item(201)).toContain('Procesadas: 8.000');
        lista = [];
        await esperar(() => ids().length === 0, { ms: 17_000, cada: 200, que: 'la lista vacía' });
        const vacia = pedidosLista();
        await pasar(17_000);
        expect(pedidosLista() - vacia, 'con la lista vacía no se consulta').toBe(0);
    });
});