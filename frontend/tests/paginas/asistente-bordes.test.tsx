// C1 — bordes del asistente: ir y volver, remesas eliminadas del grupo, grupo que desaparece.
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASURA, dtoC1, iso, terminalC1 } from '../lib/fabricas';
import { alertas, boton, chips, clic, esperar, escribir, limpio, pasar, toasts } from '../lib/montar';
import { instalarAdaptador, usarGuion } from '../lib/wizard';
import { armarBancoC1, filasDeCortes, hastaLaVistaPreviaDividida, hastaLosCortes, type BancoC1 } from '../lib/banco-asistente';

let b: BancoC1 | null = null;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
afterAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
const enResultado = () => /Resultado de la importación/.test(b!.texto());
const fin = () => b!.texto().replace(/^.*Resultado de la importación/, '');
const de = (id: number) => b!.estados[id];
const ok = (id: number) => terminalC1('OK', { ...de(id), resultado: 'OK', fase: 'TERMINADA', estadoProceso: 'FINALIZADA', enCurso: false, terminal: true, cancelable: false, rev: de(id).rev + 5, procesadas: 5000, ok: 5000, err: 0, progreso: 100, startedAt: iso(Date.now() - 5000), finishedAt: iso(Date.now()) });

describe('ir y volver', () => {
    it('«Atrás» desde la vista previa y volver a crear: se confirman SOLO las remesas nuevas, con lo que el operador dejó la segunda vez', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);            // crea 141, 142, 143
        await clic(boton('Atrás'), 'Atrás');
        await esperar(() => !!boton('Ver los cortes del archivo'), { que: 'el paso 2' });
        await clic(boton('Ver los cortes del archivo'), 'Ver los cortes');
        await esperar(() => !!boton(/^Crear 3 remesa/), { que: 'el diálogo' });
        await pasar(80);
        await clic(filasDeCortes()[2].check, 'destildar la 3083');
        await escribir(filasDeCortes()[0].numero, '9001');
        await clic(boton(/^Crear 2 remesa/), 'Crear 2');          // crea 144, 145
        await esperar(() => !!boton('Confirmar e importar') && /9001/.test(b!.texto()), { que: 'la vista previa nueva' });
        await pasar(150);
        const tabla = Array.from(b.v.contenedor.querySelectorAll('table')).find((t) => /Corte/.test(t.textContent ?? ''))!;
        const filas = Array.from(tabla.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.children).map((c) => limpio(c.textContent ?? '')).slice(0, 2).join('/'));
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => b!.srv.cuantos('POST', /ejecutar-grupo/) === 1, { que: 'el pedido' });
        const cuerpo = JSON.parse(b.srv.de('POST', /ejecutar-grupo/)[0].cuerpo.toString('utf8'));
        expect(cuerpo).toEqual({ remesaIds: [144, 145] });
        expect(filas).toEqual(['9001/3081', '3082/3082']);
        expect(b.srv.cuantos('POST', /ejecutar\/\d+/)).toBe(0);
    });
});
