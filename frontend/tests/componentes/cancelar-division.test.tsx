// C1, segunda pasada — cancelar a nivel de la división (punto 1): la remesa en curso no se puede cortar
// (post-proceso, acción masiva ya empezada, pedido ya hecho) pero quedan otras en cola. Qué dice el diálogo,
// qué endpoint se llama y cómo queda la pantalla. Detalle y asistente reales, backend falso.
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASURA, TXT_CANCELADA_SIN_ARRANCAR, canceladaC1, dtoC1, enColaC1, iso, terminalC1 } from '../lib/fabricas';
import { alertas, boton, chips, clic, dialogo, dobleClic, esperar, limpio, pasar, toasts } from '../lib/montar';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';
import { instalarAdaptador, usarGuion } from '../lib/wizard';
import { armarBancoC1, hastaLaVistaPreviaDividida, type BancoC1 } from '../lib/banco-asistente';

const CANCELAR = /^\/import\/remesas\/\d+\/cancelar$/;
const CANCELAR_GRUPO = /^\/import\/grupos\/[^/]+\/cancelar$/;
const POST_C = 'La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar. Esperá a que termine.';
const g = { grupoId: 'g-7', grupoTotal: 4 };
const T = (id: number, orden: number, over: Record<string, unknown> = {}) => terminalC1('OK', { remesaId: id, numeroRemesa: String(2940 + id), ...g, grupoOrden: orden, ...over });
const Q = (id: number, orden: number, over: Record<string, unknown> = {}) => enColaC1({ remesaId: id, numeroRemesa: String(2940 + id), ...g, grupoOrden: orden, enColaDelante: orden - 2, ...over });
const P = (id: number, orden: number, over: Record<string, unknown> = {}) => dtoC1({ remesaId: id, numeroRemesa: String(2940 + id), ...g, grupoOrden: orden, ...over });
const canceladaEnCola = (e: any) => canceladaC1({ ...e, resultado: 'FALLIDA', cancelada: true, fase: 'TERMINADA', estadoProceso: 'FALLIDA', enCurso: false, terminal: true, cancelable: false, retomable: true, rev: e.rev + 1, startedAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, error: TXT_CANCELADA_SIN_ARRANCAR, finishedAt: iso(Date.now()), enColaDelante: null });

describe('desde el DETALLE de la remesa que no se puede cortar', () => {
    let b: BancoDetalle | null = null;
    afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
    const cerrar = async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; };
    const btn = () => boton(/^Cancelar (importación|todo lo que falta)$/, b!.v.contenedor);
    const dlg = () => dialogo(/^Cancelar (importación|todo lo que falta)$/);
    const cuerpo = () => limpio(dlg()?.querySelector('.MuiDialogContent-root')?.textContent ?? '');
    const botonesDlg = () => Array.from(dlg()!.querySelectorAll('button')).map((x) => `${limpio(x.textContent ?? '')}${(x as HTMLButtonElement).disabled ? ' (deshabilitado)' : ''}`);
    const motivo = () => { const bt = btn(); return bt ? limpio(bt.parentElement?.querySelector('.MuiTypography-caption')?.textContent ?? '') : null; };
    const abrir = async () => { await clic(btn(), 'el botón de cancelar'); await esperar(() => !!dlg() && !/Buscando las otras remesas/.test(cuerpo()), { que: 'el diálogo, con el grupo leído' }); await pasar(80); };

    /** Respuesta del backend al cancelar el grupo: las en cola se cancelan; la que cierra se rechaza con (c). */
    const cancelarGrupoReal = (bb: BancoDetalle, enCurso: number, motivoRechazo: string | null = POST_C) => () => {
        const resultados: any[] = [];
        const ids = Object.values(bb.estados).filter((e: any) => e.grupoId === 'g-7').sort((x: any, y: any) => y.grupoOrden - x.grupoOrden).map((e: any) => e.remesaId);
        for (const id of ids) {
            const e = bb.estados[id];
            if (e.terminal) { resultados.push({ remesaId: id, numeroRemesa: e.numeroRemesa, efecto: 'YA_TERMINADA', carga: e }); continue; }
            if (id === enCurso) {
                if (motivoRechazo) resultados.push({ remesaId: id, numeroRemesa: e.numeroRemesa, efecto: 'RECHAZADA', motivo: motivoRechazo, carga: e });
                else { const c = { ...e, rev: e.rev + 1, cancelacionPedidaAt: e.cancelacionPedidaAt ?? iso(Date.now()), canceladaPor: 'Maxi', cancelable: false }; bb.estados[id] = c; resultados.push({ remesaId: id, numeroRemesa: e.numeroRemesa, efecto: 'PEDIDA', carga: c }); }
                continue;
            }
            const c = canceladaEnCola(e); bb.estados[id] = c;
            resultados.push({ remesaId: id, numeroRemesa: e.numeroRemesa, efecto: 'CANCELADA', carga: c });
        }
        return { status: 200, body: { resultados } };
    };

    it('post-proceso con 2 en cola: botón activo «Cancelar todo lo que falta»; el diálogo no promete cortar la que cierra; un solo pedido al grupo; la pantalla queda coherente', async () => {
        b = await armarDetalle(P(141, 2, { fase: 'POST_PROCESO', procesadas: 14466, ok: 14466, err: 0, progreso: 99 }), { otras: [T(140, 1), Q(142, 3), Q(143, 4)] });
        expect(limpio(btn()!.textContent ?? '')).toBe('Cancelar todo lo que falta');
        expect(btn()!.disabled).toBe(false);
        await abrir();
        expect(cuerpo()).toBe('La remesa en curso (3081) ya está cerrando y no se cancela: va a terminar. Se cancelan las 2 que no empezaron (3082 y 3083).');
        expect(botonesDlg()).toEqual(['Volver', 'Cancelar todo lo que falta']);
        expect(b.srv.cuantos('POST', /cancelar/)).toBe(0);
        b.cancelarGrupo = cancelarGrupoReal(b, 141);
        await dobleClic(boton('Cancelar todo lo que falta', dlg()!), 'confirmar');
        await esperar(() => !dlg() && chips(b!.v.contenedor).filter((c) => /Cancelada antes de empezar/.test(c)).length === 2, { ms: 4000, que: 'la pantalla refrescada' });
        await pasar(200);
        expect(b.srv.cuantos('POST', CANCELAR_GRUPO)).toBe(1);
        expect(b.srv.cuantos('POST', CANCELAR)).toBe(0);
        expect(toasts()).toContainEqual({ variante: 'warning', texto: `Remesa 3081: ${POST_C}` });
        // La que cierra sigue en curso y NO dice «Se pidió cancelar» ni «Cancelando…».
        expect(alertas(b.v.contenedor).some((a) => /Se pidió cancelar/.test(a.texto))).toBe(false);
        expect(chips(b.v.contenedor)).toContain('#3081 · Post-proceso');
        expect(btn()!.disabled).toBe(true);
        expect(motivo()).toBe('La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar.');
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('post-proceso con 1 sola en cola: el texto (singular) y el pedido', async () => {
        b = await armarDetalle(P(141, 2, { fase: 'POST_PROCESO' }), { otras: [T(140, 1), Q(142, 3), T(143, 4)] });
        await abrir();
        expect(cuerpo()).toMatch(/^La remesa en curso \(3081\) ya está cerrando y no se cancela: va a terminar\. Se cancelan? la que no empezó \(3082\)\.$/);
        b.cancelarGrupo = cancelarGrupoReal(b, 141);
        await clic(boton('Cancelar todo lo que falta', dlg()!), 'confirmar');
        await esperar(() => !dlg(), { que: 'cerrado' });
        expect(b.srv.de('POST', /cancelar/).map((p) => p.ruta)).toEqual(['/import/grupos/g-7/cancelar']);
    });

    it('post-proceso y todas las demás ya terminadas (0 en cola): botón deshabilitado con el motivo; no abre nada', async () => {
        b = await armarDetalle(P(141, 2, { fase: 'POST_PROCESO' }), { otras: [T(140, 1), T(142, 3), canceladaEnCola(Q(143, 4))] });
        expect(btn()!.disabled).toBe(true);
        expect(motivo()).toBe('La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar.');
        btn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await pasar(200);
        expect(dlg()).toBeNull();
        expect(b.srv.cuantos('POST', /cancelar/)).toBe(0);
    });

    it('acción masiva ya empezada, y pedido ya hecho, con 2 en cola: qué dice el diálogo en cada caso', async () => {
        const visto: Record<string, string> = {};
        b = await armarDetalle(P(141, 2, { tipo: 'ACCIONES' }), { otras: [T(140, 1), Q(142, 3, { tipo: 'ACCIONES' }), Q(143, 4, { tipo: 'ACCIONES' })] });
        expect(limpio(btn()!.textContent ?? '')).toBe('Cancelar todo lo que falta');
        await abrir(); visto['acción masiva'] = cuerpo(); expect(botonesDlg()).toEqual(['Volver', 'Cancelar todo lo que falta']);
        await cerrar();
        b = await armarDetalle(P(141, 2, { cancelacionPedidaAt: iso(Date.now() - 4000), canceladaPor: 'Maxi' }), { otras: [T(140, 1), Q(142, 3), Q(143, 4)] });
        expect(limpio(btn()!.textContent ?? '')).toBe('Cancelar todo lo que falta');
        expect(btn()!.disabled).toBe(false);
        await abrir(); visto['pedido ya hecho'] = cuerpo(); expect(botonesDlg()).toEqual(['Volver', 'Cancelar todo lo que falta']);
        b.cancelarGrupo = cancelarGrupoReal(b, 141, null);
        await clic(boton('Cancelar todo lo que falta', dlg()!), 'confirmar');
        await esperar(() => !dlg(), { que: 'cerrado' });
        await pasar(300);
        expect(b.srv.de('POST', /cancelar/).map((p) => p.ruta)).toEqual(['/import/grupos/g-7/cancelar']);
        await cerrar();
        b = await armarDetalle(P(141, 2, { cancelable: false }), { otras: [T(140, 1), Q(142, 3)] });
        await abrir(); visto['sin causa conocida'] = cuerpo();
        expect(visto['acción masiva']).toBe('La remesa en curso (3081) no se cancela: Una acción masiva que ya empezó no se cancela: esperá a que termine y usá Revertir. Se cancelan las 2 que no empezaron (3082 y 3083).');
        // Con el pedido ya hecho la remesa SÍ se está cancelando: el diálogo dice «ya está pedida» (el test portado de C1
        // afirmaba el texto anterior, «no se cancela: Ya se pidió cancelar», que se corrigió después de la auditoría).
        expect(visto['pedido ya hecho']).toBe('La cancelación de la remesa en curso (3081) ya está pedida. Se cancelan las 2 que no empezaron (3082 y 3083).');
        expect(visto['sin causa conocida']).toMatch(/^La remesa en curso \(3081\) no se cancela: No se puede cancelar en este momento\./);
    });

    it('el backend rechaza TODO (la cola avanzó entre abrir y confirmar): los motivos salen como avisos y la pantalla no afirma que canceló', async () => {
        b = await armarDetalle(P(141, 2, { fase: 'POST_PROCESO' }), { otras: [T(140, 1), Q(142, 3)] });
        await abrir();
        b.cancelarGrupo = () => ({ status: 200, body: { resultados: [
            { remesaId: 142, numeroRemesa: '3082', efecto: 'RECHAZADA', motivo: 'Una acción masiva que ya empezó no se cancela: los datos para deshacerla se guardan recién al terminar. Esperá a que termine y usá Revertir, que la deshace completa.', carga: b!.estados[142] },
            { remesaId: 141, numeroRemesa: '3081', efecto: 'RECHAZADA', motivo: POST_C, carga: b!.estados[141] },
        ] } });
        await clic(boton('Cancelar todo lo que falta', dlg()!), 'confirmar');
        await esperar(() => toasts().length >= 2, { que: 'los avisos' });
        await pasar(200);
        expect(toasts().filter((t) => t.variante === 'warning').length).toBe(2);
        expect(toasts().some((t) => /cancelada/i.test(t.texto) && t.variante !== 'warning')).toBe(false);
    });

    it('el pedido al grupo falla (403 / 500): error con el texto del backend, el diálogo sigue abierto y se puede reintentar', async () => {
        b = await armarDetalle(P(141, 2, { fase: 'POST_PROCESO' }), { otras: [T(140, 1), Q(142, 3)] });
        await abrir();
        b.cancelarGrupo = () => ({ status: 403, body: { statusCode: 403, message: 'No tenés permiso para cancelar esta importación.' } });
        await clic(boton('Cancelar todo lo que falta', dlg()!), 'confirmar');
        await esperar(() => toasts().length > 0, { que: 'el error' });
        await pasar(200);
        expect(toasts()).toContainEqual({ variante: 'error', texto: 'No tenés permiso para cancelar esta importación.' });
        expect(!!dlg()).toBe(true);
        expect(boton('Cancelar todo lo que falta', dlg()!)!.disabled).toBe(false);
    });

    it('la lista de hermanas de la página quedó vieja (decía que había en cola y ya terminaron): el diálogo, con la lectura fresca, no ofrece nada que no exista', async () => {
        b = await armarDetalle(P(141, 2, { fase: 'POST_PROCESO' }), { otras: [T(140, 1), Q(142, 3)] });
        expect(btn()!.disabled).toBe(false);
        b.estados[142] = canceladaEnCola(b.estados[142]); // otro la canceló; esta página no se enteró
        await abrir();
        expect(cuerpo()).not.toMatch(/Se cancelan?/);
        expect(botonesDlg().filter((x) => !/deshabilitado/.test(x))).toEqual(['Volver']);
    });

    it('la división no se pudo leer NUNCA (ni al abrir la página ni al abrir el diálogo): el diálogo avisa que cancela solo esta remesa', async () => {
        // (a) la que cierra: no sabe de las hermanas → deshabilitado.
        b = await armarDetalle(P(141, 2, { fase: 'POST_PROCESO' }), { otras: [T(140, 1), Q(142, 3)], antes: (bb) => { bb.grupo = () => ({ status: 500, body: { message: 'boom' } }); } });
        const aDeshabilitado = btn()!.disabled;
        await cerrar();
        // (b) la que corre y es cancelable: el diálogo tiene que avisar que es una división y que cancela solo esta.
        b = await armarDetalle(P(141, 2), { otras: [T(140, 1), Q(142, 3), Q(143, 4)], antes: (bb) => { bb.grupo = () => ({ status: 500, body: { message: 'boom' } }); } });
        await abrir();
        const avisa = /carga dividida en 4 remesas y no se pudieron leer las demás: esto cancela solo esta remesa; las otras siguen/.test(cuerpo());
        expect({ aDeshabilitado }).toEqual({ aDeshabilitado: true });
        // §6.6 de C2a: una propiedad `grupo` vacía (lo que manda el detalle cuando su lectura falló) ya no cuenta como «leída»,
        // y si la lectura en vivo del diálogo tampoco trae nada, el aviso sale. El test portado de C1 afirmaba que NO salía.
        expect(avisa).toBe(true);
    });

    it('la lectura del diálogo falla pero la página ya tenía las hermanas: ofrece las opciones con lo que tenía', async () => {
        b = await armarDetalle(P(141, 2), { otras: [T(140, 1), Q(142, 3), Q(143, 4)] });
        b.grupo = () => ({ status: 500, body: { message: 'boom' } });
        await abrir();
        expect(botonesDlg()).toEqual(['Volver', 'Cancelar solo esta remesa', 'Cancelar todo lo que falta']);
    });
});

describe('desde el DETALLE de una remesa en cola, con la que corre cerrando', () => {
    let b: BancoDetalle | null = null;
    afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
    const btn = () => boton(/^Cancelar (importación|todo lo que falta)$/, b!.v.contenedor);
    const dlg = () => dialogo(/^Cancelar (importación|todo lo que falta)$/);
    const cuerpo = () => limpio(dlg()?.querySelector('.MuiDialogContent-root')?.textContent ?? '');
    const botonesDlg = () => Array.from(dlg()!.querySelectorAll('button')).map((x) => `${limpio(x.textContent ?? '')}${(x as HTMLButtonElement).disabled ? ' (deshabilitado)' : ''}`);
    const abrir = async () => { await clic(btn(), 'el botón de cancelar'); await esperar(() => !!dlg() && !/Buscando las otras remesas/.test(cuerpo()), { que: 'el diálogo' }); await pasar(80); };

    it('con otra más en cola: dos opciones; «solo esta» pega a la remesa; el texto no promete cortar la que cierra', async () => {
        b = await armarDetalle(Q(142, 3), { otras: [T(140, 1), P(141, 2, { fase: 'POST_PROCESO' }), Q(143, 4)] });
        expect(limpio(btn()!.textContent ?? '')).toBe('Cancelar importación');
        await abrir();
        expect(botonesDlg()).toEqual(['Volver', 'Cancelar solo esta remesa', 'Cancelar todo lo que falta']);
        expect(cuerpo()).not.toMatch(/3081/);
        b.cancelar = (id) => { const c = canceladaEnCola(b!.estados[id]); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'CANCELADA', carga: c } }; };
        await clic(boton('Cancelar solo esta remesa', dlg()!), 'solo esta');
        await esperar(() => chips(b!.v.contenedor).includes('Cancelada'), { que: 'cancelada' });
        expect(b.srv.de('POST', /cancelar/).map((p) => p.ruta)).toEqual(['/import/remesas/142/cancelar']);
    });

    it('es la única en cola: un solo botón, pega a la remesa', async () => {
        b = await armarDetalle(Q(142, 3), { otras: [T(140, 1), P(141, 2, { fase: 'POST_PROCESO' }), T(143, 4)] });
        await abrir();
        expect(botonesDlg()).toEqual(['Volver', 'Cancelar importación']);
        b.cancelar = (id) => { const c = canceladaEnCola(b!.estados[id]); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'CANCELADA', carga: c } }; };
        await clic(boton('Cancelar importación', dlg()!), 'confirmar');
        await esperar(() => chips(b!.v.contenedor).includes('Cancelada'), { que: 'cancelada' });
        expect(b.srv.de('POST', /cancelar/).map((p) => p.ruta)).toEqual(['/import/remesas/142/cancelar']);
    });

    it('la foto de la lista: con el diálogo abierto, la que corría termina y arranca la siguiente → ¿el texto sigue nombrando a la terminada?', async () => {
        b = await armarDetalle(Q(143, 4), { otras: [T(140, 1), P(141, 2), Q(142, 3)] });
        await abrir();
        const antes = cuerpo();
        b.pub('import:finalizada', T(141, 2, { rev: 30 }));
        b.pub('import:iniciada', P(142, 3, { rev: 5, procesadas: 100, ok: 100, err: 0, progreso: 1, startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()) }));
        await pasar(1500);
        const despues = cuerpo();
        const sigueVieja = /la remesa en curso \(3081\)/.test(despues);
        // El pedido va igual al grupo: decide el servidor con el estado real.
        b.cancelarGrupo = () => ({ status: 200, body: { resultados: [] } });
        await clic(boton('Cancelar todo lo que falta', dlg()!), 'todo');
        await esperar(() => b!.srv.cuantos('POST', CANCELAR_GRUPO) === 1, { que: 'el pedido' });
        expect(b.srv.cuantos('POST', CANCELAR)).toBe(0);
    });
});

describe('desde el DETALLE de la remesa que corre y SÍ se puede cortar', () => {
    let b: BancoDetalle | null = null;
    afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
    const dlg = () => dialogo(/^Cancelar (importación|todo lo que falta)$/);
    const cuerpo = () => limpio(dlg()?.querySelector('.MuiDialogContent-root')?.textContent ?? '');

    it('el cartel de «Cancelar todo lo que falta» nombra la remesa en curso y las que no empezaron, y el pedido al grupo corta las dos', async () => {
        b = await armarDetalle(P(141, 2), { otras: [T(140, 1), Q(142, 3), Q(143, 4)] });
        await clic(boton('Cancelar importación', b.v.contenedor), 'Cancelar importación');
        await esperar(() => !!boton('Cancelar todo lo que falta', dlg() ?? undefined) && !/Buscando/.test(cuerpo()), { que: 'las dos opciones' });
        const cartel = alertas(dlg()!).map((a) => a.texto).join(' ');
        b.cancelarGrupo = () => {
            const c141 = { ...b!.estados[141], rev: 6, cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi', cancelable: false }; b!.estados[141] = c141;
            const c142 = canceladaEnCola(b!.estados[142]); b!.estados[142] = c142; const c143 = canceladaEnCola(b!.estados[143]); b!.estados[143] = c143;
            return { status: 200, body: { resultados: [{ remesaId: 143, numeroRemesa: '3083', efecto: 'CANCELADA', carga: c143 }, { remesaId: 142, numeroRemesa: '3082', efecto: 'CANCELADA', carga: c142 }, { remesaId: 141, numeroRemesa: '3081', efecto: 'PEDIDA', carga: c141 }] } };
        };
        await clic(boton('Cancelar todo lo que falta', dlg()!), 'todo');
        await esperar(() => !dlg() && alertas(b!.v.contenedor).some((a) => /Se pidió cancelar/.test(a.texto)), { que: 'el pedido aplicado' });
        await pasar(300);
        // §10.8.4 y §10.16 (fila «Cancelar una división»): si la en curso sí se corta, el cartel la nombra entre lo que se cancela.
        // El test portado de C1 afirmaba el cartel anterior, que no la nombraba; se corrigió después de la auditoría.
        expect(cartel).toBe('Esta remesa es parte de una carga dividida. «Cancelar todo lo que falta» cancela la remesa en curso (3081) y las 2 que no empezaron (3082 y 3083).');
        expect(chips(b.v.contenedor)).toContain('#3081 · Cancelando…');
    });
});

describe('desde el paso «Importando» del asistente', () => {
    let b: BancoC1 | null = null;
    beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
    afterAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
    afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
    const dlg = () => dialogo(/^Cancelar (importación|todo lo que falta)$/);
    const cuerpo = () => limpio(dlg()?.querySelector('.MuiDialogContent-root')?.textContent ?? '');
    const btn = () => boton(/^Cancelar (importación|todo lo que falta)$/, b!.v.contenedor);
    const de = (id: number) => b!.estados[id];
    const lista = () => chips(b!.v.contenedor).filter((c) => /En cola|Finalizada|Cancelada|Procesando|Cancelando|Post-proceso/.test(c));
    const enResultado = () => /Resultado de la importación/.test(b!.texto());
    const fin = () => b!.texto().replace(/^.*Resultado de la importación/, '');
    const post = (id: number) => dtoC1({ ...de(id), fase: 'POST_PROCESO', estadoProceso: 'PROCESANDO', rev: de(id).rev + 3, procesadas: 5000, ok: 5000, err: 0, progreso: 99, startedAt: iso(Date.now() - 3000), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()), enColaDelante: null, cancelable: false });
    const ok = (id: number) => terminalC1('OK', { ...de(id), resultado: 'OK', fase: 'TERMINADA', estadoProceso: 'FINALIZADA', enCurso: false, terminal: true, cancelable: false, retomable: false, rev: de(id).rev + 5, procesadas: 5000, ok: 5000, err: 0, progreso: 100, error: null, finishedAt: iso(Date.now()) });

    async function grupoEnPostProceso() {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        b.pub('import:progreso', post(141));
        await esperar(() => lista().includes('Post-proceso') && limpio(btn()?.textContent ?? '') === 'Cancelar todo lo que falta', { que: 'la primera cerrando, con el botón del grupo' });
        await pasar(100);
    }

    it('la remesa en curso está cerrando y hay 2 en cola: el botón es «Cancelar todo lo que falta», corta SOLO las que no empezaron, y el resultado lo cuenta bien', async () => {
        await grupoEnPostProceso();
        expect(btn()!.disabled).toBe(false);
        await clic(btn(), 'Cancelar todo lo que falta');
        await esperar(() => !!dlg() && !/Buscando/.test(cuerpo()), { que: 'el diálogo' });
        expect(cuerpo()).toBe('La remesa en curso (3081) ya está cerrando y no se cancela: va a terminar. Se cancelan las 2 que no empezaron (3082 y 3083).');
        b!.cancelarGrupo = () => {
            const c142 = canceladaEnCola(de(142)); b!.estados[142] = c142; const c143 = canceladaEnCola(de(143)); b!.estados[143] = c143;
            return { status: 200, body: { resultados: [{ remesaId: 143, numeroRemesa: '3083', efecto: 'CANCELADA', carga: c143 }, { remesaId: 142, numeroRemesa: '3082', efecto: 'CANCELADA', carga: c142 }, { remesaId: 141, numeroRemesa: '3081', efecto: 'RECHAZADA', motivo: POST_C, carga: de(141) }] } };
        };
        await dobleClic(boton('Cancelar todo lo que falta', dlg()!), 'confirmar');
        await esperar(() => !dlg() && lista().filter((c) => c === 'Cancelada antes de empezar').length === 2, { ms: 4000, que: 'la lista refrescada' });
        await pasar(200);
        expect(b!.srv.cuantos('POST', CANCELAR_GRUPO)).toBe(1);
        expect(b!.srv.cuantos('POST', CANCELAR)).toBe(0);
        expect(lista()).toEqual(['Post-proceso', 'Cancelada antes de empezar', 'Cancelada antes de empezar']);
        expect(alertas(b!.v.contenedor).some((a) => /Se pidió cancelar/.test(a.texto))).toBe(false);
        expect(btn()!.disabled).toBe(true);
        expect(enResultado()).toBe(false);
        // La que cerraba termina bien.
        b!.pub('import:finalizada', ok(141));
        await esperar(enResultado, { ms: 3000, que: 'resultado' });
        await pasar(200);
        expect(fin()).toContain('Remesa 3081Importación exitosa5.000 procesadas');
        expect(fin()).toContain('Remesa 3082Importación canceladaSe puede retomar0 procesadas');
        expect(fin()).toContain('La importación quedó incompleta');
        expect(fin()).not.toMatch(/terminó completa|llegó tarde/);
        expect(!!boton('Retomar las 2 que no se cargaron')).toBe(true);
    });

    it('la que cierra termina con el diálogo abierto: el diálogo desaparece y no queda ningún pedido colgado contra la remesa equivocada', async () => {
        await grupoEnPostProceso();
        await clic(btn(), 'Cancelar todo lo que falta');
        await esperar(() => !!dlg() && !/Buscando/.test(cuerpo()), { que: 'el diálogo' });
        b!.pub('import:finalizada', ok(141));
        b!.pub('import:iniciada', dtoC1({ ...de(142), fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', rev: de(142).rev + 1, procesadas: 10, ok: 10, err: 0, progreso: 1, startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()), enColaDelante: null, cancelable: true }));
        await esperar(() => !dlg() && /Carga dividida: remesa 2 de 3/.test(b!.texto()), { ms: 4000, que: 'el diálogo cerrado y la segunda en curso' });
        await pasar(200);
        expect(limpio(btn()!.textContent ?? '')).toBe('Cancelar importación');
        expect(b!.srv.cuantos('POST', /cancelar/)).toBe(0);
    });

    it('después de «Cancelar solo esta remesa» (pedido hecho, todavía no cortó), el botón pasa a «Cancelar todo lo que falta» y deja cortar el resto', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        const proc = (over: Record<string, unknown> = {}) => dtoC1({ ...de(141), fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', rev: de(141).rev + 1, procesadas: 3000, ok: 3000, err: 0, progreso: 60, startedAt: iso(Date.now() - 3000), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()), enColaDelante: null, cancelable: true, ...over });
        b.pub('import:progreso', proc());
        await esperar(() => chips(b!.v.contenedor).includes('Procesadas: 3.000'), { que: 'procesando' });
        b.cancelar = (id) => { const c = proc({ rev: de(id).rev + 1, cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi', cancelable: false }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'PEDIDA', carga: c } }; };
        await clic(btn(), 'Cancelar importación');
        await esperar(() => !!boton('Cancelar solo esta remesa', dlg() ?? undefined), { que: 'las dos opciones' });
        await clic(boton('Cancelar solo esta remesa', dlg()!), 'solo esta');
        await esperar(() => !dlg() && limpio(btn()?.textContent ?? '') === 'Cancelar todo lo que falta', { ms: 4000, que: 'el botón del grupo' });
        await pasar(150);
        expect(btn()!.disabled).toBe(false);
        expect(lista()).toEqual(['Cancelando…', 'En cola', 'En cola']);
        await clic(btn(), 'Cancelar todo lo que falta');
        await esperar(() => !!dlg() && !/Buscando/.test(cuerpo()), { que: 'el diálogo' });
        expect(b.srv.de('POST', /cancelar/).map((p) => p.ruta)).toEqual(['/import/remesas/141/cancelar']);
    });
});
