import { Test } from '@nestjs/testing';
import { XlsxExportador } from './xlsx.exportador';
import * as ExcelJS from 'exceljs';

describe('XlsxExportador', () => {
  let exportador: XlsxExportador;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [XlsxExportador],
    }).compile();

    exportador = module.get<XlsxExportador>(XlsxExportador);
  });

  it('debe generar buffer válido con filas simples', async () => {
    const filas = [
      { nombre: 'Juan', edad: 30 },
      { nombre: 'Ana', edad: 25 },
    ];
    const columnas = ['nombre', 'edad'];

    const buffer = await exportador.generar(filas, columnas);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.getWorksheet('Reporte');
    expect(worksheet).toBeDefined();
  });

  it('debe generar archivo con agrupaciones y subtotales', async () => {
    const filas = [
      { tipo: 'dato' as const, datos: { producto: 'A', monto: 100 } },
      { tipo: 'subtotal' as const, grupoLabel: 'Subtotal Grupo A', datos: { producto: '', monto: 100 } },
      { tipo: 'total' as const, grupoLabel: 'TOTAL GENERAL', datos: { producto: '', monto: 100 } },
    ];
    const columnas = ['producto', 'monto'];

    const buffer = await exportador.generar(filas, columnas);

    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('debe aplicar branding de empresa', async () => {
    const filas = [{ nombre: 'Test' }];
    const columnas = ['nombre'];
    const opciones = {
      brandingEmpresa: {
        nombreEmpresa: 'AMSA S.A.',
        nombreReporte: 'Reporte de Prueba',
        fechaGeneracion: '2026-05-08',
      },
    };

    const buffer = await exportador.generar(filas, columnas, opciones);

    expect(buffer).toBeInstanceOf(Buffer);
  });
});
