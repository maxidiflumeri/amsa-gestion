// C1 — vista de cortes (§10.8.1): un corte CARGADA / EN_CURSO / A_MEDIAS nunca viaja tildado ni con `repetir: true`
// sin la confirmación explícita. ImportWizard real, backend falso.
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASURA } from '../lib/fabricas';
import { enElSpec10 } from '../lib/spec';
import { alertas, boton, clic, dialogo, dobleClic, escribir, esperar, limpio, pasar, toasts } from '../lib/montar';
import { instalarAdaptador, usarGuion } from '../lib/wizard';
import { CORTES_3, armarBancoC1, filasDeCortes, hastaLosCortes, type BancoC1 } from '../lib/banco-asistente';

let b: BancoC1 | null = null;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
afterAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const ya = (situacion: string, n: string, extra: Record<string, unknown> = {}) => ({ remesaId: 900 + Number(n.slice(-1)), numeroRemesa: n, situacion, casos: 4321, retomable: false, ...extra });
const ALTAS = /^\/import\/remesas$/;
const PREVIEWS = /division-preview/;
const dlgCortes = () => dialogo(/El archivo trae varias asignaciones/);
const dlgConfirm = () => dialogo(/Cargar de nuevo cortes ya cargados/);
describe('el 409 del alta (otra pestaña cargó un corte mientras tanto) y la re-consulta', () => {
    const MSG = 'Este archivo ya tiene cortes cargados: 3082 en la remesa 2902 (ya cargado). Destildalos, o confirmá que querés cargarlos de nuevo: sus casos van a quedar duplicados.';
    enElSpec10('Este archivo ya tiene cortes cargados: {corte} en la remesa {número} ({situación}); … Destildalos, o confirmá que querés cargarlos de nuevo: sus casos van a quedar duplicados.');

    it('FW-2 — sin `code` y con la frase (un backend anterior): se vuelve a pedir la vista de cortes; el corte recién cargado queda destildado', async () => {
        b = await armarBancoC1();
        let cargado = false;
        b.cortes = () => { const c = CORTES_3() as any[]; if (cargado) c[1].yaCargado = ya('CARGADA', '2902'); return c; };
        b.crear = () => { cargado = true; return { status: 409, body: { statusCode: 409, message: MSG } }; };
        await hastaLosCortes(b);
        await clic(boton(/^Crear 3 remesa/), 'Crear 3');
        await esperar(() => b!.srv.cuantos('POST', PREVIEWS) === 2 && !!dlgCortes() && filasDeCortes().length === 3, { que: 'la re-consulta' });
        await pasar(150);
        const filas = filasDeCortes();
        expect(filas.map((f) => f.tildado)).toEqual([true, false, true]);
        expect(toasts().some((t) => t.variante === 'error' && t.texto === MSG)).toBe(true);
        expect(toasts()).toContainEqual({ variante: 'warning', texto: 'Los cortes que se cargaron mientras tanto quedaron destildados.' });
        expect(b.srv.cuantos('POST', ALTAS)).toBe(1);
        expect(b.srv.cuantos('POST', /validar|ejecutar/)).toBe(0);
    });

    it('ARREGLADO (hallazgo 2 de la pasada 1): la re-consulta conserva lo que el operador editó — el corte destildado sigue destildado y el número corregido se mantiene', async () => {
        b = await armarBancoC1();
        let cargado = false;
        b.cortes = () => { const c = CORTES_3() as any[]; if (cargado) c[1].yaCargado = ya('CARGADA', '2902'); return c; };
        const crearNormal = b.crear;
        b.crear = (d, p) => { if (!cargado) { cargado = true; return { status: 409, body: { statusCode: 409, message: MSG } }; } return crearNormal(d, p); };
        await hastaLosCortes(b);
        await clic(filasDeCortes()[2].check, 'destildar 3083');
        await escribir(filasDeCortes()[0].numero, '9001');
        await pasar(50);
        await clic(boton(/^Crear 2 remesa/), 'Crear 2');
        await esperar(() => b!.srv.cuantos('POST', PREVIEWS) === 2 && !!dlgCortes() && filasDeCortes().length === 3, { que: 'la re-consulta' });
        await pasar(150);
        const despues = filasDeCortes().map((f) => [f.tildado, f.valor]);
        expect(despues).toEqual([[true, '9001'], [false, '3082'], [false, '3083']]);
        expect(limpio(boton(/^Crear \d+ remesa/)!.textContent ?? '')).toBe('Crear 1 remesa(s)');
        expect(filasDeCortes()[1].texto).toContain('Ya está cargado en la remesa 2902');
        await clic(boton(/^Crear 1 remesa/), 'Crear de nuevo');
        await esperar(() => b!.srv.cuantos('POST', ALTAS) === 2, { que: 'el segundo alta' });
        await pasar(200);
        expect(dlgConfirm()).toBeNull();
        expect(b.altas[1].map((d: any) => [d.valores['Nómina'], d.numeroRemesa, d.repetir])).toEqual([['3081', '9001', undefined]]);
    });

    it('un corte que el operador había confirmado para repetir sigue tildado tras la re-consulta, pero NO viaja con `repetir` sin volver a confirmarlo', async () => {
        b = await armarBancoC1();
        let vuelta = 0;
        b.cortes = () => { const c = CORTES_3() as any[]; c[0].yaCargado = ya('CARGADA', '2901'); if (vuelta > 0) c[1].yaCargado = ya('CARGADA', '2902'); return c; };
        const crearNormal = b.crear;
        b.crear = (d, p) => { if (vuelta++ === 0) return { status: 409, body: { statusCode: 409, message: MSG } }; return crearNormal(d, p); };
        await hastaLosCortes(b);
        await clic(filasDeCortes()[0].check, 'tildar el cargado');
        await clic(boton(/^Crear 3 remesa/), 'Crear 3');
        await esperar(() => !!dlgConfirm(), { que: 'confirmación' });
        await clic(boton('Cargarlos de nuevo', dlgConfirm()!), 'aceptar');
        await esperar(() => b!.srv.cuantos('POST', PREVIEWS) === 2 && !!dlgCortes() && filasDeCortes().length === 3 && !dlgConfirm(), { que: 'la re-consulta' });
        await pasar(150);
        expect(b.altas[0].map((d: any) => d.repetir)).toEqual([true, undefined, undefined]);
        expect(filasDeCortes().map((f) => f.tildado)).toEqual([true, false, true]);
        // Volver a crear: la confirmación se pide OTRA VEZ. Rechazarla no manda nada.
        await clic(boton(/^Crear 2 remesa/), 'Crear 2');
        await esperar(() => !!dlgConfirm(), { que: 'confirmación de nuevo' });
        expect(b.srv.cuantos('POST', ALTAS)).toBe(1);
        await clic(boton('Cancelar', dlgConfirm()!), 'rechazar');
        await pasar(300);
        expect(b.srv.cuantos('POST', ALTAS)).toBe(1);
        await clic(boton(/^Crear 2 remesa/), 'Crear 2');
        await esperar(() => !!dlgConfirm(), { que: 'confirmación (3)' });
        await clic(boton('Cargarlos de nuevo', dlgConfirm()!), 'aceptar');
        await esperar(() => b!.srv.cuantos('POST', ALTAS) === 2, { que: 'el segundo alta' });
        expect(b.altas[1].map((d: any) => [d.valores['Nómina'], d.repetir])).toEqual([['3081', true], ['3083', undefined]]);
    });

    it('dos 409 seguidos, con ediciones entre uno y otro: se conserva todo y cada corte recién cargado queda destildado', async () => {
        b = await armarBancoC1();
        let vuelta = 0;
        const cuatro = () => [...CORTES_3(), { valores: { 'Nómina': '3084' }, filas: 1000, numeroSugerido: '3084', filtros: [{ fromIndex: 3, operador: '=', valor: '3084' }] }] as any[];
        b.cortes = () => { const c = cuatro(); if (vuelta >= 1) c[1].yaCargado = ya('CARGADA', '2902'); if (vuelta >= 2) c[2].yaCargado = ya('EN_CURSO', '2903'); return c; };
        const crearNormal = b.crear;
        b.crear = (d, p) => { if (vuelta < 2) { vuelta++; return { status: 409, body: { statusCode: 409, message: MSG } }; } return crearNormal(d, p); };
        await hastaLosCortes(b);
        await escribir(filasDeCortes()[0].numero, '9001');
        await clic(boton(/^Crear 4 remesa/), 'Crear 4');
        await esperar(() => b!.srv.cuantos('POST', PREVIEWS) === 2 && !!dlgCortes() && filasDeCortes().length === 4, { que: 'la primera re-consulta' });
        await pasar(150);
        expect(filasDeCortes().map((f) => [f.tildado, f.valor])).toEqual([[true, '9001'], [false, '3082'], [true, '3083'], [true, '3084']]);
        // Entre un 409 y el otro, el operador cambia otro número y destilda la 3084.
        await escribir(filasDeCortes()[2].numero, '9003');
        await clic(filasDeCortes()[3].check, 'destildar 3084');
        await clic(boton(/^Crear 2 remesa/), 'Crear 2');
        await esperar(() => b!.srv.cuantos('POST', PREVIEWS) === 3 && !!dlgCortes() && filasDeCortes().length === 4 && !filasDeCortes()[2].tildado, { que: 'la segunda re-consulta' });
        await pasar(150);
        const estado = filasDeCortes().map((f) => [f.tildado, f.valor]);
        expect(estado).toEqual([[true, '9001'], [false, '3082'], [false, '9003'], [false, '3084']]);
        await clic(boton(/^Crear 1 remesa/), 'Crear 1');
        await esperar(() => b!.srv.cuantos('POST', ALTAS) === 3, { que: 'el tercer alta' });
        expect(dlgConfirm()).toBeNull();
        expect(b.altas[2].map((d: any) => [d.valores['Nómina'], d.numeroRemesa, d.repetir])).toEqual([['3081', '9001', undefined]]);
    });

    it('un corte que estaba cargado y deja de estarlo (eliminaron su remesa mientras tanto) queda como el operador lo tenía; uno «sin cargar» que pasa a «en curso» (lo retomaron) se destilda', async () => {
        b = await armarBancoC1();
        let vuelta = 0;
        b.cortes = () => {
            const c = CORTES_3() as any[];
            if (vuelta === 0) { c[0].yaCargado = ya('CARGADA', '2901'); c[2].yaCargado = ya('SIN_CARGAR', '2903', { retomable: true, casos: 0 }); }
            else { c[1].yaCargado = ya('CARGADA', '2902'); c[2].yaCargado = ya('EN_CURSO', '2903', { casos: 0 }); }
            return c;
        };
        b.crear = () => { vuelta++; return { status: 409, body: { statusCode: 409, message: MSG } }; };
        await hastaLosCortes(b);
        expect(filasDeCortes().map((f) => f.tildado)).toEqual([false, true, true]);
        await clic(boton(/^Crear 2 remesa/), 'Crear 2');
        await esperar(() => b!.srv.cuantos('POST', PREVIEWS) === 2 && !!dlgCortes() && filasDeCortes().length === 3, { que: 'la re-consulta' });
        await pasar(150);
        // 3081: ya no figura cargado, sigue destildado (como estaba: hay que tildarlo a mano). 3082: recién cargado. 3083: la retomaron.
        expect(filasDeCortes().map((f) => f.tildado)).toEqual([false, false, false]);
        expect(boton(/^Crear 0 remesa/)!.disabled).toBe(true);
    });

    it('FW-1 — un 409 con `code: CORTE_YA_CARGADO` y un mensaje SIN la frase «cortes cargados» vuelve a pedir la vista de cortes', async () => {
        b = await armarBancoC1();
        let cargado = false;
        b.cortes = () => { const c = CORTES_3(); if (cargado) (c[1] as Record<string, unknown>).yaCargado = ya('CARGADA', '2902'); return c; };
        b.crear = () => { cargado = true; return { status: 409, body: { statusCode: 409, error: 'Conflict', message: 'El corte 3082 ya figura en la remesa 2902.', code: 'CORTE_YA_CARGADO', cortes: [] } }; };
        await hastaLosCortes(b);
        await clic(boton(/^Crear 3 remesa/), 'Crear 3');
        await esperar(() => b!.srv.cuantos('POST', PREVIEWS) === 2 && !!dlgCortes() && filasDeCortes().length === 3, { que: 'la re-consulta' });
        await pasar(150);
        expect(filasDeCortes().map((f) => f.tildado)).toEqual([true, false, true]);
        expect(b.srv.cuantos('POST', ALTAS)).toBe(1);
    });

    it('FW-3 — un 409 con otro `code` no la pide', async () => {
        b = await armarBancoC1();
        b.crear = () => ({ status: 409, body: { statusCode: 409, message: 'Alguna otra cosa.', code: 'NINGUNA_RETOMABLE' } });
        await hastaLosCortes(b);
        await clic(boton(/^Crear 3 remesa/), 'Crear 3');
        await esperar(() => toasts().length > 0, { que: 'el toast' });
        await pasar(600);
        expect(b.srv.cuantos('POST', PREVIEWS)).toBe(1);
    });

    it('un 409 que no es el de cortes (número repetido): NO re-consulta y muestra el error', async () => {
        b = await armarBancoC1();
        b.crear = () => ({ status: 409, body: { statusCode: 409, message: 'Ya existe una remesa con el número 3081 en esta empresa.' } });
        await hastaLosCortes(b);
        await clic(boton(/^Crear 3 remesa/), 'Crear 3');
        await esperar(() => toasts().length > 0, { que: 'el toast' });
        await pasar(600);
        expect(b.srv.cuantos('POST', PREVIEWS)).toBe(1);
    });

    it('si el backend redacta el 409 de cortes con OTRA frase (sin «cortes cargados»), no hay re-consulta: la vista queda con los datos viejos', async () => {
        b = await armarBancoC1();
        b.crear = () => ({ status: 409, body: { statusCode: 409, message: 'El corte 3082 ya está cargado en la remesa 2902. Destildalo, o confirmá que querés cargarlo de nuevo.' } });
        await hastaLosCortes(b);
        await clic(boton(/^Crear 3 remesa/), 'Crear 3');
        await esperar(() => toasts().length > 0, { que: 'el toast' });
        await pasar(600);
        expect(b.srv.cuantos('POST', PREVIEWS)).toBe(1);
    });
});
