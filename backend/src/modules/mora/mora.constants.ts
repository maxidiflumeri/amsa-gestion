/**
 * Parámetros del régimen de recargos por mora.
 *
 * Son números de una resolución del cedente, así que van en `empresa.configuracion.mora` y no
 * hardcodeados. Estos son los defaults, deducidos del estado de deuda de AYSA y verificados al
 * centavo contra 15 casos reales (docs/mora-aysa-spec.md §1 y §7.3).
 */

export interface ConfigMora {
    /** Puntos fijos que se suman al coeficiente de interés. AYSA: 5%. */
    recargoFijo: number;
    /** Recargo por gestión de cobranza, sobre capital + interés. AYSA: 10%. */
    recargoGestion: number;
    /** Alícuota de IVA. Grava SOLO los recargos, nunca el capital. */
    iva: number;
    /** Divisor de la tasa mensual para diarizarla. AYSA usa 30 tenga el mes los días que tenga. */
    diasBase: number;
    /** Multiplicadores de cada tipo de índice sobre la tasa base. */
    multiplicadores: Record<string, number>;
}

export const CONFIG_MORA_DEFAULT: ConfigMora = {
    recargoFijo: 0.05,
    recargoGestion: 0.1,
    iva: 0.21,
    diasBase: 30,
    multiplicadores: { '1': 1, '2': 1.5, '3': 2 },
};

/** El tipo de índice con el que se actualiza la deuda. Los otros dos son para planes de pago. */
export const TIPO_DEUDA_ACTUALIZADA = 1;

/**
 * Redondeo a 2 decimales, que se aplica **por factura y por concepto** — no al total.
 * Redondear solo el total da diferencias de centavos contra AYSA (docs/mora-aysa-spec.md §6.1).
 */
export function redondear2(x: number): number {
    return Math.round(x * 100) / 100;
}

/** `2026-08` → `{ anio: 2026, mes: 8 }`. Lanza si el formato no es el esperado. */
export function parsearPeriodo(periodo: string): { anio: number; mes: number } {
    const m = /^(\d{4})-(\d{2})$/.exec(periodo);
    if (!m) throw new Error(`Periodo inválido: "${periodo}". Se espera "YYYY-MM".`);
    const anio = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    if (mes < 1 || mes > 12) throw new Error(`Periodo inválido: mes ${mes} fuera de rango`);
    return { anio, mes };
}

export function formatearPeriodo(anio: number, mes: number): string {
    return `${anio}-${String(mes).padStart(2, '0')}`;
}

/** Días del mes, con la regla gregoriana completa (el CRM viejo usaba `mod(anio,4)` a secas). */
export function diasDelMes(anio: number, mes: number): number {
    return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Fecha UTC a medianoche, que es como se guardan las columnas `@db.Date`. */
export function fechaUtc(anio: number, mes: number, dia: number): Date {
    return new Date(Date.UTC(anio, mes - 1, dia));
}

export function aIsoFecha(d: Date): string {
    return d.toISOString().slice(0, 10);
}
