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
 *
 * Exportada porque el formateador de teléfonos de reportes la necesita para decidir si le
 * corresponde el `15` local: hay celulares guardados sin el `9` (`+541155775452`), y para esos la
 * marca del E.164 no alcanza.
 */
export function clasificarPorEnacom(nacionalSin9: string): 'MOBILE' | 'FIXED_LINE' | null {
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
    /** Cómo se resolvió el código de área cuando el número no lo traía. Ver {@link ContextoTelefono}. */
    areaDeducidaDe?: 'hermano' | 'codigo-postal';
};

/**
 * Datos del caso que permiten deducir el código de área de un teléfono que vino sin él.
 *
 * Muchos cedentes mandan los teléfonos en formato **local** —`42996640` (fijo) o `1564435038`
 * (celular, donde el `15` es el prefijo local de móvil)— y así no se pueden marcar. En el archivo de
 * AYSA es el 56% de los teléfonos.
 */
export type ContextoTelefono = {
    /** Otros teléfonos del mismo caso, crudos. Si alguno trae área, se le presta al que no la tiene. */
    otrosTelefonos?: string[];
    /** Código postal del domicilio del caso, para la tabla `cp-area-telefonica.json`. */
    codigoPostal?: string;
};

// ---- Tabla código postal → código de área ----
// Derivada de datos reales (ver el `_meta` del JSON). Solo entran los CP donde la evidencia es
// concluyente: ante la duda es preferible descartar el teléfono a asignarle un área equivocada,
// porque el gestor terminaría llamando a otra persona.
type CpAreaData = {
    _meta?: Record<string, unknown>;
    /** Código postal completo (`B1843`) → área. Es el nivel preciso. */
    cp_area: Record<string, string>;
    /** Zona postal (`B184`) → área. Fallback para los CP que no están arriba. */
    zona_area?: Record<string, string>;
};

let cpArea: CpAreaData | null | undefined;

function getCpArea(): CpAreaData | null {
    if (cpArea !== undefined) return cpArea;
    try {
        const ruta = join(__dirname, '..', 'data', 'cp-area-telefonica.json');
        cpArea = JSON.parse(readFileSync(ruta, 'utf8')) as CpAreaData;
    } catch {
        cpArea = null; // modo degradado: sin tabla no deducimos por CP
    }
    return cpArea;
}

/**
 * Código de área de un número nacional argentino (10 dígitos, sin `+54` ni el `9` de móvil).
 *
 * No se puede partir por una longitud fija: el número nacional siempre tiene 10 dígitos, pero el
 * área ocupa 2 (`11`), 3 o 4 según la zona, y el resto es el número local. Se resuelve por
 * longest-prefix-match contra las 300 áreas que publica ENACOM.
 */
export function codigoAreaDe(nacionalSin9: string): string | null {
    const data = getEnacom();
    if (!data) return null;
    for (const alen of [4, 3, 2]) {
        const area = nacionalSin9.slice(0, alen);
        if (data.block_lengths_by_area[area]) return area;
    }
    return null;
}

/** Solo los dígitos, sin el `0` de trunk ni el `+54` de país. */
function soloDigitosNacionales(bruto: string): string {
    let d = String(bruto ?? '').replace(/\D/g, '');
    if (d.startsWith('54')) d = d.slice(2);
    return d.replace(/^0/, '');
}

/**
 * ¿El número vino en formato local, sin código de área?
 *
 * Dos formas: 8 dígitos sueltos (un fijo, `42996640`) o `15` + 8 dígitos (un celular como lo marca
 * la gente localmente, `1564435038`). En los dos casos falta la característica y el número, tal como
 * está, no sirve para llamar.
 */
function partesLocalesSinArea(bruto: string): { local: string; movil: boolean } | null {
    const d = soloDigitosNacionales(bruto);
    if (d.length === 8) return { local: d, movil: false };
    if (d.length === 10 && d.startsWith('15')) return { local: d.slice(2), movil: true };
    return null;
}

/** Área declarada por alguno de los otros teléfonos del caso. */
function areaDeHermanos(otros: string[] | undefined): string | null {
    for (const t of otros ?? []) {
        if (partesLocalesSinArea(t)) continue;           // ése tampoco la trae
        const d = soloDigitosNacionales(t).replace(/^9/, '');
        if (d.length !== 10) continue;
        const area = codigoAreaDe(d);
        if (area) return area;
    }
    return null;
}

/**
 * Área según el código postal del domicilio, del nivel más preciso al más general: primero el CP
 * completo (`B1843`) y, si no está, la zona postal (`B184`).
 */
function areaDeCodigoPostal(cp: string | undefined): string | null {
    const data = getCpArea();
    if (!data || !cp) return null;
    const limpio = String(cp).trim().toUpperCase();
    return data.cp_area[limpio.slice(0, 5)] ?? data.zona_area?.[limpio.slice(0, 4)] ?? null;
}

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

/**
 * Normaliza un teléfono argentino a E.164.
 *
 * Si el número vino en formato local (sin código de área) y `ctx` trae datos del caso, se intenta
 * deducir la característica antes de darlo por inválido, en este orden:
 *
 *   1. El número ya la trae (o viene con `0` / `+54`) → se resuelve directo.
 *   2. **Otro teléfono del mismo caso** la declara → se le presta.
 *   3. El **código postal** del domicilio la determina de forma concluyente → tabla `cp-area-telefonica.json`.
 *
 * Si ninguna alcanza, el resultado es inválido: un número sin característica no se puede marcar, y
 * completarlo a ojo haría que el gestor llame a otra persona.
 */
export function normalizarTelefonoArgentino(input: string, ctx?: ContextoTelefono): NormalizarResultado {
    const directo = normalizarDirecto(input);
    if (directo.valido || !ctx) return directo;

    // No validó: si vino en formato local, probamos deducir el área.
    const partes = partesLocalesSinArea(input);
    if (!partes) return directo;

    const candidatos: Array<{ area: string | null; origen: 'hermano' | 'codigo-postal' }> = [
        { area: areaDeHermanos(ctx.otrosTelefonos), origen: 'hermano' },
        { area: areaDeCodigoPostal(ctx.codigoPostal), origen: 'codigo-postal' },
    ];

    for (const { area, origen } of candidatos) {
        if (!area) continue;
        // El `9` va delante del área y marca móvil; el `15` local se reemplaza por él.
        const reconstruido = `+54${partes.movil ? '9' : ''}${area}${partes.local}`;
        const res = normalizarDirecto(reconstruido);
        if (res.valido) return { ...res, areaDeducidaDe: origen };
    }

    return { valido: false, motivoInvalido: 'Sin código de área y no se pudo deducir', region: 'AR' };
}

/** Normalización sin deducción: el camino de siempre. */
function normalizarDirecto(input: string): NormalizarResultado {
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

// ---- Filtro de plausibilidad para teléfonos que NO validaron ----
// Un teléfono que no valida (formato raro, característica dudosa) igual se carga
// "en rojo" para revisión manual, SIEMPRE que su forma sea compatible con un teléfono.
// Esto descarta la basura evidente ("0", "123", un número solo) y los rellenos
// ("(02941) 1111-1111", "0000000000") sin borrar números casi-completos reales.
const MIN_DIGITOS_TELEFONO = 10;   // número significativo nacional argentino = 10 dígitos
const MAX_DIGITOS_TELEFONO = 15;   // tope E.164 (54 9 + 10 = 13; margen hasta 15)
const MAX_CORRIDA_REPETIDA = 6;    // 6+ dígitos idénticos seguidos ⇒ relleno/placeholder

/** Corrida más larga de un mismo dígito consecutivo dentro de la cadena de dígitos. */
function corridaMaximaDeDigitos(digitos: string): number {
    let run = digitos.length ? 1 : 0;
    let max = run;
    for (let i = 1; i < digitos.length; i++) {
        run = digitos[i] === digitos[i - 1] ? run + 1 : 1;
        if (run > max) max = run;
    }
    return max;
}

/**
 * ¿La cadena tiene forma de teléfono argentino? No dice que sea válido (para eso está
 * `normalizarTelefonoArgentino`), solo que NO es basura evidente. Se usa para decidir si
 * un teléfono que no validó igual se carga (en rojo) o se descarta.
 *
 * Rechaza: menos de 10 o más de 15 dígitos; y rellenos con 6+ dígitos idénticos seguidos
 * (ej. "(02941) 1111-1111", "0000000000"). Mantiene números reales con dígitos variados
 * aunque no validen (ej. "15-(02941) 64-3701").
 */
export function esPosibleTelefono(input: string): boolean {
    const digitos = String(input ?? '').replace(/\D/g, '');
    if (digitos.length < MIN_DIGITOS_TELEFONO || digitos.length > MAX_DIGITOS_TELEFONO) return false;
    if (corridaMaximaDeDigitos(digitos) >= MAX_CORRIDA_REPETIDA) return false;
    return true;
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