import { parseFechaCedente } from './fecha-cedente';

/** Fecha local a medianoche, para comparar sin arrastrar zona horaria. */
const fecha = (a: number, m: number, d: number) => new Date(a, m - 1, d);

describe('parseFechaCedente', () => {
    it('parsea los cuatro formatos que conviven en el paquete de Toyota TCFA', () => {
        // Sin cero a la izquierda ni en día ni en mes: el regex de ancho fijo que usaba el
        // processor de la cuenta 87 fallaba en todos éstos y caía a la fecha del día.
        expect(parseFechaCedente('29/5/2026 00:00:00')).toEqual(fecha(2026, 5, 29));
        expect(parseFechaCedente('1/12/2025 00:00:00')).toEqual(fecha(2025, 12, 1));
        expect(parseFechaCedente('7/8/2025 00:00:00')).toEqual(fecha(2025, 8, 7));
        expect(parseFechaCedente('21/11/2024 00:00:00')).toEqual(fecha(2024, 11, 21));
    });

    it('acepta la fecha sin la hora, y con hora sin segundos', () => {
        expect(parseFechaCedente('13/5/2020')).toEqual(fecha(2020, 5, 13));
        expect(parseFechaCedente('13/5/2020 14:30')).toEqual(fecha(2020, 5, 13));
    });

    it('sigue parseando el formato con cero a la izquierda de la cuenta 87', () => {
        expect(parseFechaCedente('24/07/2026')).toEqual(fecha(2026, 7, 24));
    });

    it('ignora el padding de espacios de los archivos de ancho fijo', () => {
        expect(parseFechaCedente('  29/5/2026 00:00:00   ')).toEqual(fecha(2026, 5, 29));
    });

    it('devuelve null en vez de inventar una fecha', () => {
        expect(parseFechaCedente('')).toBeNull();
        expect(parseFechaCedente(null)).toBeNull();
        expect(parseFechaCedente(undefined)).toBeNull();
        expect(parseFechaCedente('N/D')).toBeNull();
        expect(parseFechaCedente('2026-05-29')).toBeNull();   // ISO: no es el formato del cedente
    });

    it('rechaza días que no existen en vez de correrlos al mes siguiente', () => {
        // `new Date(2026, 1, 31)` daría 3 de marzo sin chistar.
        expect(parseFechaCedente('31/2/2026')).toBeNull();
        expect(parseFechaCedente('32/1/2026')).toBeNull();
        expect(parseFechaCedente('1/13/2026')).toBeNull();
    });
});
