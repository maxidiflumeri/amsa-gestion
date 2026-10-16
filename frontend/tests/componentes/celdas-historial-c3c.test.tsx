// C3c: la columna «Filas» del Historial no dice «piso» de una carga cortada por un reinicio (los números son exactos).
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CeldaFilas } from '@fe/components/import/historial/CeldasHistorial';
import { itemHistorial } from '../lib/fabricas';
import { montar, type Montado } from '../lib/montar';

let v: Montado | null = null;
afterEach(async () => {
    if (v) await v.desmontar();
    v = null;
});

const PISO = 'En una carga fallida son un piso.';
const base = { terminal: true, enCurso: false, resultado: 'FALLIDA', estadoProceso: 'FALLIDA', procesadas: 3000, ok: 2990, err: 10 };
const rotulo = () => document.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';

describe('CeldaFilas', () => {
    it('una fallida común: aclara que los números son un piso', async () => {
        v = await montar(<CeldaFilas item={itemHistorial({}, { ...base, cancelada: false })} />);
        expect(rotulo()).toContain(PISO);
    });

    it('interrumpida por un reinicio: sin la aclaración del piso', async () => {
        v = await montar(<CeldaFilas item={itemHistorial({}, { ...base, cancelada: false, interrumpidaPorReinicio: true })} />);
        expect(rotulo()).toContain('Filas: total / OK / con error');
        expect(rotulo()).not.toContain(PISO);
    });

    it('cancelada: sin la aclaración (como hoy)', async () => {
        v = await montar(<CeldaFilas item={itemHistorial({}, { ...base, cancelada: true })} />);
        expect(rotulo()).not.toContain(PISO);
    });
});
