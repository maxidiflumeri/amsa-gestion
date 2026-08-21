import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Responde si un usuario sigue habilitado, para que el guard pueda cortar una sesión ya abierta.
 *
 * Hasta 2026-08-21 el `activo` se verificaba **solo en el login**: `JwtAuthGuard` verifica la firma
 * del token y nada más, así que desactivar a alguien no lo echaba — seguía operando con todos sus
 * permisos hasta que el token venciera, que con `JWT_EXPIRES_IN=1d` es hasta un día, y ni siquiera
 * recargar la página lo cortaba.
 *
 * Se cachea con TTL corto en vez de pegarle a la base en cada request: los endpoints de polling
 * (notificaciones, importaciones en curso) multiplican el tráfico y esto está en el camino de
 * absolutamente todas las llamadas autenticadas.
 *
 * `invalidar()` lo llama el ABM de usuarios, así que en la práctica el corte es inmediato; el TTL es
 * el techo para el caso de que el cambio venga por fuera de la app (o de otra instancia).
 */
const TTL_MS = Number(process.env.AUTH_ESTADO_CACHE_TTL_MS ?? 30_000);

@Injectable()
export class UsuarioActivoService {
    private readonly logger = new Logger(UsuarioActivoService.name);
    private readonly cache = new Map<number, { activo: boolean; expira: number }>();

    constructor(private readonly prisma: PrismaService) {}

    async estaActivo(usuarioId: number): Promise<boolean> {
        const ahora = Date.now();
        const cacheado = this.cache.get(usuarioId);
        if (cacheado && cacheado.expira > ahora) return cacheado.activo;

        const usuario = await this.prisma.usuario.findUnique({
            where: { id: usuarioId },
            select: { activo: true },
        });
        // Un usuario borrado con un token todavía válido tampoco puede seguir operando.
        const activo = usuario?.activo === true;

        this.cache.set(usuarioId, { activo, expira: ahora + TTL_MS });
        return activo;
    }

    /** Corta el acceso en el momento, sin esperar al TTL. La llama el ABM de usuarios. */
    invalidar(usuarioId: number): void {
        this.cache.delete(usuarioId);
        this.logger.debug(`Estado de usuario ${usuarioId} invalidado en caché`);
    }
}
