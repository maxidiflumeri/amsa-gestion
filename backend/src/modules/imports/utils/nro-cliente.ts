import { MappedRow } from '../processors/processor.interface';

/**
 * Obtiene el número de cliente de una fila mapeada de DEUDORES.
 * Lo toma como campo principal (row.nro_cliente) o, para compatibilidad con
 * plantillas viejas, como dato adicional (camposAdicionales.nro_cliente).
 * Devuelve '' si no viene en ninguno de los dos.
 */
export function nroClienteDeFila(row: MappedRow): string {
    const v = (row as any).nro_cliente ?? (row.camposAdicionales as any)?.nro_cliente;
    return String(v ?? '').trim();
}
