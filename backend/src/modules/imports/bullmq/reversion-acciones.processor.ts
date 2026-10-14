import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { RequestContextService } from 'src/common/logger/request-context';
import { ReversionAccionesService } from '../reversion/reversion-acciones.service';
import { COLA_REVERSION } from '../reversion/reversion-accion.reglas';

/**
 * Opciones explícitas del worker de reversiones (docs/imports-progreso-c3-spec.md §17.5.4). Las mismas razones que
 * `OPCIONES_WORKER_IMPORT`: de a una, el lock se renueva con holgura y un job cuyo worker murió NO se vuelve a ejecutar
 * (D4): la fila queda REVIRTIENDO, el cron la pasa a INTERRUMPIDA y Revertir sigue desde ahí.
 */
export const OPCIONES_WORKER_REVERSION = {
  concurrency: 1,
  lockDuration: 120_000,
  stalledInterval: 30_000,
  maxStalledCount: 0,
} as const;

/** Cola propia y no `import-queue`: una reversión no tiene que esperar detrás de una carga de 20 minutos. */
@Processor(COLA_REVERSION, OPCIONES_WORKER_REVERSION)
export class ReversionAccionesProcessor extends WorkerHost {
  private readonly logger = new Logger(ReversionAccionesProcessor.name);

  constructor(
    private readonly reversion: ReversionAccionesService,
    private readonly requestContext: RequestContextService,
  ) {
    super();
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`BullMQ dio por perdido el job ${jobId} de la cola de reversiones; el cron lo pasa a INTERRUMPIDA`);
  }

  @OnWorkerEvent('error')
  onError(err: Error): void {
    this.logger.warn(`Error del worker de reversiones: ${err?.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.warn(`Job de reversión ${job?.id} (remesa ${job?.data?.remesaId}) falló: ${err?.message}`);
  }

  async process(job: Job<any, any, string>): Promise<void> {
    const { remesaId, usuarioId, _ctx } = job.data ?? {};
    const parentCtx = _ctx as { requestId?: string; usuarioId?: number } | undefined;
    const ctx = {
      requestId: parentCtx?.requestId ?? nanoid(8),
      usuarioId: parentCtx?.usuarioId ?? usuarioId ?? undefined,
      source: 'bull' as const,
      jobId: String(job.id),
      queue: job.queueName,
    };
    return this.requestContext.run(ctx, async () => {
      if (!remesaId) throw new Error('remesaId es requerido en los datos del trabajo');
      // `ejecutar` ya cerró la fila como FALLIDA y logueó el stack: acá solo se re-lanza, para que BullMQ lo marque failed.
      await this.reversion.ejecutar(Number(remesaId), String(job.id));
    });
  }
}
