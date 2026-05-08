import { Injectable, Logger } from '@nestjs/common';
import { FilaConSubtotales } from '../executor/grouping.service';

export interface OpcionesTxt {
  separador?: '\t' | ' ' | '|';
  encoding?: 'utf8' | 'latin1';
  lineEnding?: '\r\n' | '\n';
  incluirHeader?: boolean;
  anchoFijo?: number[];
}

@Injectable()
export class TxtV2Exportador {
  private readonly logger = new Logger(TxtV2Exportador.name);

  generar(
    filas: Record<string, any>[] | FilaConSubtotales[],
    columnas: string[],
    opciones?: OpcionesTxt,
  ): Buffer {
    this.logger.log(`Generando TXT v2 con ${filas.length} filas`);

    const separador = opciones?.separador || '\t';
    const lineEnding = opciones?.lineEnding || '\r\n';
    const incluirHeader = opciones?.incluirHeader !== false;
    const encoding = opciones?.encoding || 'utf8';
    const anchoFijo = opciones?.anchoFijo;

    const lines: string[] = [];

    if (incluirHeader) {
      if (anchoFijo) {
        lines.push(this.formatearFilaAnchoFijo(columnas, anchoFijo));
      } else {
        lines.push(columnas.join(separador));
      }
    }

    const filasPlanas = this.aplanarFilas(filas, columnas);

    for (const fila of filasPlanas) {
      const valores = columnas.map(col => String(fila[col] ?? ''));
      if (anchoFijo) {
        lines.push(this.formatearFilaAnchoFijo(valores, anchoFijo));
      } else {
        lines.push(valores.join(separador));
      }
    }

    return Buffer.from(lines.join(lineEnding), encoding);
  }

  private aplanarFilas(
    filas: Record<string, any>[] | FilaConSubtotales[],
    columnas: string[],
  ): Record<string, any>[] {
    if (filas.length === 0) return [];

    if (this.esFilaConSubtotales(filas[0])) {
      return (filas as FilaConSubtotales[]).map(f => {
        if (f.tipo === 'dato') {
          return f.datos;
        } else if (f.tipo === 'cabecera') {
          const row: Record<string, any> = { [columnas[0]]: f.grupoLabel || '' };
          columnas.slice(1).forEach(col => { row[col] = ''; });
          return row;
        } else if (f.tipo === 'subtotal' || f.tipo === 'total') {
          const row: Record<string, any> = { [columnas[0]]: f.grupoLabel || 'Total' };
          columnas.slice(1).forEach(col => {
            row[col] = f.datos[col] ?? '';
          });
          return row;
        }
        return f.datos;
      });
    }

    return filas as Record<string, any>[];
  }

  private formatearFilaAnchoFijo(valores: string[], anchos: number[]): string {
    return valores
      .map((v, idx) => {
        const ancho = anchos[idx] || 10;
        return v.padEnd(ancho).substring(0, ancho);
      })
      .join('');
  }

  private esFilaConSubtotales(fila: any): fila is FilaConSubtotales {
    return fila && typeof fila === 'object' && 'tipo' in fila && 'datos' in fila;
  }
}
