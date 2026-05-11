import {
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Query,
} from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service';
import { UsuarioActual } from '../../auth/decorators';
import { ListarNotificacionesDto } from './dto/listar-notificaciones.dto';

interface UsuarioJwt {
    sub: number;
    email: string;
    rol: string;
    permisos: string[];
}

@Controller('notificaciones')
export class NotificacionesController {
    constructor(private readonly service: NotificacionesService) {}

    @Get()
    listar(@UsuarioActual() user: UsuarioJwt, @Query() opts: ListarNotificacionesDto) {
        return this.service.listar(user.sub, opts);
    }

    @Get('contador')
    contador(@UsuarioActual() user: UsuarioJwt) {
        return this.service.contador(user.sub);
    }

    @Post(':id/leer')
    marcarLeida(
        @UsuarioActual() user: UsuarioJwt,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.marcarLeida(user.sub, id);
    }

    @Post('leer-todas')
    marcarTodas(@UsuarioActual() user: UsuarioJwt) {
        return this.service.marcarTodas(user.sub);
    }
}
