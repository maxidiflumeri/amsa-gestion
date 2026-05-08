import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

@Injectable()
export class XlsxV2Exportador {
  private readonly logger = new Logger(XlsxV2Exportador.name);

  generar(filas: Record<string, any>[], columnas: string[], opciones?: any): Buffer {
    this.logger.log(`Generando Excel v2 con ${filas.length} filas, ${columnas.length} columnas`);

    if (filas.length === 0) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Sin datos']]), 'Datos');
      return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }

    const colorHeader = opciones?.colorHeader || '1565C0';
    const negrita = opciones?.negrita !== false;

    const data = [columnas, ...filas.map(f => columnas.map(h => f[h] ?? ''))];

    const ws = XLSX.utils.aoa_to_sheet(data);

    columnas.forEach((_, colIdx) => {
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

    const colWidths = columnas.map((h, i) => {
      const maxLen = Math.max(h.length, ...filas.map(f => String(f[h] ?? '').length));
      return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
    });
    ws['!cols'] = colWidths;

    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');

    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }));
  }
}
