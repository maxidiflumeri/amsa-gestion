import { autoMapearVariables, DeudorParaMapper } from './variables-mapper';

/**
 * Las variables de importe son lo que el deudor lee en el mail, así que un mapeo equivocado no es un
 * bug interno: es un número mal informado a una persona.
 *
 * `{{saldo}}` era sinónimo de `{{deuda}}` y las dos devolvían `montoTotal`. Un deudor que había pagado
 * la mitad recibía un mail reclamándole el total, con la palabra "saldo" adelante.
 */
const deudor = (over: Partial<DeudorParaMapper> = {}): DeudorParaMapper => ({
    id: 1,
    documento: '20123456789',
    nombre: 'Ana',
    apellido: 'Pérez',
    montoTotal: 100000,
    saldo: 40000,
    deudaActualizada: 133100,
    fechaVencimiento: null,
    camposAdicionales: null,
    ...over,
});

/** Los importes salen formateados como moneda; para comparar alcanza con los dígitos. */
const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '');

const valorDe = (variable: string, d: DeudorParaMapper) =>
    autoMapearVariables([variable], d)[0].valor;

describe('variables-mapper — importes', () => {
    it('{{saldo}} devuelve el saldo pendiente, no el monto original', () => {
        expect(soloDigitos(valorDe('saldo', deudor()))).toBe('4000000');
    });

    it('{{deuda}} y {{monto_total}} devuelven el monto original', () => {
        expect(soloDigitos(valorDe('deuda', deudor()))).toBe('10000000');
        expect(soloDigitos(valorDe('monto_total', deudor()))).toBe('10000000');
    });

    it('{{deuda_actualizada}} devuelve el monto con el recargo por mora', () => {
        expect(soloDigitos(valorDe('deuda_actualizada', deudor()))).toBe('13310000');
    });

    it('los tres importes son distintos entre sí para un mismo caso', () => {
        const d = deudor();
        const valores = ['saldo', 'deuda', 'deuda_actualizada'].map(v => valorDe(v, d));
        expect(new Set(valores).size).toBe(3);
    });

    it('sin saldo consolidado cae al monto original, que es lo que se debe', () => {
        expect(soloDigitos(valorDe('saldo', deudor({ saldo: null })))).toBe('10000000');
    });

    it('sin recálculo de mora, la deuda actualizada queda vacía en vez de mentir', () => {
        expect(valorDe('deuda_actualizada', deudor({ deudaActualizada: null }))).toBeNull();
    });

    it('los sinónimos del saldo resuelven a la misma entrada', () => {
        for (const v of ['saldo_pendiente', 'resto', 'restante']) {
            expect(soloDigitos(valorDe(v, deudor()))).toBe('4000000');
        }
    });

    it('un mapeo manual del usuario gana sobre el catálogo', () => {
        const [sug] = autoMapearVariables(
            ['saldo'],
            deudor(),
            [{ variable: 'saldo', fuenteTipo: 'literal', fuenteClave: 'a convenir' }],
        );
        expect(sug.valor).toBe('a convenir');
        expect(sug.origen).toBe('mapeo_guardado');
    });
});
