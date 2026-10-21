// Asistente de IA, Fase A: los arreglos de la auditoría (panel fijo desde xl, cartel de pausa que se va solo, parser SSE con \r\n partido,
// respuesta que sigue escribiéndose en el servidor y 429 por código).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clic, esperar, limpio, pasar } from '../lib/montar';
import { fijarAncho } from '../lib/ancho';
import { act } from 'react';
import {
    ESTADO, abrirPanel, alertasDelPanel, armarIA, bajarIA, botonDetener, botonEnviar, burbujas, entrada, estadoIA, ev, panel,
    preguntarAlAsistente, ultimaBurbuja, type BancoIA,
} from '../lib/banco-ia';
import { evento } from '../lib/servidor-falso';

let b: BancoIA | null = null;
afterEach(async () => { vi.useRealTimers(); await bajarIA(b); b = null; });

const PAUSA = estadoIA({ habilitado: false, pausa: { codigo: 'PAUSADO', mensaje: 'amaIA está pausada por un administrador.' } });
const enModal = () => !!panel()!.closest('.MuiModal-root');
const enfocarVentana = () => act(async () => { window.dispatchEvent(new Event('focus')); });
const pedidosDeEstado = () => b!.srv.cuantos('GET', ESTADO);

describe('El panel fijo arranca en xl (1536 px)', () => {
    it('con 1280 y 1535 px es un modal que tapa; con 1536 y 1920 empuja la pantalla', async () => {
        for (const [ancho, modal] of [[1280, true], [1535, true], [1536, false], [1920, false]] as const) {
            b = await armarIA({ ancho });
            await abrirPanel();
            expect(enModal(), `${ancho} px`).toBe(modal);
            await bajarIA(b);
            b = null;
        }
    });

    it('con 1280 px «Sí, llevarme» cierra el panel (tapa la pantalla nueva)', async () => {
        b = await armarIA({ ancho: 1280 });
        b.preguntar = () => ({ stream: { trozos: [evento('inicio', ev.inicio()[1]), evento('fin', ev.fin('Se arma en Reportes.', { acciones: [{ id: 'toolu_1', tipo: 'ir_a', ruta: '/reportes/nuevo', etiqueta: 'Nueva plantilla de reportes', motivo: 'crear', resultado: null }] })[1])], pausaMs: 20 } });
        await abrirPanel();
        await preguntarAlAsistente('¿Dónde?');
        await esperar(() => document.querySelector('[data-testid="tarjeta-ir-a"]'), { que: 'la tarjeta' });
        const si = Array.from(document.querySelectorAll('button')).find((x) => limpio(x.textContent ?? '') === 'Sí, llevarme') ?? null;
        await clic(si, 'Sí, llevarme');
        await esperar(() => !document.querySelector('.MuiModal-root:not(.MuiModal-hidden) [role="complementary"]'), { que: 'el panel cerrado' });
    });
});

describe('El cartel de pausa o de límite se va solo', () => {
    it('pausado → se reactiva → al enfocar la ventana el cartel desaparece sin cerrar el panel', async () => {
        b = await armarIA({ estado: PAUSA });
        await abrirPanel();
        await esperar(() => alertasDelPanel().includes('amaIA está pausada por un administrador.'), { que: 'el cartel' });
        expect(entrada()!.disabled).toBe(true);
        b.estado = estadoIA();
        await enfocarVentana();
        await esperar(() => alertasDelPanel().length === 0, { que: 'el cartel se va' });
        expect(entrada()!.disabled).toBe(false);
        expect(panel()).not.toBeNull();
        // Sin bloqueo ya no se vuelve a preguntar al enfocar.
        const n = pedidosDeEstado();
        await enfocarVentana();
        await pasar(150);
        expect(pedidosDeEstado()).toBe(n);
    });

    it('«Volver a probar» pide el estado: mientras sigue pausado queda el cartel, y cuando se levanta se va', async () => {
        b = await armarIA({ estado: PAUSA });
        await abrirPanel();
        await esperar(() => alertasDelPanel().length === 1, { que: 'el cartel' });
        const volver = () => Array.from(panel()!.querySelectorAll('button')).find((x) => limpio(x.textContent ?? '') === 'Volver a probar') ?? null;
        const n = pedidosDeEstado();
        await clic(volver(), 'Volver a probar');
        await esperar(() => pedidosDeEstado() > n, { que: 'el pedido del estado' });
        await pasar(100);
        expect(alertasDelPanel().length).toBe(1);
        b.estado = estadoIA();
        await clic(volver(), 'Volver a probar');
        await esperar(() => alertasDelPanel().length === 0, { que: 'el cartel se va' });
    });

    it('el límite diario también tiene «Volver a probar» y se levanta solo', async () => {
        b = await armarIA({ estado: estadoIA({ limiteDiario: { usadas: 100, limite: 100 } }) });
        await abrirPanel();
        await esperar(() => alertasDelPanel().length === 1, { que: 'el cartel' });
        b.estado = estadoIA({ limiteDiario: { usadas: 0, limite: 100 } });
        await enfocarVentana();
        await esperar(() => alertasDelPanel().length === 0, { que: 'el cartel se va' });
    });

    it('con el panel cerrado no vuelve a preguntar al enfocar la ventana', async () => {
        b = await armarIA({ estado: PAUSA });
        await abrirPanel();
        await esperar(() => alertasDelPanel().length === 1, { que: 'el cartel' });
        await clic(document.querySelector('button[aria-label="Cerrar amaIA"]'), 'cerrar');
        await pasar(300);
        const n = pedidosDeEstado();
        await enfocarVentana();
        await pasar(200);
        expect(pedidosDeEstado()).toBe(n);
    });

    it('cada 60 s, mientras haya bloqueo y el panel esté abierto', async () => {
        b = await armarIA({ estado: PAUSA });
        await abrirPanel();
        await esperar(() => alertasDelPanel().length === 1, { que: 'el cartel' });
        // El intervalo se arma al abrir el panel: se cierra y se vuelve a abrir con el reloj de intervalos falso.
        await clic(document.querySelector('button[aria-label="Cerrar amaIA"]'), 'cerrar');
        await pasar(300);
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        await abrirPanel();
        const n = pedidosDeEstado();
        b.estado = estadoIA();
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        vi.useRealTimers();
        await esperar(() => alertasDelPanel().length === 0, { que: 'el cartel se va solo' });
        expect(pedidosDeEstado()).toBeGreaterThan(n);
    });

    it.each([
        ['429 PAUSADO', 429, 'PAUSADO', 'amaIA está pausada por un administrador.'],
        ['429 TOPE_MENSUAL', 429, 'TOPE_MENSUAL', 'amaIA llegó al tope de gasto de este mes y se pausó para todos.'],
        ['429 TOPE_FUNCION', 429, 'TOPE_FUNCION', 'Esta función llegó a su tope del mes.'],
        ['503 PAUSADO (backend viejo)', 503, 'PAUSADO', 'amaIA está pausada por un administrador.'],
        ['503 TOPE_MENSUAL (backend viejo)', 503, 'TOPE_MENSUAL', 'amaIA llegó al tope de gasto de este mes y se pausó para todos.'],
    ])('%s: cartel de pausa (no el del límite), compositor bloqueado y lo escrito no se pierde', async (_n, status, codigo, mensaje) => {
        b = await armarIA();
        b.preguntar = () => ({ status, body: { codigo, mensaje } });
        await abrirPanel();
        await preguntarAlAsistente('Mi pregunta');
        await esperar(() => alertasDelPanel().includes(mensaje), { que: 'el cartel' });
        expect(entrada()!.disabled).toBe(true);
        expect(entrada()!.value).toBe('Mi pregunta');
        expect(burbujas()).toEqual([]);
        expect(Array.from(panel()!.querySelectorAll('.MuiAlert-root')).some((a) => /MuiAlert-\w*Warning/.test(a.className))).toBe(true);
        // Y se levanta al volver a mirar el estado.
        b.estado = estadoIA();
        await enfocarVentana();
        await esperar(() => alertasDelPanel().length === 0, { que: 'el cartel se va' });
    });

    it('429 LIMITE_DIARIO sigue siendo el cartel del límite; un 503 sin código o SIN_WIKI dice que no está disponible', async () => {
        b = await armarIA();
        b.preguntar = (_c, n) => (n === 1 ? { status: 429, body: { codigo: 'LIMITE_DIARIO', usadas: 100, limite: 100 } } : { status: 503, body: {} });
        await abrirPanel();
        await preguntarAlAsistente('uno');
        await esperar(() => alertasDelPanel().includes('Llegaste al límite de 100 preguntas de hoy. Mañana se renueva.'), { que: 'el límite' });
        await bajarIA(b);
        b = await armarIA();
        b.preguntar = () => ({ status: 503, body: {} });
        await abrirPanel();
        await preguntarAlAsistente('dos');
        await esperar(() => alertasDelPanel().includes('amaIA no está disponible en este momento. Probá en un rato.'), { que: 'no disponible' });
        await bajarIA(b);
        b = await armarIA();
        b.preguntar = () => ({ status: 503, body: { codigo: 'SIN_WIKI', mensaje: 'amaIA no está disponible: falta la Documentación.' } });
        await abrirPanel();
        await preguntarAlAsistente('tres');
        await esperar(() => alertasDelPanel().includes('amaIA no está disponible: falta la Documentación.'), { que: 'SIN_WIKI' });
    });
});

describe('Parser SSE', () => {
    it('un `\\r\\n` partido entre dos trozos (`…\\r` | `\\n…`) no pierde eventos', async () => {
        b = await armarIA();
        const e1 = `event: inicio\r\ndata: ${JSON.stringify(ev.inicio()[1])}\r\n\r\n`;
        const e2 = 'event: texto\r\ndata: {"delta":"Hola "}\r\n\r\n';
        const e3 = 'event: texto\r\ndata: {"delta":"mundo"}\r\n\r\n';
        const e4 = `event: fin\r\ndata: ${JSON.stringify(ev.fin('Hola mundo')[1])}\r\n\r\n`;
        const todo = e1 + e2 + e3 + e4;
        // Corta justo entre el `\r` y el `\n` del separador de cada evento.
        const trozos: string[] = [];
        let resto = todo;
        for (;;) {
            const i = resto.indexOf('\r\n\r\n');
            if (i < 0) { trozos.push(resto); break; }
            trozos.push(resto.slice(0, i + 3), resto.slice(i + 3, i + 4));
            resto = resto.slice(i + 4);
        }
        expect(trozos.some((t) => t.endsWith('\r\n\r'))).toBe(true);
        b.preguntar = () => ({ stream: { trozos: trozos.filter((t) => t !== ''), pausaMs: 20 } });
        await abrirPanel();
        await preguntarAlAsistente('x');
        await esperar(() => botonEnviar() && !botonDetener(), { que: 'la respuesta terminada' });
        expect(ultimaBurbuja()).toBe('Hola mundo');
        expect(alertasDelPanel()).toEqual([]);
    });
});

describe('Una conversación cuya última respuesta sigue escribiéndose', () => {
    const detalle = (estado: 'en_curso' | 'ok', texto: string) => ({
        id: 41, titulo: '¿Cómo genero un cupón?', turnos: 1, updatedAt: '2026-10-14T15:00:00.000Z',
        mensajes: [
            { id: 1, rol: 'usuario' as const, texto: '¿Cómo genero un cupón?', ruta: '/gestion', fuentes: [], acciones: [], estado: 'ok' as const, calificacion: null, createdAt: '2026-10-14T15:00:00.000Z' },
            { id: 2, rol: 'asistente' as const, texto, ruta: null, fuentes: [], acciones: [], estado, calificacion: null, createdAt: '2026-10-14T15:00:01.000Z' },
        ],
    });
    const abrir = async () => {
        await abrirPanel();
        await clic(document.querySelector('button[aria-label="Más opciones"]'), 'el menú');
        const item = await esperar(() => Array.from(document.querySelectorAll('li[role="menuitem"]')).find((x) => /cupón/.test(x.textContent ?? '')), { que: 'la conversación' });
        await clic(item, 'la conversación');
        await esperar(() => burbujas().length === 2 || burbujas().length === 1, { que: 'la conversación abierta' });
    };
    const lecturas = () => b!.srv.cuantos('GET', /^\/asistente\/conversaciones\/41$/);
    const botonActualizar = () => Array.from(panel()!.querySelectorAll('button')).find((x) => limpio(x.textContent ?? '') === 'Actualizar') ?? null;

    it('dice que se está escribiendo (no «Pensando…») y «Actualizar» recarga la conversación', async () => {
        const base = detalle('en_curso', '');
        b = await armarIA({ conversaciones: [{ id: 41, titulo: base.titulo, turnos: 1, updatedAt: base.updatedAt }], detalles: [base] });
        await abrir();
        expect(ultimaBurbuja()).toContain('Esta respuesta todavía se está escribiendo');
        expect(ultimaBurbuja()).not.toContain('Pensando');
        expect(botonActualizar()).not.toBeNull();
        b.detalles[41] = detalle('ok', 'Desde la ficha.');
        await clic(botonActualizar(), 'Actualizar');
        await esperar(() => ultimaBurbuja().includes('Desde la ficha.'), { que: 'la respuesta terminada' });
        expect(ultimaBurbuja()).not.toContain('todavía se está escribiendo');
        expect(botonActualizar()).toBeNull();
    });

    it('se recarga sola cada 3 s y la respuesta aparece cuando el servidor la termina', async () => {
        const base = detalle('en_curso', 'Desde la');
        b = await armarIA({ conversaciones: [{ id: 41, titulo: base.titulo, turnos: 1, updatedAt: base.updatedAt }], detalles: [base] });
        await abrir();
        expect(ultimaBurbuja()).toContain('Desde la');
        expect(ultimaBurbuja()).toContain('todavía se está escribiendo');
        b.detalles[41] = detalle('ok', 'Desde la ficha.');
        await esperar(() => ultimaBurbuja().includes('Desde la ficha.'), { ms: 6000, que: 'la recarga automática' });
        expect(ultimaBurbuja()).not.toContain('todavía se está escribiendo');
        const n = lecturas();
        await pasar(3500);
        expect(lecturas()).toBe(n);
    });

    it('si sigue en curso, deja de recargar sola a los 30 s', async () => {
        const base = detalle('en_curso', '');
        b = await armarIA({ conversaciones: [{ id: 41, titulo: base.titulo, turnos: 1, updatedAt: base.updatedAt }], detalles: [base] });
        await abrirPanel();
        await clic(document.querySelector('button[aria-label="Más opciones"]'), 'el menú');
        const item = await esperar(() => Array.from(document.querySelectorAll('li[role="menuitem"]')).find((x) => /cupón/.test(x.textContent ?? '')), { que: 'la conversación' });
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        await clic(item, 'la conversación');
        await esperar(() => botonActualizar(), { que: 'el aviso', ms: 5000 });
        const n0 = lecturas();
        await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
        const n1 = lecturas();
        expect(n1 - n0).toBeGreaterThanOrEqual(8);
        expect(n1 - n0).toBeLessThanOrEqual(10);
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(lecturas()).toBe(n1);
        expect(botonActualizar()).not.toBeNull();
    });
});
