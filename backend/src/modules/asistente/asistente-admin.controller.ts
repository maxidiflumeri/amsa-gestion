import { Body, Controller, Get, Param, Patch, Query, UnauthorizedException } from '@nestjs/common';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { AsistenteConfigService } from './asistente-config.service';
import { ActualizarConfigDto } from './dto/actualizar-config.dto';
import { ActualizarFuncionDto } from './dto/actualizar-funcion.dto';
import { ConfigAsistente, ConsumoAsistente, FuncionAsistente } from './dto/asistente.tipos';
import { ConsumoQueryDto } from './dto/consumo-query.dto';
import { MedicionService } from './medicion.service';
import { TopesService } from './topes.service';

/** Pantalla de consumo y configuración. Los PATCH se auditan en el servicio; las lecturas, no. */
@Controller('asistente')
@Permisos('asistente.administrar')
export class AsistenteAdminController {
    constructor(
        private readonly config: AsistenteConfigService,
        private readonly medicion: MedicionService,
        private readonly topes: TopesService,
    ) {}

    @Get('consumo')
    async consumo(@Query() q: ConsumoQueryDto): Promise<ConsumoAsistente> {
        const pausa = await this.topes.pausa('ayuda');
        return this.medicion.consumo(q.mes, pausa);
    }

    @Get('config')
    obtenerConfig(): Promise<ConfigAsistente> {
        return this.config.configPublica();
    }

    @Patch('config')
    async actualizarConfig(@UsuarioActual() u: { sub: number }, @Body() dto: ActualizarConfigDto): Promise<ConfigAsistente> {
        if (!u?.sub) throw new UnauthorizedException('Sesión inválida');
        const config = await this.config.actualizar(dto, u.sub);
        // Bajar el tope por debajo de lo gastado tiene que avisar en el momento, no recién en la próxima llamada.
        await this.topes.evaluarAvisosSinRomper();
        return config;
    }

    @Patch('funciones/:clave')
    actualizarFuncion(
        @UsuarioActual() u: { sub: number },
        @Param('clave') clave: string,
        @Body() dto: ActualizarFuncionDto,
    ): Promise<FuncionAsistente> {
        if (!u?.sub) throw new UnauthorizedException('Sesión inválida');
        return this.config.actualizarFuncion(clave, dto, u.sub);
    }
}
