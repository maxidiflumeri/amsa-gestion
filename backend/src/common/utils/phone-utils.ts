import { parsePhoneNumberFromString, PhoneNumber } from 'libphonenumber-js';
import { readFileSync } from 'fs';
import { join } from 'path';

type TipoLinea = 'MOBILE' | 'FIXED_LINE' | 'FIXED_LINE_OR_MOBILE' | 'VOIP' | 'UNKNOWN';

// ---- Clasificación móvil/fijo por rangos de numeración de ENACOM ----
// En Argentina el formato NO distingue móvil de fijo cuando falta el "9"/"15"
// (un celular se carga habitualmente como "1155775452"). La única fuente confiable
// es la asignación de bloques (código de área + central) que publica ENACOM.
// El dataset (enacom-prefijos.json) mapea "indicativo+bloque" -> "M"/"F".
type EnacomData = {
    _meta?: Record<string, unknown>;
    block_lengths_by_area: Record<string, number[]>;
    prefijos: Record<string, 'M' | 'F'>;
};

let enacom: EnacomData | null | undefined;

function getEnacom(): EnacomData | null {
    if (enacom !== undefined) return enacom;
    try {
        // En runtime corremos desde dist/common/utils → el asset queda en dist/common/data
        const ruta = join(__dirname, '..', 'data', 'enacom-prefijos.json');
        enacom = JSON.parse(readFileSync(ruta, 'utf8')) as EnacomData;
    } catch {
        enacom = null; // modo degradado: sin dataset no clasificamos por ENACOM
    }
    return enacom;
}

/**
 * Clasifica el número nacional (sin +54 y sin el 9 de móvil) contra los rangos
 * de ENACOM. Usa longest-prefix-match: prueba el código de área más largo posible
 * y, dentro de él, la longitud de bloque más larga primero. null si no hay match.
 */
function clasificarPorEnacom(nacionalSin9: string): 'MOBILE' | 'FIXED_LINE' | null {
    const data = getEnacom();
    if (!data) return null;
    for (const alen of [4, 3, 2]) {
        const area = nacionalSin9.slice(0, alen);
        const lens = data.block_lengths_by_area[area];
        if (!lens) continue;
        const resto = nacionalSin9.slice(alen);
        for (const bl of [...lens].sort((a, b) => b - a)) {
            const tipo = data.prefijos[area + resto.slice(0, bl)];
            if (tipo) return tipo === 'M' ? 'MOBILE' : 'FIXED_LINE';
        }
    }
    return null;
}

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
    // Clasificación móvil/fijo:
    //  1) el "9" tras +54 (formato internacional de móvil) es señal explícita de móvil;
    //  2) si no, buscamos en los rangos de ENACOM (resuelve celulares cargados sin el 9, ej "1155775452");
    //  3) si no hay match, UNKNOWN: no asumimos fijo (ante la duda, no bloqueamos).
    let tipo: TipoLinea;
    if (e164.startsWith('+549')) {
        tipo = 'MOBILE';
    } else {
        tipo = clasificarPorEnacom(e164.slice(3)) ?? 'UNKNOWN'; // e164.slice(3) quita "+54"
    }

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