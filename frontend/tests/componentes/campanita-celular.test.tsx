// C2b, paquete B: la campanita en un celular (T360-1 a T360-3). A 360 px es un diálogo a pantalla completa;
// en un escritorio, el popover de siempre. Cambiar de ruta la cierra (D2: el «atrás» del navegador también).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { alertas, boton, clic, esperar, limpio, pasar } from '../lib/montar';
import { fijarAncho } from '../lib/ancho';
import { RAIZ_FE } from '../lib/raiz';
import { abrirCampanita, armarCampanita, campanitaAbierta, corriendo, irA, notificacion, ruta, type BancoCampanita } from '../lib/banco-campanita';

let b: BancoCampanita | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const pantallaCompleta = () => document.querySelector('[role="dialog"] .MuiDialog-paperFullScreen, .MuiDialog-paperFullScreen[role="dialog"]');
const popover = () => document.querySelector('.MuiPopover-paper');
// Una lista nueva por prueba: el servidor falso marca como leídas las que recibe.
const notifs = () => [notificacion({ id: 1, titulo: 'Importación finalizada' }), notificacion({ id: 2, titulo: 'Otra importación', entidadId: 142, rutaAccion: '/historial-importaciones/142' })];

describe('T360-1 — pantalla completa en el celular, popover en el escritorio', () => {
    it('a 360 px: un `role="dialog"` a pantalla completa con título, «Marcar todas» y «Cerrar»; no hay popover', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs(), enCurso: [corriendo(201)] });
        await abrirCampanita();
        const dlg = pantallaCompleta();
        expect(dlg).not.toBeNull();
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(popover()).toBeNull();
        const texto = limpio(dlg!.textContent ?? '');
        expect(texto).toContain('Notificaciones');
        expect(texto).toContain('Marcar todas');
        expect(texto).toContain('Importaciones en curso (1)');
        expect(texto).toContain('Importación finalizada');
        expect(boton('Cerrar') ?? document.querySelector('button[aria-label="Cerrar"]')).not.toBeNull();
    });

    it('«Cerrar» la cierra', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs() });
        await abrirCampanita();
        await clic(document.querySelector('button[aria-label="Cerrar"]'), 'Cerrar');
        await esperar(() => !campanitaAbierta(), { que: 'la campanita cerrada' });
        expect(ruta()).toBe('/pagina-a');
    });

    it('Escape la cierra', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs() });
        await abrirCampanita();
        const dlg = document.querySelector('[role="dialog"]')!;
        dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        await esperar(() => !campanitaAbierta(), { que: 'la campanita cerrada con Escape' });
    });

    it('a 1280 px: el popover de siempre, sin pantalla completa ni botón «Cerrar»', async () => {
        b = await armarCampanita({ ancho: 1280, notificaciones: notifs() });
        await abrirCampanita();
        expect(popover()).not.toBeNull();
        expect(pantallaCompleta()).toBeNull();
        expect(document.querySelector('button[aria-label="Cerrar"]')).toBeNull();
        expect(limpio(popover()!.textContent ?? '')).toContain('Importación finalizada');
    });

    it('«Marcar todas» funciona en las dos presentaciones', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs() });
        await abrirCampanita();
        await clic(boton('Marcar todas'), 'Marcar todas');
        await esperar(() => b!.srv.cuantos('POST', /^\/notificaciones\/leer-todas$/) === 1, { que: 'el pedido' });
    });

    it('si cambia el ancho con la campanita abierta (girar el celular), sigue abierta en la otra presentación', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs() });
        await abrirCampanita();
        expect(pantallaCompleta()).not.toBeNull();
        fijarAncho(1280);
        await pasar(300);
        await esperar(() => popover() !== null && pantallaCompleta() === null, { que: 'el popover' });
        expect(campanitaAbierta()).toBe(true);
    });

    it('la lista se arma sin ruido: ninguna alerta y ningún texto con basura', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs(), enCurso: [corriendo(201)] });
        await abrirCampanita();
        expect(alertas()).toEqual([]);
        expect(limpio(document.body.textContent ?? '')).not.toMatch(/NaN|undefined|\[object/);
    });
});

describe('T360-2 — cambiar de ruta la cierra (D2)', () => {
    it('ir a otra página con la campanita abierta en el celular la cierra', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs() });
        await abrirCampanita();
        await irA('/otra-pagina');
        await esperar(() => !campanitaAbierta(), { que: 'la campanita cerrada' });
        expect(ruta()).toBe('/otra-pagina');
    });

    it('el «atrás» del navegador (volver a la página anterior) la cierra y vuelve a esa página, sin entradas de más en el historial', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs() });
        await irA('/otra-pagina');
        await abrirCampanita();
        await irA(-1);
        await esperar(() => !campanitaAbierta(), { que: 'la campanita cerrada' });
        expect(ruta()).toBe('/pagina-a');
        // Abrirla no empujó nada al historial: un solo «atrás» llegó a la página de antes de la otra.
        await irA(-1);
        await pasar(100);
        expect(ruta()).toBe('/pagina-a');
    });

    it('en el escritorio también: cambiar de ruta cierra el popover', async () => {
        b = await armarCampanita({ ancho: 1280, notificaciones: notifs() });
        await abrirCampanita();
        await irA('/otra-pagina');
        await esperar(() => !campanitaAbierta(), { que: 'el popover cerrado' });
    });

    it('un clic en una notificación navega y cierra', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs() });
        await abrirCampanita();
        await clic(Array.from(document.querySelectorAll('.MuiTypography-body2')).find((e) => e.textContent === 'Otra importación') ?? null, 'la notificación');
        await esperar(() => ruta() === '/historial-importaciones/142', { que: 'la navegación' });
        await esperar(() => !campanitaAbierta(), { que: 'la campanita cerrada' });
    });

    it('volver a abrirla después de cerrarla muestra la lista otra vez', async () => {
        b = await armarCampanita({ ancho: 360, notificaciones: notifs() });
        await abrirCampanita();
        await clic(document.querySelector('button[aria-label="Cerrar"]'), 'Cerrar');
        await esperar(() => !campanitaAbierta(), { que: 'cerrada' });
        await abrirCampanita();
        expect(limpio(document.body.textContent ?? '')).toContain('Importación finalizada');
    });
});

describe('T360-3 — sin colores escritos a mano en lo nuevo y lo tocado del paquete B', () => {
    const ARCHIVOS = [
        'utils/campanita.ts',
        'components/layout/AppShell/AccionesNotificacion.tsx',
        'components/layout/AppShell/ChipImportaciones.tsx',
        'components/layout/AppShell/NotificacionesBell.tsx',
        'components/layout/AppShell/NotificacionesPopover.tsx',
        'components/layout/AppShell/NotificacionItem.tsx',
        'components/layout/AppShell/ImportEnCursoItem.tsx',
        'api/notificaciones.ts',
    ];
    const COLOR_A_MANO = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    for (const rel of ARCHIVOS) {
        it(rel, () => {
            const ruta0 = path.join(RAIZ_FE, 'src', rel);
            expect(fs.existsSync(ruta0), `no existe ${rel}`).toBe(true);
            const lineas = fs.readFileSync(ruta0, 'utf8').split('\n');
            const malas = lineas.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l) && COLOR_A_MANO.test(l));
            expect(malas.map((m) => `${rel}:${m.n} ${m.l.trim()}`)).toEqual([]);
        });
    }
});
