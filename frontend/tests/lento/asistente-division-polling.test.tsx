// TW-4 (C2b, portado de 18-c1-mentiras): el polling real de «Importando» en una división con el socket caído. Espera 31 s reales de la aplicación.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boton, clic, esperar, pasar } from '../lib/montar';
import { instalarAdaptador, usarGuion } from '../lib/wizard';
import { armarBancoC1, hastaLaVistaPreviaDividida, type BancoC1 } from '../lib/banco-asistente';

let b: BancoC1 | null = null;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
afterAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

describe('«Importando» de una división con el socket caído', () => {
    it('TW-4 — un solo `GET grupos/:id` por tic y ningún `GET remesas/:id/progreso` (antes eran dos por tic)', async () => {
        b = await armarBancoC1({ aceptarSockets: false });
        await hastaLaVistaPreviaDividida(b);
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        await pasar(800);
        const g0 = b.srv.cuantos('GET', /grupos/); const p0 = b.srv.cuantos('GET', /progreso/);
        await pasar(31_000);
        expect(b.srv.cuantos('GET', /grupos/) - g0).toBe(3);
        expect(b.srv.cuantos('GET', /progreso/) - p0).toBe(0);
    });
});
