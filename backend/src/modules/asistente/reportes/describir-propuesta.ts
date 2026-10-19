import { esFechaRelativa } from '../../../common/utils/dia-local';
import { NodoCatalogo } from '../../reportes/dto/catalogo.dto';
import { PathParser } from '../../reportes/parser/path-parser';
import { FilaMapeo } from '../dto/asistente.tipos';
import { nodosVisibles } from './prompt/catalogo-compacto';
import { EntradaProbar, PlantillaNormalizada } from './tipos-reportes';

/**
 * Los textos de la tarjeta (docs/asistente-reportes-spec.md §6.4 y §16.2). Los arma el backend con las etiquetas del
 * catálogo, NO el modelo: es la forma de que la persona vea qué campo se eligió de verdad.
 */

const parser = new PathParser();

const ORDINAL = ['1.º', '2.º', '3.º', '4.º', '5.º', '6.º', '7.º', '8.º', '9.º', '10.º'];
const NOMBRE_TIPO: Record<string, string> = { telefono: 'teléfono', email: 'email', direccion: 'domicilio' };
const GENERICAS = new Set(['Nombre', 'Email', 'Texto', 'Fecha']);

function dmy(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}

export class Descriptor {
    private readonly nodos = new Map<string, NodoCatalogo>();
    constructor(catalogo: NodoCatalogo[]) {
        for (const n of nodosVisibles(catalogo)) this.nodos.set(n.path, n);
    }

    etiquetaDeCampo(path: string): string {
        const n = this.nodos.get(path);
        if (!n) return path;
        const padre = this.nodos.get(path.split('.').slice(0, -1).join('.'));
        if (padre && GENERICAS.has(n.label) && padre.tipo === 'relacion-1-1') return `${padre.label} · ${n.label}`;
        return n.label;
    }

    /** "Documento", "Teléfono / email / dirección · 2.º teléfono", "Importe del pago · el más reciente". */
    saleDe(path: string, cardinalidad?: { cardinalidad?: string; separadorConcat?: string }): string {
        const p = (path ?? '').trim();
        if (p === '') return 'Columna vacía';
        let ast;
        try {
            ast = parser.parse(p);
        } catch {
            return p;
        }
        const nombres = ast.segments.map((s) => s.name);
        const sinMod = nombres.join('.');
        const clave = /^camposAdicionales\.(.+)$/.exec(sinMod);
        const ultimoSeg = ast.segments[ast.segments.length - 1];
        const cuenta = ultimoSeg.modifiers.some((m) => m.type === 'aggregator' && m.aggregator === 'count');
        const partes: string[] = [];

        if (clave) partes.push(`Dato adicional del cedente · ${clave[1]}`);
        else if (cuenta) partes.push(`${this.nodos.get(sinMod)?.label ?? sinMod} · cantidad`);
        else partes.push(this.etiquetaDeCampo(sinMod));

        // Los selectores de la rama que lleva al campo.
        let prefijo = '';
        for (const seg of ast.segments) {
            prefijo = prefijo ? `${prefijo}.${seg.name}` : seg.name;
            const filtros = seg.modifiers.filter((m) => m.type === 'filter').flatMap((m) => (m.type === 'filter' ? m.filters : []));
            const tipoContacto = filtros.find((f) => f.field === 'tipo' && seg.name === 'contactos')?.value;
            const otros = filtros.filter((f) => !(f.field === 'tipo' && seg.name === 'contactos'));
            for (const m of seg.modifiers) {
                if (m.type === 'indexer') {
                    const que = tipoContacto ? (NOMBRE_TIPO[tipoContacto] ?? tipoContacto) : (this.nodos.get(prefijo)?.label ?? seg.name).toLowerCase();
                    partes.push(`${ORDINAL[m.index] ?? `${m.index + 1}.º`} ${que}${m.index === 0 && tipoContacto ? ' cargado' : ''}`);
                } else if (m.type === 'aggregator' && m.aggregator !== 'count') {
                    partes.push({ sum: 'suma', avg: 'promedio', min: 'el menor', max: 'el mayor', first: 'el primero cargado', last: 'el más reciente', concat: 'todos juntos' }[m.aggregator]);
                }
            }
            if (tipoContacto && seg.modifiers.every((m) => m.type !== 'indexer')) partes.push(NOMBRE_TIPO[tipoContacto] ?? tipoContacto);
            for (const f of otros) partes.push(`${f.field} ${f.value}`);
        }
        // Qué sale de una rama de muchos cuando el path no elige uno con [0], [last], [sum]… (la cardinalidad de la columna).
        if (cardinalidad && !cuenta) {
            let pref = '';
            let rama: string | null = null;
            let elige = false;
            for (const seg of ast.segments) {
                pref = pref ? `${pref}.${seg.name}` : seg.name;
                if (this.nodos.get(pref)?.tipo === 'relacion-1-n') {
                    rama = (this.nodos.get(pref)?.label ?? seg.name).toLowerCase();
                    elige = seg.modifiers.some((m) => m.type === 'indexer' || (m.type === 'aggregator' && m.aggregator !== 'count'));
                }
            }
            if (rama && !elige) {
                const c = cardinalidad.cardinalidad ?? 'concatenar';
                partes.push(
                    c === 'ultimo'
                        ? `el último cargado (${rama})`
                        : c === 'primero'
                          ? `el primero cargado (${rama})`
                          : c === 'expandir'
                            ? `una fila por cada uno (${rama})`
                            : `todos (${rama}), separados por «${cardinalidad.separadorConcat ?? ', '}»`,
                );
            }
        }
        return partes.join(' · ');
    }

    formatoColumna(c: Record<string, unknown>, formatosTelefono: ReadonlyMap<number, string>): string | null {
        const tipo = c.tipo as string | undefined;
        if (tipo === 'fecha') return (c.formato as string) ?? 'DD/MM/YYYY';
        if (tipo === 'dias') {
            const campo = this.etiquetaDeCampo(String(c.path).replace(/\[[^\]]*\]/g, ''));
            return `Días desde: ${campo.toLowerCase()}`;
        }
        if (tipo === 'numero') {
            const dec = c.decimales as number | undefined;
            if (dec === undefined && c.separadorDecimal === undefined && c.separadorMiles === undefined) return null;
            const partes: string[] = [];
            if (dec !== undefined) partes.push(dec === 0 ? 'sin decimales' : `${dec} ${dec === 1 ? 'decimal' : 'decimales'}`);
            const sd = (c.separadorDecimal as string | undefined) ?? ',';
            const sm = (c.separadorMiles as string | undefined) ?? '.';
            partes.push(sd === ',' ? 'coma decimal' : 'punto decimal');
            partes.push(sm === '' ? 'sin separador de miles' : sm === '.' ? 'punto de miles' : 'coma de miles');
            return partes.join(', ');
        }
        if (tipo === 'telefono') {
            const id = c.formatoTelefonoId as number | undefined;
            return id !== undefined ? `Teléfono: ${formatosTelefono.get(id) ?? `formato ${id}`}` : 'Teléfono de 10 dígitos';
        }
        if (tipo === 'boolean') return 'Sí / No';
        return null;
    }

    mapeo(entrada: EntradaProbar, n: PlantillaNormalizada, formatosTelefono: ReadonlyMap<number, string>): FilaMapeo[] {
        const porLabel = new Map(entrada.mapeo.map((m) => [m.label.trim().toLowerCase(), m]));
        return n.definicion.columnas.map((c) => {
            const m = porLabel.get(String(c.label).trim().toLowerCase());
            return {
                columnaEjemplo: m?.columnaEjemplo ?? null,
                label: String(c.label),
                estado: m?.estado ?? 'agregada',
                nota: (m?.nota ?? '').trim().slice(0, 200),
                saleDe: this.saleDe(String(c.path), { cardinalidad: (c.cardinalidad as string | undefined) ?? n.definicion.cardinalidadDefault, separadorConcat: c.separadorConcat as string | undefined }),
                formato: this.formatoColumna(c, formatosTelefono),
            };
        });
    }

    private valorFecha(v: unknown, hoy: string, op: string, relativoPrefijo: boolean): string {
        const s = String(v);
        if (esFechaRelativa(s)) {
            if (s === 'hoy') return 'hoy';
            const m = /^hoy([+-])(\d+)$/.exec(s)!;
            const dias = Number(m[2]);
            const unidad = dias === 1 ? 'día' : 'días';
            return m[1] === '-' ? `hace ${dias} ${unidad}` : `dentro de ${dias} ${unidad}`;
        }
        void op;
        void relativoPrefijo;
        return dmy(s);
    }

    filtros(n: PlantillaNormalizada, hoy: string): string[] {
        return n.definicion.filtros.map((f) => {
            const path = String(f.path);
            const nodo = this.nodos.get(path.replace(/\[[^\]]*\]/g, ''));
            const etiqueta = /\[count\]/.test(path) ? `${this.saleDe(path)}` : this.etiquetaDeCampo(path);
            const op = String(f.operador);
            const esFecha = nodo?.tipoEscalar === 'fecha';
            if (f.variable) {
                return `${etiqueta}: se pide al ejecutar (${String(f.labelVariable ?? 'sin nombre')}${f.obligatorio ? ', obligatorio' : ''})`;
            }
            const v = f.valor;
            const SIMBOLO: Record<string, string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
            if (/\[count\]/.test(path) && SIMBOLO[op]) return `${etiqueta}: ${SIMBOLO[op]} ${String(v)}`;
            const val = (x: unknown) => (esFecha ? this.valorFecha(x, hoy, op, true) : String(x));
            const lista = (a: unknown) => (Array.isArray(a) ? a.map(val).join(', ') : val(a));
            const relativo = esFecha && esFechaRelativa(Array.isArray(v) ? v[0] : v);
            const detalleHoy = relativo && !(Array.isArray(v)) && String(v) !== 'hoy' ? ` (hoy, ${dmy(hoy)})` : relativo && Array.isArray(v) ? ` (hoy, ${dmy(hoy)})` : '';
            switch (op) {
                case 'eq':
                    return `${etiqueta}: ${esFecha && relativo ? this.valorFecha(v, hoy, op, true) : val(v)}`;
                case 'neq':
                    return `${etiqueta}: distinto de ${val(v)}`;
                case 'in':
                    return `${etiqueta}: ${lista(v)}`;
                case 'notIn':
                    return `${etiqueta}: ninguno de ${lista(v)}`;
                case 'contains':
                    return `${etiqueta}: contiene «${String(v)}»`;
                case 'startsWith':
                    return `${etiqueta}: empieza con «${String(v)}»`;
                case 'endsWith':
                    return `${etiqueta}: termina con «${String(v)}»`;
                case 'gt':
                    return `${etiqueta}: mayor que ${val(v)}`;
                case 'gte':
                    return `${etiqueta}: ${esFecha ? 'desde' : 'al menos'} ${val(v)}${detalleHoy}`;
                case 'lt':
                    return `${etiqueta}: menor que ${val(v)}`;
                case 'lte':
                    return `${etiqueta}: ${esFecha ? 'hasta' : 'como máximo'} ${val(v)}${detalleHoy}`;
                case 'between': {
                    const [a, b] = v as unknown[];
                    return `${etiqueta}: entre ${val(a)} y ${val(b)}${detalleHoy}`;
                }
                case 'notBetween': {
                    const [a, b] = v as unknown[];
                    return `${etiqueta}: fuera de ${val(a)} a ${val(b)}${detalleHoy}`;
                }
                case 'isNull':
                    return `${etiqueta}: sin dato`;
                case 'isNotNull':
                    return `${etiqueta}: con dato`;
                default:
                    return `${etiqueta}: ${op} ${val(v)}`;
            }
        });
    }

    orden(n: PlantillaNormalizada): string[] {
        return n.definicion.ordenamientos.map((o) => `${this.etiquetaDeCampo(o.path)} (${o.direccion === 'asc' ? 'menor a mayor' : 'mayor a menor'})`);
    }
}

/** "Separador ;", "Sin BOM", "Ancho fijo: 6 columnas", "latin1". */
export function describirOpciones(n: PlantillaNormalizada): string[] {
    const o = (n.opcionesFormato[n.formatoSalida] ?? {}) as Record<string, any>;
    const out: string[] = [];
    if (o.separador !== undefined) out.push(`Separador ${o.separador === '\t' ? 'tabulación' : o.separador}`);
    if (Array.isArray(o.anchoFijo)) out.push(`Ancho fijo: ${o.anchoFijo.length} columnas`);
    if (Array.isArray(o.alineacion) && o.alineacion.includes('derecha')) out.push('Algunas columnas alineadas a la derecha');
    if (Array.isArray(o.relleno) && o.relleno.includes('0')) out.push('Relleno con ceros');
    if (o.bom === false) out.push('Sin BOM');
    if (o.incluirHeader === false) out.push('Sin fila de encabezado');
    if (o.encoding === 'latin1') out.push('latin1');
    if (o.lineEnding === '\n') out.push('Fin de línea LF');
    return out;
}
