import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DeudoresFuente } from './fuentes/deudores.fuente';
import { ExcelExportador } from './exportadores/excel.exportador';
import { CsvExportador } from './exportadores/csv.exportador';
import { PdfExportador } from './exportadores/pdf.exportador';
import { GenericaFuente } from './fuentes/generica.fuente';

@Injectable()
export class EjecutorService {
  private readonly logger = new Logger(EjecutorService.name);

  constructor(
    private deudoresFuente: DeudoresFuente,
    private genericaFuente: GenericaFuente,
    private excelExp: ExcelExportador,
    private csvExp: CsvExportador,
    private pdfExp: PdfExportador,
  ) {}

  async ejecutar(plantilla: any, filtrosVars: any): Promise<{ buffer: Buffer; mimeType: string; extension: string; totalFilas: number }> {
    const { fuente, filtrosFijos, columnas, formatoSalida, opcionesExcel, opcionesPdf, nombre } = plantilla;

    const filtrosFijosObj = typeof filtrosFijos === 'string' ? JSON.parse(filtrosFijos) : (filtrosFijos || {});
    const formatoTel = filtrosFijosObj.formatoTel;
    
    this.logger.log(`Ejecutando plantilla: ${nombre} (fuente: ${fuente}, formato: ${formatoSalida})`);

    // Obtener datos
    let filas: Record<string, any>[] = [];
    const columnasRaw = typeof columnas === 'string' ? JSON.parse(columnas) : columnas;
    const columnasArr = Array.isArray(columnasRaw) ? columnasRaw.map((c: any) => typeof c === 'string' ? { campo: c, label: c } : c) : [];
    const filtrosVarsObj = typeof filtrosVars === 'string' ? JSON.parse(filtrosVars) : filtrosVars;

    if (formatoTel) {
      filtrosFijosObj.formatoTel = formatoTel;
    }

    switch (fuente) {
      case 'deudores':
        filas = await this.deudoresFuente.ejecutar(filtrosFijosObj, filtrosVarsObj, columnasArr);
        break;
      default:
        // Uso de fuente genérica para el resto basándose en DMMF
        filas = await this.genericaFuente.ejecutar(fuente, filtrosFijosObj, filtrosVarsObj, columnasArr);
        break;
    }

    const tituloPdf = (typeof opcionesPdf === 'object' ? opcionesPdf?.titulo : null) || nombre;

    // Exportar
    let buffer: Buffer;
    let mimeType: string;
    let extension: string;

    switch (formatoSalida) {
      case 'excel': {
        const optsExcel = typeof opcionesExcel === 'string' ? JSON.parse(opcionesExcel) : opcionesExcel;
        buffer = await this.excelExp.generar(filas, nombre, optsExcel);
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        extension = 'xlsx';
        break;
      }
      case 'csv':
      case 'txt': {
        const optsCsv = filtrosFijosObj.opcionesCsv || { separador: ',' };
        buffer = await this.csvExp.generar(filas, optsCsv);
        mimeType = formatoSalida === 'csv' ? 'text/csv' : 'text/plain';
        extension = formatoSalida === 'csv' ? 'csv' : 'txt';
        break;
      }
      case 'pdf':
        buffer = await this.pdfExp.generar(filas, tituloPdf, typeof opcionesPdf === 'object' ? opcionesPdf : {});
        mimeType = 'application/pdf';
        extension = 'pdf';
        break;
      default:
        throw new BadRequestException(`Formato "${formatoSalida}" no soportado`);
    }

    this.logger.log(`Reporte generado: ${filas.length} filas, formato ${formatoSalida}`);

    return { buffer, mimeType, extension, totalFilas: filas.length };
  }

  async preview(plantilla: any, filtrosVars: any, limite = 100) {
    const filtrosFijosObj = typeof plantilla.filtrosFijos === 'string' ? JSON.parse(plantilla.filtrosFijos) : plantilla.filtrosFijos;
    const columnasRaw = typeof plantilla.columnas === 'string' ? JSON.parse(plantilla.columnas) : plantilla.columnas;
    const columnasArr = Array.isArray(columnasRaw) ? columnasRaw.map((c: any) => typeof c === 'string' ? { campo: c, label: c } : c) : [];
    const filtrosVarsObj = typeof filtrosVars === 'string' ? JSON.parse(filtrosVars) : filtrosVars;

    if (filtrosFijosObj.formatoTel) {
      filtrosFijosObj.formatoTel = filtrosFijosObj.formatoTel; // keeps it passed safely
    }

    let filas: Record<string, any>[] = [];
    switch (plantilla.fuente) {
      case 'deudores':
        filas = await this.deudoresFuente.ejecutar(filtrosFijosObj, filtrosVarsObj, columnasArr);
        break;
      default:
        filas = await this.genericaFuente.ejecutar(plantilla.fuente, filtrosFijosObj, filtrosVarsObj, columnasArr);
        break;
    }

    this.logger.log(`Preview generado: ${filas.length} filas totales, mostrando ${Math.min(limite, filas.length)}`);

    return { total: filas.length, preview: filas.slice(0, limite) };
  }
}
