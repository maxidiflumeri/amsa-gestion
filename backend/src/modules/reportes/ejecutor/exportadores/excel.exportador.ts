import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

@Injectable()
export class ExcelExportador {
  private readonly logger = new Logger(ExcelExportador.name);

  async generar(filas: Record<string, any>[], nombreHoja: string, opciones?: any): Promise<Buffer> {
    this.logger.log(`Generando Excel con ${filas.length} filas`);

    const colorHeader = opciones?.colorHeader || '1565C0';
    const negrita = opciones?.negrita !== false;

    const wb = XLSX.utils.book_new();

    if (filas.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Sin datos']]), 'Datos');
      return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }

    const headers = Object.keys(filas[0]);
    const data = [headers, ...filas.map(f => headers.map(h => f[h] ?? ''))];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Estilos de encabezado
    headers.forEach((_, colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
      if (!ws[cellRef]) return;
      ws[cellRef].s = {
        fill: { fgColor: { rgb: colorHeader } },
        font: { bold: negrita, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: {
          bottom: { style: 'thin', color: { rgb: 'FFFFFF' } },
        },
      };
    });

    // Auto-ancho de columnas
    const colWidths = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...filas.map(f => String(f[h] ?? '').length));
      return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
    });
    ws['!cols'] = colWidths;

    // Congelar primera fila
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    const sheetName = (nombreHoja || 'Datos').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }));
  }
}
