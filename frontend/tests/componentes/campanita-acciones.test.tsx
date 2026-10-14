// C2b, paquete B: las acciones de las notificaciones de importación terminada (TC-4 a TC-6) y las de una carga en curso (TC-7).
// La campanita real (NotificacionesBell + NotificacionesProvider) contra el servidor falso.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as descargas from '@fe/utils/descargas';
import { canceladaC1, terminalC1, dtoC1, enColaC1 } from '../lib/fabricas';
import { alertas, boton, clic, dialogo, esperar, limpio, pasar, toasts } from '../lib/montar';
import { abrirCampanita, armarCampanita, campanitaAbierta, cargaC1, notificacion, ruta, type BancoCampanita } from '../lib/banco-campanita';
import { leerBlob } from '../lib/blobs';

vi.mock('@fe/utils/descargas', async (original) => ({ ...(await original<typeof import('@fe/utils/descargas')>()), descargarBlob: vi.fn() }));

let b: BancoCampanita | null = null;
beforeEach(() => { vi.mocked(descargas.descargarBlob).mockClear(); });
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const PROGRESO = /^\/import\/remesas\/141\/progreso$/;
const POST_RETOMAR = /^\/import\/remesas\/141\/retomar$/;
const CSV = /^\/import\/errores\/141\/csv/;
const orden = (b0: BancoCampanita, metodo: string, patron: RegExp) => b0.srv.pedidos.findIndex((p) => p.metodo === metodo && patron.test(p.ruta.split('?')[0]));
const enCampanita = (etiqueta: string | RegExp) => boton(etiqueta, document.querySelector('.MuiPopover-paper, .MuiDialog-paperFullScreen') ?? document.body);
const dlgConfirmar = () => dialogo(/^Retomar la remesa$/);

/** La notificación de una importación cancelada antes de procesar nada. */
const notifCancelada = (over: Parameters<typeof notificacion>[0] = {}) => notificacion({
    tipo: 'IMPORTACION_ERROR', titulo: 'Importación cancelada', payload: { resultado: 'FALLIDA', cancelada: true, procesadas: 0, ok: 0, err: 0, advertencias: 0 }, ...over,
});
const notifConErrores = (over: Parameters<typeof notificacion>[0] = {}) => notificacion({
    titulo: 'Importación finalizada con errores', payload: { resultado: 'CON_ERRORES', procesadas: 100, ok: 88, err: 12, advertencias: 0 }, ...over,
});
const retomable = (over: Record<string, unknown> = {}) => canceladaC1({ remesaId: 141, numeroRemesa: '00141', usuarioId: 3, procesadas: 0, ok: 0, err: 0, progreso: 0, retomable: true, ...over });

describe('TC-4 — Retomar desde una notificación', () => {
    it('consulta el estado ANTES de retomar, confirma, retoma, avisa y la carga aparece en curso', async () => {
        const nueva = cargaC1(141, { fase: 'EN_COLA', enColaDelante: 0, procesadas: 0, ok: 0, err: 0, progreso: 0, startedAt: null, heartbeatAt: null });
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [retomable()] });
        b.retomar = () => { b!.enCurso = [nueva]; return { status: 201, body: { message: 'ok', carga: nueva } }; };
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        const d = await esperar(() => dlgConfirmar(), { que: 'la confirmación' });
        expect(limpio(d.textContent ?? '')).toContain('Se vuelve a encolar la misma remesa, con el mismo archivo.');
        expect(b.srv.cuantos('POST', POST_RETOMAR)).toBe(0);
        await clic(boton('Retomar', d), 'confirmar');
        await esperar(() => b!.srv.cuantos('POST', POST_RETOMAR) === 1, { que: 'el POST' });
        expect(orden(b, 'GET', PROGRESO)).toBeGreaterThanOrEqual(0);
        expect(orden(b, 'GET', PROGRESO)).toBeLessThan(orden(b, 'POST', POST_RETOMAR));
        await esperar(() => toasts().some((t) => t.texto === 'Importación retomada: quedó en la cola.'), { que: 'el aviso' });
        await esperar(() => /Importaciones en curso \(1\)/.test(limpio(document.body.textContent ?? '')), { que: 'la carga en la sección de en curso' });
        expect(ruta()).toBe('/pagina-a');
    });

    it('si el usuario no confirma, no manda nada', async () => {
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [retomable()] });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        const d = await esperar(() => dlgConfirmar(), { que: 'la confirmación' });
        await clic(boton('Cancelar', d), 'cancelar');
        await pasar(300);
        expect(b.srv.cuantos('POST', POST_RETOMAR)).toBe(0);
    });

    it('`retomable: false` por un corte repetido: dice el motivo y no manda nada', async () => {
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [retomable({ retomable: false, corteRepetidoEn: ['00150'] })] });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts()).toEqual([{ variante: 'info', texto: 'El corte de esta remesa ya figura en la remesa 00150: no se puede retomar. Si esta ya no hace falta, eliminala.' }]);
        expect(b.srv.cuantos('POST', POST_RETOMAR)).toBe(0);
        expect(dlgConfirmar()).toBeNull();
    });

    it('`retomable: false` sin otro motivo: el aviso genérico que manda al detalle', async () => {
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [retomable({ retomable: false })] });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts()[0].texto).toBe('Esta importación ya no se puede retomar. Mirá su detalle.');
        expect(b.srv.cuantos('POST', POST_RETOMAR)).toBe(0);
    });

    it('ya en curso (alguien la retomó antes): «ya está en curso» y ningún POST', async () => {
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [cargaC1(141)] });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts()).toEqual([{ variante: 'info', texto: 'Esta importación ya está en curso.' }]);
        expect(b.srv.cuantos('POST', POST_RETOMAR)).toBe(0);
    });

    it('ajena y sin `ver_progreso_otros`: «solo quien la cargó» y ningún POST', async () => {
        b = await armarCampanita({
            permisos: ['importacion.ver_historial', 'importacion.ejecutar'], usuarioId: 3,
            notificaciones: [notifCancelada()], estados: [retomable({ usuarioId: 9, usuarioNombre: 'Otra' })],
        });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts()).toEqual([{ variante: 'info', texto: 'Solo quien la cargó puede retomarla.' }]);
        expect(b.srv.cuantos('POST', POST_RETOMAR)).toBe(0);
    });

    it('ajena pero con `ver_progreso_otros`: puede retomarla', async () => {
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [retomable({ usuarioId: 9, usuarioNombre: 'Otra' })] });
        b.retomar = () => ({ status: 201, body: { message: 'ok', carga: cargaC1(141, { fase: 'EN_COLA' }) } });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        await clic(boton('Retomar', await esperar(() => dlgConfirmar(), { que: 'la confirmación' })), 'confirmar');
        await esperar(() => b!.srv.cuantos('POST', POST_RETOMAR) === 1, { que: 'el POST' });
    });

    it('la remesa ya no existe (404): «ya no existe» y ningún POST', async () => {
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [] });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts()).toEqual([{ variante: 'warning', texto: 'Esta importación ya no existe.' }]);
        expect(b.srv.cuantos('POST', POST_RETOMAR)).toBe(0);
    });

    it('el backend responde 409 (cambió entre la consulta y el pedido): el toast trae el texto del backend', async () => {
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [retomable()] });
        b.retomar = () => ({ status: 409, body: { statusCode: 409, message: 'La importación ya se retomó.' } });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        await clic(boton('Retomar', await esperar(() => dlgConfirmar(), { que: 'la confirmación' })), 'confirmar');
        await esperar(() => toasts().some((t) => t.variante === 'error'), { que: 'el error' });
        expect(toasts().find((t) => t.variante === 'error')!.texto).toBe('La importación ya se retomó.');
    });

    it('no se ofrece «Retomar» en una notificación que procesó filas, ni sin `importacion.ejecutar`', async () => {
        b = await armarCampanita({ notificaciones: [notifConErrores({ id: 1 }), notifCancelada({ id: 2 })], permisos: ['importacion.ver_historial'], estados: [retomable()] });
        await abrirCampanita();
        expect(enCampanita('Retomar')).toBeNull();
        expect(enCampanita('Descargar errores')).not.toBeNull();
    });

    it('doble clic en «Retomar»: una sola consulta (el botón queda deshabilitado mientras corre)', async () => {
        b = await armarCampanita({ notificaciones: [notifCancelada()], estados: [retomable()] });
        await abrirCampanita();
        const antes = b.srv.cuantos('GET', PROGRESO);
        const btn = enCampanita('Retomar');
        btn!.click(); btn!.click();
        await esperar(() => dlgConfirmar(), { que: 'la confirmación' });
        await pasar(200);
        expect(b.srv.cuantos('GET', PROGRESO) - antes).toBe(1);
    });
});

describe('TC-5 — Descargar errores desde una notificación', () => {
    const conCsv = (contenido = '﻿fila;mensaje\n1;DNI inválido\n') => (bb: BancoCampanita) => { bb.csv = () => ({ crudo: { tipo: 'text/csv; charset=utf-8', contenido } }); };

    it('consulta el estado, baja el CSV y lo entrega como `errores-remesa-{numeroRemesa}.csv`', async () => {
        b = await armarCampanita({ notificaciones: [notifConErrores()], estados: [terminalC1('CON_ERRORES', { remesaId: 141, numeroRemesa: '00141', procesadas: 100, ok: 88, err: 12 })], antes: conCsv() });
        await abrirCampanita();
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        await esperar(() => vi.mocked(descargas.descargarBlob).mock.calls.length === 1, { que: 'la entrega del archivo' });
        expect(orden(b, 'GET', PROGRESO)).toBeLessThan(orden(b, 'GET', CSV));
        const [blob, nombre] = vi.mocked(descargas.descargarBlob).mock.calls[0];
        expect(nombre).toBe('errores-remesa-00141.csv');
        expect(await leerBlob(blob as Blob)).toContain('DNI inválido');
        expect(b.srv.de('GET', CSV)[0].ruta).toBe('/import/errores/141/csv?tipo=TODOS');
        expect(ruta()).toBe('/pagina-a');
    });

    it('el número de la remesa sale del estado real, no de la notificación', async () => {
        b = await armarCampanita({ notificaciones: [notifConErrores()], estados: [terminalC1('CON_ERRORES', { remesaId: 141, numeroRemesa: '07777', err: 12, procesadas: 100, ok: 88 })], antes: conCsv() });
        await abrirCampanita();
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        await esperar(() => vi.mocked(descargas.descargarBlob).mock.calls.length === 1, { que: 'la entrega' });
        expect(vi.mocked(descargas.descargarBlob).mock.calls[0][1]).toBe('errores-remesa-07777.csv');
    });

    it('la remesa ya no existe (404): «ya no existe» y ningún pedido de CSV', async () => {
        b = await armarCampanita({ notificaciones: [notifConErrores()], estados: [], antes: conCsv() });
        await abrirCampanita();
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts()).toEqual([{ variante: 'warning', texto: 'Esta importación ya no existe.' }]);
        expect(b.srv.cuantos('GET', CSV)).toBe(0);
        expect(descargas.descargarBlob).not.toHaveBeenCalled();
    });

    it('el CSV falla con un cuerpo JSON dentro de un Blob: el toast dice el mensaje del backend', async () => {
        b = await armarCampanita({ notificaciones: [notifConErrores()], estados: [terminalC1('CON_ERRORES', { remesaId: 141, err: 12, procesadas: 100, ok: 88 })] });
        b.csv = () => ({ status: 500, body: { statusCode: 500, message: 'No se pudo armar el archivo de errores.' } });
        await abrirCampanita();
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        await esperar(() => toasts().length > 0, { que: 'el error' });
        expect(toasts()).toEqual([{ variante: 'error', texto: 'No se pudo armar el archivo de errores.' }]);
        expect(descargas.descargarBlob).not.toHaveBeenCalled();
        expect(enCampanita('Descargar errores')!.disabled).toBe(false);
    });

    it('más de 200.000 entre errores y avisos: pide confirmar con los números del estado real antes de bajar', async () => {
        b = await armarCampanita({
            notificaciones: [notifConErrores()], antes: conCsv(),
            estados: [terminalC1('CON_ERRORES', { remesaId: 141, err: 150_000, advertencias: 60_000, procesadas: 400_000, ok: 250_000 })],
        });
        await abrirCampanita();
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        const d = await esperar(() => dialogo(/^Descargar CSV$/), { que: 'la confirmación' });
        expect(limpio(d.textContent ?? '')).toContain('Esta carga tiene 210.000 errores y avisos. El archivo va a traer los primeros 200.000.');
        expect(b.srv.cuantos('GET', CSV)).toBe(0);
        await clic(boton('Descargar', d), 'confirmar');
        await esperar(() => vi.mocked(descargas.descargarBlob).mock.calls.length === 1, { que: 'la entrega' });
    });

    it('si dice que no, no baja nada', async () => {
        b = await armarCampanita({
            notificaciones: [notifConErrores()], antes: conCsv(),
            estados: [terminalC1('CON_ERRORES', { remesaId: 141, err: 250_000, procesadas: 400_000, ok: 150_000 })],
        });
        await abrirCampanita();
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        const d = await esperar(() => dialogo(/^Descargar CSV$/), { que: 'la confirmación' });
        await clic(boton('Cancelar', d), 'cancelar');
        await pasar(300);
        expect(b.srv.cuantos('GET', CSV)).toBe(0);
    });

    it('con 200.000 justos no pregunta', async () => {
        b = await armarCampanita({ notificaciones: [notifConErrores()], antes: conCsv(), estados: [terminalC1('CON_ERRORES', { remesaId: 141, err: 200_000, procesadas: 400_000, ok: 200_000 })] });
        await abrirCampanita();
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        await esperar(() => vi.mocked(descargas.descargarBlob).mock.calls.length === 1, { que: 'la entrega' });
        expect(dialogo(/^Descargar CSV$/)).toBeNull();
    });

    it('el estado real ya no tiene errores ni avisos (la notificación es vieja): lo dice y no baja un archivo vacío', async () => {
        b = await armarCampanita({ notificaciones: [notifConErrores()], antes: conCsv(), estados: [terminalC1('OK', { remesaId: 141, err: 0, procesadas: 100, ok: 100 })] });
        await abrirCampanita();
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts()[0].texto).toBe('Esta importación no tiene errores ni avisos para descargar.');
        expect(b.srv.cuantos('GET', CSV)).toBe(0);
    });

    it('se ofrece con avisos aunque no haya errores de fila; sin `ver_historial` no se ofrece', async () => {
        const avisos = notificacion({ payload: { resultado: 'CON_ADVERTENCIAS', procesadas: 100, ok: 100, err: 0, advertencias: 3 } });
        b = await armarCampanita({ notificaciones: [avisos], estados: [] });
        await abrirCampanita();
        expect(enCampanita('Descargar errores')).not.toBeNull();
        await b.v.desmontar(); await b.srv.bajar(); b = null;
        b = await armarCampanita({ notificaciones: [avisos], permisos: ['importacion.ejecutar'], estados: [] });
        await abrirCampanita();
        expect(enCampanita('Descargar errores')).toBeNull();
        expect(alertas()).toEqual([]);
    });
});

describe('TC-6 — un botón de acción no es un clic en la fila', () => {
    it('Retomar y Descargar errores no navegan, no marcan como leída y no cierran la campanita; la fila sí', async () => {
        b = await armarCampanita({
            notificaciones: [notifCancelada({ id: 1, payload: { resultado: 'FALLIDA', cancelada: true, procesadas: 0, err: 4 } })],
            estados: [retomable({ err: 4, retomable: false })],
        });
        await abrirCampanita();
        await clic(enCampanita('Retomar'), 'Retomar');
        await clic(enCampanita('Descargar errores'), 'Descargar errores');
        await pasar(500);
        expect(ruta()).toBe('/pagina-a');
        expect(b.srv.cuantos('POST', /\/leer$/)).toBe(0);
        expect(campanitaAbierta()).toBe(true);
        // El espacio entre botones tampoco cuenta como clic en la fila.
        const contenedor = enCampanita('Retomar')!.parentElement!;
        await clic(contenedor, 'el contenedor de las acciones');
        expect(ruta()).toBe('/pagina-a');
        expect(b.srv.cuantos('POST', /\/leer$/)).toBe(0);
        // La fila: navega, marca como leída y cierra la campanita.
        await clic(Array.from(document.querySelectorAll('.MuiTypography-body2')).find((e) => e.textContent === 'Importación cancelada') ?? null, 'el título');
        await esperar(() => ruta() === '/historial-importaciones/141', { que: 'la navegación' });
        await esperar(() => !campanitaAbierta(), { que: 'la campanita cerrada' });
        expect(b.srv.cuantos('POST', /^\/notificaciones\/1\/leer$/)).toBe(1);
        expect(document.querySelector('[data-testid="detalle"]')).not.toBeNull();
    });
});

describe('TC-7 — una carga en curso dentro de la campanita', () => {
    const iconos = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Cancelar"]'));

    it('«Ver detalle» navega al detalle de esa remesa y cierra la campanita', async () => {
        b = await armarCampanita({ enCurso: [cargaC1(201)], estados: [cargaC1(201)] });
        await abrirCampanita();
        const enlace = Array.from(document.querySelectorAll('a')).find((a) => a.textContent === 'Ver detalle') ?? null;
        expect(enlace?.getAttribute('href')).toBe('/historial-importaciones/201');
        await clic(enlace, 'Ver detalle');
        await esperar(() => ruta() === '/historial-importaciones/201', { que: 'la navegación' });
        await esperar(() => !campanitaAbierta(), { que: 'la campanita cerrada' });
    });

    it('el ícono de cancelar abre el diálogo de C1; confirmar cancela esa remesa y la campanita se pone al día', async () => {
        const enCola = enColaC1({ remesaId: 201, numeroRemesa: '00201', usuarioId: 3, usuarioNombre: 'Maxi', rev: 3 });
        b = await armarCampanita({ enCurso: [enCola], estados: [enCola] });
        b.cancelar = (id) => {
            const c = canceladaC1({ remesaId: id, numeroRemesa: '00201', usuarioId: 3, procesadas: 0, ok: 0, err: 0, progreso: 0, rev: 9 });
            b!.enCurso = [];
            return { status: 200, body: { message: 'ok', efecto: 'CANCELADA', carga: c } };
        };
        await abrirCampanita();
        expect(iconos()).toHaveLength(1);
        expect(iconos()[0].getAttribute('aria-label')).toBe('Cancelar importación');
        await clic(iconos()[0], 'cancelar');
        const d = await esperar(() => dialogo(/^Cancelar importación$/), { que: 'el diálogo de cancelar' });
        expect(limpio(d.textContent ?? '')).toContain('Esta importación todavía no empezó.');
        expect(b.srv.cuantos('POST', /cancelar/)).toBe(0);
        await clic(boton('Cancelar importación', d), 'confirmar');
        await esperar(() => b!.srv.cuantos('POST', /^\/import\/remesas\/201\/cancelar$/) === 1, { que: 'el POST' });
        await esperar(() => toasts().some((t) => t.texto === 'Importación cancelada.'), { que: 'el aviso' });
        await esperar(() => !/Importaciones en curso/.test(limpio(document.body.textContent ?? '')), { que: 'la sección de en curso vacía' });
        expect(campanitaAbierta()).toBe(true);
    });

    it('en una división con la actual en post-proceso (no se puede cortar), se ofrece «Cancelar todo lo que falta» y corta el grupo', async () => {
        const g = { grupoId: 'g-7', grupoTotal: 3, usuarioId: 3, usuarioNombre: 'Maxi' };
        const actual = dtoC1({ remesaId: 201, numeroRemesa: '00201', ...g, grupoOrden: 1, fase: 'POST_PROCESO', cancelable: false, progreso: 99, rev: 20 });
        const siguiente = enColaC1({ remesaId: 202, numeroRemesa: '00202', ...g, grupoOrden: 2, enColaDelante: 0, rev: 3 });
        const ultima = enColaC1({ remesaId: 203, numeroRemesa: '00203', ...g, grupoOrden: 3, enColaDelante: 1, rev: 3 });
        b = await armarCampanita({ enCurso: [actual, siguiente, ultima], estados: [actual, siguiente, ultima] });
        b.cancelarGrupo = () => ({ status: 200, body: { resultados: [] } });
        await abrirCampanita();
        const botones = iconos();
        expect(botones.map((x) => x.getAttribute('aria-label'))).toEqual(['Cancelar todo lo que falta', 'Cancelar importación', 'Cancelar importación']);
        expect(botones[0].disabled).toBe(false);
        await clic(botones[0], 'cancelar todo');
        const d = await esperar(() => dialogo(/^Cancelar todo lo que falta$/), { que: 'el diálogo de la división' });
        await esperar(() => !/Buscando/.test(limpio(d.textContent ?? '')), { que: 'la división leída' });
        expect(b.srv.cuantos('POST', /cancelar/)).toBe(0);
        await clic(boton('Cancelar todo lo que falta', d), 'confirmar');
        await esperar(() => b!.srv.cuantos('POST', /^\/import\/grupos\/g-7\/cancelar$/) === 1, { que: 'el pedido al grupo' });
    });

    it('si el pedido de cancelar ya se hizo, el ícono queda deshabilitado con el motivo; en una carga ajena sin permiso no hay ícono', async () => {
        const pedida = cargaC1(201, { cancelacionPedidaAt: new Date().toISOString(), cancelable: false });
        b = await armarCampanita({ enCurso: [pedida], estados: [pedida] });
        await abrirCampanita();
        expect(iconos()).toHaveLength(1);
        expect(iconos()[0].disabled).toBe(true);
        await b.v.desmontar(); await b.srv.bajar(); b = null;
        const ajena = cargaC1(202, { usuarioId: 9, usuarioNombre: 'Otra' });
        b = await armarCampanita({ permisos: ['importacion.ver_historial', 'importacion.ejecutar'], enCurso: [ajena], estados: [ajena] });
        await abrirCampanita();
        await esperar(() => /Remesa 00202/.test(limpio(document.body.textContent ?? '')), { que: 'la carga ajena (llega por socket o HTTP)' });
        expect(iconos()).toHaveLength(0);
    });

    it('la carga en curso no muestra acciones de notificación ni botones de texto', async () => {
        b = await armarCampanita({ enCurso: [cargaC1(201)], estados: [cargaC1(201)] });
        await abrirCampanita();
        expect(enCampanita('Retomar')).toBeNull();
        expect(enCampanita('Descargar errores')).toBeNull();
    });
});

describe('C3b — la notificación de una reversión', () => {
    const notifReversion = (over: Parameters<typeof notificacion>[0] = {}) => notificacion({
        tipo: 'IMPORTACION_FINALIZADA', titulo: 'Acción masiva revertida', mensaje: 'Se deshizo la acción masiva de la remesa 00141.',
        payload: { reversion: { remesaId: 141, empresaId: 1, estado: 'TERMINADA', total: 150, hechos: 150, porcentaje: 100, deudoresRevertidos: 150, contactosRestaurados: 50, comentariosBorrados: 50, casosQueNoExistian: 0, contactosSinCaso: 0, usuarioId: 3, error: null } },
        ...over,
    });

    it('terminada o fallida, sin `resultado` ni contadores: no ofrece Descargar ni Retomar', async () => {
        b = await armarCampanita({ notificaciones: [notifReversion({ id: 1 }), notifReversion({ id: 2, tipo: 'IMPORTACION_ERROR', titulo: 'La reversión no terminó' })] });
        await abrirCampanita();
        expect(enCampanita('Retomar')).toBeNull();
        expect(enCampanita('Descargar errores')).toBeNull();
        expect(document.body.textContent).toContain('Acción masiva revertida');
        expect(document.body.textContent).toContain('La reversión no terminó');
    });

    it('al hacer clic lleva al detalle de la remesa y no pide nada de más', async () => {
        b = await armarCampanita({ notificaciones: [notifReversion({ id: 1 })] });
        await abrirCampanita();
        await clic(Array.from(document.querySelectorAll('.MuiTypography-body2')).find((e) => e.textContent === 'Acción masiva revertida') ?? null, 'el título');
        await esperar(() => ruta() === '/historial-importaciones/141', { que: 'la navegación' });
        expect(b.srv.cuantos('POST', /retomar$/)).toBe(0);
        expect(b.srv.cuantos('GET', /csv/)).toBe(0);
    });
});
