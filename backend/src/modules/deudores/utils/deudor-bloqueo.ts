/**
 * DeudorBloqueoService
 *
 * Helper compartido que verifica si un deudor está en una situación **cancelada** y lanza
 * ForbiddenException si alguna mutación de negocio intenta modificarlo.
 *
 * Bloquea toda la **categoría CANCELADO**, no solo SIT-050. Antes miraba únicamente esa clave, así
 * que un caso puesto a mano en "Cancelado antes de la gestión" (SIT-051), "Cancelado a liquidar"
 * (SIT-052) o "Cancelado a monto histórico" (SIT-053) se seguía pudiendo gestionar como si estuviera
 * abierto. Los cuatro significan lo mismo para el gestor: el caso está cerrado.
 *
 * Se resuelve por categoría y no por una lista de claves para que agregar un código de cancelación
 * al catálogo no requiera tocar esto.
 *
 * IMPORTANTE: Este servicio NO bloquea al ConsolidacionSituacionService, que
 * escribe directamente con prisma.deudor.update/updateMany sin pasar por aquí.
 * Ver consolidacion-situacion-spec.md §8.4 y §10.10.
 *
 * Modo degradado: si no hay ningún código de categoría CANCELADO seedeado, `assertNoBloqueado` no
 * lanza y deja pasar. Esto permite levantar el sistema antes de correr seed-codigos-curados.ts.
 */
import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Categoría del catálogo de parámetros cuyos códigos cierran el caso. */
const CATEGORIA_CANCELADO = 'CANCELADO';

@Injectable()
export class DeudorBloqueoService implements OnModuleInit {
    private readonly logger = new Logger(DeudorBloqueoService.name);
    private idsCancelado: number[] = [];

    constructor(private readonly prisma: PrismaService) {}

    async onModuleInit(): Promise<void> {
        const codigos = await this.prisma.parametro.findMany({
            where: { grupo: 'situacion', categoria: CATEGORIA_CANCELADO },
            select: { id: true, clave: true },
        });
        this.idsCancelado = codigos.map((c) => c.id);

        if (this.idsCancelado.length === 0) {
            this.logger.warn(
                'No hay códigos de situación con categoría CANCELADO. DeudorBloqueoService operará en modo degradado (sin bloqueo). Correr seed-codigos-curados.ts para habilitarlo.',
            );
        } else {
            this.logger.log(
                `DeudorBloqueoService inicializado: bloquea ${codigos.map((c) => c.clave).join(', ')}`,
            );
        }
    }

    /**
     * Lanza ForbiddenException con code=DEUDOR_CANCELADO si el deudor está en cualquier código de
     * situación de categoría CANCELADO. Sin códigos cacheados (modo degradado), no hace nada.
     *
     * @param deudorId  ID del deudor a verificar
     * @param accion    Descripción de la acción que se intenta (para el mensaje de error y el log)
     */
    async assertNoBloqueado(deudorId: number, accion: string): Promise<void> {
        if (this.idsCancelado.length === 0) {
            return;
        }

        const d = await this.prisma.deudor.findUnique({
            where: { id: deudorId },
            select: { estadoSituacionId: true },
        });

        if (d?.estadoSituacionId != null && this.idsCancelado.includes(d.estadoSituacionId)) {
            this.logger.warn(
                `Acción bloqueada: deudorId=${deudorId} accion='${accion}' — el deudor está cancelado.`,
            );
            throw new ForbiddenException({
                code: 'DEUDOR_CANCELADO',
                message: `El deudor está cancelado. Acción '${accion}' no permitida.`,
            });
        }
    }
}
