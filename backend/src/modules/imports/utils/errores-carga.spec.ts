import {
    BASE_DE_FILA,
    celdaCsv,
    lineaCsv,
    nombreArchivoCsv,
    numeroDeFila,
    tipoDeError,
    whereAvisos,
    whereFilas,
} from './errores-carga';

describe('errores-carga', () => {
    it('EC-1: los tres prefijos son AVISO en rowNumber 0', () => {
        for (const m of ['[aviso] x', '[parseo] x', '[post-proceso] x']) expect(tipoDeError(0, m)).toBe('AVISO');
    });
    it('EC-2: la fila real de la remesa 35 (rowNumber 0, mensaje con corchete) es FILA', () => {
        expect(
            tipoDeError(0, '[AGNEJ0_EJ_9000001028_IEQ006_20260725.txt:1] Deudor no encontrado para pago (…)'),
        ).toBe('FILA');
    });
    it('EC-3: un aviso siempre está en 0', () => expect(tipoDeError(7, '[aviso] x')).toBe('FILA'));
    it('EC-4: sin distinguir mayúsculas, como la base', () => expect(tipoDeError(0, '[AVISO] x')).toBe('AVISO'));
    it('EC-5: numeroDeFila cuenta desde 1', () => {
        expect(BASE_DE_FILA).toBe(1);
        expect(numeroDeFila(0, 'FILA')).toBe(1);
        expect(numeroDeFila(251142, 'FILA')).toBe(251143);
        expect(numeroDeFila(0, 'AVISO')).toBeNull();
    });
    it('EC-6: whereAvisos es el objeto que arma el runner (imports.service.ts, conteo de avisos al cerrar); whereFilas lo niega', () => {
        // Copiado literal del runner (processImportJob): si cambia allá, cambia acá.
        const delRunner = {
            remesaId: 5,
            rowNumber: 0,
            OR: [
                { errorMsg: { startsWith: '[aviso]' } },
                { errorMsg: { startsWith: '[parseo]' } },
                { errorMsg: { startsWith: '[post-proceso]' } },
            ],
        };
        expect(whereAvisos(5)).toEqual(delRunner);
        expect(whereFilas(5)).toEqual({ remesaId: 5, NOT: { rowNumber: 0, OR: delRunner.OR } });
    });
    it('EC-7: celdaCsv', () => {
        expect(celdaCsv('hola')).toBe('hola');
        expect(celdaCsv('a;b')).toBe('"a;b"');
        expect(celdaCsv('di "x"')).toBe('"di ""x"""');
        expect(celdaCsv('a\nb')).toBe('"a\nb"');
        expect(celdaCsv(null)).toBe('');
        expect(celdaCsv(undefined)).toBe('');
        expect(celdaCsv({ a: 1 })).toBe('"{""a"":1}"'); // su JSON, entre comillas por las comillas internas
        expect(celdaCsv(12.5)).toBe('12.5');
    });
    it('EC-8: fórmulas con apóstrofo, importes negativos no', () => {
        expect(celdaCsv('=1+1')).toBe("'=1+1");
        expect(celdaCsv('+cmd')).toBe("'+cmd");
        expect(celdaCsv('@SUM(A1)')).toBe("'@SUM(A1)");
        expect(celdaCsv('-2+3')).toBe("'-2+3");
        expect(celdaCsv('\tx')).toBe("'\tx");
        expect(celdaCsv('-1500,50')).toBe('-1500,50');
        expect(celdaCsv('-3')).toBe('-3');
        expect(celdaCsv('+54911')).toBe('+54911');
        expect(celdaCsv(-3)).toBe('-3');
    });
    it('EC-9: lineaCsv y nombreArchivoCsv', () => {
        expect(lineaCsv(['a', 'b;c', null])).toBe('a;"b;c";\r\n');
        expect(nombreArchivoCsv('00151/A b')).toBe('errores-remesa-00151-A-b.csv');
        expect(nombreArchivoCsv('00151')).toBe('errores-remesa-00151.csv');
    });
});
