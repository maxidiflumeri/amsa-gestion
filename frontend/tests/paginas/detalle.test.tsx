// C2a: lo que cambia en el detalle de una importación (FD-2 y FD-3). FD-1 (lo portado de C1) está en detalle-b y detalle-retomar.
import { afterEach, describe, expect, it } from 'vitest';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';
import { terminalC1 } from '../lib/fabricas';
import { boton, limpio } from '../lib/montar';

let b: BancoDetalle | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
const renglon = (etiqueta: string) => Array.from(document.querySelectorAll('.MuiTypography-root')).find((e) => limpio(e.textContent ?? '') === etiqueta)?.parentElement;

describe('FD-2 — «Corte» y «Remesas de origen» en la información general', () => {
    it('cuando el backend los manda se muestran; una remesa de origen eliminada se dice', async () => {
        b = await armarDetalle(terminalC1('OK', { remesaId: 141 }), {
            remesa: { corte: 'Nómina 3082 / Gestión 3GH', origen: [{ remesaId: 90, numeroRemesa: '00140', nombre: 'Telecom septiembre' }, { remesaId: 91, numeroRemesa: null, nombre: null }] },
        });
        expect(limpio(renglon('Corte')?.textContent ?? '')).toBe('CorteNómina 3082 / Gestión 3GH');
        expect(limpio(renglon('Remesas de origen')?.textContent ?? '')).toBe('Remesas de origen00140 · Telecom septiembreuna remesa eliminada');
    });

    it('cuando no los manda (backend anterior, o la remesa no tiene) no aparecen', async () => {
        b = await armarDetalle(terminalC1('OK', { remesaId: 141 }));
        expect(b.texto()).not.toContain('Remesas de origen');
        expect(renglon('Corte')).toBeUndefined();
        await b.v.desmontar(); await b.srv.bajar();
        b = await armarDetalle(terminalC1('OK', { remesaId: 141 }), { remesa: { corte: null, origen: [] } });
        expect(renglon('Corte')).toBeUndefined();
        expect(b.texto()).not.toContain('Remesas de origen');
    });
});

describe('FD-3 — retomable por la fila pero con el corte en otra remesa', () => {
    it('con `corteRepetidoEn` no hay botón Retomar y está la línea que lo explica', async () => {
        b = await armarDetalle(terminalC1('FALLIDA', { remesaId: 141, error: 'x', procesadas: 0, ok: 0, err: 0, retomable: false, corteRepetidoEn: ['00160'], startedAt: null }));
        expect(boton('Retomar', b.v.contenedor)).toBeNull();
        expect(b.texto()).toContain('El corte de esta remesa ya figura en la remesa 00160: no se puede retomar. Si esta ya no hace falta, eliminala.');
    });

    it('sin `corteRepetidoEn` y retomable: el botón está y la línea no', async () => {
        b = await armarDetalle(terminalC1('FALLIDA', { remesaId: 141, error: 'x', procesadas: 0, ok: 0, err: 0, retomable: true, startedAt: null }));
        expect(boton('Retomar', b.v.contenedor)).not.toBeNull();
        expect(b.texto()).not.toContain('no se puede retomar');
    });
});
