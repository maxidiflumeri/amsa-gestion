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

describe('transforms — toDate:auto con fechas separadas por puntos', () => {
    /** Fecha local a medianoche, que es lo que devuelve el transform. */
    const fecha = (a: number, m: number, d: number) => new Date(a, m - 1, d);

    it('lee DD.MM.YYYY como día.mes.año (el formato de SAP)', () => {
        // Antes esto devolvía el 5 de octubre: dayjs caía al fallback flexible y lo leía MM.DD.
        expect(t('10.05.2024', 'toDate:auto')).toEqual(fecha(2024, 5, 10));
        expect(t('08.02.2024', 'toDate:auto')).toEqual(fecha(2024, 2, 8));
    });

    it('lee los días mayores a 12, que antes quedaban en null', () => {
        expect(t('21.06.2026', 'toDate:auto')).toEqual(fecha(2026, 6, 21));
        expect(t('31.12.2025', 'toDate:auto')).toEqual(fecha(2025, 12, 31));
        expect(t('28.06.2026', 'toDate:auto')).toEqual(fecha(2026, 6, 28));
    });

    it('acepta el día y el mes sin cero a la izquierda', () => {
        expect(t('1.5.2024', 'toDate:auto')).toEqual(fecha(2024, 5, 1));
    });

    it('el "sin fecha" del cedente sigue dando null, no una fecha inventada', () => {
        expect(t('00.00.0000', 'toDate:auto')).toBeNull();
    });

    it('descarta una fecha que no existe en vez de correrla al mes siguiente', () => {
        expect(t('31.02.2026', 'toDate:auto')).toBeNull();
    });

    it('no cambia los formatos que ya funcionaban', () => {
        expect(t('2024-05-10', 'toDate:auto')).toEqual(fecha(2024, 5, 10));
        expect(t('10/05/2024', 'toDate:auto')).toEqual(fecha(2024, 5, 10));
        expect(t('10-05-2024', 'toDate:auto')).toEqual(fecha(2024, 5, 10));
    });

    it('ignora la hora pegada atrás', () => {
        expect(t('21.06.2026 00:00:00', 'toDate:auto')).toEqual(fecha(2026, 6, 21));
    });
});
