import {
    centavosDeTexto,
    descomponerClave,
    descomponerCodigoBarras,
    dvModulo10_31,
    formatoImporteCupon,
    normalizarReferenciaClave,
} from './clave-pago';

/** Corta el último carácter (el DV) de una cadena de ejemplo real. */
const sinDv = (s: string) => s.slice(0, -1);
const dv = (s: string) => Number(s.slice(-1));

describe('dvModulo10_31', () => {
    it('valida la CLAVE_PAGO de ejemplo del archivo (convenio 96311343)', () => {
        const clave = '0096311343000039760032';
        expect(dvModulo10_31(sinDv(clave))).toBe(dv(clave));
        expect(dvModulo10_31(sinDv(clave))).toBe(2);
    });

    it('valida el SEC_COD_BARRA de ejemplo del archivo (convenio 96311343)', () => {
        const cb = '49800039760032710202600000000000096311343000000009';
        expect(dvModulo10_31(sinDv(cb))).toBe(dv(cb));
        expect(dvModulo10_31(sinDv(cb))).toBe(9);
    });

    it('valida el código de barras del cupón PDF viejo (convenio 94674769)', () => {
        const cb = '49800043782691508202600000000000094674769000000004';
        expect(dvModulo10_31(sinDv(cb))).toBe(4);
        const dec = descomponerCodigoBarras(cb)!;
        expect(dec.convenio).toBe('94674769');
        expect(dec.centavos).toBe(4378269);
        expect(dec.vto).toBe('2026-08-15');
    });

    it('valida la clave de la grilla del sistema viejo (convenio 94672801)', () => {
        const clave = '0094672801000054877985';
        expect(dvModulo10_31(sinDv(clave))).toBe(5);
        const dec = descomponerClave(clave)!;
        expect(dec.convenio).toBe('94672801');
        expect(dec.centavos).toBe(5487798);
    });

    it('un dígito cambiado en la clave da un DV distinto al original', () => {
        // Convenio 96311343 → 96311344 (un dígito del medio cambiado).
        const alterada = '0096311344000039760032';
        expect(dvModulo10_31(sinDv(alterada))).not.toBe(dv(alterada));
    });

    it('un dígito cambiado en el código de barras da un DV distinto al original', () => {
        const alterado = '49800039760042710202600000000000096311343000000009';
        expect(dvModulo10_31(sinDv(alterado))).not.toBe(dv(alterado));
    });
});

describe('centavosDeTexto', () => {
    it.each([
        ['19880.01', 1988001],
        ['94972.8', 9497280],
        ['62709', 6270900],
        ['2706359.21', 270635921],
        ['0', 0],
        ['0.5', 50],
    ])('%s → %i centavos', (texto, esperado) => {
        expect(centavosDeTexto(texto)).toBe(esperado);
    });

    it.each([
        ['1.234,56'],
        ['12,5'],
        ['1.234'], // 3 decimales — ambiguo con separador de miles, se rechaza
        [''],
        ['-5'],
        ['abc'],
    ])('%s → null', (texto) => {
        expect(centavosDeTexto(texto)).toBeNull();
    });
});

describe('descomponerClave', () => {
    it('decodifica convenio, centavos y dv de una clave válida', () => {
        expect(descomponerClave('0096332206000019880014')).toEqual({
            convenio: '96332206',
            centavos: 1988001,
            dv: 4,
        });
    });

    it('null si no son 22 dígitos', () => {
        expect(descomponerClave('009633220600001988001')).toBeNull(); // 21
        expect(descomponerClave('00963322060000198800144')).toBeNull(); // 23
    });

    it('null si no empieza con 00', () => {
        expect(descomponerClave('1096332206000019880014')).toBeNull();
    });

    it('null si trae caracteres no numéricos', () => {
        expect(descomponerClave('00963322060000198800X4')).toBeNull();
    });
});

describe('descomponerCodigoBarras', () => {
    const CB_VALIDO = '49800019880012710202600000000000096332206000000007';

    it('decodifica centavos, vencimiento y convenio', () => {
        expect(descomponerCodigoBarras(CB_VALIDO)).toEqual({
            centavos: 1988001,
            vto: '2026-10-27',
            convenio: '96332206',
            dv: 7,
        });
    });

    it('null si no son 50 dígitos', () => {
        expect(descomponerCodigoBarras(CB_VALIDO.slice(0, 49))).toBeNull();
    });

    it('null si no empieza con 498', () => {
        const otro = '4' + '99' + CB_VALIDO.slice(3);
        expect(descomponerCodigoBarras(otro)).toBeNull();
    });

    it('null si el bloque de 12 ceros está alterado', () => {
        // Posiciones [21,33) deberían ser todas '0'; se altera una a '1'.
        const alterado = CB_VALIDO.slice(0, 25) + '1' + CB_VALIDO.slice(26);
        expect(descomponerCodigoBarras(alterado)).toBeNull();
    });

    it('null si el bloque de 8 ceros está alterado', () => {
        const alterado = CB_VALIDO.slice(0, 45) + '1' + CB_VALIDO.slice(46);
        expect(descomponerCodigoBarras(alterado)).toBeNull();
    });
});

describe('formatoImporteCupon', () => {
    it.each([
        [4378269, '43782.69'],
        [1988001, '19880.01'],
        [6270900, '62709.00'],
        [0, '0.00'],
        [5, '0.05'],
    ])('%i centavos → %s', (centavos, esperado) => {
        expect(formatoImporteCupon(centavos)).toBe(esperado);
    });
});

describe('normalizarReferenciaClave', () => {
    it('8 dígitos → tal cual', () => {
        expect(normalizarReferenciaClave('96332206')).toBe('96332206');
    });

    it('22 dígitos (CLAVE_PAGO) → el convenio embebido', () => {
        expect(normalizarReferenciaClave('0096332206000019880014')).toBe('96332206');
    });

    it('50 dígitos (SEC_COD_BARRA) → el convenio embebido', () => {
        expect(
            normalizarReferenciaClave('49800019880012710202600000000000096332206000000007'),
        ).toBe('96332206');
    });

    it('con espacios alrededor, igual normaliza', () => {
        expect(normalizarReferenciaClave('  96332206  ')).toBe('96332206');
    });

    it('basura → null', () => {
        expect(normalizarReferenciaClave('abc123')).toBeNull();
        expect(normalizarReferenciaClave('123')).toBeNull();
        expect(normalizarReferenciaClave('')).toBeNull();
    });
});
