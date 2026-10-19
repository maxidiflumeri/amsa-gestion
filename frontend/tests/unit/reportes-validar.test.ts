// pages/reportes/utils/validatePlantilla.ts: lo que frena el editor antes de guardar una plantilla.
import { describe, expect, it } from 'vitest';
import { validatePlantilla } from '@fe/pages/reportes/utils/validatePlantilla';

const plantilla = (columnas: any[]): any => ({
    nombre: 'Base',
    definicion: { columnas, filtros: [], agrupaciones: [], totales: [], ordenamientos: [] },
});

describe('validatePlantilla: columnas con el mismo nombre', () => {
    it('es un error (no un aviso): dos columnas con el mismo nombre se pisan en el resultado', () => {
        const errores = validatePlantilla(
            plantilla([
                { id: '1', path: 'nombre', label: 'Dato' },
                { id: '2', path: 'apellido', label: 'Dato' },
            ]),
        );
        expect(errores).toEqual([{ type: 'error', message: 'Hay dos columnas con el nombre «Dato»' }]);
    });

    it('con nombres distintos no hay nada que reportar', () => {
        const errores = validatePlantilla(
            plantilla([
                { id: '1', path: 'nombre', label: 'Nombre' },
                { id: '2', path: 'apellido', label: 'Apellido' },
            ]),
        );
        expect(errores).toEqual([]);
    });
});

import { nombreColumnaFijaLibre } from '@fe/pages/reportes/utils/nombreColumnaFija';

describe('nombreColumnaFijaLibre', () => {
    it('arranca en columna1 y toma el primer nombre libre', () => {
        expect(nombreColumnaFijaLibre([])).toBe('columna1');
        expect(nombreColumnaFijaLibre(['columna1', 'columna2'])).toBe('columna3');
    });

    it('si se borró una del medio no repite el último: columna1 y columna3 → columna2', () => {
        expect(nombreColumnaFijaLibre(['columna1', 'columna3'])).toBe('columna2');
    });
});

describe('validatePlantilla: filtros Entre / Fuera de', () => {
    const conFiltro = (filtro: any): any => ({
        nombre: 'Base',
        definicion: { columnas: [{ id: '1', path: 'saldo', label: 'Saldo' }], filtros: [filtro] },
    });
    const base = { id: 'f', path: 'saldo', operador: 'between', variable: false };

    it('las dos puntas vacías son "sin valor"', () => {
        for (const valor of [[null, null], ['', ''], [undefined, null]]) {
            const errores = validatePlantilla(conFiltro({ ...base, valor }));
            expect(errores.some((e) => e.type === 'error' && e.message.includes('falta el valor'))).toBe(true);
        }
    });

    it('una sola punta es un rango abierto, vale', () => {
        expect(validatePlantilla(conFiltro({ ...base, valor: [5, null] }))).toEqual([]);
        expect(validatePlantilla(conFiltro({ ...base, valor: ['', 9] }))).toEqual([]);
    });
});
