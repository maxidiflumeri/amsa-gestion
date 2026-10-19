import * as XLSX from 'xlsx';
import { inferirColumnasAnchoFijo } from '../../imports/utils/ancho-fijo';
import { forma } from '../reportes/enmascarar';

/**
 * El perfil de un archivo de ejemplo (docs/asistente-reportes-spec.md §8.2 y §9): lo único que el asistente guarda y le
 * muestra al modelo. Encabezados, nombres de hoja, tipos, formatos, vacíos y la FORMA de unos pocos valores. Nunca un
 * valor, salvo los que coinciden exactamente con un vocabulario cerrado del sistema (empresas, códigos).
 *
 * Todo lo de este archivo es puro y sincrónico: corre dentro de un `worker_thread` con límites (el parser de SheetJS
 * se expone a archivos de afuera) y los tests lo llaman directo.
 */

export type TipoArchivo = 'xlsx' | 'xls' | 'csv' | 'txt';
export type TipoColumna = 'texto' | 'número' | 'fecha' | 'vacío' | 'mezcla';

export interface ColumnaPerfil {
    n: number;
    /** ≤ 80 caracteres, sin caracteres de control. null = sin encabezado. */
    encabezado: string | null;
    tipo: TipoColumna;
    /** "DD/MM/YYYY", "entero, 8 dígitos", "2 decimales, coma decimal, punto de miles", "email", "ceros a la izquierda, 11 dígitos". */
    formato: string | null;
    /** El código de formato de la celda de Excel: "#,##0.00", "dd/mm/yyyy". */
    formatoExcel: string | null;
    vacias: number;
    total: number;
    /** ≤ 3, distintas entre sí. */
    formas: string[];
    /** ≤ 5. Valores del vocabulario del sistema (no de la celda) con el campo al que pertenecen. */
    reconocidos: { valor: string; campo: string }[];
    /** Largo mínimo y máximo de los valores de texto. */
    largo?: { min: number; max: number };
    anchoFijo?: { inicio: number; largo: number; alineacion: 'izquierda' | 'derecha'; relleno: ' ' | '0' };
}

export interface HojaPerfil {
    nombre: string | null;
    filasLeidas: number;
    filasTotales: number | null;
    conEncabezado: boolean;
    /** Hasta 60. */
    columnas: ColumnaPerfil[];
    /** Las mismas columnas tomando la primera fila como datos: `PATCH primeraFilaEsEncabezado=false` sin releer el archivo. */
    sinEncabezado?: ColumnaPerfil[];
    /** Cuántas columnas tenía la hoja (si se recortó a 60). */
    columnasTotales?: number;
}

export interface TextoPerfil {
    encoding: 'utf8' | 'latin1';
    bom: boolean;
    finDeLinea: 'CRLF' | 'LF';
    /** ';' | ',' | 'TAB' | '|' | null */
    separador: string | null;
    anchoFijo: { columnas: { inicio: number; largo: number }[]; anchoLinea: number; mapaClases: string } | null;
}

export interface PerfilEjemplo {
    archivo: string;
    tipo: TipoArchivo;
    bytes: number;
    texto?: TextoPerfil;
    /** Hasta 5; en CSV/TXT una sola, con nombre null. */
    hojas: HojaPerfil[];
    /** Índice de la hoja con más celdas llenas. */
    hojaUsada: number;
}

/** Valor reconocido: clave = el texto normalizado (sin acentos ni mayúsculas); valor = el del vocabulario y su campo. */
export type MapaReconocibles = Record<string, { valor: string; campo: string }>;

export type CodigoErrorPerfil =
    | 'TIPO_NO_SOPORTADO'
    | 'NO_COINCIDE_EXTENSION'
    | 'VACIO'
    | 'ILEGIBLE'
    | 'ENCRIPTADO'
    | 'SIN_COLUMNAS'
    | 'OCUPADO';

export class ErrorPerfil extends Error {
    constructor(
        public readonly codigo: CodigoErrorPerfil,
        mensaje: string,
    ) {
        super(mensaje);
        this.name = 'ErrorPerfil';
    }
}

export const LIMITES = {
    filas: 200,
    columnas: 60,
    hojas: 5,
    celda: 200,
    /** Descompresión máxima de un .xlsx: protege de un zip armado para ocupar memoria. */
    zipDescomprimidoMax: 40 * 1024 * 1024,
    formas: 3,
    reconocidos: 5,
} as const;

export const normalizar = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();

// ---------------------------------------------------------------------------------------------------------------------
// Tipo real por los primeros bytes
// ---------------------------------------------------------------------------------------------------------------------

type TipoReal = 'zip' | 'ole2' | 'pdf' | 'imagen' | 'texto' | 'binario';

const MAGIC_OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** El tipo real del archivo. No mira la extensión. */
export function tipoReal(b: Buffer): TipoReal {
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return 'zip';
    if (b.length >= 8 && b.subarray(0, 8).equals(MAGIC_OLE2)) return 'ole2';
    if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'imagen';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'imagen';
    if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'imagen';
    if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'imagen';
    // UTF-16 con BOM: texto (Excel "Texto Unicode").
    if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return 'texto';
    return b.subarray(0, 8192).includes(0) ? 'binario' : 'texto';
}

export interface EntradaZip {
    nombre: string;
    tamano: number;
}

/** Los nombres y tamaños descomprimidos del directorio central de un zip. null si no se puede leer. */
export function directorioZip(b: Buffer): EntradaZip[] | null {
    const desde = Math.max(0, b.length - 22 - 65535);
    let eocd = -1;
    for (let i = b.length - 22; i >= desde; i--) {
        if (b.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) return null;
    const cantidad = b.readUInt16LE(eocd + 10);
    let pos = b.readUInt32LE(eocd + 16);
    const out: EntradaZip[] = [];
    for (let k = 0; k < cantidad; k++) {
        if (pos + 46 > b.length || b.readUInt32LE(pos) !== 0x02014b50) return null;
        const tamano = b.readUInt32LE(pos + 24);
        const largoNombre = b.readUInt16LE(pos + 28);
        const extra = b.readUInt16LE(pos + 30);
        const comentario = b.readUInt16LE(pos + 32);
        if (pos + 46 + largoNombre > b.length) return null;
        out.push({ nombre: b.subarray(pos + 46, pos + 46 + largoNombre).toString('utf8'), tamano });
        pos += 46 + largoNombre + extra + comentario;
    }
    return out;
}

const EXTENSIONES = ['xlsx', 'xls', 'csv', 'txt', 'tsv'] as const;

export function extensionDe(nombre: string): string {
    const m = /\.([A-Za-z0-9]+)$/.exec(nombre.trim());
    return m ? m[1].toLowerCase() : '';
}

/**
 * Qué es el archivo, por sus bytes, y si coincide con su extensión. Lanza `ErrorPerfil` con el motivo que ve la persona.
 * No lee el contenido (eso lo hace `perfilarArchivo`).
 */
export function detectarTipo(buffer: Buffer, nombre: string): { tipo: TipoArchivo; real: TipoReal } {
    if (buffer.length === 0) throw new ErrorPerfil('VACIO', 'El archivo está vacío.');
    const ext = extensionDe(nombre);
    const real = tipoReal(buffer);

    if (ext === 'xlsm' || ext === 'xlsb') {
        throw new ErrorPerfil('TIPO_NO_SOPORTADO', `No leo archivos .${ext}: guardalo como .xlsx y volvé a subirlo.`);
    }
    if (!(EXTENSIONES as readonly string[]).includes(ext)) {
        throw new ErrorPerfil('TIPO_NO_SOPORTADO', 'Solo leo archivos de Excel (.xlsx, .xls) y de texto (.csv, .txt, .tsv).');
    }
    if (real === 'pdf' || real === 'imagen' || real === 'binario') {
        throw new ErrorPerfil('TIPO_NO_SOPORTADO', 'Ese archivo no es de Excel ni de texto. Por ahora no leo PDF ni imágenes.');
    }

    if (real === 'zip') {
        const dir = directorioZip(buffer);
        if (dir === null) throw new ErrorPerfil('ILEGIBLE', 'No pude leer el archivo: parece dañado.');
        const total = dir.reduce((a, e) => a + e.tamano, 0);
        if (total > LIMITES.zipDescomprimidoMax) {
            throw new ErrorPerfil('ILEGIBLE', 'El archivo descomprimido es demasiado grande para leerlo.');
        }
        const nombres = dir.map((e) => e.nombre);
        if (nombres.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) {
            throw new ErrorPerfil('TIPO_NO_SOPORTADO', 'El archivo tiene macros: guardalo como .xlsx (sin macros) y volvé a subirlo.');
        }
        if (nombres.some((n) => /^xl\/workbook\.bin$/i.test(n))) {
            throw new ErrorPerfil('TIPO_NO_SOPORTADO', 'No leo archivos .xlsb: guardalo como .xlsx y volvé a subirlo.');
        }
        if (!nombres.includes('[Content_Types].xml') || !nombres.some((n) => /^xl\/workbook\.xml$/i.test(n))) {
            throw new ErrorPerfil('TIPO_NO_SOPORTADO', 'Ese archivo no es una planilla de Excel.');
        }
        if (ext !== 'xlsx') throw new ErrorPerfil('NO_COINCIDE_EXTENSION', `El archivo es un .xlsx pero se llama «.${ext}». Cambiale la extensión.`);
        return { tipo: 'xlsx', real };
    }
    if (real === 'ole2') {
        // Un .xlsx con contraseña también es OLE2: se lo distingue al leerlo.
        if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
            throw new ErrorPerfil('NO_COINCIDE_EXTENSION', `El archivo es de Excel pero se llama «.${ext}». Cambiale la extensión.`);
        }
        // Un .xlsx con contraseña también es OLE2 (se lo distingue al leerlo); un .xls con nombre .xlsx da NO_COINCIDE_EXTENSION.
        return { tipo: ext === 'xlsx' ? 'xlsx' : 'xls', real };
    }
    // Texto
    if (ext === 'xlsx' || ext === 'xls') {
        throw new ErrorPerfil('NO_COINCIDE_EXTENSION', `El archivo es de texto pero se llama «.${ext}». Cambiale la extensión.`);
    }
    return { tipo: ext === 'csv' ? 'csv' : 'txt', real };
}

// ---------------------------------------------------------------------------------------------------------------------
// Celdas y columnas
// ---------------------------------------------------------------------------------------------------------------------

type Celda =
    | { t: 'vacio' }
    | { t: 'texto'; s: string }
    | { t: 'num'; n: number; z?: string }
    | { t: 'fecha'; d: Date; z?: string }
    | { t: 'bool' };

const VACIA: Celda = { t: 'vacio' };

/** Sin caracteres de control ni `<` `>` (el texto va dentro de un bloque `<ejemplo>`), recortado. */
export function limpiarTexto(s: string, max: number = LIMITES.celda): string {
    const sinControl = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff<>]/g, ' ');
    return Array.from(sinControl.replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

function celdaDeTexto(raw: string): Celda {
    const s = limpiarTexto(raw);
    return s === '' ? VACIA : { t: 'texto', s };
}

const RE_ENTERO = /^-?\d+$/;
const RE_ENTERO_MILES_PUNTO = /^-?\d{1,3}(\.\d{3})+$/;
const RE_DEC_COMA = /^-?(\d{1,3}(\.\d{3})+|\d+),\d+$/;
const RE_DEC_PUNTO = /^-?(\d{1,3}(,\d{3})+|\d+)\.\d+$/;
const RE_FECHA_BARRA = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/;
const RE_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
const RE_FECHA_COMPACTA = /^(\d{4})(\d{2})(\d{2})$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_ENCABEZADO_NUMERICO = /dni|doc|cuit|cuil|tel|nro|numero|número|cuenta|cliente|legajo|id$/i;

type Clase =
    | { c: 'entero'; digitos: number; ceros: boolean }
    | { c: 'entero-miles'; digitos: number }
    | { c: 'dec-coma'; decimales: number; miles: boolean }
    | { c: 'dec-punto'; decimales: number; miles: boolean }
    | { c: 'fecha-barra'; a: number; b: number; anio4: boolean }
    | { c: 'fecha-iso' }
    | { c: 'fecha-compacta'; plausible: boolean }
    | { c: 'email' }
    | { c: 'texto'; largo: number };

function claseDeTexto(s: string): Clase {
    let m: RegExpExecArray | null;
    if ((m = RE_FECHA_BARRA.exec(s))) return { c: 'fecha-barra', a: Number(m[1]), b: Number(m[2]), anio4: m[3].length === 4 };
    if ((m = RE_FECHA_ISO.exec(s))) {
        if (Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return { c: 'fecha-iso' };
    }
    if (RE_EMAIL.test(s)) return { c: 'email' };
    if (RE_ENTERO.test(s)) {
        const digitos = s.replace('-', '').length;
        if ((m = RE_FECHA_COMPACTA.exec(s))) {
            const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
            if (anio >= 1900 && anio <= 2100 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) return { c: 'fecha-compacta', plausible: true };
        }
        return { c: 'entero', digitos, ceros: s.replace('-', '').length > 1 && s.replace('-', '').startsWith('0') };
    }
    if (RE_ENTERO_MILES_PUNTO.test(s)) return { c: 'entero-miles', digitos: s.replace(/\D/g, '').length };
    if (RE_DEC_COMA.test(s)) return { c: 'dec-coma', decimales: s.split(',')[1].length, miles: s.includes('.') };
    if (RE_DEC_PUNTO.test(s)) return { c: 'dec-punto', decimales: s.split('.').pop()!.length, miles: s.includes(',') };
    return { c: 'texto', largo: Array.from(s).length };
}

/** El código `z` de una celda de fecha de Excel → tokens de dayjs. */
export function formatoFechaDeExcel(z: string | undefined): string {
    if (!z) return 'DD/MM/YYYY';
    // El formato 14 (fecha corta del sistema) lo guarda SheetJS como m/d/yy sin importar la configuración regional:
    // en Argentina se ve día/mes/año.
    if (/^(m\/d\/yy|mm-dd-yy|mm\/dd\/yy)$/i.test(z)) return 'DD/MM/YYYY';
    const limpio = z.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
    const lower = limpio.toLowerCase();
    const trozos = lower.match(/yyyy|yy|mmmm|mmm|mm|m|dd|d|hh|h|ss|s|[^a-z]+/g) ?? [];
    let out = '';
    trozos.forEach((t, i) => {
        const antes = trozos.slice(0, i).reverse().find((x) => /^[a-z]/.test(x));
        const despues = trozos.slice(i + 1).find((x) => /^[a-z]/.test(x));
        switch (t) {
            case 'yyyy':
                out += 'YYYY';
                break;
            case 'yy':
                out += 'YY';
                break;
            case 'mmmm':
            case 'mmm':
            case 'mm':
            case 'm': {
                const esMinuto = (antes && /^h/.test(antes)) || (despues && /^s/.test(despues));
                out += esMinuto ? 'mm' : 'MM';
                break;
            }
            case 'dd':
            case 'd':
                out += 'DD';
                break;
            case 'hh':
            case 'h':
                out += 'HH';
                break;
            case 'ss':
            case 's':
                out += 'ss';
                break;
            default:
                out += /^[a-z]/.test(t) ? '' : t;
        }
    });
    return out.trim() || 'DD/MM/YYYY';
}

/** Decimales, separador de miles y símbolo de un código de número de Excel. */
export function formatoNumeroDeExcel(z: string | undefined): { decimales: number | null; miles: boolean; moneda: boolean; porcentaje: boolean } {
    if (!z || /^general$/i.test(z)) return { decimales: null, miles: false, moneda: false, porcentaje: false };
    const primera = z.split(';')[0];
    // El símbolo puede ir entre comillas (`"$" #,##0.00`) o dentro de un corchete (`[$$-2C0A]`).
    const moneda = primera.includes('$');
    const seccion = primera.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
    const punto = seccion.indexOf('.');
    let decimales = 0;
    if (punto >= 0) {
        const m = /^[0#?]+/.exec(seccion.slice(punto + 1));
        decimales = m ? m[0].length : 0;
    }
    return { decimales, miles: seccion.includes(','), moneda, porcentaje: seccion.includes('%') };
}

interface ResumenColumna {
    tipo: TipoColumna;
    formato: string | null;
    formatoExcel: string | null;
    largo?: { min: number; max: number };
    conFormas: boolean;
}

function plural(n: number, uno: string, varios: string): string {
    return `${n} ${n === 1 ? uno : varios}`;
}

/** Tipo y formato de una columna a partir de sus celdas no vacías. */
function resumirColumna(celdas: Celda[], encabezado: string | null): ResumenColumna {
    const llenas = celdas.filter((c) => c.t !== 'vacio');
    if (llenas.length === 0) return { tipo: 'vacío', formato: null, formatoExcel: null, conFormas: false };

    const nums = llenas.filter((c): c is Extract<Celda, { t: 'num' }> => c.t === 'num');
    const fechas = llenas.filter((c): c is Extract<Celda, { t: 'fecha' }> => c.t === 'fecha');
    const textos = llenas.filter((c): c is Extract<Celda, { t: 'texto' }> => c.t === 'texto');
    const bools = llenas.filter((c) => c.t === 'bool');

    if (fechas.length === llenas.length) {
        const z = fechas.find((f) => f.z)?.z;
        return { tipo: 'fecha', formato: `${formatoFechaDeExcel(z ? formatoExcelSinLiterales(z) : z)}`, formatoExcel: z ? formatoExcelSinLiterales(z) : null, conFormas: false };
    }
    if (bools.length === llenas.length) return { tipo: 'texto', formato: 'sí/no', formatoExcel: null, conFormas: false };

    if (nums.length === llenas.length) {
        const z = nums.find((n) => n.z && !/^general$/i.test(n.z))?.z;
        const f = formatoNumeroDeExcel(z);
        const enteros = nums.every((n) => Number.isInteger(n.n));
        const digitos = nums.map((n) => String(Math.abs(Math.trunc(n.n))).length);
        const min = Math.min(...digitos);
        const max = Math.max(...digitos);
        const partes: string[] = [];
        if (f.porcentaje) partes.push('porcentaje');
        else if (f.decimales !== null) partes.push(f.decimales === 0 ? 'entero' : plural(f.decimales, 'decimal', 'decimales'));
        else if (enteros) partes.push('entero');
        else partes.push('con decimales');
        if (f.miles) partes.push('con separador de miles');
        if (f.moneda) partes.push('con símbolo de moneda');
        if (enteros && f.decimales === null && !f.miles) partes.push(min === max ? `${plural(min, 'dígito', 'dígitos')}` : `${min}–${max} dígitos`);
        return { tipo: 'número', formato: partes.join(', '), formatoExcel: z ? formatoExcelSinLiterales(z) : null, conFormas: enteros && f.decimales === null && !f.miles };
    }

    // Texto (o texto que parece otra cosa): se clasifica el contenido.
    const clases = textos.map((t) => claseDeTexto(t.s));
    if (nums.length === 0 && fechas.length === 0) {
        const todas = (c: Clase['c']) => clases.every((x) => x.c === c);
        const sinPistaNumerica = !encabezado || !RE_ENCABEZADO_NUMERICO.test(encabezado);

        if (todas('fecha-iso')) return { tipo: 'fecha', formato: 'YYYY-MM-DD', formatoExcel: null, conFormas: false };
        if (todas('fecha-compacta') && sinPistaNumerica) return { tipo: 'fecha', formato: 'YYYYMMDD', formatoExcel: null, conFormas: false };
        if (todas('fecha-barra')) {
            const f = clases as Extract<Clase, { c: 'fecha-barra' }>[];
            // Si algún primer número pasa de 12 es día/mes; si algún segundo pasa de 12, mes/día; si no, día/mes (Argentina).
            const mesDia = f.some((x) => x.b > 12) && !f.some((x) => x.a > 12);
            const anio = f.every((x) => x.anio4) ? 'YYYY' : 'YY';
            return { tipo: 'fecha', formato: mesDia ? `MM/DD/${anio}` : `DD/MM/${anio}`, formatoExcel: null, conFormas: false };
        }
        if (todas('email')) return { tipo: 'texto', formato: 'email', formatoExcel: null, conFormas: true };
        if (todas('entero') || todas('fecha-compacta')) {
            const e = clases.map((x) => (x.c === 'entero' ? x : { c: 'entero' as const, digitos: 8, ceros: false }));
            const con0 = e.some((x) => x.ceros);
            const digs = e.map((x) => x.digitos);
            const min = Math.min(...digs);
            const max = Math.max(...digs);
            const largo = min === max ? plural(min, 'dígito', 'dígitos') : `${min}–${max} dígitos`;
            if (con0) return { tipo: 'texto', formato: `ceros a la izquierda, ${largo}`, formatoExcel: null, conFormas: true };
            return { tipo: 'número', formato: `entero, ${largo}`, formatoExcel: null, conFormas: true };
        }
        if (todas('entero-miles')) return { tipo: 'número', formato: 'entero, con punto de miles', formatoExcel: null, conFormas: false };
        if (todas('dec-coma')) {
            const d = clases as Extract<Clase, { c: 'dec-coma' }>[];
            const dec = Math.max(...d.map((x) => x.decimales));
            return {
                tipo: 'número',
                formato: `${plural(dec, 'decimal', 'decimales')}, coma decimal${d.some((x) => x.miles) ? ', punto de miles' : ''}`,
                formatoExcel: null,
                conFormas: false,
            };
        }
        if (todas('dec-punto')) {
            const d = clases as Extract<Clase, { c: 'dec-punto' }>[];
            const dec = Math.max(...d.map((x) => x.decimales));
            return {
                tipo: 'número',
                formato: `${plural(dec, 'decimal', 'decimales')}, punto decimal${d.some((x) => x.miles) ? ', coma de miles' : ''}`,
                formatoExcel: null,
                conFormas: false,
            };
        }
        const largos = textos.map((t) => Array.from(t.s).length);
        return { tipo: 'texto', formato: null, formatoExcel: null, largo: { min: Math.min(...largos), max: Math.max(...largos) }, conFormas: true };
    }

    return { tipo: 'mezcla', formato: null, formatoExcel: null, conFormas: true };
}

function textoDeCelda(c: Celda): string {
    switch (c.t) {
        case 'texto':
            return c.s;
        case 'num':
            return String(c.n);
        default:
            return '';
    }
}

/** Hasta 3 formas distintas entre sí, en orden de aparición. */
function formasDe(celdas: Celda[]): string[] {
    const vistas: string[] = [];
    for (const c of celdas) {
        const t = textoDeCelda(c);
        if (t === '') continue;
        const f = forma(t);
        if (!vistas.includes(f)) vistas.push(f);
        if (vistas.length >= LIMITES.formas) break;
    }
    return vistas;
}

function reconocidosDe(celdas: Celda[], mapa: MapaReconocibles): { valor: string; campo: string }[] {
    const out: { valor: string; campo: string }[] = [];
    for (const c of celdas) {
        if (c.t !== 'texto' || c.s.length < 3) continue;
        const r = mapa[normalizar(c.s)];
        if (r && !out.some((o) => o.valor === r.valor && o.campo === r.campo)) out.push(r);
        if (out.length >= LIMITES.reconocidos) break;
    }
    return out;
}

function perfilarColumna(n: number, encabezado: string | null, celdas: Celda[], mapa: MapaReconocibles): ColumnaPerfil {
    const r = resumirColumna(celdas, encabezado);
    const vacias = celdas.filter((c) => c.t === 'vacio').length;
    const col: ColumnaPerfil = {
        n,
        encabezado,
        tipo: r.tipo,
        formato: r.formato,
        formatoExcel: r.formatoExcel,
        vacias,
        total: celdas.length,
        formas: r.conFormas ? formasDe(celdas) : [],
        reconocidos: reconocidosDe(celdas, mapa),
    };
    if (r.largo) col.largo = r.largo;
    return col;
}

/**
 * ¿Este texto PARECE un encabezado? Un encabezado es texto corto, sin @, sin una cantidad de dígitos que lo haga un
 * documento, teléfono, CUIT, cuenta o importe, y que no tenga forma de dato (número, fecha, mail). Lo que no cumple nunca
 * sale literal: ni se toma como encabezado ni se le muestra al modelo.
 */
export function pareceEncabezado(texto: string): boolean {
    const t = texto.trim();
    if (t === '' || Array.from(t).length > 60) return false;
    if (t.includes('@')) return false;
    if (/\d{5,}/.test(t)) return false;
    if ((t.match(/\d/g) ?? []).length > 4) return false;
    return claseDeTexto(t).c === 'texto';
}

/** El encabezado como puede salir del backend: tal cual si parece encabezado y, si no, su forma (9 = dígito, X/x = letra). */
export function encabezadoSeguro(texto: string | null): string | null {
    if (texto === null) return null;
    return pareceEncabezado(texto) ? texto : forma(texto);
}

/**
 * ¿La primera fila es el encabezado? Sí si no hay más filas (un layout con solo encabezados: el caso típico de "el
 * cedente nos pide este formato"), o si al menos el 80 % de sus celdas llenas son texto no numérico, son únicas y al
 * menos una columna de abajo tiene otro tipo. Ante la duda, NO: un falso encabezado mandaría una fila de datos literal.
 */
export function primeraFilaEsEncabezado(filas: Celda[][]): boolean {
    if (filas.length === 0) return false;
    const primera = filas[0];
    const llenas = primera.filter((c) => c.t !== 'vacio');
    if (llenas.length === 0) return false;
    // Una celda que no parece encabezado (un número, un DNI, un mail, un nombre con un teléfono) descarta la fila entera.
    if (!llenas.every((c) => c.t === 'texto' && pareceEncabezado(c.s))) return false;
    if (filas.length === 1) return true;

    const textuales = llenas.filter((c) => c.t === 'texto' && claseDeTexto(c.s).c === 'texto');
    if (textuales.length / llenas.length < 0.8) return false;
    const unicas = new Set(textuales.map((c) => normalizar((c as { s: string }).s)));
    if (unicas.size !== textuales.length) return false;

    const resto = filas.slice(1);
    return primera.some((c, i) => {
        if (c.t !== 'texto') return false;
        const abajo = resto.map((f) => f[i] ?? VACIA).filter((x) => x.t !== 'vacio');
        if (abajo.length === 0) return false;
        const r = resumirColumna(abajo, null);
        return r.tipo === 'número' || r.tipo === 'fecha';
    });
}

function hojaDeFilas(
    nombre: string | null,
    filas: Celda[][],
    filasTotales: number | null,
    mapa: MapaReconocibles,
    avisos: string[],
): HojaPerfil {
    const anchoTotal = filas.reduce((m, f) => Math.max(m, f.length), 0);
    const ancho = Math.min(anchoTotal, LIMITES.columnas);
    if (anchoTotal > LIMITES.columnas) avisos.push(`Se leyeron las primeras ${LIMITES.columnas} columnas de ${anchoTotal}.`);
    const recortadas = filas.map((f) => Array.from({ length: ancho }, (_, i) => f[i] ?? VACIA));

    const conEncabezado = primeraFilaEsEncabezado(recortadas);
    const encab = (c: Celda): string | null => (c.t === 'texto' ? encabezadoSeguro(limpiarTexto(c.s, 80)) || null : null);
    const columnasCon = (conEnc: boolean): ColumnaPerfil[] =>
        Array.from({ length: ancho }, (_, i) => {
            const datos = (conEnc ? recortadas.slice(1) : recortadas).map((f) => f[i]);
            return perfilarColumna(i + 1, conEnc ? encab(recortadas[0][i]) : null, datos, mapa);
        });

    const hoja: HojaPerfil = {
        nombre,
        filasLeidas: recortadas.length,
        filasTotales,
        conEncabezado,
        columnas: columnasCon(conEncabezado),
    };
    if (conEncabezado) hoja.sinEncabezado = columnasCon(false);
    if (anchoTotal > LIMITES.columnas) hoja.columnasTotales = anchoTotal;
    return hoja;
}

// ---------------------------------------------------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------------------------------------------------

function celdaDeExcel(c: XLSX.CellObject | undefined): Celda {
    if (!c || c.v === undefined || c.v === null) return VACIA;
    switch (c.t) {
        case 'n':
            return Number.isFinite(c.v as number) ? { t: 'num', n: c.v as number, z: typeof c.z === 'string' ? c.z : undefined } : VACIA;
        case 'd':
            return c.v instanceof Date && !Number.isNaN(c.v.getTime()) ? { t: 'fecha', d: c.v, z: typeof c.z === 'string' ? c.z : undefined } : VACIA;
        case 'b':
            return { t: 'bool' };
        case 's':
            return celdaDeTexto(String(c.v));
        default:
            return VACIA;
    }
}

function leerExcel(buffer: Buffer, nombre: string, tipo: 'xlsx' | 'xls', mapa: MapaReconocibles): PerfilEjemplo {
    let wb: XLSX.WorkBook;
    try {
        wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: true, sheetRows: LIMITES.filas + 1, bookVBA: false });
    } catch (e: any) {
        if (/password|encrypt/i.test(String(e?.message))) {
            throw new ErrorPerfil('ENCRIPTADO', 'El archivo tiene contraseña. Guardalo sin contraseña y volvé a subirlo.');
        }
        throw new ErrorPerfil('ILEGIBLE', 'No pude leer el archivo: parece dañado o no es de Excel.');
    }
    if (tipo === 'xlsx' && buffer.subarray(0, 8).equals(MAGIC_OLE2)) {
        throw new ErrorPerfil('NO_COINCIDE_EXTENSION', 'El archivo es un .xls pero se llama «.xlsx». Cambiale la extensión.');
    }
    const nombres = wb.SheetNames;
    if (nombres.length === 0) throw new ErrorPerfil('VACIO', 'El archivo no tiene hojas.');

    const avisos: string[] = [];
    const hojas: HojaPerfil[] = [];
    const llenasPorHoja: number[] = [];
    for (const nombreHoja of nombres.slice(0, LIMITES.hojas)) {
        const ws = wb.Sheets[nombreHoja];
        const filas: Celda[][] = [];
        let llenas = 0;
        let filasTotales: number | null = null;
        if (ws && ws['!ref']) {
            const rango = XLSX.utils.decode_range(ws['!ref']);
            if (ws['!fullref']) filasTotales = XLSX.utils.decode_range(ws['!fullref']).e.r + 1;
            else filasTotales = rango.e.r + 1;
            for (let r = rango.s.r; r <= Math.min(rango.e.r, rango.s.r + LIMITES.filas); r++) {
                const fila: Celda[] = [];
                for (let c = rango.s.c; c <= rango.e.c; c++) {
                    const celda = celdaDeExcel(ws[XLSX.utils.encode_cell({ r, c })]);
                    if (celda.t !== 'vacio') llenas++;
                    fila.push(celda);
                }
                filas.push(fila);
            }
        }
        // Las filas finales sin nada no cuentan.
        while (filas.length > 0 && filas[filas.length - 1].every((c) => c.t === 'vacio')) filas.pop();
        llenasPorHoja.push(llenas);
        const avisosHoja: string[] = [];
        if (filas.length > 0) {
            const hoja = hojaDeFilas(encabezadoSeguro(limpiarTexto(nombreHoja, 80)) || 'Hoja', filas, filasTotales, mapa, avisosHoja);
            hojas.push(hoja);
            if (filasTotales !== null && filasTotales > filas.length && filasTotales > LIMITES.filas + 1) {
                avisos.push(`De la hoja «${hoja.nombre}» se leyeron las primeras ${LIMITES.filas} filas de ${filasTotales - 1}.`);
            }
            avisos.push(...avisosHoja);
        } else {
            hojas.push({ nombre: encabezadoSeguro(limpiarTexto(nombreHoja, 80)) || 'Hoja', filasLeidas: 0, filasTotales: 0, conEncabezado: false, columnas: [] });
        }
    }
    if (nombres.length > LIMITES.hojas) {
        avisos.push(`El archivo tiene ${nombres.length - LIMITES.hojas} hojas más que no se leyeron.`);
    }
    if (hojas.every((h) => h.columnas.length === 0)) {
        throw new ErrorPerfil('SIN_COLUMNAS', 'El archivo no tiene ninguna celda con datos.');
    }
    const hojaUsada = llenasPorHoja.indexOf(Math.max(...llenasPorHoja));
    const perfil: PerfilEjemplo = { archivo: limpiarTexto(nombre, LIMITES.celda), tipo, bytes: buffer.length, hojas, hojaUsada };
    (perfil as PerfilConAvisos).avisos = avisos;
    return perfil;
}

export interface PerfilConAvisos extends PerfilEjemplo {
    /** En castellano, para el chip. No se le mandan al modelo. */
    avisos?: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Texto (CSV, TXT, ancho fijo)
// ---------------------------------------------------------------------------------------------------------------------

interface TextoDecodificado {
    texto: string;
    encoding: 'utf8' | 'latin1';
    bom: boolean;
}

function decodificar(buffer: Buffer): TextoDecodificado {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return { texto: buffer.subarray(2).toString('utf16le'), encoding: 'utf8', bom: true };
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        const be = Buffer.from(buffer.subarray(2));
        be.swap16();
        return { texto: be.toString('utf16le'), encoding: 'utf8', bom: true };
    }
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return { texto: buffer.subarray(3).toString('utf8'), encoding: 'utf8', bom: true };
    }
    try {
        return { texto: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf8', bom: false };
    } catch {
        return { texto: buffer.toString('latin1'), encoding: 'latin1', bom: false };
    }
}

const SEPARADORES: { char: string; nombre: string }[] = [
    { char: ';', nombre: ';' },
    { char: '\t', nombre: 'TAB' },
    { char: '|', nombre: '|' },
    { char: ',', nombre: ',' },
];

function contarFuera(linea: string, sep: string): number {
    let dentro = false;
    let n = 0;
    for (const c of linea) {
        if (c === '"') dentro = !dentro;
        else if (c === sep && !dentro) n++;
    }
    return n;
}

function detectarSeparador(lineas: string[]): { char: string; nombre: string } | null {
    const muestra = lineas.filter((l) => l.trim() !== '').slice(0, 20);
    if (muestra.length === 0) return null;
    let mejor: { char: string; nombre: string; puntaje: number } | null = null;
    for (const s of SEPARADORES) {
        const cuentas = muestra.map((l) => contarFuera(l, s.char));
        const moda = [...cuentas].sort((a, b) => cuentas.filter((x) => x === b).length - cuentas.filter((x) => x === a).length)[0];
        if (moda === 0) continue;
        const consistentes = cuentas.filter((x) => x === moda).length / cuentas.length;
        if (consistentes < 0.8) continue;
        const puntaje = consistentes * 1000 + moda;
        if (!mejor || puntaje > mejor.puntaje) mejor = { ...s, puntaje };
    }
    return mejor ? { char: mejor.char, nombre: mejor.nombre } : null;
}

function partirLinea(linea: string, sep: string): string[] {
    const out: string[] = [];
    let actual = '';
    let dentro = false;
    for (let i = 0; i < linea.length; i++) {
        const c = linea[i];
        if (dentro) {
            if (c === '"' && linea[i + 1] === '"') {
                actual += '"';
                i++;
            } else if (c === '"') dentro = false;
            else actual += c;
        } else if (c === '"') dentro = true;
        else if (c === sep) {
            out.push(actual);
            actual = '';
        } else actual += c;
    }
    out.push(actual);
    return out;
}

function claseDeCaracter(c: string): 'd' | 'l' | 'e' | 'o' {
    if (/\p{Nd}/u.test(c)) return 'd';
    if (/\p{L}/u.test(c)) return 'l';
    if (c === ' ') return 'e';
    return 'o';
}

/** "1–21 dígitos · 22–38 letras · 39–51 espacios": qué hay en cada posición, en TODAS las filas. */
export function mapaDeClases(lineas: string[], ancho: number): string {
    const clases: string[] = [];
    for (let i = 0; i < ancho; i++) {
        let d = false;
        let l = false;
        let e = false;
        let o = false;
        for (const linea of lineas) {
            const c = linea[i] ?? ' ';
            const k = claseDeCaracter(c);
            if (k === 'd') d = true;
            else if (k === 'l') l = true;
            else if (k === 'e') e = true;
            else o = true;
        }
        let clase: string;
        if (d && l) clase = 'letras y dígitos';
        else if (d) clase = 'dígitos';
        else if (l) clase = 'letras';
        else if (o) clase = 'símbolos';
        else clase = e ? 'espacios' : 'espacios';
        clases.push(clase);
    }
    const trozos: string[] = [];
    let inicio = 0;
    for (let i = 1; i <= clases.length; i++) {
        if (i === clases.length || clases[i] !== clases[inicio]) {
            trozos.push(`${inicio + 1}–${i} ${clases[inicio]}`);
            inicio = i;
        }
    }
    const MAX_TROZOS = 60;
    if (trozos.length <= MAX_TROZOS) return trozos.join(' · ');
    return `${trozos.slice(0, MAX_TROZOS).join(' · ')} · …y ${trozos.length - MAX_TROZOS} tramos más`;
}

function esAnchoFijo(lineas: string[]): boolean {
    const llenas = lineas.filter((l) => l.trim() !== '');
    if (llenas.length < 1) return false;
    const largos = llenas.map((l) => l.length);
    const moda = [...largos].sort((a, b) => largos.filter((x) => x === b).length - largos.filter((x) => x === a).length)[0];
    const mismos = largos.filter((x) => x === moda).length / largos.length;
    // Una sola línea larga y con varios tramos separados por espacios también puede ser un ancho fijo, pero con menos de
    // tres líneas no hay forma de distinguirlo de un texto cualquiera.
    return llenas.length >= 3 && moda >= 20 && mismos >= 0.8;
}

/** Alineación y relleno de un tramo, mirando todas las líneas. */
function alineacionDe(lineas: string[], inicio: number, largo: number): { alineacion: 'izquierda' | 'derecha'; relleno: ' ' | '0' } {
    let izq = 0;
    let der = 0;
    let ceros = 0;
    let numerico = 0;
    for (const l of lineas) {
        const t = l.slice(inicio, inicio + largo);
        if (t.trim() === '') continue;
        if (/^\s/.test(t)) der++;
        if (/\s$/.test(t)) izq++;
        if (/^\d+$/.test(t.trim())) {
            numerico++;
            if (/^0\d/.test(t.trim())) ceros++;
        }
    }
    const alineacion = der > izq ? 'derecha' : 'izquierda';
    return { alineacion, relleno: numerico > 0 && ceros / numerico >= 0.5 ? '0' : ' ' };
}

function leerTexto(buffer: Buffer, nombre: string, tipo: 'csv' | 'txt', mapa: MapaReconocibles): PerfilEjemplo {
    const dec = decodificar(buffer);
    const avisos: string[] = [];
    const todas = dec.texto.split(/\r?\n/);
    // Sin la línea vacía del final.
    while (todas.length > 0 && todas[todas.length - 1].trim() === '') todas.pop();
    if (todas.length === 0) throw new ErrorPerfil('VACIO', 'El archivo está vacío.');
    const filasTotales = todas.length;
    const lineas = todas.slice(0, LIMITES.filas + 1);
    if (filasTotales > lineas.length) avisos.push(`Se leyeron las primeras ${LIMITES.filas} filas de ${filasTotales}.`);
    const finDeLinea = /\r\n/.test(dec.texto.slice(0, 20000)) ? 'CRLF' : 'LF';

    const sep = detectarSeparador(lineas);
    let anchoFijo: TextoPerfil['anchoFijo'] = null;
    let filas: Celda[][];
    let encabezadoForzado: boolean | null = null;
    let anchoColumnas: { inicio: number; largo: number }[] | null = null;

    if (!sep && esAnchoFijo(lineas)) {
        const anchoLinea = Math.max(...lineas.map((l) => l.length));
        const inferidas = inferirColumnasAnchoFijo(lineas.join('\n'), { encoding: dec.encoding, tieneHeader: false });
        anchoColumnas = inferidas.length > 0 ? inferidas.slice(0, LIMITES.columnas).map((c) => ({ inicio: c.inicio, largo: c.largo })) : [{ inicio: 0, largo: anchoLinea }];
        if (inferidas.length > LIMITES.columnas) avisos.push(`Se leyeron los primeros ${LIMITES.columnas} tramos de ${inferidas.length}.`);
        anchoFijo = { columnas: anchoColumnas, anchoLinea, mapaClases: mapaDeClases(lineas, anchoLinea) };
        filas = lineas.map((l) => anchoColumnas!.map((c) => celdaDeTexto(l.slice(c.inicio, c.inicio + c.largo))));
        // Un ancho fijo casi nunca trae encabezado, y si lo trae se ve en el mapa de clases.
        encabezadoForzado = false;
    } else {
        const char = sep?.char ?? '\u0000';
        filas = lineas.map((l) => (sep ? partirLinea(l, char) : [l]).map(celdaDeTexto));
    }

    if (filas.every((f) => f.every((c) => c.t === 'vacio'))) throw new ErrorPerfil('SIN_COLUMNAS', 'El archivo no tiene datos.');

    const hoja = hojaDeFilas(null, filas, filasTotales, mapa, avisos);
    if (encabezadoForzado === false && hoja.conEncabezado) {
        hoja.conEncabezado = false;
        hoja.columnas = hoja.sinEncabezado ?? hoja.columnas;
        delete hoja.sinEncabezado;
    }
    if (anchoColumnas) {
        hoja.columnas.forEach((c, i) => {
            const col = anchoColumnas![i];
            if (col) c.anchoFijo = { inicio: col.inicio + 1, largo: col.largo, ...alineacionDe(lineas, col.inicio, col.largo) };
        });
        if (hoja.sinEncabezado) {
            hoja.sinEncabezado.forEach((c, i) => {
                const col = anchoColumnas![i];
                if (col) c.anchoFijo = { inicio: col.inicio + 1, largo: col.largo, ...alineacionDe(lineas, col.inicio, col.largo) };
            });
        }
    }

    const perfil: PerfilConAvisos = {
        archivo: limpiarTexto(nombre, LIMITES.celda),
        tipo,
        bytes: buffer.length,
        texto: { encoding: dec.encoding, bom: dec.bom, finDeLinea, separador: sep?.nombre ?? null, anchoFijo },
        hojas: [hoja],
        hojaUsada: 0,
        avisos,
    };
    return perfil;
}

// ---------------------------------------------------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------------------------------------------------

/**
 * El perfil de un archivo. Lanza `ErrorPerfil` con el motivo (en castellano, listo para el chip). Pura: no toca el
 * filesystem ni la red, y no guarda el archivo.
 */
export function perfilarArchivo(buffer: Buffer, nombre: string, reconocibles: MapaReconocibles = {}): PerfilConAvisos {
    const { tipo } = detectarTipo(buffer, nombre);
    const perfil = tipo === 'xlsx' || tipo === 'xls' ? (leerExcel(buffer, nombre, tipo, reconocibles) as PerfilConAvisos) : leerTexto(buffer, nombre, tipo, reconocibles);
    return acotarPerfil(perfil);
}

/** Tope del perfil guardado (el objetivo del spec son 2 a 15 KB; esto es el techo duro). */
export const MAX_BYTES_PERFIL = 40_000;

/**
 * Un perfil nunca pasa del tope: primero se vacían las columnas de las hojas que no se usan, después se recortan las de la
 * hoja usada. Todo con aviso para la persona.
 */
export function acotarPerfil(p: PerfilConAvisos): PerfilConAvisos {
    const tamano = () => JSON.stringify(p).length;
    if (tamano() <= MAX_BYTES_PERFIL) return p;
    p.avisos = [...(p.avisos ?? [])];
    for (let i = 0; i < p.hojas.length && tamano() > MAX_BYTES_PERFIL; i++) {
        if (i === p.hojaUsada || p.hojas[i].columnas.length === 0) continue;
        p.hojas[i] = { ...p.hojas[i], columnas: [], sinEncabezado: undefined };
        p.avisos.push(`La hoja «${p.hojas[i].nombre}» no se detalla: el archivo es muy grande.`);
    }
    const usada = p.hojas[p.hojaUsada];
    while (tamano() > MAX_BYTES_PERFIL && usada && usada.columnas.length > 5) {
        const quedan = Math.max(5, Math.floor(usada.columnas.length / 2));
        p.avisos.push(`Se detallan solo las primeras ${quedan} columnas de ${usada.columnas.length}: el archivo es muy grande.`);
        usada.columnas = usada.columnas.slice(0, quedan);
        if (usada.sinEncabezado) usada.sinEncabezado = usada.sinEncabezado.slice(0, quedan);
    }
    if (p.texto?.anchoFijo && tamano() > MAX_BYTES_PERFIL) p.texto.anchoFijo.mapaClases = `${p.texto.anchoFijo.mapaClases.slice(0, 500)}…`;
    return p;
}

/** Cuántas filas de datos tiene la hoja usada (sin el encabezado). */
export function filasDeDatos(h: HojaPerfil): number {
    return Math.max(0, h.filasLeidas - (h.conEncabezado ? 1 : 0));
}

/** El resumen que ve la persona en el chip (`AdjuntoSubido.resumen`). */
export function resumenDePerfil(p: PerfilEjemplo): {
    hojas: { nombre: string | null; filas: number; usada: boolean }[];
    columnas: number;
    filasDatos: number;
    conEncabezado: boolean;
    anchoFijo: boolean;
    encabezados: string[];
} {
    const usada = p.hojas[p.hojaUsada] ?? p.hojas[0];
    return {
        hojas: p.hojas.map((h, i) => ({ nombre: h.nombre, filas: h.filasLeidas, usada: i === p.hojaUsada })),
        columnas: usada.columnas.length,
        filasDatos: filasDeDatos(usada),
        conEncabezado: usada.conEncabezado,
        anchoFijo: !!p.texto?.anchoFijo,
        encabezados: usada.conEncabezado ? usada.columnas.slice(0, 3).map((c) => c.encabezado ?? `columna ${c.n}`) : [],
    };
}

/**
 * "La primera fila no es el encabezado": pasa a las estadísticas que ya estaban calculadas con esa fila como datos y
 * borra los encabezados literales del perfil. Devuelve el perfil nuevo (no muta el que recibe).
 */
export function sinEncabezado(p: PerfilEjemplo): PerfilEjemplo {
    const copia: PerfilEjemplo = structuredClone(p);
    for (const h of copia.hojas) {
        if (!h.conEncabezado || !h.sinEncabezado) continue;
        h.columnas = h.sinEncabezado;
        delete h.sinEncabezado;
        h.conEncabezado = false;
    }
    return copia;
}

/**
 * El código de formato de Excel sin el texto literal que puede traer: lo entre comillas y los caracteres escapados.
 * Un formato armado como `"GOMEZ 30111222 "0` mandaba el nombre y el documento al modelo (re-auditoría del 19/10).
 */
export function formatoExcelSinLiterales(codigo: string): string {
    return codigo.replace(/"[^"]*"/g, '""').replace(/\\./g, '');
}
