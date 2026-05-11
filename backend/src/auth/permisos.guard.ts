import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISOS_KEY } from './decorators';

@Injectable()
export class PermisosGuard implements CanActivate {
    private readonly logger = new Logger(PermisosGuard.name);

    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const permisosRequeridos = this.reflector.getAllAndOverride<string[]>(PERMISOS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!permisosRequeridos || permisosRequeridos.length === 0) return true;

        const request = context.switchToHttp().getRequest();
        const usuario = request['usuario'];
        const permisos: string[] = Array.isArray(usuario?.permisos) ? usuario.permisos : [];

        const tienePermiso = permisosRequeridos.some((p) => permisos.includes(p));

        if (!tienePermiso) {
            this.logger.warn(
                `Acceso denegado a ${usuario?.email} — permisos requeridos: ${permisosRequeridos.join(', ')}`,
            );
            throw new ForbiddenException('No tenés permiso para realizar esta acción.');
        }

        return true;
    }
}
