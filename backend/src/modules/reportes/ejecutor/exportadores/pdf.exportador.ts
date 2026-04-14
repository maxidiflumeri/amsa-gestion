import { Injectable, Logger } from '@nestjs/common';
import PdfPrinter from 'pdfmake';

@Injectable()
export class PdfExportador {
  private readonly logger = new Logger(PdfExportador.name);

  async generar(filas: Record<string, any>[], titulo: string, opciones?: any): Promise<Buffer> {
    this.logger.log(`Generando PDF con ${filas.length} filas`);

    // Usar pdfmake con fuentes virtuales incluidas
    const PdfPrinterLib = require('pdfmake');
    const vfsFonts = require('pdfmake/build/vfs_fonts');

    const printer = new PdfPrinterLib({
      Roboto: {
        normal: Buffer.from(vfsFonts.pdfMake.vfs['Roboto-Regular.ttf'], 'base64'),
        bold: Buffer.from(vfsFonts.pdfMake.vfs['Roboto-Medium.ttf'], 'base64'),
        italics: Buffer.from(vfsFonts.pdfMake.vfs['Roboto-Italic.ttf'], 'base64'),
        bolditalics: Buffer.from(vfsFonts.pdfMake.vfs['Roboto-MediumItalic.ttf'], 'base64'),
      },
    });

    const headers = filas.length > 0 ? Object.keys(filas[0]) : [];
    const landscape = opciones?.orientacion === 'landscape' || headers.length > 6;

    const tableBody = [
      // Header row
      headers.map(h => ({ text: h, style: 'tableHeader', noWrap: true })),
      // Data rows
      ...filas.map(f => headers.map(h => ({ text: String(f[h] ?? ''), style: 'tableCell' }))),
    ];

    const docDef: any = {
      pageOrientation: landscape ? 'landscape' : 'portrait',
      pageMargins: [30, 60, 30, 40],
      content: [
        { text: titulo || 'Reporte', style: 'titulo' },
        { text: `Generado: ${new Date().toLocaleString('es-AR')} — ${filas.length} registros`, style: 'subtitulo' },
        { text: ' ' },
        {
          table: {
            headerRows: 1,
            widths: headers.map(() => '*'),
            body: tableBody,
          },
          layout: {
            fillColor: (rowIndex: number) => rowIndex === 0 ? '#1565C0' : rowIndex % 2 === 0 ? '#F5F5F5' : null,
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#BDBDBD',
            vLineColor: () => '#BDBDBD',
          },
        },
      ],
      styles: {
        titulo: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
        subtitulo: { fontSize: 9, color: '#757575', margin: [0, 0, 0, 8] },
        tableHeader: { fontSize: 9, bold: true, color: 'white', margin: [4, 6, 4, 6] },
        tableCell: { fontSize: 8, margin: [4, 4, 4, 4] },
      },
      defaultStyle: { font: 'Roboto' },
    };

    return new Promise((resolve, reject) => {
      const pdfDoc = printer.createPdfKitDocument(docDef);
      const chunks: Buffer[] = [];
      pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  }
}
