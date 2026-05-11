import { Body, Controller, Get, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators';

@Controller('auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);

    constructor(private readonly authService: AuthService) {}

    @Public()
    @Post('google')
    async loginGoogle(@Body('idToken') idToken: string) {
        if (!idToken) {
            this.logger.warn('Login Google: idToken faltante');
        }
        return this.authService.loginWithGoogle(idToken);
    }

    @Get('me')
    async getMe(@Req() req: Request) {
        const usuario = req['usuario'] as { sub: number };
        return this.authService.getMe(usuario.sub);
    }
}
