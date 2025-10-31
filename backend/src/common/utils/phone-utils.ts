import { parsePhoneNumberFromString, PhoneNumber } from 'libphonenumber-js';

type TipoLinea = 'MOBILE' | 'FIXED_LINE' | 'FIXED_LINE_OR_MOBILE' | 'VOIP' | 'UNKNOWN';

export type NormalizarResultado = {
    valido: boolean;
    motivoInvalido?: string;
    e164?: string;                 // "+549..." o "+5411..."
    internacional?: string;        // "+54 9 11 5667-8901"
    nacional?: string;             // "11 5667-8901" o "(011) 4567-1234"
    tipo?: TipoLinea;              // "MOBILE" | "FIXED_LINE" | ...
    region: 'AR';
};

function limpiarBasico(input: string): string {
    if (!input) return '';
    // quita espacios, guiones, paréntesis, puntos
    const limpio = input.replace(/[^\d+]/g, '');

    // soportar "00" internacional => "+": ej. 0054... -> +54...
    if (limpio.startsWith('00')) return `+${limpio.slice(2)}`;

    return limpio;
}

function arPrefijarSiFalta(num: string): string {
    // Si ya tiene +, dejar
    if (num.startsWith('+')) return num;

    // Si empieza con 54..., prefijar +
    if (num.startsWith('54')) return `+${num}`;

    // Si empieza con 0 (trunk), libphonenumber lo maneja si damos región 'AR'
    // Igual prefijamos +54 si no trae prefijo país:
    return `+54${num}`;
}

export function normalizarTelefonoArgentino(input: string): NormalizarResultado {
    const limpio = limpiarBasico(input);
    if (!limpio) return { valido: false, motivoInvalido: 'Vacío', region: 'AR' };

    const conPrefijo = arPrefijarSiFalta(limpio);

    const phone = parsePhoneNumberFromString(conPrefijo, 'AR');
    if (!phone) return { valido: false, motivoInvalido: 'No se pudo parsear', region: 'AR' };
    if (!phone.isValid()) return { valido: false, motivoInvalido: 'Formato AR inválido', region: 'AR' };

    // Formatos y tipo
    const e164 = phone.number;                              // "+549........"
    const internacional = phone.formatInternational();      // "+54 9 11 ...."
    const nacional = phone.formatNational();                // "(011) 4567-1234" o "11 5667-8901"
    const tipo = (phone.getType?.() as TipoLinea) || 'UNKNOWN';

    return {
        valido: true,
        e164,
        internacional,
        nacional,
        tipo,
        region: 'AR',
    };
}

// Para throw directo en pipelines (ej. Pipes/Services)
export function assertTelefonoAR(input: string) {
    const res = normalizarTelefonoArgentino(input);
    if (!res.valido) {
        const msg = `Número de teléfono AR inválido${res.motivoInvalido ? `: ${res.motivoInvalido}` : ''}`;
        const error: any = new Error(msg);
        error.code = 'PHONE_AR_INVALID';
        throw error;
    }
    return res;
}