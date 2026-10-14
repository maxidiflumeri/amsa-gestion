// C3a: "Qué hizo la carga" en el Resultado del asistente y en el detalle (docs/imports-progreso-c3-spec.md §6.1, §9.2).
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ImportSummary from '@fe/components/import/ImportSummary';
import ResumenDeCarga from '@fe/components/import/ResumenDeCarga';
import type { ResumenCategoria } from '@fe/types/importProgreso';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';
import { BASURA, dtoC1, terminalC1 } from '../lib/fabricas';
import { montar, limpio, type Montado } from '../lib/montar';

const DEUDORES: ResumenCategoria = { tipo: 'DEUDORES', casosNuevos: 97, contactosCopiados: 0 };
const CAIDAS = '3 filas cayeron sobre un caso que esta misma carga ya había creado';
const bloques = () => Array.from(document.querySelectorAll('[data-testid="resumen-de-carga"]'));

let v: Montado | null = null;
let b: BancoDetalle | null = null;
afterEach(async () => {
    if (v) await v.desmontar();
    v = null;
    if (b) { await b.v.desmontar(); await b.srv.bajar(); }
    b = null;
});

describe('Resultado del asistente', () => {
    it('una remesa con resumen: el bloque "Qué hizo la carga" debajo de las métricas, con el aviso en tono de aviso', async () => {
        const r = terminalC1('OK', { tipo: 'DEUDORES', ok: 100, procesadas: 100, err: 0, resumenCategoria: DEUDORES });
        v = await montar(<ImportSummary resultados={[r]} onNewImport={() => {}} />);
        expect(bloques()).toHaveLength(1);
        const t = limpio(bloques()[0].textContent ?? '');
        expect(t).toContain('Qué hizo la carga');
        expect(t).toContain('97 casos nuevos');
        expect(t).toContain(CAIDAS);
        const avisos = Array.from(bloques()[0].querySelectorAll('[data-tono="aviso"]'));
        expect(avisos.map((a) => a.textContent)).toEqual([expect.stringContaining(CAIDAS)]);
        expect(BASURA.test(v.texto())).toBe(false);
    });

    it('una remesa con resumen y otra sin (un backend anterior): solo la primera lleva el bloque, y se rotula por remesa', async () => {
        const con = terminalC1('OK', { remesaId: 1, numeroRemesa: '00001', ok: 100, procesadas: 100, err: 0, resumenCategoria: DEUDORES, grupoId: 'g', grupoOrden: 1, grupoTotal: 2 });
        const sin = terminalC1('OK', { remesaId: 2, numeroRemesa: '00002', ok: 100, procesadas: 100, err: 0, grupoId: 'g', grupoOrden: 2, grupoTotal: 2 });
        v = await montar(<ImportSummary resultados={[con, sin]} dividida onNewImport={() => {}} />);
        expect(bloques()).toHaveLength(1);
        expect(limpio(bloques()[0].textContent ?? '')).toContain('Qué hizo la carga · Remesa 00001');
        expect(BASURA.test(v.texto())).toBe(false);
    });

    it('sin `resumenCategoria` (backend anterior) o con un tipo que no se conoce: no se monta nada', async () => {
        const viejo = terminalC1('OK', { ok: 100, procesadas: 100, err: 0 });
        v = await montar(<ImportSummary resultados={[viejo]} onNewImport={() => {}} />);
        expect(bloques()).toHaveLength(0);
        expect(v.texto()).not.toContain('Qué hizo la carga');
        await v.rerender(<ImportSummary resultados={[terminalC1('OK', { ok: 1, procesadas: 1, err: 0, resumenCategoria: { tipo: 'DEL_FUTURO' } })]} onNewImport={() => {}} />);
        expect(bloques()).toHaveLength(0);
    });

    it('el componente no se monta mientras la carga corre, aunque traiga resumen', async () => {
        v = await montar(<ResumenDeCarga carga={dtoC1({ resumenCategoria: DEUDORES })} />);
        expect(bloques()).toHaveLength(0);
    });
});

describe('Detalle de la carga', () => {
    it('terminal con resumen: el bloque va debajo del resultado', async () => {
        b = await armarDetalle(terminalC1('OK', { tipo: 'DEUDORES', ok: 100, procesadas: 100, err: 0, resumenCategoria: DEUDORES }));
        expect(bloques()).toHaveLength(1);
        expect(limpio(bloques()[0].textContent ?? '')).toContain('97 casos nuevos');
        expect(limpio(bloques()[0].textContent ?? '')).toContain(CAIDAS);
        expect(BASURA.test(b.texto())).toBe(false);
    });

    it('terminal anterior a C3a (sin resumen): sin bloque', async () => {
        b = await armarDetalle(terminalC1('OK', { tipo: 'DEUDORES', ok: 100, procesadas: 100, err: 0 }));
        expect(bloques()).toHaveLength(0);
    });

    it('en curso (resumen null): sin bloque', async () => {
        b = await armarDetalle(dtoC1({ tipo: 'DEUDORES', resumenCategoria: null }));
        expect(bloques()).toHaveLength(0);
        expect(b.texto()).not.toContain('Qué hizo la carga');
    });

    it('ACTUALIZACIONES que no coincidió con nada: el aviso de "No se dio por pagado a ningún ausente"', async () => {
        const resumenCategoria: ResumenCategoria = {
            tipo: 'ACTUALIZACIONES', coincidencias: 0, casosNuevos: 0, reasignados: 0, contactosCopiados: 0,
            ausentes: { accion: 'PAGO_TODO', resultado: 'ABORTADO_SIN_COINCIDENCIAS', pagosGenerados: 0, desasignados: 0, salteadosSinMonto: 0 },
        };
        b = await armarDetalle(terminalC1('OK', { tipo: 'ACTUALIZACIONES', ok: 10, procesadas: 10, err: 0, resumenCategoria }));
        expect(bloques()).toHaveLength(1);
        const aviso = bloques()[0].querySelector('[data-tono="aviso"]');
        expect(aviso?.textContent).toContain('No se dio por pagado a ningún ausente');
    });
});
