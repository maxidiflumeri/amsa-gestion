import { Body, Controller, Get, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators';
import { AuditoriaHelper } from '../modules/transacciones/auditoria.helper';
import { AuditModulo, AuditTipo } from '../modules/transacciones/audit.enums';

@Controller('auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);

    constructor(
        private readonly authService: AuthService,
        private readonly auditoria: AuditoriaHelper,
    ) {}

    @Public()
    @Post('google')
    async loginGoogle(@Body('idToken') idToken: string, @Req() req: Request) {
        if (!idToken) {
            this.logger.warn('Login Google: idToken faltante');
        }
        return this.authService.loginWithGoogle(idToken, {
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? undefined,
        });
    }

    @Get('me')
    async getMe(@Req() req: Request) {
        const usuario = req['usuario'] as { sub: number };
        return this.authService.getMe(usuario.sub);
    }

    @Post('logout')
    async logout(@Req() req: Request) {
        const usuario = req['usuario'] as { sub?: number };
        await this.auditoria.log({
            modulo: AuditModulo.AUTH,
            entidad: 'Sesion',
            tipo: AuditTipo.LOGOUT,
            usuarioId: usuario?.sub ?? null,
            resumen: 'Logout',
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? undefined,
        });
        return { ok: true };
    }
}
