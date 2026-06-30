/**
 * ConsolidacionProcessor
 *
 * Worker BullMQ para el job de consolidación batch.
 * Corre dentro del RequestContext estándar del repo (AsyncLocalStorage).
 *
 * Reglas (spec §5):
 *  - attempts: 1 (no reintentar — decisión humana para re-disparar).
 *  - Lock Redis tomado ANTES de encolar (en el controller). El processor
 *    lo suelta siempre en el bloque finally.
 *  - Emite sockets al usuario que lo disparó: iniciada / progreso / finalizada.
 *  - Crea notificación persistente al terminar (éxito o error).
 *  - Auditoría best-effort (no lanza si falla).
 *
 * NOTA: El disparo automático del afterAll (Fase 3) NO pasa por este processor
 * y NO toca el lock Redis — queda dentro del scope del job de import.
 */
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { TipoNotificacion } from '@prisma/client';
import { nanoid } from 'nanoid';
import { ConsolidacionSituacionService } from '../consolidacion.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificacionesService } from '../../notificaciones/notificaciones.service';
import { AuditoriaHelper } from '../../transacciones/auditoria.helper';
import { AuditEstado, AuditModulo, AuditSeveridad, AuditTipo } from '../../transacciones/audit.enums';
import { RequestContextService } from '../../../common/logger/request-context';
import { ProgressEmitter } from '../../imports/utils/progress-emitter';
import { ConsolidacionRedisLockService } from '../consolidacion-redis-lock.service';
import { ConsolidacionJobData } from '../interfaces/consolidacion-job-data.interface';
import { ConsolidacionResult } from '../interfaces/consolidacion-result.interface';

@Processor('consolidacion-queue', { concurrency: 1 })
export class ConsolidacionProcessor extends WorkerHost {
    private readonly logger = new Logger(ConsolidacionProcessor.name);

    constructor(
        private readonly consolidacion: ConsolidacionSituacionService,
        private readonly realtime: RealtimeService,
        private readonly notificaciones: NotificacionesService,
        private readonly auditoria: AuditoriaHelper,
        private readonly requestContext: RequestContextService,
        private readonly lock: ConsolidacionRedisLockService,
    ) {
        super();
    }

    async process(job: Job<ConsolidacionJobData>): Promise<ConsolidacionResult> {
        const { _ctx } = job.data;
        const ctx = {
            requestId: _ctx?.requestId ?? nanoid(8),
            usuarioId: _ctx?.usuarioId ?? job.data.usuarioId,
            source: 'bull' as const,
            jobId: String(job.id),
            queue: job.queueName,
        };

        return this.requestContext.run(ctx, () => this.realProcess(job));
    }

    private async realProcess(job: Job<ConsolidacionJobData>): Promise<ConsolidacionResult> {
        const { scope, dryRun, usuarioId } = job.data;
        const jobId = String(job.id);

        this.logger.log(
            `Consolidación job iniciada jobId=${jobId} scope=${scope.tipo} dryRun=${dryRun} usuarioId=${usuarioId}`,
        );

        // 1. Emitir socket "iniciada"
        this.realtime.emitToUser(usuarioId, 'consolidacion:iniciada', {
            jobId,
            scope,
            dryRun,
        });

        // 2. Preparar emitter throttled de progreso (2s / 5% — mismo patrón imports)
        const progressEmitter = new ProgressEmitter(
            (progreso: number, evaluados: number) => {
                this.realtime.emitToUser(usuarioId, 'consolidacion:progreso', {
                    jobId,
                    progreso,
                    evaluados,
                    scope,
                });
            },
        );

        let result: ConsolidacionResult;

        try {
            // 3. Ejecutar la consolidación (dry-run o apply)
            result = await this.consolidacion.consolidar(scope, {
                dryRun,
                onProgress: (avance: number, total: number) => {
                    const pct = total > 0 ? Math.min(100, Math.floor((avance / total) * 100)) : 0;
                    progressEmitter.tick(pct, avance, 0);
                },
                requestId: this.requestContext.getRequestId(),
            });

            // Forzar emisión del 100% al finalizar
            progressEmitter.tick(100, result.evaluados, 0, true);

            this.logger.log(
                `Consolidación job finalizada jobId=${jobId} scope=${scope.tipo} dryRun=${dryRun}` +
                ` evaluados=${result.evaluados} aSIT050=${result.aSIT050} aSIT041=${result.aSIT041}` +
                ` sinCambios=${result.sinCambios} en ${result.durationMs}ms`,
            );

            // 4. Emitir socket "finalizada" con resultado
            this.realtime.emitToUser(usuarioId, 'consolidacion:finalizada', {
                jobId,
                result,
                dryRun,
                error: null,
            });

            // 5. Notificación persistente
            try {
                await this.notificaciones.crear({
                    destinatarioPrincipalId: usuarioId,
                    tipo: TipoNotificacion.SISTEMA,
                    titulo: dryRun ? 'Preview de consolidación listo' : 'Consolidación completada',
                    mensaje:
                        `Scope: ${scope.tipo}` +
                        ` · SIT-050: ${result.aSIT050}` +
                        ` · SIT-041: ${result.aSIT041}` +
                        ` · Sin cambios: ${result.sinCambios}`,
                    payload: { result, scope, dryRun },
                });
            } catch (err: any) {
                this.logger.warn(
                    `No se pudo crear notificación post-consolidación: ${err?.message}`,
                );
            }

            // 6. Auditoría (best-effort)
            try {
                await this.auditoria.log({
                    modulo: AuditModulo.IMPORT,
                    tipo: dryRun ? AuditTipo.EJECUTAR : AuditTipo.UPDATE,
                    entidad: 'Deudor',
                    usuarioId,
                    resumen: `Consolidación ${dryRun ? 'DRY' : 'APPLY'} scope=${scope.tipo}`,
                    data: { params: scope as Record<string, any>, contexto: result as any },
                });
            } catch (err: any) {
                this.logger.warn(`Auditoría post-consolidación falló: ${err?.message}`);
            }

            return result;
        } finally {
            // 7. Soltar el lock SOLO si este job lo tomó (apply). Los jobs de
            //    preview (dryRun) NO toman el lock, así que no deben liberarlo:
            //    con varias instancias del worker, un preview podría borrar el
            //    lock de un apply corriendo en paralelo en otra instancia.
            if (!dryRun) {
                await this.lock.release();
            }
        }
    }

    @OnWorkerEvent('failed')
    async onFailed(job: Job<ConsolidacionJobData>, error: Error): Promise<void> {
        const { scope, dryRun, usuarioId } = job.data;
        const jobId = String(job.id);

        this.logger.error(
            `Consolidación job fallida jobId=${jobId} scope=${scope.tipo} dryRun=${dryRun}: ${error?.message}`,
            error?.stack,
        );

        // Emitir socket de error al usuario
        try {
            this.realtime.emitToUser(usuarioId, 'consolidacion:finalizada', {
                jobId,
                result: null,
                dryRun,
                error: error?.message ?? 'Error desconocido',
            });
        } catch (emitErr: any) {
            this.logger.warn(`Error emitiendo consolidacion:finalizada (failed): ${emitErr?.message}`);
        }

        // Notificación de error
        try {
            await this.notificaciones.crear({
                destinatarioPrincipalId: usuarioId,
                tipo: TipoNotificacion.SISTEMA,
                titulo: 'Error en consolidación',
                mensaje: `Scope: ${scope.tipo} · ${error?.message ?? 'Error desconocido'}`,
                payload: { scope, dryRun, error: error?.message },
            });
        } catch (notifErr: any) {
            this.logger.warn(`Error creando notificación de fallo: ${notifErr?.message}`);
        }

        // Auditoría del fallo
        try {
            await this.auditoria.log({
                modulo: AuditModulo.IMPORT,
                tipo: AuditTipo.EJECUTAR,
                entidad: 'Deudor',
                severidad: AuditSeveridad.ERROR,
                estado: AuditEstado.FALLIDO,
                usuarioId,
                resumen: `Consolidación FAIL scope=${scope.tipo}: ${error?.message}`,
                data: { params: scope as Record<string, any>, contexto: { error: error?.message } },
            });
        } catch (auditErr: any) {
            this.logger.warn(`Auditoría de fallo de consolidación falló: ${auditErr?.message}`);
        }

        // Safety net: en el camino normal el lock ya se libera en el finally de
        // realProcess. Pero si el job falló ANTES de ese try (ej. setup del
        // requestContext), ese finally no corrió. Lo liberamos acá igual (solo
        // apply; el DEL es idempotente). Si todo falla, el TTL de 15 min lo cubre.
        if (!dryRun) {
            await this.lock.release();
        }
    }

    @OnWorkerEvent('stalled')
    onStalled(jobId: string): void {
        this.logger.warn(`Consolidación job stallada jobId=${jobId}`);
    }
}
