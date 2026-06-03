import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';

/**
 * Liveness probe para el health check del ALB (target group → /api/health).
 * @Public() la excluye del JwtAuthGuard global (sino devuelve 401 y el ALB la marca unhealthy).
 * Intencionalmente NO toca DB ni Redis: responde 200 si el proceso está vivo.
 */
@Controller('health')
export class HealthController {
    @Public()
    @Get()
    check() {
        return { status: 'ok', uptime: Math.round(process.uptime()) };
    }
}
