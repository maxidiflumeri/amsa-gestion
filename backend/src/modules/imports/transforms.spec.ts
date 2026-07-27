import { applyTransforms } from './transforms';

const t = (raw: any, ...tr: string[]) => applyTransforms(raw, tr);

describe('transforms — removeDoubleQuotes', () => {
    it('quita la comilla doble recta', () => {
        expect(t('"12345"', 'removeDoubleQuotes')).toBe('12345');
    });

    it('quita las comillas tipográficas de Word/Excel', () => {
        expect(t('“ACME S.A.”', 'removeDoubleQuotes')).toBe('ACME S.A.');
    });

    it('quita todas las apariciones, no solo las de los extremos', () => {
        expect(t('AB"CD"EF', 'removeDoubleQuotes')).toBe('ABCDEF');
    });

    it('deja intacto un valor sin comillas dobles', () => {
        expect(t("O'BRIEN", 'removeDoubleQuotes')).toBe("O'BRIEN");
    });

    it('no toca la comilla simple (esa es removeQuotes)', () => {
        expect(t(`'123`, 'removeDoubleQuotes')).toBe(`'123`);
    });

    it('null/undefined → null', () => {
        expect(t(null, 'removeDoubleQuotes')).toBeNull();
        expect(t(undefined, 'removeDoubleQuotes')).toBeNull();
    });
});

describe('transforms — removeDashes', () => {
    it('quita el signo negativo de un importe', () => {
        expect(t('-1234.56', 'removeDashes')).toBe('1234.56');
    });

    it('quita el signo negativo en formato es-AR', () => {
        expect(t('-1.234,56', 'removeDashes')).toBe('1.234,56');
    });

    it('contempla las variantes unicode que mete Excel (menos real, en/em dash)', () => {
        expect(t('−500', 'removeDashes')).toBe('500');   // U+2212 signo menos
        expect(t('–500', 'removeDashes')).toBe('500');   // en dash
        expect(t('—500', 'removeDashes')).toBe('500');   // em dash
        expect(t('‐500', 'removeDashes')).toBe('500');   // hyphen U+2010
    });

    it('quita TODOS los guiones, no solo el del principio', () => {
        expect(t('20-12345678-9', 'removeDashes')).toBe('20123456789');
    });

    it('deja intacto un valor sin guiones', () => {
        expect(t('1234.56', 'removeDashes')).toBe('1234.56');
    });

    it('null/undefined → null', () => {
        expect(t(null, 'removeDashes')).toBeNull();
        expect(t(undefined, 'removeDashes')).toBeNull();
    });
});

describe('transforms — pago negativo: el ORDEN importa', () => {
    it('sin quitar el guión, el importe queda negativo', () => {
        expect(t('-1.234,56', 'toNumber:es-AR')).toBe(-1234.56);
    });

    it('quitar guiones ANTES de convertir a número da el valor absoluto', () => {
        expect(t('-1.234,56', 'removeDashes', 'toNumber:es-AR')).toBe(1234.56);
    });

    it('al revés no sirve: toNumber ya devolvió el número negativo', () => {
        // Documenta el comportamiento para que la plantilla se arme en el orden correcto:
        // removeDashes sobre un number lo vuelve string y pierde el signo, pero deja de ser número.
        expect(t('-1.234,56', 'toNumber:es-AR', 'removeDashes')).toBe('1234.56');
    });

    it('combina con las otras limpiezas típicas de un CSV entrecomillado', () => {
        expect(t('"-1.234,56"', 'removeDoubleQuotes', 'removeDashes', 'toNumber:es-AR')).toBe(1234.56);
    });
});
