/**
 * Enmascarado de datos personales (docs/asistente-reportes-spec.md §8).
 *
 * - `forma(valor)`: lo único que el modelo ve de una celda de un archivo de ejemplo. Dígito → 9, letra → X o x, la
 *   puntuación queda. Nunca revela un valor.
 * - `enmascararCelda(path, valor)`: la vista previa de la tarjeta, que va del backend al navegador (el panel queda a la
 *   vista en reuniones y pantallas compartidas). No se guarda.
 */

const MAX_FORMA = 40;

/** La forma de un valor: `Gómez, María` → `Xxxxx, Xxxxx`; `30111222` → `99999999`. */
export function forma(valor: unknown): string {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    const chars = Array.from(texto);
    let out = '';
    for (const c of chars.slice(0, MAX_FORMA)) {
        if (/\p{Nd}/u.test(c)) out += '9';
        else if (/\p{Lu}/u.test(c)) out += 'X';
        else if (/\p{L}/u.test(c)) out += 'x';
        else if (/\s/u.test(c)) out += ' ';
        else if (/[\p{P}\p{S}]/u.test(c)) out += c;
        // Cualquier otra cosa (control, formato, marcas combinantes): no se copia.
    }
    return chars.length > MAX_FORMA ? `${out}…(+${chars.length - MAX_FORMA})` : out;
}

const soloDigitos = (v: string) => v.replace(/\D/g, '');

function enmascararDocumento(v: string): string {
    const d = soloDigitos(v);
    if (d.length === 0) return v ? '···' : '';
    return `··· ${d.slice(-4)}`;
}

function enmascararNombre(v: string): string {
    return v
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => `${Array.from(p.replace(/^[^\p{L}]+/u, ''))[0]?.toUpperCase() ?? ''}.`)
        .filter((p) => p !== '.')
        .join(' ');
}

function enmascararTelefono(v: string): string {
    const d = soloDigitos(v);
    if (d.length < 8) return d ? '····' : '';
    // Característica de 2 dígitos (11, 15…) más los últimos 4: `11 ···· 8807`. Sin el 54 ni el 9 del E.164.
    let nacional = d.startsWith('549') && d.length >= 12 ? d.slice(3) : d.startsWith('54') && d.length >= 11 ? d.slice(2) : d;
    nacional = nacional.replace(/^0/, '');
    return `${nacional.slice(0, 2)} ···· ${nacional.slice(-4)}`;
}

function enmascararEmail(v: string): string {
    const i = v.indexOf('@');
    if (i < 1) return '···';
    return `${Array.from(v)[0]}···@${v.slice(i + 1)}`;
}

function textoLargo(v: string): string {
    return v ? `(texto de ${Array.from(v).length} caracteres)` : '';
}

const RE_DOCUMENTO = /(^|\.)(documento|nroCliente)$/;
const RE_NOMBRE = /(^|\.)(nombre|apellido)$/;
const RE_EMAIL = /(^|\.)(email|destinatarios)$/;
const RE_TEXTO = /(^|\.)(texto|observacion|observaciones|notas|detalle|asunto|direccion)$/;
// `empresa.nombre`, `remesa.nombre`, `politica.nombre`, etc. son del sistema, no personas.
const NOMBRES_DE_PERSONAS = /^(nombre|apellido|.*\.usuario\.nombre|.*\.usuario\.apellido|.*usuarioCreador\.nombre)$/;

const RE_DELIMITADOR = /(\s*[,;|]\s*|\s{2,}|\n)/;

/**
 * Aplica `f` a cada elemento de una celda que concatenó varios valores (`cardinalidad: concatenar`), respetando los
 * separadores. Con el `separadorConcat` real de la columna se parte por ese; sin él, por coma, punto y coma, barra
 * vertical, doble espacio o salto de línea.
 */
function porElemento(v: string, f: (x: string) => string, separador?: string): string {
    if (separador !== undefined && separador !== '') {
        return v.split(separador).map((x) => (x.trim() === '' ? x : f(x.trim()))).join(separador);
    }
    return v
        .split(RE_DELIMITADOR)
        .map((trozo, i) => (i % 2 === 1 || trozo.trim() === '' ? trozo : f(trozo.trim())))
        .join('');
}

const RE_MAIL_SUELTO = /[^\s,;|<>()"']+@[^\s,;|<>()"']+/g;
const RE_TEL_SUELTO = /(?<![\d.,])\+?\d[\d ().-]{6,}\d(?![\d])/g;
const RE_NUMERO_LARGO = /\d{9,}/g;

/**
 * Última red: cualquier mail, teléfono o número largo que quede en cualquier lugar de la celda, aunque la columna no
 * parezca de datos personales ni el separador sea otro.
 */
function barrer(v: string): string {
    return v
        .replace(RE_MAIL_SUELTO, (m) => enmascararEmail(m))
        .replace(RE_TEL_SUELTO, (m) => (soloDigitos(m).length >= 8 && !m.includes('·') ? enmascararTelefono(m) : m))
        .replace(RE_NUMERO_LARGO, (m) => `··· ${m.slice(-4)}`);
}

/**
 * Qué se muestra de una celda de la vista previa. `path` es el de la columna (con sus modificadores); `tipo` es el tipo
 * de la columna, si lo declaró. Lo que no es un dato de una persona (importes, fechas, códigos, estados, empresa,
 * remesa) sale tal cual.
 */
export function enmascararCelda(path: string, valor: unknown, tipo?: string, separador?: string): string {
    if (valor === null || valor === undefined || valor === '') return '';
    const v = String(valor);
    const r = enmascararPorColumna(path, v, tipo, separador);
    // Un importe o una fecha con puntos y comas no es un dato personal: solo se barre lo que tiene letras, @ o más de una palabra.
    return /^[\d\s.,:/+-]*$/.test(r) && !/\d{8,}/.test(r.replace(/[.,\s]/g, '')) ? r : barrer(r);
}

function enmascararPorColumna(path: string, v: string, tipo?: string, separador?: string): string {
    const limpio = path.replace(/\[[^\]]*\]/g, '');
    const tel = tipo === 'telefono' || /tipo=telefono/.test(path) || /(^|\.)(telefono|telefonos)$/.test(limpio);
    const mail = /tipo=email/.test(path);
    const dir = /tipo=direccion/.test(path);

    if (limpio.startsWith('camposAdicionales')) return porElemento(v, forma, separador);
    if (tel) return porElemento(v, enmascararTelefono, separador);
    if (mail || RE_EMAIL.test(limpio)) return porElemento(v, enmascararEmail, separador);
    if (dir || RE_TEXTO.test(limpio)) return textoLargo(v);
    if (RE_DOCUMENTO.test(limpio)) return porElemento(v, enmascararDocumento, separador);
    if (NOMBRES_DE_PERSONAS.test(limpio) || (RE_NOMBRE.test(limpio) && !/^(empresa|remesa|politica|remesa\.politica)\./.test(limpio))) {
        return porElemento(v, enmascararNombre, separador);
    }
    // `contactos.valor` sin filtrar por tipo mezcla teléfonos, mails y domicilios: se decide por la forma del valor.
    if (/(^|\.)valor$/.test(limpio) && /^contactos/.test(limpio)) {
        return porElemento(
            v,
            (x) => {
                if (x.includes('@')) return enmascararEmail(x);
                if (/^[+\d][\d\s()\-.]{7,}$/.test(x)) return enmascararTelefono(x);
                return textoLargo(x);
            },
            separador,
        );
    }
    return v;
}
