/**
 * Tests del correlativo de `numeroRemesa`.
 *
 * Contexto: hasta 2026-07-27 el número lo mandaba el frontend y, si el operador lo dejaba vacío,
 * caía a `Date.now()` — de ahí los "números de remesa random" tipo `1784657478166` que reportaron
 * los usuarios. Los flujos que crean una remesa por día (Toyota 87) necesitan un correlativo.
 */
import { siguienteNumeroRemesa } from './numero-remesa';

describe('siguienteNumeroRemesa', () => {
    it('respeta el número que escribió el operador', () => {
        expect(siguienteNumeroRemesa(['00007'], 'MI-REMESA-X')).toBe('MI-REMESA-X');
    });

    it('arranca en 00001 cuando la empresa no tiene remesas', () => {
        expect(siguienteNumeroRemesa([])).toBe('00001');
    });

    it('sigue el correlativo conservando el ancho', () => {
        expect(siguienteNumeroRemesa(['00001', '00002', '00003'])).toBe('00004');
    });

    it('toma el máximo, no el último de la lista', () => {
        expect(siguienteNumeroRemesa(['00009', '00002', '00007'])).toBe('00010');
    });

    it('ignora los timestamps viejos para no disparar el contador', () => {
        // El caso real: remesas creadas antes del fix, con Date.now() como número. Si entraran al
        // cálculo, el correlativo saltaría a 1784657478167 y no habría vuelta atrás.
        expect(siguienteNumeroRemesa(['00003', '1784657478166', '1784644086107'])).toBe('00004');
    });

    it('ignora nulos, vacíos y números no numéricos', () => {
        expect(siguienteNumeroRemesa([null, 'REMESA-VIEJA', '  ', undefined, '00012'])).toBe('00013');
    });

    it('si solo hay timestamps, arranca igual desde 00001', () => {
        expect(siguienteNumeroRemesa(['1784657478166'])).toBe('00001');
    });

    it('un número más ancho que el default define el ancho', () => {
        expect(siguienteNumeroRemesa(['000123'])).toBe('000124');
    });

    it('trata el string en blanco como "sin propuesta"', () => {
        expect(siguienteNumeroRemesa(['00005'], '   ')).toBe('00006');
    });

    it('tolera espacios alrededor del número guardado', () => {
        expect(siguienteNumeroRemesa([' 00042 '])).toBe('00043');
    });
});
