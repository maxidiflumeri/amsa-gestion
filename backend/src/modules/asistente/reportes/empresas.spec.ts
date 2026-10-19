import { empresaExacta, notaDeEmpresaExacta, otrasConElMismoPrefijo } from './empresas';

const E = ['TOYOTA', 'TOYOTA PLAN DE AHORRO', 'TOYOTA 0800', 'FIAT', 'FIAT PLAN', 'TELECOM'].map((nombre) => ({ nombre }));

describe('empresas con nombre exacto', () => {
    it('exacta sin distinguir mayúsculas ni acentos', () => {
        expect(empresaExacta('Toyota', E)).toBe('TOYOTA');
        expect(empresaExacta(' fíat ', E)).toBe('FIAT');
        expect(empresaExacta('Toyo', E)).toBeNull();
    });
    it('las otras con el mismo prefijo', () => {
        expect(otrasConElMismoPrefijo('TOYOTA', E)).toEqual(['TOYOTA PLAN DE AHORRO', 'TOYOTA 0800']);
        expect(otrasConElMismoPrefijo('TELECOM', E)).toEqual([]);
    });
    it('la nota del resultado de valores_de_campo', () => {
        expect(notaDeEmpresaExacta('TOYOTA', E)).toBe('Coincide exacto: «TOYOTA». Usala; nombrá las otras 2 en el mensaje: TOYOTA PLAN DE AHORRO, TOYOTA 0800.');
        expect(notaDeEmpresaExacta('telecom', E)).toBe('Coincide exacto: «TELECOM». Usala.');
        expect(notaDeEmpresaExacta('plan', E)).toContain('varias parecidas');
        expect(notaDeEmpresaExacta('zzz', E)).toBeNull();
    });
});
