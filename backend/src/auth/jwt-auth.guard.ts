import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './decorators';
import { UsuarioActivoService } from './usuario-activo.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    private readonly logger = new Logger(JwtAuthGuard.name);

    constructor(
        private readonly jwtService: JwtService,
        private readonly reflector: Reflector,
        private readonly usuarioActivo: UsuarioActivoService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (isPublic) return true;

        const req = context.switchToHttp().getRequest<Request>();
        const authHeader = req.headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException('Falta el token de autenticación');
        }

        const token = authHeader.split(' ')[1];

        let payload: any;
        try {
            payload = await this.jwtService.verifyAsync(token, {
                secret: process.env.JWT_SECRET,
            });
        } catch (err) {
            this.logger.warn(`Token inválido: ${err?.message}`);
            throw new UnauthorizedException('Token inválido o expirado');
        }

        // Fuera del try, si no el catch de arriba se come este rechazo y lo reporta como token
        // inválido — que manda al usuario a mirar el lugar equivocado.
        //
        // La firma válida solo dice que el token lo emitimos nosotros, no que la persona siga
        // habilitada. Sin esto, desactivar a alguien no cortaba su sesión: seguía trabajando hasta
        // que el token venciera, hasta un día después, y ni recargar la página lo cortaba.
        if (payload?.sub && !(await this.usuarioActivo.estaActivo(payload.sub))) {
            this.logger.warn(`Sesión rechazada — usuario ${payload.sub} inactivo o eliminado`);
            throw new UnauthorizedException('Tu cuenta fue deshabilitada. Contactá al administrador.');
        }

        req['usuario'] = payload;
        return true;
    }
}
