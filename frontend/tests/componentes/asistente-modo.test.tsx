// Asistente de IA, Fase B: el selector de modo «Ayuda» / «Armar un reporte» (docs/asistente-reportes-spec.md §16.1, §16.3, D-13 y §20.2).
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertas, boton, clic, elegirArchivos, esperar, limpio, pasar } from '../lib/montar';
import {
    PERMISOS_IA, PERMISOS_REPORTES_IA, abrirPanel, adjuntoIA, armarIA, bajarIA, botonEnviar, botonDetener, entrada, ev, panel, preguntarAlAsistente,
    respuestaNormal, respuestaSse, PREGUNTAR, ADJUNTOS, type BancoIA,
} from '../lib/banco-ia';

let b: BancoIA | null = null;
afterEach(async () => { vi.restoreAllMocks(); await bajarIA(b); b = null; });

const selector = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Modo de amaIA"]');
const botonModo = (nombre: string) => selector()?.querySelector<HTMLButtonElement>(`button[aria-label="${nombre}"]`) ?? null;
const esperarTerminada = () => esperar(() => botonEnviar() && !botonDetener(), { que: 'la respuesta terminada' });
const modoDelPanel = () => panel()?.getAttribute('data-modo');

/** Suelta un archivo sobre el panel, como lo hace el navegador (jsdom no arma el DataTransfer). */
async function soltar(archivo: File): Promise<Event> {
    const e = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files: [archivo] } });
    await act(async () => { panel()!.dispatchEvent(e); });
    return e;
}

describe('Quién ve el selector', () => {
    it('sin asistente.reportes no hay selector, ni botón de adjuntar, y el panel es el de siempre', async () => {
        b = await armarIA({ permisos: PERMISOS_IA });
        await abrirPanel();
        expect(selector()).toBeNull();
        expect(document.querySelector('button[aria-label="Adjuntar archivo"]')).toBeNull();
        expect(limpio(panel()!.textContent ?? '')).toContain('Ayuda de uso de la plataforma');
        expect(modoDelPanel()).toBe('ayuda');
    });

    it('con asistente.reportes pero sin reportes.crear (o sin reportes.ver) tampoco', async () => {
        for (const sacar of ['reportes.crear', 'reportes.ver']) {
            b = await armarIA({ permisos: PERMISOS_REPORTES_IA.filter((p) => p !== sacar) });
            await abrirPanel();
            expect(selector(), `sin ${sacar}`).toBeNull();
            await bajarIA(b);
            b = null;
        }
    });

    it('con los tres permisos aparece, con la ayuda elegida de entrada', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        expect(selector()).not.toBeNull();
        expect(botonModo('Ayuda')!.getAttribute('aria-pressed')).toBe('true');
        expect(botonModo('Armar un reporte')!.getAttribute('aria-pressed')).toBe('false');
        expect(modoDelPanel()).toBe('ayuda');
        // En la ayuda no se avisa nada del modelo.
        expect(document.querySelector('[data-testid="aviso-modelo"]')).toBeNull();
    });
});

describe('Cambiar de modo', () => {
    it('es explícito: avisa que usa otro modelo y que cuesta más, cambia el subtítulo, el placeholder y el pie', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await esperar(() => modoDelPanel() === 'reportes', { que: 'el modo reportes' });
        const t = limpio(panel()!.textContent ?? '');
        expect(t).toContain('Constructor de reportes');
        expect(limpio(document.querySelector('[data-testid="aviso-modelo"]')!.textContent ?? '')).toMatch(/otro modelo.*cuesta bastante más/);
        expect(entrada()!.getAttribute('placeholder')).toBe('Describí el reporte o adjuntá un ejemplo…');
        expect(t).toContain('Arma plantillas con los campos del sistema y nunca guarda sin que confirmes.');
        expect(document.querySelector('button[aria-label="Adjuntar archivo"]')).not.toBeNull();
        expect(botonModo('Armar un reporte')!.getAttribute('aria-pressed')).toBe('true');
    });

    it('empieza una conversación nueva: se vacía el chat y la próxima pregunta no lleva conversacionId; en reportes lleva funcion y en ayuda no', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = (_c, n) => respuestaNormal([n === 1 ? 'Respuesta de ayuda.' : 'Respuesta de reportes.']);
        await abrirPanel();
        await preguntarAlAsistente('¿Cómo armo un reporte?');
        await esperarTerminada();
        expect(b.cuerpos('POST', PREGUNTAR)[0]).toEqual({ pregunta: '¿Cómo armo un reporte?', ruta: '/gestion' });

        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await esperar(() => document.querySelectorAll('[data-testid="burbuja-asistente"]').length === 0, { que: 'el chat vacío' });
        await preguntarAlAsistente('Un listado de casos con teléfono');
        await esperarTerminada();
        expect(b.cuerpos('POST', PREGUNTAR)[1]).toEqual({ pregunta: 'Un listado de casos con teléfono', ruta: '/gestion', funcion: 'reportes' });
    });

    it('al cambiar pide el estado de esa función, y el límite diario de reportes dice «pedidos de reportes»', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        const antes = b.srv.cuantos('GET', /^\/asistente\/estado(\?|$)/);
        b.estado = { habilitado: true, pausa: null, limiteDiario: { usadas: 40, limite: 40 } };
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await esperar(() => b!.srv.de('GET', /^\/asistente\/estado(\?|$)/).some((p) => p.ruta.includes('funcion=reportes')), { que: 'el estado de reportes' });
        expect(b.srv.cuantos('GET', /^\/asistente\/estado(\?|$)/)).toBe(antes + 1);
        await esperar(() => alertas().some((a) => a.texto.startsWith('Llegaste al límite de 40 pedidos de reportes de hoy. Mañana se renueva.')), { que: 'el aviso del límite' });
        expect(botonModo('Armar un reporte')!.disabled).toBe(false);
    });

    it('«Detener» corta una respuesta en curso; el selector queda quieto mientras se escribe', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Escribiendo…')], 30, { cerrar: false });
        await abrirPanel();
        await preguntarAlAsistente('algo');
        await esperar(() => botonDetener(), { que: 'Detener' });
        expect(botonModo('Armar un reporte')!.disabled).toBe(true);
        await clic(botonDetener(), 'Detener');
        await esperarTerminada();
        expect(botonModo('Armar un reporte')!.disabled).toBe(false);
    });
});

describe('Se acuerda del modo', () => {
    it('lo guarda y la próxima vez arranca ahí', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        expect(localStorage.getItem('amsa_asistente_modo')).toBe('reportes');
        await bajarIA(b);
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        expect(modoDelPanel()).toBe('reportes');
        expect(b.srv.de('GET', /^\/asistente\/estado(\?|$)/).some((p) => p.ruta.includes('funcion=reportes'))).toBe(true);
    });

    it('un modo guardado que ya no se puede usar (le sacaron el permiso) se ignora: arranca en la ayuda', async () => {
        localStorage.setItem('amsa_asistente_modo', 'reportes');
        b = await armarIA({ permisos: PERMISOS_IA });
        await abrirPanel();
        expect(modoDelPanel()).toBe('ayuda');
        expect(selector()).toBeNull();
    });

    it('con localStorage que tira error al leer y al escribir, igual funciona y arranca en la ayuda', async () => {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
            if (k === 'amsa_asistente_modo') throw new Error('SecurityError');
            return getItem.call(this, k);
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
            if (k === 'amsa_asistente_modo') throw new Error('QuotaExceededError');
            return setItem.call(this, k, v);
        });
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        expect(modoDelPanel()).toBe('ayuda');
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await esperar(() => modoDelPanel() === 'reportes', { que: 'el cambio de modo aunque no se pueda guardar' });
    });
});

describe('Soltar un archivo', () => {
    const csv = () => new File(['a;b\n1;2\n'], 'ejemplo.csv', { type: 'text/csv' });

    it('en la ayuda ofrece pasar a «Armar un reporte» (no sube nada solo) y al aceptar cambia de modo y lo sube', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        const e = await soltar(csv());
        expect(e.defaultPrevented).toBe(true);
        await esperar(() => alertas().some((a) => /archivo de ejemplo sirve para armar un reporte/.test(a.texto)), { que: 'la oferta' });
        expect(b.srv.cuantos('POST', ADJUNTOS)).toBe(0);
        expect(modoDelPanel()).toBe('ayuda');

        await clic(boton(/^Pasar a «Armar un reporte»$/), 'Pasar a «Armar un reporte»');
        await esperar(() => modoDelPanel() === 'reportes', { que: 'el cambio de modo' });
        await esperar(() => b!.srv.cuantos('POST', ADJUNTOS) === 1, { que: 'la subida' });
        await esperar(() => /ejemplo\.csv/.test(limpio(panel()!.textContent ?? '')), { que: 'el chip del adjunto' });
    });

    it('sin permiso para armar reportes se frena igual (el navegador no abre el archivo) pero no se ofrece nada', async () => {
        b = await armarIA({ permisos: PERMISOS_IA });
        await abrirPanel();
        const e = await soltar(csv());
        expect(e.defaultPrevented).toBe(true);
        await pasar(150);
        expect(alertas().some((a) => /archivo de ejemplo/.test(a.texto))).toBe(false);
        expect(b.srv.cuantos('POST', ADJUNTOS)).toBe(0);
    });

    it('en el modo reportes lo sube directo', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await soltar(csv());
        await esperar(() => b!.srv.cuantos('POST', ADJUNTOS) === 1, { que: 'la subida' });
    });
});

describe('Si le sacan el permiso con la sesión abierta', () => {
    it('403 SIN_PERMISO_FUNCION: el selector desaparece, queda el mensaje del servidor y la conversación se descarta', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => ({ status: 403, body: { codigo: 'SIN_PERMISO_FUNCION', mensaje: 'Para armar reportes con amaIA hacen falta los permisos «amaIA: armar reportes» y «Crear reportes». Pedíselos a un administrador.', message: 'x' } });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await preguntarAlAsistente('Un listado');
        await esperar(() => selector() === null, { que: 'el selector fuera' });
        await esperar(() => alertas().some((a) => a.texto.includes('hacen falta los permisos «amaIA: armar reportes» y «Crear reportes»')), { que: 'el mensaje' });
        expect(modoDelPanel()).toBe('ayuda');
        expect(document.querySelectorAll('[data-testid="burbuja-asistente"]').length).toBe(0);
        expect(entrada()!.value).toBe('Un listado');
    });

    it('409 FUNCION_DISTINTA: sigue con una conversación nueva en el modo actual y devuelve el texto al cuadro', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = (_c, n) => (n === 1
            ? respuestaNormal(['Hola.'])
            : { status: 409, body: { codigo: 'FUNCION_DISTINTA', mensaje: 'Esta conversación es de ayuda. Empezá una nueva en «Armar un reporte».', message: 'x' } });
        await abrirPanel();
        await preguntarAlAsistente('primera');
        await esperarTerminada();
        await preguntarAlAsistente('segunda');
        await esperar(() => alertas().some((a) => /Esta conversación es de ayuda/.test(a.texto)), { que: 'el aviso con el mensaje del backend' });
        expect(document.querySelectorAll('[data-testid="burbuja-asistente"]').length).toBe(0);
        expect(entrada()!.value).toBe('segunda');
        expect(modoDelPanel()).toBe('ayuda');
    });
});

describe('El texto del límite diario sale del 429 (su código y su mensaje), no del modo', () => {
    const rechazo = (codigo: string, mensaje: string, usadas: number, limite: number, extra: Record<string, unknown> = {}) =>
        ({ status: 429, body: { codigo, mensaje, message: mensaje, usadas, limite, ...extra } });
    const textoLimite = () => alertas().map((a) => a.texto).find((t) => /Llegaste al límite/.test(t)) ?? '';
    const GENERAL = 'Llegaste al límite de 100 preguntas de hoy. Mañana se renueva.';
    const FUNCION = 'Llegaste al límite de 40 pedidos de reportes de hoy. Mañana se renueva.';

    it('modo reportes + LIMITE_FUNCION: el mensaje de la función', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => rechazo('LIMITE_FUNCION', FUNCION, 40, 40, { funcion: 'reportes' });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await preguntarAlAsistente('algo');
        await esperar(() => textoLimite() !== '', { que: 'el cartel' });
        expect(textoLimite()).toContain(FUNCION);
        expect(entrada()!.value).toBe('algo');
    });

    it('modo reportes + LIMITE_DIARIO (el general): el mensaje general', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => rechazo('LIMITE_DIARIO', GENERAL, 100, 100);
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await preguntarAlAsistente('algo');
        await esperar(() => textoLimite() !== '', { que: 'el cartel' });
        expect(textoLimite()).toContain(GENERAL);
        expect(textoLimite()).not.toContain('reportes');
    });

    it('después de un LIMITE_DIARIO general en reportes, la revisión periódica no lo borra (el estado de la función no lo sabe); «Volver a probar» sí', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => rechazo('LIMITE_DIARIO', GENERAL, 100, 100);
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await preguntarAlAsistente('algo');
        await esperar(() => textoLimite() !== '', { que: 'el cartel' });
        const pedidos = b.srv.cuantos('GET', /^\/asistente\/estado(\?|$)/);
        await act(async () => { window.dispatchEvent(new Event('focus')); });
        await esperar(() => b!.srv.cuantos('GET', /^\/asistente\/estado(\?|$)/) > pedidos, { que: 'la revisión' });
        await pasar(150);
        expect(textoLimite()).toContain(GENERAL);
        await clic(boton('Volver a probar'), 'Volver a probar');
        await esperar(() => textoLimite() === '', { que: 'el cartel fuera' });
    });

    it('modo ayuda + LIMITE_DIARIO: el mensaje general', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => rechazo('LIMITE_DIARIO', GENERAL, 100, 100);
        await abrirPanel();
        await preguntarAlAsistente('algo');
        await esperar(() => textoLimite() !== '', { que: 'el cartel' });
        expect(textoLimite()).toContain(GENERAL);
    });

    it('modo ayuda + LIMITE_FUNCION de la ayuda: el mensaje del backend, sin «pedidos de reportes»', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => rechazo('LIMITE_FUNCION', 'Llegaste al límite de 30 preguntas de ayuda de hoy. Mañana se renueva.', 30, 30, { funcion: 'ayuda' });
        await abrirPanel();
        await preguntarAlAsistente('algo');
        await esperar(() => textoLimite() !== '', { que: 'el cartel' });
        expect(textoLimite()).toContain('30 preguntas de ayuda');
        expect(textoLimite()).not.toContain('reportes');
    });

    it('el estado que pide el panel al abrir el modo reportes (límite de la función) dice «pedidos de reportes»', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        b.estado = { habilitado: true, pausa: null, limiteDiario: { usadas: 40, limite: 40 } };
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await esperar(() => textoLimite().includes('40 pedidos de reportes'), { que: 'el cartel de la función' });
    });
});

describe('Conversaciones anteriores y permisos', () => {
    it('en la ayuda también se pide la lista con funcion=ayuda', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        await abrirPanel();
        await clic(document.querySelector('button[aria-label="Más opciones"]'), 'el menú');
        await esperar(() => b!.srv.de('GET', /^\/asistente\/conversaciones(\?|$)/).length > 0, { que: 'la lista' });
        expect(b.srv.de('GET', /^\/asistente\/conversaciones(\?|$)/)[0].ruta).toContain('funcion=ayuda');
    });

    it('un 403 SIN_PERMISO_FUNCION al subir un ejemplo también saca el selector de modo', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.subirAdjunto = () => ({ status: 403, body: { codigo: 'SIN_PERMISO_FUNCION', mensaje: 'Para armar reportes con amaIA hacen falta permisos que no tenés.', message: 'x' } });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await elegirArchivos(document.querySelector('[data-testid="entrada-archivos"]'), [new File(['x'], 'a.csv')]);
        await esperar(() => selector() === null, { que: 'el selector fuera' });
        await esperar(() => alertas().some((a) => a.texto.includes('que no tenés')), { que: 'el motivo' });
        expect(modoDelPanel()).toBe('ayuda');
    });

    it('un 400 ADJUNTO_INVALIDO al preguntar devuelve el texto y los ejemplos al compositor, con el mensaje del backend', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => ({ status: 400, body: { codigo: 'ADJUNTO_INVALIDO', mensaje: 'Uno de los archivos ya no sirve: volvé a subirlo.', message: 'x' } });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await elegirArchivos(document.querySelector('[data-testid="entrada-archivos"]'), [new File(['x'], 'a.csv')]);
        await esperar(() => document.querySelector('[data-testid="adjunto-chip"][data-estado="listo"]'), { que: 'el chip' });
        await preguntarAlAsistente('armalo');
        await esperar(() => alertas().some((a) => a.texto.includes('volvé a subirlo')), { que: 'el aviso' });
        expect(entrada()!.value).toBe('armalo');
        expect(document.querySelectorAll('[data-testid="adjunto-chip"]').length).toBe(1);
        expect(document.querySelectorAll('[data-testid="burbuja-asistente"]').length).toBe(0);
        // Es un aviso para corregir, no un cartel de «Nueva conversación».
        expect(boton('Nueva conversación')).toBeNull();
    });

    it('subir dos veces el mismo archivo (el servidor devuelve el mismo id) no deja dos chips con el mismo id', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.subirAdjunto = () => ({ status: 201, body: adjuntoIA({ id: 777 }) });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await elegirArchivos(document.querySelector('[data-testid="entrada-archivos"]'), [new File(['x'], 'a.csv')]);
        await esperar(() => document.querySelector('[data-testid="adjunto-chip"][data-estado="listo"]'), { que: 'el primero' });
        await elegirArchivos(document.querySelector('[data-testid="entrada-archivos"]'), [new File(['x'], 'a.csv')]);
        await esperar(() => document.querySelector('[data-testid="adjunto-chip"][data-estado="error"]'), { que: 'el repetido' });
        const chips = Array.from(document.querySelectorAll('[data-testid="adjunto-chip"]'));
        expect(chips.map((c) => c.getAttribute('data-estado'))).toEqual(['listo', 'error']);
        expect(limpio(chips[1].textContent ?? '')).toContain('ya está adjunto');
        // Quitar el repetido no borra el archivo del primero.
        await clic(chips[1].querySelector('button[aria-label^="Quitar"]'), 'Quitar el repetido');
        await pasar(150);
        expect(b.srv.cuantos('DELETE', /^\/asistente\/adjuntos\/\d+/)).toBe(0);
    });
});

describe('Errores nuevos del backend', () => {
    it('PROMPT_DEMASIADO_GRANDE: muestra el mensaje, no ofrece «Reintentar» (daría lo mismo) y devuelve texto y ejemplos al compositor para quitar el que sobra', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.error({ codigo: 'PROMPT_DEMASIADO_GRANDE', mensaje: 'El ejemplo es demasiado grande. Quitá un archivo o usá uno más chico.' })], 10);
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await elegirArchivos(document.querySelector('[data-testid="entrada-archivos"]'), [new File(['x'], 'a.csv')]);
        await esperar(() => document.querySelector('[data-testid="adjunto-chip"][data-estado="listo"]'), { que: 'el chip' });
        await preguntarAlAsistente('armalo');
        await esperar(() => alertas().some((a) => a.texto.includes('El ejemplo es demasiado grande')), { que: 'el error' });
        expect(boton('Reintentar')).toBeNull();
        await esperar(() => entrada()!.value === 'armalo', { que: 'el texto devuelto' });
        await esperar(() => document.querySelectorAll('[data-testid="adjunto-chip"]').length === 1, { que: 'el ejemplo devuelto' });
    });

    it('429 OCUPADO al subir un ejemplo: el chip ofrece «Reintentar» y vuelve a subir el mismo archivo', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.subirAdjunto = (_a, n) => (n === 1
            ? { status: 429, body: { codigo: 'OCUPADO', mensaje: 'Hay muchos archivos leyéndose. Probá de nuevo en un momento.', message: 'x' } }
            : { status: 201, body: adjuntoIA({ id: 900 + n }) });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await elegirArchivos(document.querySelector('[data-testid="entrada-archivos"]'), [new File(['x'], 'a.csv')]);
        await esperar(() => document.querySelector('[data-testid="adjunto-chip"][data-estado="error"]'), { que: 'el chip con error' });
        expect(limpio(document.querySelector('[data-testid="adjunto-chip"]')!.textContent ?? '')).toContain('Hay muchos archivos leyéndose');
        await clic(boton('Reintentar'), 'Reintentar');
        await esperar(() => document.querySelector('[data-testid="adjunto-chip"][data-estado="listo"]'), { que: 'el chip listo' });
        expect(b.srv.cuantos('POST', ADJUNTOS)).toBe(2);
        expect(document.querySelectorAll('[data-testid="adjunto-chip"]').length).toBe(1);
    });

    it('los otros errores de la subida (multer, ya con código y en castellano) no ofrecen reintentar', async () => {
        b = await armarIA({ permisos: PERMISOS_REPORTES_IA });
        b.subirAdjunto = () => ({ status: 400, body: { codigo: 'DEMASIADOS_ARCHIVOS', mensaje: 'Se puede subir un solo archivo por vez.', message: 'x' } });
        await abrirPanel();
        await clic(botonModo('Armar un reporte'), 'Armar un reporte');
        await elegirArchivos(document.querySelector('[data-testid="entrada-archivos"]'), [new File(['x'], 'a.csv')]);
        await esperar(() => limpio(document.body.textContent ?? '').includes('Se puede subir un solo archivo por vez.'), { que: 'el mensaje' });
        expect(boton('Reintentar')).toBeNull();
    });
});
