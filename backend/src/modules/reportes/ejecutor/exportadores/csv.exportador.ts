import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CsvExportador {
  private readonly logger = new Logger(CsvExportador.name);

  async generar(filas: Record<string, any>[], opciones?: { separador?: string }): Promise<Buffer> {
    this.logger.log(`Generando texto/csv con ${filas.length} filas`);
    const sep = opciones?.separador === 'tab' ? '\t' : (opciones?.separador || ',');

    if (filas.length === 0) return Buffer.from('Sin datos');
    const headers = Object.keys(filas[0]);
    const escapar = (v: any) => {
      const s = String(v ?? '');
      return s.includes(sep) || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lineas = [
      headers.map(escapar).join(sep),
      ...filas.map(f => headers.map(h => escapar(f[h])).join(sep)),
    ];
    return Buffer.from('\uFEFF' + lineas.join('\r\n'), 'utf-8'); // BOM para Excel
  }
}
