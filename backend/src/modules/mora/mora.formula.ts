/**
 * La fórmula del régimen de recargos, en aritmética decimal.
 *
 * Está separada del servicio por dos motivos: se testea sin base, y —más importante— **tiene que dar
 * el mismo número que la versión SQL** de `recalcularCartera`. Si la ficha y el reporte difieren por
 * centavos, el gestor deja de confiar en los dos.
 *
 * Por eso no se usa aritmética de doubles: se replica lo que hace MySQL. El cociente de dos DECIMAL
 * se redondea a la escala del dividendo más `div_precision_increment` (4 por defecto), o sea 16
 * decimales para un `Decimal(30,12)`, y cada concepto se redondea a 2 con ROUND_HALF_UP.
 *
 * Ver docs/mora-aysa-spec.md §1 para de dónde sale cada término.
 */
import { Prisma } from '@prisma/client';
import { ConfigMora } from './mora.constants';

type Dec = Prisma.Decimal;

/** Escala del cociente en MySQL: 12 (escala de `indice_mora.indice`) + 4 (`div_precision_increment`). */
export const ESCALA_COEFICIENTE = 16;

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

export interface ConceptosMora {
    coeficiente: Dec;
    intRec: Dec;
    recAjEj: Dec;
    iva: Dec;
    total: Dec;
}

/** `indice(fecha de cálculo) / indice(vencimiento)`, con la escala de MySQL. */
export function coeficienteMora(indiceCorte: Dec, indiceVencimiento: Dec): Dec {
    return indiceCorte.div(indiceVencimiento).toDecimalPlaces(ESCALA_COEFICIENTE, HALF_UP);
}

/**
 * Los cuatro conceptos de una factura vencida. El redondeo va concepto por concepto, no al final:
 * redondear solo el total da diferencias de centavos contra AYSA.
 */
export function conceptosMora(capital: number | Dec, coeficiente: Dec, config: ConfigMora): ConceptosMora {
    const cap = new Prisma.Decimal(capital);

    const intRec = cap
        .mul(coeficiente.minus(1).plus(config.recargoFijo))
        .toDecimalPlaces(2, HALF_UP);

    const recAjEj = new Prisma.Decimal(config.recargoGestion)
        .mul(cap.plus(intRec))
        .toDecimalPlaces(2, HALF_UP);

    const iva = new Prisma.Decimal(config.iva)
        .mul(intRec.plus(recAjEj))
        .toDecimalPlaces(2, HALF_UP);

    return { coeficiente, intRec, recAjEj, iva, total: cap.plus(intRec).plus(recAjEj).plus(iva) };
}

/** Una factura que todavía no venció no devenga nada: ni interés, ni recargo fijo, ni IVA. */
export function sinRecargo(capital: number | Dec): ConceptosMora {
    const cap = new Prisma.Decimal(capital);
    const cero = new Prisma.Decimal(0);
    return { coeficiente: new Prisma.Decimal(1), intRec: cero, recAjEj: cero, iva: cero, total: cap };
}
