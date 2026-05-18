import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { nanoid } from 'nanoid';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { RequestContextService } from 'src/common/logger/request-context';

interface UsuarioSocket {
    sub: number;
    email: string;
    rol: string;
    permisos: string[];
}

@WebSocketGateway({ namespace: '/rt', cors: { origin: '*', credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(RealtimeGateway.name);

    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
        @Inject(forwardRef(() => NotificacionesService))
        private readonly notificacionesService: NotificacionesService,
        private readonly requestContext: RequestContextService,
    ) {}

    async handleConnection(client: Socket) {
        const ctx = {
            requestId: nanoid(8),
            source: 'ws' as const,
            ip: client.handshake.address,
            userAgent: client.handshake.headers?.['user-agent'],
        };

        return this.requestContext.run(ctx, async () => {
            try {
                const token =
                    (client.handshake.auth as Record<string, string>)?.token ||
                    (client.handshake.query?.token as string);

                if (!token) {
                    this.logger.warn(`Conexión WS rechazada motivo=sin_token clientId=${client.id}`);
                    client.disconnect();
                    return;
                }

                let payload: UsuarioSocket;
                try {
                    payload = this.jwtService.verify<UsuarioSocket>(token, {
                        secret: process.env.JWT_SECRET,
                    });
                } catch (err: any) {
                    this.logger.warn(`Conexión WS rechazada motivo=token_invalido clientId=${client.id}: ${err?.message}`);
                    client.disconnect();
                    return;
                }

                const usuario = await this.prisma.usuario.findUnique({
                    where: { id: payload.sub },
                    include: { rolObj: { select: { permisos: true } } },
                });

                if (!usuario || !usuario.activo) {
                    this.logger.warn(`Conexión WS rechazada motivo=usuario_inactivo clientId=${client.id} email=${payload.email}`);
                    client.disconnect();
                    return;
                }

                const permisos: string[] = Array.isArray(usuario.rolObj?.permisos)
                    ? (usuario.rolObj.permisos as string[])
                    : [];

                client.data.usuario = {
                    sub: usuario.id,
                    email: usuario.email,
                    rol: payload.rol,
                    permisos,
                };

                await client.join(`user:${usuario.id}`);

                if (permisos.includes('importacion.ver_progreso_otros')) {
                    await client.join('admin:importaciones');
                    this.logger.log(
                        `Socket conectado usuarioId=${usuario.id} email=${usuario.email} clientId=${client.id} rooms=user:${usuario.id},admin:importaciones`,
                    );
                } else {
                    this.logger.log(
                        `Socket conectado usuarioId=${usuario.id} email=${usuario.email} clientId=${client.id}`,
                    );
                }
            } catch (err: any) {
                this.logger.error(`Error en handleConnection clientId=${client.id}: ${err?.message}`, err?.stack);
                client.disconnect();
            }
        });
    }

    handleDisconnect(client: Socket) {
        const email = (client.data?.usuario as UsuarioSocket)?.email ?? 'desconocido';
        this.logger.log(`Socket desconectado: ${email} [${client.id}]`);
    }

    @SubscribeMessage('notificacion:marcar_leida')
    async handleMarcarLeida(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { id: number },
    ) {
        const usuario = client.data?.usuario as UsuarioSocket;
        if (!usuario) return;

        const ctx = { requestId: nanoid(8), usuarioId: usuario.sub, source: 'ws' as const };
        return this.requestContext.run(ctx, async () => {
            try {
                await this.notificacionesService.marcarLeida(usuario.sub, data.id);
            } catch (err: any) {
                this.logger.warn(`Error al marcar leída notificacionId=${data.id}: ${err?.message}`);
            }
        });
    }

    @SubscribeMessage('notificacion:marcar_todas')
    async handleMarcarTodas(@ConnectedSocket() client: Socket) {
        const usuario = client.data?.usuario as UsuarioSocket;
        if (!usuario) return;

        const ctx = { requestId: nanoid(8), usuarioId: usuario.sub, source: 'ws' as const };
        return this.requestContext.run(ctx, async () => {
            try {
                await this.notificacionesService.marcarTodas(usuario.sub);
            } catch (err: any) {
                this.logger.warn(`Error al marcar todas leídas usuarioId=${usuario.sub}: ${err?.message}`);
            }
        });
    }
}
