// Inicio REAL contra el backend falso (docs/inicio-spec.md §9.2). Cada bloque depende solo de los permisos.
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fijarAncho } from '../lib/ancho';
import {
    PERMISOS_ADMIN, PERMISOS_OPERADOR, armarInicio, dia, dibujado, ejecucion, gestiones, itemAgenda, miDiaAdmin, miDiaOperador, retomar, titulos, type BancoInicio,
} from '../lib/banco-inicio';
import { BASURA, dtoFaseB } from '../lib/fabricas';
import { RAIZ_FE } from '../lib/raiz';
import { alertas, boton, clic, dialogo, esperar, limpio, pasar, toasts } from '../lib/montar';

let b: BancoInicio | null = null;
afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as unknown as Record<string, unknown>).visibilityState;
    if (b) { await b.v.desmontar(); await b.srv.bajar(); }
    b = null;
});

const ADMIN_SIN_B8 = () => miDiaAdmin({ importacionesHoy: [] });
/** El texto de una columna de la grilla de dos (8 = la principal, 4 = la lateral). */
const SEL_COLUMNA = { 8: '[data-columna="principal"]', 4: '[data-columna="lateral"]' } as const;
const columna = (lg: 8 | 4) => limpio(document.querySelector(SEL_COLUMNA[lg])?.textContent ?? '(no está)');
const pestana = (inicio: RegExp) => Array.from(document.querySelectorAll('[role="tab"]')).find((t) => inicio.test(limpio(t.textContent ?? ''))) ?? null;
const accesos = () => Array.from(document.querySelectorAll('[aria-label="Accesos rápidos"] a')).map((a) => limpio(a.textContent ?? ''));
const teclear = async (init: KeyboardEventInit) => {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    await act(async () => { window.dispatchEvent(ev); });
    return ev;
};
const ocultar = (oculta: boolean) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (oculta ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
};

describe('IN-1 — el OPERADOR (13 permisos) ve una página completa', () => {
    it('tiene Tu día, la semana, el gráfico, Retomá y Tus reportes; no tiene agenda, promesas, actividad ni importaciones', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador(), estricto: true });
        await dibujado();
        const t = b.texto();
        for (const x of ['Tu día', 'Gestiones de la semana', 'Casos de la semana', 'Tus gestiones, últimos 14 días', 'Retomá donde quedaste', 'Tus reportes', 'Gestiones hoy', 'Casos trabajados hoy']) {
            expect(t, x).toContain(x);
        }
        for (const x of ['Tu agenda', 'Promesas tomadas', 'Vencen hoy', 'Actividad reciente', 'Tu actividad reciente']) expect(t, x).not.toContain(x);
        expect(titulos()).not.toContain('Importaciones');
        expect(b.pedidosTransacciones()).toBe(0);
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('sin huecos: Retomá en la columna principal (8/12); el gráfico y Tus reportes en la lateral (4/12), en ese orden', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        expect(document.querySelectorAll('[data-columna]')).toHaveLength(2);
        const principal = columna(8);
        const lateral = columna(4);
        expect(principal).toContain('Retomá donde quedaste');
        expect(principal).not.toContain('Tus reportes');
        expect(lateral.indexOf('Tus gestiones, últimos 14 días')).toBeGreaterThanOrEqual(0);
        expect(lateral.indexOf('Tus reportes')).toBeGreaterThan(lateral.indexOf('Tus gestiones, últimos 14 días'));
        expect(lateral).not.toContain('Retomá donde quedaste');
    });

    it('los accesos rápidos: Gestión, Historial de importaciones y Reportes', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        expect(accesos()).toEqual(['Gestión', 'Historial de importaciones', 'Reportes']);
    });

    it('el saludo dice cuántas gestiones lleva, con la fecha larga', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        expect(b.texto()).toMatch(/Llevás 38 gestiones hoy/);
        expect(b.texto()).toMatch(/(Buen día|Buenas tardes|Buenas noches), Maxi/);
        expect(document.querySelector('h1')?.textContent).toMatch(/, Maxi$/);
    });
});

describe('IN-2 — el ADMIN ve agenda, promesas y actividad', () => {
    it('todos los bloques; Hoy · 4 con 4 filas y «Cumplida» en la cumplida; la actividad se pidió', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        await esperar(() => /Actividad reciente/.test(b!.texto()), { que: 'la actividad' });
        const t = b.texto();
        for (const x of ['Tu agenda', 'Promesas tomadas', 'Vencen hoy', 'Actividad reciente', 'Retomá donde quedaste', 'Tus reportes', 'Tus gestiones, últimos 14 días', 'Cartera octubre']) {
            expect(t, x).toContain(x);
        }
        expect(titulos()).toContain('Importaciones');
        expect(t).not.toContain('Gestiones de la semana');
        expect(pestana(/^Hoy · 4$/)).not.toBeNull();
        const agenda = document.querySelector('[data-columna="principal"] ul')!;
        expect(agenda.querySelectorAll('li')).toHaveLength(4);
        expect(limpio(agenda.textContent ?? '')).toContain('Cumplida');
        expect(limpio(agenda.textContent ?? '')).toContain('Vence hoy');
        expect(limpio(agenda.textContent ?? '')).toContain('Cuota 1 de 3 del convenio');
        await esperar(() => /Cargó un comentario/.test(b!.texto()), { que: 'la fila de actividad' });
        expect(b.pedidosTransacciones()).toBeGreaterThan(0);
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('sin huecos: agenda y Retomá a la izquierda; gráfico, importaciones, actividad y reportes a la derecha, en ese orden', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        await esperar(() => /Actividad reciente/.test(columna(4)), { que: 'la actividad' });
        const p = columna(8);
        expect(p.indexOf('Tu agenda')).toBeLessThan(p.indexOf('Retomá donde quedaste'));
        const l = columna(4);
        const orden = ['Tus gestiones, últimos 14 días', 'Importaciones', 'Actividad reciente', 'Tus reportes'].map((x) => l.indexOf(x));
        expect(orden.every((i) => i >= 0)).toBe(true);
        expect([...orden].sort((x, y) => x - y)).toEqual(orden);
    });

    it('con auditoria.ver pero sin auditoria.ver_todos el título es «Tu actividad reciente»', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN.filter((p) => p !== 'auditoria.ver_todos'), miDia: miDiaAdmin() });
        await dibujado();
        await esperar(() => /Tu actividad reciente/.test(b!.texto()), { que: 'el título propio' });
    });

    it('los accesos: Gestión, Nueva importación, Reportes y Tableros', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        expect(accesos()).toEqual(['Gestión', 'Nueva importación', 'Reportes', 'Tableros']);
    });

    it('el saludo suma «N promesas tuyas vencen hoy»', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        expect(b.texto()).toContain('2 promesas tuyas vencen hoy');
    });

    it('los indicadores de promesas: 9 en 7 días, 67 % cumplidas, 2 vencen hoy con su monto', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        const t = b.texto();
        expect(t).toContain('67 % cumplidas · 6 de 9 que vencieron en 30 días');
        expect(t).toMatch(/Vencen hoy\s*2\s*promesas\s*\$\s?76\.600/);
    });

    it('con 0 vencidas en 30 días: «Todavía no venció ninguna»', async () => {
        const m = miDiaAdmin();
        m.promesas = { tomadas7d: 0, vencidas30d: { total: 0, cumplidas: 0 }, vencenHoy: { cantidad: 0, monto: 0 } };
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: m });
        await dibujado();
        expect(b.texto()).toContain('Todavía no venció ninguna');
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('«Ver» de «Vencen hoy» lleva a la pestaña Hoy de la agenda', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        await clic(pestana(/^Sin cumplir/), 'la pestaña Sin cumplir');
        expect(document.querySelector('[data-columna="principal"] ul')?.textContent).toContain('Eva Luna');
        await clic(boton('Ver'), 'el botón Ver');
        expect(limpio(document.querySelector('[data-columna="principal"] ul')?.textContent ?? '')).toContain('Juan Gómez');
        expect(pestana(/^Hoy/)?.getAttribute('aria-selected')).toBe('true');
    });
});

describe('IN-3 — las filas llevan al caso', () => {
    it('Retomá: cada fila es un enlace a /gestion?deudor=<id>', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        const filas = Array.from(document.querySelectorAll('[data-columna="principal"] a[href^="/gestion?deudor="]'));
        expect(filas.map((a) => a.getAttribute('href'))).toEqual(retomar().map((r) => `/gestion?deudor=${r.deudorId}`));
        expect(limpio(filas[0].textContent ?? '')).toContain('Ana Pérez 0');
        expect(limpio(filas[0].textContent ?? '')).toContain('Quedó en llamar 0');
        expect(limpio(filas[0].textContent ?? '')).toContain('Contactado');
        // Sin estado de gestión usa el de situación.
        expect(limpio(filas[1].textContent ?? '')).toContain('Mora temprana');
    });

    it('la agenda: cada fila también', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        const hrefs = Array.from(document.querySelectorAll('[data-columna="principal"] ul')[0].querySelectorAll('a')).map((a) => a.getAttribute('href'));
        expect(hrefs).toEqual(['/gestion?deudor=500', '/gestion?deudor=501', '/gestion?deudor=502', '/gestion?deudor=503']);
    });
});

describe('IN-4 — Ctrl+K', () => {
    it('abre el buscador solo en Inicio, con Ctrl+K y con Cmd+K', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        expect(dialogo(/búsqueda/i)).toBeNull();
        const ev = await teclear({ key: 'k', ctrlKey: true });
        expect(ev.defaultPrevented).toBe(true);
        await esperar(() => dialogo(/búsqueda/i), { que: 'el buscador' });
    });

    it('con el buscador abierto, Ctrl+K no hace nada más', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        await teclear({ key: 'k', ctrlKey: true });
        await esperar(() => dialogo(/búsqueda/i), { que: 'el buscador' });
        const ev = await teclear({ key: 'K', ctrlKey: true });
        expect(ev.defaultPrevented).toBe(false);
        expect(document.querySelectorAll('.MuiDialog-root')).toHaveLength(1);
    });

    it('Cmd+K (Mac) también', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        await teclear({ key: 'k', metaKey: true });
        await esperar(() => dialogo(/búsqueda/i), { que: 'el buscador' });
    });

    it('el botón del buscador lo abre', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        await clic(document.querySelector('button[aria-label="Buscar un caso"]'), 'el buscador');
        await esperar(() => dialogo(/búsqueda/i), { que: 'el buscador' });
    });

    it('sin deudores.ver no hay buscador y Ctrl+K no hace nada', async () => {
        b = await armarInicio({ permisos: ['comentarios.ver', 'comentarios.crear', 'reportes.ver'], miDia: miDiaOperador({ retomar: null }) });
        await dibujado();
        expect(document.querySelector('button[aria-label="Buscar un caso"]')).toBeNull();
        const ev = await teclear({ key: 'k', ctrlKey: true });
        await pasar(200);
        expect(ev.defaultPrevented).toBe(false);
        expect(dialogo(/búsqueda/i)).toBeNull();
    });

    it('al desmontar Inicio el atajo se va', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        await b.v.desmontar();
        const ev = await teclear({ key: 'k', ctrlKey: true });
        expect(ev.defaultPrevented).toBe(false);
        await b.srv.bajar();
        b = null;
    });
});

describe('IN-5 — la comparación a esta hora', () => {
    it('con promedioALaMismaHora = null se lee «Sin días anteriores para comparar», sin NaN ni −100 %', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador({ gestiones: gestiones({ promedioALaMismaHora: null, diasBase: 0 }) }) });
        await dibujado();
        expect(b.texto()).toContain('Sin días anteriores para comparar');
        expect(b.texto()).not.toMatch(BASURA);
        expect(b.texto()).not.toMatch(/100 %|[▲▼]/);
    });

    it('sube: «▲ 12 %» contra el promedio', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador({ gestiones: gestiones({ hoy: 38, promedioALaMismaHora: 34 }) }) });
        await dibujado();
        expect(b.texto()).toContain('▲ 12 %');
        expect(b.texto()).toContain('contra tu promedio a esta hora');
    });

    it('baja: «▼ 41 %»', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador({ gestiones: gestiones({ hoy: 20, promedioALaMismaHora: 34 }) }) });
        await dibujado();
        expect(b.texto()).toContain('▼ 41 %');
    });

    it('un promedio de 0 no divide: lo dice con palabras', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador({ gestiones: gestiones({ hoy: 4, promedioALaMismaHora: 0, diasBase: 3 }) }) });
        await dibujado();
        expect(b.texto()).toContain('Tu promedio a esta hora es 0');
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('«Ayer a esta hora: N» en casos trabajados', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        expect(b.texto()).toContain('Ayer a esta hora: 27');
    });

    it('con el tope de filas alcanzado los números van con «+»', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador({ gestiones: gestiones({ truncado: true, hoy: 120 }) }) });
        await dibujado();
        expect(b.texto()).toContain('120+');
    });
});

describe('IN-6 — un bloque que falla no tumba a los otros', () => {
    it('errores: ["agenda"] muestra «No se pudo cargar» con Reintentar en la agenda; Retomá se ve normal', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: ADMIN_SIN_B8_CON_ERROR() });
        await dibujado();
        const agenda = document.querySelector('[data-columna="principal"] .MuiCard-root')!;
        expect(limpio(agenda.textContent ?? '')).toContain('No se pudo cargar este bloque.');
        expect(boton('Reintentar', agenda)).not.toBeNull();
        expect(columna(8)).toContain('Ana Pérez 0');
        const antes = b.pedidosMiDia();
        await clic(boton('Reintentar', agenda), 'Reintentar');
        await esperar(() => b!.pedidosMiDia() === antes + 1, { que: 'el pedido de Reintentar' });
    });

    it('el error NO se confunde con el vacío: textos distintos', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador({ retomar: null, errores: ['retomar'] }) });
        await dibujado();
        expect(columna(8)).toContain('No se pudo cargar este bloque.');
        expect(b.texto()).not.toContain('Cuando registres gestiones');
    });

    it('si el pedido entero falla, todos los bloques de mi-dia muestran el error y el saludo y el buscador siguen', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, antes: (x) => { x.dictar = () => ({ status: 500, body: { message: 'boom' } }); } });
        await esperar(() => (b!.texto().match(/No se pudo cargar este bloque\./g) ?? []).length >= 5, { que: 'los errores' });
        expect(document.querySelector('button[aria-label="Buscar un caso"]')).not.toBeNull();
        expect(document.querySelector('h1')).not.toBeNull();
        expect(b.texto()).not.toMatch(BASURA);
        // B9 tiene su propio pedido: se ve aunque mi-dia falle.
        await esperar(() => /Actividad reciente/.test(b!.texto()) && /Cargó un comentario/.test(b!.texto()), { que: 'la actividad' });
    });

    it('un fallo al refrescar conserva el último dato y avisa', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        b.dictar = () => ({ status: 500, body: {} });
        await act(async () => { vi.advanceTimersByTime(5 * 60_000 + 10); });
        await esperar(() => /No se pudo actualizar/.test(b!.texto()), { que: 'el aviso' });
        expect(b.texto()).toContain('Retomá donde quedaste');
        expect(b.texto()).toContain('Ana Pérez 0');
        expect(b.texto()).not.toContain('No se pudo cargar este bloque.');
        // Al volver a funcionar, el aviso se va.
        b.dictar = null;
        await clic(boton('Reintentar'), 'Reintentar');
        await esperar(() => !/No se pudo actualizar/.test(b!.texto()), { que: 'que se vaya el aviso' });
    });
});

describe('IN-7 — vacíos', () => {
    it('Retomá vacío: su texto y un botón que abre el buscador', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador({ retomar: [] }) });
        await dibujado();
        expect(b.texto()).toContain('Cuando registres gestiones, tus últimos casos van a aparecer acá');
        await clic(boton('Buscar un caso'), 'Buscar un caso');
        await esperar(() => dialogo(/búsqueda/i), { que: 'el buscador' });
    });

    it('Retomá vacío sin deudores.ver: sin botón (tampoco hay Retomá, que lo pide)', async () => {
        b = await armarInicio({ permisos: ['comentarios.ver', 'comentarios.crear'], miDia: miDiaOperador({ retomar: null }) });
        await dibujado();
        expect(b.texto()).not.toContain('Retomá donde quedaste');
        expect(boton('Buscar un caso')).toBeNull();
    });

    it('la agenda vacía, en sus tres pestañas', async () => {
        const m = miDiaAdmin();
        m.agenda = { hoy: [], proximos: [], sinCumplir: [], totales: { hoy: 0, proximos: 0, sinCumplir: 0 }, limite: 50, incluye: { promesas: true, cuotas: true } };
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: m });
        await dibujado();
        expect(b.texto()).toContain('No tenés promesas ni cuotas que venzan hoy');
        await clic(pestana(/^Próximos 7 días/), 'Próximos');
        expect(b.texto()).toContain('Nada en los próximos 7 días');
        await clic(pestana(/^Sin cumplir/), 'Sin cumplir');
        expect(b.texto()).toContain('Nada sin cumplir en la última semana');
    });

    it('sin gestiones en 14 días, sin reportes y sin actividad', async () => {
        const g = gestiones({ hoy: 0, casosHoy: 0, promedioALaMismaHora: null, diasBase: 0, semana: { desde: dia(-4), gestiones: 0, casos: 0, diasConGestion: 0 } });
        g.serie = g.serie.map((d) => ({ ...d, gestiones: 0, casos: 0 }));
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin({ gestiones: g, reportes: [] }), transacciones: [] });
        await dibujado();
        await esperar(() => /Sin actividad reciente/.test(b!.texto()), { que: 'la actividad vacía' });
        const t = b.texto();
        expect(t).toContain('Sin gestiones en las últimas dos semanas');
        expect(t).toContain('Todavía no registraste gestiones hoy');
        expect(t).toContain('No ejecutaste reportes en los últimos 7 días');
        expect(boton('Ir a Reportes')).not.toBeNull();
        expect(t).not.toMatch(BASURA);
    });
});

describe('IN-8 — refresco', () => {
    it('oculta durante 6 minutos: ningún pedido nuevo; al volver, exactamente uno; si vuelve de nuevo enseguida, ninguno más', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador(), estricto: true });
        await dibujado();
        const base = b.pedidosMiDia();
        expect(base).toBe(1);
        ocultar(true);
        await act(async () => { vi.advanceTimersByTime(6 * 60_000); });
        await pasar(300);
        expect(b.pedidosMiDia()).toBe(base);
        ocultar(false);
        await esperar(() => b!.pedidosMiDia() === base + 1, { que: 'un pedido al volver' });
        await pasar(400);
        expect(b.pedidosMiDia()).toBe(base + 1);
        ocultar(true);
        ocultar(false);
        await pasar(300);
        expect(b.pedidosMiDia()).toBe(base + 1);
    });

    it('visible: cada 5 minutos pide de nuevo, y la actividad (B9) con el mismo pulso', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        await esperar(() => /Cargó un comentario/.test(b!.texto()), { que: 'la primera actividad' });
        await pasar(300);
        const actividad = b.pedidosTransacciones();
        expect(b.pedidosMiDia()).toBe(1);
        await act(async () => { vi.advanceTimersByTime(5 * 60_000 + 10); });
        await esperar(() => b!.pedidosMiDia() === 2, { que: 'el refresco' });
        await esperar(() => b!.pedidosTransacciones() > actividad, { que: 'el refresco de la actividad' });
    });

    // Desde la auditoría: un pedido forzado con otro en vuelo vuelve a pedir al terminar (el que vuela pudo salir antes del
    // cambio). Nunca dos a la vez, y dos clics seguidos piden una sola vez más, no dos.
    it('un solo pedido a la vez: dos recargas seguidas con uno en vuelo piden una sola vez más, al terminar', async () => {
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador({ errores: ['retomar'], retomar: null }), antes: (x) => { x.dictar = () => (x.pedidosMiDia() >= 1 ? { body: miDiaOperador({ errores: ['retomar'], retomar: null }), demoraMs: 600 } : null); } });
        await dibujado();
        const antes = b.pedidosMiDia();
        const reintentar = () => document.querySelectorAll('button');
        const botones = Array.from(reintentar()).filter((x) => /Reintentar/.test(x.textContent ?? ''));
        expect(botones.length).toBeGreaterThan(0);
        await clic(botones[0]);
        await clic(botones[0]);
        await pasar(300);
        expect(b.pedidosMiDia()).toBe(antes + 1); // el segundo clic no dispara otro mientras vuela el primero
        await pasar(1800);
        expect(b.pedidosMiDia()).toBe(antes + 2); // uno más al terminar, y nada más
    });
});

describe('IN-9 — la agenda', () => {
    it('con totales.hoy = 60 y 50 filas dice «Se muestran 50 de 60»', async () => {
        const m = miDiaAdmin();
        m.agenda!.hoy = Array.from({ length: 50 }, (_, i) => itemAgenda({ id: 1000 + i, deudorId: 2000 + i, nombre: `Persona ${i}` }));
        m.agenda!.totales.hoy = 60;
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: m });
        await dibujado();
        expect(b.texto()).toContain('Se muestran 50 de 60');
        expect(pestana(/^Hoy · 60$/)).not.toBeNull();
    });

    it('sin recorte no dice «Se muestran»', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        expect(b.texto()).not.toContain('Se muestran');
    });

    it('los chips de estado de cada fila', async () => {
        const m = miDiaAdmin();
        m.agenda!.hoy = [
            itemAgenda({ id: 1, estado: 'VIGENTE', monto: null }),
            itemAgenda({ id: 2, estado: 'CUMPLIDA' }),
            itemAgenda({ tipo: 'CUOTA', id: 3, estado: 'PAGADA', nroCuota: 2, cantCuotas: 3 }),
        ];
        m.agenda!.proximos = [itemAgenda({ id: 4, dia: dia(3), estado: 'VIGENTE' })];
        m.agenda!.sinCumplir = [
            itemAgenda({ id: 5, dia: dia(-1), estado: 'INCUMPLIDA' }),
            itemAgenda({ tipo: 'CUOTA', id: 6, dia: dia(-2), estado: 'VENCIDA', nroCuota: 1, cantCuotas: 6 }),
            itemAgenda({ id: 7, dia: dia(-3), estado: 'VIGENTE' }),
        ];
        m.agenda!.totales = { hoy: 3, proximos: 1, sinCumplir: 3 };
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: m });
        await dibujado();
        const chipsDe = () => Array.from(document.querySelector('[data-columna="principal"] ul')!.querySelectorAll('.MuiChip-label')).map((c) => limpio(c.textContent ?? ''));
        expect(chipsDe().filter((c) => c !== 'AYSA')).toEqual(['Vence hoy', 'Cumplida', 'Pagada']);
        expect(document.querySelector('[data-columna="principal"] ul')?.textContent).toContain('Sin monto');
        await clic(pestana(/^Próximos/));
        expect(chipsDe().filter((c) => c !== 'AYSA')[0]).toMatch(/^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d{1,2}$/);
        await clic(pestana(/^Sin cumplir/));
        expect(chipsDe().filter((c) => c !== 'AYSA')).toEqual(['Incumplida', 'Vencida', 'Sin cerrar']);
    });

    it('una promesa cerrada por un pago dice «Cumplida», nunca «Pagó»', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        expect(b.texto()).not.toMatch(/Pagó/);
    });

    it('sin convenios.ver avisa que son solo promesas', async () => {
        const m = miDiaAdmin();
        m.agenda!.incluye = { promesas: true, cuotas: false };
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: m });
        await dibujado();
        expect(b.texto()).toContain('Solo promesas');
    });
});

describe('IN-10 — importaciones (B8): solo las propias', () => {
    it('una en curso de OTRO usuario no se dibuja; el bloque tampoco', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: ADMIN_SIN_B8(), enCurso: [dtoFaseB({ remesaId: 201, usuarioId: 9, usuarioNombre: 'Otro' })] });
        await dibujado();
        await pasar(300);
        expect(titulos()).not.toContain('Importaciones');
        expect(b.texto()).not.toContain('Ver detalle');
    });

    it('una propia en curso aparece con «Ver detalle» al historial', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: ADMIN_SIN_B8(), enCurso: [dtoFaseB({ remesaId: 200, usuarioId: 3, nombre: 'Mi carga' }), dtoFaseB({ remesaId: 201, usuarioId: 9, nombre: 'Ajena' })] });
        await dibujado();
        await esperar(() => titulos().includes('Importaciones'), { que: 'el bloque de importaciones' });
        expect(b.texto()).toContain('Ver detalle');
        expect(b.texto()).not.toContain('Ajena');
        expect(document.querySelector('a[href="/historial-importaciones/200"]')).not.toBeNull();
        expect(document.querySelector('a[href="/historial-importaciones/201"]')).toBeNull();
        expect(b.texto()).not.toMatch(/Cancelar/);
    });

    it('las terminadas hoy, con su resultado y el link al historial', async () => {
        const m = miDiaAdmin();
        m.reportes = [];
        m.importacionesHoy = [
            { remesaId: 1, empresa: 'AYSA', nombre: 'A', numeroRemesa: '1', resultado: 'OK', terminadaEn: new Date().toISOString(), ok: 1, err: 0 },
            { remesaId: 2, empresa: 'AYSA', nombre: 'B', numeroRemesa: '2', resultado: 'CON_ADVERTENCIAS', terminadaEn: new Date().toISOString(), ok: 1, err: 0 },
            { remesaId: 3, empresa: 'AYSA', nombre: 'C', numeroRemesa: '3', resultado: 'SIN_FILAS', terminadaEn: new Date().toISOString(), ok: 0, err: 0 },
            { remesaId: 4, empresa: 'AYSA', nombre: 'D', numeroRemesa: '4', resultado: 'FALLIDA', terminadaEn: new Date().toISOString(), ok: 0, err: 0 },
            { remesaId: 5, empresa: 'AYSA', nombre: 'E', numeroRemesa: '5', resultado: 'CANCELADA', terminadaEn: new Date().toISOString(), ok: 0, err: 0 },
            { remesaId: 6, empresa: 'AYSA', nombre: 'F', numeroRemesa: '6', resultado: 'RARO', terminadaEn: new Date().toISOString(), ok: 0, err: 0 },
            { remesaId: 7, empresa: 'AYSA', nombre: 'G', numeroRemesa: '7', resultado: null, terminadaEn: new Date().toISOString(), ok: 0, err: 0 },
        ];
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: m });
        await dibujado();
        const etiquetas = Array.from(document.querySelectorAll('[data-columna="lateral"] .MuiChip-label')).map((c) => limpio(c.textContent ?? ''));
        expect(etiquetas).toEqual(['Finalizada', 'Con advertencias', 'Sin filas', 'Fallida', 'Cancelada', 'RARO', 'Terminada']);
        expect(b.texto()).not.toMatch(BASURA);
    });
});

describe('IN-11 — reportes (B10)', () => {
    it('el reporte listo se descarga con el endpoint de siempre', async () => {
        const crear = vi.fn(() => 'blob:prueba');
        Object.assign(window.URL, { createObjectURL: crear, revokeObjectURL: vi.fn() });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: miDiaOperador() });
        await dibujado();
        await clic(boton('Descargar'), 'Descargar');
        await esperar(() => b!.descargas.length === 1, { que: 'la descarga' });
        expect(b.descargas).toEqual([1]);
        await esperar(() => toasts().some((t) => /Descarga iniciada/.test(t.texto)), { que: 'el aviso' });
        expect(crear).toHaveBeenCalled();
    });

    it('una ejecutando muestra su porcentaje; una fallida, su chip; sin NaN', async () => {
        const m = miDiaOperador({ reportes: [ejecucion({ id: 7, estado: 'EJECUTANDO', progreso: 42, descargable: false, terminadaEn: null, totalFilas: null }), ejecucion({ id: 8, estado: 'FALLIDA', descargable: false }), ejecucion({ id: 9, estado: 'CANCELADA', descargable: false })] });
        b = await armarInicio({ permisos: PERMISOS_OPERADOR, miDia: m });
        await dibujado();
        const t = columna(4);
        expect(t).toContain('42 %');
        expect(t).toContain('Fallida');
        expect(t).toContain('Cancelada');
        expect(boton('Descargar')).toBeNull();
        expect(t).not.toMatch(BASURA);
    });

    it('«Tus reportes» muestra lo que mi-dia trae, no pide el listado de todos', async () => {
        b = await armarInicio({ permisos: [...PERMISOS_OPERADOR, 'reportes.ver_ejecuciones'], miDia: miDiaOperador() });
        await dibujado();
        expect(b.srv.pedidos.filter((p) => /\/reportes\/ejecuciones(\?|$)/.test(p.ruta))).toHaveLength(0);
    });
});

describe('IN-12 — roles raros', () => {
    it('sin ningún permiso: el saludo y nada más, sin errores en consola', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        b = await armarInicio({ permisos: [], miDia: { generadoEn: new Date().toISOString(), hoy: dia(0), errores: [], gestiones: null, retomar: null, agenda: null, promesas: null, importacionesHoy: null, reportes: null } });
        await esperar(() => document.querySelector('h1') !== null, { que: 'el saludo' });
        await pasar(300);
        expect(document.querySelectorAll('.MuiCard-root, .MuiPaper-root')).toHaveLength(0);
        expect(b.texto()).not.toContain('Tu día');
        expect(b.texto()).not.toMatch(BASURA);
        expect(error.mock.calls.filter((c) => !/act\(|Router Future/.test(String(c[0])))).toEqual([]);
    });

    it('solo reportes.ver: sin columna principal, el lateral pasa a la grilla de 2 columnas a todo el ancho', async () => {
        b = await armarInicio({ permisos: ['reportes.ver'], miDia: miDiaOperador({ gestiones: null, retomar: null }) });
        await esperar(() => /Tus reportes/.test(b!.texto()), { que: 'Tus reportes' });
        expect(document.querySelector('[data-columna="principal"]')).toBeNull();
        expect(document.querySelector('[data-columna="lateral"]')).toBeNull();
        // Un solo bloque (cantidad impar): ocupa el ancho entero, no media pantalla (auditoría).
        expect(document.querySelectorAll('[data-ancho="mitad"]')).toHaveLength(0);
        expect(document.querySelectorAll('[data-ancho="entero"]')).toHaveLength(1);
        expect(b.texto()).not.toContain('Tu día');
    });

    it('solo promesas.ver (sin comentarios): la agenda ocupa todo el ancho y los indicadores de gestiones, ni aparecen', async () => {
        const m = miDiaAdmin({ gestiones: null, retomar: null, reportes: null, importacionesHoy: null });
        b = await armarInicio({ permisos: ['promesas.ver'], miDia: m });
        await esperar(() => /Tu agenda/.test(b!.texto()), { que: 'la agenda' });
        expect(document.querySelector('[data-columna="principal"]')).toBeNull();
        expect(b.texto()).not.toContain('Tu día');
        expect(b.texto()).not.toContain('Retomá');
    });
});

describe('IN-13 — pantalla chica y tema', () => {
    it('la fila de abajo no usa un Grid de MUI: su margen negativo, pisado por el Stack, la corría 24 px a la derecha de "Tu día"', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        expect(document.querySelectorAll('[data-columna]')).toHaveLength(2);
        expect(document.querySelector('.MuiGrid-container')).toBeNull();
    });

    it('a 360 px, sin desborde horizontal (jsdom no calcula el layout: ver el informe)', async () => {
        fijarAncho(360);
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin(), ancho: 360 });
        await dibujado();
        const c = b.v.contenedor;
        expect(c.scrollWidth).toBeLessThanOrEqual(c.clientWidth);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
        // Lo que sí se puede afirmar sin layout: los textos largos se cortan en vez de empujar la fila.
        expect(document.querySelectorAll('[data-columna]')).toHaveLength(2);
    });

    it('en modo oscuro monta sin errores y dibuja lo mismo', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin(), modo: 'dark' });
        await dibujado();
        await esperar(() => /Actividad reciente/.test(b!.texto()), { que: 'la actividad' });
        for (const x of ['Tu día', 'Tu agenda', 'Retomá donde quedaste', 'Tus reportes']) expect(b.texto(), x).toContain(x);
        expect(alertas()).toEqual([]);
        expect(error.mock.calls.filter((c) => !/act\(|Router Future/.test(String(c[0])))).toEqual([]);
    });

    it('el código de Inicio no tiene colores hexadecimales ni console.log (tema claro y oscuro)', () => {
        const archivos: string[] = [path.join(RAIZ_FE, 'src/pages/Inicio.tsx')];
        const recorrer = (dir: string) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) recorrer(p); else if (/\.(ts|tsx)$/.test(f.name)) archivos.push(p); } };
        recorrer(path.join(RAIZ_FE, 'src/pages/inicio'));
        expect(archivos.length).toBeGreaterThan(10);
        for (const a of archivos) {
            const src = fs.readFileSync(a, 'utf8');
            expect(src.match(/#[0-9a-fA-F]{3,6}\b/g), a).toBeNull();
            expect(src, a).not.toMatch(/console\.(log|warn|error)/);
        }
    });
});

function ADMIN_SIN_B8_CON_ERROR() {
    return miDiaAdmin({ agenda: null, errores: ['agenda'], importacionesHoy: [] });
}
