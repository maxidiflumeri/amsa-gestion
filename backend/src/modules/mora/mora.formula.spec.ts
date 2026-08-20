/**
 * Tests de la fórmula del régimen de recargos.
 *
 * Ejecutar: npx jest mora.formula.spec.ts --no-coverage
 *
 * Los dos primeros casos son **estados de deuda reales de la oficina virtual de AYSA** al
 * 20/08/2026: son la fuente de verdad, no un fixture inventado. Si alguno de estos falla, la
 * plataforma dejó de coincidir con lo que AYSA le cobra al deudor.
 */
import { Prisma } from '@prisma/client';
import { coeficienteMora, conceptosMora, sinRecargo } from './mora.formula';
import { CONFIG_MORA_DEFAULT } from './mora.constants';

const dec = (x: string | number) => new Prisma.Decimal(x);
const num = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toNumber();

describe('conceptosMora — contra el estado de deuda real de AYSA', () => {
    /**
     * Cuenta contrato 987636 (FORMIGLIETTI), factura 0110B62044311A, vto 23/05/2025,
     * calculado al 20/08/2026. Estado de deuda de AYSA:
     *   Imp orig 70.322,32 · Int/Rec 46.886,68 · Rec AJ/EJ 11.720,90 · IVA 12.307,59 · Total 141.237,49
     */
    it('reproduce FORMIGLIETTI al centavo, concepto por concepto', () => {
        const capital = 70322.32;
        // El coeficiente que implica el Int/Rec informado, despejando el 5% fijo.
        const coef = dec(1).plus(dec(46886.68).div(capital)).minus(CONFIG_MORA_DEFAULT.recargoFijo);

        const c = conceptosMora(capital, coef, CONFIG_MORA_DEFAULT);

        expect(num(c.intRec)).toBe(46886.68);
        expect(num(c.recAjEj)).toBe(11720.90);
        expect(num(c.iva)).toBe(12307.59);
        expect(num(c.total)).toBe(141237.49);
    });

    /**
     * Cuenta contrato 987285 (GALEFFI), factura 0110B89067338A, vto 17/12/2025:
     *   Imp orig 35.263,67 · Int/Rec 10.102,65 · Rec AJ/EJ 4.536,63 · IVA 3.074,25 · Total 52.977,20
     */
    it('reproduce GALEFFI al centavo, concepto por concepto', () => {
        const capital = 35263.67;
        const coef = dec(1).plus(dec(10102.65).div(capital)).minus(CONFIG_MORA_DEFAULT.recargoFijo);

        const c = conceptosMora(capital, coef, CONFIG_MORA_DEFAULT);

        expect(num(c.intRec)).toBe(10102.65);
        expect(num(c.recAjEj)).toBe(4536.63);
        expect(num(c.iva)).toBe(3074.25);
        expect(num(c.total)).toBe(52977.20);
    });

    it('el Rec AJ/EJ es exactamente el 10% de capital + interés', () => {
        const c = conceptosMora(70322.32, dec('1.61673966'), CONFIG_MORA_DEFAULT);
        const esperado = dec(70322.32).plus(c.intRec).mul(0.1).toDecimalPlaces(2);
        expect(num(c.recAjEj)).toBe(num(esperado));
    });

    it('el IVA grava solo los recargos, nunca el capital', () => {
        const c = conceptosMora(100000, dec('1.5'), CONFIG_MORA_DEFAULT);
        const esperado = c.intRec.plus(c.recAjEj).mul(0.21).toDecimalPlaces(2);
        expect(num(c.iva)).toBe(num(esperado));
        // Si gravara el capital, el IVA sería muchísimo más grande.
        expect(c.iva.lessThan(dec(100000).mul(0.21))).toBe(true);
    });

    it('con coeficiente 1 todavía cobra el recargo fijo del 5%', () => {
        const c = conceptosMora(1000, dec(1), CONFIG_MORA_DEFAULT);
        expect(num(c.intRec)).toBe(50);
    });

    it('respeta una configuración distinta del régimen', () => {
        const config = { ...CONFIG_MORA_DEFAULT, recargoFijo: 0, recargoGestion: 0, iva: 0 };
        const c = conceptosMora(1000, dec('1.10'), config);
        expect(num(c.intRec)).toBe(100);
        expect(num(c.recAjEj)).toBe(0);
        expect(num(c.iva)).toBe(0);
        expect(num(c.total)).toBe(1100);
    });
});

describe('conceptosMora — aritmética', () => {
    /**
     * El caso que hacía diferir la ficha del reporte: `0,10 × (valor de 2 decimales)` cae exacto en
     * medio centavo, y en punto flotante ese .635 es .63499... y redondea para el otro lado.
     */
    it('redondea el medio centavo para arriba, como MySQL sobre DECIMAL', () => {
        // capital + intRec = 45.366,35 → x 0,10 = 4.536,635 → tiene que dar 4.536,64
        const capital = 35000;
        const coef = dec(1).plus(dec(10366.35).div(capital)).minus(CONFIG_MORA_DEFAULT.recargoFijo);
        const c = conceptosMora(capital, coef, CONFIG_MORA_DEFAULT);
        expect(num(c.intRec)).toBe(10366.35);
        expect(num(c.recAjEj)).toBe(4536.64);
    });

    it('el coeficiente usa la misma escala que MySQL (16 decimales)', () => {
        // Índices reales del ud60: cierre de agosto 2026 sobre cierre de mayo 2026 (tipo 1).
        const c = coeficienteMora(dec('7044.482204200000'), dec('6597.912601700000'));
        expect(c.decimalPlaces()).toBeLessThanOrEqual(16);
        expect(c.toNumber()).toBeCloseTo(1.0676834674, 9);
    });
});

describe('sinRecargo', () => {
    it('una factura no vencida no devenga nada', () => {
        const c = sinRecargo(12345.67);
        expect(num(c.intRec)).toBe(0);
        expect(num(c.recAjEj)).toBe(0);
        expect(num(c.iva)).toBe(0);
        expect(num(c.total)).toBe(12345.67);
        expect(c.coeficiente.toNumber()).toBe(1);
    });
});
