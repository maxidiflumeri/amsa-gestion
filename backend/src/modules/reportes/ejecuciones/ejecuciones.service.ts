import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportesStorageService } from '../storage/reportes-storage.service';
import { AsyncExecutorService } from '../async/async-executor.service';
import {
  REPORTES_QUEUE_NAME,
  REPORTES_JOB_EJECUTAR,
  EjecutarReporteJobData,
} from '../async/reportes.queue';
import {
  EncolarEjecucionResponse,
  EstadoEjecucion,
  EstimarResponse,
  ListarEjecucionesQueryDto,
} from '../dto/ejecuciones.dto';

const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class EjecucionesService {
  private readonly logger = new Logger(EjecucionesService.name);
  private readonly umbralSync: number;

  constructor(
    private prisma: PrismaService,
    private storage: ReportesStorageService,
    private executor: AsyncExecutorService,
    @InjectQueue(REPORTES_QUEUE_NAME) private queue: Queue,
  ) {
    this.umbralSync = parseInt(
      process.env.REPORTES_SYNC_THRESHOLD || '5000',
      10,
    );
  }

  getUmbralSync(): number {
    return this.umbralSync;
  }

  async estimar(
    plantillaId: number,
    filtrosVars?: Record<string, any>,
  ): Promise<EstimarResponse> {
    const plantilla = await this.prisma.plantilla_reporte.findUnique({
      where: { id: plantillaId },
    });

    if (!plantilla) {
      throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);
    }

    const total = await this.executor.estimarFilas(
      plantilla.definicion as any,
      plantilla.raiz,
      filtrosVars,
    );

    return {
      totalEstimado: total,
      modoSugerido: total > this.umbralSync ? 'async' : 'sync',
      umbral: this.umbralSync,
    };
  }

  async encolarEjecucion(
    plantillaId: number,
    usuarioId: number,
    filtrosVars: Record<string, any>,
  ): Promise<EncolarEjecucionResponse> {
    const plantilla = await this.prisma.plantilla_reporte.findUnique({
      where: { id: plantillaId },
    });

    if (!plantilla) {
      throw new NotFoundException(`Plantilla ${plantillaId} no encontrada`);
    }

    const ejecucion = await this.prisma.ejecucion_reporte.create({
      data: {
        plantillaId,
        usuarioId,
        empresaId: plantilla.empresaId ?? null,
        filtrosUsados: (filtrosVars || {}) as Prisma.InputJsonValue,
        estado: EstadoEjecucion.PENDIENTE,
        modo: 'ASYNC',
        formato: plantilla.formatoSalida,
      },
    });

    const jobData: EjecutarReporteJobData = {
      ejecucionId: ejecucion.id,
      plantillaId,
      usuarioId,
      empresaId: plantilla.empresaId ?? null,
      filtrosVars: filtrosVars || {},
      formato: plantilla.formatoSalida,
    };

    const job = await this.queue.add(REPORTES_JOB_EJECUTAR, jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 24 * 3600 },
    });

    await this.prisma.ejecucion_reporte.update({
      where: { id: ejecucion.id },
      data: { jobId: String(job.id ?? '') },
    });

    this.logger.log(
      `Encolada ejecución ${ejecucion.id} jobId=${job.id} plantilla=${plantillaId}`,
    );

    return {
      ejecucionId: ejecucion.id,
      modo: 'async',
      estado: EstadoEjecucion.PENDIENTE,
    };
  }

  async listar(
    usuarioId: number,
    empresaId: number | null,
    query: ListarEjecucionesQueryDto,
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || DEFAULT_PAGE_SIZE;

    // usuarioId=0 significa "ver todas" (permiso admin)
    const where: Prisma.ejecucion_reporteWhereInput = usuarioId > 0 ? { usuarioId } : {};

    if (query.estado) {
      where.estado = query.estado;
    }
    if (query.plantillaId) {
      where.plantillaId = query.plantillaId;
    }
    if (empresaId !== null) {
      where.OR = [{ empresaId }, { empresaId: null }];
    }

    const [items, total] = await Promise.all([
      this.prisma.ejecucion_reporte.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          plantilla: {
            select: { id: true, nombre: true, formatoSalida: true },
          },
        },
      }),
      this.prisma.ejecucion_reporte.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async obtener(id: number, usuarioId: number) {
    const ejecucion = await this.prisma.ejecucion_reporte.findUnique({
      where: { id },
      include: {
        plantilla: {
          select: { id: true, nombre: true, formatoSalida: true },
        },
      },
    });

    if (!ejecucion) {
      throw new NotFoundException(`Ejecución ${id} no encontrada`);
    }

    if (ejecucion.usuarioId !== usuarioId) {
      throw new NotFoundException(`Ejecución ${id} no encontrada`);
    }

    return ejecucion;
  }

  async cancelar(id: number, usuarioId: number) {
    const ejecucion = await this.obtener(id, usuarioId);

    if (
      ejecucion.estado !== EstadoEjecucion.PENDIENTE &&
      ejecucion.estado !== EstadoEjecucion.EJECUTANDO
    ) {
      throw new BadRequestException(
        `No se puede cancelar una ejecución en estado ${ejecucion.estado}`,
      );
    }

    await this.prisma.ejecucion_reporte.update({
      where: { id },
      data: { cancelado: true },
    });

    if (ejecucion.jobId) {
      try {
        const job = await this.queue.getJob(ejecucion.jobId);
        if (job) {
          const state = await job.getState();
          if (state === 'waiting' || state === 'delayed') {
            await job.remove();
            await this.prisma.ejecucion_reporte.update({
              where: { id },
              data: {
                estado: EstadoEjecucion.CANCELADA,
                finishedAt: new Date(),
              },
            });
            this.logger.log(
              `Ejecución ${id} cancelada (job removido en estado ${state})`,
            );
          } else {
            this.logger.log(
              `Ejecución ${id} marcada cancelada, processor detendrá entre chunks`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `Error al intentar remover job ${ejecucion.jobId}: ${(error as Error).message}`,
        );
      }
    }

    return { ok: true };
  }

  async eliminar(id: number, usuarioId: number) {
    const ejecucion = await this.obtener(id, usuarioId);

    if (
      ejecucion.estado === EstadoEjecucion.EJECUTANDO ||
      ejecucion.estado === EstadoEjecucion.PENDIENTE
    ) {
      throw new BadRequestException(
        'No se puede eliminar una ejecución en curso. Cancelala primero.',
      );
    }

    if (ejecucion.archivoPath) {
      await this.storage.eliminarArchivo(ejecucion.archivoPath);
    }

    await this.prisma.ejecucion_reporte.delete({ where: { id } });

    return { ok: true };
  }

  async obtenerArchivo(id: number, usuarioId: number) {
    const ejecucion = await this.obtener(id, usuarioId);

    if (ejecucion.estado !== EstadoEjecucion.FINALIZADA) {
      throw new BadRequestException(
        `La ejecución no está finalizada (estado: ${ejecucion.estado})`,
      );
    }

    if (!ejecucion.archivoPath) {
      throw new NotFoundException('La ejecución no tiene archivo asociado');
    }

    if (!(await this.storage.existeArchivo(ejecucion.archivoPath))) {
      throw new NotFoundException('Archivo no disponible en el filesystem');
    }

    return {
      ejecucion,
      stream: this.storage.abrirStream(ejecucion.archivoPath),
    };
  }
}
