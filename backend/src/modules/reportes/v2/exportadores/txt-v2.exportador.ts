import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TxtV2Exportador {
  private readonly logger = new Logger(TxtV2Exportador.name);

  generar(filas: Record<string, any>[], columnas: string[], opciones?: any): Buffer {
    this.logger.log(`Generando TXT v2 con ${filas.length} filas`);

    const separador = opciones?.separador || '\t';

    if (filas.length === 0) {
      return Buffer.from('');
    }

    const lines: string[] = [];
    lines.push(columnas.join(separador));

    for (const fila of filas) {
      const valores = columnas.map(col => String(fila[col] ?? ''));
      lines.push(valores.join(separador));
    }

    return Buffer.from(lines.join('\r\n'), 'utf8');
  }
}
