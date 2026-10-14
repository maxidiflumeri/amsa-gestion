// C1 portado (19-c1-bordes): remesas eliminadas del grupo y grupo que desaparece. Esperan el polling real del grupo (10 a 40 s).
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

describe('el grupo cambia por fuera', () => {
    it('una remesa en cola se elimina mientras se carga: la línea «N remesas de esta división se eliminaron» en Importando y en Resultado', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        delete b.estados[143];                                   // alguien la eliminó desde el Historial
        b.pub('import:finalizada', ok(141));                     // un evento del grupo no la trae de vuelta…
        b.pub('import:finalizada', ok(142));
        await pasar(600);
        // …pero la pantalla todavía la tiene en la lista (nadie avisa de un borrado): se entera con la próxima consulta.
        const lista1 = chips(b.v.contenedor).filter((c) => /En cola|Finalizada/.test(c));
        const t0 = Date.now();
        await esperar(enResultado, { ms: 45_000, cada: 250, que: 'el resultado (cuando el grupo se vuelve a consultar)' });
        await pasar(200);
        expect(fin()).toContain('1 remesa de esta división se eliminó.');
        expect(fin()).toContain('Importación exitosa');
        expect(fin()).not.toMatch(BASURA);
    });

    it('el grupo entero desaparece (se eliminaron todas las que estaban en cola): alerta de «no se pudo seguir»', async () => {
        b = await armarBancoC1({ aceptarSockets: false });
        await hastaLaVistaPreviaDividida(b);
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        for (const id of [141, 142, 143]) delete b.estados[id];
        const t0 = Date.now();
        await esperar(() => alertas(b!.v.contenedor).some((a) => /No se pudo seguir la importación/.test(a.texto)), { ms: 40_000, cada: 250, que: 'la alerta' });
        expect(enResultado()).toBe(false);
    });
});
