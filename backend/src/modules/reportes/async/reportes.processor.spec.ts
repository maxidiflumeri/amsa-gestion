import { Test, TestingModule } from '@nestjs/testing';
import { ReportesProcessor } from './reportes.processor';
import { PrismaService } from '../../../prisma/prisma.service';
import { AsyncExecutorService, ExecucionCanceladaError } from './async-executor.service';
import { ReportesStorageService } from '../storage/reportes-storage.service';
import { ReportesGateway } from '../gateway/reportes.gateway';
import { XlsxExportador } from '../exportadores/xlsx.exportador';
import { CsvExportador } from '../exportadores/csv.exportador';
import { TxtExportador } from '../exportadores/txt.exportador';
import { PdfExportador } from '../exportadores/pdf.exportador';
import { RequestContextService } from '../../../common/logger/request-context';

function makeJob(data: any) {
  return {
    id: 'job-x',
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('ReportesProcessor', () => {
  let processor: ReportesProcessor;
  let prisma: any;
  let executor: any;
  let storage: any;
  let gateway: any;
  let xlsx: any;

  beforeEach(async () => {
    prisma = {
      plantilla_reporte: { findUnique: jest.fn() },
      ejecucion_reporte: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ cancelado: false }),
      },
    };
    executor = {
      estimarFilas: jest.fn().mockResolvedValue(10),
      executeStreaming: jest.fn(),
    };
    storage = {
      guardarArchivo: jest.fn().mockResolvedValue({
        filePath: '/tmp/x.xlsx',
        tamano: 1234,
      }),
    };
    gateway = {
      emitProgreso: jest.fn(),
      emitCompletado: jest.fn(),
      emitFallido: jest.fn(),
    };
    xlsx = { generar: jest.fn().mockResolvedValue(Buffer.from('hello')) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        // `RequestContextService` lo inyecta el logger para el requestId. No es parte de lo que este
        // test ejercita, pero sin el provider Nest no puede construir el módulo.
        { provide: RequestContextService, useValue: { get: () => ({ requestId: 'req-test' }), getRequestId: () => 'req-test', run: (_c: any, fn: any) => fn() } },
        ReportesProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: AsyncExecutorService, useValue: executor },
        { provide: ReportesStorageService, useValue: storage },
        { provide: ReportesGateway, useValue: gateway },
        { provide: XlsxExportador, useValue: xlsx },
        { provide: CsvExportador, useValue: { generar: jest.fn() } },
        { provide: TxtExportador, useValue: { generar: jest.fn() } },
        { provide: PdfExportador, useValue: { generar: jest.fn() } },
      ],
    }).compile();

    processor = module.get(ReportesProcessor);
  });

  it('procesa correctamente una ejecucion xlsx', async () => {
    prisma.plantilla_reporte.findUnique.mockResolvedValue({
      id: 1,
      definicion: { columnas: [{ id: 'c', path: 'documento', label: 'Doc' }] },
      raiz: 'deudor',
      formatoSalida: 'xlsx',
      opcionesFormato: null,
    });
    executor.executeStreaming.mockResolvedValue({
      filas: [],
      totalFilas: 5,
      columnas: ['Doc'],
    });

    const result = await processor.process(
      makeJob({
        ejecucionId: 100,
        plantillaId: 1,
        usuarioId: 42,
        empresaId: null,
        filtrosVars: {},
        formato: 'xlsx',
      }),
    );

    expect(result.ejecucionId).toBe(100);
    expect(result.totalFilas).toBe(5);
    expect(result.archivoTamano).toBe(1234);

    expect(storage.guardarArchivo).toHaveBeenCalledWith(
      100,
      'xlsx',
      expect.any(Buffer),
    );
    expect(gateway.emitCompletado).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ ejecucionId: 100, archivoTamano: 1234 }),
    );
  });

  it('marca FALLIDA y emite error si el executor falla', async () => {
    prisma.plantilla_reporte.findUnique.mockResolvedValue({
      id: 1,
      definicion: { columnas: [] },
      raiz: 'deudor',
      formatoSalida: 'xlsx',
      opcionesFormato: null,
    });
    executor.executeStreaming.mockRejectedValue(new Error('boom'));

    await expect(
      processor.process(
        makeJob({
          ejecucionId: 200,
          plantillaId: 1,
          usuarioId: 42,
          empresaId: null,
          filtrosVars: {},
          formato: 'xlsx',
        }),
      ),
    ).rejects.toThrow('boom');

    const updates = prisma.ejecucion_reporte.update.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(updates.some((u: any) => u.estado === 'FALLIDA')).toBe(true);
    expect(gateway.emitFallido).toHaveBeenCalledWith(42, {
      ejecucionId: 200,
      error: 'boom',
    });
  });

  it('marca CANCELADA si executor lanza ExecucionCanceladaError', async () => {
    prisma.plantilla_reporte.findUnique.mockResolvedValue({
      id: 1,
      definicion: { columnas: [] },
      raiz: 'deudor',
      formatoSalida: 'xlsx',
      opcionesFormato: null,
    });
    executor.executeStreaming.mockRejectedValue(new ExecucionCanceladaError());

    const result = await processor.process(
      makeJob({
        ejecucionId: 300,
        plantillaId: 1,
        usuarioId: 42,
        empresaId: null,
        filtrosVars: {},
        formato: 'xlsx',
      }),
    );

    expect(result.ejecucionId).toBe(300);
    const updates = prisma.ejecucion_reporte.update.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    expect(updates.some((u: any) => u.estado === 'CANCELADA')).toBe(true);
  });
});
