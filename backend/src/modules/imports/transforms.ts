import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

/* ------------------------------
 * Transformadores numéricos
 * ------------------------------ */
const toNumberEsAR = (input: any) => {
    if (input == null || input === '') return null;
    if (typeof input === 'number') return input;

    let s = String(input).trim().replace(/[^\d.,-]/g, '');
    if (!s) return null;

    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');

    // Detectar separador decimal inteligentemente: el último suele ser el decimal
    if (lastComma > lastDot) {
        // Estilo Argentina 1.234,56 -> el último es la coma
        s = s.replace(/\./g, '').replace(/,/g, '.');
    } else if (lastDot > lastComma) {
        // Estilo US 1,234.56 -> el último es el punto
        s = s.replace(/,/g, '');
    } else if (lastComma !== -1) {
        // Solo coma: 1234,56 -> 1234.56
        s = s.replace(/,/g, '.');
    }
    // Si solo hay punto (1.234) o nada, parseFloat ya lo maneja bien

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
};

/**
 * Formatea un decimal a la convención local (`1.80` → `1,80`, `1.8` → `1,80`).
 *
 * A diferencia de `toNumber`, que devuelve un **número** para los campos numéricos del modelo
 * (`montoTotal`, importes), este devuelve un **texto** ya formateado: es para los datos adicionales,
 * que se guardan como string y se muestran tal cual en la ficha. El `Coef. zonal` de AYSA viene
 * `1.30` y el gestor lo lee con coma; además el cedente no es prolijo con el segundo decimal
 * (manda `1.8` y `1.80` en la misma bajada) y acá los dos salen igual.
 *
 * `toDecimal:es-AR` usa 2 decimales; `toDecimal:es-AR:3` los que se le pidan. Lo que no parsea como
 * número pasa igual, sin tocar —misma regla que `mapear`—: si el cedente manda `NO INFORMADO` el
 * gestor lo ve, en vez de un campo vacío que no avisa nada.
 */
const toDecimalEsAR = (input: any, decimales = 2) => {
    if (input == null || input === '') return input;
    const n = toNumberEsAR(input);
    if (n == null) return input;
    return n.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
};

/* ------------------------------
 * Transformadores de fecha
 * ------------------------------ */
const toDateExcel = (input: any) => {
    if (!input) return null;
    let n = Number(input);
    if (!isNaN(n)) {
        // Excel base date is Dec 30, 1899
        // Dates > 59 (Feb 28, 1900) require an offset due to the 1900 leap year bug in Excel
        const offset = (n > 59) ? n - 1 : n;
        const excelEpoch = new Date(Date.UTC(1899, 11, 31)); // Dec 31, 1899 since offset is 1-based usually, adjust depending on exact logic
        return new Date(excelEpoch.getTime() + offset * 86400000);
    }
    return toDateAuto(input); // fallback to auto text parsing if it's not a number / already formatted
};

const toDateAuto = (input: any) => {
    if (!input) return null;
    let s = String(input).trim();

    // Quitar la hora si viene (ej: "7/13/23 0:00")
    if (s.includes(' ')) {
        s = s.split(' ')[0];
    }

    const formats = [
        'YYYY-MM-DD',
        'DD/MM/YYYY',
        // Separado por PUNTOS: es como exporta SAP (AYSA manda `21.06.2026`). Van antes del
        // fallback flexible de dayjs, que con estas fechas hace dos destrozos silenciosos:
        // `10.05.2024` lo lee como MM.DD y devuelve el 5 de octubre, y `21.06.2026` —cualquier día
        // mayor a 12— lo devuelve nulo. Con el formato declarado, las dos salen bien.
        // Un `MM.DD.YYYY` no existe como convención, así que no hay ambigüedad que resolver.
        'DD.MM.YYYY',
        'D.M.YYYY',
        'M/D/YY',
        'D/M/YY',
        'DD/MM/YY',
        'MM/DD/YYYY',
        'YYYYMMDD',
        'DD-MM-YYYY',
        'YYYY/MM/DD'
    ];

    for (const f of formats) {
        const d = dayjs(s, f, true);
        if (d.isValid()) return d.toDate();
    }

    // fallback: Date nativo o dayjs flexible
    const d = dayjs(s);
    return d.isValid() ? d.toDate() : null;
};

/* ------------------------------
 * Transformadores básicos de texto
 * ------------------------------ */
const trim = (s: any) => (s == null ? null : String(s).trim());
const upper = (s: any) => (s == null ? null : String(s).toUpperCase());
const title = (s: any) =>
    s == null
        ? null
        : String(s)
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase());
const removeSpaces = (s: any) => (s == null ? null : String(s).replace(/\s+/g, ''));
// Quita comillas simples: la recta ' y las tipográficas ' ' que a veces mete Excel
// (ej: números exportados como texto con apóstrofo delante → '12345).
const removeQuotes = (s: any) => (s == null ? null : String(s).replace(/['‘’]/g, ''));
// Quita comillas dobles: la recta " y las tipográficas " " (Word/Excel las autocorrigen).
// Útil cuando el CSV trae los valores entrecomillados y el parser no las saca.
const removeDoubleQuotes = (s: any) => (s == null ? null : String(s).replace(/["“”]/g, ''));
// Quita guiones. Pensada para importes que vienen con el signo negativo adelante (-1.234,56 →
// 1.234,56): el pago se carga por su valor absoluto. Contempla las variantes que mete Excel
// además del guión ASCII: hyphen ‐, en dash –, em dash — y el signo menos real −.
// Ojo: quita TODOS los guiones del valor, no solo el del principio.
const removeDashes = (s: any) => (s == null ? null : String(s).replace(/[-‐–—−]/g, ''));
const removePrefix = (s: any, prefix: string) => {
    if (s == null) return null;
    const str = String(s);
    const regex = new RegExp(`^${prefix}`, 'i'); 
    return str.replace(regex, '').trim();
};

/* ------------------------------
 * splitComma
 * ------------------------------ */
const splitComma = (value: any, index: number) => {
    if (value == null) return null;
    const s = String(value);
    const parts = s.split(',');

    if (index < 0 || index >= parts.length) return null;

    return parts[index].trim();
};

/* ------------------------------
 * mapear — traducir códigos del cedente a texto legible
 * ------------------------------ */
/**
 * Reemplaza el valor por su traducción según una tabla declarada en la propia plantilla:
 * `mapear:1=1 - Residencial|2=2 - Residencial|5=5 - Baldío`.
 *
 * Los cedentes mandan códigos de una letra o un dígito (la `Categoría` de AYSA, el `Tipo usu.`,
 * los motivos de baja) que solo ellos entienden. Traducirlos en la plantilla —y no en el código—
 * mantiene la tabla al lado del layout: si el cedente agrega una categoría se corrige sin deploy.
 *
 * Reglas:
 * - Pares separados por `|`, clave y valor por el **primer** `=` (el valor puede tener `=`).
 * - La clave se compara sin espacios y sin distinguir mayúsculas.
 * - **Lo que no está en la tabla pasa igual**, no se borra: si mañana aparece una categoría 6, el
 *   gestor ve `6` en vez de un campo vacío, que es lo que avisa que hay algo nuevo.
 * - Un valor vacío (`000=`) sí borra: sirve para los rellenos que el cedente manda como "sin dato"
 *   (`Un. Func.` viene en `000` o `00000` en el 82% de los casos de AYSA).
 */
const mapear = (input: any, tabla: string) => {
    if (input == null) return input;
    const clave = String(input).trim().toLowerCase();

    for (const par of tabla.split('|')) {
        const i = par.indexOf('=');
        if (i === -1) continue;
        if (par.slice(0, i).trim().toLowerCase() === clave) return par.slice(i + 1);
    }

    return input;
};

/* ------------------------------
 * APLICACIÓN DE TRANSFORMACIONES
 * ------------------------------ */
export function applyTransforms(raw: any, tr?: string[]) {
    if (!tr || !tr.length) return raw;

    let v: any = raw;

    for (const t of tr) {
        if (t === 'trim') v = trim(v);
        else if (t === 'upper') v = upper(v);
        else if (t === 'title') v = title(v);
        else if (t === 'removeSpaces') v = removeSpaces(v);
        else if (t === 'removeQuotes') v = removeQuotes(v);
        else if (t === 'removeDoubleQuotes') v = removeDoubleQuotes(v);
        else if (t === 'removeDashes') v = removeDashes(v);

        else if (t.startsWith('mapear:')) {
            v = mapear(v, t.substring('mapear:'.length));
        }

        else if (t.startsWith('removePrefix:')) {
            const prefix = t.substring('removePrefix:'.length);
            v = removePrefix(v, prefix);
        }

        else if (t.startsWith('splitComma')) {
            const [, idxStr] = t.split(':');
            const idx = parseInt(idxStr, 10);
            v = splitComma(v, idx);
        }

        else if (t.startsWith('toDecimal')) {
            // toDecimal:es-AR:3 -> ['toDecimal','es-AR','3']
            const dec = parseInt(t.split(':')[2], 10);
            v = toDecimalEsAR(v, Number.isFinite(dec) ? dec : 2);
        }

        else if (t.startsWith('toNumber')) {
            v = toNumberEsAR(v);
        }

        else if (t === 'toDate:excel') {
            v = toDateExcel(v);
        }

        else if (t.startsWith('toDate')) {
            v = toDateAuto(v);
        }
    }

    return v;
}