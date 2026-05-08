import { Test, TestingModule } from '@nestjs/testing';
import {
  AsyncExecutorService,
  ExecucionCanceladaError,
} from './async-executor.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { QueryPlanner } from '../planner/query-planner';
import { BadRequestException } from '@nestjs/common';

describe('AsyncExecutorService', () => {
  let svc: AsyncExecutorService;
  let prisma: any;
  let planner: QueryPlanner;

  const definicion = {
    columnas: [{ id: 'c1', path: 'documento', label: 'Doc' }],
  } as any;

  beforeEach(async () => {
    prisma = {
      deudor: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    planner = new QueryPlanner();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AsyncExecutorService,
        { provide: PrismaService, useValue: prisma },
        { provide: QueryPlanner, useValue: planner },
      ],
    }).compile();

    svc = module.get(AsyncExecutorService);
  });

  it('estimarFilas devuelve count del prisma', async () => {
    prisma.deudor.count.mockResolvedValue(7777);
    const total = await svc.estimarFilas(definicion, 'deudor');
    expect(total).toBe(7777);
    expect(prisma.deudor.count).toHaveBeenCalled();
  });

  it('estimarFilas rechaza raíz no soportada', async () => {
    await expect(svc.estimarFilas(definicion, 'otra' as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('executeStreaming itera por chunks usando cursor', async () => {
    const chunkA = [
      { id: 1, documento: 'A1' },
      { id: 2, documento: 'A2' },
    ];
    const chunkB = [{ id: 3, documento: 'A3' }];

    prisma.deudor.findMany
      .mockResolvedValueOnce(chunkA)
      .mockResolvedValueOnce(chunkB)
      .mockResolvedValueOnce([]);

    const onChunk = jest.fn();
    const r = await svc.executeStreaming(definicion, {
      raiz: 'deudor',
      chunkSize: 2,
      onChunk,
    });

    expect(r.totalFilas).toBe(3);
    expect(prisma.deudor.findMany).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenCalledTimes(2);

    const secondCallArgs = prisma.deudor.findMany.mock.calls[1][0];
    expect(secondCallArgs.cursor).toEqual({ id: 2 });
    expect(secondCallArgs.skip).toBe(1);
  });

  it('executeStreaming respeta cancelación cooperativa', async () => {
    prisma.deudor.findMany.mockResolvedValue([{ id: 1, documento: 'A' }]);

    let calls = 0;
    const isCancelled = jest.fn(() => {
      calls++;
      return calls >= 2;
    });

    await expect(
      svc.executeStreaming(definicion, {
        raiz: 'deudor',
        chunkSize: 1,
        isCancelled,
      }),
    ).rejects.toThrow(ExecucionCanceladaError);
  });

  it('executeStreaming aborta si supera hardLimit', async () => {
    const big = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      documento: `A${i}`,
    }));
    prisma.deudor.findMany.mockResolvedValue(big);

    await expect(
      svc.executeStreaming(definicion, {
        raiz: 'deudor',
        chunkSize: 50,
        hardLimit: 30,
      }),
    ).rejects.toThrow(/excede el límite máximo/);
  });
});
