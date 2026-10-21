import { Body, Controller, ForbiddenException, Get, Logger, Param, ParseIntPipe, Patch, Query, UnauthorizedException } from '@nestjs/common';
import { Permisos, UsuarioActual } from '../../auth/decorators';
import { AsistenteConfigService } from './asistente-config.service';
import { ActualizarConfigDto } from './dto/actualizar-config.dto';
import { ActualizarFuncionDto } from './dto/actualizar-funcion.dto';
import { ConfigAsistente, ConsumoAsistente, DetalleRespuesta, FuncionAsistente, PERMISO_VER_DETALLE, TiemposAsistente } from './dto/asistente.tipos';
import { ConversacionesService } from './conversaciones.service';
import { ConsumoQueryDto } from './dto/consumo-query.dto';
import { MedicionService } from './medicion.service';
import { TopesService } from './topes.service';

/** Pantalla de consumo y configuración. Los PATCH se auditan en el servicio; las lecturas, no. */
@Controller('asistente')
@Permisos('asistente.administrar')
export class AsistenteAdminController {
    private readonly logger = new Logger(AsistenteAdminController.name);

    constructor(
        private readonly config: AsistenteConfigService,
        private readonly medicion: MedicionService,
        private readonly topes: TopesService,
        private readonly conversaciones: ConversacionesService,
    ) {}

    @Get('consumo')
    async consumo(@Query() q: ConsumoQueryDto): Promise<ConsumoAsistente> {
        const pausa = await this.topes.pausa('ayuda');
        return this.medicion.consumo(q.mes, pausa);
    }

    /** Mediana y p95 de cada paso, por función. Son agregados sin contenido: con `administrar` alcanza (D-3). */
    @Get('consumo/tiempos')
    tiempos(@Query() q: ConsumoQueryDto): Promise<TiemposAsistente> {
        return this.medicion.tiempos(q.mes);
    }

    /**
     * El detalle de la respuesta de cualquier persona (para las 👎). Sin `@Permisos` en el método: un `@Permisos` en un
     * método REEMPLAZA al de la clase en vez de sumarse, y sacaría `asistente.administrar`. El segundo permiso se verifica acá.
     */
    @Get('mensajes/:id/detalle')
    async detalleDeMensaje(@UsuarioActual() u: { sub: number; permisos?: string[] }, @Param('id', ParseIntPipe) id: number): Promise<DetalleRespuesta> {
        if (!(u?.permisos ?? []).includes(PERMISO_VER_DETALLE)) {
            this.logger.warn(`Detalle de la respuesta ${id} denegado: falta ${PERMISO_VER_DETALLE} (usuario=${u?.sub})`);
            const mensaje = 'Para ver el detalle hace falta el permiso «Ver el detalle de las respuestas de amaIA».';
            throw new ForbiddenException({ codigo: 'SIN_PERMISO_DETALLE', mensaje, message: mensaje });
        }
        return this.conversaciones.detalleDeMensaje(id);
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
