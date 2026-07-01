import { reconciliarSaldo, reconciliarAusente } from './reconciliar-actualizacion';

describe('reconciliarSaldo (ACTUALIZACIONES modo saldo)', () => {
    it('actualización única: crea pago por lo pagado (original − saldo)', () => {
        // debe 1000, el archivo dice que quedan 800 → pagó 200, sin pagos previos
        expect(reconciliarSaldo(1000, 800, 0)).toEqual({ tipo: 'pago', importe: 200 });
    });

    it('actualización sucesiva: NO duplica (resta pagos ya registrados)', () => {
        // semana N ya cargó 200; semana N+1 el saldo bajó a 550 → total pagado 450 → falta cargar 250
        expect(reconciliarSaldo(1000, 550, 200)).toEqual({ tipo: 'pago', importe: 250 });
    });

    it('con pago manual previo: absorbe el manual y solo carga el incremento', () => {
        // 3 facturas de 100 (original 300). El jueves se cargó 1 pago manual (100).
        // El lunes la actualización dice que quedan 100 (pagó 2) → objetivo 200, ya 100 → carga 100.
        expect(reconciliarSaldo(300, 100, 100)).toEqual({ tipo: 'pago', importe: 100 });
    });

    it('ya reconciliado: no hace nada', () => {
        // objetivo 200, ya pagado 200 → nada
        expect(reconciliarSaldo(1000, 800, 200)).toEqual({ tipo: 'nada' });
    });

    it('sobre-registrado (archivo dice menos pagado que lo que tenemos): no des-paga', () => {
        // objetivo 200, ya 500 → delta -300 → nada (no crea "des-pago")
        expect(reconciliarSaldo(1000, 800, 500)).toEqual({ tipo: 'nada' });
    });

    it('la deuda creció (saldo informado > original): factura de ajuste', () => {
        expect(reconciliarSaldo(1000, 1200, 0)).toEqual({ tipo: 'ajuste', importe: 200 });
    });

    it('diferencias por debajo del epsilon se tratan como nada', () => {
        expect(reconciliarSaldo(1000, 999.5, 0)).toEqual({ tipo: 'nada' }); // objetivo 0.5 ≤ 1
        expect(reconciliarSaldo(1000.0000001, 800, 200)).toEqual({ tipo: 'nada' });
    });

    it('saldo cero: paga todo lo que falta', () => {
        expect(reconciliarSaldo(1000, 0, 300)).toEqual({ tipo: 'pago', importe: 700 });
    });
});

describe('reconciliarAusente (ACTUALIZACIONES escenario C / afterAll)', () => {
    it('deudor ausente con saldo pendiente: paga el resto y marca facturas', () => {
        expect(reconciliarAusente(1000, 200)).toEqual({
            tipo: 'pago',
            importe: 800,
            marcarFacturasPagadas: true,
        });
    });

    it('deudor ausente ya saldado por pagos existentes: marca facturas sin pago nuevo', () => {
        expect(reconciliarAusente(1000, 1000)).toEqual({
            tipo: 'saldado',
            marcarFacturasPagadas: true,
        });
    });

    it('deudor ausente sobre-registrado: no crea pago, marca facturas', () => {
        expect(reconciliarAusente(1000, 1200)).toEqual({
            tipo: 'saldado',
            marcarFacturasPagadas: true,
        });
    });

    it('montoTotal 0: skip, no toca facturas (evita SIT-050 espurio)', () => {
        expect(reconciliarAusente(0, 0)).toEqual({ tipo: 'skip', marcarFacturasPagadas: false });
    });

    it('montoTotal nulo: skip', () => {
        expect(reconciliarAusente(null, 500)).toEqual({ tipo: 'skip', marcarFacturasPagadas: false });
    });
});
