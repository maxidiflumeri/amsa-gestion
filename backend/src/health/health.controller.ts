import { Controller, Get } from '@nestjs/common';

/**
 * Liveness probe para el health check del ALB (target group → /api/health).
 * Intencionalmente NO toca DB ni Redis: responde 200 si el proceso está vivo.
 */
@Controller('health')
export class HealthController {
    @Get()
    check() {
        return { status: 'ok', uptime: Math.round(process.uptime()) };
    }
}
