import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateSync } from 'class-validator';
import { esFechaRelativa } from '../../../common/utils/dia-local';
import { NodoCatalogo } from '../../reportes/dto/catalogo.dto';
import { PathParser } from '../../reportes/parser/path-parser';
import { Prisma } from '@prisma/client';
import { campoFinal, validarDefinicion, validarOpcionesFormato } from '../../reportes/validador/definicion-validator';
import { CreatePlantillaDto, DefinicionPlantillaDto } from '../../reportes/dto/plantilla.dto';
import { PerfilEjemplo } from '../adjuntos/perfil-ejemplo';
import { otrasConElMismoPrefijo } from './empresas';
import { nodosVisibles } from './prompt/catalogo-compacto';
import {
    Capacidades,
    ColumnaEntrada,
    EntradaProbar,
    FiltroEntrada,
    PlantillaNormalizada,
    ValorFiltro,
    Vocabulario,
} from './tipos-reportes';

/**
 * El validador de propuestas (docs/asistente-reportes-spec.md §7.5): la red determinista entre lo que inventa el modelo y
 * el motor. Puro y sincrónico. Cada error nombra la columna o el filtro y dice cómo arreglarlo: un mensaje concreto se
 * corrige en una sola vuelta, y cada vuelta cuesta USD 0,015 a 0,02.
 *
 * Las reglas que ya tiene `validarDefinicion` (operadores, paths contra el DMMF con la lista de campos sensibles, columnas
 * duplicadas, filtros sin valor, fechas) NO se repiten: cuando las reglas propias no encuentran nada, la definición
 * normalizada pasa igual por `validarDefinicion` y lo que ella rechace sale como error. Acá van solo las reglas del
 * asistente: catálogo visible, vocabularios, tipos, mapeo del ejemplo, opciones de formato.
 */

export interface EmpresaConocida {
    id: number;
    nombre: string;
    casos?: number;
}

export interface ContextoValidacion {
    catalogo: NodoCatalogo[];
    vocabulario: (path: string) => Vocabulario | null;
    empresas: EmpresaConocida[];
    /** Claves de datos adicionales de la empresa asociada (null = no se cargaron o no hay empresa). */
    clavesAdicionales: string[] | null;
    /** El ejemplo del que sale el mapeo (el más reciente), con la hoja que se está usando. */
    ejemploPrincipal?: { perfil: PerfilEjemplo; hoja: number };
    capacidades: Capacidades;
    formatosTelefonoIds: ReadonlySet<number>;
    /** Nombres (en minúscula) de las plantillas activas: para avisar que ya existe una igual. */
    nombresPlantillas?: ReadonlySet<string>;
}

export interface ResultadoValidacion {
    errores: string[];
    avisos: string[];
    normalizada?: PlantillaNormalizada;
}

type TipoValor = 'texto' | 'numero' | 'fecha' | 'boolean' | 'enum';

interface InfoPath {
    tipo: TipoValor;
    /** Camino de la última rama de muchos que recorre el path (para saber si dos columnas expanden ramas distintas). */
    rama: string | null;
    esCantidad: boolean;
    esClaveAdicional: boolean;
    /** El path lleva un selector ([0], [last], [sum]…): ya no trae "todos". */
    conSelector: boolean;
    /** El path pasa por una rama de muchos. */
    porRamaMuchos: boolean;
    /** Si el campo es una lista (enum), sus valores. */
    enumValues?: string[];
}

const parser = new PathParser();
const MAX_COLUMNAS = 80;
const OPERADORES: Record<TipoValor, string[]> = {
    texto: ['eq', 'neq', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'isNull', 'isNotNull'],
    numero: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'isNull', 'isNotNull'],
    fecha: ['eq', 'gte', 'lte', 'between', 'notBetween', 'isNull', 'isNotNull'],
    boolean: ['eq', 'neq', 'isNull', 'isNotNull'],
    enum: ['eq', 'neq', 'in', 'notIn', 'isNull', 'isNotNull'],
};
const TIPOS_COLUMNA = ['texto', 'numero', 'fecha', 'boolean', 'telefono', 'dias'];
const CARDINALIDADES = ['concatenar', 'primero', 'ultimo', 'expandir'];

const SOLO_VALOR_ARRAY = new Set(['in', 'notIn']);
const RANGO = new Set(['between', 'notBetween']);
const SIN_VALOR = new Set(['isNull', 'isNotNull']);
const CON_VOCABULARIO = new Set(['eq', 'neq', 'in', 'notIn']);

const OPCIONES_POR_FORMATO: Record<string, string[]> = {
    csv: ['separador', 'incluirHeader', 'bom', 'encoding', 'lineEnding'],
    txt: ['separador', 'incluirHeader', 'encoding', 'lineEnding', 'anchoFijo', 'alineacion', 'relleno'],
    xlsx: [],
    pdf: [],
};

const sinAcentos = (s: string) =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();

const lista = (xs: string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(', ')}…` : xs.join(', '));

function etiquetaColumna(c: ColumnaEntrada): string {
    return `«${c.label}»`;
}

class Indice {
    private readonly porPath = new Map<string, NodoCatalogo>();
    readonly raices: NodoCatalogo[];
    constructor(catalogo: NodoCatalogo[]) {
        for (const n of nodosVisibles(catalogo)) this.porPath.set(n.path, n);
        this.raices = catalogo.filter((n) => this.porPath.has(n.path));
    }
    get(path: string): NodoCatalogo | undefined {
        return this.porPath.get(path);
    }
    hijos(n: NodoCatalogo | null): NodoCatalogo[] {
        return (n ? (n.hijos ?? []) : this.raices).filter((h) => this.porPath.has(h.path));
    }
}

function tipoDeNodo(n: NodoCatalogo): TipoValor {
    const t = n.tipoEscalar ?? 'texto';
    return t;
}

/** Analiza un path de columna o de filtro contra el catálogo visible. Devuelve el error (con cómo arreglarlo) o la info. */
function analizarPath(path: string, ind: Indice, ctx: ContextoValidacion, rotulo: string): { error: string } | { info: InfoPath; claves?: string } {
    let ast;
    try {
        ast = parser.parse(path);
    } catch (e: any) {
        return { error: `${rotulo}: el path «${path}» no es válido (${e?.message ?? 'formato'}).` };
    }
    let actual: NodoCatalogo | null = null;
    let prefijo = '';
    let rama: string | null = null;
    let porRamaMuchos = false;
    let conSelector = false;
    let esCantidad = false;
    let esClave = false;
    let pendiente: { agregador: string; en: string } | null = null;
    let tipoFinal: TipoValor | null = null;
    const n = ast.segments.length;

    for (let i = 0; i < n; i++) {
        const seg = ast.segments[i];
        const ultimo = i === n - 1;

        // Aplicar el agregador pendiente ([sum], [last]…) al campo que le sigue.
        const aplicarPendiente = (nodo: NodoCatalogo | null, esJson: boolean) => {
            if (!pendiente) return null;
            const { agregador, en } = pendiente;
            pendiente = null;
            const t = esJson ? 'texto' : nodo ? tipoDeNodo(nodo) : 'texto';
            if (!esJson && (!nodo || nodo.tipo !== 'escalar')) {
                return `${rotulo}: «${path}»: después de [${agregador}] tiene que ir un campo de ${en}, no una relación.`;
            }
            if ((agregador === 'sum' || agregador === 'avg') && t !== 'numero') {
                return `${rotulo}: «${path}»: [${agregador}] solo se puede sobre números y «${nodo?.path ?? seg.name}» es ${t}.`;
            }
            if ((agregador === 'min' || agregador === 'max') && t !== 'numero' && t !== 'fecha') {
                return `${rotulo}: «${path}»: [${agregador}] solo se puede sobre números o fechas y «${nodo?.path ?? seg.name}» es ${t}.`;
            }
            tipoFinal = agregador === 'sum' || agregador === 'avg' ? 'numero' : t;
            return null;
        };

        if (actual && actual.tipo === 'json') {
            // camposAdicionales.<clave>: la clave es libre; adentro no hay más campos.
            if (i > 0 && ast.segments[i - 1].name === actual.nombre) {
                esClave = true;
                const err = aplicarPendiente(null, true);
                if (err) return { error: err };
                if (seg.modifiers.length > 0) {
                    const soloCount = seg.modifiers.length === 1 && seg.modifiers[0].type === 'aggregator' && seg.modifiers[0].aggregator === 'count';
                    if (!soloCount) return { error: `${rotulo}: «${path}»: en una clave de datos adicionales solo se puede usar [count].` };
                    esCantidad = true;
                    conSelector = true;
                    tipoFinal = 'numero';
                } else if (!tipoFinal) tipoFinal = 'texto';
                if (!ultimo) return { error: `${rotulo}: «${path}»: una clave de datos adicionales es un texto, no tiene campos adentro.` };
                continue;
            }
        }

        prefijo = prefijo ? `${prefijo}.${seg.name}` : seg.name;
        const nodo = ind.get(prefijo);
        if (!nodo) {
            const hermanos = ind.hijos(actual).map((h) => h.nombre);
            const dentro = actual ? `dentro de ${actual.nombre}` : 'en el caso';
            return {
                error: `${rotulo}: «${path}»: no existe «${seg.name}» ${dentro}. Campos: ${lista(hermanos)}.`,
            };
        }

        const errPend = aplicarPendiente(nodo, false);
        if (errPend) return { error: errPend };

        // Modificadores.
        const esMuchos = nodo.tipo === 'relacion-1-n';
        let selectores = 0;
        for (const m of seg.modifiers) {
            const nombreMod = m.type === 'filter' ? `[${m.filters.map((f) => f.field).join(',')}]` : m.type === 'indexer' ? `[${m.index}]` : `[${m.aggregator}]`;
            if (!esMuchos) {
                if (nodo.tipo === 'json' && m.type === 'aggregator' && m.aggregator === 'count') {
                    return { error: `${rotulo}: «${path}»: [count] sobre datos adicionales va en una clave: camposAdicionales.<clave>[count].` };
                }
                return {
                    error: `${rotulo}: «${path}»: ${nombreMod} solo va en una rama de muchos; ${nodo.nombre} ${nodo.tipo === 'escalar' ? 'es un campo, no una rama' : 'es de uno'}.`,
                };
            }
            if (m.type === 'filter') {
                for (const f of m.filters) {
                    const hijo = ind.get(`${nodo.path}.${f.field}`);
                    if (!hijo || hijo.tipo !== 'escalar') {
                        const campos = ind.hijos(nodo).filter((h) => h.tipo === 'escalar').map((h) => h.nombre);
                        return { error: `${rotulo}: «${path}»: ${nodo.nombre} no tiene el campo «${f.field}» para filtrar. Campos: ${lista(campos)}.` };
                    }
                    const voc = ctx.vocabulario(hijo.path);
                    if (voc && voc.cerrado && !voc.valores.includes(f.value)) {
                        return {
                            error: `${rotulo}: «${path}»: «${f.value}» no es un valor de ${hijo.path}. Valores: ${lista(voc.valores, 40)}.`,
                        };
                    }
                }
            } else {
                selectores++;
                if (selectores > 1) return { error: `${rotulo}: «${path}»: en ${nodo.nombre} hay más de un selector ([0], [last], [sum]…): dejá uno.` };
                conSelector = true;
                if (m.type === 'indexer') {
                    if (m.index > 9) return { error: `${rotulo}: «${path}»: el índice [${m.index}] no vale; va de 0 a 9.` };
                    if (ultimo) return { error: `${rotulo}: «${path}»: después de [${m.index}] tiene que ir un campo (${nodo.nombre}[${m.index}].${ind.hijos(nodo).find((h) => h.tipo === 'escalar')?.nombre ?? 'campo'}).` };
                } else if (m.aggregator === 'count') {
                    if (!ultimo) return { error: `${rotulo}: «${path}»: [count] va al final del camino.` };
                    esCantidad = true;
                    tipoFinal = 'numero';
                } else if (m.aggregator === 'concat') {
                    return { error: `${rotulo}: «${path}»: [concat] no se usa; para juntar varios valores en una celda dejá la cardinalidad en concatenar.` };
                } else {
                    if (ultimo) return { error: `${rotulo}: «${path}»: después de [${m.aggregator}] tiene que ir un campo (${nodo.nombre}[${m.aggregator}].${ind.hijos(nodo).find((h) => h.tipo === 'escalar')?.nombre ?? 'campo'}).` };
                    pendiente = { agregador: m.aggregator, en: nodo.nombre };
                }
            }
        }

        if (esMuchos) {
            rama = nodo.path;
            porRamaMuchos = true;
        }
        actual = nodo;
    }

    if (!actual) return { error: `${rotulo}: el path está vacío.` };
    if (esCantidad) {
        return { info: { tipo: 'numero', rama, esCantidad: true, esClaveAdicional: esClave, conSelector, porRamaMuchos } };
    }
    if (esClave) {
        return { info: { tipo: tipoFinal ?? 'texto', rama, esCantidad: false, esClaveAdicional: true, conSelector, porRamaMuchos }, claves: ast.segments[ast.segments.length - 1].name };
    }
    if (actual.tipo === 'json') {
        return { error: `${rotulo}: «${path}» termina en los datos adicionales enteros; elegí una clave: ${path}.<clave> (las da datos_adicionales).` };
    }
    if (actual.tipo !== 'escalar') {
        const ejemplo = ind.hijos(actual).find((h) => h.tipo === 'escalar')?.path;
        return { error: `${rotulo}: «${path}» termina en una relación; elegí un campo adentro (${ejemplo ?? `${actual.path}.campo`}).` };
    }
    return { info: { tipo: tipoFinal ?? tipoDeNodo(actual), rama, esCantidad: false, esClaveAdicional: false, conSelector, porRamaMuchos, ...(valoresDeEnum(actual, ast) && !conSelector ? { enumValues: valoresDeEnum(actual, ast) } : {}) } };
}

/** Los valores de un campo enum: el catálogo no los trae, salen del modelo de Prisma. */
function valoresDeEnum(nodo: NodoCatalogo, ast: Parameters<typeof campoFinal>[1]): string[] | undefined {
    if (nodo.tipoEscalar !== 'enum') return undefined;
    if (nodo.enumValues?.length) return nodo.enumValues;
    const campo = campoFinal('deudor', ast).campo;
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === campo?.type);
    return e ? e.values.map((v) => v.name) : undefined;
}

function claveAdicional(path: string): string | null {
    const m = /^camposAdicionales\.([^.[\]]+)/.exec(path);
    return m ? m[1] : null;
}

function validarFormatoFecha(f: string): boolean {
    const resto = f.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, '');
    return /^[-/.: T_]*$/.test(resto) && f !== resto;
}

const fechaValida = (s: string): boolean => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

/** Un valor suelto de un filtro. Devuelve el error o el valor normalizado. */
function validarEscalar(tipo: TipoValor, v: unknown, etiqueta: string, ctx: ContextoValidacion): { error: string } | { valor: string | number | boolean } {
    switch (tipo) {
        case 'numero': {
            const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
            return Number.isFinite(n) ? { valor: n } : { error: `${etiqueta}: «${String(v)}» no es un número; mandalo como número (sin separadores de miles).` };
        }
        case 'fecha': {
            if (typeof v !== 'string') return { error: `${etiqueta}: la fecha tiene que ser un texto AAAA-MM-DD${ctx.capacidades.E1 ? ' o hoy-90' : ''}.` };
            const t = v.trim();
            if (esFechaRelativa(t)) {
                return ctx.capacidades.E1
                    ? { valor: t }
                    : { error: `${etiqueta}: «${t}» no vale todavía; usá una fecha fija AAAA-MM-DD (con «${t}» el filtro quedaría en 1990).` };
            }
            if (fechaValida(t)) return { valor: t };
            return { error: `${etiqueta}: «${t}» no es una fecha válida; usá AAAA-MM-DD (por ejemplo 2026-07-31)${ctx.capacidades.E1 ? ' o una relativa como hoy-90' : ''}.` };
        }
        case 'boolean':
            return typeof v === 'boolean' ? { valor: v } : { error: `${etiqueta}: el valor tiene que ser true o false.` };
        default:
            if (typeof v === 'string') return { valor: v };
            if (typeof v === 'number') return { valor: String(v) };
            return { error: `${etiqueta}: el valor tiene que ser un texto.` };
    }
}

function validarValorFiltro(
    f: FiltroEntrada,
    tipo: TipoValor,
    valor: ValorFiltro | undefined,
    etiqueta: string,
    ctx: ContextoValidacion,
    esCantidad: boolean,
): { error: string } | { valor: unknown } {
    const op = f.operador;
    if (SIN_VALOR.has(op)) return { valor: undefined };
    if (valor === undefined || valor === null || valor === '') return { error: `${etiqueta}: falta el valor.` };

    const normalizar = (x: unknown): { error: string } | { valor: string | number | boolean } => validarEscalar(esCantidad ? 'numero' : tipo, x, etiqueta, ctx);
    let out: unknown;
    if (RANGO.has(op)) {
        if (!Array.isArray(valor) || valor.length !== 2) return { error: `${etiqueta}: ${op} necesita dos valores [desde, hasta].` };
        const r = valor.map(normalizar);
        const mal = r.find((x) => 'error' in x) as { error: string } | undefined;
        if (mal) return mal;
        out = r.map((x) => (x as { valor: unknown }).valor);
    } else if (SOLO_VALOR_ARRAY.has(op)) {
        if (!Array.isArray(valor) || valor.length === 0) return { error: `${etiqueta}: ${op} necesita una lista con al menos un valor.` };
        const r = valor.map(normalizar);
        const mal = r.find((x) => 'error' in x) as { error: string } | undefined;
        if (mal) return mal;
        out = r.map((x) => (x as { valor: unknown }).valor);
    } else {
        if (Array.isArray(valor)) return { error: `${etiqueta}: ${op} lleva un solo valor; para varios usá «in».` };
        const r = normalizar(valor);
        if ('error' in r) return r;
        out = r.valor;
    }
    return { valor: out };
}

function valoresPlanos(v: unknown): string[] {
    return (Array.isArray(v) ? v : [v]).map((x) => String(x));
}

export function validarPropuesta(entrada: EntradaProbar, ctx: ContextoValidacion): ResultadoValidacion {
    const errores: string[] = [];
    const avisos: string[] = [];
    const ind = new Indice(ctx.catalogo);
    const def = entrada.definicion;

    // La codificación del ejemplo manda: sin `encoding` se usa la suya; con otra distinta, aviso fuerte para confirmarla.
    const textoEj = ctx.ejemploPrincipal?.perfil.texto;
    if (textoEj && (entrada.formatoSalida === 'csv' || entrada.formatoSalida === 'txt')) {
        const pedida = entrada.opciones?.encoding;
        if (pedida === undefined) entrada = { ...entrada, opciones: { ...entrada.opciones, encoding: textoEj.encoding } };
        else if (pedida !== textoEj.encoding) {
            avisos.push(
                `ATENCIÓN: el archivo de ejemplo está en ${textoEj.encoding} y la plantilla sale en ${pedida}. Si la persona no pidió ${pedida}, corregilo; si lo pidió, confirmáselo en el mensaje.`,
            );
        }
    }

    // ---- 1 y 2: columnas -------------------------------------------------------------------------------------
    const columnas = def?.columnas ?? [];
    if (columnas.length === 0) {
        return { errores: ['La definición no tiene columnas: mandá la plantilla completa.'], avisos };
    }
    if (columnas.length > MAX_COLUMNAS) errores.push(`Hay ${columnas.length} columnas y el máximo es ${MAX_COLUMNAS}.`);
    const vistos = new Map<string, number>();
    columnas.forEach((c) => {
        const l = (c.label ?? '').trim();
        if (l === '') errores.push('Hay una columna sin label.');
        else if (Array.from(l).length > 100) errores.push(`Label demasiado largo (${etiquetaColumna(c)}): máximo 100 caracteres.`);
        const k = sinAcentos(l).replace(/\s+/g, ' ');
        vistos.set(k, (vistos.get(k) ?? 0) + 1);
    });
    for (const [k, veces] of vistos) {
        if (veces > 1 && k !== '') {
            const original = columnas.find((c) => sinAcentos(c.label).replace(/\s+/g, ' ') === k)!.label;
            errores.push(`Label repetido «${original}»: dos columnas se pisarían.`);
        }
    }

    // ---- 3 a 9: paths y tipos de columna ----------------------------------------------------------------------
    const infoColumna = new Map<ColumnaEntrada, InfoPath | null>();
    const empresaAsociada = entrada.empresa
        ? ctx.empresas.find((e) => e.nombre === entrada.empresa)
        : undefined;
    for (const c of columnas) {
        const r = `Columna ${etiquetaColumna(c)}`;
        const fija = !c.path || c.path.trim() === '';
        if (fija) {
            infoColumna.set(c, null);
            if (c.tipo) errores.push(`${r}: una columna fija (path vacío) no lleva tipo.`);
            if (c.valorFijo !== undefined && typeof c.valorFijo !== 'string') errores.push(`${r}: valorFijo es un texto.`);
            if (typeof c.valorFijo === 'string' && c.valorFijo.length > 100) errores.push(`${r}: el valor fijo es demasiado largo (máximo 100 caracteres).`);
            continue;
        }
        const a = analizarPath(c.path.trim(), ind, ctx, r);
        if ('error' in a) {
            errores.push(a.error);
            infoColumna.set(c, null);
            continue;
        }
        infoColumna.set(c, a.info);
        const clave = a.info.esClaveAdicional ? claveAdicional(c.path.trim()) : null;
        if (clave) verificarClave(clave, c.path, r, entrada.empresa, ctx, errores);
        validarTipoColumna(c, a.info, r, ctx, errores);
    }

    // ---- 10: expandir en ramas distintas ------------------------------------------------------------------------
    const ramasExpandir = new Set<string>();
    for (const c of columnas) {
        const i = infoColumna.get(c);
        if (!i || !i.rama || i.conSelector) continue;
        if ((c.cardinalidad ?? def.cardinalidadDefault) === 'expandir') ramasExpandir.add(i.rama);
    }
    if (ramasExpandir.size > 1) {
        errores.push(`Hay columnas en expandir sobre ramas distintas (${[...ramasExpandir].join(', ')}): las filas se multiplicarían. Dejá expandir en una sola rama.`);
    } else if (ramasExpandir.size === 1) {
        avisos.push(`Hay una fila por cada elemento de ${[...ramasExpandir][0]}: el listado va a tener más filas que casos.`);
    }

    // ---- 11 a 15: filtros ---------------------------------------------------------------------------------------
    const filtros = def.filtros ?? [];
    let filtraEmpresa = false;
    const filtrosNormalizados: Record<string, unknown>[] = [];
    for (const f of filtros) {
        const r = `Filtro «${f.path}»`;
        const a = analizarPath((f.path ?? '').trim(), ind, ctx, r);
        if ('error' in a) {
            errores.push(a.error);
            continue;
        }
        const { info } = a;
        const tipo: TipoValor = info.tipo;
        const clave = a.claves ?? null;
        if (clave) verificarClave(clave, f.path, r, entrada.empresa, ctx, errores);

        // Los datos adicionales son texto, pero se pueden comparar (como texto: ver el aviso más abajo).
        const permitidos = info.esCantidad
            ? OPERADORES.numero
            : info.esClaveAdicional
              ? [...OPERADORES.texto, 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween']
              : OPERADORES[tipo];
        if (!permitidos.includes(f.operador)) {
            const usables = tipo === 'fecha' ? 'gte, lte, between' : permitidos.filter((o) => !SIN_VALOR.has(o)).join(', ');
            errores.push(`${r}: ${f.operador} no vale para ${info.esCantidad ? 'cantidades' : tipo === 'numero' ? 'números' : tipo === 'fecha' ? 'fechas' : tipo === 'boolean' ? 'sí/no' : 'texto'}; usá ${usables}.`);
            continue;
        }
        if (info.tipo === 'texto' && info.esClaveAdicional && ['gt', 'gte', 'lt', 'lte', 'between', 'notBetween'].includes(f.operador)) {
            avisos.push(`${r}: los datos adicionales se comparan como texto (9 es mayor que 10).`);
        }

        let valor: unknown;
        let porDefecto: unknown;
        if (f.variable) {
            if (!f.labelVariable || f.labelVariable.trim() === '') errores.push(`${r}: un filtro variable necesita labelVariable (el nombre que ve quien ejecuta).`);
            if (f.valorPorDefecto !== undefined && f.valorPorDefecto !== null && f.valorPorDefecto !== '') {
                const v = validarValorFiltro(f, tipo, f.valorPorDefecto, `${r} (valor por defecto)`, ctx, info.esCantidad);
                if ('error' in v) errores.push(v.error);
                else porDefecto = v.valor;
            }
            if (!f.obligatorio && (/^empresa\./.test(f.path) || tipo === 'fecha')) {
                avisos.push(`${r}: es variable y no obligatorio: si lo dejan vacío trae todas las carteras${tipo === 'fecha' ? ' sin límite de fecha' : ''}.`);
            }
        } else {
            const v = validarValorFiltro(f, tipo, f.valor, r, ctx, info.esCantidad);
            if ('error' in v) errores.push(v.error);
            else valor = v.valor;
        }

        // Vocabularios (regla 6/13): los valores tienen que ser exactos.
        const efectivo = valor ?? porDefecto;
        if (efectivo !== undefined && CON_VOCABULARIO.has(f.operador) && !info.conSelector) {
            const voc = ctx.vocabulario(f.path.trim());
            if (voc && voc.cerrado) {
                for (const x of valoresPlanos(efectivo)) {
                    if (!voc.valores.includes(x)) {
                        if (f.path.trim() === 'empresa.nombre') {
                            const parecidas = ctx.empresas.map((e) => e.nombre).filter((n) => sinAcentos(n).includes(sinAcentos(x)) || sinAcentos(x).includes(sinAcentos(n)));
                            errores.push(
                                `${r}: «${x}» no es una empresa.${parecidas.length ? ` Nombres que la contienen: ${lista(parecidas, 10)}.` : ` Usá valores_de_campo con empresa.nombre para ver los nombres exactos.`}`,
                            );
                        } else {
                            errores.push(`${r}: «${x}» no es un valor de ${f.path.trim()}. Valores: ${lista(voc.valores, 40)}.`);
                        }
                    }
                }
            }
        }
        if (f.path.trim() === 'empresa.nombre') {
            filtraEmpresa = true;
            // Con una empresa de nombre exacto se usa sin preguntar; las que empiezan igual se nombran en el mensaje.
            if (efectivo !== undefined && (f.operador === 'eq' || f.operador === 'in')) {
                const elegidas = valoresPlanos(efectivo);
                const otras = new Set<string>();
                for (const x of elegidas) for (const o of otrasConElMismoPrefijo(x, ctx.empresas)) if (!elegidas.includes(o)) otras.add(o);
                if (otras.size > 0) {
                    avisos.push(`Filtra solo por ${elegidas.join(', ')}; hay otras empresas que empiezan igual (${lista([...otras], 8)}): el mensaje de la tarjeta tiene que nombrarlas.`);
                }
            }
        }

        // El editor decide el input (fecha, número, lista) por `tipoEscalar`: sin él, un filtro variable de fecha sale como texto.
        const nf: Record<string, unknown> = { id: randomUUID(), path: f.path.trim(), operador: f.operador, tipoEscalar: info.tipo };
        if (info.enumValues) nf.enumValues = info.enumValues;
        if (valor !== undefined) nf.valor = valor;
        if (f.variable) {
            nf.variable = true;
            nf.labelVariable = (f.labelVariable ?? '').trim().slice(0, 100);
            if (f.obligatorio) nf.obligatorio = true;
            if (porDefecto !== undefined) nf.valorPorDefecto = porDefecto;
        }
        filtrosNormalizados.push(nf);
    }

    // ---- 16: ordenamientos --------------------------------------------------------------------------------------
    for (const o of def.ordenamientos ?? []) {
        const r = `Orden «${o.path}»`;
        if (o.direccion !== 'asc' && o.direccion !== 'desc') errores.push(`${r}: la dirección es asc o desc.`);
        const a = analizarPath((o.path ?? '').trim(), ind, ctx, r);
        if ('error' in a) errores.push(a.error);
        else if (a.info.porRamaMuchos || a.info.esClaveAdicional) {
            errores.push(`${r}: solo se puede ordenar por un campo del caso o de una relación de uno (empresa.nombre, saldo…), no por una rama de muchos ni por datos adicionales.`);
        }
    }

    // ---- 17: totales y agrupaciones (el esquema de la herramienta no los ofrece; se revisan igual) -------------
    const pathsColumnas = new Map(columnas.filter((c) => c.path).map((c) => [c.path.trim(), c]));
    for (const t of def.totales ?? []) {
        const c = pathsColumnas.get((t.path ?? '').trim());
        if (!c) {
            errores.push(`Total «${t.path}»: tiene que ser el path de una de las columnas.`);
            continue;
        }
        if (!['sum', 'avg', 'count', 'min', 'max'].includes(t.funcion)) errores.push(`Total «${t.path}»: la función es sum, avg, count, min o max.`);
        // Los totales se calculan sobre el texto ya formateado: "1.234" se lee como 1,234.
        if ((t.funcion === 'sum' || t.funcion === 'avg') && c.tipo === 'numero' && c.decimales === 0 && (c.separadorMiles === '.' || c.separadorMiles === ',')) {
            errores.push(
                `Columna ${etiquetaColumna(c)}: el total (${t.funcion}) se calcula sobre el texto ya formateado y con 0 decimales y «${c.separadorMiles}» de miles el número se lee mal (1${c.separadorMiles}234 como 1,234). Usá decimales de 1 a 4 o separadorMiles vacío en esa columna.`,
            );
        }
    }
    for (const g of def.agrupaciones ?? []) {
        if (!pathsColumnas.has((g.path ?? '').trim())) errores.push(`Agrupación «${g.path}»: tiene que ser el path de una de las columnas.`);
    }

    // ---- 18: formato de salida y opciones -------------------------------------------------------------------------
    const opciones = entrada.opciones ?? {};
    const permitidas = OPCIONES_POR_FORMATO[entrada.formatoSalida];
    if (!permitidas) {
        errores.push(`El formato «${entrada.formatoSalida}» no existe; usá xlsx, csv, txt o pdf.`);
    } else {
        for (const k of Object.keys(opciones)) {
            if ((opciones as Record<string, unknown>)[k] === undefined) continue;
            if (!permitidas.includes(k)) {
                errores.push(`La opción «${k}» no existe en ${entrada.formatoSalida}${permitidas.length ? ` (las que hay: ${permitidas.join(', ')})` : ': no tiene opciones'}.`);
            }
        }
    }
    for (const k of ['incluirHeader', 'bom'] as const) {
        if (opciones[k] !== undefined && typeof opciones[k] !== 'boolean') errores.push(`La opción «${k}» es true o false (sin comillas).`);
    }
    if (opciones.separador !== undefined && typeof opciones.separador !== 'string') errores.push('El separador es un texto.');
    for (const [k, validos] of [['alineacion', ['izquierda', 'derecha']], ['relleno', [' ', '0']]] as const) {
        const v = opciones[k] as unknown;
        if (v === undefined) continue;
        if (!Array.isArray(v) || v.some((x) => !(validos as readonly string[]).includes(x as string))) {
            errores.push(`La opción «${k}» es una lista con ${validos.map((x) => `«${x}»`).join(' o ')} por columna.`);
        }
    }
    if (def.cardinalidadDefault !== undefined && !CARDINALIDADES.includes(def.cardinalidadDefault)) {
        errores.push(`cardinalidadDefault «${String(def.cardinalidadDefault)}» no existe; usá ${CARDINALIDADES.join(', ')}.`);
    }
    if (opciones.separador !== undefined && typeof opciones.separador === 'string' && (Array.from(opciones.separador).length < 1 || Array.from(opciones.separador).length > 3)) {
        errores.push('El separador tiene de 1 a 3 caracteres.');
    }
    if (opciones.separador !== undefined && opciones.anchoFijo !== undefined) errores.push('separador y anchoFijo no van juntos: elegí uno.');
    if (opciones.encoding !== undefined && !['utf8', 'latin1'].includes(opciones.encoding)) errores.push('encoding es utf8 o latin1.');
    if (opciones.lineEnding !== undefined && !['\r\n', '\n'].includes(opciones.lineEnding)) errores.push('lineEnding es \\r\\n o \\n.');
    if (opciones.anchoFijo !== undefined) {
        if (!Array.isArray(opciones.anchoFijo) || opciones.anchoFijo.some((n) => !Number.isInteger(n) || n < 1 || n > 500)) {
            errores.push('anchoFijo: cada ancho es un entero de 1 a 500.');
        } else if (opciones.anchoFijo.length !== columnas.length) {
            errores.push(`anchoFijo tiene ${opciones.anchoFijo.length} anchos y hay ${columnas.length} columnas.`);
        }
    }
    for (const k of ['alineacion', 'relleno'] as const) {
        const v = opciones[k];
        if (v === undefined) continue;
        if (!ctx.capacidades.E4) errores.push(`La opción «${k}» todavía no está disponible.`);
        else if (opciones.anchoFijo === undefined) errores.push(`«${k}» solo va con anchoFijo.`);
        else if (v.length !== columnas.length) errores.push(`${k} tiene ${v.length} valores y hay ${columnas.length} columnas.`);
    }
    if (entrada.formatoSalida === 'pdf' && columnas.length > 8) {
        avisos.push(`El PDF es A4 vertical y ${columnas.length} columnas no entran bien (más de 8).`);
    }

    // ---- 19 a 21: mapeo ---------------------------------------------------------------------------------------------
    validarMapeo(entrada, columnas, ctx, errores, avisos);
    validarReferenciaClave(entrada, columnas, ctx, errores, avisos);

    // ---- 22 a 24: empresa, nombre, sin filtros -----------------------------------------------------------------------
    if (entrada.empresa !== null && entrada.empresa !== undefined) {
        if (!empresaAsociada) {
            const parecidas = ctx.empresas.map((e) => e.nombre).filter((n) => sinAcentos(n).includes(sinAcentos(entrada.empresa!)));
            errores.push(`La empresa asociada «${entrada.empresa}» no existe.${parecidas.length ? ` Nombres que la contienen: ${lista(parecidas, 10)}.` : ' Pasá null si no hace falta.'}`);
        } else if (!filtraEmpresa) {
            avisos.push(`La plantilla se asocia a ${entrada.empresa} pero no filtra por empresa: va a traer todas las carteras.`);
        }
    }
    const nombre = (entrada.nombre ?? '').trim();
    if (Array.from(nombre).length < 3 || Array.from(nombre).length > 120) errores.push('El nombre de la plantilla tiene de 3 a 120 caracteres.');
    if ((entrada.descripcion ?? '').length > 500) errores.push('La descripción tiene como máximo 500 caracteres.');
    if (nombre && ctx.nombresPlantillas?.has(nombre.toLowerCase())) avisos.push(`Ya existe una plantilla activa llamada «${nombre}».`);
    if (filtros.length === 0) avisos.push('Sin filtros trae la cartera entera.');

    if (errores.length > 0) return { errores, avisos };

    // ---- normalizada --------------------------------------------------------------------------------------------------
    const normalizada = normalizar(entrada, columnas, infoColumna, filtrosNormalizados, empresaAsociada?.id ?? null);

    // Exactamente las reglas del alta: el DTO (class-validator), `validarDefinicion` y `validarOpcionesFormato`.
    const delAlta = reglasDelAlta(normalizada);
    if (delAlta.length > 0) return { errores: delAlta, avisos };
    return { errores, avisos, normalizada };
}

function mensajesDeValidacion(es: ValidationError[], prefijo = ''): string[] {
    const out: string[] = [];
    for (const e of es) {
        const ruta = `${prefijo}${prefijo ? '.' : ''}${e.property}`;
        if (e.constraints) out.push(`${ruta}: ${Object.values(e.constraints).join('; ')}`);
        if (e.children?.length) out.push(...mensajesDeValidacion(e.children, ruta));
    }
    return out;
}

/** Lo que correría el alta (`POST /reportes/plantillas`) sobre la plantilla normalizada. Devuelve los errores, en castellano o con el campo. */
export function reglasDelAlta(n: PlantillaNormalizada): string[] {
    const dto = plainToInstance(CreatePlantillaDto, {
        nombre: n.nombre,
        descripcion: n.descripcion ?? undefined,
        raiz: n.raiz,
        empresaId: n.empresaId ?? undefined,
        definicion: n.definicion,
        formatoSalida: n.formatoSalida,
        opcionesFormato: n.opcionesFormato,
    });
    const delDto = mensajesDeValidacion(validateSync(dto, { whitelist: false }));
    if (delDto.length > 0) return delDto.map((m) => `La plantilla no se podría guardar (${m}).`);
    try {
        validarDefinicion(dto.definicion, 'deudor');
        validarOpcionesFormato(dto.definicion.columnas, dto.opcionesFormato);
    } catch (e: any) {
        return [String(e?.message ?? 'La definición no pasó la validación del motor.')];
    }
    return [];
}

function verificarClave(clave: string, path: string, r: string, empresa: string | null, ctx: ContextoValidacion, errores: string[]): void {
    if (!empresa) {
        errores.push(`${r}: «${path}» es un dato adicional y la plantilla no tiene empresa asociada; poné la empresa del cedente en «empresa».`);
    } else if (ctx.clavesAdicionales === null) {
        errores.push(`${r}: no pude leer los datos adicionales de ${empresa}; pedilos con datos_adicionales.`);
    } else if (!ctx.clavesAdicionales.includes(clave)) {
        errores.push(`${r}: «${path}»: ${empresa} no tiene esa clave.${ctx.clavesAdicionales.length ? ` Claves: ${lista(ctx.clavesAdicionales, 30)}.` : ' No manda datos adicionales.'}`);
    }
}

function validarTipoColumna(c: ColumnaEntrada, info: InfoPath, r: string, ctx: ContextoValidacion, errores: string[]): void {
    // Las mismas reglas que el alta (enums y tipos del DTO): lo que se guardaría distinto o no se podría guardar es error.
    if (c.tipo !== undefined && !TIPOS_COLUMNA.includes(c.tipo)) errores.push(`${r}: el tipo «${String(c.tipo)}» no existe; los tipos son ${TIPOS_COLUMNA.join(', ')}.`);
    if (c.cardinalidad !== undefined && !CARDINALIDADES.includes(c.cardinalidad)) errores.push(`${r}: la cardinalidad «${String(c.cardinalidad)}» no existe; usá ${CARDINALIDADES.join(', ')}.`);
    if (c.separadorDecimal !== undefined && ![',', '.'].includes(c.separadorDecimal)) errores.push(`${r}: separadorDecimal es «,» o «.».`);
    if (c.separadorMiles !== undefined && !['.', ',', ''].includes(c.separadorMiles)) errores.push(`${r}: separadorMiles es «.», «,» o vacío.`);
    if (c.decimales !== undefined && !Number.isInteger(c.decimales)) errores.push(`${r}: decimales es un entero de 0 a 4.`);
    if (c.formato !== undefined && typeof c.formato !== 'string') errores.push(`${r}: formato es un texto.`);
    if (c.separadorConcat !== undefined && typeof c.separadorConcat !== 'string') errores.push(`${r}: separadorConcat es un texto.`);
    const tieneE3 = c.decimales !== undefined || c.separadorDecimal !== undefined || c.separadorMiles !== undefined;
    if (tieneE3 && c.tipo !== 'numero') errores.push(`${r}: decimales y separadores solo van con tipo numero.`);
    if (c.tipo === 'numero' && info.tipo !== 'numero') errores.push(`${r}: el tipo numero necesita un campo numérico y «${c.path}» es ${info.tipo}.`);
    if (c.tipo === 'fecha' && info.tipo !== 'fecha') errores.push(`${r}: el tipo fecha necesita un campo de fecha y «${c.path}» es ${info.tipo}.`);
    if (c.tipo === 'boolean' && info.tipo !== 'boolean') errores.push(`${r}: el tipo boolean necesita un campo sí/no y «${c.path}» es ${info.tipo}.`);
    if (c.tipo === 'telefono' && info.tipo !== 'texto') errores.push(`${r}: el tipo telefono necesita un campo de texto con un teléfono.`);
    if (c.tipo === 'dias') {
        if (!ctx.capacidades.E2) errores.push(`${r}: el tipo dias todavía no está disponible; usá una fecha y marcala como aproximada.`);
        else if (info.tipo !== 'fecha') errores.push(`${r}: el tipo dias necesita un campo de fecha.`);
    }
    if (c.formato !== undefined && c.tipo === 'fecha' && !validarFormatoFecha(c.formato)) {
        errores.push(`${r}: el formato de fecha «${c.formato}» no vale; usá DD, MM, YYYY (YY, HH, mm, ss) y separadores, por ejemplo DD/MM/YYYY.`);
    }
    if (tieneE3) {
        if (!ctx.capacidades.E3) errores.push(`${r}: decimales y separadores todavía no están disponibles.`);
        if (c.decimales !== undefined && (!Number.isInteger(c.decimales) || c.decimales < 0 || c.decimales > 4)) errores.push(`${r}: decimales va de 0 a 4.`);
        if (c.separadorDecimal && c.separadorDecimal === c.separadorMiles) errores.push(`${r}: el separador decimal y el de miles no pueden ser el mismo.`);
    }
    if (c.tipo === 'telefono' && c.formatoTelefonoId !== undefined && !ctx.formatosTelefonoIds.has(c.formatoTelefonoId)) {
        errores.push(`${r}: el formato de teléfono ${c.formatoTelefonoId} no existe o no está activo; pedí los formatos con valores_de_campo («formatos_telefono»).`);
    }
    if (c.formatoTelefonoId !== undefined && c.tipo !== 'telefono') errores.push(`${r}: formatoTelefonoId solo va con tipo telefono.`);
}

function validarMapeo(entrada: EntradaProbar, columnas: ColumnaEntrada[], ctx: ContextoValidacion, errores: string[], avisos: string[]): void {
    const mapeo = entrada.mapeo ?? [];
    const labels = new Map(columnas.map((c) => [sinAcentos(c.label), c]));
    const ej = ctx.ejemploPrincipal;
    const hojaEj = ej ? (ej.perfil.hojas[ej.hoja] ?? ej.perfil.hojas[0]) : null;
    const nombresEj = hojaEj ? hojaEj.columnas.map((c) => c.encabezado ?? `columna ${c.n}`) : [];

    const porLabel = new Map<string, number>();
    for (const m of mapeo) {
        const k = sinAcentos(m.label ?? '');
        porLabel.set(k, (porLabel.get(k) ?? 0) + 1);
        const c = labels.get(k);
        if (!c) {
            errores.push(`El mapeo menciona la columna «${m.label}» y la plantilla no la tiene.`);
            continue;
        }
        const fija = !c.path || c.path.trim() === '';
        if (m.estado === 'sin_campo' && !fija) errores.push(`Mapeo de ${etiquetaColumna(c)}: sin_campo es una columna fija (path vacío); esta tiene path.`);
        if ((m.estado === 'exacta' || m.estado === 'aproximada') && fija) errores.push(`Mapeo de ${etiquetaColumna(c)}: dice ${m.estado} pero la columna es fija (sin campo); usá sin_campo.`);
        if ((m.estado === 'aproximada' || m.estado === 'sin_campo') && (m.nota ?? '').trim() === '') {
            errores.push(`Mapeo de ${etiquetaColumna(c)}: explicá en nota ${m.estado === 'aproximada' ? 'en qué difiere del campo del ejemplo' : 'qué falta'}.`);
        }
    }
    for (const c of columnas) {
        const veces = porLabel.get(sinAcentos(c.label)) ?? 0;
        if (veces === 0) errores.push(`Falta en el mapeo la columna ${etiquetaColumna(c)}.`);
        else if (veces > 1) errores.push(`La columna ${etiquetaColumna(c)} está más de una vez en el mapeo.`);
    }

    if (!hojaEj) {
        // Regla 20: sin ejemplo, todo es agregada.
        for (const m of mapeo) {
            if (m.estado !== 'agregada' || m.columnaEjemplo) {
                errores.push(`Mapeo de «${m.label}»: no hay archivo de ejemplo en la conversación; todas las columnas van como agregada (columnaEjemplo null).`);
                break;
            }
        }
        return;
    }

    // Regla 19: con ejemplo, cada columna del ejemplo aparece exactamente una vez.
    const norm = (s: string) => sinAcentos(s);
    const indiceDe = (nombre: string) => nombresEj.findIndex((n) => norm(n) === norm(nombre));
    const usadas = new Map<number, number>();
    for (const m of mapeo) {
        if (m.columnaEjemplo === null || m.columnaEjemplo === undefined) {
            if (m.estado !== 'agregada') errores.push(`Mapeo de «${m.label}»: ${m.estado} necesita columnaEjemplo; si no es del ejemplo, usá agregada.`);
            continue;
        }
        if (m.estado === 'agregada') {
            errores.push(`Mapeo de «${m.label}»: agregada es para columnas que no están en el ejemplo (columnaEjemplo null).`);
            continue;
        }
        const i = indiceDe(m.columnaEjemplo);
        if (i < 0) {
            errores.push(`Mapeo de «${m.label}»: «${m.columnaEjemplo}» no es una columna del ejemplo. Columnas: ${lista(nombresEj, 30)}.`);
            continue;
        }
        usadas.set(i, (usadas.get(i) ?? 0) + 1);
    }
    const faltan = nombresEj.filter((_, i) => !usadas.has(i));
    if (faltan.length > 0) errores.push(`Faltan en el mapeo columnas del ejemplo: ${faltan.join(', ')}.`);
    const repetidas = nombresEj.filter((_, i) => (usadas.get(i) ?? 0) > 1);
    if (repetidas.length > 0) errores.push(`Estas columnas del ejemplo están más de una vez en el mapeo: ${repetidas.join(', ')}.`);

    // Regla 21: el orden de las columnas es el del ejemplo.
    const ordenEnPlantilla = columnas
        .map((c) => {
            const m = mapeo.find((x) => sinAcentos(x.label) === sinAcentos(c.label));
            return m && m.columnaEjemplo ? indiceDe(m.columnaEjemplo) : -1;
        })
        .filter((i) => i >= 0);
    if (ordenEnPlantilla.some((v, i) => i > 0 && v < ordenEnPlantilla[i - 1])) {
        avisos.push('Las columnas no están en el mismo orden que el ejemplo.');
    }
}

/**
 * `pagos.referenciaClave` es el número de convenio de 8 dígitos de una clave de pago, no un ID de operación. Si la forma
 * de los valores del ejemplo (letras, guiones, largo) no puede ser la de un campo de 8 dígitos, no es el mismo dato.
 */
function validarReferenciaClave(entrada: EntradaProbar, columnas: ColumnaEntrada[], ctx: ContextoValidacion, errores: string[], avisos: string[]): void {
    const ej = ctx.ejemploPrincipal;
    const hoja = ej ? (ej.perfil.hojas[ej.hoja] ?? ej.perfil.hojas[0]) : null;
    if (!hoja) return;
    for (const c of columnas) {
        if (!/(^|\.)referenciaClave$/.test((c.path ?? '').replace(/\[[^\]]*\]/g, ''))) continue;
        const m = (entrada.mapeo ?? []).find((x) => sinAcentos(x.label) === sinAcentos(c.label));
        if (!m?.columnaEjemplo) continue;
        const col = hoja.columnas.find((x) => sinAcentos(x.encabezado ?? `columna ${x.n}`) === sinAcentos(m.columnaEjemplo!));
        if (!col || col.formas.length === 0) continue;
        if (col.formas.some((f) => /^9{8}$/.test(f))) continue;
        const texto = `Columna ${etiquetaColumna(c)}: los valores del ejemplo tienen la forma ${col.formas.join(' · ')} y referenciaClave es el número de convenio de 8 dígitos de una clave de pago, no un ID de operación. Si el ejemplo trae el identificador del cobro, el campo es pagos.idExterno; si no hay un campo equivalente, columna fija (sin_campo).`;
        if (m.estado === 'exacta') errores.push(texto);
        else avisos.push(texto);
    }
}

function normalizar(
    entrada: EntradaProbar,
    columnas: ColumnaEntrada[],
    info: Map<ColumnaEntrada, InfoPath | null>,
    filtros: Record<string, unknown>[],
    empresaId: number | null,
): PlantillaNormalizada {
    const def = entrada.definicion;
    const cols = columnas.map((c) => {
        const i = info.get(c);
        const out: Record<string, unknown> = { id: randomUUID(), path: (c.path ?? '').trim(), label: c.label.trim() };
        if (!i) {
            if (c.valorFijo) out.valorFijo = c.valorFijo;
            return out;
        }
        // Un campo de fecha sin tipo sale como un Date crudo: se declara.
        const tipo = c.tipo ?? (i.tipo === 'fecha' ? 'fecha' : undefined);
        if (tipo) out.tipo = tipo;
        if (tipo === 'fecha') out.formato = c.formato ?? 'DD/MM/YYYY';
        if (tipo === 'numero') {
            if (c.decimales !== undefined) out.decimales = c.decimales;
            if (c.separadorDecimal !== undefined) out.separadorDecimal = c.separadorDecimal;
            if (c.separadorMiles !== undefined) out.separadorMiles = c.separadorMiles;
        }
        if (tipo === 'telefono' && c.formatoTelefonoId !== undefined) out.formatoTelefonoId = c.formatoTelefonoId;
        if (i.porRamaMuchos && !i.conSelector) {
            if (c.cardinalidad) out.cardinalidad = c.cardinalidad;
            if (c.separadorConcat !== undefined) out.separadorConcat = c.separadorConcat.slice(0, 10);
        }
        return out;
    });
    const formato = entrada.formatoSalida;
    const opciones: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entrada.opciones ?? {})) if (v !== undefined) opciones[k] = v;
    const definicion: PlantillaNormalizada['definicion'] = {
        columnas: cols,
        filtros,
        ordenamientos: (def.ordenamientos ?? []).map((o) => ({ path: o.path.trim(), direccion: o.direccion })),
        cardinalidadDefault: def.cardinalidadDefault ?? 'concatenar',
    };
    if (def.totales?.length) definicion.totales = def.totales.map((t) => ({ ...t }));
    if (def.agrupaciones?.length) definicion.agrupaciones = def.agrupaciones.map((g) => ({ ...g }));
    return {
        nombre: entrada.nombre.trim(),
        descripcion: entrada.descripcion?.trim() ? entrada.descripcion.trim().slice(0, 500) : null,
        raiz: 'deudor',
        empresaId,
        definicion,
        formatoSalida: formato,
        opcionesFormato: { [formato]: opciones },
    };
}
