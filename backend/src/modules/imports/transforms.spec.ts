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

describe('transforms — mapear', () => {
    // La tabla real de AYSA: la Categoría viene como un dígito suelto y el gestor no sabe qué es.
    const CATEGORIA_AYSA =
        'mapear:1=1 - Residencial|2=2 - Residencial|3=3 - No residencial|4=4 - No residencial|5=5 - Baldío';

    it('traduce cada código de la tabla', () => {
        expect(t('1', CATEGORIA_AYSA)).toBe('1 - Residencial');
        expect(t('3', CATEGORIA_AYSA)).toBe('3 - No residencial');
        expect(t('5', CATEGORIA_AYSA)).toBe('5 - Baldío');
    });

    it('deja pasar el código que no está en la tabla en vez de borrarlo', () => {
        expect(t('6', CATEGORIA_AYSA)).toBe('6');
    });

    it('un valor vacío en la tabla sí borra (los rellenos "sin dato" del cedente)', () => {
        expect(t('000', 'mapear:000=|00000=')).toBe('');
        expect(t('00001', 'mapear:000=|00000=')).toBe('00001');
    });

    it('ignora espacios alrededor de la clave y no distingue mayúsculas', () => {
        expect(t(' z1 ', 'mapear:Z1=Titular|Z4=Consorcio')).toBe('Titular');
    });

    it('el valor puede tener "=" adentro: solo cuenta el primero', () => {
        expect(t('X', 'mapear:X=a=b')).toBe('a=b');
    });

    it('acepta números, no solo texto', () => {
        expect(t(5, 'mapear:5=5 - Baldío')).toBe('5 - Baldío');
    });

    it('null/undefined pasan sin tocar', () => {
        expect(t(null, CATEGORIA_AYSA)).toBeNull();
        expect(t(undefined, CATEGORIA_AYSA)).toBeUndefined();
    });

    it('se combina con los otros transforms en el orden declarado', () => {
        expect(t('  1  ', 'trim', CATEGORIA_AYSA)).toBe('1 - Residencial');
    });
});

describe('transforms — toDecimal', () => {
    // El `Coef. zonal` de AYSA: 11 valores en la bajada del 03/08, todos con 2 decimales, pero la
    // del 22/06 traía además `1.8` y `3.5` sueltos — el mismo coeficiente escrito de dos formas.
    it('formatea el decimal con coma', () => {
        expect(t('1.30', 'toDecimal:es-AR')).toBe('1,30');
        expect(t('2.75', 'toDecimal:es-AR')).toBe('2,75');
    });

    it('completa el segundo decimal que el cedente manda a medias', () => {
        expect(t('1.8', 'toDecimal:es-AR')).toBe('1,80');
        expect(t('3.5', 'toDecimal:es-AR')).toBe('3,50');
        expect(t('2', 'toDecimal:es-AR')).toBe('2,00');
    });

    it('acepta el valor con espacios del ancho fijo, combinado con trim', () => {
        expect(t('        1.30', 'trim', 'toDecimal:es-AR')).toBe('1,30');
    });

    it('lee también el decimal que ya viene con coma', () => {
        expect(t('1,80', 'toDecimal:es-AR')).toBe('1,80');
    });

    it('respeta la cantidad de decimales pedida', () => {
        expect(t('1.3', 'toDecimal:es-AR:3')).toBe('1,300');
        expect(t('1.30', 'toDecimal:es-AR:0')).toBe('1');
    });

    it('devuelve texto, no número: es para los datos adicionales', () => {
        expect(typeof t('1.30', 'toDecimal:es-AR')).toBe('string');
    });

    it('lo que no es un número pasa igual, sin borrarse', () => {
        expect(t('NO INFORMADO', 'toDecimal:es-AR')).toBe('NO INFORMADO');
    });

    it('null/undefined/vacío pasan sin tocar', () => {
        expect(t(null, 'toDecimal:es-AR')).toBeNull();
        expect(t(undefined, 'toDecimal:es-AR')).toBeUndefined();
        expect(t('', 'toDecimal:es-AR')).toBe('');
    });

    it('no lo pisa el transform de número ni el de fecha', () => {
        expect(t('1.30', 'toNumber:es-AR')).toBe(1.3);
        expect(t('1.30', 'toDecimal:es-AR')).toBe('1,30');
    });
});
