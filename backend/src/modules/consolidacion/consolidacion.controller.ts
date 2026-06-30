/**
 * ConsolidacionController
 *
 * Endpoints REST para disparar la consolidación batch manual y consultar el estado.
 * Todos bajo /api/consolidacion (el prefijo /api viene de setGlobalPrefix en main.ts).
 *
 * Endpoints:
 *   POST /consolidacion/preview  → encola job con dryRun:true  → 202 { jobId }
 *   POST /consolidacion/aplicar  → encola job con dryRun:false → 202 { jobId } | 409 si hay lock
 *   GET  /consolidacion/estado   → { enCurso, jobId?, usuarioId?, iniciadoEn? }
 *
 * Auth: JWT global (JwtAuthGuard ya aplicado en app.module.ts).
 * Permiso fino: 'consolidacion.ejecutar' (solo en preview y aplicar, no en estado).
 */
import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Logger,
    Post,
    Req,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request } from 'express';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { ConsolidarScopeDto } from './dto/consolidar-scope.dto';
import { ConsolidacionRedisLockService } from './consolidacion-redis-lock.service';
import { RequestContextService } from '../../common/logger/request-context';
import { ConsolidacionJobData } from './interfaces/consolidacion-job-data.interface';
import { ConsolidacionScope } from './interfaces/consolidacion-result.interface';

@Controller('consolidacion')
export class ConsolidacionController {
    private readonly logger = new Logger(ConsolidacionController.name);

    constructor(
        @InjectQueue('consolidacion-queue')
        private readonly consolidacionQueue: Queue<ConsolidacionJobData>,
        private readonly lock: ConsolidacionRedisLockService,
        private readonly requestContext: RequestContextService,
    ) {}

    /**
     * POST /api/consolidacion/preview
     *
     * Encola un job de consolidación en modo dry-run (sin escribir).
     * El resultado llega por socket (consolidacion:finalizada con dryRun:true).
     */
    @Post('preview')
    @HttpCode(HttpStatus.ACCEPTED)
    @Permisos('consolidacion.ejecutar')
    async preview(
        @Body() dto: ConsolidarScopeDto,
        @UsuarioActual() usuario: { id: number },
    ) {
        this.validarScope(dto);

        const scope = this.toScope(dto);
        const usuarioId = usuario.id;
        const requestId = this.requestContext.getRequestId();

        this.logger.log(
            `Consolidación preview encolada scope=${scope.tipo} usuarioId=${usuarioId} req=${requestId}`,
        );

        const job = await this.consolidacionQueue.add(
            'consolidar',
            {
                scope,
                dryRun: true,
                usuarioId,
                _ctx: { requestId, usuarioId },
            },
            {
                attempts: 1,
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 20 },
            },
        );

        return { jobId: String(job.id) };
    }

    /**
     * POST /api/consolidacion/aplicar
     *
     * Toma el lock Redis y encola un job de consolidación real (dryRun:false).
     * Si hay un job activo → 409 CONSOLIDACION_EN_CURSO.
     */
    @Post('aplicar')
    @HttpCode(HttpStatus.ACCEPTED)
    @Permisos('consolidacion.ejecutar')
    async aplicar(
        @Body() dto: ConsolidarScopeDto,
        @UsuarioActual() usuario: { id: number },
    ) {
        this.validarScope(dto);

        const scope = this.toScope(dto);
        const usuarioId = usuario.id;
        const requestId = this.requestContext.getRequestId();

        this.logger.log(
            `Consolidación aplicar intent scope=${scope.tipo} usuarioId=${usuarioId} req=${requestId}`,
        );

        // Intentar tomar el lock antes de encolar
        const iniciadoEn = new Date().toISOString();

        // Necesitamos el jobId para la metadata, pero no lo tenemos antes del enqueue.
        // Solución: tomamos el lock con jobId placeholder y lo actualizamos
        // inmediatamente después. El TTL de 15 min da margen suficiente.
        // Alternativa simple: usar un ID provisional y sobreescribir con el real.
        const provisionalJobId = `pending-${Date.now()}`;

        const acquired = await this.lock.tryAcquire({
            jobId: provisionalJobId,
            usuarioId,
            iniciadoEn,
        });

        if (!acquired) {
            this.logger.warn(
                `Consolidación rechazada: lock activo scope=${scope.tipo} usuarioId=${usuarioId}`,
            );
            throw new ConflictException({
                code: 'CONSOLIDACION_EN_CURSO',
                message: 'Ya hay una consolidación en curso. Esperá a que termine.',
            });
        }

        let job: Awaited<ReturnType<typeof this.consolidacionQueue.add>>;
        try {
            job = await this.consolidacionQueue.add(
                'consolidar',
                {
                    scope,
                    dryRun: false,
                    usuarioId,
                    _ctx: { requestId, usuarioId },
                },
                {
                    attempts: 1,
                    removeOnComplete: { count: 50 },
                    removeOnFail: { count: 20 },
                },
            );
        } catch (err) {
            // Si el enqueue falla, soltar el lock para no dejarlo bloqueado
            await this.lock.release();
            throw err;
        }

        // Actualizar metadata del lock con el jobId real (el lock ya está tomado;
        // updateMeta sobreescribe la metadata sin re-intentar el SET NX).
        await this.lock.updateMeta({
            jobId: String(job.id),
            usuarioId,
            iniciadoEn,
        });

        this.logger.log(
            `Consolidación aplicar encolada jobId=${job.id} scope=${scope.tipo} usuarioId=${usuarioId}`,
        );

        return { jobId: String(job.id) };
    }

    /**
     * GET /api/consolidacion/estado
     *
     * Consulta si hay una consolidación en curso leyendo el lock Redis.
     * No requiere permiso fino (solo JWT) — útil para todos los que puedan ver la UI.
     */
    @Get('estado')
    async estado() {
        const { enCurso, meta } = await this.lock.getEstado();

        if (!enCurso) {
            return { enCurso: false };
        }

        return {
            enCurso: true,
            jobId: meta?.jobId,
            usuarioId: meta?.usuarioId,
            iniciadoEn: meta?.iniciadoEn,
        };
    }

    // ─── Helpers privados ─────────────────────────────────────────────────────

    /**
     * Valida las combinaciones scope/campo requerido.
     * Se hace en el controller (no en el DTO) porque es validación cruzada entre campos.
     */
    private validarScope(dto: ConsolidarScopeDto): void {
        if (dto.tipo === 'REMESA' && !dto.remesaId) {
            throw new BadRequestException(
                'remesaId es requerido cuando tipo es REMESA',
            );
        }
        if (dto.tipo === 'EMPRESA' && !dto.empresaId) {
            throw new BadRequestException(
                'empresaId es requerido cuando tipo es EMPRESA',
            );
        }
    }

    /**
     * Convierte el DTO de request al tipo interno ConsolidacionScope.
     * (scope DEUDORES no se expone vía endpoint — solo para el afterAll automático.)
     */
    private toScope(dto: ConsolidarScopeDto): ConsolidacionScope {
        switch (dto.tipo) {
            case 'REMESA':
                return { tipo: 'REMESA', remesaId: dto.remesaId! };
            case 'EMPRESA':
                return { tipo: 'EMPRESA', empresaId: dto.empresaId! };
            case 'TODAS':
                return { tipo: 'TODAS' };
        }
    }
}
