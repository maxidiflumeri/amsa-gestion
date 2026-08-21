import { Injectable, Logger } from '@nestjs/common';
import { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { FilaConSubtotales } from '../executor/grouping.service';
import * as path from 'path';

const pdfMake = require('pdfmake');

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
export class PdfExportador {
  private readonly logger = new Logger(PdfExportador.name);

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
    this.logger.log(`Generando PDF con pdfmake: ${filas.length} filas, ${columnas.length} columnas`);

    const content: Content[] = [];

    if (opciones?.brandingEmpresa) {
      content.push(...this.generarBranding(opciones.brandingEmpresa));
      content.push({ text: '', margin: [0, 10] });
    }

    const conAgrupaciones = filas.length > 0 && this.esFilaConSubtotales(filas[0]);

    // Un grupo con "salto de página" arranca en una hoja nueva. En pdfmake el `pageBreak` va en un
    // nodo de contenido, no en una fila de tabla, así que las filas se parten en varias tablas —una
    // por corte— y cada una repite el encabezado. Sin esto el switch se guardaba y no lo leía nadie.
    const bloques = conAgrupaciones
      ? this.partirEnBloques(filas as FilaConSubtotales[])
      : [filas as Record<string, any>[]];

    bloques.forEach((bloque, i) => {
      const tableBody: any[][] = [
        columnas.map(col => ({
          text: col,
          style: 'tableHeader',
          fillColor: '#1565C0',
          color: '#FFFFFF',
          bold: true,
        })),
      ];

      if (conAgrupaciones) {
        this.agregarFilasConAgrupaciones(tableBody, bloque as FilaConSubtotales[], columnas);
      } else {
        this.agregarFilasSimples(tableBody, bloque as Record<string, any>[], columnas);
      }

      content.push({
        ...(i > 0 ? { pageBreak: 'before' as const } : {}),
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

    try {
      pdfMake.setFonts(this.fonts);
      const output = pdfMake.createPdf(docDefinition);
      const buffer = await output.getBuffer();
      return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    } catch (error) {
      this.logger.error('Error generando PDF', error);
      throw error;
    }
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

  /**
   * Parte las filas en bloques, cortando **antes** de cada cabecera marcada con salto de página.
   *
   * El primer corte no cuenta: si la primera fila ya es una cabecera con salto, no hace falta una
   * hoja en blanco adelante.
   */
  private partirEnBloques(filas: FilaConSubtotales[]): FilaConSubtotales[][] {
    const bloques: FilaConSubtotales[][] = [];
    let actual: FilaConSubtotales[] = [];

    for (const fila of filas) {
      if (fila.tipo === 'cabecera' && fila.saltoPagina && actual.length > 0) {
        bloques.push(actual);
        actual = [];
      }
      actual.push(fila);
    }
    if (actual.length > 0) bloques.push(actual);
    return bloques.length > 0 ? bloques : [[]];
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
