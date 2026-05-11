import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EjecucionesService } from './ejecuciones.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportesStorageService } from '../storage/reportes-storage.service';
import { AsyncExecutorService } from '../async/async-executor.service';
import { getQueueToken } from '@nestjs/bullmq';
import { REPORTES_QUEUE_NAME } from '../async/reportes.queue';
import { EstadoEjecucion } from '../dto/ejecuciones.dto';

describe('EjecucionesService', () => {
  let service: EjecucionesService;
  let prismaMock: any;
  let storageMock: any;
  let executorMock: any;
  let queueMock: any;

  beforeEach(async () => {
    process.env.REPORTES_SYNC_THRESHOLD = '5000';

    prismaMock = {
      plantilla_reporte: {
        findUnique: jest.fn(),
      },
      ejecucion_reporte: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
    };
    storageMock = {
      eliminarArchivo: jest.fn().mockResolvedValue(undefined),
      existeArchivo: jest.fn().mockResolvedValue(true),
      abrirStream: jest.fn(),
    };
    executorMock = {
      estimarFilas: jest.fn(),
    };
    queueMock = {
      add: jest.fn(),
      getJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EjecucionesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ReportesStorageService, useValue: storageMock },
        { provide: AsyncExecutorService, useValue: executorMock },
        {
          provide: getQueueToken(REPORTES_QUEUE_NAME),
          useValue: queueMock,
        },
      ],
    }).compile();

    service = module.get(EjecucionesService);
  });

  describe('estimar', () => {
    it('lanza NotFound si plantilla no existe', async () => {
      prismaMock.plantilla_reporte.findUnique.mockResolvedValue(null);
      await expect(service.estimar(99)).rejects.toThrow(NotFoundException);
    });

    it('sugiere sync si total <= umbral', async () => {
      prismaMock.plantilla_reporte.findUnique.mockResolvedValue({
        id: 1,
        definicion: { columnas: [] },
        raiz: 'deudor',
      });
      executorMock.estimarFilas.mockResolvedValue(100);

      const r = await service.estimar(1);
      expect(r.modoSugerido).toBe('sync');
      expect(r.totalEstimado).toBe(100);
      expect(r.umbral).toBe(5000);
    });

    it('sugiere async si total > umbral', async () => {
      prismaMock.plantilla_reporte.findUnique.mockResolvedValue({
        id: 1,
        definicion: { columnas: [] },
        raiz: 'deudor',
      });
      executorMock.estimarFilas.mockResolvedValue(50000);

      const r = await service.estimar(1);
      expect(r.modoSugerido).toBe('async');
    });
  });

  describe('encolarEjecucion', () => {
    it('crea ejecucion PENDIENTE y agrega job a la queue', async () => {
      prismaMock.plantilla_reporte.findUnique.mockResolvedValue({
        id: 1,
        definicion: { columnas: [] },
        raiz: 'deudor',
        empresaId: 7,
        formatoSalida: 'xlsx',
      });
      prismaMock.ejecucion_reporte.create.mockResolvedValue({ id: 555 });
      prismaMock.ejecucion_reporte.update.mockResolvedValue({});
      queueMock.add.mockResolvedValue({ id: 'job-1' });

      const r = await service.encolarEjecucion(1, 42, { foo: 'bar' });

      expect(r).toEqual({
        ejecucionId: 555,
        modo: 'async',
        estado: EstadoEjecucion.PENDIENTE,
      });
      expect(queueMock.add).toHaveBeenCalledTimes(1);
      const [name, data, opts] = queueMock.add.mock.calls[0];
      expect(name).toBe('ejecutar-reporte');
      expect(data.plantillaId).toBe(1);
      expect(data.usuarioId).toBe(42);
      expect(data.formato).toBe('xlsx');
      expect(opts.attempts).toBe(3);
    });
  });

  describe('cancelar', () => {
    it('rechaza si estado no es cancelable', async () => {
      prismaMock.ejecucion_reporte.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 42,
        estado: EstadoEjecucion.FINALIZADA,
        jobId: null,
      });

      await expect(service.cancelar(1, 42)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('marca cancelado=true y remueve job en estado waiting', async () => {
      prismaMock.ejecucion_reporte.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 42,
        estado: EstadoEjecucion.PENDIENTE,
        jobId: 'job-1',
      });
      const jobMock = {
        getState: jest.fn().mockResolvedValue('waiting'),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      queueMock.getJob.mockResolvedValue(jobMock);

      const r = await service.cancelar(1, 42);

      expect(r.ok).toBe(true);
      expect(jobMock.remove).toHaveBeenCalled();
      expect(prismaMock.ejecucion_reporte.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cancelado: true }) }),
      );
    });

    it('si job está active, deja que processor lo detecte', async () => {
      prismaMock.ejecucion_reporte.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 42,
        estado: EstadoEjecucion.EJECUTANDO,
        jobId: 'job-1',
      });
      const jobMock = {
        getState: jest.fn().mockResolvedValue('active'),
        remove: jest.fn(),
      };
      queueMock.getJob.mockResolvedValue(jobMock);

      const r = await service.cancelar(1, 42);
      expect(r.ok).toBe(true);
      expect(jobMock.remove).not.toHaveBeenCalled();
    });
  });

  describe('eliminar', () => {
    it('rechaza si está en curso', async () => {
      prismaMock.ejecucion_reporte.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 42,
        estado: EstadoEjecucion.EJECUTANDO,
        archivoPath: null,
      });
      await expect(service.eliminar(1, 42)).rejects.toThrow(BadRequestException);
    });

    it('elimina archivo y registro si está finalizada', async () => {
      prismaMock.ejecucion_reporte.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 42,
        estado: EstadoEjecucion.FINALIZADA,
        archivoPath: '/tmp/x.xlsx',
      });
      prismaMock.ejecucion_reporte.delete.mockResolvedValue({});

      const r = await service.eliminar(1, 42);
      expect(r.ok).toBe(true);
      expect(storageMock.eliminarArchivo).toHaveBeenCalledWith('/tmp/x.xlsx');
      expect(prismaMock.ejecucion_reporte.delete).toHaveBeenCalled();
    });
  });

  describe('obtener', () => {
    it('NotFound si pertenece a otro usuario', async () => {
      prismaMock.ejecucion_reporte.findUnique.mockResolvedValue({
        id: 1,
        usuarioId: 99,
        estado: EstadoEjecucion.FINALIZADA,
      });
      await expect(service.obtener(1, 42)).rejects.toThrow(NotFoundException);
    });
  });
});
