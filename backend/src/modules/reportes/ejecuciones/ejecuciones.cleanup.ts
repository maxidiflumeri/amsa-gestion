import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportesStorageService } from '../storage/reportes-storage.service';
import { EstadoEjecucion } from '../dto/ejecuciones.dto';

@Injectable()
export class EjecucionesCleanupService {
  private readonly logger = new Logger(EjecucionesCleanupService.name);

  constructor(
    private prisma: PrismaService,
    private storage: ReportesStorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupAntiguas(): Promise<void> {
    const dias = parseInt(process.env.REPORTES_RETENTION_DAYS || '30', 10);
    await this.runCleanup(dias);
  }

  async runCleanup(dias: number): Promise<{ eliminadas: number }> {
    const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    this.logger.log(
      `Cleanup de ejecuciones anteriores a ${cutoff.toISOString()} (retencion=${dias}d)`,
    );

    const candidatas = await this.prisma.ejecucion_reporte.findMany({
      where: {
        createdAt: { lt: cutoff },
        estado: {
          in: [EstadoEjecucion.FINALIZADA, EstadoEjecucion.FALLIDA],
        },
      },
      select: { id: true, archivoPath: true },
    });

    let eliminadas = 0;

    for (const ej of candidatas) {
      try {
        if (ej.archivoPath) {
          await this.storage.eliminarArchivo(ej.archivoPath);
        }
        await this.prisma.ejecucion_reporte.delete({ where: { id: ej.id } });
        eliminadas++;
      } catch (error) {
        this.logger.error(
          `Error eliminando ejecución ${ej.id}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(`Cleanup completo: ${eliminadas} ejecuciones eliminadas`);
    return { eliminadas };
  }
}
