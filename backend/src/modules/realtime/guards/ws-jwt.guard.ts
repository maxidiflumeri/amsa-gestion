import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';

/**
 * Guard opcional para mensajes WebSocket entrantes desde el cliente.
 * La autenticación principal ocurre en handleConnection del gateway.
 * Este guard verifica que el socket tenga datos de usuario ya cargados.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
    private readonly logger = new Logger(WsJwtGuard.name);

    canActivate(context: ExecutionContext): boolean {
        const client: Socket = context.switchToWs().getClient();
        const usuario = client.data?.usuario;

        if (!usuario) {
            this.logger.warn(`Mensaje rechazado — socket sin usuario autenticado: ${client.id}`);
            return false;
        }

        return true;
    }
}
