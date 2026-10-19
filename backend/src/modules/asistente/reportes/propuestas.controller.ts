import { Controller, Get, Param, ParseIntPipe, Query, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Permisos, UsuarioActual } from '../../../auth/decorators';
import type { UsuarioJwt } from '../asistente.service';
import { PlantillaDesdeAsistente, VistaPreviaPropuesta } from '../dto/asistente.tipos';
import { VistaPreviaQueryDto } from '../dto/propuesta.dto';
import { PropuestasService } from './propuestas.service';

function usuarioValido(u: UsuarioJwt | undefined): UsuarioJwt {
    if (!u?.sub) throw new UnauthorizedException('Sesión inválida');
    return u;
}

@Controller('asistente/propuestas')
@Permisos('asistente.reportes')
export class PropuestasController {
    constructor(private readonly servicio: PropuestasService) {}

    @Get(':id/plantilla')
    plantilla(@UsuarioActual() u: UsuarioJwt, @Param('id', ParseIntPipe) id: number): Promise<PlantillaDesdeAsistente> {
        return this.servicio.plantillaDe(usuarioValido(u).sub, id);
    }

    @Get(':id/vista-previa')
    vistaPrevia(@UsuarioActual() u: UsuarioJwt, @Param('id', ParseIntPipe) id: number, @Query() q: VistaPreviaQueryDto): Promise<VistaPreviaPropuesta> {
        const user = usuarioValido(u);
        if (!(user.permisos ?? []).includes('reportes.ver')) throw new ForbiddenException('Para ver la vista previa hace falta el permiso «Ver reportes».');
        return this.servicio.vistaPrevia(user.sub, id, q.filas ?? 5);
    }
}
