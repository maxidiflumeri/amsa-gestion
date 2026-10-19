import { NodoCatalogo } from '../../../reportes/dto/catalogo.dto';
import { campoFinal } from '../../../reportes/validador/definicion-validator';

/**
 * El catálogo de campos en formato compacto, una línea por campo (docs/asistente-reportes-spec.md §7.2): 170 nodos que
 * en JSON miden 40.000 caracteres y acá ~11.000. Va entero en el `system` cacheado, así que es DETERMINISTA: sin fecha,
 * sin datos de nadie, orden estable.
 *
 * No incluye lo que `campos-sensibles.ts` bloquea (credenciales y datos de usuarios): lo que el motor no deja pedir
 * tampoco se le muestra al modelo. Ni `remesa.filtroFilas` ni `remesa.divisionValores` (JSON técnico).
 */

export const PATHS_EXCLUIDOS = new Set<string>(['remesa.filtroFilas', 'remesa.divisionValores']);

/**
 * Descripciones propias del asistente para campos que el modelo confunde (el catálogo del motor no se toca). R05 del set de
 * evaluación: «Nro Operación» (OP-90001) se mapeaba a `referenciaClave` en las 4 corridas.
 */
export const DESCRIPCIONES_ASISTENTE: Record<string, string> = {
  'pagos.referenciaClave': 'Número de convenio de 8 dígitos de una clave de pago (Telecom/Personal); NO es un ID de operación',
  'pagos.idExterno': 'Identificador del cobro en el sistema del cedente (PAYMENT_ID); el «número de operación» de un archivo de pagos',
};

const TIPOS: Record<string, string> = { texto: 'texto', numero: 'número', fecha: 'fecha', boolean: 'sí/no', enum: 'lista' };

/** ¿El motor deja usar este campo? (misma lista de bloqueo que `validarDefinicion`). */
export function esVisibleParaElModelo(path: string): boolean {
    if (PATHS_EXCLUIDOS.has(path)) return false;
    const r = campoFinal('deudor', { raw: path, segments: path.split('.').map((name) => ({ name, modifiers: [] })) });
    return r.existe && !r.bloqueado;
}

function linea(n: NodoCatalogo, sangria: string): string {
    const etiqueta = n.label && n.label !== n.nombre ? ` · ${n.label}` : '';
    const descripcion = DESCRIPCIONES_ASISTENTE[n.path] ?? n.descripcion;
    const nota = descripcion ? ` — ${descripcion}` : '';
    if (n.tipo === 'escalar') {
        const tipo = TIPOS[n.tipoEscalar ?? 'texto'] ?? 'texto';
        const valores = n.enumValues?.length ? ` (${n.enumValues.join('|')})` : '';
        return `${sangria}${n.path} [${tipo}${valores}]${etiqueta}${nota}`;
    }
    if (n.tipo === 'json') return `${sangria}${n.path} [datos adicionales: <clave> se pide con datos_adicionales]${etiqueta}${nota}`;
    const card = n.tipo === 'relacion-1-n' ? 'muchos' : 'uno';
    return `${sangria}${n.path} [${card}]${etiqueta}${nota}`;
}

function recorrer(nodos: NodoCatalogo[], sangria: string, out: string[]): void {
    for (const n of nodos) {
        if (!esVisibleParaElModelo(n.path)) continue;
        out.push(linea(n, sangria));
        if (n.hijos?.length) recorrer(n.hijos, sangria, out);
    }
}

/** El árbol de nodos visibles para el modelo, aplanado en orden (también lo usa el validador). */
export function nodosVisibles(nodos: NodoCatalogo[]): NodoCatalogo[] {
    const out: NodoCatalogo[] = [];
    const rec = (ns: NodoCatalogo[]) => {
        for (const n of ns) {
            if (!esVisibleParaElModelo(n.path)) continue;
            out.push(n);
            if (n.hijos?.length) rec(n.hijos);
        }
    };
    rec(nodos);
    return out;
}

export function catalogoCompacto(nodos: NodoCatalogo[]): string {
    const out: string[] = [];
    out.push('Cada línea: path [tipo] · etiqueta. [uno] es una relación de uno (empresa.nombre); [muchos] es una rama de muchos (contactos, pagos…).');
    recorrer(nodos, '', out);
    return out.join('\n');
}
