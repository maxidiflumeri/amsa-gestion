import { Injectable, Logger } from '@nestjs/common';
import { FilaConSubtotales } from '../executor/grouping.service';

export interface OpcionesCsv {
  /** Cualquier carácter. Ver la nota en `OpcionesTxt`. */
  separador?: string;
  encoding?: 'utf8' | 'latin1';
  bom?: boolean;
  quoting?: boolean;
  lineEnding?: '\r\n' | '\n';
  incluirHeader?: boolean;
}

@Injectable()
export class CsvExportador {
  private readonly logger = new Logger(CsvExportador.name);

  generar(
    filas: Record<string, any>[] | FilaConSubtotales[],
    columnas: string[],
    opciones?: OpcionesCsv,
  ): Buffer {
    this.logger.log(`Generando CSV con ${filas.length} filas`);

    const separador = opciones?.separador || ',';
    const bom = opciones?.bom !== false;
    const quoting = opciones?.quoting !== false;
    const lineEnding = opciones?.lineEnding || '\r\n';
    const incluirHeader = opciones?.incluirHeader !== false;
    const encoding = opciones?.encoding || 'utf8';

    const lines: string[] = [];

    if (incluirHeader) {
      lines.push(this.escapeCsvRow(columnas, separador, quoting));
    }

    const filasPlanas = this.aplanarFilas(filas, columnas);

    for (const fila of filasPlanas) {
      const valores = columnas.map(col => String(fila[col] ?? ''));
      lines.push(this.escapeCsvRow(valores, separador, quoting));
    }

    const content = lines.join(lineEnding);
    const buffer = Buffer.from(content, encoding);

    if (bom && encoding === 'utf8') {
      const bomBuffer = Buffer.from('\uFEFF', 'utf8');
      return Buffer.concat([bomBuffer, buffer]);
    }

    return buffer;
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

  private escapeCsvRow(valores: string[], separador: string, quoting: boolean): string {
    return valores
      .map(v => {
        if (!quoting) {
          return v;
        }

        if (v.includes(separador) || v.includes('"') || v.includes('\n') || v.includes('\r')) {
          return `"${v.replace(/"/g, '""')}"`;
        }

        return v;
      })
      .join(separador);
  }

  private esFilaConSubtotales(fila: any): fila is FilaConSubtotales {
    return fila && typeof fila === 'object' && 'tipo' in fila && 'datos' in fila;
  }
}
