// El menú lateral del marco nuevo (CHANGELOG 2026-10-22): los bloques con título, la pantalla abierta, el modo
// colapsado y el celular. Los casos marcados "(antes …)" son los defectos del SideNav anterior.
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from '@fe/components/ui';
import { vuelveArriba } from '@fe/components/layout/AppShell/navConfig';
import { clic, esperar, limpio, montar, pasar } from '../lib/montar';
import { armarIA, bajarIA, irA, rutaActual, type BancoIA } from '../lib/banco-ia';
import { corriendo } from '../lib/banco-campanita';

let b: BancoIA | null = null;
afterEach(async () => {
    await bajarIA(b);
    b = null;
    localStorage.removeItem('app_sidebar_collapsed');
});

const TODOS = [
    'deudores.ver', 'dashboards.ver', 'importacion.ver_historial', 'importacion.ejecutar', 'plantillas_import.ver', 'reportes.ver',
    'empresas.ver', 'parametros.ver', 'politicas.ver', 'mora.ver', 'admin.gestionar_roles', 'admin.gestionar_usuarios', 'auditoria.ver',
    'asistente.administrar', 'telefonia.admin',
];

const menu = () => document.querySelector<HTMLElement>('nav[aria-label="Menú principal"]');
const botonesDelMenu = () => Array.from(menu()?.querySelectorAll<HTMLElement>('[role="button"]') ?? []);
const botonDelMenu = (texto: string) =>
    botonesDelMenu().find((x) => limpio(x.textContent ?? '') === texto || x.getAttribute('aria-label') === texto) ?? null;
const marcadas = () => Array.from(menu()?.querySelectorAll('[aria-current="page"]') ?? []).map((x) => limpio(x.textContent ?? '') || x.getAttribute('aria-label'));
const titulosDeBloque = () => Array.from(menu()?.querySelectorAll('[id^="menu-seccion-"]') ?? []).map((t) => limpio(t.textContent ?? ''));

describe('Los bloques del menú', () => {
    it('van Operación, Datos y Configuración, cada uno con su título, y Documentación queda abajo de todo', async () => {
        b = await armarIA({ permisos: TODOS });
        expect(titulosDeBloque()).toEqual(['Operación', 'Datos', 'Configuración']);
        const textos = botonesDelMenu().map((x) => limpio(x.textContent ?? ''));
        expect(textos.slice(0, 3)).toEqual(['Inicio', 'Gestión', 'Tableros']);
        expect(textos[textos.length - 1]).toBe('Documentación');
        expect(textos).toContain('Importación');
        expect(textos).not.toContain('Importación de Datos');
    });

    it('un bloque sin nada que la persona pueda ver no aparece', async () => {
        b = await armarIA({ permisos: ['deudores.ver'] });
        expect(titulosDeBloque()).toEqual(['Operación']);
        expect(botonDelMenu('Documentación')).not.toBeNull();
    });

    it('con solo telefonia.admin aparece Administración con Neotel (test) (antes el grupo quedaba escondido)', async () => {
        b = await armarIA({ permisos: ['telefonia.admin'] });
        await clic(botonDelMenu('Administración'), 'Administración');
        await esperar(() => botonDelMenu('Neotel (test)'), { que: 'Neotel (test)' });
    });
});

describe('La pantalla abierta', () => {
    it('dentro de un grupo: el grupo arranca abierto y la pantalla marcada (antes arrancaba cerrado)', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/reportes/ejecuciones' });
        await esperar(() => marcadas().length > 0, { que: 'la pantalla marcada' });
        expect(marcadas()).toEqual(['Mis ejecuciones']);
        expect(botonDelMenu('Reportes')?.getAttribute('aria-expanded')).toBe('true');
    });

    it('una ruta hija marca su pantalla, el grupo se abre solo al llegar por otro camino, e Inicio solo se marca en /', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/historial-importaciones/12' });
        await esperar(() => marcadas().length > 0, { que: 'la pantalla marcada' });
        expect(marcadas()).toEqual(['Historial']);

        await irA('/reportes/7/editar');
        await esperar(() => marcadas()[0] === 'Mis plantillas', { que: 'Mis plantillas marcada' });
        expect(botonDelMenu('Reportes')?.getAttribute('aria-expanded')).toBe('true');
        // El que ya estaba abierto no se cierra.
        expect(botonDelMenu('Importación')?.getAttribute('aria-expanded')).toBe('true');

        await irA('/gestion');
        await esperar(() => marcadas()[0] === 'Gestión', { que: 'Gestión marcada' });
        expect(marcadas()).toEqual(['Gestión']);
        await irA('/');
        await esperar(() => marcadas()[0] === 'Inicio', { que: 'Inicio marcada' });
    });

    it('un grupo se abre y se cierra con su botón', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        const ajustes = botonDelMenu('Ajustes')!;
        expect(ajustes.getAttribute('aria-expanded')).toBe('false');
        expect(botonDelMenu('Empresas')).toBeNull();
        await clic(ajustes, 'Ajustes');
        await esperar(() => botonDelMenu('Recargo por mora'), { que: 'los hijos de Ajustes' });
        await clic(botonDelMenu('Empresas'), 'Empresas');
        await esperar(() => rutaActual() === '/ajustes/empresas', { que: 'la ruta' });
    });
});

describe('Colapsado', () => {
    it('un grupo despliega todas sus pantallas al costado (antes llevaba siempre a la primera) y elegir una lleva ahí', async () => {
        localStorage.setItem('app_sidebar_collapsed', '1');
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        expect(titulosDeBloque()).toEqual([]);
        const reportes = botonDelMenu('Reportes')!;
        expect(reportes.getAttribute('aria-haspopup')).toBe('menu');
        await clic(reportes, 'Reportes');
        const desplegado = await esperar(() => document.querySelector<HTMLElement>('[role="menu"][aria-label="Reportes"]'), { que: 'el menú de Reportes' });
        expect(Array.from(desplegado.querySelectorAll('[role="menuitem"]')).map((x) => limpio(x.textContent ?? ''))).toEqual(['Mis plantillas', 'Mis ejecuciones']);
        expect(rutaActual()).toBe('/gestion');

        const ejecuciones = Array.from(desplegado.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((x) => limpio(x.textContent ?? '') === 'Mis ejecuciones')!;
        await clic(ejecuciones, 'Mis ejecuciones');
        await esperar(() => rutaActual() === '/reportes/ejecuciones', { que: 'la ruta' });
        await esperar(() => !document.querySelector('[role="menu"][aria-label="Reportes"]'), { que: 'que se cierre el menú' });
    });

    it('todos los ítems muestran su nombre al pasar el mouse, también los grupos (antes solo los sueltos)', async () => {
        localStorage.setItem('app_sidebar_collapsed', '1');
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        for (const nombre of ['Inicio', 'Tableros', 'Importación', 'Reportes', 'Ajustes', 'Administración', 'Documentación']) {
            const boton = botonDelMenu(nombre);
            expect(boton, nombre).not.toBeNull();
            await act(async () => { boton!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
            await esperar(() => Array.from(document.querySelectorAll('[role="tooltip"]')).some((t) => limpio(t.textContent ?? '') === nombre), { que: `el nombre de ${nombre}` });
            await act(async () => { boton!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
        }
    });

    it('con una carga en curso, el lector oye "Importación" y el aviso (el nombre no lo pisa)', async () => {
        localStorage.setItem('app_sidebar_collapsed', '1');
        b = await armarIA({ permisos: [...TODOS, 'importacion.ver_progreso_otros'], ruta: '/gestion', antes: (bb) => {
            bb.srv.en('GET', /^\/import\/en-curso$/, () => ({ body: [corriendo(201, { progreso: 43 })] }));
        } });
        await esperar(() => document.querySelector('[data-testid="punto-importaciones"]'), { que: 'el punto' });
        const importacion = botonesDelMenu().find((x) => /^Importación/.test(limpio(x.textContent ?? '')))!;
        expect(importacion.getAttribute('aria-label')).toBeNull();
        expect(limpio(importacion.textContent ?? '')).toBe('ImportaciónHay importaciones en curso');
    });

    it('el botón de la barra expande el menú y lo recuerda', async () => {
        localStorage.setItem('app_sidebar_collapsed', '1');
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        await clic(document.querySelector('.MuiAppBar-root button[aria-label="Expandir menú"]'), 'Expandir menú');
        await esperar(() => titulosDeBloque().length === 3, { que: 'los títulos de los bloques' });
        expect(localStorage.getItem('app_sidebar_collapsed')).toBe('0');
    });
});

describe('En el celular', () => {
    it('el menú se abre con el botón de la barra y se cierra al elegir una pantalla (antes quedaba abierto)', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion', ancho: 360 });
        const modalDelMenu = () => menu()?.closest<HTMLElement>('.MuiModal-root') ?? null;
        const abierto = () => {
            const m = modalDelMenu();
            return !!m && getComputedStyle(m).visibility !== 'hidden' && !m.classList.contains('MuiModal-hidden');
        };
        expect(abierto()).toBe(false);
        await clic(document.querySelector('.MuiAppBar-root button[aria-label="Abrir menú"]'), 'Abrir menú');
        await esperar(abierto, { que: 'el menú abierto' });
        // Para el dedo: 44 px de alto, también las pantallas de un grupo.
        expect(getComputedStyle(botonDelMenu('Tableros')!).height).toBe('44px');
        await clic(botonDelMenu('Importación'), 'Importación');
        await esperar(() => botonDelMenu('Historial'), { que: 'los hijos de Importación' });
        expect(getComputedStyle(botonDelMenu('Historial')!).height).toBe('44px');
        await clic(botonDelMenu('Tableros'), 'Tableros');
        await esperar(() => rutaActual() === '/dashboards', { que: 'la ruta' });
        await esperar(() => !abierto(), { que: 'el menú cerrado' });
    });
});

describe('Después de elegir una pantalla', () => {
    it('desde el menú, el foco pasa al contenido (si no, AvPág y las flechas no desplazan nada)', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        const tableros = botonDelMenu('Tableros')!;
        tableros.focus();
        await clic(tableros, 'Tableros');
        await esperar(() => rutaActual() === '/dashboards', { que: 'la ruta' });
        await esperar(() => document.activeElement === document.querySelector('main'), { que: 'el foco en el contenido' });
    });

    it('vuelve arriba al cambiar de pantalla o de la lista a un detalle, no entre dos subrutas del armador', () => {
        expect(vuelveArriba('/gestion', '/dashboards')).toBe(true);
        expect(vuelveArriba('/reportes', '/reportes/ejecuciones')).toBe(true);
        expect(vuelveArriba('/plantillas', '/plantillas/nueva')).toBe(true);
        expect(vuelveArriba('/historial-importaciones/12', '/historial-importaciones')).toBe(true);
        expect(vuelveArriba('/reportes/7/editar', '/reportes/nuevo')).toBe(false);
        expect(vuelveArriba('/reportes/nuevo', '/reportes/7/editar')).toBe(false);
        expect(vuelveArriba('/gestion', '/gestion')).toBe(false);
    });
});

describe('Las migas de pan', () => {
    it('van en el encabezado de la pantalla, justo arriba del título (antes, en la barra)', async () => {
        const v = await montar(
            <PageHeader title="Remesa 102" breadcrumbs={[{ label: 'Historial', href: '/historial-importaciones' }, { label: 'Remesa 102' }]} />,
        );
        const migas = v.contenedor.querySelector('nav[aria-label="Migas de pan"]')!;
        const titulo = v.contenedor.querySelector('h1')!;
        expect(limpio(migas.textContent ?? '')).toBe('HistorialRemesa 102');
        expect(migas.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(migas.parentElement).toBe(titulo.parentElement!.parentElement!.parentElement);
        expect(migas.querySelector('a')?.getAttribute('href')).toBe('/historial-importaciones');
        await v.desmontar();
    });

    it('sin migas no dibuja nada', async () => {
        const v = await montar(<PageHeader title="Gestión" />);
        expect(v.contenedor.querySelector('nav[aria-label="Migas de pan"]')).toBeNull();
        await v.desmontar();
    });
});

describe('En la computadora', () => {
    it('los ítems miden 40 px y las pantallas de un grupo, 34', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/historial-importaciones' });
        await esperar(() => botonDelMenu('Historial'), { que: 'Historial' });
        expect(getComputedStyle(botonDelMenu('Tableros')!).height).toBe('40px');
        expect(getComputedStyle(botonDelMenu('Historial')!).height).toBe('34px');
    });
});

describe('Importaciones en curso', () => {
    it('Importación lleva un punto mientras hay una carga, el mismo dato que el chip de la barra', async () => {
        b = await armarIA({ permisos: [...TODOS, 'importacion.ver_progreso_otros'], ruta: '/gestion', antes: (bb) => {
            bb.srv.en('GET', /^\/import\/en-curso$/, () => ({ body: [corriendo(201, { progreso: 43 })] }));
        } });
        await esperar(() => document.querySelector('[data-testid="punto-importaciones"]'), { que: 'el punto' });
        const importacion = botonesDelMenu().find((x) => /^Importación/.test(limpio(x.textContent ?? '')))!;
        expect(importacion.querySelector('[data-testid="punto-importaciones"]')).not.toBeNull();
        // El lector de pantalla también se entera.
        expect(limpio(importacion.textContent ?? '')).toContain('Hay importaciones en curso');
    });

    it('sin cargas no hay punto', async () => {
        b = await armarIA({ permisos: TODOS, ruta: '/gestion' });
        await pasar(200);
        expect(document.querySelector('[data-testid="punto-importaciones"]')).toBeNull();
    });
});
