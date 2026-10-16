import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { UsuarioActual } from '../../auth/decorators';
import { InicioService } from './inicio.service';
import { MiDiaDto } from './dto/mi-dia.dto';

/**
 * Sin `@Permisos` a propósito: cualquier usuario con sesión entra, y cada bloque se calcula solo si tiene su
 * permiso. Sin `@Audit`: es una lectura que se repite sola cada 5 minutos.
 */
@Controller('inicio')
export class InicioController {
    constructor(private readonly inicioService: InicioService) {}

    @Get('mi-dia')
    miDia(@UsuarioActual() usuario: { sub: number; permisos?: string[] }): Promise<MiDiaDto> {
        if (!usuario?.sub) throw new UnauthorizedException('Sesión inválida');
        return this.inicioService.miDia(usuario.sub, Array.isArray(usuario.permisos) ? usuario.permisos : []);
    }
}
