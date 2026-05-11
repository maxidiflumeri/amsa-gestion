import { Test } from '@nestjs/testing';
import { PdfExportador } from './pdf.exportador';

describe('PdfExportador', () => {
  let exportador: PdfExportador;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PdfExportador],
    }).compile();

    exportador = module.get<PdfExportador>(PdfExportador);
  });

  it.skip('debe generar buffer válido con filas simples', async () => {
    const filas = [
      { nombre: 'Juan', edad: 30 },
      { nombre: 'Ana', edad: 25 },
    ];
    const columnas = ['nombre', 'edad'];

    const buffer = await exportador.generar(filas, columnas);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('ascii', 0, 4)).toBe('%PDF');
  });

  it.skip('debe generar PDF con agrupaciones y subtotales', async () => {
    const filas = [
      { tipo: 'dato' as const, datos: { producto: 'A', monto: 100 } },
      { tipo: 'subtotal' as const, grupoLabel: 'Subtotal Grupo A', datos: { producto: '', monto: 100 } },
      { tipo: 'total' as const, grupoLabel: 'TOTAL GENERAL', datos: { producto: '', monto: 100 } },
    ];
    const columnas = ['producto', 'monto'];

    const buffer = await exportador.generar(filas, columnas);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.toString('ascii', 0, 4)).toBe('%PDF');
  });

  it.skip('debe aplicar opciones de paisaje y footer', async () => {
    const filas = [{ nombre: 'Test' }];
    const columnas = ['nombre'];
    const opciones = {
      landscape: true,
      footer: true,
    };

    const buffer = await exportador.generar(filas, columnas, opciones);

    expect(buffer).toBeInstanceOf(Buffer);
  });
});
