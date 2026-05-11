import { Test, TestingModule } from '@nestjs/testing';
import { EjecucionesCleanupService } from './ejecuciones.cleanup';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportesStorageService } from '../storage/reportes-storage.service';

describe('EjecucionesCleanupService', () => {
  let svc: EjecucionesCleanupService;
  let prismaMock: any;
  let storageMock: any;

  beforeEach(async () => {
    prismaMock = {
      ejecucion_reporte: {
        findMany: jest.fn(),
        delete: jest.fn(),
      },
    };
    storageMock = {
      eliminarArchivo: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EjecucionesCleanupService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ReportesStorageService, useValue: storageMock },
      ],
    }).compile();

    svc = module.get(EjecucionesCleanupService);
  });

  it('elimina ejecuciones FINALIZADA/FALLIDA antiguas y sus archivos', async () => {
    prismaMock.ejecucion_reporte.findMany.mockResolvedValue([
      { id: 1, archivoPath: '/tmp/1.xlsx' },
      { id: 2, archivoPath: null },
      { id: 3, archivoPath: '/tmp/3.csv' },
    ]);
    prismaMock.ejecucion_reporte.delete.mockResolvedValue({});

    const r = await svc.runCleanup(30);

    expect(r.eliminadas).toBe(3);
    expect(storageMock.eliminarArchivo).toHaveBeenCalledTimes(2);
    expect(prismaMock.ejecucion_reporte.delete).toHaveBeenCalledTimes(3);

    const filter = prismaMock.ejecucion_reporte.findMany.mock.calls[0][0]
      .where;
    expect(filter.estado.in).toEqual(['FINALIZADA', 'FALLIDA']);
    expect(filter.createdAt.lt).toBeInstanceOf(Date);
  });

  it('continúa si delete de una falla', async () => {
    prismaMock.ejecucion_reporte.findMany.mockResolvedValue([
      { id: 1, archivoPath: null },
      { id: 2, archivoPath: null },
    ]);
    prismaMock.ejecucion_reporte.delete
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({});

    const r = await svc.runCleanup(30);
    expect(r.eliminadas).toBe(1);
  });

  it('respeta días configurados via env', async () => {
    process.env.REPORTES_RETENTION_DAYS = '7';
    prismaMock.ejecucion_reporte.findMany.mockResolvedValue([]);

    await svc.cleanupAntiguas();

    const filter = prismaMock.ejecucion_reporte.findMany.mock.calls[0][0]
      .where;
    const cutoff: Date = filter.createdAt.lt;
    const expectedDelta = 7 * 24 * 60 * 60 * 1000;
    const actualDelta = Date.now() - cutoff.getTime();
    expect(Math.abs(actualDelta - expectedDelta)).toBeLessThan(2000);
    delete process.env.REPORTES_RETENTION_DAYS;
  });
});
