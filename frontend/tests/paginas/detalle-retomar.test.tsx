// C1 — retomar (§10.8.5) y MC-9: después de retomar, la pantalla vuelve a seguir la carga sola, con el socket
// conectado y con el socket caído. Detalle y asistente reales.
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASURA, TXT_CANCELADA_DEUDORES, TXT_CANCELADA_SIN_ARRANCAR, canceladaC1, dtoC1, dtoFaseB, enColaC1, iso, terminal, terminalC1 } from '../lib/fabricas';
import { enElSpec10 } from '../lib/spec';
import { alertas, boton, chips, clic, dialogo, dobleClic, esperar, limpio, pasar, toasts } from '../lib/montar';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';
import { instalarAdaptador, usarGuion } from '../lib/wizard';
import { armarBancoC1, filasDeCortes, hastaLaVistaPreviaDividida, hastaLosCortes, type BancoC1 } from '../lib/banco-asistente';

const RETOMAR = /^\/import\/remesas\/\d+\/retomar$/;
const RETOMAR_GRUPO = /^\/import\/grupos\/[^/]+\/retomar$/;
const PROGRESO = /^\/import\/remesas\/141\/progreso$/;
const SIN_ESTADO = 'La plantilla no tiene estado inicial configurado.\n\nNo se cargó ninguna fila. Para cargarla, usá «Retomar» en el detalle de la importación: no hace falta volver a subir el archivo.';
const fallidaRetomable = (over: Record<string, unknown> = {}) => terminalC1('FALLIDA', { rev: 8, error: SIN_ESTADO, procesadas: 0, ok: 0, err: 0, progreso: 0, retomable: true, ...over });
const dlgRetomar = () => dialogo(/^Retomar la/);

describe('detalle: cuándo se ofrece «Retomar»', () => {
    let b: BancoDetalle | null = null;
    afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
    const cerrar = async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; };

    it('solo con `retomable === true` y con permiso; nunca deducido de los contadores', async () => {
        const TODOS = ['importacion.ver_historial', 'importacion.ejecutar', 'importacion.ver_progreso_otros'];
        const casos: Array<[string, any, any, boolean]> = [
            ['FALLIDA retomable, dueño', fallidaRetomable(), {}, true],
            ['cancelada en cola retomable', canceladaC1({ startedAt: null, procesadas: 0, ok: 0, err: 0, error: TXT_CANCELADA_SIN_ARRANCAR, retomable: true }), {}, true],
            ['FALLIDA sin arrancar, todo en cero, `retomable: false`', terminalC1('FALLIDA', { error: 'x', startedAt: null, procesadas: 0, ok: 0, err: 0 }), {}, false],
            ['FALLIDA en cero SIN el campo (Fase B)', terminal('FALLIDA', { error: 'x', startedAt: null, procesadas: 0, ok: 0, err: 0 }), {}, false],
            ['cancelada a medias (3.000 filas), `retomable: false`', canceladaC1(), {}, false],
            ['retomable, dueño SIN importacion.ejecutar', fallidaRetomable(), { permisos: ['importacion.ver_historial'] }, false],
            ['retomable, otro usuario con ejecutar', fallidaRetomable(), { usuarioId: 8 }, false],
            ['retomable, otro usuario con ejecutar + ver_progreso_otros', fallidaRetomable(), { usuarioId: 8, permisos: TODOS }, true],
            ['`retomable: "true"` (string)', fallidaRetomable({ retomable: 'true' }), {}, false],
            ['OK terminada', terminalC1('OK'), {}, false],
        ];
        const visto: Record<string, boolean> = {};
        for (const [nombre, dto, o, esperado] of casos) {
            b = await armarDetalle(dto, o);
            visto[nombre] = !!boton('Retomar', b.v.contenedor);
            expect(visto[nombre], nombre).toBe(esperado);
            expect(b.texto(), nombre).not.toMatch(BASURA);
            await cerrar();
        }
    });

    it('DTO incoherente: en curso con `retomable: true` → ¿ofrece Retomar junto a Cancelar?', async () => {
        b = await armarDetalle(dtoC1({ retomable: true }));
    });

    it('pide confirmación con el texto de §10.8.5; cancelar la confirmación no pide nada; doble clic = 1 pedido', async () => {
        b = await armarDetalle(fallidaRetomable());
        b.retomar = async (id) => { await new Promise((r) => setTimeout(r, 200)); const c = enColaC1({ rev: 9 }); b!.estados[id] = c; return { status: 201, body: { message: 'ok', remesaId: id, carga: c } }; };
        await clic(boton('Retomar', b.v.contenedor), 'Retomar');
        await esperar(() => !!dlgRetomar(), { que: 'la confirmación' });
        const txt = limpio(dlgRetomar()!.textContent ?? '');
        expect(txt).toContain(enElSpec10('Se vuelve a encolar la misma remesa, con el mismo archivo. No se cargó ninguna fila la vez anterior.'));
        await clic(boton('Cancelar', dlgRetomar()!), 'Cancelar');
        await pasar(300);
        expect(b.srv.cuantos('POST', RETOMAR)).toBe(0);
        // Doble clic en el botón de la página y doble clic en el de confirmar.
        await dobleClic(boton('Retomar', b.v.contenedor), 'Retomar');
        await esperar(() => !!dlgRetomar(), { que: 'la confirmación (2)' });
        await dobleClic(boton('Retomar', dlgRetomar()!), 'confirmar');
        await esperar(() => chips(b!.v.contenedor).includes('En cola'), { que: 'en cola' });
        await pasar(500);
        expect(b.srv.cuantos('POST', RETOMAR)).toBe(1);
    });

    it('409 y 503: se muestra el texto del backend y la pantalla queda como estaba', async () => {
        for (const [status, message] of [[409, 'Esta importación ya procesó filas: no se puede retomar. Mirá el motivo de la falla para saber qué hacer.'], [409, 'Ya tenés una importación en curso.'], [503, 'No se pudo encolar la importación: la cola no responde.'], [400, 'El archivo de la remesa ya no está en el servidor.']] as Array<[number, string]>) {
            b = await armarDetalle(fallidaRetomable());
            b.retomar = () => ({ status, body: { statusCode: status, message } });
            await clic(boton('Retomar', b.v.contenedor), 'Retomar');
            await esperar(() => !!dlgRetomar(), { que: 'la confirmación' });
            await clic(boton('Retomar', dlgRetomar()!), 'confirmar');
            await esperar(() => toasts().length > 0, { que: 'el toast' });
            await pasar(250);
            expect(toasts().map((t) => t.texto), String(status)).toContain(message);
            expect(alertas().some((a) => /^La importación falló/.test(a.texto)), String(status)).toBe(true);
            expect(boton('Retomar', b.v.contenedor)!.disabled).toBe(false);
            await cerrar();
        }
    });
});

describe('MC-9 — detalle: después de retomar vuelve a seguir la carga sola', () => {
    let b: BancoDetalle | null = null;
    afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

    async function retomar(bb: BancoDetalle) {
        await clic(boton('Retomar', bb.v.contenedor), 'Retomar');
        await esperar(() => !!dlgRetomar(), { que: 'la confirmación' });
        await clic(boton('Retomar', dlgRetomar()!), 'confirmar');
    }

    it('socket conectado: aplica la `carga` del 201 y sigue por eventos hasta el final, sin F5', async () => {
        b = await armarDetalle(fallidaRetomable());
        b.retomar = (id) => { const c = enColaC1({ rev: 9, enColaDelante: 0 }); b!.estados[id] = c; return { status: 201, body: { message: 'ok', remesaId: id, carga: c } }; };
        const remesaAntes = b.srv.cuantos('GET', /^\/import\/remesas\/141$/);
        await retomar(b);
        await esperar(() => chips(b!.v.contenedor).includes('En cola'), { que: 'en cola' });
        await pasar(150);
        expect(boton('Retomar', b.v.contenedor)).toBeNull();
        expect(alertas().some((a) => /La importación falló/.test(a.texto))).toBe(false);
        const base = { startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()) };
        b.pub('import:iniciada', dtoC1({ ...base, rev: 10, procesadas: 0, ok: 0, err: 0, progreso: 0 }));
        b.pub('import:progreso', dtoC1({ ...base, rev: 11, procesadas: 7000, ok: 7000, err: 0, progreso: 48 }));
        await esperar(() => /Procesando · 48% completado/.test(b!.texto()), { ms: 3000, que: 'procesando' });
        b.pub('import:finalizada', terminalC1('OK', { ...base, rev: 12, procesadas: 14466, ok: 14466, err: 0 }));
        await esperar(() => chips(b!.v.contenedor).includes('Finalizada'), { ms: 3000, que: 'finalizada' });
        await pasar(300);
        expect(Array.from(document.querySelectorAll('.MuiCard-root .MuiTypography-h4')).map((e) => limpio(e.textContent ?? ''))).toEqual(['14.466', '14.466', '0', '100%']);
        expect(b.srv.cuantos('GET', /^\/import\/remesas\/141$/) - remesaAntes).toBeGreaterThanOrEqual(1);
        expect(b.srv.cuantos('POST', RETOMAR)).toBe(1);
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('ARREGLADO (hallazgo 5): socket caído y la respuesta del 201 se pierde → tras el error la pantalla consulta el estado real y queda «En cola», sin el botón Retomar', async () => {
        b = await armarDetalle(fallidaRetomable(), { aceptarSockets: false });
        await pasar(400);
        b.retomar = (id) => { b!.estados[id] = enColaC1({ rev: 9, enColaDelante: 0 }); return { status: 504, body: { message: 'Gateway Time-out' } }; };
        const base = b.srv.cuantos('GET', PROGRESO);
        await retomar(b);
        await esperar(() => toasts().length > 0, { que: 'el error' });
        await esperar(() => chips(b!.v.contenedor).includes('En cola'), { ms: 4000, que: 'el estado real' });
        await pasar(200);
        expect(boton('Retomar', b.v.contenedor)).toBeNull();
        expect(alertas().some((a) => /^La importación falló/.test(a.texto))).toBe(false);
        expect(b.srv.cuantos('POST', RETOMAR)).toBe(1);
    });

    it('el 409 nuevo del backend (el corte ya figura en otra remesa): se muestra tal cual, la pantalla queda como estaba y se puede ir al Historial', async () => {
        const MSG = 'El corte de esta remesa ya figura en la remesa 3090: no se puede retomar. Si esta ya no hace falta, eliminala desde el Historial.';
        b = await armarDetalle(fallidaRetomable());
        // El backend ya no la da por retomable después de rechazarla (o la sigue dando): se prueban las dos.
        b.retomar = () => ({ status: 409, body: { statusCode: 409, message: MSG } });
        const base = b.srv.cuantos('GET', PROGRESO);
        await retomar(b);
        await esperar(() => toasts().length > 0, { que: 'el toast' });
        await pasar(400);
        expect(toasts()).toEqual([{ variante: 'error', texto: MSG }]);
        expect(alertas().some((a) => /^La importación falló/.test(a.texto))).toBe(true);
        expect(dlgRetomar()).toBeNull();
        expect(b.srv.cuantos('GET', PROGRESO) - base).toBeGreaterThanOrEqual(1);
        expect(b.texto()).not.toMatch(BASURA);
        // Si el DTO real deja de decir `retomable` (el backend lo sabe), el botón se va con el refresco.
        b.estados[141] = fallidaRetomable({ rev: 9, retomable: false });
        await retomar(b);
        await esperar(() => !boton('Retomar', b!.v.contenedor), { ms: 4000, que: 'el botón retirado tras el refresco' });
        expect(b.srv.cuantos('POST', RETOMAR)).toBe(2);
    });

    it('la `carga` del 201 con un `rev` que no supera al del terminal (contrato roto): el detalle la descarta', async () => {
        b = await armarDetalle(fallidaRetomable({ rev: 8 }));
        b.retomar = (id) => { const c = enColaC1({ rev: 7, enColaDelante: 0 }); b!.estados[id] = c; return { status: 201, body: { message: 'ok', remesaId: id, carga: c } }; };
        await retomar(b);
        await esperar(() => b!.srv.cuantos('POST', RETOMAR) === 1, { que: 'el pedido' });
        await pasar(1500);
    });
});

