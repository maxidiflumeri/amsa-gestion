import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ImportService } from '../imports.service';
import { AuditoriaHelper } from '../../transacciones/auditoria.helper';
import { AuditEstado, AuditModulo, AuditSeveridad, AuditTipo } from '../../transacciones/audit.enums';

@Processor('import-queue')
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(
    private readonly importService: ImportService,
    private readonly auditoria: AuditoriaHelper,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Procesando trabajo de importación ${job.id}`);
    const { remesaId, remesaOrigenId, usuarioId } = job.data ?? {};

    try {
      if (!remesaId) {
        throw new Error('remesaId es requerido en los datos del trabajo');
      }

      const result = await this.importService.processImportJob(
        job,
        remesaId,
        remesaOrigenId,
      );

      this.logger.log(`Trabajo de importación ${job.id} completado con éxito`);

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
      this.logger.error(`Error procesando trabajo de importación ${job.id}`, error);
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
