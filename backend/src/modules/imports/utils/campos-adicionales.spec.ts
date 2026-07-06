import { mergeAdicionales } from './campos-adicionales';

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
