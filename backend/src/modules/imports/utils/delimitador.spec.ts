import { resolveDelimiter } from './delimitador';

describe('resolveDelimiter', () => {
    it('convierte el "\\t" literal (2 chars) de la UI en un tab real', () => {
        expect(resolveDelimiter('\\t')).toBe('\t');
    });

    it('acepta nombres del tabulador', () => {
        expect(resolveDelimiter('tab')).toBe('\t');
        expect(resolveDelimiter('TAB')).toBe('\t');
    });

    it('deja intactos los separadores normales', () => {
        expect(resolveDelimiter(',')).toBe(',');
        expect(resolveDelimiter(';')).toBe(';');
        expect(resolveDelimiter('|')).toBe('|');
        expect(resolveDelimiter('\t')).toBe('\t'); // tab real ya correcto
    });

    it('usa coma como fallback para vacío/nulo', () => {
        expect(resolveDelimiter('')).toBe(',');
        expect(resolveDelimiter(null)).toBe(',');
        expect(resolveDelimiter(undefined)).toBe(',');
    });
});
