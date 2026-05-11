import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISOS_KEY } from './decorators';
import { AuditoriaHelper } from '../modules/transacciones/auditoria.helper';
import { AuditEstado, AuditModulo, AuditSeveridad, AuditTipo } from '../modules/transacciones/audit.enums';

@Injectable()
export class PermisosGuard implements CanActivate {
    private readonly logger = new Logger(PermisosGuard.name);

    constructor(
        private readonly reflector: Reflector,
        private readonly auditoria: AuditoriaHelper,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
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
            await this.auditoria.log({
                modulo: AuditModulo.AUTH,
                entidad: 'Sesion',
                tipo: AuditTipo.PERMISO_DENEGADO,
                severidad: AuditSeveridad.WARN,
                estado: AuditEstado.FALLIDO,
                usuarioId: usuario?.sub ?? null,
                resumen: `Acceso denegado — ${permisosRequeridos.join(', ')}`,
                data: {
                    params: {
                        permisosRequeridos,
                        ruta: `${request.method} ${request.originalUrl ?? request.url}`,
                    },
                },
                ip: request.ip,
                userAgent: request.headers?.['user-agent'],
            });
            throw new ForbiddenException('No tenés permiso para realizar esta acción.');
        }

        return true;
    }
}
