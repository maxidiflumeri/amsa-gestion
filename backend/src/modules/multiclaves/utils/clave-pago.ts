/**
 * Utilidades puras sobre las claves de pago de Telecom/Personal (multiclaves).
 *
 * Las usa `imports/utils/multiclaves-parser.ts` para validar el archivo al cargar, y (fase 2) el
 * servicio del cupón para revalidar el código de barras antes de dibujarlo. Sin dependencias de
 * Nest ni de Prisma: son funciones de texto a texto/número, testeables solas.
 *
 * Ver `docs/multiclaves-spec.md` §1.2-§1.4 y §5.4.
 */

/**
 * Dígito verificador módulo 10 con pesos `3,1,3,1…` desde la **izquierda**, sobre todos los
 * dígitos anteriores al DV (spec §1.4). `DV = (10 − Σ(dígito·peso) % 10) % 10`.
 *
 * @param digitos Los dígitos ANTERIORES al DV (sin incluirlo). Puede tener cualquier largo.
 */
export function dvModulo10_31(digitos: string): number {
    let suma = 0;
    for (let i = 0; i < digitos.length; i++) {
        const peso = i % 2 === 0 ? 3 : 1;
        suma += Number(digitos[i]) * peso;
    }
    return (10 - (suma % 10)) % 10;
}

/**
 * Convierte un importe de texto a **centavos enteros**, sin pasar por `parseFloat`: la conversión
 * por float es la que produce `1988000.9999` en vez de `1988001` (spec §1.1).
 *
 * Acepta `/^\d{1,12}(\.\d{1,2})?$/`: punto decimal, 0/1/2 decimales, sin coma, sin separador de
 * miles, sin signo. Cualquier otra forma (coma decimal, 3+ decimales, vacío, negativo) → `null`.
 */
export function centavosDeTexto(v: string): number | null {
    if (typeof v !== 'string') return null;
    const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(v.trim());
    if (!m) return null;
    const entero = m[1];
    const decimales = (m[2] ?? '').padEnd(2, '0');
    return Number(entero) * 100 + Number(decimales);
}

/** Resultado de decodificar una `CLAVE_PAGO` de 22 dígitos, sin validar su DV. */
export interface ClaveDecodificada {
    convenio: string;
    centavos: number;
    dv: number;
}

/**
 * Decodifica una `CLAVE_PAGO` de 22 dígitos: `00 | NRO_CONVENIO(8) | centavos(11) | DV(1)`
 * (spec §1.2). Devuelve `null` si no son 22 dígitos o no empieza con `00` (motivo `CLAVE_FORMATO`
 * del parser). NO valida el dígito verificador: eso lo hace `dvModulo10_31` sobre los primeros 21
 * caracteres, aparte (motivo `CLAVE_DV`).
 */
export function descomponerClave(clave22: string): ClaveDecodificada | null {
    if (typeof clave22 !== 'string' || !/^00\d{20}$/.test(clave22)) return null;
    return {
        convenio: clave22.slice(2, 10),
        centavos: Number(clave22.slice(10, 21)),
        dv: Number(clave22.slice(21, 22)),
    };
}

/** Resultado de decodificar un `SEC_COD_BARRA` de 50 dígitos, sin validar su DV. */
export interface CodigoBarrasDecodificado {
    centavos: number;
    /** `YYYY-MM-DD` (el código trae `DDMMAAAA`). */
    vto: string;
    convenio: string;
    dv: number;
}

/**
 * Decodifica un `SEC_COD_BARRA` de 50 dígitos:
 * `498 | centavos(10) | vto DDMMAAAA(8) | 000000000000(12) | NRO_CONVENIO(8) | 00000000(8) | DV(1)`
 * (spec §1.3). Devuelve `null` si no son 50 dígitos, no empieza con `498`, o alguno de los dos
 * bloques que "siempre son ceros" no lo es (motivo `BARRA_FORMATO`). NO valida el dígito
 * verificador: eso lo hace `dvModulo10_31` sobre los primeros 49 caracteres, aparte (`BARRA_DV`).
 */
export function descomponerCodigoBarras(cb50: string): CodigoBarrasDecodificado | null {
    if (typeof cb50 !== 'string' || !/^\d{50}$/.test(cb50)) return null;
    if (cb50.slice(0, 3) !== '498') return null;
    const cerosA = cb50.slice(21, 33);
    const cerosB = cb50.slice(41, 49);
    if (!/^0{12}$/.test(cerosA) || !/^0{8}$/.test(cerosB)) return null;

    const ddmmyyyy = cb50.slice(13, 21);
    const dd = ddmmyyyy.slice(0, 2);
    const mm = ddmmyyyy.slice(2, 4);
    const yyyy = ddmmyyyy.slice(4, 8);

    return {
        centavos: Number(cb50.slice(3, 13)),
        vto: `${yyyy}-${mm}-${dd}`,
        convenio: cb50.slice(33, 41),
        dv: Number(cb50.slice(49, 50)),
    };
}

/**
 * Formatea centavos enteros al texto que espera el cupón: `4378269 → "43782.69"` (punto decimal,
 * siempre 2 decimales, sin separador de miles — el formato "en letras" y el `$` los agrega el que
 * llama). Sin división por 100 con float: se separa entero/decimales sobre enteros.
 */
export function formatoImporteCupon(centavos: number): string {
    const negativo = centavos < 0;
    const abs = Math.abs(Math.trunc(centavos));
    const entero = Math.trunc(abs / 100);
    const decimales = abs % 100;
    return `${negativo ? '-' : ''}${entero}.${String(decimales).padStart(2, '0')}`;
}

/**
 * Normaliza la referencia de una clave de pago informada en un archivo de cobros (fase 5), que
 * puede venir como el `NRO_CONVENIO` (8 dígitos), la `CLAVE_PAGO` completa (22) o el
 * `SEC_COD_BARRA` (50). Siempre devuelve el `NRO_CONVENIO` de 8 dígitos, o `null` si no matchea
 * ninguna de las tres formas (spec §5.4, §10.4).
 */
export function normalizarReferenciaClave(v: string): string | null {
    const t = (v ?? '').trim();
    if (/^\d{8}$/.test(t)) return t;
    if (/^\d{22}$/.test(t)) return t.slice(2, 10);
    if (/^\d{50}$/.test(t)) return t.slice(33, 41);
    return null;
}
