import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CsvV2Exportador {
  private readonly logger = new Logger(CsvV2Exportador.name);

  generar(filas: Record<string, any>[], columnas: string[], opciones?: any): Buffer {
    this.logger.log(`Generando CSV v2 con ${filas.length} filas`);

    const separador = opciones?.separador || ',';
    const bom = opciones?.bom !== false;
    const quoting = opciones?.quoting !== false;

    if (filas.length === 0) {
      return Buffer.from('');
    }

    const lines: string[] = [];

    lines.push(this.escapeCsvRow(columnas, separador, quoting));

    for (const fila of filas) {
      const valores = columnas.map(col => String(fila[col] ?? ''));
      lines.push(this.escapeCsvRow(valores, separador, quoting));
    }

    const content = lines.join('\r\n');
    const buffer = Buffer.from(content, 'utf8');

    if (bom) {
      const bomBuffer = Buffer.from('\uFEFF', 'utf8');
      return Buffer.concat([bomBuffer, buffer]);
    }

    return buffer;
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
}
