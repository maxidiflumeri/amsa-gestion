import { importeEnLetras } from './importe-en-letras';

describe('importeEnLetras', () => {
    it.each([
        [0, 'cero con 00 centavos'],
        [100, 'uno con 00 centavos'], // 1 peso
        [1500, 'quince con 00 centavos'], // 15 pesos
        [2100, 'veintiuno con 00 centavos'], // 21 pesos
        [3000, 'treinta con 00 centavos'], // 30 pesos
        [10000, 'cien con 00 centavos'], // 100 pesos
        [10100, 'ciento uno con 00 centavos'], // 101 pesos
        [11500, 'ciento quince con 00 centavos'], // 115 pesos
        [50000, 'quinientos con 00 centavos'], // 500 pesos
        [99900, 'novecientos noventa y nueve con 00 centavos'], // 999 pesos
        [100000, 'mil con 00 centavos'], // 1.000 pesos
        [100100, 'mil uno con 00 centavos'], // 1.001 pesos
        [2100000, 'veintiún mil con 00 centavos'], // 21.000 pesos
        [10000000, 'cien mil con 00 centavos'], // 100.000 pesos
        [100000000, 'un millón con 00 centavos'], // 1.000.000 pesos
        [200000000, 'dos millones con 00 centavos'], // 2.000.000 pesos
    ])('%i centavos → "%s"', (centavos, esperado) => {
        expect(importeEnLetras(centavos)).toBe(esperado);
    });

    it('43.782,69 (caso del spec) da el texto exacto del ejemplo', () => {
        expect(importeEnLetras(4378269)).toBe(
            'cuarenta y tres mil setecientos ochenta y dos con 69 centavos',
        );
    });

    it('2.706.359,21 (máximo del archivo real) da el texto exacto del ejemplo', () => {
        expect(importeEnLetras(270635921)).toBe(
            'dos millones setecientos seis mil trescientos cincuenta y nueve con 21 centavos',
        );
    });

    it('centavos con 05 y con 00 siempre van con 2 dígitos', () => {
        expect(importeEnLetras(100005)).toBe('mil con 05 centavos');
        expect(importeEnLetras(100000)).toBe('mil con 00 centavos');
    });

    it('21.000.000 usa el plural "veintiún millones" (apócope antes de millones)', () => {
        expect(importeEnLetras(2100000000)).toBe('veintiún millones con 00 centavos');
    });

    it('30 mil no confunde "treinta y uno" con la forma corta: 31.000 → "treinta y un mil"', () => {
        expect(importeEnLetras(3100000)).toBe('treinta y un mil con 00 centavos');
    });

    it('rechaza negativos y no enteros: son un error de programación, no de negocio', () => {
        expect(() => importeEnLetras(-1)).toThrow();
        expect(() => importeEnLetras(1.5)).toThrow();
    });
});
