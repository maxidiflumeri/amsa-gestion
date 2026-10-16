// utils/linkCaso.ts: el enlace a un caso de Gestión y la lectura segura del id de la URL.
import { describe, expect, it } from 'vitest';
import { leerDeudorDeUrl, linkCaso } from '@fe/utils/linkCaso';

describe('linkCaso', () => {
    it('arma /gestion?deudor=ID', () => {
        expect(linkCaso(5)).toBe('/gestion?deudor=5');
    });
});

describe('leerDeudorDeUrl', () => {
    it('lee un entero positivo, con o sin el signo ?', () => {
        expect(leerDeudorDeUrl('?deudor=12')).toBe(12);
        expect(leerDeudorDeUrl('deudor=12')).toBe(12);
        expect(leerDeudorDeUrl('?otro=1&deudor=7')).toBe(7);
    });

    it('cualquier otra cosa da null: no número, cero, negativo, decimal, vacío o sin el parámetro', () => {
        for (const s of ['?deudor=abc', '?deudor=0', '?deudor=-3', '?deudor=1.5', '?deudor=', '', '?otro=4', '?deudor=12abc', '?deudor=1e3']) {
            expect(leerDeudorDeUrl(s), s).toBeNull();
        }
    });

    it('un número que no cabe como entero seguro da null', () => {
        expect(leerDeudorDeUrl('?deudor=99999999999999999999')).toBeNull();
    });
});
