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

        // 2. Crear las notificaciones (una por una para obtener sus IDs reales).
        //    El broadcast es a pocos usuarios (admins), así que el loop es barato y
        //    evita la query frágil anterior que podía emitir con id undefined.
        const notificacionesCreadas: { id: number; usuarioId: number }[] = [];
        for (const fila of filas) {
            try {
                const n = await this.prisma.notificacion.create({
                    data: fila,
                    select: { id: true, usuarioId: true },
                });
                notificacionesCreadas.push(n);
            } catch (err: any) {
                this.logger.warn(
                    `Error al crear notificacion para usuario ${fila.usuarioId}: ${err?.message}`,
                );
            }
        }

        // 3. Emitir via socket a cada destinatario con su id real (sin romper si falla)
        for (const notif of notificacionesCreadas) {
            try {
                const payloadSocket = {
                    id: notif.id,
                    tipo,
                    titulo,
                    mensaje,
                    payload,
                    rutaAccion,
                    creadoEn: new Date().toISOString(),
                };

                this.realtimeService.emitToUser(notif.usuarioId, 'notificacion:nueva', payloadSocket);

                const noLeidas = await this.prisma.notificacion.count({
                    where: { usuarioId: notif.usuarioId, leida: false },
                });
                this.realtimeService.emitToUser(notif.usuarioId, 'notificacion:contador', { noLeidas });
            } catch (err: any) {
                this.logger.warn(
                    `Error emitiendo notificacion via socket a usuario ${notif.usuarioId}: ${err?.message}`,
                );
            }
        }
    }

    async listar(usuarioId: number, opts: ListarNotificacionesDto) {
        const { soloNoLeidas, soloLeidas, limit = 20, offset = 0 } = opts;

        const where = {
            usuarioId,
            ...(soloNoLeidas ? { leida: false } : soloLeidas ? { leida: true } : {}),
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
