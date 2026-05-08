import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { FilaConSubtotales } from '../executor/grouping.service';

export interface OpcionesXlsx {
  headerColor?: string;
  freezeRow?: boolean;
  autoWidth?: boolean;
  brandingEmpresa?: {
    nombreEmpresa?: string;
    logoPath?: string;
    nombreReporte?: string;
    fechaGeneracion?: string;
    filtrosAplicados?: string;
  };
}

@Injectable()
export class XlsxV2Exportador {
  private readonly logger = new Logger(XlsxV2Exportador.name);

  async generar(
    filas: Record<string, any>[] | FilaConSubtotales[],
    columnas: string[],
    opciones?: OpcionesXlsx,
  ): Promise<Buffer> {
    this.logger.log(`Generando Excel v2 con exceljs: ${filas.length} filas, ${columnas.length} columnas`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AMSA Gestión';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Reporte', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    let rowOffset = 1;

    if (opciones?.brandingEmpresa) {
      rowOffset = this.agregarBranding(worksheet, opciones.brandingEmpresa);
    }

    const headerRow = worksheet.getRow(rowOffset);
    columnas.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: opciones?.headerColor || 'FF1565C0' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
    headerRow.commit();

    let currentRow = rowOffset + 1;

    if (filas.length > 0 && this.esFilaConSubtotales(filas[0])) {
      currentRow = this.agregarFilasConAgrupaciones(
        worksheet,
        filas as FilaConSubtotales[],
        columnas,
        currentRow,
      );
    } else {
      currentRow = this.agregarFilasSimples(worksheet, filas as Record<string, any>[], columnas, currentRow);
    }

    if (opciones?.autoWidth !== false) {
      this.ajustarAnchoColumnas(worksheet, columnas.length);
    }

    if (opciones?.freezeRow !== false) {
      worksheet.views = [{ state: 'frozen', ySplit: rowOffset }];
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private agregarBranding(worksheet: ExcelJS.Worksheet, branding: NonNullable<OpcionesXlsx['brandingEmpresa']>): number {
    let currentRow = 1;

    if (branding.nombreEmpresa) {
      const empresaRow = worksheet.getRow(currentRow++);
      empresaRow.getCell(1).value = branding.nombreEmpresa;
      empresaRow.getCell(1).font = { bold: true, size: 14 };
    }

    if (branding.nombreReporte) {
      const reporteRow = worksheet.getRow(currentRow++);
      reporteRow.getCell(1).value = branding.nombreReporte;
      reporteRow.getCell(1).font = { bold: true, size: 12 };
    }

    if (branding.fechaGeneracion) {
      const fechaRow = worksheet.getRow(currentRow++);
      fechaRow.getCell(1).value = `Generado: ${branding.fechaGeneracion}`;
      fechaRow.getCell(1).font = { italic: true };
    }

    if (branding.filtrosAplicados) {
      const filtrosRow = worksheet.getRow(currentRow++);
      filtrosRow.getCell(1).value = `Filtros: ${branding.filtrosAplicados}`;
      filtrosRow.getCell(1).font = { italic: true };
    }

    if (currentRow > 1) {
      currentRow++;
    }

    return currentRow;
  }

  private agregarFilasSimples(
    worksheet: ExcelJS.Worksheet,
    filas: Record<string, any>[],
    columnas: string[],
    startRow: number,
  ): number {
    let currentRow = startRow;

    for (const fila of filas) {
      const row = worksheet.getRow(currentRow++);
      columnas.forEach((col, idx) => {
        row.getCell(idx + 1).value = fila[col] ?? '';
      });
      row.commit();
    }

    return currentRow;
  }

  private agregarFilasConAgrupaciones(
    worksheet: ExcelJS.Worksheet,
    filas: FilaConSubtotales[],
    columnas: string[],
    startRow: number,
  ): number {
    let currentRow = startRow;

    for (const fila of filas) {
      const row = worksheet.getRow(currentRow++);

      if (fila.tipo === 'dato') {
        columnas.forEach((col, idx) => {
          row.getCell(idx + 1).value = fila.datos[col] ?? '';
        });
      } else if (fila.tipo === 'cabecera') {
        row.getCell(1).value = fila.grupoLabel || '';
        row.getCell(1).font = { bold: true, color: { argb: 'FF1565C0' } };
        row.getCell(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE3F2FD' },
        };
        worksheet.mergeCells(currentRow - 1, 1, currentRow - 1, columnas.length);
      } else if (fila.tipo === 'subtotal') {
        row.getCell(1).value = fila.grupoLabel || 'Subtotal';
        row.getCell(1).font = { bold: true };
        row.getCell(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' },
        };

        columnas.slice(1).forEach((col, idx) => {
          const cell = row.getCell(idx + 2);
          const valor = fila.datos[col];
          cell.value = valor ?? '';
          cell.font = { bold: true };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' },
          };
        });
      } else if (fila.tipo === 'total') {
        row.getCell(1).value = fila.grupoLabel || 'TOTAL GENERAL';
        row.getCell(1).font = { bold: true, size: 12 };
        row.getCell(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFB0BEC5' },
        };

        columnas.slice(1).forEach((col, idx) => {
          const cell = row.getCell(idx + 2);
          const valor = fila.datos[col];
          cell.value = valor ?? '';
          cell.font = { bold: true, size: 12 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFB0BEC5' },
          };
        });
      }

      row.commit();
    }

    return currentRow;
  }

  private ajustarAnchoColumnas(worksheet: ExcelJS.Worksheet, numColumnas: number): void {
    for (let i = 1; i <= numColumnas; i++) {
      const column = worksheet.getColumn(i);
      let maxLength = 10;

      column.eachCell({ includeEmpty: false }, cell => {
        const cellValue = cell.value ? String(cell.value) : '';
        maxLength = Math.max(maxLength, cellValue.length);
      });

      column.width = Math.min(maxLength + 2, 50);
    }
  }

  private esFilaConSubtotales(fila: any): fila is FilaConSubtotales {
    return fila && typeof fila === 'object' && 'tipo' in fila && 'datos' in fila;
  }
}
