// Errores de una carga: qué es un aviso y qué una fila, y el formato del CSV
// (docs/imports-progreso-c2-spec.md §5.3 y §5.4). Funciones puras.
import type { Prisma } from '@prisma/client';
import type { TipoErrorDeCarga } from '../historial.types';

/** Un aviso empieza con uno de estos prefijos y se guarda con `rowNumber` 0. */
export const PREFIJOS_DE_AVISO = ['[aviso]', '[parseo]', '[post-proceso]'] as const;

/** `rowNumber` 0 es la primera fila procesada: la posición que se muestra cuenta desde 1. */
export const BASE_DE_FILA = 1;

/** Tope de registros de un CSV de errores. Constante a propósito: no es una variable de entorno. */
export const MAX_FILAS_CSV_ERRORES = 200_000;

const REGEX_AVISO = /^\[(aviso|parseo|post-proceso)\]/i;

/** Un aviso es rowNumber 0 Y uno de los tres prefijos. Sin distinguir mayúsculas, como la base. */
export function tipoDeError(rowNumber: number, errorMsg: string): TipoErrorDeCarga {
    return rowNumber === 0 && REGEX_AVISO.test(errorMsg ?? '') ? 'AVISO' : 'FILA';
}

/** Posición de la fila contando desde 1; null en un aviso. */
export function numeroDeFila(rowNumber: number, tipo: TipoErrorDeCarga): number | null {
    return tipo === 'AVISO' ? null : rowNumber + BASE_DE_FILA;
}

function condicionAviso(): Prisma.importerrorWhereInput {
    return {
        rowNumber: 0,
        OR: PREFIJOS_DE_AVISO.map((p) => ({ errorMsg: { startsWith: p } })),
    };
}

/** Los avisos de una carga. Es la misma definición que arma el runner al cerrar. */
export function whereAvisos(remesaId: number): Prisma.importerrorWhereInput {
    return { remesaId, ...condicionAviso() };
}

/** Las filas con error de una carga: todo lo que no es un aviso. */
export function whereFilas(remesaId: number): Prisma.importerrorWhereInput {
    return { remesaId, NOT: condicionAviso() };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const ES_NUMERO = /^[+-]?\d+([.,]\d+)*$/;

/** Una celda del CSV (separador `;`). Neutraliza fórmulas, salvo que la celda entera sea un número. */
export function celdaCsv(valor: unknown): string {
    if (valor === null || valor === undefined) return '';
    let texto: string;
    if (typeof valor === 'string') texto = valor;
    else if (typeof valor === 'object') texto = JSON.stringify(valor) ?? '';
    else texto = String(valor);
    if (/^[=+\-@\t\r]/.test(texto) && !ES_NUMERO.test(texto)) texto = `'${texto}`;
    if (/[;"\n\r]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
    return texto;
}

export function lineaCsv(celdas: unknown[]): string {
    return `${celdas.map(celdaCsv).join(';')}\r\n`;
}

/** `errores-remesa-<número>.csv`, dejando solo letras, dígitos, punto, guion y guion bajo. */
export function nombreArchivoCsv(numeroRemesa: string): string {
    const limpio = String(numeroRemesa ?? '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `errores-remesa-${limpio || 'sin-numero'}.csv`;
}
