import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { ImportService } from '../imports.service';
import { AuditoriaHelper } from '../../transacciones/auditoria.helper';
import { AuditEstado, AuditModulo, AuditSeveridad, AuditTipo } from '../../transacciones/audit.enums';
import { RequestContextService } from 'src/common/logger/request-context';

@Processor('import-queue')
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(
    private readonly importService: ImportService,
    private readonly auditoria: AuditoriaHelper,
    private readonly requestContext: RequestContextService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { remesaId, remesaOrigenId, usuarioId, _ctx } = job.data ?? {};

    const parentCtx = _ctx as { requestId?: string; usuarioId?: number } | undefined;
    const ctx = {
      requestId: parentCtx?.requestId ?? nanoid(8),
      usuarioId: parentCtx?.usuarioId ?? usuarioId,
      source: 'bull' as const,
      jobId: String(job.id),
      queue: job.queueName,
    };

    return this.requestContext.run(ctx, () => this.realProcess(job, remesaId, remesaOrigenId, usuarioId));
  }

  private async realProcess(job: Job<any, any, string>, remesaId: number, remesaOrigenId: number | undefined, usuarioId: number | undefined): Promise<any> {
    this.logger.log(`Iniciando importación remesa=${remesaId} usuario=${usuarioId ?? 'SYS'} job=${job.id}`);

    try {
      if (!remesaId) {
        throw new Error('remesaId es requerido en los datos del trabajo');
      }

      const result = await this.importService.processImportJob(
        job,
        remesaId,
        remesaOrigenId,
      );

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
      this.logger.error(`Importación falló remesa=${remesaId} job=${job.id}: ${error?.message}`, error?.stack);
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
