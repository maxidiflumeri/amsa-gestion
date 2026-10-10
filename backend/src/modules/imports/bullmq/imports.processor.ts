import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { HttpException, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { ImportService } from '../imports.service';
import { AuditoriaHelper } from '../../transacciones/auditoria.helper';
import { AuditEstado, AuditModulo, AuditSeveridad, AuditTipo } from '../../transacciones/audit.enums';
import { RequestContextService } from 'src/common/logger/request-context';

/**
 * Opciones explícitas del worker de importaciones (docs/imports-progreso-realtime-spec.md §9.5.1).
 * Política: una carga NUNCA se re-ejecuta sola. Si el worker muere a mitad de una carga, BullMQ falla el
 * job sin llamar al processor (`maxStalledCount: 0`) y la carga la cierra el reaper como FALLIDA con motivo.
 */
export const OPCIONES_WORKER_IMPORT = {
  /** Las cargas van de a una: lo supone el registro de cargas vivas, la posición en la cola y el orden de una división. */
  concurrency: 1,
  /** El lock es la señal de vida que BullMQ mira; se renueva cada 30 a 60 s, así que un bloqueo del event loop de menos de un minuto no lo pierde. */
  lockDuration: 120_000,
  stalledInterval: 30_000,
  /** Un job cuyo worker murió NO se vuelve a ejecutar. */
  maxStalledCount: 0,
} as const;

@Processor('import-queue', OPCIONES_WORKER_IMPORT)
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(
    private readonly importService: ImportService,
    private readonly auditoria: AuditoriaHelper,
    private readonly requestContext: RequestContextService,
  ) {
    super();
  }

  // Tres listeners que solo loguean: ninguno escribe en la base. El que cierra una carga interrumpida es
  // un solo camino, el reaper (§9.5.1).
  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(`BullMQ dio por perdido el job ${jobId} de la cola de importaciones`);
  }

  /** Hoy BullMQ lo manda a `console.error`, sin `requestId`; acá entra la falla de renovación de lock, que es la huella de un event loop bloqueado. */
  @OnWorkerEvent('error')
  onError(err: Error): void {
    this.logger.warn(`Error del worker de importaciones: ${err?.message}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    if (!/stalled/i.test(err?.message ?? '')) return;
    // No afirma que no se ejecutó: tras congelarse el proceso, BullMQ puede marcar failed un job cuya carga terminó.
    this.logger.warn(
      `BullMQ dio por perdido el job ${job?.id} (remesa ${job?.data?.remesaId}); si la carga no terminó, la cierra el reaper`,
    );
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { remesaId, remesaOrigenId, remesaOrigenIds, usuarioId, _ctx } = job.data ?? {};

    const parentCtx = _ctx as { requestId?: string; usuarioId?: number } | undefined;
    const ctx = {
      requestId: parentCtx?.requestId ?? nanoid(8),
      usuarioId: parentCtx?.usuarioId ?? usuarioId,
      source: 'bull' as const,
      jobId: String(job.id),
      queue: job.queueName,
    };

    return this.requestContext.run(ctx, () => this.realProcess(job, remesaId, remesaOrigenId, remesaOrigenIds, usuarioId));
  }

  private async realProcess(job: Job<any, any, string>, remesaId: number, remesaOrigenId: number | undefined, remesaOrigenIds: number[] | undefined, usuarioId: number | undefined): Promise<any> {
    this.logger.log(`Iniciando importación remesa=${remesaId} usuario=${usuarioId ?? 'SYS'} job=${job.id}`);

    try {
      if (!remesaId) {
        throw new Error('remesaId es requerido en los datos del trabajo');
      }

      const result = await this.importService.processImportJob(
        job,
        remesaId,
        remesaOrigenId,
        remesaOrigenIds,
      );

      // Un job ignorado por las guardas del service (la carga ya terminó, o es un borrador) no es una
      // importación completada: no se loguea como tal ni se audita un OK.
      if (result?.ignorado) {
        this.logger.warn(`Job ignorado remesa=${remesaId} job=${job.id}: la carga no estaba para procesarse`);
        return result;
      }

      // Una carga cancelada (§10.5.3) no es una importación completada ni una falla: el runner ya la cerró, la notificó y
      // auditó el corte (`IMPORT_FAIL`, WARN). Se trata como un `ignorado`, con su propia línea.
      if (result?.cancelada) {
        this.logger.warn(`Importación cancelada remesa=${remesaId} job=${job.id}`);
        return result;
      }

      this.logger.log(`Importación completada remesa=${remesaId} job=${job.id}`);

      await this.auditoria.log({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.IMPORT_OK,
        usuarioId: usuarioId ?? null,
        entidadId: remesaId,
        resumen: `Import OK remesa ${remesaId}`,
        data: { contexto: { jobId: job.id, remesaOrigenId } },
      });

      return result;
    } catch (error: any) {
      // El service ya logueó el stack de las fallas inesperadas: acá una sola línea, y `warn` si es de negocio.
      if (error instanceof HttpException) {
        this.logger.warn(`Importación rechazada remesa=${remesaId} job=${job.id}: ${error.message}`);
      } else {
        this.logger.error(`Importación falló remesa=${remesaId} job=${job.id}: ${error?.message}`);
      }
      await this.auditoria.log({
        modulo: AuditModulo.IMPORT,
        entidad: 'Remesa',
        tipo: AuditTipo.IMPORT_FAIL,
        severidad: AuditSeveridad.ERROR,
        estado: AuditEstado.FALLIDO,
        usuarioId: usuarioId ?? null,
        entidadId: remesaId,
        resumen: `Import FAIL remesa ${remesaId}`,
        data: { contexto: { jobId: job.id, error: error?.message } },
      });
      throw error;
    }
  }
}
