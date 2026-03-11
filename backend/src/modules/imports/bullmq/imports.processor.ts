import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ImportService } from '../imports.service';

@Processor('import-queue')
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(
    private readonly importService: ImportService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Procesando trabajo de importación ${job.id}`);

    try {
      const { remesaId, remesaOrigenId } = job.data;

      if (!remesaId) {
        throw new Error('remesaId es requerido en los datos del trabajo');
      }

      // Llamar al nuevo método del servicio que se encargará del procesamiento pesado
      const result = await this.importService.processImportJob(
        job,
        remesaId,
        remesaOrigenId
      );

      this.logger.log(`Trabajo de importación ${job.id} completado con éxito`);
      return result;
    } catch (error) {
      this.logger.error(`Error procesando trabajo de importación ${job.id}`, error);
      throw error;
    }
  }
}
