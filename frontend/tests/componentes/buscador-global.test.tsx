// El buscador de la barra superior (CHANGELOG 2026-10-22): Ctrl+K desde cualquier pantalla, pantallas del menú según
// los permisos y casos con la misma búsqueda que Gestión (`GET /deudores?search=`), sin tocar el backend.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { setupAxiosInterceptors } from '@fe/api/setupAxiosInterceptors';
import { clic, dialogo, dialogos, escribir, esperar, limpio, pasar } from '../lib/montar';
import { armarIA, bajarIA, rutaActual, type BancoIA } from '../lib/banco-ia';
import type { Pedido } from '../lib/servidor-falso';

let b: BancoIA | null = null;
let quitarInterceptor: (() => void) | null = null;
afterEach(async () => {
    quitarInterceptor?.();
    quitarInterceptor = null;
    await bajarIA(b);
    b = null;
});

const TODOS = [
    'deudores.ver', 'dashboards.ver', 'importacion.ver_historial', 'importacion.ejecutar', 'plantillas_import.ver', 'reportes.ver',
    'empresas.ver', 'parametros.ver', 'politicas.ver', 'mora.ver', 'admin.gestionar_roles', 'admin.gestionar_usuarios', 'auditoria.ver',
];

const CASOS = [
    { id: 501, nombre: 'Juana', apellido: 'Pérez', documento: '27336733', empresa: { nombre: 'AYSA' }, remesa: { numeroRemesa: '102' } },
    { id: 502, nombre: 'Juan', apellido: 'Perezoso', documento: 'SIN-DNI-77', empresa: { nombre: 'TELECOM' }, remesa: null },
];
const terminoDe = (p: Pedido) => new URLSearchParams(p.ruta.split('?')[1] ?? '').get('search') ?? '';
/** Como el backend: nombre o apellido parcial (sin distinguir mayúsculas ni tildes, como la collation de MySQL). */
const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function conCasos(bb: BancoIA) {
    bb.srv.en('GET', /^\/deudores$/, (_m, p) => {
        const t = sinTildes(terminoDe(p));
        const data = CASOS.filter((c) => sinTildes(c.nombre).includes(t) || sinTildes(c.apellido).includes(t) || c.documento === t);
        return { body: { data, meta: { total: data.length, page: 1, limit: 6, totalPages: 1 } } };
    });
}
const pedidosDeCasos = () => b!.srv.de('GET', /^\/deudores/);

const teclear = async (init: KeyboardEventInit) => {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    await act(async () => { window.dispatchEvent(ev); });
    return ev;
};
const buscador = () => dialogo(/Buscar en AMSA Gestión/);
const entrada = () => buscador()?.querySelector<HTMLInputElement>('input[role="combobox"]') ?? null;
const opciones = () => Array.from(buscador()?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
const textos = () => opciones().map((o) => limpio(o.textContent ?? ''));
const opcion = (re: RegExp) => opciones().find((o) => re.test(limpio(o.textContent ?? ''))) ?? null;
const marcada = () => opciones().find((o) => o.getAttribute('aria-selected') === 'true') ?? null;
const estado = () => limpio(buscador()?.querySelector('[role="status"]')?.textContent ?? '');
async function tecla(key: string) {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(async () => { entrada()!.dispatchEvent(ev); });
}
async function abrir() {
    await teclear({ key: 'k', ctrlKey: true });
    await esperar(() => entrada(), { que: 'el buscador' });
}

describe('Abrirlo', () => {
    it('Ctrl+K lo abre desde cualquier pantalla, con el foco en el campo; con el buscador abierto, Ctrl+K vuelve al campo y no abre otro', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/reportes' });
        expect(buscador()).toBeNull();
        const ev = await teclear({ key: 'k', ctrlKey: true });
        expect(ev.defaultPrevented).toBe(true);
        await esperar(() => entrada(), { que: 'el buscador' });
        await esperar(() => document.activeElement === entrada(), { que: 'el foco en el campo' });
        await escribir(entrada(), 'hola');
        (document.activeElement as HTMLElement).blur();
        const otra = await teclear({ key: 'K', ctrlKey: true });
        // Interceptado: si no, el navegador manda el foco a su barra de direcciones.
        expect(otra.defaultPrevented).toBe(true);
        expect(dialogos()).toHaveLength(1);
        expect(document.activeElement).toBe(entrada());
        expect(entrada()!.value).toBe('hola');
    });

    it('Cmd+K (Mac) también, y el botón de la barra', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        await teclear({ key: 'k', metaKey: true });
        await esperar(() => entrada(), { que: 'el buscador con Cmd+K' });
        await tecla('Escape');
        await esperar(() => !buscador(), { que: 'que se cierre con Esc' });
        await clic(document.querySelector('.MuiAppBar-root button[aria-label="Buscar un caso o una pantalla"]'), 'el botón de la barra');
        await esperar(() => entrada(), { que: 'el buscador con el botón' });
        // Con el botón enfocado al abrir, el foco igual llega al campo (antes se lo quedaba el contenedor del diálogo).
        await esperar(() => document.activeElement === entrada(), { que: 'el foco en el campo' });
    });

    it('elegida una pantalla en el menú (el foco queda en el contenido), Ctrl+K igual deja el foco en el campo', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        const tableros = Array.from(document.querySelectorAll<HTMLElement>('nav[aria-label="Menú principal"] [role="button"]')).find((x) => limpio(x.textContent ?? '') === 'Tableros')!;
        await clic(tableros, 'Tableros');
        await esperar(() => document.activeElement === document.querySelector('main'), { que: 'el foco en el contenido' });
        await abrir();
        await esperar(() => document.activeElement === entrada(), { que: 'el foco en el campo' });
    });

    it('con la ayuda "?" abierta, Ctrl+K no le abre el buscador encima (antes solo miraba los diálogos)', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        await clic(document.querySelector('.MuiAppBar-root button[aria-label="Ayuda de esta pantalla"]'), 'la ayuda');
        await esperar(() => document.querySelector('.MuiDrawer-modal:not(.MuiModal-hidden)'), { que: 'la ayuda abierta' });
        const ev = await teclear({ key: 'k', ctrlKey: true });
        await pasar(100);
        expect(ev.defaultPrevented).toBe(false);
        expect(buscador()).toBeNull();
    });

    it('con el menú del celular cerrado (montado y escondido), Ctrl+K sí lo abre', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', ancho: 768 });
        expect(document.querySelector('.MuiDrawer-modal.MuiModal-hidden')).not.toBeNull();
        const ev = await teclear({ key: 'k', ctrlKey: true });
        expect(ev.defaultPrevented).toBe(true);
        await esperar(() => entrada(), { que: 'el buscador' });
    });

    it('con otro diálogo abierto, Ctrl+K no le abre el buscador encima', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        await abrir();
        await clic(opcion(/^Búsqueda avanzada/), 'Búsqueda avanzada');
        await esperar(() => dialogo(/búsqueda/i), { que: 'la búsqueda avanzada' });
        expect(buscador()).toBeNull();
        const ev = await teclear({ key: 'k', ctrlKey: true });
        await pasar(100);
        expect(ev.defaultPrevented).toBe(false);
        expect(buscador()).toBeNull();
    });
});

describe('En el celular y en la tablet', () => {
    const disparador = () => document.querySelector<HTMLElement>('.MuiAppBar-root [aria-label="Buscar un caso o una pantalla"]');

    for (const ancho of [360, 768]) {
        it(`a ${ancho} px la barra lleva solo el ícono (sin el campo ni la tecla), y abre el mismo buscador`, async () => {
            b = await armarIA({ permisos: TODOS, ruta: '/gestion', ancho, antes: conCasos });
            expect(disparador()?.classList.contains('MuiIconButton-root')).toBe(true);
            expect(document.querySelector('.MuiAppBar-root kbd')).toBeNull();
            await clic(disparador(), 'el ícono');
            await esperar(() => entrada(), { que: 'el buscador' });
            await escribir(entrada(), 'perez');
            await esperar(() => opcion(/^Juana Pérez/), { que: 'el caso' });
            await clic(opcion(/^Juana Pérez/), 'el caso');
            await esperar(() => rutaActual() === '/gestion' && document.querySelector('[data-testid="ruta"]')?.getAttribute('data-search') === '?deudor=501', { que: 'el caso abierto' });
        });
    }

    it('a 1280 px es el campo, con la tecla del atajo', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        expect(disparador()?.classList.contains('MuiIconButton-root')).toBe(false);
        expect(limpio(document.querySelector('.MuiAppBar-root kbd')?.textContent ?? '')).toBe('Ctrl K');
    });
});

describe('Pantallas', () => {
    it('vacío muestra las pantallas del menú; filtra sin tildes y Enter lleva a la pantalla', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', antes: conCasos });
        await abrir();
        expect(textos()).toContain('Inicio');
        expect(textos()).toContain('Mis ejecucionesReportes');
        await escribir(entrada(), 'parametros');
        await esperar(() => textos()[0] === 'ParámetrosAjustes', { que: 'Parámetros primero' });
        await tecla('Enter');
        await esperar(() => rutaActual() === '/ajustes/parametros', { que: 'la ruta' });
        expect(buscador()).toBeNull();
    });

    it('coinciden desde el comienzo de una palabra, no por el medio: un apellido como "Ríos" no lleva a Usuarios', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', antes: conCasos });
        await abrir();
        await escribir(entrada(), 'rios');
        await pasar(450);
        expect(opcion(/^Usuarios/)).toBeNull();
        await escribir(entrada(), 'usu');
        await esperar(() => opcion(/^Usuarios/), { que: 'Usuarios por el comienzo' });
        await escribir(entrada(), 'mis ej');
        await esperar(() => textos()[0] === 'Mis ejecucionesReportes', { que: 'dos palabras' });
        await escribir(entrada(), 'mora');
        await esperar(() => opcion(/^Recargo por mora/), { que: 'una palabra del medio del nombre' });
        await escribir(entrada(), 'repo');
        await esperar(() => opcion(/^Mis plantillas/) && opcion(/^Mis ejecuciones/), { que: 'por el nombre del grupo' });
    });

    it('solo las que la persona puede ver', async () => {
        b = await armarIA({ permisos: ['deudores.ver', 'reportes.ver'], ruta: '/gestion', antes: conCasos });
        await abrir();
        await escribir(entrada(), 'usuarios');
        await pasar(450);
        expect(opcion(/^Usuarios/)).toBeNull();
        await escribir(entrada(), 'mis');
        await esperar(() => opcion(/^Mis plantillas/), { que: 'Mis plantillas' });
    });

    it('las flechas mueven la marca (y vuelven al principio) y Enter abre la marcada', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', antes: conCasos });
        await abrir();
        await escribir(entrada(), 'mis');
        await esperar(() => opcion(/^Mis ejecuciones/), { que: 'Mis ejecuciones' });
        expect(limpio(marcada()?.textContent ?? '')).toBe('Mis plantillasReportes');
        await tecla('ArrowDown');
        expect(limpio(marcada()?.textContent ?? '')).toBe('Mis ejecucionesReportes');
        expect(entrada()!.getAttribute('aria-activedescendant')).toBe(marcada()!.id);
        await tecla('ArrowUp');
        await tecla('ArrowUp');
        expect(marcada()).toBe(opciones()[opciones().length - 1]);
        await tecla('ArrowDown');
        await tecla('ArrowDown');
        await tecla('Enter');
        await esperar(() => rutaActual() === '/reportes/ejecuciones', { que: 'la ruta' });
    });
});

describe('Casos', () => {
    it('busca con la búsqueda de Gestión (página 1, 6 resultados) y Enter abre el caso', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/reportes', antes: conCasos });
        await abrir();
        await escribir(entrada(), 'perez');
        await esperar(() => opcion(/^Juana Pérez/), { que: 'el caso' });
        const ultimo = pedidosDeCasos()[pedidosDeCasos().length - 1];
        const params = new URLSearchParams(ultimo.ruta.split('?')[1]);
        expect(Object.fromEntries(params)).toEqual({ page: '1', limit: '6', search: 'perez' });
        expect(limpio(opcion(/^Juana Pérez/)!.textContent ?? '')).toContain('DNI 27336733 · AYSA · Remesa 102 · ID 501');
        // El documento de relleno de los casos sin DNI no se muestra.
        expect(limpio(opcion(/^Juan Perezoso/)!.textContent ?? '')).toBe('Juan PerezosoSin DNI · TELECOM · ID 502');
        // No coincide ninguna pantalla: el primero marcado es el caso.
        expect(limpio(marcada()?.textContent ?? '')).toMatch(/^Juana Pérez/);
        await tecla('Enter');
        await esperar(() => rutaActual() === '/gestion', { que: 'Gestión' });
        expect(document.querySelector('[data-testid="ruta"]')?.getAttribute('data-search')).toBe('?deudor=501');
    });

    it('con una letra no busca casos; desde dos, sí, y una sola vez aunque se escriba rápido', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', antes: conCasos });
        await abrir();
        await escribir(entrada(), 'p');
        await pasar(450);
        expect(pedidosDeCasos()).toHaveLength(0);
        expect(estado()).toBe('Seguí escribiendo para buscar casos.');
        await escribir(entrada(), 'pe');
        await escribir(entrada(), 'per');
        await escribir(entrada(), 'pere');
        await esperar(() => opcion(/^Juana Pérez/), { que: 'el caso' });
        expect(pedidosDeCasos().map(terminoDe)).toEqual(['pere']);
    });

    it('sin casos que coincidan lo dice, y ofrece la búsqueda avanzada', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', antes: conCasos });
        await abrir();
        await escribir(entrada(), 'zzz');
        await esperar(() => /Ningún caso coincide/.test(estado()), { que: 'el aviso' });
        expect(textos()).toEqual(['Búsqueda avanzadaPor número de cliente, teléfono, mail o empresa']);
    });

    it('si la búsqueda falla lo dice adentro, sin el aviso de "Sin conexión", y Reintentar vuelve a pedir', async () => {
        let falla = true;
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', antes: (bb) => {
            bb.srv.en('GET', /^\/deudores$/, () => (falla ? { status: 500, body: { message: 'boom' } } : { body: { data: [CASOS[0]], meta: { total: 1 } } }));
        } });
        const avisos: unknown[] = [];
        quitarInterceptor = setupAxiosInterceptors((e) => avisos.push(e));
        await abrir();
        await escribir(entrada(), 'ju');
        await escribir(entrada(), 'juana');
        await esperar(() => /No se pudo buscar casos/.test(estado()), { que: 'el error' });
        expect(avisos).toEqual([]);
        falla = false;
        const reintentar = Array.from(buscador()!.querySelectorAll('button')).find((x) => limpio(x.textContent ?? '') === 'Reintentar') ?? null;
        await clic(reintentar, 'Reintentar');
        await esperar(() => opcion(/^Juana Pérez/), { que: 'el caso' });
        expect(avisos).toEqual([]);
    });

    it('"Búsqueda avanzada" abre el formulario de siempre', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', antes: conCasos });
        await abrir();
        await clic(opcion(/^Búsqueda avanzada/), 'Búsqueda avanzada');
        await esperar(() => dialogo(/búsqueda/i), { que: 'la búsqueda avanzada' });
        expect(buscador()).toBeNull();
    });

    it('sin Ver deudores solo busca pantallas: no pide casos ni ofrece la búsqueda avanzada', async () => {
        b = await armarIA({ permisos: ['reportes.ver'], ruta: '/reportes', antes: conCasos });
        await abrir();
        expect(entrada()!.getAttribute('placeholder')).toBe('Buscar una pantalla');
        expect(document.querySelector('.MuiAppBar-root button[aria-label="Buscar una pantalla"]')).not.toBeNull();
        await escribir(entrada(), 'perez');
        await pasar(450);
        expect(pedidosDeCasos()).toHaveLength(0);
        expect(textos()).toEqual([]);
        expect(estado()).toBe('Ninguna pantalla coincide con «perez».');
    });
});
