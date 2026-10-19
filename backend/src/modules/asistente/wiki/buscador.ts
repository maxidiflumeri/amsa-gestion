import { PaginaWiki } from './parsear-pagina';

/**
 * Búsqueda por palabras en el texto completo de la wiki (docs/asistente-spec.md §24). El índice del prompt solo
 * nombra los títulos `## `: lo que está en un `### ` o en el cuerpo de una página no aparece en ningún lado, y el
 * modelo lo daba por "no documentado" (el 👎 del 18/10/2026 con "bloques repetitivos"). Es léxica a propósito (BM25
 * sobre secciones, sin embeddings): la wiki cambia solo con un deploy y entra entera en memoria.
 */

/** Una sección de una página: lo que hay entre un título (`#` a `####`) y el siguiente. */
export interface SeccionWiki {
    slug: string;
    titulo: string;
    /** Los títulos desde el `## ` hasta el de esta sección. Vacío = la introducción de la página. */
    camino: string[];
    /** El texto de la sección sin el markdown, para el fragmento. */
    plano: string;
}

export interface Coincidencia {
    slug: string;
    titulo: string;
    camino: string[];
    /** Un pedazo del texto alrededor de la palabra más rara que coincidió. */
    fragmento: string;
    puntaje: number;
    /**
     * Parte de las palabras de la búsqueda que aparecen en la sección (0 a 1). Las que no están en ninguna página no
     * cuentan: no pueden coincidir con nada ("planillas" por "plantillas").
     */
    cobertura: number;
}

export interface OpcionesBusqueda {
    limite?: number;
    /** Como mucho estas secciones de una misma página. */
    porPagina?: number;
    /** Descarta las coincidencias que no tienen al menos esta parte de las palabras. */
    minCobertura?: number;
    /** Descarta las de puntaje menor a esta fracción del de la primera. */
    minRelativo?: number;
    /**
     * La cobertura se mide solo sobre las palabras distintivas (las que están en el 10 % de las secciones o menos), y
     * sin ninguna no hay resultados. Para la búsqueda automática: "carga", "archivo" o "sección" no deben dejar afuera
     * la sección de "bloques repetitivos". No filtra los verbos: "importo" o "creo" son distintivas y traen ruido.
     */
    soloDistintivas?: boolean;
    largoFragmento?: number;
}

/** Palabras que no ayudan a encontrar nada. Ya normalizadas (sin acentos, en minúscula). */
const VACIAS = new Set(
    (
        'a al algo alguna alguno ante antes aqui asi aun bien cada como con contra cual cuales cuando cuanto de del ' +
        'desde donde dos el ella en entre era es esa ese eso esta estan este esto estoy fue ha hace hay la las le les ' +
        'lo los mas me mi mis muy ni no nos o otra otro para pero por porque puedo puede que se sea ser si sin sobre ' +
        'son su sus tambien te tengo tiene toda todo todos tu tus un una uno unos unas y ya yo vos sos hacer hago ' +
        'quiero queres podes ' +
        // Las de pregunta: "Para qué sirve", "Cómo funciona" y "Qué significa" son títulos de casi todas las páginas.
        'sirve significa pasa paso funciona quiere decir hago puedo podria deberia'
    ).split(' '),
);

const K1 = 1.2;
const B = 0.75;
/** Peso de una palabra que está en el título de la sección, en el de una sección madre o en el de la página. */
const PESO_TITULO = 2;
const PESO_CAMINO = 1;
const PESO_PAGINA = 0.5;
/** Bonus por dos palabras de la búsqueda seguidas en el mismo orden ("bloques repetitivos"). */
const PESO_PAR = 0.5;
/**
 * Bonus por un identificador de la búsqueda que está tal cual en la sección (`CLAVE_NO_CARGADA`, `removeDashes`):
 * sus palabras sueltas ("clave", "cargada") están en muchas secciones y solas no lo encuentran.
 */
const PESO_IDENTIFICADOR = 15;
const RE_IDENTIFICADOR = /\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
/** Una palabra es distintiva si está en este porcentaje de las secciones o menos (en la wiki real, unas 70 de 698). */
export const FRACCION_DISTINTIVA = 0.1;

/**
 * Sin acentos, en minúscula y con un espacio en lugar de cualquier signo. Una unidad UTF-16 de entrada, una de
 * salida: las posiciones sirven para cortar el fragmento del texto original (un emoji son dos espacios).
 */
export function normalizar(s: string): string {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        // NFD separa la letra de su acento: la primera unidad es la letra sola.
        const c = s[i].normalize('NFD').charAt(0).toLowerCase();
        out += /[a-z0-9]/.test(c) ? c : ' ';
    }
    return out;
}

/**
 * Una raíz liviana para que el plural y el singular coincidan: se saca la "s" final y después la "e" final. Así
 * "bloques" y "bloque" dan "bloqu", "nombres" y "nombre" dan "nombr", "errores" y "error" dan "error", "meses" y "mes"
 * dan "mes", "iteraciones" e "iteracion" dan "iteracion". No conjuga verbos.
 */
export function raiz(palabra: string): string {
    if (palabra.length <= 3) return palabra;
    let r = palabra.endsWith('s') ? palabra.slice(0, -1) : palabra;
    if (r.length >= 4 && r.endsWith('e')) r = r.slice(0, -1);
    return r;
}

/** Las palabras que cuentan de un texto, ya como raíces. */
export function terminos(s: string): string[] {
    return normalizar(s)
        .split(' ')
        .filter((w) => w.length >= 2 && !VACIAS.has(w))
        .map(raiz);
}

/**
 * El texto sin la sintaxis de markdown que estorba en un fragmento. El guion bajo se saca solo cuando marca una
 * cursiva: dentro de un nombre (`CLAVE_NO_CARGADA`, `{{importe_cupon}}`) queda, y al normalizar separa las palabras.
 */
function aPlano(md: string): string {
    return md
        .replace(/^(```|~~~).*$/gm, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1$2')
        .replace(/[*`>]+/g, '')
        .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, '')
        .replace(/\|/g, ' · ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Corta una página en secciones por sus títulos. Los `#` dentro de un bloque de código no son títulos. */
export function partirEnSecciones(p: PaginaWiki): SeccionWiki[] {
    const secciones: SeccionWiki[] = [];
    const pila: string[] = [];
    let camino: string[] = [];
    let lineas: string[] = [];
    let enCodigo: string | null = null;

    const cerrar = () => {
        const plano = aPlano(lineas.join('\n'));
        if (plano || camino.length > 0) secciones.push({ slug: p.slug, titulo: p.titulo, camino, plano });
        lineas = [];
    };

    for (const linea of p.cuerpo.split('\n')) {
        const cerca = /^(```|~~~)/.exec(linea);
        if (cerca) {
            if (enCodigo === null) enCodigo = cerca[1];
            else if (enCodigo === cerca[1]) enCodigo = null;
            lineas.push(linea);
            continue;
        }
        const t = enCodigo === null ? /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(linea) : null;
        if (!t) {
            lineas.push(linea);
            continue;
        }
        const nivel = t[1].length;
        if (nivel === 1) continue; // el título de la página
        cerrar();
        pila.length = Math.min(pila.length, nivel - 2);
        pila[nivel - 2] = t[2].replace(/[*`]/g, '').trim();
        camino = pila.filter(Boolean);
    }
    cerrar();
    return secciones;
}

interface SeccionIndexada {
    s: SeccionWiki;
    /** Frecuencia de cada raíz en el cuerpo. */
    tf: Map<string, number>;
    largo: number;
    /** Las raíces del cuerpo en orden, para los pares. */
    secuencia: string[];
    titulo: Set<string>;
    camino: Set<string>;
    pagina: Set<string>;
    /** El texto plano normalizado, para ubicar el fragmento. */
    planoNorm: string;
    /** El texto plano en minúscula, con los guiones bajos, para los identificadores. */
    planoMin: string;
}

export class BuscadorWiki {
    private readonly secciones: SeccionIndexada[];
    private readonly df = new Map<string, number>();
    private readonly largoMedio: number;

    constructor(paginas: PaginaWiki[]) {
        this.secciones = paginas.flatMap((p) => partirEnSecciones(p)).map((s) => {
            const secuencia = terminos(s.plano);
            const tf = new Map<string, number>();
            for (const t of secuencia) tf.set(t, (tf.get(t) ?? 0) + 1);
            const titulo = new Set(terminos(s.camino[s.camino.length - 1] ?? ''));
            return {
                s,
                tf,
                largo: secuencia.length,
                secuencia,
                titulo,
                camino: new Set(terminos(s.camino.slice(0, -1).join(' '))),
                pagina: new Set(terminos(s.titulo)),
                planoNorm: normalizar(s.plano),
                planoMin: s.plano.toLowerCase(),
            };
        });
        for (const x of this.secciones) {
            const vistas = new Set([...x.tf.keys(), ...x.titulo, ...x.camino, ...x.pagina]);
            for (const t of vistas) this.df.set(t, (this.df.get(t) ?? 0) + 1);
        }
        this.largoMedio = this.secciones.reduce((a, x) => a + x.largo, 0) / Math.max(1, this.secciones.length);
    }

    get cantidadSecciones(): number {
        return this.secciones.length;
    }

    private idf(t: string): number {
        const n = this.secciones.length;
        const df = this.df.get(t) ?? 0;
        return Math.log(1 + (n - df + 0.5) / (df + 0.5));
    }

    buscar(texto: string, o: OpcionesBusqueda = {}): Coincidencia[] {
        const limite = o.limite ?? 6;
        const porPagina = o.porPagina ?? 2;
        const minCobertura = o.minCobertura ?? 0;
        const minRelativo = o.minRelativo ?? 0;
        const largoFragmento = o.largoFragmento ?? 220;

        const secuenciaQ = terminos(texto);
        const q = [...new Set(secuenciaQ)].filter((t) => this.df.has(t));
        const tope = Math.max(1, Math.floor(this.secciones.length * FRACCION_DISTINTIVA));
        const aCubrir = o.soloDistintivas ? q.filter((t) => (this.df.get(t) ?? 0) <= tope) : q;
        const identificadores = [...new Set([...texto.matchAll(RE_IDENTIFICADOR)].map((m) => m[0].toLowerCase()))];
        if (aCubrir.length === 0 && identificadores.length === 0) return [];
        const pares = new Set<string>();
        for (let i = 0; i + 1 < secuenciaQ.length; i++) pares.add(`${secuenciaQ[i]} ${secuenciaQ[i + 1]}`);

        const puntuadas: { x: SeccionIndexada; puntaje: number; cobertura: number; mejor: string }[] = [];
        for (const x of this.secciones) {
            let puntaje = 0;
            let encontradas = 0;
            let cubiertas = 0;
            let mejor = '';
            let mejorIdf = -1;
            for (const t of q) {
                const idf = this.idf(t);
                const f = x.tf.get(t) ?? 0;
                let p = 0;
                if (f > 0) p += (f * (K1 + 1)) / (f + K1 * (1 - B + (B * x.largo) / this.largoMedio));
                if (x.titulo.has(t)) p += PESO_TITULO;
                if (x.camino.has(t)) p += PESO_CAMINO;
                if (x.pagina.has(t)) p += PESO_PAGINA;
                if (p === 0) continue;
                encontradas++;
                if (aCubrir.includes(t)) cubiertas++;
                puntaje += idf * p;
                if (f > 0 && idf > mejorIdf) {
                    mejorIdf = idf;
                    mejor = t;
                }
            }
            if (encontradas === 0) continue;
            const exactos = identificadores.filter((id) => x.planoMin.includes(id)).length;
            puntaje += exactos * PESO_IDENTIFICADOR;
            const sumados = new Set<string>();
            for (let i = 0; pares.size > 0 && i + 1 < x.secuencia.length; i++) {
                const par = `${x.secuencia[i]} ${x.secuencia[i + 1]}`;
                if (!pares.has(par) || sumados.has(par)) continue;
                sumados.add(par);
                puntaje += PESO_PAR * (this.idf(x.secuencia[i]) + this.idf(x.secuencia[i + 1]));
            }
            // El identificador exacto cubre la búsqueda aunque sus palabras sueltas sean comunes.
            const cobertura = exactos > 0 ? 1 : aCubrir.length > 0 ? cubiertas / aCubrir.length : 0;
            if (cobertura < minCobertura || (cubiertas === 0 && exactos === 0)) continue;
            puntuadas.push({ x, puntaje, cobertura, mejor });
        }

        puntuadas.sort((a, b) => b.puntaje - a.puntaje || a.x.s.slug.localeCompare(b.x.s.slug));
        const piso = (puntuadas[0]?.puntaje ?? 0) * minRelativo;
        const out: Coincidencia[] = [];
        const usadas = new Map<string, number>();
        for (const p of puntuadas) {
            if (out.length >= limite || p.puntaje < piso) break;
            const n = usadas.get(p.x.s.slug) ?? 0;
            if (n >= porPagina) continue;
            usadas.set(p.x.s.slug, n + 1);
            out.push({
                slug: p.x.s.slug,
                titulo: p.x.s.titulo,
                camino: p.x.s.camino,
                fragmento: fragmento(p.x, p.mejor, largoFragmento),
                puntaje: Math.round(p.puntaje * 100) / 100,
                cobertura: Math.round(p.cobertura * 100) / 100,
            });
        }
        return out;
    }
}

/** El pedazo de texto alrededor de la primera aparición de la raíz, cortado en palabras enteras. */
function fragmento(x: SeccionIndexada, raizMejor: string, largo: number): string {
    const plano = x.s.plano;
    if (!plano) return '';
    let i = raizMejor ? new RegExp(`(^| )${raizMejor}`).exec(x.planoNorm)?.index ?? -1 : -1;
    if (i < 0) i = 0;
    else if (x.planoNorm[i] === ' ') i++;
    let desde = Math.max(0, i - Math.floor(largo / 3));
    let hasta = Math.min(plano.length, desde + largo);
    desde = Math.max(0, hasta - largo);
    if (desde > 0) {
        const espacio = plano.indexOf(' ', desde);
        if (espacio >= 0 && espacio < i) desde = espacio + 1;
    }
    if (hasta < plano.length) {
        const espacio = plano.lastIndexOf(' ', hasta);
        if (espacio > i) hasta = espacio;
    }
    return `${desde > 0 ? '…' : ''}${plano.slice(desde, hasta).trim()}${hasta < plano.length ? '…' : ''}`;
}

/** Una línea por coincidencia: `[slug] Título › Sección › Subsección`. */
export function rotuloCoincidencia(c: Coincidencia): string {
    return `[${c.slug}] ${[c.titulo, ...c.camino].join(' › ')}`;
}
