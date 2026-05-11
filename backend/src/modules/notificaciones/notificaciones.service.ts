import {
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CrearNotificacionParams } from './interfaces/crear-notificacion-params.interface';
import { ListarNotificacionesDto } from './dto/listar-notificaciones.dto';

@Injectable()
export class NotificacionesService {
    private readonly logger = new Logger(NotificacionesService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(forwardRef(() => RealtimeService))
        private readonly realtimeService: RealtimeService,
    ) {}

    /**
     * Crea notificaciones para el destinatario principal y opcionalmente
     * para todos los usuarios activos que tengan un permiso específico.
     */
    async crear(params: CrearNotificacionParams): Promise<void> {
        const {
            tipo,
            entidadTipo,
            entidadId,
            titulo,
            mensaje,
            payload,
            rutaAccion,
            destinatarioPrincipalId,
            incluirUsuariosConPermiso,
        } = params;

        // 1. Calcular set de destinatarios
        const destinatarioIds = new Set<number>([destinatarioPrincipalId]);

        if (incluirUsuariosConPermiso) {
            try {
                const usuariosActivos = await this.prisma.usuario.findMany({
                    where: { activo: true },
                    select: { id: true, rolObj: { select: { permisos: true } } },
                });

                for (const u of usuariosActivos) {
                    const permisos: string[] = Array.isArray(u.rolObj?.permisos)
                        ? (u.rolObj.permisos as string[])
                        : [];
                    if (permisos.includes(incluirUsuariosConPermiso)) {
                        destinatarioIds.add(u.id);
                    }
                }
            } catch (err: any) {
                this.logger.warn(
                    `No se pudo resolver usuarios con permiso "${incluirUsuariosConPermiso}": ${err?.message}`,
                );
            }
        }

        const filas = Array.from(destinatarioIds).map((usuarioId) => ({
            usuarioId,
            tipo,
            entidadTipo: entidadTipo ?? null,
            entidadId: entidadId ?? null,
            titulo,
            mensaje,
            payload: payload !== undefined ? (payload as Prisma.InputJsonValue) : Prisma.JsonNull,
            rutaAccion: rutaAccion ?? null,
        }));

        // 2. Crear todas las notificaciones de una vez
        let notificacionesCreadas: { id: number; usuarioId: number }[] = [];
        try {
            await this.prisma.notificacion.createMany({ data: filas });

            // Recuperar las creadas para obtener sus IDs (createMany no retorna records en MySQL)
            notificacionesCreadas = await this.prisma.notificacion.findMany({
                where: {
                    usuarioId: { in: Array.from(destinatarioIds) },
                    tipo,
                    entidadId: entidadId ?? null,
                    leida: false,
                },
                select: { id: true, usuarioId: true },
                orderBy: { creadoEn: 'desc' },
                take: filas.length,
            });
        } catch (err: any) {
            this.logger.error(`Error al crear notificaciones: ${err?.message}`, err?.stack);
            return;
        }

        // 3. Emitir via socket a cada destinatario (sin romper si falla)
        for (const usuarioId of destinatarioIds) {
            try {
                const notif = notificacionesCreadas.find((n) => n.usuarioId === usuarioId);

                const payloadSocket = {
                    id: notif?.id,
                    tipo,
                    titulo,
                    mensaje,
                    payload,
                    rutaAccion,
                    creadoEn: new Date().toISOString(),
                };

                this.realtimeService.emitToUser(usuarioId, 'notificacion:nueva', payloadSocket);

                // Recalcular contador y emitir
                const noLeidas = await this.prisma.notificacion.count({
                    where: { usuarioId, leida: false },
                });
                this.realtimeService.emitToUser(usuarioId, 'notificacion:contador', { noLeidas });
            } catch (err: any) {
                this.logger.warn(
                    `Error emitiendo notificacion via socket a usuario ${usuarioId}: ${err?.message}`,
                );
            }
        }
    }

    async listar(usuarioId: number, opts: ListarNotificacionesDto) {
        const { soloNoLeidas, limit = 20, offset = 0 } = opts;

        const where = {
            usuarioId,
            ...(soloNoLeidas ? { leida: false } : {}),
        };

        const [data, total] = await Promise.all([
            this.prisma.notificacion.findMany({
                where,
                orderBy: { creadoEn: 'desc' },
                take: limit,
                skip: offset,
            }),
            this.prisma.notificacion.count({ where }),
        ]);

        return { data, total, limit, offset };
    }

    async contador(usuarioId: number): Promise<{ noLeidas: number }> {
        const noLeidas = await this.prisma.notificacion.count({
            where: { usuarioId, leida: false },
        });
        return { noLeidas };
    }

    async marcarLeida(usuarioId: number, id: number): Promise<void> {
        const notif = await this.prisma.notificacion.findUnique({ where: { id } });

        if (!notif) {
            throw new NotFoundException(`Notificacion ${id} no encontrada`);
        }

        if (notif.usuarioId !== usuarioId) {
            throw new ForbiddenException('No tenés permiso para marcar esta notificacion');
        }

        await this.prisma.notificacion.update({
            where: { id },
            data: { leida: true, leidaEn: new Date() },
        });

        // Re-emitir contador actualizado
        try {
            const noLeidas = await this.prisma.notificacion.count({
                where: { usuarioId, leida: false },
            });
            this.realtimeService.emitToUser(usuarioId, 'notificacion:contador', { noLeidas });
        } catch (err: any) {
            this.logger.warn(`Error emitiendo contador post marcarLeida: ${err?.message}`);
        }
    }

    async marcarTodas(usuarioId: number): Promise<void> {
        await this.prisma.notificacion.updateMany({
            where: { usuarioId, leida: false },
            data: { leida: true, leidaEn: new Date() },
        });

        try {
            this.realtimeService.emitToUser(usuarioId, 'notificacion:contador', { noLeidas: 0 });
        } catch (err: any) {
            this.logger.warn(`Error emitiendo contador post marcarTodas: ${err?.message}`);
        }
    }

    async eliminar(usuarioId: number, id: number): Promise<void> {
        const notif = await this.prisma.notificacion.findUnique({ where: { id } });

        if (!notif) {
            throw new NotFoundException(`Notificacion ${id} no encontrada`);
        }

        if (notif.usuarioId !== usuarioId) {
            throw new ForbiddenException('No tenés permiso para eliminar esta notificacion');
        }

        await this.prisma.notificacion.delete({ where: { id } });
    }
}
