// NotificacionesContext (la campanita) con socket.io real y HTTP falso: la re-hidratación de la cola (hallazgo 1 de C1) y lo de la Fase A.
// Portado del arnés de C1 (10) para C2b. Lo que espera 30 s o más va a tests/lento/campanita.test.tsx.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificacionesProvider, useNotificaciones } from '@fe/context/NotificacionesContext';
import { useAuth } from '@fe/context/AuthContext';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { iso } from '../lib/fabricas';
import { CONTADOR, EN_CURSO, ListaEnCurso as Lista, TODOS, corriendo, enCola, entrarRef, finalizada, idsEnCurso as ids, itemEnCurso as item, noLeidasMostradas as noLeidas } from '../lib/banco-campanita';
import { ServidorFalso } from '../lib/servidor-falso';
import { dormir, esperar, iniciarSesion, montar, pasar, toasts, type Montado } from '../lib/montar';

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
    it('sin ninguna carga en cola, iniciada/finalizada de otras cargas no consultan nada', async () => {
        lista = [corriendo(201)];
        const desde = await abrir();
        expect(ids()).toEqual([201]);
        srv.emitir('import:finalizada', finalizada(201));
        await pasar(100);
        lista = [corriendo(202, { rev: 3 })];
        srv.emitir('import:iniciada', corriendo(202, { rev: 3 }));
        for (let i = 0; i < 10; i++) { srv.emitir('import:progreso', corriendo(202, { rev: 4 + i })); await pasar(100); }
        srv.emitir('import:finalizada', finalizada(202));
        await pasar(6500);
        console.log(`sin cargas en cola: ${pedidosLista(desde)} consultas a /import/en-curso y ${pedidosContador(desde)} al contador en 8 s; lista: ${JSON.stringify(ids())}`);
        expect(pedidosLista(desde)).toBe(0);
        expect(pedidosContador(desde)).toBe(0);
        expect(ids()).toEqual([]);
    });

    it('con una carga en cola: import:progreso NO re-hidrata; iniciada/finalizada sí, a lo sumo una vez cada 5 s y con flanco de bajada', async () => {
        lista = [corriendo(201), enCola(203, 1)];
        const desde = await abrir();
        for (let i = 0; i < 12; i++) { srv.emitir('import:progreso', corriendo(201, { rev: 11 + i })); await pasar(100); }
        const porProgreso = pedidosLista(desde);
        const t0 = Date.now();
        // Ráfaga: termina 201, arrancan y terminan otras cuatro en 2 s.
        srv.emitir('import:finalizada', finalizada(201));
        for (const id of [301, 302, 303, 304]) { srv.emitir('import:iniciada', corriendo(id, { rev: 3 })); await pasar(250); srv.emitir('import:finalizada', finalizada(id)); await pasar(250); }
        lista = [enCola(203, 0)];
        await pasar(9000);
        const tiempos = srv.de('GET', EN_CURSO).filter((p) => p.t >= t0).map((p) => p.t - t0);
        console.log(`campanita, ráfaga de 9 eventos en 2 s: consultas a /import/en-curso a los ${tiempos.join(', ')} ms; por los 12 import:progreso previos: ${porProgreso}; 203 dice «${/(Hay|Es la) [^.]*\./.exec(item(203))?.[0]}»`);
        expect(porProgreso).toBe(0);
        expect(tiempos.length).toBe(2);
        expect(tiempos[0]).toBeLessThan(300);
        expect(tiempos[1] - tiempos[0]).toBeGreaterThanOrEqual(4990);
        expect(tiempos[1] - tiempos[0]).toBeLessThanOrEqual(5400);
        expect(item(203)).toContain('Es la próxima: empieza en instantes.');
    });

    it('la carga que estaba en cola es la que arranca (no hay OTRA en cola): no re-hidrata', async () => {
        lista = [enCola(203, 0)];
        const desde = await abrir();
        lista = [corriendo(203, { rev: 3 })];
        srv.emitir('import:iniciada', corriendo(203, { rev: 3 }));
        await pasar(6000);
        expect(pedidosLista(desde)).toBe(0);
        expect(item(203)).toContain('Procesando');
    });

    it('sin importacion.ver_historial nunca consulta /import/en-curso, aunque le lleguen cargas por socket', async () => {
        lista = [corriendo(201), enCola(203, 1)];
        await abrir(['importacion.ver_progreso_otros']);
        expect(pedidosLista()).toBe(0);
        expect(ids()).toEqual([]);
        srv.emitir('import:progreso', enCola(203, 1));
        srv.emitir('import:progreso', corriendo(201, { rev: 11 }));
        await esperar(() => ids().length === 2, { que: 'las cargas llegadas por socket' });
        const desde = Date.now();
        srv.emitir('import:finalizada', finalizada(201));
        srv.emitir('import:iniciada', corriendo(204, { rev: 3 }));
        await pasar(6500);
        console.log(`sin ver_historial: ${pedidosLista()} consultas a /import/en-curso en total; contador tras los eventos: ${pedidosContador(desde)}; lista: ${JSON.stringify(ids())}`);
        expect(pedidosLista()).toBe(0);
        expect(ids().sort()).toEqual([203, 204]);
    });

    it('la respuesta de la re-hidratación no borra una carga recién llegada por socket ni resucita la que terminó', async () => {
        lista = [corriendo(201), enCola(203, 1)];
        await abrir();
        // La respuesta tarda 700 ms y es una foto vieja: todavía trae a 201 y no trae a 205.
        demoraLista = 700;
        lista = [corriendo(201, { rev: 50 }), enCola(203, 0)];
        srv.emitir('import:finalizada', finalizada(201, 99));
        await pasar(200);
        srv.emitir('import:progreso', enCola(205, 1));            // se encola una nueva mientras el pedido está en vuelo
        await pasar(200);
        srv.emitir('import:iniciada', corriendo(203, { rev: 3 })); // y arranca la que esperaba
        await pasar(1200);
        console.log(`tras la respuesta lenta: lista ${JSON.stringify(ids())}; 203: «${item(203).slice(0, 60)}»; 205: «${item(205).slice(-40)}»`);
        expect(ids().sort()).toEqual([203, 205]);
        expect(item(203)).toContain('Procesando');       // rev 3 por socket le gana a la foto con rev 2
        expect(item(205)).toContain('Hay 1 importación antes que esta.');
        demoraLista = 0;
    });

    it('desmontar con una re-hidratación programada: no sale ninguna consulta después', async () => {
        lista = [corriendo(201), enCola(203, 1), enCola(204, 2)];
        await abrir();
        srv.emitir('import:finalizada', finalizada(201));
        await pasar(300);
        srv.emitir('import:iniciada', corriendo(203, { rev: 3 })); // queda programada para ~4,7 s después
        await pasar(300);
        await v!.desmontar(); v = null;
        const desde = Date.now();
        await dormir(7000);
        console.log(`campanita desmontada con una re-hidratación programada: ${pedidosLista(desde)} consultas a /import/en-curso y ${pedidosContador(desde)} al contador en 7 s`);
        expect(pedidosLista(desde)).toBe(0);
        expect(pedidosContador(desde)).toBe(0);
    });
});

describe('lo de la Fase A en NotificacionesContext', () => {
    it('hidrata al montar (contador + en curso) y aplica upsert / baja por socket', async () => {
        lista = [corriendo(201)];
        await abrir();
        console.log(`al montar (modo estricto + primera conexión): ${pedidosLista()} consultas a /import/en-curso, ${pedidosContador()} al contador`);
        expect(pedidosLista()).toBeGreaterThanOrEqual(1);
        expect(pedidosLista()).toBeLessThanOrEqual(3);
        expect(ids()).toEqual([201]);
        expect(noLeidas()).toBe(3);
        srv.emitir('import:progreso', enCola(207, 1));
        await esperar(() => ids().length === 2, { que: 'el alta por socket' });
        srv.emitir('import:progreso', corriendo(201, { rev: 5 }));   // rev vieja: se descarta
        srv.emitir('import:progreso', corriendo(201, { rev: 20, procesadas: 9000 }));
        await esperar(() => /Procesadas: 9\.000/.test(item(201)), { que: 'la fusión por rev' });
        srv.emitir('import:progreso', { ...corriendo(207, { rev: 9 }), enCurso: false }); // un estado que ya no está en curso la saca
        await esperar(() => ids().length === 1, { que: 'la baja por enCurso false' });
        srv.emitir('import:finalizada', finalizada(201));
        await esperar(() => ids().length === 0, { que: 'la baja por finalizada' });
        srv.emitir('import:progreso', corriendo(201, { rev: 21 }));  // un progreso rezagado no la resucita
        await pasar(300);
        expect(ids()).toEqual([]);
    });

    it('hidrata al cambiar el token (login sin recargar)', async () => {
        lista = [corriendo(201)];
        srv.en('POST', /^\/auth\/google$/, () => ({ status: 201, body: { token: 'token-nuevo', usuario: { id: 3, nombre: 'Maxi', email: 'm@x', rol: 'ADMIN', permisos: TODOS } } }));
        v = await montar(<NotificacionesProvider><Lista /></NotificacionesProvider>, { conSocket: true }); // sin sesión
        await pasar(600);
        expect(pedidosLista()).toBe(0);
        expect(pedidosContador()).toBe(0);
        expect(srv.sockets.size).toBe(0);
        await entrarRef.login!('id-token-de-google');
        await esperar(() => ids().length === 1 && srv.sockets.size === 1, { que: 'la lista hidratada tras el login' });
        expect(noLeidas()).toBe(3);
        expect(pedidosLista()).toBeGreaterThanOrEqual(1);
    });

    it('hidrata en cada reconexión del socket', async () => {
        lista = [corriendo(201)];
        await abrir();
        const antes = pedidosLista();
        lista = [corriendo(201, { rev: 30, procesadas: 7000 }), enCola(208, 1)];
        for (const s of srv.sockets) s.disconnect(true); // el server corta: socket.io no reintenta solo, lo hace SocketContext
        await esperar(() => ids().length === 2 && srv.conexionesTotales >= 2, { ms: 15_000, cada: 100, que: 'la re-hidratación tras reconectar' });
        console.log(`reconexión: ${pedidosLista() - antes} consultas a /import/en-curso; conexiones totales ${srv.conexionesTotales}`);
        expect(pedidosLista() - antes).toBeGreaterThanOrEqual(1);
        expect(item(201)).toContain('Procesadas: 7.000');
    });
});

// Consumidor mínimo del contexto: expone nonce y las acciones que cambian el globito.
const ref: { leida: ((id: number) => Promise<void>) | null; todas: (() => Promise<void>) | null; refrescar: (() => Promise<void>) | null; salir: (() => void) | null } = { leida: null, todas: null, refrescar: null, salir: null };
function Acciones() {
    const { nonce, marcarLeida, marcarTodas, refrescar } = useNotificaciones();
    ref.leida = marcarLeida; ref.todas = marcarTodas; ref.refrescar = refrescar; ref.salir = useAuth().logout;
    return <span data-testid="nonce">{nonce}</span>;
}
const nonce = () => Number(document.querySelector('[data-testid="nonce"]')?.textContent);
const notifNueva = (id: number, over: Record<string, unknown> = {}) => ({ id, tipo: 'IMPORTACION_FINALIZADA', titulo: `Carga ${id} terminó`, mensaje: 'x', payload: { resultado: 'OK' }, rutaAccion: null, creadoEn: iso(Date.now()), ...over });

async function abrirConAcciones(esperarSocket = true) {
    iniciarSesion(TODOS);
    v = await montar(<NotificacionesProvider><Lista /><Acciones /></NotificacionesProvider>, { conSocket: true });
    if (esperarSocket) await esperar(() => srv.sockets.size === 1, { que: 'el socket conectado' });
    await pasar(500);
}

describe('Fase D — el globito de no leídas y las cargas ajenas', () => {
    it('FD-1: notificacion:silenciosa suma al globito y avisa al popover (nonce), pero no muestra aviso emergente', async () => {
        await abrirConAcciones();
        expect(noLeidas()).toBe(3);
        const n0 = nonce();
        srv.emitir('notificacion:silenciosa', notifNueva(80));
        await esperar(() => noLeidas() === 4, { que: 'el globito en 4' });
        await pasar(300);
        expect(toasts()).toEqual([]);
        expect(nonce()).toBeGreaterThan(n0);
        expect(noLeidas()).toBe(4);
    });

    it('FD-2: notificacion:nueva sigue mostrando el aviso del dueño', async () => {
        await abrirConAcciones();
        srv.emitir('notificacion:nueva', notifNueva(81, { titulo: 'Tu carga terminó' }));
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts()).toEqual([{ variante: 'info', texto: 'Tu carga terminó' }]);
        expect(noLeidas()).toBe(4);
    });

    it('FD-3 (regresión del OBSERVADO): la respuesta rezagada del contador no baja el globito', async () => {
        lista = [corriendo(201), enCola(203, 1)];
        await abrir();
        expect(noLeidas()).toBe(3);
        // El GET del contador lee 3 y tarda 400 ms en responder; a los 100 ms el backend da de alta la notificación y avisa por socket.
        srv.en('GET', CONTADOR, () => ({ body: { noLeidas: 3 }, demoraMs: 400 }));
        lista = [enCola(203, 0)];
        srv.emitir('import:finalizada', finalizada(201));
        await pasar(100);
        srv.emitir('notificacion:nueva', notifNueva(77));
        srv.emitir('notificacion:contador', { noLeidas: 4 });
        await pasar(100);
        expect(noLeidas()).toBe(4);
        await pasar(800);
        expect(noLeidas()).toBe(4);
    });

    it('FD-4: marcarLeida — el contador del socket llega antes que la respuesta del POST: queda en 2, no en 1', async () => {
        await abrirConAcciones();
        srv.en('POST', /^\/notificaciones\/(\d+)\/leer$/, () => { srv.emitir('notificacion:contador', { noLeidas: 2 }); return { status: 201, body: {}, demoraMs: 100 }; });
        await ref.leida!(10);
        await pasar(300);
        expect(noLeidas()).toBe(2);
    });

    it('FD-5: marcarLeida — responde el POST primero y el contador llega 200 ms después: 2 y sigue en 2', async () => {
        await abrirConAcciones();
        srv.en('POST', /^\/notificaciones\/(\d+)\/leer$/, () => { setTimeout(() => srv.emitir('notificacion:contador', { noLeidas: 2 }), 200); return { status: 201, body: {} }; });
        await ref.leida!(10);
        await pasar(50);
        expect(noLeidas()).toBe(2);
        await pasar(400);
        expect(noLeidas()).toBe(2);
    });

    it('FD-6: marcarTodas — antes de la respuesta llegan una nueva y contador {1}: queda en 1, no en 0', async () => {
        await abrirConAcciones();
        srv.en('POST', /^\/notificaciones\/leer-todas$/, () => {
            srv.emitir('notificacion:nueva', notifNueva(82));
            srv.emitir('notificacion:contador', { noLeidas: 1 });
            return { status: 201, body: {}, demoraMs: 100 };
        });
        await ref.todas!();
        await pasar(300);
        expect(noLeidas()).toBe(1);
    });

    it('marcarLeida y marcarTodas sin nada en el medio siguen descontando y poniendo 0', async () => {
        await abrirConAcciones();
        srv.en('POST', /^\/notificaciones\/(\d+)\/leer$/, () => ({ status: 201, body: {} }));
        srv.en('POST', /^\/notificaciones\/leer-todas$/, () => ({ status: 201, body: {} }));
        const n0 = nonce();
        await ref.leida!(10);
        await pasar(100);
        expect(noLeidas()).toBe(2);
        await ref.todas!();
        await pasar(100);
        expect(noLeidas()).toBe(0);
        expect(nonce()).toBe(n0 + 2);
    });

    it('FD-7: dos hidrataciones cruzadas, la más vieja responde última: queda el valor de la más nueva', async () => {
        await abrirConAcciones();
        const valores = [{ noLeidas: 3, demoraMs: 600 }, { noLeidas: 5, demoraMs: 50 }];
        srv.en('GET', CONTADOR, () => { const r = valores.shift()!; return { body: { noLeidas: r.noLeidas }, demoraMs: r.demoraMs }; });
        const vieja = ref.refrescar!();
        await pasar(100);
        const nueva = ref.refrescar!();
        await Promise.all([vieja, nueva]);
        await pasar(200);
        expect(noLeidas()).toBe(5);
    });

    it('FD-8: cerrar sesión con una hidratación en vuelo deja el globito en 0', async () => {
        iniciarSesion(TODOS);
        srv.en('GET', CONTADOR, () => ({ body: { noLeidas: 7 }, demoraMs: 800 }));
        v = await montar(<NotificacionesProvider><Lista /><Acciones /></NotificacionesProvider>, { conSocket: true });
        await pasar(200);
        ref.salir!();
        // Que React aplique el cierre de sesión ANTES de que llegue la respuesta (si no, la prueba pasa con el contexto
        // viejo: lo encontró la auditoría de la Fase D).
        await pasar(0);
        await pasar(1500);
        expect(noLeidas()).toBe(0);
    });

    it('FD-9: cerrar sesión con la lista de cargas en vuelo no repone las cargas de la sesión anterior (auditoría Fase D)', async () => {
        lista = [corriendo(201)];
        demoraLista = 800;
        iniciarSesion(TODOS);
        v = await montar(<NotificacionesProvider><Lista /><Acciones /></NotificacionesProvider>, { conSocket: true });
        await pasar(200);
        ref.salir!();
        await pasar(0);
        await pasar(1500);
        expect(ids()).toEqual([]);
    });
});
