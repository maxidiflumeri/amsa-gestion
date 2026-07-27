import { adicionalesEquivalentes, mergeAdicionales } from './campos-adicionales';

describe('utils/campos-adicionales — mergeAdicionales', () => {
    it('gana el valor nuevo ante clave repetida', () => {
        expect(mergeAdicionales({ a: '1', b: '2' }, { b: '9' })).toEqual({ a: '1', b: '9' });
    });

    it('conserva las claves que solo tiene la base', () => {
        expect(mergeAdicionales({ a: '1' }, { c: '3' })).toEqual({ a: '1', c: '3' });
    });

    it('agrega claves nuevas', () => {
        expect(mergeAdicionales({}, { x: 'y' })).toEqual({ x: 'y' });
    });

    it('trata null/undefined como objeto vacío en ambos lados', () => {
        expect(mergeAdicionales(null, { a: '1' })).toEqual({ a: '1' });
        expect(mergeAdicionales({ a: '1' }, null)).toEqual({ a: '1' });
        expect(mergeAdicionales(null, null)).toEqual({});
    });

    it('trata valores no-objeto (string/array) como vacío', () => {
        expect(mergeAdicionales('foo', { a: '1' })).toEqual({ a: '1' });
        expect(mergeAdicionales(['x'], { a: '1' })).toEqual({ a: '1' });
        expect(mergeAdicionales({ a: '1' }, ['x'])).toEqual({ a: '1' });
    });

    it('no muta los objetos de entrada', () => {
        const base = { a: '1' };
        const nuevos = { b: '2' };
        mergeAdicionales(base, nuevos);
        expect(base).toEqual({ a: '1' });
        expect(nuevos).toEqual({ b: '2' });
    });
});

describe('utils/campos-adicionales — adicionalesEquivalentes', () => {
    it('detecta que un merge sin cambios equivale al original (caso archivo diario)', () => {
        // El escenario que hacía gastar un UPDATE por fila todos los días: el archivo repite
        // exactamente los mismos valores que ya están guardados.
        const actual = { DNI: '20-12345678-9', SUCURSAL: 'CENTRO' };
        expect(adicionalesEquivalentes(actual, mergeAdicionales(actual, { DNI: '20-12345678-9' }))).toBe(true);
    });

    it('detecta que un merge con un valor distinto NO equivale', () => {
        const actual = { DNI: '20-12345678-9' };
        expect(adicionalesEquivalentes(actual, mergeAdicionales(actual, { DNI: '27-99999999-1' }))).toBe(false);
    });

    it('detecta que agregar una clave nueva NO equivale', () => {
        const actual = { DNI: '1' };
        expect(adicionalesEquivalentes(actual, mergeAdicionales(actual, { EMAIL: 'x@y.z' }))).toBe(false);
    });

    it('ignora el orden de las claves', () => {
        expect(adicionalesEquivalentes({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    });

    it('compara en profundidad objetos y arrays anidados', () => {
        expect(adicionalesEquivalentes({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toBe(true);
        expect(adicionalesEquivalentes({ a: { b: [1, 2] } }, { a: { b: [2, 1] } })).toBe(false);
        expect(adicionalesEquivalentes({ a: { b: [1] } }, { a: { b: [1, 2] } })).toBe(false);
    });

    it('trata null/undefined/no-objeto como vacío, igual que mergeAdicionales', () => {
        expect(adicionalesEquivalentes(null, {})).toBe(true);
        expect(adicionalesEquivalentes(undefined, null)).toBe(true);
        expect(adicionalesEquivalentes('foo', {})).toBe(true);
        expect(adicionalesEquivalentes(null, { a: '1' })).toBe(false);
    });

    it('distingue tipos que se verían iguales al comparar como texto', () => {
        expect(adicionalesEquivalentes({ a: 1 }, { a: '1' })).toBe(false);
        expect(adicionalesEquivalentes({ a: null }, { a: undefined })).toBe(false);
    });
});
