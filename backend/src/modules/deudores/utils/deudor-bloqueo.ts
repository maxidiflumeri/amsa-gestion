/**
 * DeudorBloqueoService
 *
 * Helper compartido que verifica si un deudor está en situación SIT-050 (Cancelado)
 * y lanza ForbiddenException si alguna mutación de negocio intenta modificarlo.
 *
 * IMPORTANTE: Este servicio NO bloquea al ConsolidacionSituacionService, que
 * escribe directamente con prisma.deudor.update/updateMany sin pasar por aquí.
 * Ver consolidacion-situacion-spec.md §8.4 y §10.10.
 *
 * Modo degradado: si SIT-050 no está seedeado (sit050Id === null),
 * assertNoBloqueado no lanza y deja pasar. Esto permite levantar el sistema
 * antes de correr seed-codigos-curados.ts.
 */
import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class DeudorBloqueoService implements OnModuleInit {
    private readonly logger = new Logger(DeudorBloqueoService.name);
    private sit050Id: number | null = null;

    constructor(private readonly prisma: PrismaService) {}

    async onModuleInit(): Promise<void> {
        const sit050 = await this.prisma.parametro.findUnique({
            where: { clave: 'SIT-050' },
        });
        this.sit050Id = sit050?.id ?? null;

        if (this.sit050Id === null) {
            this.logger.warn(
                'SIT-050 no encontrado en tabla parametro. DeudorBloqueoService operará en modo degradado (sin bloqueo). Correr seed-codigos-curados.ts para habilitarlo.',
            );
        } else {
            this.logger.log(`DeudorBloqueoService inicializado: sit050Id=${this.sit050Id}`);
        }
    }

    /**
     * Lanza ForbiddenException con code=DEUDOR_CANCELADO si el deudor está en SIT-050.
     * Si sit050Id no está cacheado (modo degradado), no hace nada.
     *
     * @param deudorId  ID del deudor a verificar
     * @param accion    Descripción de la acción que se intenta (para el mensaje de error y el log)
     */
    async assertNoBloqueado(deudorId: number, accion: string): Promise<void> {
        if (this.sit050Id === null) {
            return;
        }

        const d = await this.prisma.deudor.findUnique({
            where: { id: deudorId },
            select: { estadoSituacionId: true },
        });

        if (d?.estadoSituacionId === this.sit050Id) {
            this.logger.warn(
                `Acción bloqueada: deudorId=${deudorId} accion='${accion}' — el deudor está en SIT-050 (cancelado).`,
            );
            throw new ForbiddenException({
                code: 'DEUDOR_CANCELADO',
                message: `El deudor está cancelado (SIT-050). Acción '${accion}' no permitida.`,
            });
        }
    }
}
