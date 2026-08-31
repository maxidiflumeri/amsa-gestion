// utils/filtro-filas.ts
//
// Filtro que decide, mirando la fila cruda, si vale la pena importarla.
//
// Nace del archivo de novedades de AYSA, que mezcla en un mismo TXT los cobros con los cambios de
// situación que no mueven plata: de 4.552 filas, solo 1.997 traen un importe cobrado. Sin filtrar,
// el import genera 2.555 pagos de $0 —basura que después hay que salir a limpiar de la cartera.
//
// Es a propósito **una decisión de la plantilla y no del processor**: cuál es el subconjunto útil de
// un archivo depende de qué manda el cedente, y eso cambia sin deploy.
//
// Las filas descartadas **no son errores**: no van a `importerror` ni cuentan como fila fallida. Se
// informan aparte, que es lo que el operador necesita para confirmar que el filtro hace lo que cree.

import { FiltroFila } from '../mapping-types';

/** Resuelve el valor de la columna como texto, ya trimeado. */
const texto = (fila: any[], i: number): string => String(fila?.[i] ?? '').trim();

/**
 * Convierte a número los importes que mandan los cedentes: vienen paddeados a la derecha y a veces
 * con coma decimal. Devuelve `NaN` si no es un número, y entonces las comparaciones numéricas fallan
 * —una fila que no se puede comparar no pasa el filtro, en vez de colarse por default.
 */
const numero = (s: string): number => (s === '' ? NaN : Number(s.replace(/\./g, '').replace(',', '.')));

/**
 * Evalúa una condición sobre una fila.
 *
 * Las comparaciones de texto son sin distinguir mayúsculas, porque los códigos de los cedentes
 * llegan en cualquier caja (`E` / `e`, `Pagado` / `PAGADO`).
 */
function cumple(fila: any[], f: FiltroFila): boolean {
    const v = texto(fila, f.fromIndex);
    const ref = String(f.valor ?? '').trim();

    switch (f.operador) {
        case 'VACIO':
            return v === '';
        case 'NO_VACIO':
            return v !== '';
        case 'IGUAL':
            return v.toLowerCase() === ref.toLowerCase();
        case 'DISTINTO':
            return v.toLowerCase() !== ref.toLowerCase();
        case 'CONTIENE':
            return v.toLowerCase().includes(ref.toLowerCase());
        case 'EN':
            // Una lista de valores exactos, no un "contiene": la usa la división para aislar un
            // corte que agrupó varias variantes de la misma gestión.
            return (f.valores ?? []).some((x) => String(x ?? '').trim().toLowerCase() === v.toLowerCase());
        case 'MAYOR': {
            const n = numero(v);
            return Number.isFinite(n) && n > numero(ref);
        }
        case 'MENOR': {
            const n = numero(v);
            return Number.isFinite(n) && n < numero(ref);
        }
        default:
            // Un operador desconocido (plantilla de una versión más nueva) no debe descartar media
            // cartera en silencio: se ignora la condición.
            return true;
    }
}

/**
 * ¿Se procesa esta fila?
 *
 * Las condiciones se combinan con **Y**: la fila entra solo si las cumple todas. Sin filtros
 * declarados, entran todas — que es el comportamiento de siempre.
 */
export function pasaFiltro(fila: any[], filtros: FiltroFila[] | undefined): boolean {
    if (!filtros?.length) return true;
    return filtros.every((f) => cumple(fila, f));
}

/** Describe los filtros en una línea, para el log del worker y el resumen del preview. */
export function describirFiltros(filtros: FiltroFila[] | undefined): string {
    if (!filtros?.length) return '';
    return filtros
        .map((f) => {
            const ref = f.operador === 'EN'
                ? ` "${(f.valores ?? []).join(', ')}"`
                : f.valor != null && f.valor !== '' ? ` "${f.valor}"` : '';
            return `col ${f.fromIndex} ${f.operador}${ref}`;
        })
        .join(' y ');
}
