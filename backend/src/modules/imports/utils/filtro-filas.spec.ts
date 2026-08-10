import { describirFiltros, pasaFiltro } from './filtro-filas';
import { FiltroFila } from '../mapping-types';

/** Fila de novedad de AYSA recortada: [cta, cod.situ, importe, imp.cobrado]. */
const fila = (cta: string, situ: string, importe: string, cobrado: string) => [cta, situ, importe, cobrado];

describe('pasaFiltro — sin filtros', () => {
    it('deja pasar todo, que es el comportamiento de siempre', () => {
        expect(pasaFiltro(['a', 'b'], undefined)).toBe(true);
        expect(pasaFiltro(['a', 'b'], [])).toBe(true);
    });
});

describe('pasaFiltro — operadores', () => {
    const con = (operador: FiltroFila['operador'], valor?: string): FiltroFila[] =>
        [{ fromIndex: 1, operador, valor }];

    it('IGUAL y DISTINTO comparan sin distinguir mayúsculas', () => {
        expect(pasaFiltro(['x', 'E'], con('IGUAL', 'e'))).toBe(true);
        expect(pasaFiltro(['x', 'E'], con('IGUAL', 'A'))).toBe(false);
        expect(pasaFiltro(['x', 'E'], con('DISTINTO', 'A'))).toBe(true);
        expect(pasaFiltro(['x', 'E'], con('DISTINTO', 'e'))).toBe(false);
    });

    it('CONTIENE busca la subcadena', () => {
        expect(pasaFiltro(['x', 'Pago de Cuota'], con('CONTIENE', 'pago'))).toBe(true);
        expect(pasaFiltro(['x', 'Envio a Gestion'], con('CONTIENE', 'pago'))).toBe(false);
    });

    it('VACIO y NO_VACIO miran el valor ya trimeado', () => {
        expect(pasaFiltro(['x', '   '], con('VACIO'))).toBe(true);
        expect(pasaFiltro(['x', 'E'], con('VACIO'))).toBe(false);
        expect(pasaFiltro(['x', 'E'], con('NO_VACIO'))).toBe(true);
        expect(pasaFiltro(['x', ''], con('NO_VACIO'))).toBe(false);
    });

    it('MAYOR y MENOR comparan como número', () => {
        expect(pasaFiltro(['x', '315.22'], con('MAYOR', '0'))).toBe(true);
        expect(pasaFiltro(['x', '0.00'], con('MAYOR', '0'))).toBe(false);
        expect(pasaFiltro(['x', '-5'], con('MENOR', '0'))).toBe(true);
    });

    it('MAYOR tolera el relleno de los importes de ancho fijo', () => {
        expect(pasaFiltro(['x', '       62.85'], con('MAYOR', '0'))).toBe(true);
    });

    it('MAYOR entiende la coma decimal que mandan algunos cedentes', () => {
        expect(pasaFiltro(['x', '1.234,56'], con('MAYOR', '1000'))).toBe(true);
    });

    it('un valor que no es número no pasa la comparación numérica, en vez de colarse', () => {
        expect(pasaFiltro(['x', 'N/D'], con('MAYOR', '0'))).toBe(false);
        expect(pasaFiltro(['x', ''], con('MAYOR', '0'))).toBe(false);
    });

    it('una columna que la fila no trae se trata como vacía', () => {
        expect(pasaFiltro(['x'], con('VACIO'))).toBe(true);
        expect(pasaFiltro(['x'], con('NO_VACIO'))).toBe(false);
    });

    it('un operador desconocido se ignora en vez de descartar media cartera', () => {
        // Una plantilla guardada por una versión más nueva no debe vaciar el import en silencio.
        expect(pasaFiltro(['x', 'E'], [{ fromIndex: 1, operador: 'RARO' as any, valor: 'z' }])).toBe(true);
    });
});

describe('pasaFiltro — varias condiciones', () => {
    it('se combinan con Y: la fila entra solo si las cumple todas', () => {
        const filtros: FiltroFila[] = [
            { fromIndex: 3, operador: 'MAYOR', valor: '0' },
            { fromIndex: 1, operador: 'DISTINTO', valor: 'J' },
        ];
        expect(pasaFiltro(fila('001', 'A', '315.22', '315.22'), filtros)).toBe(true);
        expect(pasaFiltro(fila('001', 'J', '26.79', '315.22'), filtros)).toBe(false);
        expect(pasaFiltro(fila('001', 'A', '315.22', '0.00'), filtros)).toBe(false);
    });
});

describe('pasaFiltro — el caso de las novedades de AYSA', () => {
    // Solo las filas con importe cobrado son plata que entró: los códigos E (alta de plan de pago)
    // y J (otra novedad) vienen en 0 y generarían pagos de $0.
    const soloCobros: FiltroFila[] = [{ fromIndex: 3, operador: 'MAYOR', valor: '0' }];

    it('deja pasar el cobro al contado (A) y el cobro de cuota del plan (F)', () => {
        expect(pasaFiltro(fila('000002274591', 'A', '315.22', '315.22'), soloCobros)).toBe(true);
        expect(pasaFiltro(fila('000002274591', 'F', '500.50', '500.50'), soloCobros)).toBe(true);
    });

    it('descarta el alta de plan de pago (E) y la novedad sin cobro (J)', () => {
        expect(pasaFiltro(fila('000002274591', 'E', '479.98', '0.00'), soloCobros)).toBe(false);
        expect(pasaFiltro(fila('000002274591', 'J', '26.79', '0.00'), soloCobros)).toBe(false);
    });
});

describe('describirFiltros', () => {
    it('resume los filtros en una línea para el log y el preview', () => {
        expect(describirFiltros([
            { fromIndex: 22, operador: 'MAYOR', valor: '0' },
            { fromIndex: 19, operador: 'NO_VACIO' },
        ])).toBe('col 22 MAYOR "0" y col 19 NO_VACIO');
    });

    it('devuelve vacío si no hay filtros', () => {
        expect(describirFiltros(undefined)).toBe('');
        expect(describirFiltros([])).toBe('');
    });
});
