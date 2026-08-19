import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
} from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, BadRequestException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { RequestContextService } from '../../../common/logger/request-context';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  REPORTES_QUEUE_NAME,
  EjecutarReporteJobData,
  EjecutarReporteJobResult,
} from './reportes.queue';
import {
  AsyncExecutorService,
  ExecucionCanceladaError,
} from './async-executor.service';
import { ReportesStorageService } from '../storage/reportes-storage.service';
import { ReportesGateway } from '../gateway/reportes.gateway';
import { XlsxExportador } from '../exportadores/xlsx.exportador';
import { CsvExportador } from '../exportadores/csv.exportador';
import { TxtExportador } from '../exportadores/txt.exportador';
import { PdfExportador } from '../exportadores/pdf.exportador';
import { FormatoSalida } from '../dto/plantilla.dto';
import { EstadoEjecucion } from '../dto/ejecuciones.dto';
import { opcionesDelFormato } from '../exportadores/opciones-formato';

const PROGRESS_EMIT_INTERVAL_MS = 500;
const CANCEL_CHECK_EVERY_CHUNKS = 1;

@Processor(REPORTES_QUEUE_NAME)
export class ReportesProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: AsyncExecutorService,
    private readonly storage: ReportesStorageService,
    private readonly gateway: ReportesGateway,
    private readonly xlsxExp: XlsxExportador,
    private readonly csvExp: CsvExportador,
    private readonly txtExp: TxtExportador,
    private readonly pdfExp: PdfExportador,
    private readonly requestContext: RequestContextService,
  ) {
    super();
  }

  async process(
    job: Job<EjecutarReporteJobData, EjecutarReporteJobResult, string>,
  ): Promise<EjecutarReporteJobResult> {
    const { ejecucionId, plantillaId, usuarioId, filtrosVars, formato, _ctx } = job.data;

    const parentCtx = _ctx as { requestId?: string; usuarioId?: number } | undefined;
    const ctx = {
      requestId: parentCtx?.requestId ?? nanoid(8),
      usuarioId: parentCtx?.usuarioId ?? usuarioId,
      source: 'bull' as const,
      jobId: String(job.id),
      queue: job.queueName,
    };

    return this.requestContext.run(ctx, () => this.realProcess(job));
  }

  private async realProcess(
    job: Job<EjecutarReporteJobData, EjecutarReporteJobResult, string>,
  ): Promise<EjecutarReporteJobResult> {
    const { ejecucionId, plantillaId, usuarioId, filtrosVars, formato } = job.data;

    this.logger.log(
      `[ejecucionId=${ejecucionId}] Iniciando job ${job.id} plantilla=${plantillaId} formato=${formato}`,
    );

    const startTime = Date.now();
    let lastProgressEmit = 0;

    try {
      const plantilla = await this.prisma.plantilla_reporte.findUnique({
        where: { id: plantillaId },
      });

      if (!plantilla) {
        throw new BadRequestException(`Plantilla ${plantillaId} no encontrada`);
      }

      await this.prisma.ejecucion_reporte.update({
        where: { id: ejecucionId },
        data: {
          estado: EstadoEjecucion.EJECUTANDO,
          iniciadoEn: new Date(),
          jobId: String(job.id ?? ''),
        },
      });

      let totalEstimado: number | null = null;
      try {
        totalEstimado = await this.executor.estimarFilas(
          plantilla.definicion as any,
          plantilla.raiz,
          filtrosVars,
        );
        await this.prisma.ejecucion_reporte.update({
          where: { id: ejecucionId },
          data: { totalFilas: totalEstimado },
        });
      } catch (error) {
        this.logger.warn(
          `[ejecucionId=${ejecucionId}] No se pudo estimar filas: ${(error as Error).message}`,
        );
      }

      this.gateway.emitProgreso(usuarioId, {
        ejecucionId,
        progreso: 0,
        filasProcesadas: 0,
        totalFilas: totalEstimado,
        fase: 'leyendo',
      });

      const resultado = await this.executor.executeStreaming(
        plantilla.definicion as any,
        {
          raiz: plantilla.raiz,
          filtrosVars,
          chunkSize: parseInt(
            process.env.REPORTES_CHUNK_SIZE || '1000',
            10,
          ),
          hardLimit: parseInt(
            process.env.REPORTES_HARD_LIMIT || '200000',
            10,
          ),
          isCancelled: async () => {
            const fresh = await this.prisma.ejecucion_reporte.findUnique({
              where: { id: ejecucionId },
              select: { cancelado: true },
            });
            return fresh?.cancelado === true;
          },
          onChunk: async ({ chunkIndex, totalProcessed }) => {
            if (chunkIndex % CANCEL_CHECK_EVERY_CHUNKS !== 0) return;

            const progreso = totalEstimado
              ? Math.min(99, Math.floor((totalProcessed / totalEstimado) * 100))
              : 0;

            await this.prisma.ejecucion_reporte.update({
              where: { id: ejecucionId },
              data: {
                filasProcesadas: totalProcessed,
                progreso,
              },
            });

            await job.updateProgress({
              rowsProcessed: totalProcessed,
              total: totalEstimado,
              fase: 'leyendo',
            });

            const now = Date.now();
            if (now - lastProgressEmit >= PROGRESS_EMIT_INTERVAL_MS) {
              lastProgressEmit = now;
              this.gateway.emitProgreso(usuarioId, {
                ejecucionId,
                progreso,
                filasProcesadas: totalProcessed,
                totalFilas: totalEstimado,
                fase: 'leyendo',
              });
            }
          },
        },
      );

      this.gateway.emitProgreso(usuarioId, {
        ejecucionId,
        progreso: 99,
        filasProcesadas: resultado.totalFilas,
        totalFilas: totalEstimado,
        fase: 'exportando',
      });

      const buffer = await this.exportar(
        formato,
        resultado.filas as any,
        resultado.columnas,
        opcionesDelFormato(plantilla.opcionesFormato, formato),
      );

      const { filePath, tamano } = await this.storage.guardarArchivo(
        ejecucionId,
        formato,
        buffer,
      );

      const duracionMs = Date.now() - startTime;

      await this.prisma.ejecucion_reporte.update({
        where: { id: ejecucionId },
        data: {
          estado: EstadoEjecucion.FINALIZADA,
          progreso: 100,
          filasProcesadas: resultado.totalFilas,
          totalFilas: resultado.totalFilas,
          archivoPath: filePath,
          archivoTamano: tamano,
          duracionMs,
          finishedAt: new Date(),
        },
      });

      this.gateway.emitCompletado(usuarioId, {
        ejecucionId,
        archivoTamano: tamano,
        totalFilas: resultado.totalFilas,
        duracionMs,
      });

      this.logger.log(
        `[ejecucionId=${ejecucionId}] Finalizado en ${duracionMs}ms, filas=${resultado.totalFilas}, tamano=${tamano} bytes`,
      );

      return {
        ejecucionId,
        totalFilas: resultado.totalFilas,
        archivoTamano: tamano,
        duracionMs,
      };
    } catch (error) {
      const cancelado = error instanceof ExecucionCanceladaError;
      const mensaje = (error as Error).message || 'Error desconocido';

      this.logger.error(
        `[ejecucionId=${ejecucionId}] ${cancelado ? 'Cancelado' : 'Falló'}: ${mensaje}`,
        (error as Error).stack,
      );

      await this.prisma.ejecucion_reporte.update({
        where: { id: ejecucionId },
        data: {
          estado: cancelado
            ? EstadoEjecucion.CANCELADA
            : EstadoEjecucion.FALLIDA,
          errorMsg: mensaje,
          finishedAt: new Date(),
          duracionMs: Date.now() - startTime,
        },
      });

      if (!cancelado) {
        this.gateway.emitFallido(usuarioId, {
          ejecucionId,
          error: mensaje,
        });
      } else {
        this.gateway.emitFallido(usuarioId, {
          ejecucionId,
          error: 'Ejecución cancelada',
        });
      }

      if (cancelado) {
        return {
          ejecucionId,
          totalFilas: 0,
          archivoTamano: 0,
          duracionMs: Date.now() - startTime,
        };
      }

      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EjecutarReporteJobData> | undefined, err: Error): void {
    const ejecucionId = job?.data?.ejecucionId;
    this.logger.error(
      `Worker event failed jobId=${job?.id} ejecucionId=${ejecucionId}: ${err.message}`,
      err.stack,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`Worker event stalled jobId=${jobId}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<EjecutarReporteJobData>): void {
    this.logger.log(
      `Worker event completed jobId=${job.id} ejecucionId=${job.data?.ejecucionId}`,
    );
  }

  private async exportar(
    formato: string,
    filas: any,
    columnas: string[],
    opciones?: Prisma.JsonValue,
  ): Promise<Buffer> {
    const opc = (opciones || undefined) as any;
    switch (formato) {
      case FormatoSalida.XLSX:
        return this.xlsxExp.generar(filas, columnas, opc);
      case FormatoSalida.CSV:
        return this.csvExp.generar(filas, columnas, opc);
      case FormatoSalida.TXT:
        return this.txtExp.generar(filas, columnas, opc);
      case FormatoSalida.PDF:
        return this.pdfExp.generar(filas, columnas, opc);
      default:
        throw new BadRequestException(`Formato ${formato} no soportado`);
    }
  }
}
