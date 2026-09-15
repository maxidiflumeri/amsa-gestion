/**
 * Convierte un importe (en centavos enteros) a su forma en letras, en castellano rioplatense
 * correcto ("cuarenta y tres mil", con la "y"), para el cupón de pago (spec §7.4).
 *
 * El cupón del sistema viejo tenía el error clásico ("cuarenta tres mil", sin la "y") — acá se
 * corrige a propósito. La boca de pago lee el código de barras, no las letras: esto es una
 * cortesía visual, no un dato que se valide.
 *
 * Sin dependencias externas ni de Nest: función pura, testeable sola.
 */

const UNIDADES = [
    '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
    'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
    'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro',
    'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
] as const;

/** Índice = decena (3 → "treinta" … 9 → "noventa"). 0-2 no se usan: 0-29 sale de `UNIDADES`. */
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'] as const;

/** Índice = centena (1 → "ciento" … 9 → "novecientos"). 100 exacto es "cien", caso aparte. */
const CENTENAS = [
    '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
    'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
] as const;

/** 0-99. */
function menosDeCien(n: number): string {
    if (n <= 29) return UNIDADES[n];
    const decena = Math.floor(n / 10);
    const unidad = n % 10;
    return unidad ? `${DECENAS[decena]} y ${UNIDADES[unidad]}` : DECENAS[decena];
}

/** 0-999. */
function menosDeMil(n: number): string {
    if (n === 0) return '';
    if (n === 100) return 'cien';
    const centena = Math.floor(n / 100);
    const resto = menosDeCien(n % 100);
    const base = centena ? CENTENAS[centena] : '';
    return base && resto ? `${base} ${resto}` : base || resto;
}

/**
 * Apócope de "uno" antes de "mil"/"millón(es)": "treinta y uno" → "treinta y un", "uno" → "un".
 * Caso irregular: "veintiuno" → "veintiún" (con tilde, no solo le saca la "o" — a diferencia del
 * resto, acá cambia el acento tónico). Sin esto, "21.000" salía "veintiun mil" (sin tilde),
 * incorrecto en castellano.
 */
function apocopeUno(texto: string): string {
    if (texto === 'veintiuno') return 'veintiún';
    if (texto === 'uno') return 'un';
    if (texto.endsWith(' uno')) return `${texto.slice(0, -3)}un`;
    return texto;
}

/** Entero no negativo, sin límite práctico (el archivo real llega hasta 2.706.359). */
function enteroEnLetras(n: number): string {
    if (n === 0) return 'cero';

    const millones = Math.floor(n / 1_000_000);
    const miles = Math.floor((n % 1_000_000) / 1000);
    const resto = n % 1000;

    const partes: string[] = [];
    if (millones) {
        partes.push(millones === 1 ? 'un millón' : `${apocopeUno(menosDeMil(millones))} millones`);
    }
    if (miles) {
        partes.push(miles === 1 ? 'mil' : `${apocopeUno(menosDeMil(miles))} mil`);
    }
    if (resto) {
        partes.push(menosDeMil(resto));
    }
    return partes.join(' ');
}

/**
 * `4378269` → `"cuarenta y tres mil setecientos ochenta y dos con 69 centavos"`.
 *
 * Recibe **centavos enteros**, igual que el resto del módulo (nunca un float de pesos): así no
 * hay redondeo posible entre lo que dice el cupón en letras y lo que dice el código de barras.
 * Los centavos siempre van con 2 dígitos, incluido "con 00 centavos".
 *
 * @throws Error si `centavos` no es un entero ≥ 0. Es un error de programación (el importe de una
 * clave ya validada nunca llega así), no un caso de negocio — por eso no es una excepción de Nest.
 */
export function importeEnLetras(centavos: number): string {
    if (!Number.isInteger(centavos) || centavos < 0) {
        throw new Error(`importeEnLetras: centavos inválido (${centavos})`);
    }
    const pesos = Math.trunc(centavos / 100);
    const cent = centavos % 100;
    return `${enteroEnLetras(pesos)} con ${String(cent).padStart(2, '0')} centavos`;
}
