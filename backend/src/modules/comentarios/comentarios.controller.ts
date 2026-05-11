import {
    Controller,
    Post,
    Delete,
    Param,
    Body,
    Get,
    Req,
    ForbiddenException,
} from '@nestjs/common';
import { ComentariosService } from './comentarios.service';
import { Audit } from '../transacciones/audit.decorator';
import { CreateComentarioDto } from './dtos/create-comentario.dto';
import { Permisos } from '../../auth/decorators';

@Controller('comentarios')
@Permisos('comentarios.ver')
export class ComentariosController {
    constructor(private readonly comentariosService: ComentariosService) { }

    @Post()
    @Permisos('comentarios.crear')
    @Audit({
        tipo: 'CREATE',
        entidad: 'Comentario',
        deudorIdParam: 'deudorId',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Agregó comentario: "${req.body.texto.slice(0, 80)}"`,
        data: (res, req) => ({ body: req.body }),
    })
    create(@Body() dto: CreateComentarioDto, @Req() req: any) {
        const usuario = req['usuario'];
        dto.usuarioId = usuario?.sub ?? null;
        return this.comentariosService.create(dto);
    }

    @Delete(':id')
    @Permisos('comentarios.eliminar')
    @Audit({
        tipo: 'DELETE',
        entidad: 'Comentario',
        entidadIdFromResponse: 'id',
        resumen: (res, req) => `Eliminó comentario ${req.params.id}`,
    })
    async remove(@Param('id') id: string, @Req() req: any) {
        const usuario = req['usuario'];
        const usuarioId: number | undefined = usuario?.sub;
        return this.comentariosService.removePropio(+id, usuarioId);
    }

    @Get('deudor/:deudorId')
    findByDeudor(@Param('deudorId') deudorId: string) {
        return this.comentariosService.findByDeudor(+deudorId);
    }
}  