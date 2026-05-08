import { Injectable, Logger } from '@nestjs/common';
import { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { FilaConSubtotales } from '../executor/grouping.service';
import * as path from 'path';

const PdfPrinter = require('pdfmake');

const fontsDir = path.dirname(require.resolve('pdfmake/build/fonts/Roboto/Roboto-Regular.ttf'));

export interface OpcionesPdf {
  landscape?: boolean;
  pageSize?: 'A4' | 'LETTER';
  header?: string;
  footer?: boolean;
  brandingEmpresa?: {
    nombreEmpresa?: string;
    logoPath?: string;
    nombreReporte?: string;
    fechaGeneracion?: string;
    filtrosAplicados?: string;
  };
}

@Injectable()
export class PdfV2Exportador {
  private readonly logger = new Logger(PdfV2Exportador.name);

  private fonts = {
    Roboto: {
      normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
      bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
      italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
    },
  };

  async generar(
    filas: Record<string, any>[] | FilaConSubtotales[],
    columnas: string[],
    opciones?: OpcionesPdf,
  ): Promise<Buffer> {
    this.logger.log(`Generando PDF v2 con pdfmake: ${filas.length} filas, ${columnas.length} columnas`);

    const content: Content[] = [];

    if (opciones?.brandingEmpresa) {
      content.push(...this.generarBranding(opciones.brandingEmpresa));
      content.push({ text: '', margin: [0, 10] });
    }

    const tableBody: any[][] = [];

    tableBody.push(
      columnas.map(col => ({
        text: col,
        style: 'tableHeader',
        fillColor: '#1565C0',
        color: '#FFFFFF',
        bold: true,
      })),
    );

    if (filas.length > 0 && this.esFilaConSubtotales(filas[0])) {
      this.agregarFilasConAgrupaciones(tableBody, filas as FilaConSubtotales[], columnas);
    } else {
      this.agregarFilasSimples(tableBody, filas as Record<string, any>[], columnas);
    }

    content.push({
      table: {
        headerRows: 1,
        widths: columnas.map(() => 'auto'),
        body: tableBody,
      },
      layout: {
        fillColor: (rowIndex: number) => {
          return rowIndex === 0 ? '#1565C0' : rowIndex % 2 === 0 ? '#F5F5F5' : null;
        },
      },
    });

    const docDefinition: TDocumentDefinitions = {
      pageSize: opciones?.pageSize || 'A4',
      pageOrientation: opciones?.landscape ? 'landscape' : 'portrait',
      content,
      styles: {
        tableHeader: {
          bold: true,
          fontSize: 11,
          color: 'white',
          alignment: 'center',
        },
        subtotal: {
          bold: true,
          fillColor: '#E0E0E0',
        },
        total: {
          bold: true,
          fontSize: 12,
          fillColor: '#B0BEC5',
        },
      },
      defaultStyle: {
        fontSize: 9,
      },
    };

    if (opciones?.footer) {
      docDefinition.footer = (currentPage, pageCount) => ({
        text: `Página ${currentPage} de ${pageCount}`,
        alignment: 'center',
        fontSize: 8,
        margin: [0, 10],
      });
    }

    if (opciones?.header) {
      docDefinition.header = {
        text: opciones.header,
        alignment: 'center',
        fontSize: 10,
        margin: [0, 10],
      };
    }

    return new Promise((resolve, reject) => {
      try {
        const printer = new PdfPrinter(this.fonts);
        const pdfDoc = printer.createPdfKitDocument(docDefinition);

        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);

        pdfDoc.end();
      } catch (error) {
        this.logger.error('Error generando PDF', error);
        reject(error);
      }
    });
  }

  private generarBranding(branding: NonNullable<OpcionesPdf['brandingEmpresa']>): Content[] {
    const content: Content[] = [];

    if (branding.nombreEmpresa) {
      content.push({
        text: branding.nombreEmpresa,
        style: { fontSize: 16, bold: true },
        margin: [0, 0, 0, 5],
      });
    }

    if (branding.nombreReporte) {
      content.push({
        text: branding.nombreReporte,
        style: { fontSize: 14, bold: true },
        margin: [0, 0, 0, 5],
      });
    }

    if (branding.fechaGeneracion) {
      content.push({
        text: `Generado: ${branding.fechaGeneracion}`,
        style: { fontSize: 10, italics: true },
        margin: [0, 0, 0, 3],
      });
    }

    if (branding.filtrosAplicados) {
      content.push({
        text: `Filtros: ${branding.filtrosAplicados}`,
        style: { fontSize: 10, italics: true },
        margin: [0, 0, 0, 3],
      });
    }

    return content;
  }

  private agregarFilasSimples(
    tableBody: any[][],
    filas: Record<string, any>[],
    columnas: string[],
  ): void {
    for (const fila of filas) {
      const row = columnas.map(col => ({
        text: String(fila[col] ?? ''),
      }));
      tableBody.push(row);
    }
  }

  private agregarFilasConAgrupaciones(
    tableBody: any[][],
    filas: FilaConSubtotales[],
    columnas: string[],
  ): void {
    for (const fila of filas) {
      if (fila.tipo === 'dato') {
        const row = columnas.map(col => ({
          text: String(fila.datos[col] ?? ''),
        }));
        tableBody.push(row);
      } else if (fila.tipo === 'cabecera') {
        const row = [
          {
            text: fila.grupoLabel || '',
            bold: true,
            color: '#1565C0',
            fillColor: '#E3F2FD',
            colSpan: columnas.length,
          },
          ...Array(columnas.length - 1).fill({}),
        ];
        tableBody.push(row);
      } else if (fila.tipo === 'subtotal') {
        const row = [
          {
            text: fila.grupoLabel || 'Subtotal',
            bold: true,
            fillColor: '#E0E0E0',
          },
          ...columnas.slice(1).map(col => ({
            text: String(fila.datos[col] ?? ''),
            bold: true,
            fillColor: '#E0E0E0',
          })),
        ];
        tableBody.push(row);
      } else if (fila.tipo === 'total') {
        const row = [
          {
            text: fila.grupoLabel || 'TOTAL GENERAL',
            bold: true,
            fontSize: 11,
            fillColor: '#B0BEC5',
          },
          ...columnas.slice(1).map(col => ({
            text: String(fila.datos[col] ?? ''),
            bold: true,
            fontSize: 11,
            fillColor: '#B0BEC5',
          })),
        ];
        tableBody.push(row);
      }
    }
  }

  private esFilaConSubtotales(fila: any): fila is FilaConSubtotales {
    return fila && typeof fila === 'object' && 'tipo' in fila && 'datos' in fila;
  }
}
